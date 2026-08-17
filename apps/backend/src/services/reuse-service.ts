import { createHash, randomUUID } from 'node:crypto';
import {
  BuilderDecisionAction as DatabaseDecisionAction,
  BuilderDraftKind as DatabaseDraftKind,
  BuilderDraftState as DatabaseDraftState,
  BuilderIntakeState as DatabaseIntakeState,
  CatalogIndexOperation as DatabaseIndexOperation,
  CatalogIndexOutboxState as DatabaseOutboxState,
  CatalogPublicationState as DatabasePublicationState,
  CatalogVisibility as DatabaseCatalogVisibility,
  DeploymentStatus as DatabaseDeploymentStatus,
  ExecutionRunState,
  Prisma,
  ResourceKind,
  type PrismaClient,
} from '@prisma/client';
import {
  buildCatalogIndexResource,
  builderDecisionSchema,
  builderDraftSchema,
  builderIntakeResultsSchema,
  builderIntakeSchema,
  capabilityFeatures,
  capabilityProfileSchema,
  catalogIndexResourceSchema,
  catalogPublicationListQuerySchema,
  catalogPublicationListResponseSchema,
  catalogPublicationSchema,
  configurationRevisionSchema,
  createBuilderDecisionRequestSchema,
  createBuilderIntakeRequestSchema,
  createDeploymentRequestSchema,
  deploymentSchema,
  embedWithProviderPolicy,
  idempotencyKeySchema,
  jsonObjectSchema,
  resourceLineageListResponseSchema,
  resourceLineageSchema,
  scoreCapabilityMatch,
  suggestSkillCompositions,
  trustChipSchema,
  type BuilderDecision,
  type BuilderDraft,
  type BuilderIntake,
  type BuilderIntakeResults,
  type CatalogPublication,
  type ConfigurationRevision,
  type Deployment,
  type EmbeddingProvider,
  type ProviderPolicy,
} from '@agent-builder/contracts';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { currentRequestPrincipal } from '../request-context.js';
import { aggregateScope, aggregateScopeWhere, isInPrincipalScope } from '../scope.js';
import { appendPlatformEvent } from './attention-service.js';

const stringArraySchema = z.array(z.string());
const finiteVectorSchema = z.array(z.number().finite()).min(8).max(4096);
const actionToDatabase = {
  use_as_is: DatabaseDecisionAction.USE_AS_IS,
  configure: DatabaseDecisionAction.CONFIGURE,
  extend: DatabaseDecisionAction.EXTEND,
  build_new: DatabaseDecisionAction.BUILD_NEW,
} as const;
const actionToWire = {
  [DatabaseDecisionAction.USE_AS_IS]: 'use_as_is',
  [DatabaseDecisionAction.CONFIGURE]: 'configure',
  [DatabaseDecisionAction.EXTEND]: 'extend',
  [DatabaseDecisionAction.BUILD_NEW]: 'build_new',
} as const;
const visibilityToWire = {
  [DatabaseCatalogVisibility.PRIVATE]: 'private',
  [DatabaseCatalogVisibility.DEPARTMENT]: 'department',
  [DatabaseCatalogVisibility.ORGANIZATION]: 'organization',
} as const;

type PublicationRecord = Prisma.CatalogPublicationGetPayload<{
  include: {
    resourceVersion: { include: { family: true } };
    release: true;
    capabilityProfile: true;
    department: true;
  };
}>;
type IntakeRecord = Prisma.BuilderIntakeGetPayload<Record<string, never>>;
type DecisionRecord = Prisma.BuilderDecisionGetPayload<Record<string, never>>;
type DraftRecord = Prisma.BuilderDraftGetPayload<Record<string, never>>;
type DeploymentRecord = Prisma.DeploymentGetPayload<{
  include: { decision: { include: { lineage: true } }; sourcePublication: true };
}>;
type ConfigurationRecord = Prisma.ConfigurationRevisionGetPayload<Record<string, never>>;

const publicationInclude = {
  resourceVersion: { include: { family: true } },
  release: true,
  capabilityProfile: true,
  department: true,
} as const;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function requireHumanActor(): string {
  const principal = currentRequestPrincipal();
  if (principal.authentication === 'system') {
    throw new AppError(403, 'HUMAN_DECISION_REQUIRED', 'Builder decisions require a human actor');
  }
  return principal.actorId;
}

function visiblePublicationWhere(): Prisma.CatalogPublicationWhereInput {
  const principal = currentRequestPrincipal();
  return {
    workspaceId: principal.workspaceId,
    OR: [
      { catalogVisibility: DatabaseCatalogVisibility.ORGANIZATION },
      ...(principal.departmentId === null
        ? []
        : [
            {
              catalogVisibility: DatabaseCatalogVisibility.DEPARTMENT,
              departmentId: principal.departmentId,
            } satisfies Prisma.CatalogPublicationWhereInput,
          ]),
      {
        catalogVisibility: DatabaseCatalogVisibility.PRIVATE,
        resourceVersion: { owner: principal.actorId },
      },
    ],
  };
}

