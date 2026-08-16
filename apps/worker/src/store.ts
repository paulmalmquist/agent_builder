import {
  ApprovalRequestState,
  AuthorityGrantState,
  ExecutionRunState,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  dailyBriefOutputSchema,
  jsonObjectSchema,
  resourceManifestSchema,
  skillSpecSchema,
  type JsonValue,
} from '@agent-builder/contracts';
import { z } from 'zod';
import type {
  ClaimedRun,
  CompletedRun,
  FailureDisposition,
  HeartbeatResult,
  ProviderUsageSettlement,
  RecoverySummary,
  WorkerStore,
} from './types.js';

const SYSTEM_ACTOR = 'system:worker';

type ClaimRow = {
  id: string;
  releaseId: string;
  releaseDigest: string;
  contextDigest: string;
  actualReleaseDigest: string;
  projectId: string | null;
  releaseProjectId: string | null;
  authorityGrantId: string;
  developmentDraft: boolean;
  requiredToolScopes: Prisma.JsonValue;
  input: Prisma.JsonValue;
  providerKind: 'deterministic' | 'anthropic' | 'gateway';
  providerVersion: string;
  model: string;
  pricingVersion: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEstimatedCostUsd: Prisma.Decimal;
  estimatedUpperCostUsd: Prisma.Decimal;
  attempts: number;
  maxAttempts: number;
};

type GrantLockRow = {
  id: string;
  contextDigest: string;
  state: 'active' | 'revoked' | 'exhausted' | 'expired';
  validFrom: Date;
  validUntil: Date;
  spentCostUsd: Prisma.Decimal;
  reservedCostUsd: Prisma.Decimal;
  totalCostBudgetUsd: Prisma.Decimal;
  maxEstimatedCostPerRunUsd: Prisma.Decimal;
  usedRuns: number;
  maxRuns: number;
  inputConstraints: Prisma.JsonValue;
  toolScopes: Prisma.JsonValue;
  projectId: string | null;
};

type LockRow = {
  id: string;
  releaseId: string;
  projectId: string | null;
  developmentDraft: boolean;
  providerKind: 'deterministic' | 'anthropic' | 'gateway';
  cancelRequestedAt: Date | null;
  authorityGrantId: string;
  estimatedUpperCostUsd: Prisma.Decimal;
  actualCostUsd: Prisma.Decimal | null;
  attempts: number;
};

type ExpiredRunRow = {
  id: string;
  authorityGrantId: string;
  estimatedUpperCostUsd: Prisma.Decimal;
  attempts: number;
  maxAttempts: number;
};
type ResourceDefinitionRow = { definition: Prisma.JsonValue };
type ChannelLockRow = { currentReleaseId: string | null; promotedAt: Date | null };
type HeartbeatRow = {
  cancelRequestedAt: Date | null;
  developmentDraft: boolean;
  providerKind: 'deterministic' | 'anthropic' | 'gateway';
  releaseId: string;
  currentReleaseId: string | null;
  promotedAt: Date | null;
  grantState: 'active' | 'revoked' | 'exhausted' | 'expired';
  validFrom: Date;
  validUntil: Date;
};

const stringArraySchema = z.array(z.string());

function errorJson(code: string): Prisma.InputJsonObject {
  return { code };
}

function auditData(action: string, entityId: string, details: Prisma.InputJsonObject = {}) {
  return {
    actorId: SYSTEM_ACTOR,
    requestId: null,
    action,
    entityType: 'ExecutionRun',
    entityId,
    details,
  };
}

function toClaimedRun(row: ClaimRow, productionEpoch: Date | null): ClaimedRun {
  return {
    id: row.id,
    releaseId: row.releaseId,
    releaseDigest: row.releaseDigest,
    contextDigest: row.contextDigest,
    authorityGrantId: row.authorityGrantId,
    developmentDraft: row.developmentDraft,
    productionEpoch: productionEpoch?.toISOString() ?? null,
    input: jsonObjectSchema.parse(row.input),
    providerKind: row.providerKind,
    providerVersion: row.providerVersion,
    model: row.model,
    pricingVersion: row.pricingVersion,
    maxInputTokens: row.maxInputTokens,
    maxOutputTokens: row.maxOutputTokens,
    maxEstimatedCostUsd: Number(row.maxEstimatedCostUsd),
    estimatedUpperCostUsd: Number(row.estimatedUpperCostUsd),
    attempts: row.attempts + 1,
    maxAttempts: row.maxAttempts,
  };
}

