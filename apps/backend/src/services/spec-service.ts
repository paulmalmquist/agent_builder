import { randomUUID } from 'node:crypto';
import {
  AgentDerivationMode,
  GuardrailType,
  Prisma,
  SectionConfirmationKind,
  SpecSection,
  SpecStatus as DatabaseSpecStatus,
  type AgentSpec as DatabaseAgentSpec,
  type PrismaClient,
} from '@prisma/client';
import {
  createSpecRequestSchema,
  guardrailsSectionSchema,
  interpretationConfirmationSchema,
  interpretSpecResponseSchema,
  jsonObjectSchema,
  knowledgeSectionSchema,
  outcomesSectionSchema,
  outputsSectionSchema,
  unconfirmedSpecPrefillSchema,
  type AgentSpec,
  type GuardrailsSection,
  type KnowledgeSection,
  type OutcomesSection,
  type OutputsSection,
  type UpdateGuardrailsRequest,
  type UpdateKnowledgeRequest,
  type UpdateOutcomesRequest,
  type UpdateOutputsRequest,
} from '@agent-builder/contracts';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import type { KnowledgeConnectorRegistry } from '../connectors/knowledge.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { toAgentSpec, toSourceDescriptor } from '../mappers.js';
import { currentActorId } from '../request-context.js';
import { aggregateScope, aggregateScopeWhere, isInPrincipalScope } from '../scope.js';
import { assertSpecTransition } from './transitions.js';
import type { SpecApi } from './types.js';

const stringArraySchema = z.array(z.string());
const resolutionArraySchema = interpretationConfirmationSchema.shape.resolutions;

const derivationModeMap = {
  new: AgentDerivationMode.NEW,
  configure: AgentDerivationMode.CONFIGURE,
  extend: AgentDerivationMode.EXTEND,
} as const;

const slugBase = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 130) || 'agent';

type SectionName = 'outcomes' | 'knowledge' | 'guardrails' | 'outputs';
type SectionValue = OutcomesSection | KnowledgeSection | GuardrailsSection | OutputsSection;
const sectionEnum = {
  outcomes: SpecSection.OUTCOMES,
  knowledge: SpecSection.KNOWLEDGE,
  guardrails: SpecSection.GUARDRAILS,
  outputs: SpecSection.OUTPUTS,
} as const;

function asWrapped<T>(raw: T | { value: T; interpretationConfirmation?: unknown }): {
  value: T;
  confirmation: z.infer<typeof interpretationConfirmationSchema> | undefined;
} {
  if (typeof raw === 'object' && raw !== null && 'value' in raw) {
    const wrapped = raw;
    return {
      value: wrapped.value,
      confirmation:
        wrapped.interpretationConfirmation === undefined
          ? undefined
          : interpretationConfirmationSchema.parse(wrapped.interpretationConfirmation),
    };
  }
  return { value: raw, confirmation: undefined };
}