function toPublication(record: PublicationRecord): CatalogPublication {
  if (record.trustChip === null || record.publishedAt === null) {
    throw new AppError(
      409,
      'CATALOG_PUBLICATION_NOT_ACTIVE',
      'Prepared catalog entries are not visible until their certified release is promoted',
    );
  }
  return catalogPublicationSchema.parse({
    id: record.id,
    revision: record.revision,
    subjectKind: record.subjectKind === ResourceKind.AGENT ? 'agent' : 'skill',
    resourceVersionId: record.resourceVersionId,
    releaseId: record.releaseId,
    releaseDigest: record.release.digest,
    name: record.resourceVersion.family.name,
    version: record.resourceVersion.version,
    owner: record.resourceVersion.owner,
    department: record.department?.name ?? 'Workspace',
    catalogVisibility: visibilityToWire[record.catalogVisibility],
    capabilityProfile: parseJson(
      capabilityProfileSchema,
      record.capabilityProfile.profile,
      'CapabilityProfile.profile',
    ),
    trustChip: parseJson(trustChipSchema, record.trustChip, 'CatalogPublication.trustChip'),
    publishedAt: record.publishedAt.toISOString(),
    retiredAt: record.retiredAt?.toISOString() ?? null,
  });
}

function toIntake(record: IntakeRecord): BuilderIntake {
  return builderIntakeSchema.parse({
    id: record.id,
    request: record.request,
    requestedBy: record.requestedBy,
    department: record.departmentLabel,
    state:
      record.state === DatabaseIntakeState.INTERPRETED
        ? 'interpreted'
        : record.state === DatabaseIntakeState.CONFIRMED
          ? 'confirmed'
          : 'decided',
    capabilityProfile: parseJson(
      capabilityProfileSchema,
      record.capabilityProfile,
      'BuilderIntake.capabilityProfile',
    ),
    confirmedAt: record.confirmedAt?.toISOString() ?? null,
    specificationId: null,
    createdAt: record.createdAt.toISOString(),
  });
}

function toDecision(record: DecisionRecord): BuilderDecision {
  return builderDecisionSchema.parse({
    id: record.id,
    intakeId: record.intakeId,
    action: actionToWire[record.action],
    selectedPublicationId: record.selectedPublicationId,
    buildNewReason: record.buildNewReason,
    demandObservationId: record.demandObservationId,
    highestReferredMatchScore: record.highestReferredMatchScore,
    decidedBy: record.decidedBy,
    decidedAt: record.decidedAt.toISOString(),
  });
}