function satisfiesConstraints(
  input: Record<string, JsonValue>,
  constraints: Record<string, JsonValue>,
): boolean {
  return Object.entries(constraints).every(([key, expected]) => {
    const actual = input[key];
    if (Array.isArray(expected)) {
      return expected.some((allowed) => JSON.stringify(allowed) === JSON.stringify(actual));
    }
    if (expected !== null && typeof expected === 'object') {
      return actual !== null && !Array.isArray(actual) && typeof actual === 'object'
        ? satisfiesConstraints(actual, expected)
        : false;
    }
    return actual === expected;
  });
}

function releaseTools(rows: ResourceDefinitionRow[]): { dailyBrief: boolean; tools: string[] } {
  let dailyBrief = false;
  const tools = new Set<string>();
  for (const row of rows) {
    const manifest = resourceManifestSchema.parse(row.definition);
    if (manifest.kind !== 'Skill') continue;
    if (manifest.metadata.slug === 'daily-brief') dailyBrief = true;
    const skill = skillSpecSchema.parse(manifest.spec);
    skill.tools.forEach((tool) => tools.add(tool));
  }
  return { dailyBrief, tools: [...tools] };
}

export class PrismaWorkerStore implements WorkerStore {
  constructor(private readonly prisma: PrismaClient) {}

  async recoverExpiredLeases(): Promise<RecoverySummary> {
    return this.prisma.$transaction(async (transaction) => {
      const expired = await transaction.$queryRaw<ExpiredRunRow[]>`
        SELECT "id", "authorityGrantId", "estimatedUpperCostUsd", "attempts", "maxAttempts"
        FROM "ExecutionRun"
        WHERE "state" = 'running'
          AND "leaseExpiresAt" < NOW()
          AND "authorityGrantId" IS NOT NULL
        ORDER BY "leaseExpiresAt" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
      `;
      const failed: ExpiredRunRow[] = [];
      const requeued: ExpiredRunRow[] = [];
      for (const run of expired) {
        const terminal = run.attempts >= run.maxAttempts;
        await transaction.executionRun.update({
          where: { id: run.id },
          data: terminal
            ? {
                state: ExecutionRunState.FAILED,
                message: 'Execution retry limit exhausted after worker interruption',
                error: errorJson('WORKER_LEASE_EXHAUSTED'),
                finishedAt: new Date(),
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
              }
            : {
                state: ExecutionRunState.QUEUED,
                message: 'Recovered after worker interruption',
                leaseOwner: null,
                leaseExpiresAt: null,
                heartbeatAt: null,
              },
        });
        await this.releaseGrantReservation(
          transaction,
          run.authorityGrantId,
          Number(run.estimatedUpperCostUsd),
        );
        (terminal ? failed : requeued).push(run);
      }
      if (failed.length > 0) {
        await transaction.auditEvent.createMany({
          data: failed.map(({ id }) =>
            auditData('execution.recovery_failed', id, { code: 'WORKER_LEASE_EXHAUSTED' }),
          ),
        });
      }
      if (requeued.length > 0) {
        await transaction.auditEvent.createMany({
          data: requeued.map(({ id }) => auditData('execution.requeued_after_restart', id)),
        });
      }
      return { requeued: requeued.length, failed: failed.length };
    });
  }

