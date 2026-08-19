import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import {
  interpretSpecRequestSchema,
  interpretSpecResponseSchema,
  type InterpretSpecRequest,
  type InterpretSpecResponse,
} from '@agent-builder/contracts';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { toPrismaJson } from '../json-boundary.js';
import { toSourceDescriptor } from '../mappers.js';
import { currentActorId } from '../request-context.js';
import { aggregateScope, aggregateScopeWhere } from '../scope.js';
import {
  HeuristicSpecInterpreter,
  type InterpretationDraft,
  type SpecInterpreter,
} from '../interpretation/heuristic.js';
import type { InterpretationApi } from './types.js';

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

const unresolvedId = (section: string, index: number, message: string): string =>
  hash(`${section}:${index}:${message}`).slice(0, 24);

function mapUnresolved(
  section: 'outcomes' | 'knowledge' | 'guardrails' | 'outputs',
  messages: readonly string[],
) {
  return messages.map((message, index) => ({
    id: unresolvedId(section, index, message),
    section,
    kind:
      section === 'knowledge'
        ? ('source' as const)
        : message.toLowerCase().includes('authority') || message.toLowerCase().includes('approval')
          ? ('authority' as const)
          : section === 'outcomes'
            ? ('scope' as const)
            : ('field' as const),
    input: message,
    message,
    descriptorCandidates: [],
  }));
}

function prefillResponse(
  interpretationId: string,
  parentInterpretationId: string | null,
  expiresAt: Date,
  draft: InterpretationDraft,
): InterpretSpecResponse {
  return interpretSpecResponseSchema.parse({
    kind: 'prefill',
    interpretationId,
    parentInterpretationId,
    expiresAt: expiresAt.toISOString(),
    sections: {
      outcomes: {
        ...draft.outcomes,
        unresolved: mapUnresolved('outcomes', draft.outcomes.unresolved),
      },
      knowledge: {
        ...draft.knowledge,
        unresolved: mapUnresolved('knowledge', draft.knowledge.unresolved),
      },
      guardrails: {
        ...draft.guardrails,
        unresolved: mapUnresolved('guardrails', draft.guardrails.unresolved),
      },
      outputs: { ...draft.outputs, unresolved: mapUnresolved('outputs', draft.outputs.unresolved) },
    },
    authorityWarnings: draft.authorityWarnings,
    reuseQuery: draft.reuseQuery,
  });
}