function toDraft(record: DraftRecord): BuilderDraft {
  return builderDraftSchema.parse({
    id: record.id,
    intakeId: record.intakeId,
    decisionId: record.decisionId,
    draftKind:
      record.draftKind === DatabaseDraftKind.CONFIGURATION
        ? 'configuration'
        : record.draftKind === DatabaseDraftKind.EXTENSION
          ? 'extension'
          : 'new',
    basePublicationId: record.basePublicationId,
    capabilityProfile: parseJson(
      capabilityProfileSchema,
      record.capabilityProfile,
      'BuilderDraft.capabilityProfile',
    ),
    definition: record.definition,
    revision: record.revision,
    state:
      record.state === DatabaseDraftState.DRAFT
        ? 'draft'
        : record.state === DatabaseDraftState.READY
          ? 'ready'
          : record.state === DatabaseDraftState.MATERIALIZED
            ? 'materialized'
            : 'discarded',
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function toConfiguration(record: ConfigurationRecord): ConfigurationRevision {
  return configurationRevisionSchema.parse({
    id: record.id,
    deploymentId: record.deploymentId,
    revision: record.revision,
    previousRevisionId: record.previousRevisionId,
    configuration: record.configuration,
    digest: record.digest,
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
  });
}

function toDeployment(record: DeploymentRecord): Deployment {
  const action = actionToWire[record.decision.action];
  return deploymentSchema.parse({
    id: record.id,
    decisionId: record.decisionId,
    decisionAction: action,
    deployedResourceVersionId: record.deployedResourceVersionId,
    sourcePublicationId: record.sourcePublicationId,
    projectId: record.projectId,
    configurationRevisionId: record.currentConfigurationRevisionId,
    lineageIds: record.decision.lineage.map(({ id }) => id),
    status:
      record.status === DatabaseDeploymentStatus.ACTIVE
        ? 'active'
        : record.status === DatabaseDeploymentStatus.PENDING
          ? 'pending'
          : record.status === DatabaseDeploymentStatus.RETIRED
            ? 'retired'
            : 'failed',
    sourceRetiredAt: record.sourceRetiredAt?.toISOString() ?? null,
    retiredSourceWarning: record.sourceRetiredAt !== null,
    deployedBy: record.deployedBy,
    deployedAt: record.deployedAt.toISOString(),
  });
}

function compatibleComposition(
  publicationIds: readonly string[],
  records: Map<string, PublicationRecord>,
): boolean {
  const exactVersions = new Map<string, string>();
  for (const publicationId of publicationIds) {
    const record = records.get(publicationId);
    if (record === undefined) return false;
    const ownVersion = exactVersions.get(record.resourceVersion.familyId);
    if (ownVersion !== undefined && ownVersion !== record.resourceVersion.version) return false;
    exactVersions.set(record.resourceVersion.familyId, record.resourceVersion.version);
    const pins = parseJson(
      z.array(z.object({ familyId: z.string().uuid(), version: z.string() })),
      record.resourceVersion.dependencyPins,
      'ResourceVersion.dependencyPins',
    );
    for (const pin of pins) {
      const selected = exactVersions.get(pin.familyId);
      if (selected !== undefined && selected !== pin.version) return false;
      exactVersions.set(pin.familyId, pin.version);
    }
  }
  return true;
}

export class CatalogIndexService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly providerPolicy: ProviderPolicy,
    private readonly embeddingProvider?: EmbeddingProvider,
  ) {}

  async processPending(limit = 25): Promise<{ processed: number; failed: number }> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const ids = await this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "CatalogIndexOutbox"
        WHERE "attempts" < 100
          AND (
            (
              "state" IN ('pending'::"CatalogIndexOutboxState", 'failed'::"CatalogIndexOutboxState")
              AND "availableAt" <= NOW()
            )
            OR (
              "state" = 'processing'::"CatalogIndexOutboxState"
              AND "claimedAt" < NOW() - INTERVAL '5 minutes'
            )
          )
        ORDER BY "occurredAt", "id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${safeLimit}
      `;
      if (claimed.length > 0) {
        await transaction.catalogIndexOutbox.updateMany({
          where: { id: { in: claimed.map(({ id }) => id) } },
          data: {
            state: DatabaseOutboxState.PROCESSING,
            attempts: { increment: 1 },
            claimedAt: new Date(),
            lastError: null,
          },
        });
      }
      return claimed.map(({ id }) => id);
    });
    let failed = 0;
    for (const id of ids) {
      try {
        await this.processOne(id);
      } catch (error: unknown) {
        failed += 1;
        const message = error instanceof Error ? error.message.slice(0, 500) : 'Indexing failed';
        await this.prisma.catalogIndexOutbox.update({
          where: { id },
          data: {
            state: DatabaseOutboxState.FAILED,
            availableAt: new Date(Date.now() + 30_000),
            lastError: message,
          },
        });
      }
    }
    return { processed: ids.length - failed, failed };
  }

  private async processOne(id: string): Promise<void> {
    const event = await this.prisma.catalogIndexOutbox.findUnique({ where: { id } });
    if (event === null || event.state !== DatabaseOutboxState.PROCESSING) return;
    let resource = parseJson(
      catalogIndexResourceSchema,
      event.resource,
      'CatalogIndexOutbox.resource',
    );
    if (event.operation === DatabaseIndexOperation.UPSERT && this.embeddingProvider !== undefined) {
      const generatedAt = new Date().toISOString();
      const vector = await embedWithProviderPolicy(this.embeddingProvider, this.providerPolicy, {
        text: resource.canonicalText,
        featureKeys: resource.featureKeys,
      });
      resource = catalogIndexResourceSchema.parse({
        ...resource,
        embedding: [...vector],
        embeddingProvenance: {
          providerKind: this.embeddingProvider.kind,
          providerVersion: this.embeddingProvider.version,
          model: this.embeddingProvider.model,
          dimensions: this.embeddingProvider.dimensions,
          generatedAt,
        },
      });
    }
    await this.prisma.$transaction(async (transaction) => {
      const latest = await transaction.catalogIndexOutbox.findUnique({ where: { id } });
      if (latest === null || latest.state !== DatabaseOutboxState.PROCESSING) return;
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${resource.publicationId}))`;
      const indexed = await transaction.catalogIndexRecord.findUnique({
        where: { publicationId: resource.publicationId },
        select: { publicationRevision: true },
      });
      if (indexed === null || indexed.publicationRevision <= resource.publicationRevision) {
        await transaction.catalogIndexRecord.upsert({
          where: { publicationId: resource.publicationId },
          create: {
            publicationId: resource.publicationId,
            workspaceId: latest.workspaceId,
            departmentId: latest.departmentId,
            publicationRevision: resource.publicationRevision,
            subjectKind: resource.subjectKind === 'agent' ? ResourceKind.AGENT : ResourceKind.SKILL,
            resourceVersionId: resource.resourceVersionId,
            releaseDigest: resource.releaseDigest,
            catalogVisibility:
              resource.catalogVisibility === 'private'
                ? DatabaseCatalogVisibility.PRIVATE
                : resource.catalogVisibility === 'department'
                  ? DatabaseCatalogVisibility.DEPARTMENT
                  : DatabaseCatalogVisibility.ORGANIZATION,
            departmentLabel: resource.department,
            featureKeys: toPrismaJson(stringArraySchema, resource.featureKeys, 'featureKeys'),
            canonicalText: resource.canonicalText,
            embedding:
              resource.embedding === null
                ? Prisma.JsonNull
                : toPrismaJson(finiteVectorSchema, resource.embedding, 'embedding'),
            embeddingProvenance:
              resource.embeddingProvenance === null
                ? Prisma.JsonNull
                : (resource.embeddingProvenance as Prisma.InputJsonValue),
            retired: resource.retired,
            indexedAt: new Date(resource.indexedAt),
          },
          update: {
            publicationRevision: resource.publicationRevision,
            releaseDigest: resource.releaseDigest,
            catalogVisibility:
              resource.catalogVisibility === 'private'
                ? DatabaseCatalogVisibility.PRIVATE
                : resource.catalogVisibility === 'department'
                  ? DatabaseCatalogVisibility.DEPARTMENT
                  : DatabaseCatalogVisibility.ORGANIZATION,
            departmentLabel: resource.department,
            featureKeys: toPrismaJson(stringArraySchema, resource.featureKeys, 'featureKeys'),
            canonicalText: resource.canonicalText,
            embedding:
              resource.embedding === null
                ? Prisma.JsonNull
                : toPrismaJson(finiteVectorSchema, resource.embedding, 'embedding'),
            embeddingProvenance:
              resource.embeddingProvenance === null
                ? Prisma.JsonNull
                : (resource.embeddingProvenance as Prisma.InputJsonValue),
            retired: resource.retired,
            indexedAt: new Date(resource.indexedAt),
          },
        });
      }
      await transaction.catalogIndexOutbox.update({
        where: { id },
        data: { state: DatabaseOutboxState.PUBLISHED, publishedAt: new Date() },
      });
    });
  }
}

