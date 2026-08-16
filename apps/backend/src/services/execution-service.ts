import {
  ApprovalRequestState,
  AuthorityGrantState,
  ContextClassification,
  ExecutionRunState,
  ModelProviderKind,
  Prisma,
  type AuthorityGrant as DatabaseAuthorityGrant,
  type ExecutionRun as DatabaseExecutionRun,
  type PrismaClient,
} from '@prisma/client';
import {
  approveExecutionRunRequestSchema,
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
  metricListResponseSchema,
  metricSampleSchema,
  outcomeListResponseSchema,
  outcomeRecordSchema,
  resourceManifestSchema,
  skillSpecSchema,
  type AuthorityGrant,
  type ExecutionRun,
  type executionRunStateSchema,
  type JsonValue,
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
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { currentActorId } from '../request-context.js';
import { requireHumanActor } from './actors.js';

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

function toGrant(record: DatabaseAuthorityGrant): AuthorityGrant {
  return authorityGrantSchema.parse({
    id: record.id,
    releaseId: record.releaseId,
    releaseDigest: record.releaseDigest,
    contextDigest: record.contextDigest,
    projectId: record.projectId,
    inputConstraints: parseJson(
      jsonObjectSchema,
      record.inputConstraints,
      'AuthorityGrant.inputConstraints',
    ),
    toolScopes: parseJson(stringArraySchema, record.toolScopes, 'AuthorityGrant.toolScopes'),
    validFrom: record.validFrom.toISOString(),
    validUntil: record.validUntil.toISOString(),
    maxRuns: record.maxRuns,
    usedRuns: record.usedRuns,
    maxEstimatedCostPerRunUsd: Number(record.maxEstimatedCostPerRunUsd),
    totalCostBudgetUsd: Number(record.totalCostBudgetUsd),
    spentCostUsd: Number(record.spentCostUsd),
    reservedCostUsd: Number(record.reservedCostUsd),
    state: grantStateWire[record.state],
    actorId: record.actorId,
    rationale: record.rationale,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  });
}

function toRun(record: DatabaseExecutionRun): ExecutionRun {
  return executionRunSchema.parse({
    id: record.id,
    releaseId: record.releaseId,
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
    authorityGrantId: record.authorityGrantId,
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

function releaseRequirements(release: ReleaseForExecution): {
  requiredTools: string[];
  isDailyBrief: boolean;
} {
  const tools = new Set<string>();
  let isDailyBrief = false;
  for (const item of release.resources) {
    const manifest = parseJson(
      resourceManifestSchema,
      item.resourceVersion.definition,
      'ResourceVersion.definition',
    );
    if (manifest.kind !== 'Skill') continue;
    const spec = skillSpecSchema.parse(manifest.spec);
    spec.tools.forEach((tool) => tools.add(tool));
    if (manifest.metadata.slug === 'daily-brief') isDailyBrief = true;
  }
  return { requiredTools: [...tools], isDailyBrief };
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
    const release = await this.prisma.releaseBundle.findUnique({
      where: { id: releaseId },
      include: {
        resources: { include: { resourceVersion: { include: { family: true } } } },
      },
    });
    if (release === null) throw new AppError(404, 'RELEASE_NOT_FOUND', 'Release was not found');
    return release;
  }

  private grantBlockers(
    grant: DatabaseAuthorityGrant | null,
    release: ReleaseForExecution,
    contextDigest: string,
    input: Record<string, JsonValue>,
    requiredTools: string[],
    estimatedUpperCostUsd: number,
  ): string[] {
    if (grant === null) return ['No authority grant is bound to this release'];
    const blockers: string[] = [];
    const now = Date.now();
    if (grant.state !== AuthorityGrantState.ACTIVE)
      blockers.push(`Authority grant is ${grantStateWire[grant.state]}`);
    if (grant.releaseId !== release.id || grant.releaseDigest !== release.digest)
      blockers.push('Authority grant release digest does not match');
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
    return blockers;
  }

  private claimedGrantBlockers(
    grant: DatabaseAuthorityGrant | null,
    run: DatabaseExecutionRun,
    release: ReleaseForExecution,
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
    const grant = await transaction.authorityGrant.findUnique({
      where: { id: run.authorityGrantId },
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
    await this.prisma.authorityGrant.updateMany({
      where: { state: AuthorityGrantState.ACTIVE, validUntil: { lte: new Date() } },
      data: { state: AuthorityGrantState.EXPIRED },
    });
    const state =
      query.state === undefined
        ? undefined
        : (Object.entries(grantStateWire).find(([, wire]) => wire === query.state)?.[0] as
            | AuthorityGrantState
            | undefined);
    const records = await this.prisma.authorityGrant.findMany({
      where: state === undefined ? {} : { state },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return authorityGrantListResponseSchema.parse({ items: records.map(toGrant) });
  }

  async createGrant(
    input: z.input<typeof createAuthorityGrantRequestSchema>,
  ): Promise<AuthorityGrant> {
    const actor = requireHumanActor();
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
    const record = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.authorityGrant.create({
        data: {
          releaseId: release.id,
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
        details: { releaseId: release.id, releaseDigest: release.digest },
      });
      return created;
    });
    return toGrant(record);
  }

  async revokeGrant(grantId: string): Promise<AuthorityGrant> {
    const actor = requireHumanActor();
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
          AND "state" IN ('queued', 'running')
        ORDER BY "id" ASC
        FOR UPDATE
      `;
          await transaction.$queryRaw`
        SELECT "id"
        FROM "AuthorityGrant"
        WHERE "id" = ${grantId}::uuid
        FOR UPDATE
      `;
          const existing = await transaction.authorityGrant.findUnique({ where: { id: grantId } });
          if (existing === null)
            throw new AppError(404, 'AUTHORITY_GRANT_NOT_FOUND', 'Authority grant was not found');
          if (existing.state === AuthorityGrantState.REVOKED) {
            return { grant: existing, runningRunIds: [] as string[] };
          }
          const queuedRuns = await transaction.executionRun.findMany({
            where: { authorityGrantId: grantId, state: ExecutionRunState.QUEUED },
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
                reasons: toPrismaJson(stringArraySchema, reasons, 'ApprovalRequest.reasons'),
                decidedBy: null,
                rationale: null,
                decidedAt: null,
              },
            });
          }
          const runningRuns = await transaction.executionRun.findMany({
            where: { authorityGrantId: grantId, state: ExecutionRunState.RUNNING },
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
    const records = await this.prisma.executionRun.findMany({
      where: databaseState === undefined ? {} : { state: databaseState },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return executionRunListResponseSchema.parse({ items: records.map(toRun) });
  }

  async createRun(input: z.input<typeof createExecutionRunRequestSchema>): Promise<ExecutionRun> {
    const parsed = createExecutionRunRequestSchema.parse(input);
    const executionContext = await this.executionContext();
    const contextSummary = summarizeExecutionContext(executionContext);
    const idempotent = await this.prisma.executionRun.findUnique({
      where: { idempotencyKey: parsed.idempotencyKey },
    });
    if (idempotent !== null) {
      const sameRequest =
        idempotent.releaseId === parsed.releaseId &&
        idempotent.authorityGrantId === parsed.authorityGrantId &&
        idempotent.contextDigest === executionContext.digest &&
        canonicalJson(parseJson(jsonObjectSchema, idempotent.input, 'ExecutionRun.input')) ===
          canonicalJson(parsed.input) &&
        idempotent.maxInputTokens === parsed.maxInputTokens &&
        idempotent.maxOutputTokens === parsed.maxOutputTokens &&
        Number(idempotent.maxEstimatedCostUsd) === parsed.maxEstimatedCostUsd;
      const sameDevelopmentMode = idempotent.developmentDraft === parsed.developmentDraft;
      if (!sameRequest || !sameDevelopmentMode) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency key is already bound to different run input',
        );
      }
      return toRun(idempotent);
    }
    const release = await this.release(parsed.releaseId);
    const channel = await this.prisma.productionChannel.findUnique({
      where: { key: release.projectId ?? 'default' },
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
    const requirements = releaseRequirements(release);
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
    const estimate = this.estimateUpperCost(parsed.maxInputTokens, parsed.maxOutputTokens);
    const grant =
      parsed.authorityGrantId === null
        ? null
        : await this.prisma.authorityGrant.findUnique({ where: { id: parsed.authorityGrantId } });
    const blockers = this.grantBlockers(
      grant,
      release,
      executionContext.digest,
      parsed.input,
      requirements.requiredTools,
      estimate,
    );
    if (!productionEpochApproved) {
      blockers.unshift('First run of this production release epoch requires human approval');
    }
    const budgetPaused = estimate > parsed.maxEstimatedCostUsd;
    if (budgetPaused) blockers.unshift('Estimated upper cost exceeds the run cost ceiling');
    const state = budgetPaused
      ? ExecutionRunState.PAUSED_BUDGET
      : blockers.length === 0
        ? ExecutionRunState.QUEUED
        : ExecutionRunState.AWAITING_APPROVAL;
    const actor = currentActorId();
    const record = await this.prisma.$transaction(
      async (transaction) => {
        const created = await transaction.executionRun.create({
          data: {
            releaseId: release.id,
            authorityGrantId: state === ExecutionRunState.QUEUED ? (grant?.id ?? null) : null,
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
            state,
            input: toPrismaJson(jsonObjectSchema, parsed.input, 'ExecutionRun.input'),
            providerKind: providerKindMap[this.provider.kind],
            developmentDraft: parsed.developmentDraft,
            providerVersion: this.provider.version,
            model: this.provider.model,
            maxInputTokens: parsed.maxInputTokens,
            maxOutputTokens: parsed.maxOutputTokens,
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
        });
        await appendAuditEvent(transaction, {
          action: 'execution.requested',
          entityType: 'ExecutionRun',
          entityId: created.id,
          details: { releaseId: release.id, state: runStateWire[state] },
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
    const parsed = approveExecutionRunRequestSchema.parse(input);
    if (new Date(parsed.validUntil).getTime() <= Date.now()) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Authority grant must expire in the future');
    }
    const result = await this.prisma.$transaction(
      async (transaction) => {
        const run = await transaction.executionRun.findUnique({ where: { id: runId } });
        if (run === null)
          throw new AppError(404, 'EXECUTION_RUN_NOT_FOUND', 'Execution run was not found');
        if (run.state !== ExecutionRunState.AWAITING_APPROVAL) {
          throw new AppError(
            409,
            'RUN_NOT_AWAITING_APPROVAL',
            'Only an awaiting run can be approved',
          );
        }
        const release = await transaction.releaseBundle.findUnique({
          where: { id: run.releaseId },
          include: { resources: { include: { resourceVersion: { include: { family: true } } } } },
        });
        if (release === null || release.digest !== run.releaseDigest) {
          throw new AppError(409, 'RELEASE_CHANGED', 'The exact release digest is unavailable');
        }
        const grant = await transaction.authorityGrant.create({
          data: {
            releaseId: release.id,
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
          run.contextDigest,
          parseJson(jsonObjectSchema, run.input, 'ExecutionRun.input'),
          releaseRequirements(release).requiredTools,
          Number(run.estimatedUpperCostUsd),
        );
        if (blockers.length > 0) {
          throw new AppError(
            422,
            'AUTHORITY_ENVELOPE_INSUFFICIENT',
            'The proposed authority does not cover this run',
            { blockers },
          );
        }
        const updatedRun = await transaction.executionRun.update({
          where: { id: run.id },
          data: {
            authorityGrantId: grant.id,
            state: ExecutionRunState.QUEUED,
            approvalReasons: toPrismaJson(stringArraySchema, [], 'ExecutionRun.approvalReasons'),
            message: 'Queued',
          },
        });
        await transaction.approvalRequest.update({
          where: { runId },
          data: {
            state: ApprovalRequestState.APPROVED,
            decidedBy: actor,
            rationale: parsed.rationale,
            decidedAt: new Date(),
          },
        });
        await appendAuditEvent(transaction, {
          action: 'execution.approved',
          entityType: 'ExecutionRun',
          entityId: runId,
          details: { authorityGrantId: grant.id, releaseDigest: release.digest },
        });
        return {
          grant: await transaction.authorityGrant.findUniqueOrThrow({ where: { id: grant.id } }),
          run: updatedRun,
        };
      },
      { isolationLevel: 'Serializable' },
    );
    return { grant: toGrant(result.grant), run: toRun(result.run) };
  }

  async getRun(runId: string): Promise<ExecutionRun> {
    const record = await this.prisma.executionRun.findUnique({ where: { id: runId } });
    if (record === null)
      throw new AppError(404, 'EXECUTION_RUN_NOT_FOUND', 'Execution run was not found');
    return toRun(record);
  }

  async cancelRun(runId: string): Promise<ExecutionRun> {
    const actor = currentActorId();
    const result = await this.prisma.$transaction(async (transaction) => {
      const run = await transaction.executionRun.findUnique({ where: { id: runId } });
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
      const updated = await transaction.executionRun.update({
        where: { id: runId },
        data: running
          ? { cancelRequestedAt: new Date(), message: 'Cancellation requested' }
          : { state: ExecutionRunState.CANCELLED, finishedAt: new Date(), message: 'Cancelled' },
      });
      if (!running) {
        await transaction.approvalRequest.updateMany({
          where: { runId, state: ApprovalRequestState.PENDING },
          data: { state: ApprovalRequestState.CANCELLED, decidedBy: actor, decidedAt: new Date() },
        });
      }
      await appendAuditEvent(transaction, {
        action: 'execution.cancelled',
        entityType: 'ExecutionRun',
        entityId: runId,
      });
      return updated;
    });
    if (result.cancelRequestedAt !== null) {
      this.activeControllers.get(runId)?.abort(new Error('RUN_CANCELLED'));
    }
    return toRun(result);
  }

  async listOutcomes(runId?: string): Promise<z.infer<typeof outcomeListResponseSchema>> {
    const records = await this.prisma.outcomeRecord.findMany({
      where: runId === undefined ? {} : { runId },
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
      where: runId === undefined ? {} : { runId },
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
        await transaction.executionRun.update({
          where: { id },
          data: {
            state: cancelled
              ? ExecutionRunState.CANCELLED
              : exhausted
                ? ExecutionRunState.FAILED
                : ExecutionRunState.QUEUED,
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
      });
    }
    return expired.length;
  }

  async queuedRunIds(limit = 100): Promise<string[]> {
    const rows = await this.prisma.executionRun.findMany({
      where: { state: ExecutionRunState.QUEUED },
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
        const run = await transaction.executionRun.findUnique({
          where: { id: runId },
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
          run.authorityGrantId === null
        ) {
          return false;
        }
        await transaction.$queryRaw`
          SELECT "id" FROM "AuthorityGrant"
          WHERE "id" = ${run.authorityGrantId}::uuid
          FOR UPDATE
        `;
        const grant = await transaction.authorityGrant.findUnique({
          where: { id: run.authorityGrantId },
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
          run.contextDigest,
          input,
          requiredTools,
          Number(run.estimatedUpperCostUsd),
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
          const channel = await transaction.productionChannel.findUnique({
            where: { key: run.projectId ?? 'default' },
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
      where: { id: runId, state: ExecutionRunState.RUNNING, leaseOwner: workerId },
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
          where: { id: runId, state: ExecutionRunState.RUNNING, leaseOwner: workerId },
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
        const grant = await transaction.authorityGrant.findUnique({
          where: { id: candidate.authorityGrantId },
        });
        const blockers = this.claimedGrantBlockers(grant, candidate, candidate.release);
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
                runId,
                name: 'model.input_tokens',
                value: response.usage.inputTokens,
                unit: 'tokens',
              },
              {
                runId,
                name: 'model.output_tokens',
                value: response.usage.outputTokens,
                unit: 'tokens',
              },
              {
                runId,
                name: 'model.cost',
                value: actualCost,
                unit: 'usd',
                metadata: { pricingVersion: this.config.model.pricingVersion },
              },
              { runId, name: 'run.latency', value: latencyMs, unit: 'ms' },
              { runId, name: 'outcome.quality', value: qualityScore, unit: 'ratio' },
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
    });
  }
}