  async claimNext(workerId: string, leaseMs: number): Promise<ClaimedRun | null> {
    return this.withSerializableTransaction(async (transaction) => {
      const candidates = await transaction.$queryRaw<ClaimRow[]>`
          SELECT run."id", run."releaseId", run."releaseDigest", run."contextDigest",
                 release."digest" AS "actualReleaseDigest", run."authorityGrantId",
                 run."developmentDraft",
                 run."projectId", release."projectId" AS "releaseProjectId", run."requiredToolScopes",
                 run."input", run."providerKind", run."providerVersion", run."model",
                 run."pricingVersion", run."maxInputTokens", run."maxOutputTokens", run."maxEstimatedCostUsd",
                 run."estimatedUpperCostUsd", run."attempts", run."maxAttempts"
          FROM "ExecutionRun" run
          JOIN "ReleaseBundle" release
            ON release."id" = run."releaseId"
          WHERE run."state" = 'queued'
            AND run."authorityGrantId" IS NOT NULL
            AND (
              run."attempts" = 0 OR
              run."updatedAt" <= NOW() - (
                LEAST(300, CAST(POWER(2, LEAST(run."attempts", 8)) AS INTEGER)) * INTERVAL '1 second'
              )
            )
          ORDER BY run."createdAt" ASC, run."id" ASC
          FOR UPDATE OF run SKIP LOCKED
          LIMIT 1
        `;
      const candidate = candidates[0];
      if (candidate === undefined) return null;

      const grants = await transaction.$queryRaw<GrantLockRow[]>`
          SELECT "id", "contextDigest", "state", "validFrom", "validUntil", "spentCostUsd",
                 "reservedCostUsd", "totalCostBudgetUsd", "maxEstimatedCostPerRunUsd",
                 "usedRuns", "maxRuns", "inputConstraints", "toolScopes", "projectId"
          FROM "AuthorityGrant"
          WHERE "id" = ${candidate.authorityGrantId}::uuid
            AND "releaseId" = ${candidate.releaseId}::uuid
            AND "releaseDigest" = ${candidate.releaseDigest}
          FOR UPDATE
        `;
      const grant = grants[0];
      const now = new Date();
      const firstAttempt = candidate.attempts === 0;
      const unusableGrant =
        grant === undefined ||
        grant.state === 'revoked' ||
        grant.state === 'expired' ||
        (firstAttempt && grant.state === 'exhausted') ||
        grant.validFrom > now ||
        grant.validUntil <= now ||
        (firstAttempt && grant.usedRuns >= grant.maxRuns);

      const productionRequired =
        !candidate.developmentDraft || candidate.providerKind !== 'deterministic';
      const productionChannel = productionRequired
        ? await this.lockProductionChannel(transaction, candidate.releaseProjectId)
        : null;
      const currentProductionRelease =
        !productionRequired || productionChannel?.currentReleaseId === candidate.releaseId;
      const epochApproved =
        !productionRequired ||
        (productionChannel?.promotedAt !== null &&
          productionChannel?.promotedAt !== undefined &&
          (await this.hasProductionEpochApproval(
            transaction,
            candidate.releaseId,
            candidate.releaseDigest,
            productionChannel.promotedAt,
          )));

      const definitions = await transaction.$queryRaw<ResourceDefinitionRow[]>`
          SELECT resource_version."definition"
          FROM "ReleaseResource" release_resource
          JOIN "ResourceVersion" resource_version
            ON resource_version."id" = release_resource."resourceVersionId"
          WHERE release_resource."releaseId" = ${candidate.releaseId}::uuid
          ORDER BY release_resource."ordinal" ASC
        `;
      const requirements = releaseTools(definitions);
      const input = jsonObjectSchema.parse(candidate.input);
      const constraints = grant === undefined ? {} : jsonObjectSchema.parse(grant.inputConstraints);
      const toolScopes = grant === undefined ? [] : stringArraySchema.parse(grant.toolScopes);
      const requiredToolScopes = stringArraySchema.parse(candidate.requiredToolScopes);
      const scopeInvalid =
        candidate.releaseDigest !== candidate.actualReleaseDigest ||
        grant?.contextDigest !== candidate.contextDigest ||
        !currentProductionRelease ||
        !epochApproved ||
        !requirements.dailyBrief ||
        candidate.projectId !== candidate.releaseProjectId ||
        grant?.projectId !== candidate.projectId ||
        !satisfiesConstraints(input, constraints) ||
        requirements.tools.some((tool) => !requiredToolScopes.includes(tool)) ||
        requiredToolScopes.some((tool) => !requirements.tools.includes(tool)) ||
        requirements.tools.some((tool) => !toolScopes.includes(tool));
      const perRunLimitExceeded =
        grant !== undefined &&
        Number(candidate.estimatedUpperCostUsd) > Number(grant.maxEstimatedCostPerRunUsd);

      if (unusableGrant || scopeInvalid || perRunLimitExceeded) {
        const reason =
          productionRequired && !currentProductionRelease
            ? 'The queued release is no longer the current production release'
            : productionRequired && !epochApproved
              ? 'The first run of this production release epoch requires human approval'
              : scopeInvalid
                ? 'Authority grant does not cover the exact release input and tool scopes'
                : perRunLimitExceeded
                  ? 'Authority grant per-run cost ceiling is insufficient'
                  : grant?.state === 'revoked'
                    ? 'Authority grant was revoked'
                    : 'Authority grant is unavailable, expired, or exhausted';
        await transaction.executionRun.update({
          where: { id: candidate.id },
          data: {
            state: ExecutionRunState.AWAITING_APPROVAL,
            authorityGrantId: null,
            message: reason,
            approvalReasons: [reason],
          },
        });
        await transaction.approvalRequest.upsert({
          where: { runId: candidate.id },
          create: { runId: candidate.id, reasons: [reason], requestedBy: SYSTEM_ACTOR },
          update: {
            state: ApprovalRequestState.PENDING,
            reasons: [reason],
            requestedBy: SYSTEM_ACTOR,
            decidedBy: null,
            rationale: null,
            decidedAt: null,
          },
        });
        await transaction.auditEvent.create({
          data: auditData('execution.authority_revalidation_failed', candidate.id, { reason }),
        });
        return null;
      }

      const remaining =
        Number(grant.totalCostBudgetUsd) -
        Number(grant.spentCostUsd) -
        Number(grant.reservedCostUsd);
      if (Number(candidate.estimatedUpperCostUsd) > remaining) {
        await transaction.executionRun.update({
          where: { id: candidate.id },
          data: {
            state: ExecutionRunState.PAUSED_BUDGET,
            message: 'Paused because the authority cost budget is reserved or exhausted',
            approvalReasons: ['Authority cost budget is insufficient'],
          },
        });
        await transaction.auditEvent.create({
          data: auditData('execution.paused_budget', candidate.id, {
            code: 'AUTHORITY_COST_BUDGET_EXCEEDED',
          }),
        });
        return null;
      }

      const claimedAt = new Date();
      const claimed = await transaction.executionRun.updateMany({
        where: { id: candidate.id, state: ExecutionRunState.QUEUED },
        data: {
          state: ExecutionRunState.RUNNING,
          message: 'Executing',
          progress: 10,
          attempts: { increment: 1 },
          leaseOwner: workerId,
          leaseExpiresAt: new Date(claimedAt.getTime() + leaseMs),
          heartbeatAt: claimedAt,
          startedAt: claimedAt,
          error: Prisma.DbNull,
        },
      });
      if (claimed.count !== 1) return null;
      const reservedCostUsd =
        Number(grant.reservedCostUsd) + Number(candidate.estimatedUpperCostUsd);
      const usedRuns = grant.usedRuns + (firstAttempt ? 1 : 0);
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
      await transaction.runStep.upsert({
        where: { runId_stepKey: { runId: candidate.id, stepKey: 'model-execution' } },
        create: {
          runId: candidate.id,
          stepKey: 'model-execution',
          idempotencyKey: `${candidate.id}:model-execution`,
          state: 'running',
          result: { attempt: candidate.attempts + 1 },
        },
        update: { state: 'running', result: { attempt: candidate.attempts + 1 } },
      });
      await transaction.auditEvent.create({
        data: auditData('execution.claimed', candidate.id, {
          workerId,
          attempt: candidate.attempts + 1,
        }),
      });
      return toClaimedRun(candidate, productionChannel?.promotedAt ?? null);
    });
  }