export class SpecService implements SpecApi {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly connectors: KnowledgeConnectorRegistry,
  ) {}

  async create(rawInput: z.input<typeof createSpecRequestSchema>): Promise<AgentSpec> {
    const request = createSpecRequestSchema.parse(rawInput);
    if (request.derivationMode === 'new' && request.baseAgentId !== null) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Build-new specs cannot name a base agent');
    }
    if (request.derivationMode !== 'new' && request.baseAgentId === null) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Configure and extend require a base agent');
    }

    const actorId = currentActorId();
    const scope = aggregateScope();
    const agentId = randomUUID();
    const specId = randomUUID();
    return this.prisma.$transaction(
      async (transaction) => {
        const base =
          request.baseAgentId === null
            ? null
            : await transaction.agent.findFirst({
                where: { id: request.baseAgentId, family: aggregateScopeWhere() },
                include: { family: true, spec: true },
              });
        if (request.baseAgentId !== null && (!base || !isInPrincipalScope(base.family))) {
          throw new AppError(404, 'BASE_AGENT_NOT_FOUND', 'Base agent was not found', {
            agentId: request.baseAgentId,
          });
        }
        if (request.interpretationId !== null) {
          await this.assertAttachableInterpretation(transaction, request.interpretationId, specId);
          const interpretation = await transaction.specInterpretation.findUniqueOrThrow({
            where: { id: request.interpretationId },
          });
          const result = interpretSpecResponseSchema.parse(interpretation.result);
          if (result.kind !== 'prefill' || result.sections.outcomes.value === null) {
            throw new AppError(
              409,
              'INTERPRETATION_NOT_CONFIRMABLE',
              'Choose a single interpreted scope before creating a specification',
              { interpretationId: request.interpretationId },
            );
          }
          if (JSON.stringify(result.sections.outcomes.value) !== JSON.stringify(request.outcomes)) {
            throw new AppError(
              409,
              'INTERPRETATION_LINEAGE_MISMATCH',
              'Submitted outcomes do not match the interpreted prefill',
              { interpretationId: request.interpretationId },
            );
          }
        }

        let familyId: string;
        let familySlug: string;
        let versionNumber: number;
        if (request.derivationMode === 'configure') {
          const configuredBase = base!;
          familyId = configuredBase.familyId;
          familySlug = configuredBase.family.slug;
          await transaction.$queryRaw`SELECT "id" FROM "AgentFamily" WHERE "id" = ${familyId}::uuid FOR UPDATE`;
          const latest = await transaction.agent.aggregate({
            where: { familyId },
            _max: { versionNumber: true },
          });
          versionNumber = (latest._max.versionNumber ?? 0) + 1;
        } else {
          familyId = randomUUID();
          const preferred = slugBase(request.outcomes.name);
          const collision = await transaction.agentFamily.findUnique({
            where: {
              workspaceId_slug: { workspaceId: scope.workspaceId, slug: preferred },
            },
          });
          familySlug = collision ? `${preferred}-${randomUUID().slice(0, 8)}` : preferred;
          versionNumber = 1;
          await transaction.agentFamily.create({
            data: {
              ...scope,
              id: familyId,
              slug: familySlug,
              name: request.outcomes.name,
              department: request.outcomes.department,
              owner: `${request.outcomes.department} Agent Owner`,
              createdBy: actorId,
              updatedBy: actorId,
            },
          });
        }

        const inherited =
          request.derivationMode === 'configure' && base?.spec
            ? {
                knowledge:
                  base.spec.knowledge === null
                    ? null
                    : parseJson(knowledgeSectionSchema, base.spec.knowledge, 'base knowledge'),
                guardrails:
                  base.spec.guardrails === null
                    ? null
                    : parseJson(guardrailsSectionSchema, base.spec.guardrails, 'base guardrails'),
                outputs:
                  base.spec.outputs === null
                    ? null
                    : parseJson(outputsSectionSchema, base.spec.outputs, 'base outputs'),
              }
            : { knowledge: null, guardrails: null, outputs: null };
        const outcomesConfirmed = request.interpretationId === null;
        const complete =
          outcomesConfirmed && Object.values(inherited).every((value) => value !== null);
        const unconfirmedPrefill =
          request.derivationMode === 'extend' &&
          base?.spec !== null &&
          base?.spec !== undefined &&
          base.spec.knowledge !== null &&
          base.spec.guardrails !== null &&
          base.spec.outputs !== null
            ? unconfirmedSpecPrefillSchema.parse({
                sourceAgentId: base.id,
                sourceSpecId: base.spec.id,
                sourceSpecRevision: base.spec.revision,
                knowledge: parseJson(
                  knowledgeSectionSchema,
                  base.spec.knowledge,
                  'extend base knowledge',
                ),
                guardrails: parseJson(
                  guardrailsSectionSchema,
                  base.spec.guardrails,
                  'extend base guardrails',
                ),
                outputs: parseJson(outputsSectionSchema, base.spec.outputs, 'extend base outputs'),
              })
            : null;
        const outcomesJson = toPrismaJson(
          outcomesSectionSchema,
          request.outcomes,
          `AgentSpec(${specId}).outcomes`,
        );
        const capabilities = toPrismaJson(stringArraySchema, [], `Agent(${agentId}).capabilities`);
        await transaction.agent.create({
          data: {
            id: agentId,
            familyId,
            slug: `${familySlug}-v${versionNumber}`,
            versionNumber,
            predecessorAgentId: base?.id ?? null,
            derivationMode: derivationModeMap[request.derivationMode],
            name: request.outcomes.name,
            department: request.outcomes.department,
            purpose: request.outcomes.purpose,
            owner: `${request.outcomes.department} Agent Owner`,
            capabilities,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
        const spec = await transaction.agentSpec.create({
          data: {
            id: specId,
            agentId,
            baseAgentId: request.baseAgentId,
            derivationMode: derivationModeMap[request.derivationMode],
            interpretationId: request.interpretationId,
            unconfirmedPrefill:
              unconfirmedPrefill === null
                ? Prisma.DbNull
                : toPrismaJson(
                    unconfirmedSpecPrefillSchema,
                    unconfirmedPrefill,
                    `AgentSpec(${specId}).unconfirmedPrefill`,
                  ),
            outcomes: outcomesConfirmed ? outcomesJson : Prisma.DbNull,
            knowledge:
              inherited.knowledge === null
                ? Prisma.DbNull
                : toPrismaJson(
                    knowledgeSectionSchema,
                    inherited.knowledge,
                    `AgentSpec(${specId}).knowledge`,
                  ),
            guardrails:
              inherited.guardrails === null
                ? Prisma.DbNull
                : toPrismaJson(
                    guardrailsSectionSchema,
                    inherited.guardrails,
                    `AgentSpec(${specId}).guardrails`,
                  ),
            outputs:
              inherited.outputs === null
                ? Prisma.DbNull
                : toPrismaJson(
                    outputsSectionSchema,
                    inherited.outputs,
                    `AgentSpec(${specId}).outputs`,
                  ),
            status: complete ? DatabaseSpecStatus.READY : DatabaseSpecStatus.DRAFT,
            createdBy: actorId,
            updatedBy: actorId,
          },
        });
        if (outcomesConfirmed) {
          await transaction.specSectionConfirmation.create({
            data: {
              specId,
              section: SpecSection.OUTCOMES,
              specRevision: spec.revision,
              kind: SectionConfirmationKind.GUIDED,
              resolutions: toPrismaJson(resolutionArraySchema, [], 'outcomes confirmations'),
              actorId,
            },
          });
        }
        if (request.derivationMode === 'configure' && base?.spec) {
          for (const [section, value] of Object.entries(inherited) as [
            Exclude<SectionName, 'outcomes'>,
            SectionValue | null,
          ][]) {
            if (value === null) continue;
            await transaction.specSectionConfirmation.create({
              data: {
                specId,
                section: sectionEnum[section],
                specRevision: spec.revision,
                kind: SectionConfirmationKind.INHERITED,
                sourceSpecId: base.spec.id,
                sourceSpecRevision: base.spec.revision,
                resolutions: toPrismaJson(resolutionArraySchema, [], `${section} confirmations`),
                actorId,
              },
            });
          }
          await this.replaceAgentKnowledge(transaction, agentId, inherited.knowledge);
          await this.replaceAgentGuardrails(transaction, agentId, inherited.guardrails);
        }
        await appendAuditEvent(transaction, {
          action: 'agent.created',
          entityType: 'Agent',
          entityId: agentId,
          details: { specId, familyId, versionNumber, derivationMode: request.derivationMode },
        });
        await appendAuditEvent(transaction, {
          action: 'agent_spec.created',
          entityType: 'AgentSpec',
          entityId: specId,
          details: {
            agentId,
            baseAgentId: request.baseAgentId,
            interpretationId: request.interpretationId,
          },
        });
        return toAgentSpec(spec);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async get(specId: string): Promise<AgentSpec> {
    return toAgentSpec(await this.findSpec(specId));
  }

  async updateOutcomes(specId: string, raw: UpdateOutcomesRequest | OutcomesSection) {
    const wrapped = asWrapped(raw);
    return this.updateSection(
      specId,
      'outcomes',
      outcomesSectionSchema.parse(wrapped.value),
      wrapped.confirmation,
    );
  }

  async updateKnowledge(specId: string, raw: UpdateKnowledgeRequest | KnowledgeSection) {
    const wrapped = asWrapped(raw);
    const value = knowledgeSectionSchema.parse(wrapped.value);
    const descriptorIds = value.sources.map((source) => source.descriptorId);
    if (new Set(descriptorIds).size !== descriptorIds.length) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'A knowledge descriptor may be selected only once',
      );
    }
    const sources = await this.prisma.knowledgeSource.findMany({
      where: { id: { in: descriptorIds }, ...aggregateScopeWhere() },
    });
    const found = new Set(sources.map((source) => source.id));
    const missing = descriptorIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Unknown knowledge source descriptor', {
        descriptorIds: missing,
      });
    }
    await this.connectors.validateSources(sources.map(toSourceDescriptor));
    return this.updateSection(specId, 'knowledge', value, wrapped.confirmation);
  }

  async updateGuardrails(specId: string, raw: UpdateGuardrailsRequest | GuardrailsSection) {
    const wrapped = asWrapped(raw);
    return this.updateSection(
      specId,
      'guardrails',
      guardrailsSectionSchema.parse(wrapped.value),
      wrapped.confirmation,
    );
  }

  async updateOutputs(specId: string, raw: UpdateOutputsRequest | OutputsSection) {
    const wrapped = asWrapped(raw);
    return this.updateSection(
      specId,
      'outputs',
      outputsSectionSchema.parse(wrapped.value),
      wrapped.confirmation,
    );
  }

  private async updateSection(
    specId: string,
    section: SectionName,
    value: SectionValue,
    confirmation: z.infer<typeof interpretationConfirmationSchema> | undefined,
  ): Promise<AgentSpec> {
    const actorId = currentActorId();
    await this.findSpec(specId);
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.agentSpec.findUnique({ where: { id: specId } });
      if (!current)
        throw new AppError(404, 'SPEC_NOT_FOUND', 'Agent specification was not found', { specId });
      this.assertWritable(current);
      const persistedSection = current[section];
      if (
        current.interpretationId !== null &&
        persistedSection === null &&
        confirmation === undefined
      ) {
        throw new AppError(
          422,
          'INTERPRETATION_CONFIRMATION_REQUIRED',
          'Interpreted sections must be explicitly reviewed and confirmed before completion',
          { specId, section, interpretationId: current.interpretationId },
        );
      }
      if (confirmation !== undefined) {
        await this.assertAttachableInterpretation(
          transaction,
          confirmation.interpretationId,
          specId,
          current.interpretationId,
          section,
          confirmation.resolutions,
          value,
        );
      }
      const completion = {
        outcomes: section === 'outcomes' || current.outcomes !== null,
        knowledge: section === 'knowledge' || current.knowledge !== null,
        guardrails: section === 'guardrails' || current.guardrails !== null,
        outputs: section === 'outputs' || current.outputs !== null,
      };
      const isComplete = Object.values(completion).every(Boolean);
      const nextStatus =
        current.status === DatabaseSpecStatus.READY || isComplete
          ? DatabaseSpecStatus.READY
          : DatabaseSpecStatus.DRAFT;
      if (current.status === DatabaseSpecStatus.DRAFT && nextStatus === DatabaseSpecStatus.READY)
        assertSpecTransition('draft', 'ready');
      const data: Prisma.AgentSpecUpdateInput = {
        revision: { increment: 1 },
        status: nextStatus,
        updatedBy: actorId,
        ...(confirmation === undefined || current.interpretationId !== null
          ? {}
          : { interpretation: { connect: { id: confirmation.interpretationId } } }),
      };
      if (section === 'outcomes') {
        const outcomes = outcomesSectionSchema.parse(value);
        data.outcomes = toPrismaJson(
          outcomesSectionSchema,
          outcomes,
          `AgentSpec(${specId}).outcomes`,
        );
        await transaction.agent.update({
          where: { id: current.agentId },
          data: {
            name: outcomes.name,
            department: outcomes.department,
            purpose: outcomes.purpose,
            updatedBy: actorId,
          },
        });
      } else if (section === 'knowledge') {
        const knowledge = knowledgeSectionSchema.parse(value);
        data.knowledge = toPrismaJson(
          knowledgeSectionSchema,
          knowledge,
          `AgentSpec(${specId}).knowledge`,
        );
        await this.replaceAgentKnowledge(transaction, current.agentId, knowledge);
      } else if (section === 'guardrails') {
        const guardrails = guardrailsSectionSchema.parse(value);
        data.guardrails = toPrismaJson(
          guardrailsSectionSchema,
          guardrails,
          `AgentSpec(${specId}).guardrails`,
        );
        await this.replaceAgentGuardrails(transaction, current.agentId, guardrails);
      } else {
        const outputs = outputsSectionSchema.parse(value);
        data.outputs = toPrismaJson(outputsSectionSchema, outputs, `AgentSpec(${specId}).outputs`);
      }
      const updated = await transaction.agentSpec.update({ where: { id: specId }, data });
      await transaction.specSectionConfirmation.create({
        data: {
          specId,
          interpretationId: confirmation?.interpretationId ?? null,
          section: sectionEnum[section],
          specRevision: updated.revision,
          kind:
            confirmation === undefined
              ? SectionConfirmationKind.GUIDED
              : SectionConfirmationKind.INTERPRETED,
          resolutions: toPrismaJson(
            resolutionArraySchema,
            confirmation?.resolutions ?? [],
            `AgentSpec(${specId}).confirmation`,
          ),
          actorId,
        },
      });
      await appendAuditEvent(transaction, {
        action: 'agent_spec.section_replaced',
        entityType: 'AgentSpec',
        entityId: specId,
        details: {
          agentId: current.agentId,
          section,
          revision: updated.revision,
          status: updated.status.toLowerCase(),
          confirmationKind: confirmation === undefined ? 'guided' : 'interpreted',
        },
      });
      return toAgentSpec(updated);
    });
  }

  private async replaceAgentKnowledge(
    transaction: Prisma.TransactionClient,
    agentId: string,
    knowledge: KnowledgeSection | null,
  ): Promise<void> {
    await transaction.agentKnowledgeSource.deleteMany({ where: { agentId } });
    if (knowledge !== null) {
      await transaction.agentKnowledgeSource.createMany({
        data: knowledge.sources.map((source) => ({
          agentId,
          workspaceId: aggregateScope().workspaceId,
          sourceId: source.descriptorId,
          purpose: source.purpose,
          citations: source.requiredCitations,
        })),
      });
    }
  }

  private async replaceAgentGuardrails(
    transaction: Prisma.TransactionClient,
    agentId: string,
    guardrails: GuardrailsSection | null,
  ): Promise<void> {
    await transaction.guardrail.deleteMany({ where: { agentId } });
    if (guardrails === null) return;
    const empty = toPrismaJson(jsonObjectSchema, {}, `Agent(${agentId}).guardrail.parameters`);
    const rows: Prisma.GuardrailCreateManyInput[] = [
      ...guardrails.prohibitedActions.map((description) => ({
        agentId,
        description,
        type: GuardrailType.PROHIBITED_ACTION,
        parameters: empty,
      })),
      ...guardrails.approvalRequirements.map((description) => ({
        agentId,
        description,
        type: GuardrailType.APPROVAL_REQUIREMENT,
        parameters: empty,
      })),
      ...guardrails.failClosedConditions.map((description) => ({
        agentId,
        description,
        type: GuardrailType.FAIL_CLOSED,
        parameters: empty,
      })),
      {
        agentId,
        description: 'Response requirements',
        type: GuardrailType.RESPONSE_REQUIREMENT,
        parameters: toPrismaJson(
          jsonObjectSchema,
          guardrails.responseRequirements,
          `Agent(${agentId}).responseRequirements`,
        ),
      },
    ];
    await transaction.guardrail.createMany({ data: rows });
  }

  private async assertAttachableInterpretation(
    transaction: Prisma.TransactionClient,
    interpretationId: string,
    specId: string,
    attachedInterpretationId: string | null = null,
    section?: SectionName,
    suppliedResolutions: ReadonlyArray<
      z.infer<typeof interpretationConfirmationSchema>['resolutions'][number]
    > = [],
    sectionValue?: SectionValue,
  ): Promise<void> {
    const interpretation = await transaction.specInterpretation.findFirst({
      where: { id: interpretationId, ...aggregateScopeWhere() },
      include: { attachedSpec: { select: { id: true } } },
    });
    if (!interpretation)
      throw new AppError(404, 'INTERPRETATION_NOT_FOUND', 'Interpretation was not found', {
        interpretationId,
      });
    if (interpretation.expiresAt <= new Date() && interpretation.attachedSpec === null) {
      throw new AppError(409, 'INTERPRETATION_EXPIRED', 'Interpretation has expired', {
        interpretationId,
      });
    }
    if (interpretation.attachedSpec !== null && interpretation.attachedSpec.id !== specId) {
      throw new AppError(
        409,
        'INTERPRETATION_ALREADY_ATTACHED',
        'Interpretation belongs to another specification',
        { interpretationId },
      );
    }
    if (attachedInterpretationId !== null && attachedInterpretationId !== interpretationId) {
      const tree = await transaction.specInterpretation.findMany({
        where: aggregateScopeWhere(),
        select: { id: true, parentInterpretationId: true },
      });
      const parentById = new Map(tree.map((node) => [node.id, node.parentInterpretationId]));
      const isDescendantOf = (candidateId: string, ancestorId: string): boolean => {
        let current: string | null = candidateId;
        const seen = new Set<string>();
        while (current !== null && !seen.has(current)) {
          if (current === ancestorId) return true;
          seen.add(current);
          current = parentById.get(current) ?? null;
        }
        return false;
      };
      if (!isDescendantOf(interpretationId, attachedInterpretationId)) {
        throw new AppError(
          409,
          'INTERPRETATION_LINEAGE_MISMATCH',
          'Interpretation must be the attached interpretation or one of its descendants',
          { specId, interpretationId, attachedInterpretationId },
        );
      }
    }
    if (section !== undefined) {
      const result = interpretSpecResponseSchema.parse(interpretation.result);
      if (result.kind !== 'prefill') {
        throw new AppError(
          409,
          'INTERPRETATION_NOT_CONFIRMABLE',
          'Split suggestions must be narrowed before confirming a section',
          { interpretationId },
        );
      }
      const unresolved = result.sections[section].unresolved;
      const requiredIds = unresolved.map(({ id }) => id).sort();
      const suppliedIds = [
        ...new Set(suppliedResolutions.map(({ unresolvedId }) => unresolvedId)),
      ].sort();
      if (
        requiredIds.length !== suppliedIds.length ||
        requiredIds.some((id, index) => id !== suppliedIds[index])
      ) {
        throw new AppError(
          422,
          'INTERPRETATION_UNRESOLVED',
          'Every unresolved item for this section must be explicitly resolved',
          {
            section,
            missingResolutionIds: requiredIds.filter((id) => !suppliedIds.includes(id)),
            unexpectedResolutionIds: suppliedIds.filter((id) => !requiredIds.includes(id)),
          },
        );
      }
      if (section === 'knowledge' && sectionValue !== undefined) {
        const canonicalKnowledge = knowledgeSectionSchema.parse(sectionValue);
        const descriptorIds = new Set(
          canonicalKnowledge.sources.map(({ descriptorId }) => descriptorId),
        );
        const invalidMappings = unresolved
          .filter(({ kind }) => kind === 'source')
          .filter((item) => {
            const resolution = suppliedResolutions.find(
              ({ unresolvedId }) => unresolvedId === item.id,
            );
            return (
              resolution === undefined ||
              (resolution.action !== 'remove' &&
                (resolution.action !== 'map_source' || !descriptorIds.has(resolution.descriptorId)))
            );
          })
          .map(({ id }) => id);
        if (invalidMappings.length > 0) {
          throw new AppError(
            422,
            'INTERPRETATION_UNRESOLVED',
            'Unknown sources must be mapped to descriptor IDs selected in canonical knowledge',
            { section, invalidResolutionIds: invalidMappings },
          );
        }
      }
      const invalidResolutionActions = unresolved
        .filter((item) => {
          const resolution = suppliedResolutions.find(
            ({ unresolvedId }) => unresolvedId === item.id,
          );
          if (resolution === undefined) return true;
          if (item.kind === 'source') {
            return resolution.action !== 'map_source' && resolution.action !== 'remove';
          }
          return resolution.action !== 'acknowledge';
        })
        .map(({ id }) => id);
      if (invalidResolutionActions.length > 0) {
        throw new AppError(
          422,
          'INTERPRETATION_UNRESOLVED',
          'Resolution actions must match the unresolved item type',
          { section, invalidResolutionIds: invalidResolutionActions },
        );
      }
      if (section === 'guardrails' && sectionValue !== undefined) {
        const canonicalGuardrails = guardrailsSectionSchema.parse(sectionValue);
        const invalidAuthority = result.authorityWarnings.some((warning) =>
          warning.disposition === 'approval_required'
            ? canonicalGuardrails.approvalRequirements.length === 0
            : !canonicalGuardrails.prohibitedActions.some((action) =>
                /production|authority|write|delete|release/i.test(action),
              ),
        );
        if (invalidAuthority) {
          throw new AppError(
            422,
            'INTERPRETATION_UNRESOLVED',
            'Authority warnings must remain represented in the confirmed guardrails',
            { section },
          );
        }
      }
    }
  }

  private async findSpec(specId: string): Promise<DatabaseAgentSpec> {
    const spec = await this.prisma.agentSpec.findFirst({
      where: { id: specId, agent: { family: aggregateScopeWhere() } },
    });
    if (!spec)
      throw new AppError(404, 'SPEC_NOT_FOUND', 'Agent specification was not found', { specId });
    return spec;
  }

  private assertWritable(spec: DatabaseAgentSpec): void {
    if (
      spec.status === DatabaseSpecStatus.GENERATING ||
      spec.status === DatabaseSpecStatus.GENERATED
    ) {
      throw new AppError(409, 'SPEC_LOCKED', 'Generated specifications cannot be edited', {
        specId: spec.id,
        status: spec.status.toLowerCase(),
      });
    }
  }
}