export class InterpretationService implements InterpretationApi {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ttlHours: number,
    private readonly interpreter: SpecInterpreter = new HeuristicSpecInterpreter(),
  ) {}

  async interpret(rawInput: InterpretSpecRequest): Promise<InterpretSpecResponse> {
    const input = interpretSpecRequestSchema.parse(rawInput);
    let prompt: string;
    let parentInterpretationId: string | null = null;
    if (input.kind === 'prompt') {
      prompt = input.prompt;
      if (input.specId !== undefined) {
        const target = await this.prisma.agentSpec.findFirst({
          where: { id: input.specId, agent: { family: aggregateScopeWhere() } },
          select: { interpretationId: true },
        });
        if (!target) {
          throw new AppError(404, 'SPEC_NOT_FOUND', 'Agent specification was not found', {
            specId: input.specId,
          });
        }
        parentInterpretationId = target.interpretationId;
      }
    } else {
      const parent = await this.prisma.specInterpretation.findFirst({
        where: { id: input.parentInterpretationId, ...aggregateScopeWhere() },
      });
      if (!parent)
        throw new AppError(404, 'INTERPRETATION_NOT_FOUND', 'Parent interpretation was not found', {
          interpretationId: input.parentInterpretationId,
        });
      if (parent.expiresAt <= new Date())
        throw new AppError(409, 'INTERPRETATION_EXPIRED', 'Parent interpretation has expired', {
          interpretationId: parent.id,
        });
      const parentResult = interpretSpecResponseSchema.parse(parent.result);
      if (parentResult.kind !== 'split_required')
        throw new AppError(
          409,
          'INTERPRETATION_NOT_SPLITTABLE',
          'Interpretation does not contain split candidates',
          { interpretationId: parent.id },
        );
      const candidate = parentResult.candidates.find((item) => item.id === input.candidateId);
      if (!candidate)
        throw new AppError(404, 'SPLIT_CANDIDATE_NOT_FOUND', 'Split candidate was not found', {
          interpretationId: parent.id,
          candidateId: input.candidateId,
        });
      prompt = `${candidate.trigger}. ${candidate.outcome}. ${candidate.purpose}`;
      parentInterpretationId = parent.id;
    }

    const sources = (
      await this.prisma.knowledgeSource.findMany({
        where: aggregateScopeWhere(),
        orderBy: { id: 'asc' },
      })
    ).map(toSourceDescriptor);
    let interpreted: Awaited<ReturnType<SpecInterpreter['interpret']>>;
    try {
      interpreted = await this.interpreter.interpret(prompt, sources);
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Specification interpretation is temporarily unavailable',
      );
    }
    const interpretationId = randomUUID();
    const expiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1000);
    let response: InterpretSpecResponse;
    if (interpreted.kind === 'split_required') {
      response = interpretSpecResponseSchema.parse({
        kind: 'split_required',
        interpretationId,
        parentInterpretationId,
        expiresAt: expiresAt.toISOString(),
        candidates: interpreted.candidates.map((candidate) => ({
          id: candidate.id,
          name: candidate.title,
          purpose: `Create a governed agent for this scope: ${candidate.prompt}`.slice(0, 3000),
          trigger: candidate.prompt.slice(0, 500),
          outcome: `Complete the ${candidate.title} workflow with governed evidence`.slice(0, 500),
        })),
      });
    } else {
      const draft = interpreted.draft!;
      if (input.specId !== undefined) {
        const spec = await this.prisma.agentSpec.findFirst({
          where: { id: input.specId, agent: { family: aggregateScopeWhere() } },
        });
        if (!spec)
          throw new AppError(404, 'SPEC_NOT_FOUND', 'Agent specification was not found', {
            specId: input.specId,
          });
        if (spec.status === 'GENERATING' || spec.status === 'GENERATED') {
          throw new AppError(
            409,
            'SPEC_LOCKED',
            'Generated specifications cannot be interpreted or overwritten',
            {
              specId: input.specId,
              status: spec.status.toLowerCase(),
            },
          );
        }
        const confirmed = [
          ['outcomes', spec.outcomes],
          ['knowledge', spec.knowledge],
          ['guardrails', spec.guardrails],
          ['outputs', spec.outputs],
        ] as const;
        for (const [section, value] of confirmed) {
          if (value === null) continue;
          const current = draft[section];
          current.value = null;
          current.needsReview = true;
          current.unresolved.push(
            `Existing confirmed ${section} was preserved and not overwritten.`,
          );
        }
      }
      response = prefillResponse(interpretationId, parentInterpretationId, expiresAt, draft);
    }

    const actorId = currentActorId();
    const scope = aggregateScope();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.specInterpretation.create({
        data: {
          ...scope,
          id: interpretationId,
          parentInterpretationId,
          prompt,
          promptHash: hash(prompt),
          result: toPrismaJson(
            interpretSpecResponseSchema,
            response,
            `SpecInterpretation(${interpretationId}).result`,
          ),
          createdBy: actorId,
          expiresAt,
        },
      });
      await appendAuditEvent(transaction, {
        action: 'spec_interpretation.created',
        entityType: 'SpecInterpretation',
        entityId: interpretationId,
        details: {
          parentInterpretationId,
          promptHash: hash(prompt),
          kind: response.kind,
          candidateCount: response.kind === 'split_required' ? response.candidates.length : 0,
        },
      });
    });
    return response;
  }

  async deleteExpiredUnattached(): Promise<number> {
    const now = new Date();
    const records = await this.prisma.specInterpretation.findMany({
      where: aggregateScopeWhere(),
      select: {
        id: true,
        parentInterpretationId: true,
        expiresAt: true,
        attachedSpec: { select: { id: true } },
        _count: { select: { confirmations: true } },
      },
    });
    const byId = new Map(records.map((record) => [record.id, record]));
    const protectedIds = new Set(
      records
        .filter(
          (record) =>
            record.expiresAt >= now ||
            record.attachedSpec !== null ||
            record._count.confirmations > 0,
        )
        .map((record) => record.id),
    );
    for (const protectedId of [...protectedIds]) {
      let parentId = byId.get(protectedId)?.parentInterpretationId ?? null;
      while (parentId !== null) {
        protectedIds.add(parentId);
        parentId = byId.get(parentId)?.parentInterpretationId ?? null;
      }
    }
    const depth = (recordId: string): number => {
      let value = 0;
      let parentId = byId.get(recordId)?.parentInterpretationId ?? null;
      while (parentId !== null) {
        value += 1;
        parentId = byId.get(parentId)?.parentInterpretationId ?? null;
      }
      return value;
    };
    const candidates = records
      .filter((record) => record.expiresAt < now && !protectedIds.has(record.id))
      .sort((left, right) => depth(right.id) - depth(left.id));
    let deleted = 0;
    for (const candidate of candidates) {
      const result = await this.prisma.specInterpretation.deleteMany({
        where: {
          id: candidate.id,
          ...aggregateScopeWhere(),
          attachedSpec: null,
          confirmations: { none: {} },
        },
      });
      deleted += result.count;
    }
    return deleted;
  }
}