  async heartbeat(
    runId: string,
    workerId: string,
    leaseMs: number,
    productionEpoch: string | null = null,
  ): Promise<HeartbeatResult> {
    const rows = await this.prisma.$queryRaw<HeartbeatRow[]>`
      UPDATE "ExecutionRun" run
      SET "heartbeatAt" = NOW(),
          "leaseExpiresAt" = NOW() + (${leaseMs} * INTERVAL '1 millisecond'),
          "updatedAt" = NOW()
      FROM "AuthorityGrant" authority_grant
      WHERE run."id" = ${runId}::uuid
        AND run."state" = 'running'
        AND run."leaseOwner" = ${workerId}
        AND authority_grant."id" = run."authorityGrantId"
      RETURNING run."cancelRequestedAt", authority_grant."state" AS "grantState",
                authority_grant."validFrom", authority_grant."validUntil",
                run."developmentDraft", run."providerKind", run."releaseId",
                (
                  SELECT channel."currentReleaseId"
                  FROM "ProductionChannel" channel
                  WHERE channel."key" = COALESCE(run."projectId", 'default')
                ) AS "currentReleaseId",
                (
                  SELECT channel."promotedAt"
                  FROM "ProductionChannel" channel
                  WHERE channel."key" = COALESCE(run."projectId", 'default')
                ) AS "promotedAt"
    `;
    const row = rows[0];
    const now = new Date();
    const productionRequired =
      row !== undefined && (!row.developmentDraft || row.providerKind !== 'deterministic');
    const authorityInvalid =
      row === undefined ||
      row.grantState === 'revoked' ||
      row.grantState === 'expired' ||
      row.validFrom > now ||
      row.validUntil <= now ||
      (productionRequired &&
        (row.currentReleaseId !== row.releaseId ||
          productionEpoch === null ||
          row.promotedAt?.toISOString() !== productionEpoch));
    return {
      owned: row !== undefined,
      cancellationRequested:
        authorityInvalid ||
        (row?.cancelRequestedAt !== null && row?.cancelRequestedAt !== undefined),
    };
  }

