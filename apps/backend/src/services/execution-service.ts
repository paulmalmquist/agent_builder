import { randomUUID } from 'node:crypto';
import {
  ApprovalRequestState,
  AutomationBackoff,
  AuthorityGrantState,
  ContextClassification,
  ExecutionRunState,
  ModelProviderKind,
  PluginEffect,
  PluginInstallationState,
  PluginResidency,
  Prisma,
  ResourceKind,
  type AuthorityGrant as DatabaseAuthorityGrant,
  type ExecutionRun as DatabaseExecutionRun,
  type PrismaClient,
} from '@prisma/client';
import {
  approveExecutionRunGroupResponseSchema,
  approveExecutionRunRequestSchema,
  agentResourceSpecSchema,
  authorityGrantListResponseSchema,
  authorityGrantSchema,
  createAuthorityGrantRequestSchema,
  createExecutionRunRequestSchema,
  contextProvenanceSummarySchema,
  dailyBriefInputSchema,
  dailyBriefOutputSchema,
  executionRunListResponseSchema,
  executionRunSchema,
  jsonObjectSchema,
  knowledgeSourceSpecSchema,
  metricListResponseSchema,
  metricSampleSchema,
  outcomeListResponseSchema,
  outcomeRecordSchema,
  pluginAuthorityScopeSchema,
  pluginCallInputPathSchema,
  pluginResourceSpecSchema,
  rejectExecutionRunGroupResponseSchema,
  rejectExecutionRunRequestSchema,
  resourceManifestSchema,
  runPluginRequirementSchema,
  skillSpecSchema,
  type AuthorityGrant,
  type ExecutionRun,
  type PluginAuthorityScope,
  type PlannedPluginCallRequest,
  type RunPluginRequirement,
  type executionRunStateSchema,
  type JsonValue,
  type requestedPluginAuthorityScopeSchema,
} from '@agent-builder/contracts';
import {
  collectModelStream,
  canonicalJson,
  invalidDailyBriefCitations,
  loadDailyBriefExecutionContext,
  providerContextValues,
  scoreDailyBriefQuality,
  summarizeExecutionContext,
  type AssembledContext,
  type ModelProvider,
} from '@paul-os/runtime';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { appendAuditEvent } from '../audit.js';
import { hasMinimumRole } from '../authorization.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { currentActorId, currentRequestPrincipal } from '../request-context.js';
import { aggregateScope, aggregateScopeWhere } from '../scope.js';
import { requireHumanActor } from './actors.js';
import { subjectFromResourceVersion } from './attention-subject.js';
import {
  appendExecutionRunEvent,
  appendPlatformEvent,
  recordDigestDeliveryForRun,
} from './attention-service.js';
import { executionApprovalInclude, groupExecutionApprovals } from './execution-approval-groups.js';
import {
  userFacingExecutionRunWhere,
  userFacingResourceVersionWhere,
} from './user-facing-records.js';

const providerKindMap = {
  deterministic: ModelProviderKind.DETERMINISTIC,
  anthropic: ModelProviderKind.ANTHROPIC,
  gateway: ModelProviderKind.GATEWAY,
} as const;
const providerKindWire = {
  [ModelProviderKind.DETERMINISTIC]: 'deterministic',
  [ModelProviderKind.ANTHROPIC]: 'anthropic',
  [ModelProviderKind.GATEWAY]: 'gateway',
} as const;
const runStateWire = {
  [ExecutionRunState.AWAITING_APPROVAL]: 'awaiting_approval',
  [ExecutionRunState.QUEUED]: 'queued',
  [ExecutionRunState.RUNNING]: 'running',
  [ExecutionRunState.SUCCEEDED]: 'succeeded',
  [ExecutionRunState.FAILED]: 'failed',
  [ExecutionRunState.CANCELLED]: 'cancelled',
  [ExecutionRunState.PAUSED_BUDGET]: 'paused_budget',
  [ExecutionRunState.PAUSED_PLUGIN]: 'paused_plugin',
} as const;
const grantStateWire = {
  [AuthorityGrantState.ACTIVE]: 'active',
  [AuthorityGrantState.REVOKED]: 'revoked',
  [AuthorityGrantState.EXHAUSTED]: 'exhausted',
  [AuthorityGrantState.EXPIRED]: 'expired',
} as const;
const contextClassificationMap = {
  public: ContextClassification.PUBLIC,
  internal: ContextClassification.INTERNAL,
  private: ContextClassification.PRIVATE,
  restricted: ContextClassification.RESTRICTED,
} as const;
const pluginEffectMap = {
  read: PluginEffect.READ,
  write: PluginEffect.WRITE,
  destructive: PluginEffect.DESTRUCTIVE,
} as const;
const pluginPlacementWire = {
  [PluginResidency.CONTROL_PLANE]: 'control_plane',
  [PluginResidency.WORKSTATION]: 'workstation',
} as const;
const retryBackoffMap = {
  fixed: AutomationBackoff.FIXED,
  exponential: AutomationBackoff.EXPONENTIAL,
} as const;
const retryBackoffWire = {
  [AutomationBackoff.FIXED]: 'fixed',
  [AutomationBackoff.EXPONENTIAL]: 'exponential',
} as const;

interface ExecutionMutationScope {
  workspaceId: string;
  departmentId: string | null;
}

function governedExecutionMutationScope(): ExecutionMutationScope {
  const principal = currentRequestPrincipal();
  if (principal.departmentId === null && !hasMinimumRole(principal, 'admin')) {
    throw new AppError(
      403,
      'AUTHORIZATION_REQUIRED',
      'Workspace-global execution authority requires the admin role',
      { requiredRole: 'admin' },
    );
  }
  return { workspaceId: principal.workspaceId, departmentId: principal.departmentId };
}

function executionDecisionLockKey(scope: ExecutionMutationScope, runId: string): string {
  return `${scope.workspaceId}:${scope.departmentId ?? 'workspace'}:execution-decision:${runId}`;
}

const SERIALIZABLE_TRANSACTION_ATTEMPTS = 3;

function isSerializableTransactionConflict(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      (error.code === 'P2010' &&
        (error.meta?.['code'] === '40001' || error.meta?.['code'] === '40P01')))
  ) {
    return true;
  }
  return (
    error instanceof Error && /could not serialize access|deadlock detected/i.test(error.message)
  );
}

async function retrySerializableTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (
        attempt >= SERIALIZABLE_TRANSACTION_ATTEMPTS ||
        !isSerializableTransactionConflict(error)
      ) {
        throw error;
      }
    }
  }
}
const contextClassificationWire = {
  [ContextClassification.PUBLIC]: 'public',
  [ContextClassification.INTERNAL]: 'internal',
  [ContextClassification.PRIVATE]: 'private',
  [ContextClassification.RESTRICTED]: 'restricted',
} as const;

type ReleaseForExecution = Prisma.ReleaseBundleGetPayload<{
  include: {
    resources: { include: { resourceVersion: { include: { family: true } } } };
  };
}>;

const stringArraySchema = z.array(z.string());
const pluginAuthorityScopesSchema = z.array(pluginAuthorityScopeSchema);
const runPluginRequirementsSchema = z.array(runPluginRequirementSchema);
// A run already pins this exact version. Joining the stable family identity in the originating
// query keeps the projection immutable without adding a mutable display-name column or N+1 reads.
const executionRunSubjectInclude = {
  entryResourceVersion: { include: { family: true } },
} satisfies Prisma.ExecutionRunInclude;
type SubjectBearingExecutionRun = Prisma.ExecutionRunGetPayload<{
  include: typeof executionRunSubjectInclude;
}>;
const authorityGrantSubjectInclude = {
  entryResourceVersion: { include: { family: true } },
} satisfies Prisma.AuthorityGrantInclude;
type SubjectBearingAuthorityGrant = Prisma.AuthorityGrantGetPayload<{
  include: typeof authorityGrantSubjectInclude;
}>;

function runScopesFromRecord(run: { requiredToolScopes: Prisma.JsonValue }): string[] {
  return parseJson(stringArraySchema, run.requiredToolScopes, 'ExecutionRun.requiredToolScopes');
}

function toGrant(
  record: DatabaseAuthorityGrant & {
    entryResourceVersion?: SubjectBearingAuthorityGrant['entryResourceVersion'];
  },
  effectiveState: AuthorityGrantState = record.state,
): AuthorityGrant {
  return authorityGrantSchema.parse({
    id: record.id,
    releaseId: record.releaseId,
    entryResourceVersionId: record.entryResourceVersionId,
    entrySubject: subjectFromResourceVersion(record.entryResourceVersion ?? null),
    releaseDigest: record.releaseDigest,
    contextDigest: record.contextDigest,
    projectId: record.projectId,
    inputConstraints: parseJson(
      jsonObjectSchema,
      record.inputConstraints,
      'AuthorityGrant.inputConstraints',
    ),
    toolScopes: parseJson(stringArraySchema, record.toolScopes, 'AuthorityGrant.toolScopes'),
    pluginScopes: parseJson(
      pluginAuthorityScopesSchema,
      record.pluginScopes,
      'AuthorityGrant.pluginScopes',
    ),
    validFrom: record.validFrom.toISOString(),
    validUntil: record.validUntil.toISOString(),
    maxRuns: record.maxRuns,
    usedRuns: record.usedRuns,
    maxEstimatedCostPerRunUsd: Number(record.maxEstimatedCostPerRunUsd),
    totalCostBudgetUsd: Number(record.totalCostBudgetUsd),
    spentCostUsd: Number(record.spentCostUsd),
    reservedCostUsd: Number(record.reservedCostUsd),
    state: grantStateWire[effectiveState],
    actorId: record.actorId,
    rationale: record.rationale,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  });
}

function toRun(record: SubjectBearingExecutionRun): ExecutionRun {
  return executionRunSchema.parse({
    id: record.id,
    releaseId: record.releaseId,
    entryResourceVersionId: record.entryResourceVersionId,
    entrySubject: subjectFromResourceVersion(record.entryResourceVersion ?? null),
    legacyEntrypointUnresolved: record.legacyEntrypointUnresolved,
    releaseDigest: record.releaseDigest,
    contextDigest: record.contextDigest,
    contextProvenance: parseJson(
      contextProvenanceSummarySchema,
      record.contextProvenance,
      'ExecutionRun.contextProvenance',
    ),
    contextClassification: contextClassificationWire[record.contextClassification],
    contextEstimatedTokens: record.contextEstimatedTokens,
    projectId: record.projectId,
    requiredToolScopes: parseJson(
      stringArraySchema,
      record.requiredToolScopes,
      'ExecutionRun.requiredToolScopes',
    ),
    requiredPluginScopes: parseJson(
      runPluginRequirementsSchema,
      record.requiredPluginScopes,
      'ExecutionRun.requiredPluginScopes',
    ),
    requiresPluginApproval: record.requiresPluginApproval,
    authorityGrantId: record.authorityGrantId,
    digestSnapshotId: record.digestSnapshotId,
    state: runStateWire[record.state],
    input: parseJson(jsonObjectSchema, record.input, 'ExecutionRun.input'),
    providerKind: providerKindWire[record.providerKind],
    developmentDraft: record.developmentDraft,
    providerVersion: record.providerVersion,
    model: record.model,
    maxInputTokens: record.maxInputTokens,
    maxOutputTokens: record.maxOutputTokens,
    maxEstimatedCostUsd: Number(record.maxEstimatedCostUsd),
    estimatedUpperCostUsd: Number(record.estimatedUpperCostUsd),
    actualCostUsd: record.actualCostUsd === null ? null : Number(record.actualCostUsd),
    pricingVersion: record.pricingVersion,
    approvalReasons: parseJson(
      stringArraySchema,
      record.approvalReasons,
      'ExecutionRun.approvalReasons',
    ),
    progress: record.progress,
    message: record.message,
    attempts: record.attempts,
    maxAttempts: record.maxAttempts,
    retryBackoff: retryBackoffWire[record.retryBackoff],
    error:
      record.error === null
        ? null
        : parseJson(jsonObjectSchema, record.error, 'ExecutionRun.error'),
    requestedBy: record.requestedBy,
    startedAt: record.startedAt?.toISOString() ?? null,
    finishedAt: record.finishedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function satisfiesConstraints(
  input: Record<string, JsonValue>,
  constraints: Record<string, JsonValue>,
): boolean {
  return Object.entries(constraints).every(([key, expected]) => {
    const actual = input[key];
    if (Array.isArray(expected))
      return expected.some((value) => JSON.stringify(value) === JSON.stringify(actual));
    if (expected !== null && typeof expected === 'object') {
      return actual !== null && !Array.isArray(actual) && typeof actual === 'object'
        ? satisfiesConstraints(actual, expected)
        : false;
    }
    return actual === expected;
  });
}

function pluginInputAtPath(
  input: Record<string, JsonValue>,
  pathInput: PlannedPluginCallRequest['inputPath'],
): JsonValue {
  const path = pluginCallInputPathSchema.parse(pathInput);
  let current: JsonValue = input;
  for (const segment of path) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment >= current.length) {
        throw new AppError(
          422,
          'PLUGIN_PLAN_INPUT_PATH_INVALID',
          'A Plugin call input path does not resolve inside the run input',
        );
      }
      const next: JsonValue | undefined = current[segment];
      if (next === undefined) {
        throw new AppError(
          422,
          'PLUGIN_PLAN_INPUT_PATH_INVALID',
          'A Plugin call input path does not resolve inside the run input',
        );
      }
      current = next;
      continue;
    }
    if (
      current === null ||
      Array.isArray(current) ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      throw new AppError(
        422,
        'PLUGIN_PLAN_INPUT_PATH_INVALID',
        'A Plugin call input path does not resolve inside the run input',
      );
    }
    const next: JsonValue | undefined = current[segment];
    if (next === undefined) {
      throw new AppError(
        422,
        'PLUGIN_PLAN_INPUT_PATH_INVALID',
        'A Plugin call input path does not resolve inside the run input',
      );
    }
    current = next;
  }
  return current;
}