export class ReuseService {
  readonly indexer: CatalogIndexService;

  constructor(
    private readonly prisma: PrismaClient,
    providerPolicy: ProviderPolicy,
    private readonly embeddingProvider?: EmbeddingProvider,
  ) {
    this.indexer = new CatalogIndexService(prisma, providerPolicy, embeddingProvider);
    this.providerPolicy = providerPolicy;
  }

  private readonly providerPolicy: ProviderPolicy;

  async listPublications(rawQuery: unknown) {
    const query = catalogPublicationListQuerySchema.parse(rawQuery);
    const records = await this.prisma.catalogPublication.findMany({
      where: {
        ...visiblePublicationWhere(),
        state: query.includeRetired
          ? { in: [DatabasePublicationState.ACTIVE, DatabasePublicationState.RETIRED] }
          : DatabasePublicationState.ACTIVE,
        ...(query.subjectKind === undefined
          ? {}
          : {
              subjectKind: query.subjectKind === 'agent' ? ResourceKind.AGENT : ResourceKind.SKILL,
            }),
        ...(query.catalogVisibility === undefined
          ? {}
          : {
              catalogVisibility:
                query.catalogVisibility === 'private'
                  ? DatabaseCatalogVisibility.PRIVATE
                  : query.catalogVisibility === 'department'
                    ? DatabaseCatalogVisibility.DEPARTMENT
                    : DatabaseCatalogVisibility.ORGANIZATION,
            }),
      },
      include: publicationInclude,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
    });
    return catalogPublicationListResponseSchema.parse({ items: records.map(toPublication) });
  }

  async getPublication(publicationId: string): Promise<CatalogPublication> {
    const record = await this.prisma.catalogPublication.findFirst({
      where: {
        id: publicationId,
        ...visiblePublicationWhere(),
        state: { in: [DatabasePublicationState.ACTIVE, DatabasePublicationState.RETIRED] },
      },
      include: publicationInclude,
    });
    if (record === null) {
      throw new AppError(404, 'CATALOG_PUBLICATION_NOT_FOUND', 'Catalog publication was not found');
    }
    return toPublication(record);
  }