  async complete(run: ClaimedRun, workerId: string, result: CompletedRun): Promise<boolean> {
    const output = dailyBriefOutputSchema.parse(result.output);
    return this.withSerializableTransaction(async (transaction) => {
      const locks = await transaction.$queryRaw<LockRow[]>`
          SELECT "id", "releaseId", "projectId", "developmentDraft", "providerKind",
                 "cancelRequestedAt",
                 "authorityGrantId", "estimatedUpperCostUsd", "actualCostUsd", "attempts"
          FROM "ExecutionRun"
          WHERE "id" = ${run.id}::uuid
            AND "state" = 'running'
            AND "leaseOwner" = ${workerId}
          FOR UPDATE
        `;
      const lock = locks[0];
      if (lock === undefined) return false;
      if (lock.cancelRequestedAt !== null) {
        await this.cancelWithinTransaction(transaction, run.id, workerId, result);
        return false;
      }
      if (
        result.actualCostUsd > run.maxEstimatedCostUsd ||
        result.actualCostUsd > run.estimatedUpperCostUsd
      ) {
        throw new Error('MODEL_COST_EXCEEDED_RESERVED_BUDGET');
      }

      const grants = await transaction.$queryRaw<GrantLockRow[]>`
          SELECT "id", "contextDigest", "state", "validFrom", "validUntil", "spentCostUsd",
                 "reservedCostUsd", "totalCostBudgetUsd", "maxEstimatedCostPerRunUsd",
                 "usedRuns", "maxRuns", "inputConstraints", "toolScopes", "projectId"
          FROM "AuthorityGrant"
          WHERE "id" = ${run.authorityGrantId}::uuid
          FOR UPDATE
        `;
      const grant = grants[0];
      if (grant === undefined) throw new Error('AUTHORITY_GRANT_MISSING_AT_COMPLETION');
      const completedAt = new Date();
      const productionRequired = !lock.developmentDraft || lock.providerKind !== 'deterministic';
      const productionChannel = productionRequired
        ? await this.lockProductionChannel(transaction, lock.projectId)
        : null;
      const productionEpochCurrent =
        !productionRequired ||
        (productionChannel?.currentReleaseId === lock.releaseId &&
          run.productionEpoch !== null &&
          productionChannel.promotedAt?.toISOString() === run.productionEpoch);
      if (
        grant.state === 'revoked' ||
        grant.state === 'expired' ||
        grant.contextDigest !== run.contextDigest ||
        grant.validFrom > completedAt ||
        grant.validUntil <= completedAt ||
        !productionEpochCurrent
      ) {
        await this.cancelWithinTransaction(transaction, run.id, workerId, result);
        return false;
      }
      const spent = Number(grant.spentCostUsd) + result.actualCostUsd;
      const reserved = Math.max(
        0,
        Number(grant.reservedCostUsd) - Number(lock.estimatedUpperCostUsd),
      );
      if (spent + reserved > Number(grant.totalCostBudgetUsd) + Number.EPSILON) {
        throw new Error('AUTHORITY_COST_BUDGET_EXCEEDED_AT_COMPLETION');
      }

      await transaction.outcomeRecord.create({
        data: {
          runId: run.id,
          output,
          confidence: output.confidence,
          citations: output.citations,
          unresolvedItems: output.unresolvedItems,
          qualityScore: result.qualityScore,
        },
      });
      await transaction.metricSample.createMany({
        data: [
          {
            runId: run.id,
            name: 'model.input_tokens',
            value: result.usage.inputTokens,
            unit: 'tokens',
          },
          {
            runId: run.id,
            name: 'model.output_tokens',
            value: result.usage.outputTokens,
            unit: 'tokens',
          },
          {
            runId: run.id,
            name: 'model.cost',
            value: result.actualCostUsd,
            unit: 'usd',
            metadata: { pricingVersion: result.pricingVersion },
          },
          { runId: run.id, name: 'run.latency', value: result.latencyMs, unit: 'ms' },
          { runId: run.id, name: 'outcome.quality', value: result.qualityScore, unit: 'ratio' },
        ],
      });
      await transaction.executionRun.update({
        where: { id: run.id },
        data: {
          state: ExecutionRunState.SUCCEEDED,
          message: 'Completed',
          progress: 100,
          actualCostUsd: Number(lock.actualCostUsd ?? 0) + result.actualCostUsd,
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
      });
      await transaction.runStep.update({
        where: { runId_stepKey: { runId: run.id, stepKey: 'model-execution' } },
        data: {
          state: 'succeeded',
          result: {
            outcomeRecorded: true,
            providerKind: result.providerKind,
            providerVersion: result.providerVersion,
            model: result.model,
          },
        },
      });
      await transaction.authorityGrant.update({
        where: { id: grant.id },
        data: {
          spentCostUsd: spent,
          reservedCostUsd: reserved,
          ...(grant.state === 'active' || grant.state === 'exhausted'
            ? {
                state:
                  grant.usedRuns >= grant.maxRuns ||
                  spent + reserved >= Number(grant.totalCostBudgetUsd)
                    ? AuthorityGrantState.EXHAUSTED
                    : AuthorityGrantState.ACTIVE,
              }
            : {}),
        },
      });
      await transaction.auditEvent.create({
        data: auditData('execution.succeeded', run.id, {
          providerKind: result.providerKind,
          providerVersion: result.providerVersion,
          model: result.model,
          pricingVersion: result.pricingVersion,
        }),
      });
      return true;
    });
  }

  async cancelClaimed(
    runId: string,
    workerId: string,
    incurred?: ProviderUsageSettlement,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) =>
      this.cancelWithinTransaction(transaction, runId, workerId, incurred),
    );
  }

  async failOrRetry(
    run: ClaimedRun,
    workerId: string,
    code: string,
    retryable: boolean,
    incurred?: ProviderUsageSettlement,
  ): Promise<FailureDisposition> {
    return this.prisma.$transaction(async (transaction) => {
      const locks = await transaction.$queryRaw<LockRow[]>`
        SELECT "id", "releaseId", "projectId", "developmentDraft", "providerKind",
               "cancelRequestedAt",
               "authorityGrantId", "estimatedUpperCostUsd", "actualCostUsd", "attempts"
        FROM "ExecutionRun"
        WHERE "id" = ${run.id}::uuid
          AND "state" = 'running'
          AND "leaseOwner" = ${workerId}
        FOR UPDATE
      `;
      const lock = locks[0];
      if (lock === undefined) return { state: 'lease_lost', retryAfterMs: null };
      if (lock.cancelRequestedAt !== null) {
        await this.cancelWithinTransaction(transaction, run.id, workerId, incurred);
        return { state: 'cancelled', retryAfterMs: null };
      }
      if (retryable && run.attempts < run.maxAttempts) {
        const retryAfterMs = Math.min(300_000, 1_000 * 2 ** Math.min(run.attempts, 8));
        await transaction.executionRun.update({
          where: { id: run.id },
          data: {
            state: ExecutionRunState.QUEUED,
            message: 'Retry scheduled after execution failure',
            error: errorJson(code),
            ...(incurred === undefined
              ? {}
              : {
                  actualCostUsd: Number(lock.actualCostUsd ?? 0) + incurred.actualCostUsd,
                }),
            leaseOwner: null,
            leaseExpiresAt: null,
            heartbeatAt: null,
          },
        });
        await transaction.runStep.update({
          where: { runId_stepKey: { runId: run.id, stepKey: 'model-execution' } },
          data: { state: 'retrying', result: { code, retryAfterMs } },
        });
        await transaction.auditEvent.create({
          data: auditData('execution.retry_scheduled', run.id, { code, retryAfterMs }),
        });
        await this.settleAttempt(
          transaction,
          run.id,
          lock.authorityGrantId,
          Number(lock.estimatedUpperCostUsd),
          run.attempts,
          incurred,
        );
        return { state: 'queued', retryAfterMs };
      }
      await transaction.executionRun.update({
        where: { id: run.id },
        data: {
          state: ExecutionRunState.FAILED,
          message: 'Execution failed',
          error: errorJson(code),
          ...(incurred === undefined
            ? {}
            : { actualCostUsd: Number(lock.actualCostUsd ?? 0) + incurred.actualCostUsd }),
          finishedAt: new Date(),
          leaseOwner: null,
          leaseExpiresAt: null,
          heartbeatAt: null,
        },
      });
      await transaction.runStep.update({
        where: { runId_stepKey: { runId: run.id, stepKey: 'model-execution' } },
        data: { state: 'failed', result: { code } },
      });
      await transaction.auditEvent.create({
        data: auditData('execution.failed', run.id, { code }),
      });
      await this.settleAttempt(
        transaction,
        run.id,
        lock.authorityGrantId,
        Number(lock.estimatedUpperCostUsd),
        run.attempts,
        incurred,
      );
      return { state: 'failed', retryAfterMs: null };
    });
  }

  private async cancelWithinTransaction(
    transaction: Prisma.TransactionClient,
    runId: string,
    workerId: string,
    incurred?: ProviderUsageSettlement,
  ): Promise<boolean> {
    const locks = await transaction.$queryRaw<LockRow[]>`
      SELECT "id", "releaseId", "projectId", "developmentDraft", "providerKind",
             "cancelRequestedAt",
             "authorityGrantId", "estimatedUpperCostUsd", "actualCostUsd", "attempts"
      FROM "ExecutionRun"
      WHERE "id" = ${runId}::uuid
        AND "state" = 'running'
        AND "leaseOwner" = ${workerId}
      FOR UPDATE
    `;
    const lock = locks[0];
    if (lock === undefined) return false;
    const cancelled = await transaction.executionRun.updateMany({
      where: { id: runId, state: ExecutionRunState.RUNNING, leaseOwner: workerId },
      data: {
        state: ExecutionRunState.CANCELLED,
        message: 'Cancelled',
        finishedAt: new Date(),
        ...(incurred === undefined
          ? {}
          : { actualCostUsd: Number(lock.actualCostUsd ?? 0) + incurred.actualCostUsd }),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
    if (cancelled.count !== 1) return false;
    await this.settleAttempt(
      transaction,
      runId,
      lock.authorityGrantId,
      Number(lock.estimatedUpperCostUsd),
      lock.attempts,
      incurred,
    );
    await transaction.runStep.updateMany({
      where: { runId, stepKey: 'model-execution' },
      data: { state: 'cancelled', result: { code: 'CANCELLED' } },
    });
    await transaction.auditEvent.create({
      data: auditData('execution.cancelled', runId, {
        providerCostRecorded: incurred !== undefined,
      }),
    });
    return true;
  }

  private async releaseGrantReservation(
    transaction: Prisma.TransactionClient,
    grantId: string,
    amount: number,
  ): Promise<void> {
    const grants = await transaction.$queryRaw<GrantLockRow[]>`
      SELECT "id", "contextDigest", "state", "validFrom", "validUntil", "spentCostUsd",
             "reservedCostUsd", "totalCostBudgetUsd", "maxEstimatedCostPerRunUsd",
             "usedRuns", "maxRuns", "inputConstraints", "toolScopes", "projectId"
      FROM "AuthorityGrant"
      WHERE "id" = ${grantId}::uuid
      FOR UPDATE
    `;
    const grant = grants[0];
    if (grant === undefined) return;
    const reserved = Math.max(0, Number(grant.reservedCostUsd) - amount);
    const exhausted =
      grant.usedRuns >= grant.maxRuns ||
      Number(grant.spentCostUsd) + reserved >= Number(grant.totalCostBudgetUsd);
    await transaction.authorityGrant.update({
      where: { id: grant.id },
      data: {
        reservedCostUsd: reserved,
        ...(grant.state === 'active' || grant.state === 'exhausted'
          ? {
              state: exhausted ? AuthorityGrantState.EXHAUSTED : AuthorityGrantState.ACTIVE,
            }
          : {}),
      },
    });
  }

  private async settleAttempt(
    transaction: Prisma.TransactionClient,
    runId: string,
    grantId: string,
    reservedAmount: number,
    attempt: number,
    incurred?: ProviderUsageSettlement,
  ): Promise<void> {
    if (incurred === undefined) {
      await this.releaseGrantReservation(transaction, grantId, reservedAmount);
      return;
    }
    await this.reconcileIncurredCost(transaction, grantId, reservedAmount, incurred);
    await transaction.metricSample.createMany({
      data: [
        {
          runId,
          name: 'model.input_tokens',
          value: incurred.usage.inputTokens,
          unit: 'tokens',
          metadata: { attempt, outcomePublished: false },
        },
        {
          runId,
          name: 'model.output_tokens',
          value: incurred.usage.outputTokens,
          unit: 'tokens',
          metadata: { attempt, outcomePublished: false },
        },
        {
          runId,
          name: 'model.cost',
          value: incurred.actualCostUsd,
          unit: 'usd',
          metadata: {
            attempt,
            pricingVersion: incurred.pricingVersion,
            providerKind: incurred.providerKind,
            providerVersion: incurred.providerVersion,
            model: incurred.model,
            outcomePublished: false,
          },
        },
        {
          runId,
          name: 'run.latency',
          value: incurred.latencyMs,
          unit: 'ms',
          metadata: { attempt, outcomePublished: false },
        },
      ],
    });
  }

  private async reconcileIncurredCost(
    transaction: Prisma.TransactionClient,
    grantId: string,
    reservedAmount: number,
    incurred: ProviderUsageSettlement,
  ): Promise<void> {
    const grants = await transaction.$queryRaw<GrantLockRow[]>`
      SELECT "id", "contextDigest", "state", "validFrom", "validUntil", "spentCostUsd",
             "reservedCostUsd", "totalCostBudgetUsd", "maxEstimatedCostPerRunUsd",
             "usedRuns", "maxRuns", "inputConstraints", "toolScopes", "projectId"
      FROM "AuthorityGrant"
      WHERE "id" = ${grantId}::uuid
      FOR UPDATE
    `;
    const grant = grants[0];
    if (grant === undefined) return;
    const reserved = Math.max(0, Number(grant.reservedCostUsd) - reservedAmount);
    const spent = Number(grant.spentCostUsd) + incurred.actualCostUsd;
    await transaction.authorityGrant.update({
      where: { id: grant.id },
      data: {
        reservedCostUsd: reserved,
        spentCostUsd: spent,
        ...(grant.state === 'active' || grant.state === 'exhausted'
          ? {
              state:
                grant.usedRuns >= grant.maxRuns ||
                spent + reserved >= Number(grant.totalCostBudgetUsd)
                  ? AuthorityGrantState.EXHAUSTED
                  : AuthorityGrantState.ACTIVE,
            }
          : {}),
      },
    });
  }

  private async lockProductionChannel(
    transaction: Prisma.TransactionClient,
    projectId: string | null,
  ): Promise<ChannelLockRow | null> {
    const rows = await transaction.$queryRaw<ChannelLockRow[]>`
      SELECT "currentReleaseId", "promotedAt"
      FROM "ProductionChannel"
      WHERE "key" = ${projectId ?? 'default'}
      FOR SHARE
    `;
    return rows[0] ?? null;
  }

  private async hasProductionEpochApproval(
    transaction: Prisma.TransactionClient,
    releaseId: string,
    releaseDigest: string,
    promotedAt: Date,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ approved: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM "ApprovalRequest" approval
        JOIN "ExecutionRun" approved_run ON approved_run."id" = approval."runId"
        WHERE approved_run."releaseId" = ${releaseId}::uuid
          AND approved_run."releaseDigest" = ${releaseDigest}
          AND approved_run."developmentDraft" = FALSE
          AND approval."state" = 'approved'
          AND approval."decidedBy" IS NOT NULL
          AND approval."decidedAt" >= ${promotedAt}
      ) AS "approved"
    `;
    return rows[0]?.approved === true;
  }

  private async withSerializableTransaction<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error: unknown) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : null;
        const metadata =
          typeof error === 'object' && error !== null && 'meta' in error ? error.meta : null;
        const databaseCode =
          typeof metadata === 'object' && metadata !== null && 'code' in metadata
            ? String(metadata.code)
            : null;
        const serializationFailure =
          code === 'P2034' || (code === 'P2010' && databaseCode === '40001');
        if (!serializationFailure || attempt === 3) throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 5 * 2 ** attempt));
      }
    }
    throw new Error('SERIALIZABLE_TRANSACTION_RETRY_EXHAUSTED');
  }
}