function pluginRequirementKey(input: {
  installationId: string;
  pluginVersionId: string;
  tool: string;
}): string {
  return `${input.installationId}:${input.pluginVersionId}:${input.tool}`;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

export interface ExecutionWorkerApi {
  recoverExpiredLeases(): Promise<number>;
  queuedRunIds(limit?: number): Promise<string[]>;
  claim(runId: string, workerId: string, leaseMs?: number): Promise<boolean>;
  heartbeat(runId: string, workerId: string, leaseMs?: number): Promise<boolean>;
  executeClaimed(runId: string, workerId: string): Promise<void>;
  failClaimed(runId: string, workerId: string, code: string): Promise<void>;
}

export class ExecutionService implements ExecutionWorkerApi {
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
    private readonly provider: ModelProvider,
  ) {}

  /**
   * All human authority decisions and cancellation take the same per-run locks before reading
   * mutable state. The advisory lock gives tests and non-row decision paths one stable ordering
   * primitive; the row locks make the ordering durable at the database boundary.
   */
  private async lockExecutionDecisions(
    transaction: Prisma.TransactionClient,
    runIds: string[],
    scope: ExecutionMutationScope,
  ): Promise<void> {
    const orderedRunIds = [...new Set(runIds)].sort();
    if (orderedRunIds.length === 0) return;
    for (const runId of orderedRunIds) {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${executionDecisionLockKey(
        scope,
        runId,
      )}))`;
    }
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id"
        FROM "ExecutionRun"
        WHERE "id" IN (${Prisma.join(orderedRunIds.map((id) => Prisma.sql`${id}::uuid`))})
          AND "workspaceId" = ${scope.workspaceId}::uuid
          AND "departmentId" IS NOT DISTINCT FROM ${scope.departmentId}::uuid
        ORDER BY "id"
        FOR UPDATE`,
    );
    await transaction.$queryRaw(
      Prisma.sql`SELECT approval."id"
        FROM "ApprovalRequest" approval
        JOIN "ExecutionRun" run ON run."id" = approval."runId"
        WHERE approval."runId" IN (${Prisma.join(
          orderedRunIds.map((id) => Prisma.sql`${id}::uuid`),
        )})
          AND run."workspaceId" = ${scope.workspaceId}::uuid
          AND run."departmentId" IS NOT DISTINCT FROM ${scope.departmentId}::uuid
        ORDER BY approval."id"
        FOR UPDATE OF approval`,
    );
  }

  private async executionContext(): Promise<AssembledContext> {
    try {
      return await loadDailyBriefExecutionContext(this.config.profilePath);
    } catch {
      throw new AppError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'Private execution context could not be loaded or validated',
      );
    }
  }

  private estimateUpperCost(maxInputTokens: number, maxOutputTokens: number): number {
    return (
      (maxInputTokens * this.config.model.inputUsdPerMillionTokens +
        maxOutputTokens * this.config.model.outputUsdPerMillionTokens) /
      1_000_000
    );
  }

  private async release(releaseId: string): Promise<ReleaseForExecution> {
    const release = await this.prisma.releaseBundle.findFirst({
      where: { id: releaseId, ...aggregateScopeWhere() },
      include: {
        resources: { include: { resourceVersion: { include: { family: true } } } },
      },
    });
    if (release === null) throw new AppError(404, 'RELEASE_NOT_FOUND', 'Release was not found');
    return release;
  }

  private async entryRequirements(
    release: ReleaseForExecution,
    entryResourceVersionId: string,
    transaction: PrismaClient | Prisma.TransactionClient = this.prisma,
  ): Promise<{
    requiredTools: string[];
    requiredPlugins: Array<{ familyId: string; version: string; tool: string }>;
    reachableVersionIds: Set<string>;
    isDailyBrief: boolean;
  }> {
    const releasedVersions = new Map(
      release.resources.map(({ resourceVersion }) => [resourceVersion.id, resourceVersion]),
    );
    if (!releasedVersions.has(entryResourceVersionId)) {
      throw new AppError(
        422,
        'ENTRYPOINT_RELEASE_MISMATCH',
        'The exact entry resource is not part of this release',
      );
    }
    const ids = [...releasedVersions.keys()];
    const pins = await transaction.resourceDependencyPin.findMany({
      where: { sourceVersionId: { in: ids } },
      select: { sourceVersionId: true, targetVersionId: true },
    });
    const outgoing = new Map<string, string[]>();
    for (const pin of pins) {
      if (!releasedVersions.has(pin.targetVersionId)) {
        throw new AppError(
          409,
          'RELEASE_DEPENDENCY_MISSING',
          'The release no longer contains an exact dependency of its entrypoint',
        );
      }
      const targets = outgoing.get(pin.sourceVersionId) ?? [];
      targets.push(pin.targetVersionId);
      outgoing.set(pin.sourceVersionId, targets);
    }
    const reachableVersionIds = new Set<string>();
    const pending = [entryResourceVersionId];
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined || reachableVersionIds.has(current)) continue;
      reachableVersionIds.add(current);
      pending.push(...(outgoing.get(current) ?? []));
    }

    const requiredTools = new Set<string>();
    const requiredPlugins = new Map<string, { familyId: string; version: string; tool: string }>();
    let isDailyBrief = false;
    for (const id of reachableVersionIds) {
      const resource = releasedVersions.get(id);
      if (resource === undefined) continue;
      const manifest = parseJson(
        resourceManifestSchema,
        resource.definition,
        'ResourceVersion.definition',
      );
      if (manifest.metadata.slug === 'daily-brief') isDailyBrief = true;
      if (manifest.kind === 'Skill' || manifest.kind === 'Agent') {
        const tools =
          manifest.kind === 'Skill'
            ? skillSpecSchema.parse(manifest.spec).tools
            : agentResourceSpecSchema.parse(manifest.spec).tools;
        for (const tool of tools) {
          if (typeof tool === 'string') {
            requiredTools.add(tool);
          } else {
            const key = `${tool.plugin.familyId}:${tool.plugin.version}:${tool.tool}`;
            requiredPlugins.set(key, {
              familyId: tool.plugin.familyId,
              version: tool.plugin.version,
              tool: tool.tool,
            });
          }
        }
      } else if (manifest.kind === 'KnowledgeSource') {
        const spec = knowledgeSourceSpecSchema.parse(manifest.spec);
        if ('plugin' in spec) {
          const key = `${spec.plugin.familyId}:${spec.plugin.version}:${spec.capability}`;
          requiredPlugins.set(key, {
            familyId: spec.plugin.familyId,
            version: spec.plugin.version,
            tool: spec.capability,
          });
        }
      }
    }
    return {
      requiredTools: [...requiredTools],
      requiredPlugins: [...requiredPlugins.values()],
      reachableVersionIds,
      isDailyBrief,
    };
  }

  private assertNarrowedPluginLimits(
    requested: Record<string, number | undefined>,
    declared: Record<string, number | undefined>,
  ): void {
    for (const [key, requestedValue] of Object.entries(requested)) {
      const declaredValue = declared[key];
      if (
        requestedValue !== undefined &&
        (declaredValue === undefined || requestedValue > declaredValue)
      ) {
        throw new AppError(
          422,
          'PLUGIN_SCOPE_BROADENED',
          'A Plugin authority scope may narrow declared limits but cannot broaden them',
        );
      }
    }
  }

  private async materializePluginScopes(
    release: ReleaseForExecution,
    entryResourceVersionId: string,
    requestedScopes: z.infer<typeof requestedPluginAuthorityScopeSchema>[],
    transaction: PrismaClient | Prisma.TransactionClient = this.prisma,
  ): Promise<PluginAuthorityScope[]> {
    const requirements = await this.entryRequirements(release, entryResourceVersionId, transaction);
    const releasedVersions = release.resources.map(({ resourceVersion }) => resourceVersion);
    const seen = new Set<string>();
    const scopes: PluginAuthorityScope[] = [];
    for (const requested of requestedScopes) {
      const key = `${requested.installationId}:${requested.pluginVersionId}:${requested.tool}`;
      if (seen.has(key)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Plugin authority scopes must be unique');
      }
      seen.add(key);
      const installation = await transaction.pluginInstallation.findFirst({
        where: {
          id: requested.installationId,
          pluginVersionId: requested.pluginVersionId,
          state: PluginInstallationState.ENABLED,
          ...aggregateScopeWhere(),
        },
        include: { pluginVersion: { include: { family: true } } },
      });
      if (installation === null) {
        throw new AppError(
          422,
          'PLUGIN_INSTALLATION_UNAVAILABLE',
          'The exact enabled Plugin installation is unavailable',
        );
      }
      if (installation.residency !== PluginResidency.CONTROL_PLANE) {
        throw new AppError(
          422,
          'WORKSTATION_PLUGIN_UNAVAILABLE',
          'Workstation Plugin execution is not available in this checkpoint',
        );
      }
      if (
        !requirements.reachableVersionIds.has(installation.pluginVersionId) ||
        !releasedVersions.some(
          (resource) =>
            resource.id === installation.pluginVersionId &&
            resource.family.kind === ResourceKind.PLUGIN,
        )
      ) {
        throw new AppError(
          422,
          'PLUGIN_OUTSIDE_ENTRYPOINT_CLOSURE',
          'Plugin authority is limited to the entrypoint dependency closure',
        );
      }
      if (installation.pluginDigest !== installation.pluginVersion.digest) {
        throw new AppError(
          409,
          'PLUGIN_DIGEST_MISMATCH',
          'The installed Plugin digest no longer matches its exact resource version',
        );
      }
      const manifest = parseJson(
        resourceManifestSchema,
        installation.pluginVersion.definition,
        'ResourceVersion.definition',
      );
      if (manifest.kind !== 'Plugin') {
        throw new AppError(409, 'PLUGIN_DEFINITION_INVALID', 'The exact resource is not a Plugin');
      }
      const spec = pluginResourceSpecSchema.parse(manifest.spec);
      const capability = spec.capabilities.find(({ tool }) => tool === requested.tool);
      if (capability === undefined) {
        throw new AppError(
          422,
          'PLUGIN_CAPABILITY_UNKNOWN',
          'The requested capability is not declared by the exact Plugin version',
        );
      }
      this.assertNarrowedPluginLimits(requested.limits, capability.limits);
      scopes.push(
        pluginAuthorityScopeSchema.parse({
          ...requested,
          pluginDigest: installation.pluginDigest,
          effect: capability.effect,
          scopeDescription: capability.scopeDescription,
        }),
      );
    }
    return scopes;
  }

  private async deriveRunPluginRequirements(
    release: ReleaseForExecution,
    entryResourceVersionId: string,
    transaction: PrismaClient | Prisma.TransactionClient = this.prisma,
  ): Promise<{ items: RunPluginRequirement[]; unavailableReasons: string[] }> {
    const entry = await this.entryRequirements(release, entryResourceVersionId, transaction);
    const result: RunPluginRequirement[] = [];
    const unavailableReasons: string[] = [];
    for (const required of entry.requiredPlugins) {
      const pluginVersion = release.resources
        .map(({ resourceVersion }) => resourceVersion)
        .find(
          (resource) =>
            resource.familyId === required.familyId &&
            resource.version === required.version &&
            resource.family.kind === ResourceKind.PLUGIN &&
            entry.reachableVersionIds.has(resource.id),
        );
      if (pluginVersion === undefined) {
        throw new AppError(
          409,
          'RELEASE_DEPENDENCY_MISSING',
          'The entrypoint omits an exact Plugin dependency',
        );
      }
      const candidates = await transaction.pluginInstallation.findMany({
        where: {
          pluginVersionId: pluginVersion.id,
          state: { not: PluginInstallationState.UNINSTALLED },
          ...aggregateScopeWhere(),
        },
        orderBy: { installedAt: 'desc' },
      });
      const principalDepartment = aggregateScope().departmentId;
      const installation =
        candidates.find(({ departmentId }) => departmentId === principalDepartment) ??
        candidates.find(({ departmentId }) => departmentId === null);
      if (installation === undefined) {
        throw new AppError(
          422,
          'PLUGIN_INSTALLATION_REQUIRED',
          'The entrypoint requires an exact Plugin that is not installed',
        );
      }
      const manifest = parseJson(
        resourceManifestSchema,
        pluginVersion.definition,
        'ResourceVersion.definition',
      );
      if (manifest.kind !== 'Plugin') {
        throw new AppError(409, 'PLUGIN_DEFINITION_INVALID', 'The dependency is not a Plugin');
      }
      const capability = pluginResourceSpecSchema
        .parse(manifest.spec)
        .capabilities.find(({ tool }) => tool === required.tool);
      if (capability === undefined) {
        throw new AppError(
          422,
          'PLUGIN_CAPABILITY_UNKNOWN',
          'The entrypoint requires a capability absent from its exact Plugin dependency',
        );
      }
      // Requirements snapshot the Plugin declaration's maximum authority. A grant is allowed to
      // narrow this ceiling, and the worker executes with that narrower grant scope. Persisting
      // the grant here would erase the independent maximum and make broadening undetectable.
      const base = pluginAuthorityScopeSchema.parse({
        installationId: installation.id,
        pluginVersionId: pluginVersion.id,
        pluginDigest: pluginVersion.digest,
        tool: required.tool,
        effect: capability.effect,
        limits: capability.limits,
        scopeDescription: capability.scopeDescription,
      });
      result.push(
        runPluginRequirementSchema.parse({
          ...base,
          executionPlacement: pluginPlacementWire[installation.residency],
          approvalRequired:
            capability.approval === 'approval_required' || capability.effect !== 'read',
        }),
      );
      if (
        installation.state !== PluginInstallationState.ENABLED ||
        installation.residency !== PluginResidency.CONTROL_PLANE
      ) {
        unavailableReasons.push(
          installation.residency !== PluginResidency.CONTROL_PLANE
            ? `Required Plugin capability ${required.tool} needs workstation execution, which is unavailable`
            : `Required Plugin capability ${required.tool} is ${installation.state.toLowerCase()}`,
        );
      }
    }
    return { items: result, unavailableReasons };
  }

  private materializePluginCallPlans(
    calls: PlannedPluginCallRequest[],
    requirements: RunPluginRequirement[],
    runInput: Record<string, JsonValue>,
  ): {
    calls: Array<PlannedPluginCallRequest & { requirementKey: string }>;
    estimatedUpperCostUsd: number;
  } {
    const requirementsByKey = new Map(
      requirements.map((requirement) => [pluginRequirementKey(requirement), requirement]),
    );
    const counts = new Map<string, number>();
    let estimatedUpperCostUsd = 0;
    const materialized = calls.map((call) => {
      const requirementKey = pluginRequirementKey(call);
      const requirement = requirementsByKey.get(requirementKey);
      if (requirement === undefined) {
        throw new AppError(
          422,
          'PLUGIN_PLAN_REQUIREMENT_MISMATCH',
          'A Plugin call plan must reference an exact requirement of this run entrypoint',
        );
      }
      pluginInputAtPath(runInput, call.inputPath);
      const nextCount = (counts.get(requirementKey) ?? 0) + 1;
      if (nextCount > requirement.limits.maxInvocationsPerRun) {
        throw new AppError(
          422,
          'PLUGIN_INVOCATION_LIMIT_EXCEEDED',
          'A Plugin call plan exceeds the exact capability invocation limit',
        );
      }
      counts.set(requirementKey, nextCount);
      estimatedUpperCostUsd += requirement.limits.maxEstimatedCostUsd ?? 0;
      return { ...call, requirementKey };
    });
    return { calls: materialized, estimatedUpperCostUsd };
  }

  private grantBlockers(
    grant: DatabaseAuthorityGrant | null,
    release: ReleaseForExecution,
    entryResourceVersionId: string,
    contextDigest: string,
    input: Record<string, JsonValue>,
    requiredTools: string[],
    requiredPluginScopes: RunPluginRequirement[],
    estimatedUpperCostUsd: number,
    perRunPluginApproved: boolean,
  ): string[] {
    if (grant === null) return ['No authority grant is bound to this release'];
    const blockers: string[] = [];
    const now = Date.now();
    if (grant.state !== AuthorityGrantState.ACTIVE)
      blockers.push(`Authority grant is ${grantStateWire[grant.state]}`);
    if (grant.releaseId !== release.id || grant.releaseDigest !== release.digest)
      blockers.push('Authority grant release digest does not match');
    if (grant.entryResourceVersionId !== entryResourceVersionId)
      blockers.push('Authority grant entry resource does not match');
    if (grant.workspaceId !== release.workspaceId || grant.departmentId !== release.departmentId)
      blockers.push('Authority grant release scope does not match');
    if (grant.contextDigest !== contextDigest)
      blockers.push('Authority grant execution context does not match');
    if (grant.projectId !== release.projectId)
      blockers.push('Authority grant project does not match');
    if (grant.validFrom.getTime() > now || grant.validUntil.getTime() <= now)
      blockers.push('Authority grant is outside its validity window');
    if (grant.usedRuns >= grant.maxRuns) blockers.push('Authority grant run budget is exhausted');
    if (estimatedUpperCostUsd > Number(grant.maxEstimatedCostPerRunUsd))
      blockers.push('Run exceeds the authority per-run cost ceiling');
    if (
      Number(grant.spentCostUsd) + Number(grant.reservedCostUsd) + estimatedUpperCostUsd >
      Number(grant.totalCostBudgetUsd)
    )
      blockers.push('Run exceeds the authority total cost budget');
    const constraints = parseJson(
      jsonObjectSchema,
      grant.inputConstraints,
      'AuthorityGrant.inputConstraints',
    );
    if (!satisfiesConstraints(input, constraints))
      blockers.push('Run input is outside the authority constraints');
    const scopes = new Set(
      parseJson(stringArraySchema, grant.toolScopes, 'AuthorityGrant.toolScopes'),
    );
    if (requiredTools.some((tool) => !scopes.has(tool)))
      blockers.push('Run requires a tool scope not present in the authority grant');
    const pluginScopes = parseJson(
      pluginAuthorityScopesSchema,
      grant.pluginScopes,
      'AuthorityGrant.pluginScopes',
    );
    if (
      requiredPluginScopes.some(
        (required) =>
          !pluginScopes.some(
            (granted) =>
              granted.installationId === required.installationId &&
              granted.pluginVersionId === required.pluginVersionId &&
              granted.pluginDigest === required.pluginDigest &&
              granted.tool === required.tool &&
              granted.effect === required.effect,
          ),
      )
    ) {
      blockers.push('Run requires a Plugin scope not present in the authority grant');
    }
    if (
      requiredPluginScopes.some(({ approvalRequired }) => approvalRequired) &&
      !perRunPluginApproved
    ) {
      blockers.push('A required Plugin action needs human approval for this exact run');
    }
    return blockers;
  }

  private claimedGrantBlockers(
    grant: DatabaseAuthorityGrant | null,
    run: DatabaseExecutionRun,
    release: ReleaseForExecution,
    perRunPluginApproved: boolean,
  ): string[] {
    if (grant === null) return ['Authority grant is unavailable'];
    const blockers: string[] = [];
    const now = Date.now();
    if (
      grant.state === AuthorityGrantState.REVOKED ||
      grant.state === AuthorityGrantState.EXPIRED
    ) {
      blockers.push(`Authority grant is ${grantStateWire[grant.state]}`);
    }
    if (grant.releaseId !== run.releaseId || grant.releaseDigest !== run.releaseDigest) {
      blockers.push('Authority grant release digest does not match');
    }
    if (
      grant.entryResourceVersionId !== run.entryResourceVersionId ||
      !release.resources.some(
        ({ resourceVersion }) => resourceVersion.id === run.entryResourceVersionId,
      )
    ) {
      blockers.push('Authority grant entry resource does not match');
    }
    if (
      grant.workspaceId !== run.workspaceId ||
      grant.departmentId !== run.departmentId ||
      release.workspaceId !== run.workspaceId ||
      release.departmentId !== run.departmentId
    ) {
      blockers.push('Authority grant release scope does not match');
    }
    if (grant.contextDigest !== run.contextDigest) {
      blockers.push('Authority grant execution context does not match');
    }
    if (grant.projectId !== run.projectId || release.projectId !== run.projectId) {
      blockers.push('Authority grant project does not match');
    }
    if (grant.validFrom.getTime() > now || grant.validUntil.getTime() <= now) {
      blockers.push('Authority grant is outside its validity window');
    }
    if (Number(run.estimatedUpperCostUsd) > Number(grant.maxEstimatedCostPerRunUsd)) {
      blockers.push('Run exceeds the authority per-run cost ceiling');
    }
    if (
      Number(grant.spentCostUsd) + Number(grant.reservedCostUsd) >
      Number(grant.totalCostBudgetUsd) + Number.EPSILON
    ) {
      blockers.push('Authority grant cost reservations exceed its total budget');
    }
    const input = parseJson(jsonObjectSchema, run.input, 'ExecutionRun.input');
    const constraints = parseJson(
      jsonObjectSchema,
      grant.inputConstraints,
      'AuthorityGrant.inputConstraints',
    );
    if (!satisfiesConstraints(input, constraints)) {
      blockers.push('Run input is outside the authority constraints');
    }
    const scopes = new Set(
      parseJson(stringArraySchema, grant.toolScopes, 'AuthorityGrant.toolScopes'),
    );
    const requiredScopes = parseJson(
      stringArraySchema,
      run.requiredToolScopes,
      'ExecutionRun.requiredToolScopes',
    );
    if (requiredScopes.some((scope) => !scopes.has(scope))) {
      blockers.push('Run requires a tool scope not present in the authority grant');
    }
    const pluginScopes = parseJson(
      pluginAuthorityScopesSchema,
      grant.pluginScopes,
      'AuthorityGrant.pluginScopes',
    );
    const requiredPluginScopes = parseJson(
      runPluginRequirementsSchema,
      run.requiredPluginScopes,
      'ExecutionRun.requiredPluginScopes',
    );
    if (
      requiredPluginScopes.some(
        (required) =>
          !pluginScopes.some(
            (granted) =>
              granted.installationId === required.installationId &&
              granted.pluginVersionId === required.pluginVersionId &&
              granted.pluginDigest === required.pluginDigest &&
              granted.tool === required.tool &&
              granted.effect === required.effect,
          ),
      )
    ) {
      blockers.push('Run requires a Plugin scope not present in the authority grant');
    }
    if (run.requiresPluginApproval && !perRunPluginApproved) {
      blockers.push('A required Plugin action lacks approval for this exact run');
    }
    return blockers;
  }

  private async reconcileReservation(
    transaction: Prisma.TransactionClient,
    run: DatabaseExecutionRun,
    options: { actualCostUsd?: number; refundRun?: boolean } = {},
  ): Promise<void> {
    if (run.authorityGrantId === null) return;
    await transaction.$queryRaw`
      SELECT "id" FROM "AuthorityGrant"
      WHERE "id" = ${run.authorityGrantId}::uuid
      FOR UPDATE
    `;
    const grant = await transaction.authorityGrant.findFirst({
      where: {
        id: run.authorityGrantId,
        workspaceId: run.workspaceId,
        departmentId: run.departmentId,
      },
    });
    if (grant === null) return;
    const reservedCostUsd = Math.max(
      0,
      Number(grant.reservedCostUsd) - Number(run.estimatedUpperCostUsd),
    );
    const usedRuns = Math.max(0, grant.usedRuns - (options.refundRun === true ? 1 : 0));
    const spentCostUsd = Number(grant.spentCostUsd) + (options.actualCostUsd ?? 0);
    const immutableState =
      grant.state === AuthorityGrantState.REVOKED || grant.state === AuthorityGrantState.EXPIRED;
    const state = immutableState
      ? grant.state
      : usedRuns >= grant.maxRuns ||
          spentCostUsd + reservedCostUsd >= Number(grant.totalCostBudgetUsd)
        ? AuthorityGrantState.EXHAUSTED
        : AuthorityGrantState.ACTIVE;
    await transaction.authorityGrant.update({
      where: { id: grant.id },
      data: { reservedCostUsd, usedRuns, spentCostUsd, state },
    });
  }

  private async pauseClaimedForAuthority(
    transaction: Prisma.TransactionClient,
    run: DatabaseExecutionRun,
    blockers: string[],
  ): Promise<void> {
    await this.reconcileReservation(transaction, run, { refundRun: run.attempts === 1 });
    await transaction.executionRun.update({
      where: { id: run.id },
      data: {
        state: ExecutionRunState.AWAITING_APPROVAL,
        authorityGrantId: null,
        approvalReasons: toPrismaJson(stringArraySchema, blockers, 'ExecutionRun.approvalReasons'),
        message: 'Authority changed before provider execution',
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
    await transaction.approvalRequest.upsert({
      where: { runId: run.id },
      create: {
        runId: run.id,
        reasons: toPrismaJson(stringArraySchema, blockers, 'ApprovalRequest.reasons'),
        requestedBy: run.requestedBy,
      },
      update: {
        state: ApprovalRequestState.PENDING,
        requestVersion: { increment: 1 },
        decisionGroupKey: null,
        decisionGroupSize: null,
        reasons: toPrismaJson(stringArraySchema, blockers, 'ApprovalRequest.reasons'),
        requestedBy: run.requestedBy,
        decidedBy: null,
        rationale: null,
        decidedAt: null,
      },
    });
    await appendAuditEvent(transaction, {
      action: 'execution.authority_revalidation_failed',
      entityType: 'ExecutionRun',
      entityId: run.id,
      details: { blockers },
    });
  }

  async listGrants(query: {
    state?: 'active' | 'revoked' | 'exhausted' | 'expired' | undefined;
    limit: number;
  }): Promise<z.infer<typeof authorityGrantListResponseSchema>> {
    // Today and the in-app self-test consume this read path. Keep it side-effect-free while
    // projecting elapsed ACTIVE records exactly as the persisted EXPIRED state would appear.
    const now = new Date();
    const state =
      query.state === undefined
        ? undefined
        : (Object.entries(grantStateWire).find(([, wire]) => wire === query.state)?.[0] as
            | AuthorityGrantState
            | undefined);
    const scopeWhere = aggregateScopeWhere();
    const indexWhere = {
      ...scopeWhere,
      entryResourceVersion: userFacingResourceVersionWhere,
    } satisfies Prisma.AuthorityGrantWhereInput;
    const effectiveStateWhere =
      state === AuthorityGrantState.ACTIVE
        ? { state, validUntil: { gt: now } }
        : state === AuthorityGrantState.EXPIRED
          ? {
              AND: [
                {
                  OR: [
                    { state: AuthorityGrantState.EXPIRED },
                    { state: AuthorityGrantState.ACTIVE, validUntil: { lte: now } },
                  ],
                },
              ],
            }
          : state === undefined
            ? {}
            : { state };
    const staleActiveWhere = {
      ...indexWhere,
      state: AuthorityGrantState.ACTIVE,
      validUntil: { lte: now },
    } satisfies Prisma.AuthorityGrantWhereInput;
    const [records, stateTotals, staleActiveTotal] = await Promise.all([
      this.prisma.authorityGrant.findMany({
        where: { ...indexWhere, ...effectiveStateWhere },
        include: authorityGrantSubjectInclude,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
      this.prisma.authorityGrant.groupBy({
        by: ['state'],
        where: indexWhere,
        _count: { _all: true },
      }),
      this.prisma.authorityGrant.count({ where: staleActiveWhere }),
    ]);
    const total = stateTotals.reduce((sum, group) => sum + group._count._all, 0);
    const persistedActiveTotal =
      stateTotals.find((group) => group.state === AuthorityGrantState.ACTIVE)?._count._all ?? 0;
    const activeTotal = Math.max(0, persistedActiveTotal - staleActiveTotal);
    return authorityGrantListResponseSchema.parse({
      items: records.map((record) =>
        toGrant(
          record,
          record.state === AuthorityGrantState.ACTIVE && record.validUntil <= now
            ? AuthorityGrantState.EXPIRED
            : record.state,
        ),
      ),
      total,
      activeTotal,
    });
  }

  async createGrant(
    input: z.input<typeof createAuthorityGrantRequestSchema>,
  ): Promise<AuthorityGrant> {
    const actor = requireHumanActor();
    const mutationScope = governedExecutionMutationScope();
    const parsed = createAuthorityGrantRequestSchema.parse(input);
    const release = await this.release(parsed.releaseId);
    if (parsed.projectId !== release.projectId) {
      throw new AppError(
        422,
        'AUTHORITY_PROJECT_MISMATCH',
        'Authority project must match the release project',
      );
    }
    if (new Date(parsed.validUntil).getTime() <= Date.now()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Authority grant must expire in the future');
    }
    const pluginScopes = await this.materializePluginScopes(
      release,
      parsed.entryResourceVersionId,
      parsed.pluginScopes,
    );
    const record = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.authorityGrant.create({
        data: {
          ...mutationScope,
          releaseId: release.id,
          entryResourceVersionId: parsed.entryResourceVersionId,
          releaseDigest: release.digest,
          contextDigest: parsed.contextDigest,
          projectId: parsed.projectId,
          inputConstraints: toPrismaJson(
            jsonObjectSchema,
            parsed.inputConstraints,
            'AuthorityGrant.inputConstraints',
          ),
          toolScopes: toPrismaJson(
            stringArraySchema,
            parsed.toolScopes,
            'AuthorityGrant.toolScopes',
          ),
          pluginScopes: toPrismaJson(
            pluginAuthorityScopesSchema,
            pluginScopes,
            'AuthorityGrant.pluginScopes',
          ),
          validUntil: new Date(parsed.validUntil),
          maxRuns: parsed.maxRuns,
          maxEstimatedCostPerRunUsd: parsed.maxEstimatedCostPerRunUsd,
          totalCostBudgetUsd: parsed.totalCostBudgetUsd,
          actorId: actor,
          rationale: parsed.rationale,
        },
      });
      await appendAuditEvent(transaction, {
        action: 'authority.granted',
        entityType: 'AuthorityGrant',
        entityId: created.id,
        details: {
          releaseId: release.id,
          releaseDigest: release.digest,
          entryResourceVersionId: parsed.entryResourceVersionId,
          pluginScopeCount: pluginScopes.length,
        },
      });
      return created;
    });
    return toGrant(record);
  }

  async revokeGrant(grantId: string): Promise<AuthorityGrant> {
    const actor = requireHumanActor();
    const mutationScope = governedExecutionMutationScope();
    const result = await retrySerializableTransaction(() =>
      this.prisma.$transaction(
        async (transaction) => {
          // Execution claims lock their run before the grant. Take those locks in the
          // same order, then lock the grant before inspecting its state. This makes
          // revocation linearizable with claim and removes the stale-read window in
          // which an active grant could be observed before a worker consumed it.
          await transaction.$queryRaw`
        SELECT "id"
        FROM "ExecutionRun"
        WHERE "authorityGrantId" = ${grantId}::uuid
          AND "workspaceId" = ${mutationScope.workspaceId}::uuid
          AND "departmentId" IS NOT DISTINCT FROM ${mutationScope.departmentId}::uuid
          AND "state" IN ('queued', 'running')
        ORDER BY "id" ASC
        FOR UPDATE
      `;
          await transaction.$queryRaw`
        SELECT "id"
        FROM "AuthorityGrant"
        WHERE "id" = ${grantId}::uuid
          AND "workspaceId" = ${mutationScope.workspaceId}::uuid
          AND "departmentId" IS NOT DISTINCT FROM ${mutationScope.departmentId}::uuid
        FOR UPDATE
      `;
          const existing = await transaction.authorityGrant.findFirst({
            where: { id: grantId, ...mutationScope },
          });
          if (existing === null)
            throw new AppError(404, 'AUTHORITY_GRANT_NOT_FOUND', 'Authority grant was not found');
          if (existing.state === AuthorityGrantState.REVOKED) {
            return { grant: existing, runningRunIds: [] as string[] };
          }
          const queuedRuns = await transaction.executionRun.findMany({
            where: {
              authorityGrantId: grantId,
              state: ExecutionRunState.QUEUED,
              ...mutationScope,
            },
            orderBy: { id: 'asc' },
          });
          for (const run of queuedRuns) {
            const reasons = ['Authority grant was revoked before execution'];
            const paused = await transaction.executionRun.updateMany({
              where: {
                id: run.id,
                authorityGrantId: grantId,
                state: ExecutionRunState.QUEUED,
              },
              data: {
                state: ExecutionRunState.AWAITING_APPROVAL,
                authorityGrantId: null,
                approvalReasons: toPrismaJson(
                  stringArraySchema,
                  reasons,
                  'ExecutionRun.approvalReasons',
                ),
                message: reasons[0] ?? 'Authority grant was revoked before execution',
              },
            });
            if (paused.count !== 1) continue;
            await transaction.approvalRequest.upsert({
              where: { runId: run.id },
              create: {
                runId: run.id,
                reasons: toPrismaJson(stringArraySchema, reasons, 'ApprovalRequest.reasons'),
                requestedBy: run.requestedBy,
              },
              update: {
                state: ApprovalRequestState.PENDING,
                requestVersion: { increment: 1 },
                decisionGroupKey: null,
                decisionGroupSize: null,
                reasons: toPrismaJson(stringArraySchema, reasons, 'ApprovalRequest.reasons'),
                decidedBy: null,
                rationale: null,
                decidedAt: null,
              },
            });
          }
          const runningRuns = await transaction.executionRun.findMany({
            where: {
              authorityGrantId: grantId,
              state: ExecutionRunState.RUNNING,
              ...mutationScope,
            },
            orderBy: { id: 'asc' },
          });
          const cancelledRunningRunIds: string[] = [];
          for (const run of runningRuns) {
            const cancelled = await transaction.executionRun.updateMany({
              where: {
                id: run.id,
                authorityGrantId: grantId,
                state: ExecutionRunState.RUNNING,
              },
              data: {
                cancelRequestedAt: new Date(),
                message: 'Authority revoked; cancellation requested',
              },
            });
            if (cancelled.count === 1) cancelledRunningRunIds.push(run.id);
          }
          const revoked = await transaction.authorityGrant.updateMany({
            where: { id: grantId, state: { not: AuthorityGrantState.REVOKED } },
            data: { state: AuthorityGrantState.REVOKED, revokedAt: new Date(), revokedBy: actor },
          });
          if (revoked.count !== 1) {
            throw new AppError(
              409,
              'AUTHORITY_GRANT_CHANGED',
              'Authority grant changed during revoke',
            );
          }
          const updated = await transaction.authorityGrant.findUniqueOrThrow({
            where: { id: grantId },
          });
          await appendAuditEvent(transaction, {
            action: 'authority.revoked',
            entityType: 'AuthorityGrant',
            entityId: grantId,
            details: {
              releaseId: existing.releaseId,
              queuedRunsPaused: queuedRuns.length,
              runningRunsCancelled: cancelledRunningRunIds.length,
            },
          });
          return { grant: updated, runningRunIds: cancelledRunningRunIds };
        },
        { isolationLevel: 'Serializable' },
      ),
    );
    result.runningRunIds.forEach((runId) =>
      this.activeControllers.get(runId)?.abort(new Error('AUTHORITY_REVOKED')),
    );
    return toGrant(result.grant);
  }

  async listRuns(query: {
    state?: z.infer<typeof executionRunStateSchema> | undefined;
    limit: number;
  }): Promise<z.infer<typeof executionRunListResponseSchema>> {
    const databaseState =
      query.state === undefined
        ? undefined
        : (Object.entries(runStateWire).find(([, wire]) => wire === query.state)?.[0] as
            | ExecutionRunState
            | undefined);
    const scopeWhere = aggregateScopeWhere();
    const indexWhere = {
      ...scopeWhere,
      AND: [userFacingExecutionRunWhere],
    } satisfies Prisma.ExecutionRunWhereInput;
    const [records, stateTotals] = await Promise.all([
      this.prisma.executionRun.findMany({
        where: {
          ...indexWhere,
          ...(databaseState === undefined ? {} : { state: databaseState }),
        },
        include: executionRunSubjectInclude,
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
      this.prisma.executionRun.groupBy({
        by: ['state'],
        where: indexWhere,
        _count: { _all: true },
      }),
    ]);
    const countsByState = {
      awaiting_approval: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      paused_budget: 0,
      paused_plugin: 0,
    };
    for (const group of stateTotals) {
      countsByState[runStateWire[group.state]] = group._count._all;
    }
    const total = Object.values(countsByState).reduce((sum, count) => sum + count, 0);
    return executionRunListResponseSchema.parse({
      items: records.map(toRun),
      total,
      countsByState,
    });
  }

  async createRun(
    input: z.input<typeof createExecutionRunRequestSchema>,
    options: { digestSnapshotId?: string | null } = {},
  ): Promise<ExecutionRun> {
    const parsed = createExecutionRunRequestSchema.parse(input);
    if (parsed.pluginCalls.length > 0 && this.config.execution.dispatchMode !== 'external') {
      throw new AppError(
        503,
        'PLUGIN_WORKER_REQUIRED',
        'Planned Plugin calls require the durable external worker and cannot use in-process dispatch',
      );
    }
    const executionContext = await this.executionContext();
    const contextSummary = summarizeExecutionContext(executionContext);
    const idempotent = await this.prisma.executionRun.findFirst({
      where: { idempotencyKey: parsed.idempotencyKey, ...aggregateScopeWhere() },
      include: {
        ...executionRunSubjectInclude,
        pluginCallPlans: {
          orderBy: { ordinal: 'asc' },
          include: { requirement: true },
        },
      },
    });
    if (idempotent !== null) {
      const sameRequest =
        idempotent.releaseId === parsed.releaseId &&
        idempotent.entryResourceVersionId === parsed.entryResourceVersionId &&
        idempotent.authorityGrantId === parsed.authorityGrantId &&
        idempotent.contextDigest === executionContext.digest &&
        canonicalJson(parseJson(jsonObjectSchema, idempotent.input, 'ExecutionRun.input')) ===
          canonicalJson(parsed.input) &&
        idempotent.maxInputTokens === parsed.maxInputTokens &&
        idempotent.maxOutputTokens === parsed.maxOutputTokens &&
        idempotent.maxAttempts === parsed.maxAttempts &&
        idempotent.retryBackoff === retryBackoffMap[parsed.retryBackoff] &&
        Number(idempotent.maxEstimatedCostUsd) === parsed.maxEstimatedCostUsd;
      const sameDevelopmentMode = idempotent.developmentDraft === parsed.developmentDraft;
      const sameDigestSnapshot = idempotent.digestSnapshotId === (options.digestSnapshotId ?? null);
      const samePluginCalls =
        canonicalJson(
          idempotent.pluginCallPlans.map((plan) => ({
            installationId: plan.requirement.installationId,
            pluginVersionId: plan.requirement.pluginVersionId,
            tool: plan.requirement.capabilityName,
            inputPath: pluginCallInputPathSchema.parse(plan.inputPath),
            outputContextKey: plan.outputContextKey,
          })),
        ) === canonicalJson(parsed.pluginCalls);
      if (!sameRequest || !sameDevelopmentMode || !sameDigestSnapshot || !samePluginCalls) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key is already bound to different run input',
        );
      }
      return toRun(idempotent);
    }
    const release = await this.release(parsed.releaseId);
    const channel = await this.prisma.productionChannel.findFirst({
      where: { key: release.projectId ?? 'default', ...aggregateScopeWhere() },
    });
    const isProductionRelease = channel?.currentReleaseId === release.id;
    const requiresProductionEpochApproval =
      isProductionRelease && (!parsed.developmentDraft || this.provider.kind !== 'deterministic');
    const productionEpochApproved =
      !requiresProductionEpochApproval ||
      (channel.promotedAt !== null &&
        (await this.prisma.approvalRequest.findFirst({
          where: {
            state: ApprovalRequestState.APPROVED,
            decidedAt: { gte: channel.promotedAt },
            decidedBy: { not: null },
            run: {
              is: {
                releaseId: release.id,
                releaseDigest: release.digest,
                developmentDraft: false,
              },
            },
          },
          select: { id: true },
        })) !== null);
    if (this.provider.kind !== 'deterministic' && !isProductionRelease) {
      throw new AppError(
        422,
        'PRODUCTION_RELEASE_REQUIRED',
        'Non-deterministic providers may execute only the current production release',
      );
    }
    if (
      this.provider.kind === 'deterministic' &&
      !isProductionRelease &&
      (!parsed.developmentDraft || this.config.environment === 'production')
    ) {
      throw new AppError(
        422,
        'EXPLICIT_DEVELOPMENT_RUN_REQUIRED',
        'Off-channel deterministic execution requires developmentDraft=true outside production',
      );
    }
    const requirements = await this.entryRequirements(release, parsed.entryResourceVersionId);
    if (!requirements.isDailyBrief) {
      throw new AppError(
        422,
        'EXECUTOR_UNAVAILABLE',
        'This vertical slice executes only the daily-brief skill',
      );
    }
    dailyBriefInputSchema.parse(parsed.input);
    const approximateInputTokens =
      Math.ceil(JSON.stringify(parsed.input).length / 4) + contextSummary.estimatedTokens;
    if (approximateInputTokens > parsed.maxInputTokens) {
      throw new AppError(
        422,
        'INPUT_TOKEN_BUDGET_EXCEEDED',
        'Input exceeds the configured token budget',
        {
          approximateInputTokens,
          maxInputTokens: parsed.maxInputTokens,
        },
      );
    }
    const modelEstimate = this.estimateUpperCost(parsed.maxInputTokens, parsed.maxOutputTokens);
    const grant =
      parsed.authorityGrantId === null
        ? null
        : await this.prisma.authorityGrant.findFirst({
            where: { id: parsed.authorityGrantId, ...aggregateScopeWhere() },
          });
    const pluginRequirements = await this.deriveRunPluginRequirements(
      release,
      parsed.entryResourceVersionId,
    );
    const requiredPluginScopes = pluginRequirements.items;
    const pluginCallPlan = this.materializePluginCallPlans(
      parsed.pluginCalls,
      requiredPluginScopes,
      parsed.input,
    );
    const estimate = modelEstimate + pluginCallPlan.estimatedUpperCostUsd;
    const blockers = this.grantBlockers(
      grant,
      release,
      parsed.entryResourceVersionId,
      executionContext.digest,
      parsed.input,
      requirements.requiredTools,
      requiredPluginScopes,
      estimate,
      false,
    );
    if (!productionEpochApproved) {
      blockers.unshift('First run of this production release epoch requires human approval');
    }
    const budgetPaused = estimate > parsed.maxEstimatedCostUsd;
    if (budgetPaused) blockers.unshift('Estimated upper cost exceeds the run cost ceiling');
    const state = budgetPaused
      ? ExecutionRunState.PAUSED_BUDGET
      : pluginRequirements.unavailableReasons.length > 0
        ? ExecutionRunState.PAUSED_PLUGIN
        : blockers.length === 0
          ? ExecutionRunState.QUEUED
          : ExecutionRunState.AWAITING_APPROVAL;
    const actor = currentActorId();
    const requirementRows = requiredPluginScopes.map((requirement) => ({
      id: randomUUID(),
      key: pluginRequirementKey(requirement),
      requirement,
    }));
    const record = await this.prisma.$transaction(
      async (transaction) => {
        const created = await transaction.executionRun.create({
          data: {
            ...aggregateScope(),
            releaseId: release.id,
            entryResourceVersionId: parsed.entryResourceVersionId,
            legacyEntrypointUnresolved: false,
            authorityGrantId: state === ExecutionRunState.QUEUED ? (grant?.id ?? null) : null,
            digestSnapshotId: options.digestSnapshotId ?? null,
            releaseDigest: release.digest,
            contextDigest: executionContext.digest,
            contextProvenance: toPrismaJson(
              contextProvenanceSummarySchema,
              contextSummary.provenance,
              'ExecutionRun.contextProvenance',
            ),
            contextClassification: contextClassificationMap[contextSummary.classification],
            contextEstimatedTokens: contextSummary.estimatedTokens,
            projectId: release.projectId,
            requiredToolScopes: toPrismaJson(
              stringArraySchema,
              requirements.requiredTools,
              'ExecutionRun.requiredToolScopes',
            ),
            requiredPluginScopes: toPrismaJson(
              runPluginRequirementsSchema,
              requiredPluginScopes,
              'ExecutionRun.requiredPluginScopes',
            ),
            requiresPluginApproval: requiredPluginScopes.some(
              ({ approvalRequired }) => approvalRequired,
            ),
            state,
            input: toPrismaJson(jsonObjectSchema, parsed.input, 'ExecutionRun.input'),
            providerKind: providerKindMap[this.provider.kind],
            developmentDraft: parsed.developmentDraft,
            providerVersion: this.provider.version,
            model: this.provider.model,
            maxInputTokens: parsed.maxInputTokens,
            maxOutputTokens: parsed.maxOutputTokens,
            maxAttempts: parsed.maxAttempts,
            retryBackoff: retryBackoffMap[parsed.retryBackoff],
            maxEstimatedCostUsd: parsed.maxEstimatedCostUsd,
            estimatedUpperCostUsd: estimate,
            pricingVersion: this.config.model.pricingVersion,
            approvalReasons: toPrismaJson(
              stringArraySchema,
              blockers,
              'ExecutionRun.approvalReasons',
            ),
            progress: state === ExecutionRunState.QUEUED ? 0 : 0,
            message:
              state === ExecutionRunState.QUEUED
                ? 'Queued'
                : state === ExecutionRunState.PAUSED_BUDGET
                  ? 'Paused by run cost budget'
                  : state === ExecutionRunState.PAUSED_PLUGIN
                    ? (pluginRequirements.unavailableReasons[0] ??
                      'Paused because a required Plugin is unavailable')
                    : 'Awaiting authority approval',
            idempotencyKey: parsed.idempotencyKey,
            requestedBy: actor,
            ...(state === ExecutionRunState.AWAITING_APPROVAL
              ? {
                  approvalRequest: {
                    create: {
                      reasons: toPrismaJson(stringArraySchema, blockers, 'ApprovalRequest.reasons'),
                      requestedBy: actor,
                    },
                  },
                }
              : {}),
          },
          include: executionRunSubjectInclude,
        });
        if (requiredPluginScopes.length > 0) {
          await transaction.runPluginRequirement.createMany({
            data: requirementRows.map(({ id, requirement }) => ({
              id,
              runId: created.id,
              installationId: requirement.installationId,
              pluginVersionId: requirement.pluginVersionId,
              pluginDigest: requirement.pluginDigest,
              capabilityName: requirement.tool,
              effect: pluginEffectMap[requirement.effect],
              approvalRequired: requirement.approvalRequired,
              authorityScope: toPrismaJson(
                pluginAuthorityScopeSchema,
                {
                  installationId: requirement.installationId,
                  pluginVersionId: requirement.pluginVersionId,
                  pluginDigest: requirement.pluginDigest,
                  tool: requirement.tool,
                  effect: requirement.effect,
                  limits: requirement.limits,
                  scopeDescription: requirement.scopeDescription,
                },
                'RunPluginRequirement.authorityScope',
              ),
              contextDigest: executionContext.digest,
            })),
          });
        }
        if (pluginCallPlan.calls.length > 0) {
          const requirementIds = new Map(requirementRows.map(({ id, key }) => [key, id] as const));
          await transaction.runPluginCallPlan.createMany({
            data: pluginCallPlan.calls.map((call, ordinal) => {
              const requirementId = requirementIds.get(call.requirementKey);
              if (requirementId === undefined) {
                throw new AppError(
                  409,
                  'PLUGIN_PLAN_REQUIREMENT_MISMATCH',
                  'The Plugin call plan lost its exact immutable requirement',
                );
              }
              return {
                ...aggregateScope(),
                runId: created.id,
                requirementId,
                ordinal,
                invocationKey: `${created.id}:plugin:${ordinal}`,
                inputPath: toPrismaJson(
                  pluginCallInputPathSchema,
                  call.inputPath,
                  'RunPluginCallPlan.inputPath',
                ),
                outputContextKey: call.outputContextKey,
              };
            }),
          });
        }
        await appendAuditEvent(transaction, {
          action: 'execution.requested',
          entityType: 'ExecutionRun',
          entityId: created.id,
          details: { releaseId: release.id, state: runStateWire[state] },
        });
        await appendExecutionRunEvent(transaction, created, {
          phase: 'request',
          state: runStateWire[state],
          message: created.message,
        });
        return created;
      },
      { isolationLevel: 'Serializable' },
    );
    return toRun(record);
  }

  async approveRun(
    runId: string,
    input: z.input<typeof approveExecutionRunRequestSchema>,
  ): Promise<{ grant: AuthorityGrant; run: ExecutionRun }> {
    const actor = requireHumanActor();
    const mutationScope = governedExecutionMutationScope();
    const parsed = approveExecutionRunRequestSchema.parse(input);
    if (new Date(parsed.validUntil).getTime() <= Date.now()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Authority grant must expire in the future');
    }
    const result = await retrySerializableTransaction(() =>
      this.prisma.$transaction(
        async (transaction) => {
          await this.lockExecutionDecisions(transaction, [runId], mutationScope);
          const run = await transaction.executionRun.findFirst({
            where: { id: runId, ...mutationScope },
          });
          if (run === null)
            throw new AppError(404, 'EXECUTION_RUN_NOT_FOUND', 'Execution run was not found');
          if (run.state !== ExecutionRunState.AWAITING_APPROVAL) {
            throw new AppError(
              409,
              'RUN_NOT_AWAITING_APPROVAL',
              'Only an awaiting run can be approved',
            );
          }
          const release = await transaction.releaseBundle.findFirst({
            where: {
              id: run.releaseId,
              workspaceId: run.workspaceId,
              departmentId: run.departmentId,
            },
            include: { resources: { include: { resourceVersion: { include: { family: true } } } } },
          });
          if (release === null || release.digest !== run.releaseDigest) {
            throw new AppError(409, 'RELEASE_CHANGED', 'The exact release digest is unavailable');
          }
          if (parsed.entryResourceVersionId !== run.entryResourceVersionId) {
            throw new AppError(
              422,
              'ENTRYPOINT_RELEASE_MISMATCH',
              'Approval must bind the exact entry resource requested by the run',
            );
          }
          const pluginScopes = await this.materializePluginScopes(
            release,
            run.entryResourceVersionId,
            parsed.pluginScopes,
            transaction,
          );
          const grant = await transaction.authorityGrant.create({
            data: {
              workspaceId: run.workspaceId,
              departmentId: run.departmentId,
              releaseId: release.id,
              entryResourceVersionId: run.entryResourceVersionId,
              releaseDigest: release.digest,
              contextDigest: run.contextDigest,
              projectId: parsed.projectId,
              inputConstraints: toPrismaJson(
                jsonObjectSchema,
                parsed.inputConstraints,
                'AuthorityGrant.inputConstraints',
              ),
              toolScopes: toPrismaJson(
                stringArraySchema,
                parsed.toolScopes,
                'AuthorityGrant.toolScopes',
              ),
              pluginScopes: toPrismaJson(
                pluginAuthorityScopesSchema,
                pluginScopes,
                'AuthorityGrant.pluginScopes',
              ),
              validUntil: new Date(parsed.validUntil),
              maxRuns: parsed.maxRuns,
              maxEstimatedCostPerRunUsd: parsed.maxEstimatedCostPerRunUsd,
              totalCostBudgetUsd: parsed.totalCostBudgetUsd,
              actorId: actor,
              rationale: parsed.rationale,
            },
          });
          const blockers = this.grantBlockers(
            grant,
            release,
            run.entryResourceVersionId,
            run.contextDigest,
            parseJson(jsonObjectSchema, run.input, 'ExecutionRun.input'),
            (await this.entryRequirements(release, run.entryResourceVersionId, transaction))
              .requiredTools,
            parseJson(
              runPluginRequirementsSchema,
              run.requiredPluginScopes,
              'ExecutionRun.requiredPluginScopes',
            ),
            Number(run.estimatedUpperCostUsd),
            true,
          );
          if (blockers.length > 0) {
            throw new AppError(
              422,
              'AUTHORITY_ENVELOPE_INSUFFICIENT',
              'The proposed authority does not cover this run',
              { blockers },
            );
          }
          const updatedRuns = await transaction.executionRun.updateMany({
            where: {
              id: run.id,
              state: ExecutionRunState.AWAITING_APPROVAL,
              ...mutationScope,
            },
            data: {
              authorityGrantId: grant.id,
              state: ExecutionRunState.QUEUED,
              approvalReasons: toPrismaJson(stringArraySchema, [], 'ExecutionRun.approvalReasons'),
              message: 'Queued',
            },
          });
          if (updatedRuns.count !== 1) {
            throw new AppError(
              409,
              'RUN_NOT_AWAITING_APPROVAL',
              'The run changed before the authority decision was recorded',
            );
          }
          const updatedApprovals = await transaction.approvalRequest.updateMany({
            where: { runId, state: ApprovalRequestState.PENDING, decisionGroupKey: null },
            data: {
              state: ApprovalRequestState.APPROVED,
              decidedBy: actor,
              rationale: parsed.rationale,
              decidedAt: new Date(),
            },
          });
          if (updatedApprovals.count !== 1) {
            throw new AppError(
              409,
              'APPROVAL_ALREADY_DECIDED',
              'The authority request changed before the decision was recorded',
            );
          }
          const updatedRun = await transaction.executionRun.findUniqueOrThrow({
            where: { id: run.id },
            include: executionRunSubjectInclude,
          });
          await appendAuditEvent(transaction, {
            action: 'execution.approved',
            entityType: 'ExecutionRun',
            entityId: runId,
            details: { authorityGrantId: grant.id, releaseDigest: release.digest },
          });
          await appendExecutionRunEvent(transaction, updatedRun, {
            phase: 'authority',
            state: 'approved',
            message: 'A human approved bounded authority for this run.',
          });
          return {
            grant: await transaction.authorityGrant.findUniqueOrThrow({ where: { id: grant.id } }),
            run: updatedRun,
          };
        },
        { isolationLevel: 'Serializable' },
      ),
    );
    return { grant: toGrant(result.grant), run: toRun(result.run) };
  }

  async approveRunGroup(
    groupKey: string,
    input: z.input<typeof approveExecutionRunRequestSchema>,
  ): Promise<z.infer<typeof approveExecutionRunGroupResponseSchema>> {
    const actor = requireHumanActor();
    const mutationScope = governedExecutionMutationScope();
    const parsed = approveExecutionRunRequestSchema.parse(input);
    if (new Date(parsed.validUntil).getTime() <= Date.now()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Authority grant must expire in the future');
    }
    const result = await retrySerializableTransaction(() =>
      this.prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${mutationScope.workspaceId}:${mutationScope.departmentId ?? 'workspace'}:execution-approval-group:${groupKey}`}))`;

          const decided = await transaction.approvalRequest.findMany({
            where: { decisionGroupKey: groupKey, run: mutationScope },
            include: executionApprovalInclude,
            orderBy: { id: 'asc' },
          });
          if (decided.length > 0) {
            this.assertCompleteDecisionGroup(decided);
            if (
              decided.some(
                ({ state, rationale }) =>
                  state !== ApprovalRequestState.APPROVED || rationale !== parsed.rationale,
              )
            ) {
              throw new AppError(
                409,
                'ATTENTION_GROUP_ALREADY_DECIDED',
                'This authority group already has a different immutable decision',
              );
            }
            const grantIds = new Set(decided.map(({ run }) => run.authorityGrantId));
            const grantId = grantIds.size === 1 ? ([...grantIds][0] ?? null) : null;
            const grant =
              grantId === null
                ? null
                : await transaction.authorityGrant.findFirst({
                    where: { id: grantId, ...mutationScope },
                  });
            if (grant === null || !this.sameApprovalEnvelope(grant, parsed)) {
              throw new AppError(
                409,
                'ATTENTION_GROUP_ALREADY_DECIDED',
                'This authority group already has a different immutable decision',
              );
            }
            return { grant, runs: decided.map(({ run }) => run) };
          }

          const pending = await transaction.approvalRequest.findMany({
            where: {
              state: ApprovalRequestState.PENDING,
              run: { ...mutationScope, state: ExecutionRunState.AWAITING_APPROVAL },
            },
            include: executionApprovalInclude,
            orderBy: { createdAt: 'asc' },
          });
          const group = groupExecutionApprovals(pending).find(
            (candidate) => candidate.groupKey === groupKey,
          );
          if (group === undefined) {
            throw new AppError(
              404,
              'ATTENTION_GROUP_NOT_FOUND',
              'The reviewed authority group is no longer pending',
            );
          }
          const runIds = group.approvals.map(({ run }) => run.id).sort();
          const approvalIds = group.approvals.map(({ id }) => id).sort();
          await this.lockExecutionDecisions(transaction, runIds, mutationScope);
          const locked = await transaction.approvalRequest.findMany({
            where: {
              id: { in: approvalIds },
              state: ApprovalRequestState.PENDING,
              run: { ...mutationScope, state: ExecutionRunState.AWAITING_APPROVAL },
            },
            include: executionApprovalInclude,
            orderBy: { createdAt: 'asc' },
          });
          const lockedGroup = groupExecutionApprovals(locked).find(
            (candidate) => candidate.groupKey === groupKey,
          );
          if (lockedGroup === undefined || lockedGroup.approvals.length !== approvalIds.length) {
            throw new AppError(
              409,
              'ATTENTION_GROUP_CHANGED',
              'The authority group changed before the decision was recorded; refresh and review it again',
            );
          }
          const runs = lockedGroup.approvals.map(({ run }) => run);
          const first = runs[0];
          if (first === undefined || first.entryResourceVersionId === null) {
            throw new AppError(
              409,
              'ENTRYPOINT_UNRESOLVED',
              'The exact governed subject is unavailable',
            );
          }
          if (parsed.entryResourceVersionId !== first.entryResourceVersionId) {
            throw new AppError(
              422,
              'ENTRYPOINT_RELEASE_MISMATCH',
              'Approval must bind the exact entry resource reviewed for this group',
            );
          }
          if (parsed.maxRuns < runs.length) {
            throw new AppError(
              422,
              'AUTHORITY_ENVELOPE_INSUFFICIENT',
              'The proposed authority does not cover every reviewed run',
              { blockers: ['Run budget is smaller than the reviewed request group'] },
            );
          }
          const aggregateEstimatedCost = runs.reduce(
            (total, run) => total + Number(run.estimatedUpperCostUsd),
            0,
          );
          if (parsed.totalCostBudgetUsd + Number.EPSILON < aggregateEstimatedCost) {
            throw new AppError(
              422,
              'AUTHORITY_ENVELOPE_INSUFFICIENT',
              'The proposed authority does not cover every reviewed run',
              { blockers: ['Total cost budget is smaller than the reviewed request group'] },
            );
          }
          if (
            runs.some(
              (run) =>
                run.releaseId !== first.releaseId ||
                run.releaseDigest !== first.releaseDigest ||
                run.entryResourceVersionId !== first.entryResourceVersionId ||
                run.contextDigest !== first.contextDigest ||
                run.projectId !== first.projectId ||
                run.workspaceId !== first.workspaceId ||
                run.departmentId !== first.departmentId,
            )
          ) {
            throw new AppError(
              409,
              'ATTENTION_GROUP_CHANGED',
              'The authority identity changed before the decision was recorded',
            );
          }
          const release = await transaction.releaseBundle.findFirst({
            where: {
              id: first.releaseId,
              workspaceId: first.workspaceId,
              departmentId: first.departmentId,
            },
            include: { resources: { include: { resourceVersion: { include: { family: true } } } } },
          });
          if (release === null || release.digest !== first.releaseDigest) {
            throw new AppError(409, 'RELEASE_CHANGED', 'The exact release digest is unavailable');
          }
          const pluginScopes = await this.materializePluginScopes(
            release,
            first.entryResourceVersionId,
            parsed.pluginScopes,
            transaction,
          );
          const grant = await transaction.authorityGrant.create({
            data: {
              workspaceId: first.workspaceId,
              departmentId: first.departmentId,
              releaseId: release.id,
              entryResourceVersionId: first.entryResourceVersionId,
              releaseDigest: release.digest,
              contextDigest: first.contextDigest,
              projectId: parsed.projectId,
              inputConstraints: toPrismaJson(
                jsonObjectSchema,
                parsed.inputConstraints,
                'AuthorityGrant.inputConstraints',
              ),
              toolScopes: toPrismaJson(
                stringArraySchema,
                parsed.toolScopes,
                'AuthorityGrant.toolScopes',
              ),
              pluginScopes: toPrismaJson(
                pluginAuthorityScopesSchema,
                pluginScopes,
                'AuthorityGrant.pluginScopes',
              ),
              validUntil: new Date(parsed.validUntil),
              maxRuns: parsed.maxRuns,
              maxEstimatedCostPerRunUsd: parsed.maxEstimatedCostPerRunUsd,
              totalCostBudgetUsd: parsed.totalCostBudgetUsd,
              actorId: actor,
              rationale: parsed.rationale,
            },
          });
          for (const run of runs) {
            if (run.requiresPluginApproval && runs.length !== 1) {
              throw new AppError(
                409,
                'PLUGIN_APPROVAL_MUST_BE_RUN_SPECIFIC',
                'Approval-required Plugin actions cannot share a grouped decision',
              );
            }
            const blockers = this.grantBlockers(
              grant,
              release,
              first.entryResourceVersionId,
              run.contextDigest,
              parseJson(jsonObjectSchema, run.input, 'ExecutionRun.input'),
              runScopesFromRecord(run),
              parseJson(
                runPluginRequirementsSchema,
                run.requiredPluginScopes,
                'ExecutionRun.requiredPluginScopes',
              ),
              Number(run.estimatedUpperCostUsd),
              true,
            );
            if (blockers.length > 0) {
              throw new AppError(
                422,
                'AUTHORITY_ENVELOPE_INSUFFICIENT',
                'The proposed authority does not cover every reviewed run',
                { blockers },
              );
            }
          }
          const updatedRuns = await transaction.executionRun.updateMany({
            where: {
              id: { in: runIds },
              state: ExecutionRunState.AWAITING_APPROVAL,
              ...mutationScope,
            },
            data: {
              authorityGrantId: grant.id,
              state: ExecutionRunState.QUEUED,
              approvalReasons: toPrismaJson(stringArraySchema, [], 'ExecutionRun.approvalReasons'),
              message: 'Queued',
            },
          });
          if (updatedRuns.count !== runs.length) {
            throw new AppError(
              409,
              'ATTENTION_GROUP_CHANGED',
              'A reviewed run changed before the decision was recorded',
            );
          }
          const updatedApprovals = await transaction.approvalRequest.updateMany({
            where: { id: { in: approvalIds }, state: ApprovalRequestState.PENDING },
            data: {
              state: ApprovalRequestState.APPROVED,
              decisionGroupKey: groupKey,
              decisionGroupSize: runs.length,
              decidedBy: actor,
              rationale: parsed.rationale,
              decidedAt: new Date(),
            },
          });
          if (updatedApprovals.count !== runs.length) {
            throw new AppError(
              409,
              'ATTENTION_GROUP_CHANGED',
              'An authority request changed before the decision was recorded',
            );
          }
          const records = await transaction.executionRun.findMany({
            where: { id: { in: runIds }, ...mutationScope },
            include: executionRunSubjectInclude,
            orderBy: { createdAt: 'asc' },
          });
          for (const run of records) {
            await appendAuditEvent(transaction, {
              action: 'execution.approved',
              entityType: 'ExecutionRun',
              entityId: run.id,
              details: {
                authorityGrantId: grant.id,
                releaseDigest: release.digest,
                approvalGroupKey: groupKey,
                approvalGroupSize: records.length,
              },
            });
            await appendExecutionRunEvent(transaction, run, {
              phase: 'authority',
              state: 'approved',
              message: `A human approved bounded authority for ${records.length} matching pending ${records.length === 1 ? 'run' : 'runs'}.`,
            });
          }
          return { grant, runs: records };
        },
        { isolationLevel: 'Serializable' },
      ),
    );
    return approveExecutionRunGroupResponseSchema.parse({
      groupKey,
      grant: toGrant(result.grant),
      runs: result.runs.map(toRun),
    });
  }

  async rejectRunGroup(
    groupKey: string,
    input: z.input<typeof rejectExecutionRunRequestSchema>,
  ): Promise<z.infer<typeof rejectExecutionRunGroupResponseSchema>> {
    const actor = requireHumanActor();
    const mutationScope = governedExecutionMutationScope();
    const { rationale } = rejectExecutionRunRequestSchema.parse(input);
    const runs = await retrySerializableTransaction(() =>
      this.prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${mutationScope.workspaceId}:${mutationScope.departmentId ?? 'workspace'}:execution-approval-group:${groupKey}`}))`;
          const decided = await transaction.approvalRequest.findMany({
            where: { decisionGroupKey: groupKey, run: mutationScope },
            include: executionApprovalInclude,
            orderBy: { id: 'asc' },
          });
          if (decided.length > 0) {
            this.assertCompleteDecisionGroup(decided);
            if (
              decided.some(
                ({ state, rationale: storedRationale }) =>
                  state !== ApprovalRequestState.REJECTED || storedRationale !== rationale,
              )
            ) {
              throw new AppError(
                409,
                'ATTENTION_GROUP_ALREADY_DECIDED',
                'This authority group already has a different immutable decision',
              );
            }
            return decided.map(({ run }) => run);
          }
          const pending = await transaction.approvalRequest.findMany({
            where: {
              state: ApprovalRequestState.PENDING,
              run: { ...mutationScope, state: ExecutionRunState.AWAITING_APPROVAL },
            },
            include: executionApprovalInclude,
            orderBy: { createdAt: 'asc' },
          });
          const group = groupExecutionApprovals(pending).find(
            (candidate) => candidate.groupKey === groupKey,
          );
          if (group === undefined) {
            throw new AppError(
              404,
              'ATTENTION_GROUP_NOT_FOUND',
              'The reviewed authority group is no longer pending',
            );
          }
          const runIds = group.approvals.map(({ run }) => run.id).sort();
          const approvalIds = group.approvals.map(({ id }) => id).sort();
          await this.lockExecutionDecisions(transaction, runIds, mutationScope);
          const locked = await transaction.approvalRequest.findMany({
            where: {
              id: { in: approvalIds },
              state: ApprovalRequestState.PENDING,
              run: { ...mutationScope, state: ExecutionRunState.AWAITING_APPROVAL },
            },
            include: executionApprovalInclude,
            orderBy: { createdAt: 'asc' },
          });
          const lockedGroup = groupExecutionApprovals(locked).find(
            (candidate) => candidate.groupKey === groupKey,
          );
          if (lockedGroup === undefined || lockedGroup.approvals.length !== approvalIds.length) {
            throw new AppError(
              409,
              'ATTENTION_GROUP_CHANGED',
              'The authority group changed before the decision was recorded; refresh and review it again',
            );
          }
          const finishedAt = new Date();
          const updatedRuns = await transaction.executionRun.updateMany({
            where: {
              id: { in: runIds },
              state: ExecutionRunState.AWAITING_APPROVAL,
              ...mutationScope,
            },
            data: { state: ExecutionRunState.CANCELLED, message: 'Rejected', finishedAt },
          });
          if (updatedRuns.count !== runIds.length) {
            throw new AppError(
              409,
              'ATTENTION_GROUP_CHANGED',
              'A reviewed run changed before the decision was recorded',
            );
          }
          const updatedApprovals = await transaction.approvalRequest.updateMany({
            where: { id: { in: approvalIds }, state: ApprovalRequestState.PENDING },
            data: {
              state: ApprovalRequestState.REJECTED,
              decisionGroupKey: groupKey,
              decisionGroupSize: runIds.length,
              decidedBy: actor,
              rationale,
              decidedAt: finishedAt,
            },
          });
          if (updatedApprovals.count !== runIds.length) {
            throw new AppError(
              409,
              'ATTENTION_GROUP_CHANGED',
              'An authority request changed before the decision was recorded',
            );
          }
          const records = await transaction.executionRun.findMany({
            where: { id: { in: runIds }, ...mutationScope },
            include: executionRunSubjectInclude,
            orderBy: { createdAt: 'asc' },
          });
          for (const run of records) {
            await appendExecutionRunEvent(transaction, run, {
              phase: 'authority',
              state: 'rejected',
              message: `A human rejected ${records.length} matching pending ${records.length === 1 ? 'run' : 'runs'}.`,
              occurredAt: finishedAt,
            });
            await appendPlatformEvent(transaction, {
              kind: 'execution.rejected',
              entityType: 'ExecutionRun',
              entityId: run.id,
              summary: { releaseId: run.releaseId, rationale, approvalGroupKey: groupKey },
              occurredAt: finishedAt,
            });
            await recordDigestDeliveryForRun(transaction, run, {
              state: 'failed',
              code: 'RUN_REJECTED',
            });
            await appendAuditEvent(transaction, {
              action: 'execution.rejected',
              entityType: 'ExecutionRun',
              entityId: run.id,
              details: { rationale, approvalGroupKey: groupKey, approvalGroupSize: records.length },
            });
          }
          return records;
        },
        { isolationLevel: 'Serializable' },
      ),
    );
    return rejectExecutionRunGroupResponseSchema.parse({
      groupKey,
      runs: runs.map(toRun),
    });
  }

  private sameApprovalEnvelope(
    grant: DatabaseAuthorityGrant,
    parsed: z.output<typeof approveExecutionRunRequestSchema>,
  ): boolean {
    const storedPluginScopes = parseJson(
      pluginAuthorityScopesSchema,
      grant.pluginScopes,
      'AuthorityGrant.pluginScopes',
    ).map(({ installationId, pluginVersionId, tool, limits }) => ({
      installationId,
      pluginVersionId,
      tool,
      limits,
    }));
    const normalize = (values: unknown[]) =>
      [...values].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
    return (
      grant.entryResourceVersionId === parsed.entryResourceVersionId &&
      grant.projectId === parsed.projectId &&
      canonicalJson(
        parseJson(jsonObjectSchema, grant.inputConstraints, 'AuthorityGrant.inputConstraints'),
      ) === canonicalJson(parsed.inputConstraints) &&
      canonicalJson(
        normalize(parseJson(stringArraySchema, grant.toolScopes, 'AuthorityGrant.toolScopes')),
      ) === canonicalJson(normalize(parsed.toolScopes)) &&
      canonicalJson(normalize(storedPluginScopes)) ===
        canonicalJson(normalize(parsed.pluginScopes)) &&
      grant.validUntil.getTime() === new Date(parsed.validUntil).getTime() &&
      grant.maxRuns === parsed.maxRuns &&
      Number(grant.maxEstimatedCostPerRunUsd) === parsed.maxEstimatedCostPerRunUsd &&
      Number(grant.totalCostBudgetUsd) === parsed.totalCostBudgetUsd &&
      grant.rationale === parsed.rationale
    );
  }

  private assertCompleteDecisionGroup(
    decisions: Array<{ decisionGroupSize: number | null }>,
  ): void {
    const expectedSizes = new Set(decisions.map(({ decisionGroupSize }) => decisionGroupSize));
    const expectedSize = expectedSizes.size === 1 ? ([...expectedSizes][0] ?? null) : null;
    if (expectedSize === null || expectedSize !== decisions.length) {
      throw new AppError(
        409,
        'ATTENTION_GROUP_MEMBERSHIP_CHANGED',
        'The original authority group is no longer intact; refresh and review the pending requests again',
      );
    }
  }

  async rejectRun(
    runId: string,
    input: z.input<typeof rejectExecutionRunRequestSchema>,
  ): Promise<ExecutionRun> {
    const actor = requireHumanActor();
    const mutationScope = governedExecutionMutationScope();
    const { rationale } = rejectExecutionRunRequestSchema.parse(input);
    const result = await retrySerializableTransaction(() =>
      this.prisma.$transaction(
        async (transaction) => {
          await this.lockExecutionDecisions(transaction, [runId], mutationScope);
          const run = await transaction.executionRun.findFirst({
            where: { id: runId, ...mutationScope },
          });
          if (run === null) {
            throw new AppError(404, 'EXECUTION_RUN_NOT_FOUND', 'Execution run was not found');
          }
          if (run.state !== ExecutionRunState.AWAITING_APPROVAL) {
            throw new AppError(
              409,
              'RUN_NOT_AWAITING_APPROVAL',
              'Only a run awaiting approval can be rejected',
            );
          }
          const approval = await transaction.approvalRequest.findUnique({ where: { runId } });
          if (approval?.state !== ApprovalRequestState.PENDING) {
            throw new AppError(
              409,
              'APPROVAL_ALREADY_DECIDED',
              'The authority request has already been decided',
            );
          }
          const finishedAt = new Date();
          const updatedRuns = await transaction.executionRun.updateMany({
            where: {
              id: runId,
              state: ExecutionRunState.AWAITING_APPROVAL,
              ...mutationScope,
            },
            data: { state: ExecutionRunState.CANCELLED, message: 'Rejected', finishedAt },
          });
          if (updatedRuns.count !== 1) {
            throw new AppError(
              409,
              'RUN_NOT_AWAITING_APPROVAL',
              'The run changed before the rejection was recorded',
            );
          }
          const updatedApprovals = await transaction.approvalRequest.updateMany({
            where: { runId, state: ApprovalRequestState.PENDING, decisionGroupKey: null },
            data: {
              state: ApprovalRequestState.REJECTED,
              decidedBy: actor,
              rationale,
              decidedAt: finishedAt,
            },
          });
          if (updatedApprovals.count !== 1) {
            throw new AppError(
              409,
              'APPROVAL_ALREADY_DECIDED',
              'The authority request changed before the rejection was recorded',
            );
          }
          await appendExecutionRunEvent(transaction, run, {
            phase: 'authority',
            state: 'rejected',
            message: 'A human rejected this run request.',
            occurredAt: finishedAt,
          });
          await appendPlatformEvent(transaction, {
            kind: 'execution.rejected',
            entityType: 'ExecutionRun',
            entityId: runId,
            summary: { releaseId: run.releaseId, rationale },
            occurredAt: finishedAt,
          });
          await recordDigestDeliveryForRun(transaction, run, {
            state: 'failed',
            code: 'RUN_REJECTED',
          });
          await appendAuditEvent(transaction, {
            action: 'execution.rejected',
            entityType: 'ExecutionRun',
            entityId: runId,
            details: { rationale },
          });
          return transaction.executionRun.findUniqueOrThrow({
            where: { id: runId },
            include: executionRunSubjectInclude,
          });
        },
        { isolationLevel: 'Serializable' },
      ),
    );
    return toRun(result);
  }

  async getRun(runId: string): Promise<ExecutionRun> {
    const record = await this.prisma.executionRun.findFirst({
      where: { id: runId, ...aggregateScopeWhere() },
      include: executionRunSubjectInclude,
    });
    if (record === null)
      throw new AppError(404, 'EXECUTION_RUN_NOT_FOUND', 'Execution run was not found');
    return toRun(record);
  }

  async cancelRun(runId: string): Promise<ExecutionRun> {
    const actor = currentActorId();
    const mutationScope = governedExecutionMutationScope();
    const result = await retrySerializableTransaction(() =>
      this.prisma.$transaction(
        async (transaction) => {
          await this.lockExecutionDecisions(transaction, [runId], mutationScope);
          const run = await transaction.executionRun.findFirst({
            where: { id: runId, ...mutationScope },
          });
          if (run === null)
            throw new AppError(404, 'EXECUTION_RUN_NOT_FOUND', 'Execution run was not found');
          if (
            run.state === ExecutionRunState.SUCCEEDED ||
            run.state === ExecutionRunState.FAILED ||
            run.state === ExecutionRunState.CANCELLED
          ) {
            throw new AppError(409, 'RUN_TERMINAL', 'A terminal execution run cannot be cancelled');
          }
          const running = run.state === ExecutionRunState.RUNNING;
          const updatedRuns = await transaction.executionRun.updateMany({
            where: { id: runId, state: run.state, ...mutationScope },
            data: running
              ? { cancelRequestedAt: new Date(), message: 'Cancellation requested' }
              : {
                  state: ExecutionRunState.CANCELLED,
                  finishedAt: new Date(),
                  message: 'Cancelled',
                },
          });
          if (updatedRuns.count !== 1) {
            throw new AppError(409, 'RUN_STATE_CHANGED', 'The run changed before cancellation');
          }
          const updated = await transaction.executionRun.findUniqueOrThrow({
            where: { id: runId },
            include: executionRunSubjectInclude,
          });
          if (!running) {
            await transaction.approvalRequest.updateMany({
              where: {
                runId,
                state: ApprovalRequestState.PENDING,
                decisionGroupKey: null,
              },
              data: {
                state: ApprovalRequestState.CANCELLED,
                decidedBy: actor,
                decidedAt: new Date(),
              },
            });
            await appendExecutionRunEvent(transaction, run, {
              phase: 'outcome',
              state: 'cancelled',
              message: 'The run was cancelled before execution began.',
              metadata: { code: 'RUN_CANCELLED' },
            });
            await appendPlatformEvent(transaction, {
              kind: 'execution.cancelled',
              entityType: 'ExecutionRun',
              entityId: runId,
              summary: { code: 'RUN_CANCELLED' },
            });
            await recordDigestDeliveryForRun(transaction, run, {
              state: 'failed',
              code: 'RUN_CANCELLED',
            });
          }
          await appendAuditEvent(transaction, {
            action: 'execution.cancelled',
            entityType: 'ExecutionRun',
            entityId: runId,
          });
          return updated;
        },
        { isolationLevel: 'Serializable' },
      ),
    );
    if (result.cancelRequestedAt !== null) {
      this.activeControllers.get(runId)?.abort(new Error('RUN_CANCELLED'));
    }
    return toRun(result);
  }

  async listOutcomes(runId?: string): Promise<z.infer<typeof outcomeListResponseSchema>> {
    const records = await this.prisma.outcomeRecord.findMany({
      where: {
        run: {
          ...aggregateScopeWhere(),
          AND: [userFacingExecutionRunWhere],
        },
        ...(runId === undefined ? {} : { runId }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return outcomeListResponseSchema.parse({
      items: records.map((record) =>
        outcomeRecordSchema.parse({
          id: record.id,
          runId: record.runId,
          output: parseJson(jsonObjectSchema, record.output, 'OutcomeRecord.output'),
          confidence: record.confidence,
          citations: parseJson(stringArraySchema, record.citations, 'OutcomeRecord.citations'),
          unresolvedItems: parseJson(
            stringArraySchema,
            record.unresolvedItems,
            'OutcomeRecord.unresolvedItems',
          ),
          qualityScore: record.qualityScore,
          createdAt: record.createdAt.toISOString(),
        }),
      ),
    });
  }

  async listMetrics(runId?: string): Promise<z.infer<typeof metricListResponseSchema>> {
    const records = await this.prisma.metricSample.findMany({
      where: {
        ...aggregateScopeWhere(),
        AND: [
          {
            OR: [{ runId: null }, { run: { is: userFacingExecutionRunWhere } }],
          },
        ],
        ...(runId === undefined ? {} : { runId }),
      },
      orderBy: { observedAt: 'desc' },
      take: 500,
    });
    return metricListResponseSchema.parse({
      items: records.map((record) =>
        metricSampleSchema.parse({
          id: record.id,
          runId: record.runId,
          name: record.name,
          value: record.value,
          unit: record.unit,
          metadata: parseJson(jsonObjectSchema, record.metadata, 'MetricSample.metadata'),
          observedAt: record.observedAt.toISOString(),
        }),
      ),
    });
  }

  async recoverExpiredLeases(): Promise<number> {
    const expired = await this.prisma.executionRun.findMany({
      where: {
        ...aggregateScopeWhere(),
        state: ExecutionRunState.RUNNING,
        leaseExpiresAt: { lt: new Date() },
      },
      select: { id: true },
    });
    for (const { id } of expired) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "ExecutionRun"
          WHERE "id" = ${id}::uuid
          FOR UPDATE
        `;
        const run = await transaction.executionRun.findUnique({ where: { id } });
        if (
          run === null ||
          run.state !== ExecutionRunState.RUNNING ||
          run.leaseExpiresAt === null ||
          run.leaseExpiresAt.getTime() >= Date.now()
        ) {
          return;
        }
        await this.reconcileReservation(transaction, run);
        const cancelled = run.cancelRequestedAt !== null;
        const exhausted = run.attempts >= run.maxAttempts;
        const recoveredState = cancelled
          ? ExecutionRunState.CANCELLED
          : exhausted
            ? ExecutionRunState.FAILED
            : ExecutionRunState.QUEUED;
        await transaction.executionRun.update({
          where: { id },
          data: {
            state: recoveredState,
            message: cancelled
              ? 'Cancelled during worker recovery'
              : exhausted
                ? 'Execution retry limit exhausted after worker interruption'
                : 'Recovered after worker interruption',
            error: exhausted
              ? toPrismaJson(
                  jsonObjectSchema,
                  { code: 'WORKER_LEASE_EXHAUSTED' },
                  'ExecutionRun.error',
                )
              : Prisma.DbNull,
            finishedAt: cancelled || exhausted ? new Date() : null,
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
          },
        });
        await appendExecutionRunEvent(transaction, run, {
          phase: 'worker-recovery',
          state: cancelled ? 'cancelled' : exhausted ? 'failed' : 'queued',
          message: cancelled
            ? 'Worker recovery completed a pending cancellation.'
            : exhausted
              ? 'Worker recovery exhausted the retry limit.'
              : 'Worker recovery returned the run to the queue.',
          metadata: { attempt: run.attempts, maxAttempts: run.maxAttempts },
        });
        await appendAuditEvent(transaction, {
          action: cancelled
            ? 'execution.recovery_cancelled'
            : exhausted
              ? 'execution.recovery_failed'
              : 'execution.requeued_after_restart',
          entityType: 'ExecutionRun',
          entityId: run.id,
          details:
            cancelled || exhausted
              ? { code: cancelled ? 'RUN_CANCELLED' : 'WORKER_LEASE_EXHAUSTED' }
              : { attempt: run.attempts, maxAttempts: run.maxAttempts },
        });
        if (cancelled || exhausted) {
          const code = cancelled ? 'RUN_CANCELLED' : 'WORKER_LEASE_EXHAUSTED';
          await appendPlatformEvent(transaction, {
            kind: cancelled ? 'execution.cancelled' : 'execution.failed',
            entityType: 'ExecutionRun',
            entityId: run.id,
            summary: { code },
          });
          await recordDigestDeliveryForRun(transaction, run, { state: 'failed', code });
        }
      });
    }
    return expired.length;
  }

  async queuedRunIds(limit = 100): Promise<string[]> {
    const rows = await this.prisma.executionRun.findMany({
      where: { state: ExecutionRunState.QUEUED, ...aggregateScopeWhere() },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    return rows.map(({ id }) => id);
  }

  async claim(runId: string, workerId: string, leaseMs = 60_000): Promise<boolean> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "ExecutionRun"
          WHERE "id" = ${runId}::uuid
          FOR UPDATE
        `;
        const run = await transaction.executionRun.findFirst({
          where: { id: runId, ...aggregateScopeWhere() },
          include: {
            release: {
              include: {
                resources: { include: { resourceVersion: { include: { family: true } } } },
              },
            },
          },
        });
        if (
          run === null ||
          run.state !== ExecutionRunState.QUEUED ||
          run.authorityGrantId === null ||
          run.legacyEntrypointUnresolved ||
          run.entryResourceVersionId === null
        ) {
          return false;
        }
        await transaction.$queryRaw`
          SELECT "id" FROM "AuthorityGrant"
          WHERE "id" = ${run.authorityGrantId}::uuid
          FOR UPDATE
        `;
        const grant = await transaction.authorityGrant.findFirst({
          where: {
            id: run.authorityGrantId,
            workspaceId: run.workspaceId,
            departmentId: run.departmentId,
          },
        });
        const input = parseJson(jsonObjectSchema, run.input, 'ExecutionRun.input');
        const requiredTools = parseJson(
          stringArraySchema,
          run.requiredToolScopes,
          'ExecutionRun.requiredToolScopes',
        );
        const firstAttempt = run.attempts === 0;
        const blockers = this.grantBlockers(
          grant,
          run.release,
          run.entryResourceVersionId,
          run.contextDigest,
          input,
          requiredTools,
          parseJson(
            runPluginRequirementsSchema,
            run.requiredPluginScopes,
            'ExecutionRun.requiredPluginScopes',
          ),
          Number(run.estimatedUpperCostUsd),
          !run.requiresPluginApproval ||
            (await transaction.approvalRequest.findFirst({
              where: {
                runId: run.id,
                state: ApprovalRequestState.APPROVED,
                decidedBy: { not: null },
                rationale: { not: null },
              },
              select: { id: true },
            })) !== null,
        ).filter(
          (blocker) =>
            !(
              !firstAttempt &&
              grant?.state === AuthorityGrantState.EXHAUSTED &&
              (blocker === 'Authority grant is exhausted' ||
                blocker === 'Authority grant run budget is exhausted')
            ),
        );
        if (!run.developmentDraft) {
          const channel = await transaction.productionChannel.findFirst({
            where: {
              key: run.projectId ?? 'default',
              workspaceId: run.workspaceId,
              departmentId: run.departmentId,
            },
          });
          if (channel?.currentReleaseId !== run.releaseId) {
            blockers.unshift('Release is no longer the current production release');
          } else {
            const approvedForEpoch =
              channel.promotedAt !== null &&
              (await transaction.approvalRequest.findFirst({
                where: {
                  state: ApprovalRequestState.APPROVED,
                  decidedAt: { gte: channel.promotedAt },
                  decidedBy: { not: null },
                  run: {
                    is: {
                      releaseId: run.releaseId,
                      releaseDigest: run.releaseDigest,
                      developmentDraft: false,
                    },
                  },
                },
                select: { id: true },
              })) !== null;
            if (!approvedForEpoch) {
              blockers.unshift(
                'First run of this production release epoch requires human approval',
              );
            }
          }
        }
        if (grant === null || blockers.length > 0) {
          const reasons = blockers.length > 0 ? blockers : ['Authority grant is unavailable'];
          await transaction.executionRun.update({
            where: { id: run.id },
            data: {
              state: ExecutionRunState.AWAITING_APPROVAL,
              authorityGrantId: null,
              approvalReasons: toPrismaJson(
                stringArraySchema,
                reasons,
                'ExecutionRun.approvalReasons',
              ),
              message: 'Authority is unavailable or outside its approved envelope',
            },
          });
          await transaction.approvalRequest.upsert({
            where: { runId: run.id },
            create: {
              runId: run.id,
              reasons: toPrismaJson(stringArraySchema, reasons, 'ApprovalRequest.reasons'),
              requestedBy: run.requestedBy,
            },
            update: {
              state: ApprovalRequestState.PENDING,
              requestVersion: { increment: 1 },
              decisionGroupKey: null,
              decisionGroupSize: null,
              reasons: toPrismaJson(stringArraySchema, reasons, 'ApprovalRequest.reasons'),
              requestedBy: run.requestedBy,
              decidedBy: null,
              rationale: null,
              decidedAt: null,
            },
          });
          await appendAuditEvent(transaction, {
            action: 'execution.authority_revalidation_failed',
            entityType: 'ExecutionRun',
            entityId: run.id,
            details: { blockers: reasons },
          });
          return false;
        }
        const usedRuns = grant.usedRuns + (firstAttempt ? 1 : 0);
        const reservedCostUsd = Number(grant.reservedCostUsd) + Number(run.estimatedUpperCostUsd);
        await transaction.authorityGrant.update({
          where: { id: grant.id },
          data: {
            usedRuns,
            reservedCostUsd,
            ...(usedRuns >= grant.maxRuns ||
            Number(grant.spentCostUsd) + reservedCostUsd >= Number(grant.totalCostBudgetUsd)
              ? { state: AuthorityGrantState.EXHAUSTED }
              : {}),
          },
        });
        const now = new Date();
        const result = await transaction.executionRun.updateMany({
          where: { id: runId, state: ExecutionRunState.QUEUED },
          data: {
            state: ExecutionRunState.RUNNING,
            message: 'Executing',
            progress: 10,
            attempts: { increment: 1 },
            leaseOwner: workerId,
            leaseExpiresAt: new Date(now.getTime() + leaseMs),
            heartbeatAt: now,
            startedAt: run.startedAt ?? now,
          },
        });
        return result.count === 1;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async heartbeat(runId: string, workerId: string, leaseMs = 60_000): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.executionRun.updateMany({
      where: {
        id: runId,
        state: ExecutionRunState.RUNNING,
        leaseOwner: workerId,
        ...aggregateScopeWhere(),
      },
      data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + leaseMs) },
    });
    return result.count === 1;
  }

  async executeClaimed(runId: string, workerId: string): Promise<void> {
    const started = performance.now();
    const run = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "ExecutionRun"
          WHERE "id" = ${runId}::uuid
          FOR UPDATE
        `;
        const candidate = await transaction.executionRun.findFirst({
          where: {
            id: runId,
            state: ExecutionRunState.RUNNING,
            leaseOwner: workerId,
            ...aggregateScopeWhere(),
          },
          include: {
            release: {
              include: {
                resources: { include: { resourceVersion: { include: { family: true } } } },
              },
            },
          },
        });
        if (candidate === null) return null;
        if (candidate.cancelRequestedAt !== null) {
          await this.reconcileReservation(transaction, candidate, {
            refundRun: candidate.attempts === 1,
          });
          await transaction.executionRun.update({
            where: { id: candidate.id },
            data: {
              state: ExecutionRunState.CANCELLED,
              message: 'Cancelled before provider execution',
              finishedAt: new Date(),
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
            },
          });
          return null;
        }
        if (candidate.authorityGrantId === null) {
          await this.pauseClaimedForAuthority(transaction, candidate, [
            'Authority grant is unavailable',
          ]);
          return null;
        }
        await transaction.$queryRaw`
          SELECT "id" FROM "AuthorityGrant"
          WHERE "id" = ${candidate.authorityGrantId}::uuid
          FOR UPDATE
        `;
        const grant = await transaction.authorityGrant.findFirst({
          where: {
            id: candidate.authorityGrantId,
            workspaceId: candidate.workspaceId,
            departmentId: candidate.departmentId,
          },
        });
        const perRunPluginApproved =
          !candidate.requiresPluginApproval ||
          (await transaction.approvalRequest.findFirst({
            where: {
              runId: candidate.id,
              state: ApprovalRequestState.APPROVED,
              decidedBy: { not: null },
              rationale: { not: null },
            },
            select: { id: true },
          })) !== null;
        const blockers = this.claimedGrantBlockers(
          grant,
          candidate,
          candidate.release,
          perRunPluginApproved,
        );
        if (blockers.length > 0) {
          await this.pauseClaimedForAuthority(transaction, candidate, blockers);
          return null;
        }
        return candidate;
      },
      { isolationLevel: 'Serializable' },
    );
    if (run === null) return;
    const input = dailyBriefInputSchema.parse(
      parseJson(jsonObjectSchema, run.input, 'ExecutionRun.input'),
    );
    let executionContext: AssembledContext;
    try {
      executionContext = await this.executionContext();
    } catch {
      await this.failClaimed(runId, workerId, 'EXECUTION_CONTEXT_UNAVAILABLE');
      return;
    }
    if (executionContext.digest !== run.contextDigest) {
      await this.failClaimed(runId, workerId, 'EXECUTION_CONTEXT_SNAPSHOT_MISMATCH');
      return;
    }
    const controller = new AbortController();
    this.activeControllers.set(runId, controller);
    const monitor = setInterval(
      () => {
        void this.prisma.executionRun
          .findUnique({ where: { id: runId }, include: { authorityGrant: true } })
          .then((latest) => {
            if (
              latest === null ||
              latest.state !== ExecutionRunState.RUNNING ||
              latest.leaseOwner !== workerId ||
              latest.cancelRequestedAt !== null ||
              latest.authorityGrant === null ||
              latest.authorityGrant.state === AuthorityGrantState.REVOKED ||
              latest.authorityGrant.state === AuthorityGrantState.EXPIRED ||
              latest.authorityGrant.validUntil.getTime() <= Date.now()
            ) {
              controller.abort(new Error('EXECUTION_AUTHORITY_OR_LEASE_LOST'));
            } else {
              void this.heartbeat(runId, workerId, this.config.execution.leaseMs);
            }
          })
          .catch(() => controller.abort(new Error('EXECUTION_MONITOR_FAILED')));
      },
      Math.min(5_000, Math.max(1_000, Math.floor(this.config.execution.leaseMs / 3))),
    );
    try {
      const response = await collectModelStream(
        this.provider,
        {
          system:
            'Create a concise daily briefing. Return only JSON matching the requested output contract. Use only calendar:<startsAt> citations that correspond exactly to supplied calendar items. Never invent source facts or citations.',
          input,
          context: providerContextValues(executionContext),
          maxOutputTokens: run.maxOutputTokens,
          timeoutMs: this.config.model.timeoutMs,
        },
        controller.signal,
      );
      if (
        response.usage.inputTokens > run.maxInputTokens ||
        response.usage.outputTokens > run.maxOutputTokens
      ) {
        throw new Error('MODEL_TOKEN_BUDGET_EXCEEDED');
      }
      const output = dailyBriefOutputSchema.parse(extractJson(response.text));
      const invalidCitations = invalidDailyBriefCitations(input, output);
      if (invalidCitations.length > 0) throw new Error('MODEL_CITATION_VALIDATION_FAILED');
      const actualCost =
        (response.usage.inputTokens * this.config.model.inputUsdPerMillionTokens +
          response.usage.outputTokens * this.config.model.outputUsdPerMillionTokens) /
        1_000_000;
      const latencyMs = performance.now() - started;
      const qualityScore = scoreDailyBriefQuality(input, output);
      await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
            SELECT "id" FROM "ExecutionRun"
            WHERE "id" = ${runId}::uuid
            FOR UPDATE
          `;
          const latest = await transaction.executionRun.findUnique({ where: { id: runId } });
          if (
            latest === null ||
            latest.state !== ExecutionRunState.RUNNING ||
            latest.leaseOwner !== workerId
          ) {
            return;
          }
          if (latest.cancelRequestedAt !== null) {
            await this.reconcileReservation(transaction, latest, { actualCostUsd: actualCost });
            await transaction.executionRun.update({
              where: { id: runId },
              data: {
                state: ExecutionRunState.CANCELLED,
                message: 'Cancelled',
                actualCostUsd: actualCost,
                finishedAt: new Date(),
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
              },
            });
            await appendExecutionRunEvent(transaction, latest, {
              phase: 'outcome',
              state: 'cancelled',
              message: 'The run was cancelled before its outcome was committed.',
              costUsd: actualCost,
            });
            await appendPlatformEvent(transaction, {
              kind: 'execution.cancelled',
              entityType: 'ExecutionRun',
              entityId: runId,
              summary: { costUsd: actualCost },
            });
            await recordDigestDeliveryForRun(transaction, latest, {
              state: 'failed',
              code: 'RUN_CANCELLED',
            });
            return;
          }
          if (actualCost > Number(latest.estimatedUpperCostUsd) + Number.EPSILON) {
            throw new Error('MODEL_COST_EXCEEDED_RESERVED_BUDGET');
          }
          await transaction.outcomeRecord.create({
            data: {
              runId,
              output: toPrismaJson(dailyBriefOutputSchema, output, 'OutcomeRecord.output'),
              confidence: output.confidence,
              citations: toPrismaJson(
                stringArraySchema,
                output.citations,
                'OutcomeRecord.citations',
              ),
              unresolvedItems: toPrismaJson(
                stringArraySchema,
                output.unresolvedItems,
                'OutcomeRecord.unresolvedItems',
              ),
              qualityScore,
            },
          });
          await transaction.metricSample.createMany({
            data: [
              {
                workspaceId: latest.workspaceId,
                departmentId: latest.departmentId,
                runId,
                name: 'model.input_tokens',
                value: response.usage.inputTokens,
                unit: 'tokens',
              },
              {
                workspaceId: latest.workspaceId,
                departmentId: latest.departmentId,
                runId,
                name: 'model.output_tokens',
                value: response.usage.outputTokens,
                unit: 'tokens',
              },
              {
                workspaceId: latest.workspaceId,
                departmentId: latest.departmentId,
                runId,
                name: 'model.cost',
                value: actualCost,
                unit: 'usd',
                metadata: { pricingVersion: this.config.model.pricingVersion },
              },
              {
                workspaceId: latest.workspaceId,
                departmentId: latest.departmentId,
                runId,
                name: 'run.latency',
                value: latencyMs,
                unit: 'ms',
              },
              {
                workspaceId: latest.workspaceId,
                departmentId: latest.departmentId,
                runId,
                name: 'outcome.quality',
                value: qualityScore,
                unit: 'ratio',
              },
            ],
          });
          await transaction.executionRun.update({
            where: { id: runId },
            data: {
              state: ExecutionRunState.SUCCEEDED,
              message: 'Completed',
              progress: 100,
              actualCostUsd: actualCost,
              finishedAt: new Date(),
              leaseOwner: null,
              leaseExpiresAt: null,
              heartbeatAt: null,
            },
          });
          await this.reconcileReservation(transaction, latest, { actualCostUsd: actualCost });
          await appendAuditEvent(transaction, {
            action: 'execution.succeeded',
            entityType: 'ExecutionRun',
            entityId: runId,
            details: {
              provider: this.provider.kind,
              model: this.provider.model,
              pricingVersion: this.config.model.pricingVersion,
            },
          });
          await appendExecutionRunEvent(transaction, latest, {
            phase: 'outcome',
            state: 'succeeded',
            message: 'The validated Daily Brief outcome completed.',
            durationMs: Math.max(0, Math.round(latencyMs)),
            costUsd: actualCost,
          });
          await appendPlatformEvent(transaction, {
            kind: 'execution.succeeded',
            entityType: 'ExecutionRun',
            entityId: runId,
            summary: { costUsd: actualCost, latencyMs, qualityScore },
          });
          await recordDigestDeliveryForRun(transaction, latest, {
            state: 'delivered',
            costUsd: actualCost,
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } finally {
      clearInterval(monitor);
      this.activeControllers.delete(runId);
    }
  }

  async failClaimed(runId: string, workerId: string, code: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "ExecutionRun"
        WHERE "id" = ${runId}::uuid
        FOR UPDATE
      `;
      const run = await transaction.executionRun.findFirst({
        where: { id: runId, state: ExecutionRunState.RUNNING, leaseOwner: workerId },
      });
      if (run === null) return;
      const cancelled = run.cancelRequestedAt !== null;
      await this.reconcileReservation(transaction, run);
      await transaction.executionRun.update({
        where: { id: runId },
        data: {
          state: cancelled ? ExecutionRunState.CANCELLED : ExecutionRunState.FAILED,
          message: cancelled ? 'Cancelled' : 'Execution failed',
          error: cancelled
            ? Prisma.DbNull
            : toPrismaJson(jsonObjectSchema, { code }, 'ExecutionRun.error'),
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
      });
      await appendAuditEvent(transaction, {
        action: cancelled ? 'execution.cancelled' : 'execution.failed',
        entityType: 'ExecutionRun',
        entityId: runId,
        details: cancelled ? {} : { code },
      });
      await appendExecutionRunEvent(transaction, run, {
        phase: 'outcome',
        state: cancelled ? 'cancelled' : 'failed',
        message: cancelled ? 'The run was cancelled.' : 'The run failed before an outcome.',
        metadata: cancelled ? {} : { code },
      });
      await appendPlatformEvent(transaction, {
        kind: cancelled ? 'execution.cancelled' : 'execution.failed',
        entityType: 'ExecutionRun',
        entityId: runId,
        summary: cancelled ? {} : { code },
      });
      await recordDigestDeliveryForRun(transaction, run, {
        state: 'failed',
        code: cancelled ? 'RUN_CANCELLED' : code,
      });
    });
  }
}