  async retirePublication(publicationId: string, rawInput: unknown): Promise<CatalogPublication> {
    const rationale = z
      .object({ rationale: z.string().trim().min(3).max(1000) })
      .strict()
      .parse(rawInput).rationale;
    const actor = requireHumanActor();
    const record = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "CatalogPublication" WHERE "id" = ${publicationId}::uuid FOR UPDATE`;
        const current = await transaction.catalogPublication.findFirst({
          where: { id: publicationId, ...visiblePublicationWhere() },
          include: publicationInclude,
        });
        if (current === null) {
          throw new AppError(
            404,
            'CATALOG_PUBLICATION_NOT_FOUND',
            'Catalog publication was not found',
          );
        }
        if (current.state !== DatabasePublicationState.ACTIVE) {
          throw new AppError(
            409,
            'CATALOG_PUBLICATION_NOT_ACTIVE',
            'Only an active publication can be retired',
          );
        }
        const now = new Date();
        const retired = await transaction.catalogPublication.update({
          where: { id: current.id },
          data: {
            state: DatabasePublicationState.RETIRED,
            revision: { increment: 1 },
            retiredAt: now,
            retiredBy: actor,
            retirementRationale: rationale,
          },
          include: publicationInclude,
        });
        await transaction.deployment.updateMany({
          where: { sourcePublicationId: current.id, status: DatabaseDeploymentStatus.ACTIVE },
          data: { sourceRetiredAt: now },
        });
        await enqueuePublication(transaction, retired, DatabaseIndexOperation.REMOVE, now);
        await appendAuditEvent(transaction, {
          action: 'catalog.publication.retired',
          entityType: 'CatalogPublication',
          entityId: current.id,
          details: { rationale },
        });
        await appendPlatformEvent(transaction, {
          kind: 'catalog.publication.retired',
          entityType: 'CatalogPublication',
          entityId: current.id,
          summary: { resourceVersionId: current.resourceVersionId },
        });
        return retired;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return toPublication(record);
  }

  async createIntake(rawInput: unknown): Promise<BuilderIntake> {
    const input = createBuilderIntakeRequestSchema.parse(rawInput);
    const actor = requireHumanActor();
    const record = await this.prisma.builderIntake.create({
      data: {
        ...aggregateScope(),
        request: input.request,
        requestedBy: actor,
        departmentLabel: input.department,
        state: input.confirmed ? DatabaseIntakeState.CONFIRMED : DatabaseIntakeState.INTERPRETED,
        capabilityProfile: toPrismaJson(
          capabilityProfileSchema,
          input.capabilityProfile,
          'BuilderIntake.capabilityProfile',
        ),
        confirmedAt: input.confirmed ? new Date() : null,
      },
    });
    return toIntake(record);
  }

  async getIntake(intakeId: string): Promise<BuilderIntake> {
    const record = await this.prisma.builderIntake.findFirst({
      where: { id: intakeId, ...aggregateScopeWhere() },
    });
    if (record === null)
      throw new AppError(404, 'BUILDER_INTAKE_NOT_FOUND', 'Builder intake was not found');
    return toIntake(record);
  }

  async referredChoices(intakeId: string): Promise<BuilderIntakeResults> {
    const intake = await this.prisma.builderIntake.findFirst({
      where: { id: intakeId, ...aggregateScopeWhere() },
    });
    if (intake === null)
      throw new AppError(404, 'BUILDER_INTAKE_NOT_FOUND', 'Builder intake was not found');
    const requested = parseJson(
      capabilityProfileSchema,
      intake.capabilityProfile,
      'BuilderIntake.capabilityProfile',
    );
    const indexRecords = await this.prisma.catalogIndexRecord.findMany({
      where: {
        retired: false,
        publication: { ...visiblePublicationWhere(), state: DatabasePublicationState.ACTIVE },
      },
      include: { publication: { include: publicationInclude } },
      take: 200,
    });
    let requestedEmbedding: readonly number[] | undefined;
    if (this.embeddingProvider !== undefined) {
      requestedEmbedding = await embedWithProviderPolicy(
        this.embeddingProvider,
        this.providerPolicy,
        {
          text: [intake.request, ...capabilityFeatures(requested).map(({ label }) => label)].join(
            '\n',
          ),
          featureKeys: capabilityFeatures(requested).map(({ key }) => key),
        },
      );
    }
    const publicationMap = new Map<string, PublicationRecord>();
    const scoredAgents = [];
    const skills: CatalogPublication[] = [];
    for (const index of indexRecords) {
      const record = index.publication;
      publicationMap.set(record.id, record);
      const publication = toPublication(record);
      if (publication.subjectKind === 'skill') {
        skills.push(publication);
        continue;
      }
      const offered = publication.capabilityProfile;
      const offeredEmbedding =
        index.embedding === null
          ? undefined
          : parseJson(finiteVectorSchema, index.embedding, 'CatalogIndexRecord.embedding');
      const scored =
        requestedEmbedding !== undefined &&
        offeredEmbedding !== undefined &&
        requestedEmbedding.length === offeredEmbedding.length
          ? scoreCapabilityMatch(requested, offered, {
              requested: requestedEmbedding,
              offered: offeredEmbedding,
            })
          : scoreCapabilityMatch(requested, offered);
      const [deployments, runs] = await Promise.all([
        this.prisma.deployment.groupBy({
          by: ['status'],
          where: { sourcePublicationId: publication.id },
          _count: { _all: true },
        }),
        this.prisma.executionRun.findMany({
          where: {
            entryResourceVersionId: publication.resourceVersionId,
            state: { in: [ExecutionRunState.SUCCEEDED, ExecutionRunState.FAILED] },
          },
          select: { state: true, actualCostUsd: true },
          take: 1000,
        }),
      ]);
      const totalDeployments = deployments.reduce((sum, row) => sum + row._count._all, 0);
      const activeDeployments =
        deployments.find(({ status }) => status === DatabaseDeploymentStatus.ACTIVE)?._count._all ??
        0;
      const successfulRuns = runs.filter(
        ({ state }) => state === ExecutionRunState.SUCCEEDED,
      ).length;
      const costs = runs.flatMap(({ actualCostUsd }) =>
        actualCostUsd === null ? [] : [actualCostUsd.toNumber()],
      );
      scoredAgents.push({
        publicationId: publication.id,
        subjectKind: 'agent' as const,
        name: publication.name,
        version: publication.version,
        trustChip: publication.trustChip,
        delta: scored.delta,
        match: scored.match,
        provenance: {
          owner: publication.owner,
          department: publication.department,
          resourceVersionId: publication.resourceVersionId,
          releaseId: publication.releaseId,
          releaseDigest: publication.releaseDigest,
          publishedAt: publication.publishedAt,
        },
        deployment: { total: totalDeployments, active: activeDeployments },
        success: {
          successfulRuns,
          measuredRuns: runs.length,
          rate: runs.length === 0 ? null : successfulRuns / runs.length,
        },
        cost: {
          usdPerRun:
            costs.length === 0 ? null : costs.reduce((sum, value) => sum + value, 0) / costs.length,
          basis: costs.length === 0 ? ('unavailable' as const) : ('observed' as const),
        },
        knownLimitations: scored.delta.lacks.slice(0, 30),
      });
    }
    const referredChoices = scoredAgents
      .sort(
        (left, right) =>
          right.match.score - left.match.score ||
          left.publicationId.localeCompare(right.publicationId),
      )
      .slice(0, 20);
    const compositionSuggestions = suggestSkillCompositions(requested, skills, {
      maxSuggestions: 5,
      maxSkills: 5,
    }).filter(({ skills: selected }) =>
      compatibleComposition(
        selected.map(({ publicationId }) => publicationId),
        publicationMap,
      ),
    );
    return builderIntakeResultsSchema.parse({
      intakeId,
      referredChoices,
      compositionSuggestions,
      generatedAt: new Date().toISOString(),
    });
  }

  async createDecision(
    intakeId: string,
    rawInput: unknown,
    rawIdempotencyKey: unknown,
  ): Promise<BuilderDecision> {
    const input = createBuilderDecisionRequestSchema.parse(rawInput);
    const idempotencyKey = idempotencyKeySchema.parse(rawIdempotencyKey);
    const actor = requireHumanActor();

    // Resolve a completed retry before consulting the mutable catalog. A publication can
    // legitimately be retired after the first request, but that must not make an otherwise
    // identical idempotent replay fail or create a second demand observation.
    const existingByKey = await this.prisma.builderDecision.findUnique({
      where: { idempotencyKey },
    });
    if (existingByKey !== null) {
      if (
        !isInPrincipalScope(existingByKey) ||
        existingByKey.intakeId !== intakeId ||
        existingByKey.action !== actionToDatabase[input.action] ||
        existingByKey.selectedPublicationId !== input.selectedPublicationId ||
        existingByKey.buildNewReason !== input.buildNewReason
      ) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'The idempotency key is already bound to another Builder decision',
        );
      }
      return toDecision(existingByKey);
    }
    const results = await this.referredChoices(intakeId);
    const highest = results.referredChoices[0]?.match.score ?? null;
    const choice =
      input.selectedPublicationId === null
        ? null
        : results.referredChoices.find(
            ({ publicationId }) => publicationId === input.selectedPublicationId,
          );
    if (input.action !== 'build_new' && choice === undefined) {
      throw new AppError(
        422,
        'REFERRED_CHOICE_UNAVAILABLE',
        'The selected publication is not an active referred choice for this intake',
      );
    }
    if (
      input.action === 'build_new' &&
      highest !== null &&
      highest > 80 &&
      input.buildNewReason === null
    ) {
      throw new AppError(
        422,
        'BUILD_NEW_REASON_REQUIRED',
        'Explain the unmet need before building new when a match exceeds 80%',
        { highestMatchScore: highest },
      );
    }
    const record = await this.prisma.$transaction(
      async (transaction) => {
        // Serialize both the retry key and the intake. READ COMMITTED then observes the
        // winner after either lock wait, making concurrent identical submissions replay
        // cleanly instead of surfacing a serialization failure.
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${idempotencyKey}))`;
        await transaction.$queryRaw`SELECT "id" FROM "BuilderIntake" WHERE "id" = ${intakeId}::uuid FOR UPDATE`;
        const existingByKey = await transaction.builderDecision.findUnique({
          where: { idempotencyKey },
        });
        if (existingByKey !== null) {
          if (
            !isInPrincipalScope(existingByKey) ||
            existingByKey.intakeId !== intakeId ||
            existingByKey.action !== actionToDatabase[input.action] ||
            existingByKey.selectedPublicationId !== input.selectedPublicationId ||
            existingByKey.buildNewReason !== input.buildNewReason
          ) {
            throw new AppError(
              409,
              'IDEMPOTENCY_KEY_REUSED',
              'The idempotency key is already bound to another Builder decision',
            );
          }
          return existingByKey;
        }
        const intake = await transaction.builderIntake.findFirst({
          where: { id: intakeId, ...aggregateScopeWhere() },
        });
        if (intake === null)
          throw new AppError(404, 'BUILDER_INTAKE_NOT_FOUND', 'Builder intake was not found');
        if (intake.state !== DatabaseIntakeState.CONFIRMED) {
          throw new AppError(
            409,
            intake.state === DatabaseIntakeState.DECIDED
              ? 'BUILDER_INTAKE_ALREADY_DECIDED'
              : 'BUILDER_INTAKE_NOT_CONFIRMED',
            'Only a confirmed, undecided intake can record a choice',
          );
        }
        const selected =
          input.selectedPublicationId === null
            ? null
            : await transaction.catalogPublication.findFirst({
                where: {
                  id: input.selectedPublicationId,
                  ...visiblePublicationWhere(),
                  state: DatabasePublicationState.ACTIVE,
                },
              });
        if (input.action !== 'build_new' && selected === null) {
          throw new AppError(
            409,
            'REFERRED_CHOICE_RETIRED',
            'The selected publication is no longer active',
          );
        }
        const decisionId = randomUUID();
        let demandObservationId: string | null = null;
        if (input.action === 'build_new' && input.buildNewReason !== null) {
          const observation = await transaction.observation.upsert({
            where: { signalKey: `builder-demand:${intakeId}` },
            update: {},
            create: {
              ...aggregateScope(),
              signalKey: `builder-demand:${intakeId}`,
              signalType: 'builder.reuse_bypassed',
              summary: input.buildNewReason,
              evidence: {
                intakeId,
                highestReferredMatchScore: highest,
                requestedCapabilitiesDigest: sha256(canonicalJson(intake.capabilityProfile)),
              },
              provenance: { source: 'builder_decision', decisionId },
              observedBy: actor,
            },
          });
          demandObservationId = observation.id;
        }
        const created = await transaction.builderDecision.create({
          data: {
            id: decisionId,
            ...aggregateScope(),
            intakeId,
            idempotencyKey,
            action: actionToDatabase[input.action],
            selectedPublicationId: input.selectedPublicationId,
            buildNewReason: input.buildNewReason,
            demandObservationId,
            highestReferredMatchScore: highest,
            decidedBy: actor,
          },
        });
        await transaction.builderIntake.update({
          where: { id: intakeId },
          data: { state: DatabaseIntakeState.DECIDED },
        });
        if (selected !== null && (input.action === 'use_as_is' || input.action === 'configure')) {
          const deploymentId = randomUUID();
          const revisionId = input.action === 'configure' ? randomUUID() : null;
          await transaction.deployment.create({
            data: {
              id: deploymentId,
              ...aggregateScope(),
              decisionId: created.id,
              deployedResourceVersionId: selected.resourceVersionId,
              sourcePublicationId: selected.id,
              projectId: 'default',
              currentConfigurationRevisionId: revisionId,
              status: DatabaseDeploymentStatus.ACTIVE,
              deployedBy: actor,
            },
          });
          if (revisionId !== null) {
            const emptyConfiguration = {};
            await transaction.configurationRevision.create({
              data: {
                id: revisionId,
                ...aggregateScope(),
                deploymentId,
                revision: 1,
                previousRevisionId: null,
                configuration: emptyConfiguration,
                digest: sha256(canonicalJson(emptyConfiguration)),
                createdBy: actor,
              },
            });
            await transaction.builderDraft.create({
              data: {
                ...aggregateScope(),
                intakeId,
                decisionId: created.id,
                draftKind: DatabaseDraftKind.CONFIGURATION,
                basePublicationId: selected.id,
                capabilityProfile: toPrismaJson(
                  capabilityProfileSchema,
                  intake.capabilityProfile,
                  'BuilderDraft.capabilityProfile',
                ),
                definition: toPrismaJson(
                  jsonObjectSchema,
                  emptyConfiguration,
                  'BuilderDraft.definition',
                ),
                createdBy: actor,
              },
            });
          }
        } else {
          await transaction.builderDraft.create({
            data: {
              ...aggregateScope(),
              intakeId,
              decisionId: created.id,
              draftKind:
                input.action === 'extend' ? DatabaseDraftKind.EXTENSION : DatabaseDraftKind.NEW,
              basePublicationId: selected?.id ?? null,
              capabilityProfile: toPrismaJson(
                capabilityProfileSchema,
                intake.capabilityProfile,
                'BuilderDraft.capabilityProfile',
              ),
              definition: toPrismaJson(jsonObjectSchema, {}, 'BuilderDraft.definition'),
              createdBy: actor,
            },
          });
        }
        await appendAuditEvent(transaction, {
          action: 'builder.decision.recorded',
          entityType: 'BuilderDecision',
          entityId: created.id,
          details: {
            intakeId,
            action: input.action,
            selectedPublicationId: input.selectedPublicationId,
            demandObservationId,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return toDecision(record);
  }

  async getDraft(draftId: string): Promise<BuilderDraft> {
    const record = await this.prisma.builderDraft.findFirst({
      where: { id: draftId, ...aggregateScopeWhere() },
    });
    if (record === null)
      throw new AppError(404, 'BUILDER_DRAFT_NOT_FOUND', 'Builder draft was not found');
    return toDraft(record);
  }

  async createDeployment(rawInput: unknown): Promise<Deployment> {
    const input = createDeploymentRequestSchema.parse(rawInput);
    const record = await this.prisma.deployment.findFirst({
      where: { decisionId: input.decisionId, ...aggregateScopeWhere() },
      include: { decision: { include: { lineage: true } }, sourcePublication: true },
    });
    if (record === null) {
      throw new AppError(
        409,
        'DEPLOYMENT_NOT_MATERIALIZED',
        'This decision requires its Builder draft to be materialized before deployment',
      );
    }
    if (record.projectId !== input.projectId) {
      throw new AppError(
        409,
        'DEPLOYMENT_PROJECT_IMMUTABLE',
        'A deployment cannot change projects',
      );
    }
    return toDeployment(record);
  }

  async getDeployment(deploymentId: string): Promise<Deployment> {
    const record = await this.prisma.deployment.findFirst({
      where: { id: deploymentId, ...aggregateScopeWhere() },
      include: { decision: { include: { lineage: true } }, sourcePublication: true },
    });
    if (record === null)
      throw new AppError(404, 'DEPLOYMENT_NOT_FOUND', 'Deployment was not found');
    return toDeployment(record);
  }

  async appendConfigurationRevision(
    deploymentId: string,
    configuration: Record<string, unknown>,
  ): Promise<ConfigurationRevision> {
    const actor = requireHumanActor();
    const record = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "Deployment" WHERE "id" = ${deploymentId}::uuid FOR UPDATE`;
        const deployment = await transaction.deployment.findFirst({
          where: { id: deploymentId, ...aggregateScopeWhere() },
          include: { decision: true },
        });
        if (deployment === null)
          throw new AppError(404, 'DEPLOYMENT_NOT_FOUND', 'Deployment was not found');
        if (deployment.decision.action !== DatabaseDecisionAction.CONFIGURE) {
          throw new AppError(
            409,
            'DEPLOYMENT_NOT_CONFIGURABLE',
            'Only configured reuse deployments accept overlays',
          );
        }
        const previous = await transaction.configurationRevision.findFirst({
          where: { deploymentId },
          orderBy: { revision: 'desc' },
        });
        const created = await transaction.configurationRevision.create({
          data: {
            ...aggregateScope(),
            deploymentId,
            revision: (previous?.revision ?? 0) + 1,
            previousRevisionId: previous?.id ?? null,
            configuration: toPrismaJson(
              jsonObjectSchema,
              configuration,
              'ConfigurationRevision.configuration',
            ),
            digest: sha256(canonicalJson(configuration)),
            createdBy: actor,
          },
        });
        await transaction.deployment.update({
          where: { id: deploymentId },
          data: { currentConfigurationRevisionId: created.id },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return toConfiguration(record);
  }

  async getLineage(resourceVersionId: string) {
    const records = await this.prisma.resourceLineage.findMany({
      where: {
        ...aggregateScopeWhere(),
        OR: [
          { childResourceVersionId: resourceVersionId },
          { parentResourceVersionId: resourceVersionId },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return resourceLineageListResponseSchema.parse({
      items: records.map((record) =>
        resourceLineageSchema.parse({
          id: record.id,
          childResourceVersionId: record.childResourceVersionId,
          parentResourceVersionId: record.parentResourceVersionId,
          relationship: record.relationship === 'FORKED_FROM' ? 'forked_from' : 'composed_of',
          ordinal: record.ordinal,
          decisionId: record.decisionId,
          createdBy: record.createdBy,
          createdAt: record.createdAt.toISOString(),
        }),
      ),
    });
  }
}

async function enqueuePublication(
  transaction: Prisma.TransactionClient,
  publication: PublicationRecord,
  operation: typeof DatabaseIndexOperation.UPSERT | typeof DatabaseIndexOperation.REMOVE,
  now: Date,
): Promise<void> {
  const wire = toPublication(publication);
  const resource = buildCatalogIndexResource(wire, now.toISOString(), null);
  await transaction.catalogIndexOutbox.upsert({
    where: {
      idempotencyKey: `catalog-index:${publication.id}:${publication.revision}:${operation === DatabaseIndexOperation.UPSERT ? 'upsert' : 'remove'}`,
    },
    create: {
      workspaceId: publication.workspaceId,
      departmentId: publication.departmentId,
      publicationId: publication.id,
      publicationRevision: publication.revision,
      idempotencyKey: `catalog-index:${publication.id}:${publication.revision}:${operation === DatabaseIndexOperation.UPSERT ? 'upsert' : 'remove'}`,
      operation,
      resource: toPrismaJson(catalogIndexResourceSchema, resource, 'CatalogIndexOutbox.resource'),
      occurredAt: now,
      availableAt: now,
    },
    update: {},
  });
}

export async function activateReleaseCatalogPublications(
  transaction: Prisma.TransactionClient,
  input: {
    releaseId: string;
    evaluationId: string;
    decisionId: string;
    previousReleaseId: string | null;
    actor: string;
    now: Date;
  },
): Promise<void> {
  let previous: PublicationRecord[] = [];
  if (input.previousReleaseId !== null) {
    previous = await transaction.catalogPublication.findMany({
      where: { releaseId: input.previousReleaseId, state: DatabasePublicationState.ACTIVE },
      include: publicationInclude,
    });
  }
  const prepared = await transaction.catalogPublication.findMany({
    where: {
      releaseId: input.releaseId,
      state: { in: [DatabasePublicationState.PREPARED, DatabasePublicationState.RETIRED] },
    },
    include: publicationInclude,
  });
  if (previous.length === 0 && prepared.length === 0) return;

  let trustChip: z.infer<typeof trustChipSchema> | null = null;
  if (prepared.length > 0) {
    const evaluation = await transaction.releaseEvaluation.findUnique({
      where: { id: input.evaluationId },
    });
    if (evaluation === null) {
      throw new AppError(404, 'RELEASE_EVALUATION_NOT_FOUND', 'Release evaluation was not found');
    }
    const evidence = parseJson(
      z
        .object({
          suiteCaseCount: z.number().int().nonnegative(),
          gateResults: z.array(
            z.object({ status: z.enum(['passed', 'failed', 'not_applicable']) }).passthrough(),
          ),
        })
        .passthrough(),
      evaluation.evidence,
      'ReleaseEvaluation.evidence',
    );
    const passedGates = evidence.gateResults.filter(({ status }) => status === 'passed').length;
    if (passedGates === 0) {
      throw new AppError(
        422,
        'CATALOG_TRUST_EVIDENCE_MISSING',
        'Catalog publication requires passing gate evidence',
      );
    }
    trustChip = trustChipSchema.parse({
      certificationState: 'certified',
      gatesPassed: passedGates,
      gatesTotal: passedGates,
      corpusSize: Math.max(1, evidence.suiteCaseCount),
      recertifiedAt: evaluation.finishedAt.toISOString(),
      label: `Certified · ${passedGates}/${passedGates} applicable gates · corpus ${Math.max(1, evidence.suiteCaseCount)} · re-certified ${evaluation.finishedAt.toISOString().slice(0, 10)}`,
    });
  }

  for (const publication of previous) {
    const retired = await transaction.catalogPublication.update({
      where: { id: publication.id },
      data: {
        state: DatabasePublicationState.RETIRED,
        revision: { increment: 1 },
        retiredAt: input.now,
        retiredBy: input.actor,
        retirementRationale: `Release pointer moved to ${input.releaseId}`,
      },
      include: publicationInclude,
    });
    await transaction.deployment.updateMany({
      where: { sourcePublicationId: publication.id, status: DatabaseDeploymentStatus.ACTIVE },
      data: { sourceRetiredAt: input.now },
    });
    await enqueuePublication(transaction, retired, DatabaseIndexOperation.REMOVE, input.now);
  }
  for (const publication of prepared) {
    if (trustChip === null) {
      throw new Error('Catalog activation trust evidence was not prepared');
    }
    const active = await transaction.catalogPublication.update({
      where: { id: publication.id },
      data: {
        state: DatabasePublicationState.ACTIVE,
        revision: { increment: 1 },
        activationEvaluationId: input.evaluationId,
        activationDecisionId: input.decisionId,
        trustChip: toPrismaJson(trustChipSchema, trustChip, 'CatalogPublication.trustChip'),
        publishedAt: input.now,
        retiredAt: null,
        retiredBy: null,
        retirementRationale: null,
      },
      include: publicationInclude,
    });
    await transaction.deployment.updateMany({
      where: { sourcePublicationId: publication.id, status: DatabaseDeploymentStatus.ACTIVE },
      data: { sourceRetiredAt: null },
    });
    await enqueuePublication(transaction, active, DatabaseIndexOperation.UPSERT, input.now);
  }
}
