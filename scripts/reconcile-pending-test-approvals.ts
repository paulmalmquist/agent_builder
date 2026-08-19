import { randomUUID } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { ApprovalRequestState, ExecutionRunState, Prisma, PrismaClient } from '@prisma/client';
import { appendAuditEvent } from '../apps/backend/src/audit.js';
import { runWithPrincipal, type RequestPrincipal } from '../apps/backend/src/request-context.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../apps/backend/src/scope-constants.js';
import {
  appendExecutionRunEvent,
  appendPlatformEvent,
  recordDigestDeliveryForRun,
} from '../apps/backend/src/services/attention-service.js';

const CONFIRMATION = 'reconcile-pending-test-approvals';
const CLEANUP_ACTOR = 'human:local-test-ledger-cleanup';
const CLEANUP_PRINCIPAL_ID = '00000000-0000-4000-8000-000000000099';
const REJECTION_RATIONALE =
  'Reject this exact synthetic integration-test request so test provenance cannot retain live authority.';
const ORPHAN_RATIONALE =
  'Reconcile this exact synthetic test approval because its run was already cancelled without closing the request.';
const DEGRADED_RESOLUTION_RATIONALE =
  'Acknowledge this exact terminal integration-test artifact so synthetic failure evidence stays preserved without remaining in live Attention.';
const BUDGET_CANCELLATION_RATIONALE =
  'Cancel this exact paused integration-test artifact so synthetic budget state no longer remains in live Attention.';
const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

const args = new Map<string, string | true>(
  process.argv.slice(2).map((argument): [string, string | true] => {
    const separator = argument.indexOf('=');
    return separator === -1
      ? [argument, true]
      : [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);
const apply = args.has('--apply');

interface Candidate {
  approvalId: string;
  runId: string;
  workspaceId: string;
  departmentId: string | null;
  runState: 'awaiting_approval' | 'cancelled';
  fixture: 'worker' | 'plugin';
}

interface DegradedCandidate {
  runId: string;
  workspaceId: string;
  departmentId: string | null;
  runState: 'failed' | 'paused_budget';
  kind: 'stalled_run' | 'budget_stop';
  fixture: 'attention' | 'digest-claim' | 'global-resolution' | 'worker' | 'integration';
}

function summarize(candidates: Candidate[]) {
  const count = (fixture: Candidate['fixture'], runState?: Candidate['runState']) =>
    candidates.filter(
      (candidate) =>
        candidate.fixture === fixture &&
        (runState === undefined || candidate.runState === runState),
    ).length;
  return {
    total: candidates.length,
    worker: count('worker'),
    plugin: count('plugin'),
    awaitingApproval: candidates.filter(({ runState }) => runState === 'awaiting_approval').length,
    alreadyCancelled: candidates.filter(({ runState }) => runState === 'cancelled').length,
  };
}

function assertExactReviewedSet(candidates: Candidate[]): void {
  if (candidates.length === 0) return;
  const summary = summarize(candidates);
  if (summary.total !== 27 || summary.worker !== 24 || summary.plugin !== 3) {
    throw new Error(
      `Refusing apply: exact reviewed fixture cardinality changed (${JSON.stringify(summary)}).`,
    );
  }
  if (
    candidates.some(
      ({ runState, departmentId }) =>
        departmentId === null || !(['awaiting_approval', 'cancelled'] as const).includes(runState),
    )
  ) {
    throw new Error('Refusing apply: a candidate has an unreviewed scope or run state.');
  }
}

function summarizeDegraded(candidates: DegradedCandidate[]) {
  return {
    total: candidates.length,
    stalledRun: candidates.filter(({ kind }) => kind === 'stalled_run').length,
    budgetStop: candidates.filter(({ kind }) => kind === 'budget_stop').length,
  };
}

function assertExactDegradedSet(candidates: DegradedCandidate[]): void {
  if (candidates.length === 0) return;
  const summary = summarizeDegraded(candidates);
  if (summary.total !== 24 || summary.stalledRun !== 19 || summary.budgetStop !== 5) {
    throw new Error(
      `Refusing apply: exact reviewed degraded fixture cardinality changed (${JSON.stringify(summary)}).`,
    );
  }
}

async function verifyBackupAcknowledgement() {
  if (!apply) return null;
  if (args.get('--confirm') !== CONFIRMATION) {
    throw new Error(`Apply requires --confirm=${CONFIRMATION}.`);
  }
  const backupArgument = args.get('--backup-file');
  if (typeof backupArgument !== 'string' || backupArgument.trim().length === 0) {
    throw new Error('Apply requires --backup-file=<path-to-a-pg_dump-custom-archive>.');
  }
  const backupPath = path.resolve(backupArgument);
  const metadata = await stat(backupPath);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error('The acknowledged backup must be a non-empty regular file.');
  }
  const header = Buffer.alloc(5);
  const handle = await open(backupPath, 'r');
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  if (header.toString('ascii') !== 'PGDMP') {
    throw new Error('The acknowledged backup is not a PostgreSQL custom-format archive.');
  }
  return { path: backupPath, bytes: metadata.size };
}

function candidateQuery(lockRows: boolean): Prisma.Sql {
  const lock = lockRows ? Prisma.sql`FOR UPDATE OF approval, run` : Prisma.empty;
  const workerInput = {
    date: '2026-08-16',
    tasks: ['Inspect the outcome'],
    signals: [],
    timezone: 'America/New_York',
    priorities: ['Verify durable execution'],
    calendarItems: [],
    userConstraints: [],
  };
  const pluginInput = {
    date: '2026-08-17',
    tasks: ['Run the scoped integration test'],
    signals: ['Plugin lifecycle changed'],
    timezone: 'America/New_York',
    priorities: ['Verify Plugin authority'],
    calendarItems: [],
    userConstraints: [],
  };
  return Prisma.sql`
    SELECT
      approval."id" AS "approvalId",
      run."id" AS "runId",
      run."workspaceId" AS "workspaceId",
      run."departmentId" AS "departmentId",
      run."state" AS "runState",
      CASE WHEN approval."requestedBy" = 'system:worker' THEN 'worker' ELSE 'plugin' END AS fixture
    FROM "ApprovalRequest" approval
    JOIN "ExecutionRun" run ON run."id" = approval."runId"
    JOIN "ResourceVersion" version ON version."id" = run."entryResourceVersionId"
    JOIN "ResourceFamily" family ON family."id" = version."familyId"
    WHERE approval."state" = 'pending'::"ApprovalRequestState"
      AND approval."decisionGroupKey" IS NULL
      AND approval."decisionGroupSize" IS NULL
      AND (
        (
          approval."requestedBy" = 'system:worker'
          AND run."idempotencyKey" ~ ${`^worker-test:${UUID_PATTERN}$`}
          AND run."model" = 'daily-brief-fixture'
          AND run."providerKind" = 'deterministic'::"ModelProviderKind"
          AND run."pricingVersion" = 'worker-integration-pricing'
          AND run."maxInputTokens" = 8000
          AND run."maxOutputTokens" = 2000
          AND run."requiresPluginApproval" = false
          AND run."requiredToolScopes" = '[]'::jsonb
          AND run."requiredPluginScopes" = '[]'::jsonb
          AND run."input" = ${JSON.stringify(workerInput)}::jsonb
          AND family."slug" = 'daily-brief'
        )
        OR
        (
          approval."requestedBy" ~ ${`^human:plugin-service-${UUID_PATTERN}$`}
          AND run."idempotencyKey" ~ ${`^approval-required-plugin:${UUID_PATTERN}$`}
          AND run."model" = 'plugin-service-fixture'
          AND run."providerKind" = 'deterministic'::"ModelProviderKind"
          AND run."developmentDraft" = true
          AND run."pricingVersion" = 'local-2026-08'
          AND run."maxInputTokens" = 1000
          AND run."maxOutputTokens" = 200
          AND run."requiresPluginApproval" = true
          AND run."requiredToolScopes" = '[]'::jsonb
          AND jsonb_array_length(run."requiredPluginScopes") = 1
          AND run."requiredPluginScopes" #>> '{0,tool}' = 'lookup'
          AND run."requiredPluginScopes" #>> '{0,effect}' = 'read'
          AND run."requiredPluginScopes" #>> '{0,approvalRequired}' = 'true'
          AND run."requiredPluginScopes" #>> '{0,scopeDescription}' =
            'Read one synthetic planning record; it cannot write or delete.'
          AND run."input" = ${JSON.stringify(pluginInput)}::jsonb
          AND family."slug" = 'daily-brief-' || replace(approval."requestedBy", 'human:plugin-service-', '')
        )
      )
    ORDER BY approval."id"
    ${lock}
  `;
}

function degradedCandidateQuery(lockRows: boolean): Prisma.Sql {
  const lock = lockRows ? Prisma.sql`FOR UPDATE OF run` : Prisma.empty;
  const workerInput = {
    date: '2026-08-16',
    tasks: ['Inspect the outcome'],
    signals: [],
    timezone: 'America/New_York',
    priorities: ['Verify durable execution'],
    calendarItems: [],
    userConstraints: [],
  };
  const integrationBudgetInput = {
    date: '2026-08-16',
    tasks: ['Verify the execution outcome'],
    signals: ['A platform integration test is pending'],
    timezone: 'America/New_York',
    priorities: ['Complete the governed vertical slice'],
    calendarItems: [],
    userConstraints: [],
  };
  return Prisma.sql`
    SELECT
      run."id" AS "runId",
      run."workspaceId" AS "workspaceId",
      run."departmentId" AS "departmentId",
      run."state" AS "runState",
      CASE WHEN run."state" = 'failed'::"ExecutionRunState"
        THEN 'stalled_run' ELSE 'budget_stop' END AS kind,
      CASE
        WHEN run."requestedBy" ~ ${`^human:attention-${UUID_PATTERN}$`} THEN 'attention'
        WHEN run."requestedBy" ~ ${`^human:digest-claim-${UUID_PATTERN}$`} THEN 'digest-claim'
        WHEN run."requestedBy" ~ ${`^human:global-resolution-${UUID_PATTERN}$`} THEN 'global-resolution'
        WHEN run."requestedBy" = 'worker-test' THEN 'worker'
        ELSE 'integration'
      END AS fixture
    FROM "ExecutionRun" run
    WHERE run."workspaceId" = ${LOCAL_WORKSPACE_ID}::uuid
      AND (run."departmentId" IS NULL OR run."departmentId" = ${LOCAL_DEPARTMENT_ID}::uuid)
      AND NOT EXISTS (
        SELECT 1
        FROM "AttentionResolution" resolution
        WHERE resolution."workspaceId" = ${LOCAL_WORKSPACE_ID}::uuid
          AND resolution."departmentScopeKey" = ${LOCAL_DEPARTMENT_ID}
          AND resolution."itemId" =
            (CASE WHEN run."state" = 'failed'::"ExecutionRunState"
              THEN 'stalled_run:' ELSE 'budget_stop:' END) || run."id"::text
      )
      AND (
        (
          run."state" = 'failed'::"ExecutionRunState"
          AND run."model" = 'attention-fixture'
          AND run."providerKind" = 'deterministic'::"ModelProviderKind"
          AND run."developmentDraft" = true
          AND run."pricingVersion" = 'fixture-v1'
          AND run."maxInputTokens" = 1000
          AND run."maxOutputTokens" = 500
          AND run."requiredToolScopes" = '["calendar.read"]'::jsonb
          AND run."requiredPluginScopes" = '[]'::jsonb
          AND run."input" = '{}'::jsonb
          AND run."idempotencyKey" ~ ${`^attention-${UUID_PATTERN}$`}
          AND (
            run."requestedBy" ~ ${`^human:attention-${UUID_PATTERN}$`}
            OR run."requestedBy" ~ ${`^human:digest-claim-${UUID_PATTERN}$`}
            OR run."requestedBy" ~ ${`^human:global-resolution-${UUID_PATTERN}$`}
          )
        )
        OR
        (
          run."state" = 'failed'::"ExecutionRunState"
          AND run."requestedBy" = 'worker-test'
          AND run."idempotencyKey" ~ ${`^worker-test:${UUID_PATTERN}$`}
          AND run."model" = 'daily-brief-fixture'
          AND run."providerKind" = 'deterministic'::"ModelProviderKind"
          AND run."developmentDraft" = true
          AND run."pricingVersion" = 'worker-integration-pricing'
          AND run."maxInputTokens" = 8000
          AND run."maxOutputTokens" = 2000
          AND run."requiredToolScopes" = '[]'::jsonb
          AND run."requiredPluginScopes" = '[]'::jsonb
          AND run."input" = ${JSON.stringify(workerInput)}::jsonb
          AND run."error" = '{"code":"MODEL_PRICING_SNAPSHOT_MISMATCH"}'::jsonb
        )
        OR
        (
          run."state" = 'paused_budget'::"ExecutionRunState"
          AND run."requestedBy" = 'worker-test'
          AND run."idempotencyKey" ~ ${`^worker-test:${UUID_PATTERN}$`}
          AND run."model" = 'daily-brief-fixture'
          AND run."providerKind" = 'deterministic'::"ModelProviderKind"
          AND run."developmentDraft" = true
          AND run."pricingVersion" = 'worker-integration-pricing'
          AND run."maxInputTokens" = 8000
          AND run."maxOutputTokens" = 2000
          AND run."requiredToolScopes" = '[]'::jsonb
          AND run."requiredPluginScopes" = '[]'::jsonb
          AND run."input" = ${JSON.stringify(workerInput)}::jsonb
          AND run."message" = 'Paused because the authority cost budget is reserved or exhausted'
          AND run."approvalReasons" = '["Authority cost budget is insufficient"]'::jsonb
        )
        OR
        (
          run."state" = 'paused_budget'::"ExecutionRunState"
          AND run."requestedBy" = 'integration-test'
          AND run."idempotencyKey" ~ ${`^daily-brief-budget-${UUID_PATTERN}$`}
          AND run."model" = 'daily-brief-fixture'
          AND run."providerKind" = 'deterministic'::"ModelProviderKind"
          AND run."developmentDraft" = true
          AND run."pricingVersion" = 'integration-test'
          AND run."maxInputTokens" = 2000
          AND run."maxOutputTokens" = 1000
          AND run."requiredToolScopes" = '[]'::jsonb
          AND run."requiredPluginScopes" = '[]'::jsonb
          AND run."input" = ${JSON.stringify(integrationBudgetInput)}::jsonb
          AND run."message" = 'Paused by run cost budget'
        )
      )
    ORDER BY run."id"
    ${lock}
  `;
}

function principalFor(
  candidate: Pick<Candidate | DegradedCandidate, 'workspaceId' | 'departmentId'>,
): RequestPrincipal {
  return {
    principalId: CLEANUP_PRINCIPAL_ID,
    actorId: CLEANUP_ACTOR,
    workspaceId: candidate.workspaceId,
    departmentId: candidate.departmentId,
    authentication: 'local',
    roles: ['admin'],
    requestId: randomUUID(),
  };
}

if (typeof process.env.DATABASE_URL !== 'string' || process.env.DATABASE_URL.length === 0) {
  throw new Error('DATABASE_URL is required.');
}

const backup = await verifyBackupAcknowledgement();
const prisma = new PrismaClient();
try {
  const result = await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('paul-os:reconcile-pending-test-approvals'))`;
      const candidates = await transaction.$queryRaw<Candidate[]>(candidateQuery(apply));
      const degradedCandidates = await transaction.$queryRaw<DegradedCandidate[]>(
        degradedCandidateQuery(apply),
      );
      assertExactReviewedSet(candidates);
      assertExactDegradedSet(degradedCandidates);
      const before = summarize(candidates);
      const degradedBefore = summarizeDegraded(degradedCandidates);
      if (!apply || (candidates.length === 0 && degradedCandidates.length === 0)) {
        return {
          mode: apply ? 'already-clean' : 'dry-run',
          before,
          degradedBefore,
        };
      }

      let rejected = 0;
      let reconciledCancelled = 0;
      for (const candidate of candidates) {
        await runWithPrincipal(principalFor(candidate), async () => {
          const decidedAt = new Date();
          if (candidate.runState === 'awaiting_approval') {
            const updatedRun = await transaction.executionRun.updateMany({
              where: {
                id: candidate.runId,
                workspaceId: candidate.workspaceId,
                departmentId: candidate.departmentId,
                state: ExecutionRunState.AWAITING_APPROVAL,
              },
              data: {
                state: ExecutionRunState.CANCELLED,
                message: 'Rejected: synthetic test fixture reconciliation',
                finishedAt: decidedAt,
              },
            });
            const updatedApproval = await transaction.approvalRequest.updateMany({
              where: {
                id: candidate.approvalId,
                runId: candidate.runId,
                state: ApprovalRequestState.PENDING,
                decisionGroupKey: null,
              },
              data: {
                state: ApprovalRequestState.REJECTED,
                decidedBy: CLEANUP_ACTOR,
                rationale: REJECTION_RATIONALE,
                decidedAt,
              },
            });
            if (updatedRun.count !== 1 || updatedApproval.count !== 1) {
              throw new Error(
                'A reviewed test fixture changed during cleanup; transaction aborted.',
              );
            }
            const run = await transaction.executionRun.findUniqueOrThrow({
              where: { id: candidate.runId },
            });
            await appendExecutionRunEvent(transaction, run, {
              phase: 'authority',
              state: 'rejected',
              message: 'A human rejected this synthetic test-originated authority request.',
              occurredAt: decidedAt,
            });
            await appendPlatformEvent(transaction, {
              kind: 'execution.rejected',
              entityType: 'ExecutionRun',
              entityId: run.id,
              summary: {
                releaseId: run.releaseId,
                rationale: REJECTION_RATIONALE,
                cleanupFingerprint: candidate.fixture,
              },
              occurredAt: decidedAt,
            });
            await recordDigestDeliveryForRun(transaction, run, {
              state: 'failed',
              code: 'RUN_REJECTED',
            });
            await appendAuditEvent(transaction, {
              action: 'execution.rejected',
              entityType: 'ExecutionRun',
              entityId: run.id,
              details: {
                rationale: REJECTION_RATIONALE,
                cleanupFingerprint: candidate.fixture,
              },
            });
            rejected += 1;
            return;
          }

          const updatedApproval = await transaction.approvalRequest.updateMany({
            where: {
              id: candidate.approvalId,
              runId: candidate.runId,
              state: ApprovalRequestState.PENDING,
              decisionGroupKey: null,
              run: { state: ExecutionRunState.CANCELLED },
            },
            data: {
              state: ApprovalRequestState.CANCELLED,
              decidedBy: CLEANUP_ACTOR,
              rationale: ORPHAN_RATIONALE,
              decidedAt,
            },
          });
          if (updatedApproval.count !== 1) {
            throw new Error(
              'A reviewed cancelled-run orphan changed during cleanup; transaction aborted.',
            );
          }
          await appendAuditEvent(transaction, {
            action: 'execution.approval_reconciled',
            entityType: 'ApprovalRequest',
            entityId: candidate.approvalId,
            details: {
              runId: candidate.runId,
              rationale: ORPHAN_RATIONALE,
              cleanupFingerprint: candidate.fixture,
            },
          });
          reconciledCancelled += 1;
        });
      }

      let resolvedTerminal = 0;
      let cancelledBudget = 0;
      for (const candidate of degradedCandidates) {
        if (candidate.kind === 'stalled_run') {
          const resolutionPrincipal: RequestPrincipal = {
            principalId: CLEANUP_PRINCIPAL_ID,
            actorId: CLEANUP_ACTOR,
            workspaceId: LOCAL_WORKSPACE_ID,
            departmentId: LOCAL_DEPARTMENT_ID,
            authentication: 'local',
            roles: ['admin'],
            requestId: randomUUID(),
          };
          await runWithPrincipal(resolutionPrincipal, async () => {
            const itemId = `stalled_run:${candidate.runId}`;
            await transaction.attentionResolution.create({
              data: {
                workspaceId: LOCAL_WORKSPACE_ID,
                departmentId: LOCAL_DEPARTMENT_ID,
                departmentScopeKey: LOCAL_DEPARTMENT_ID,
                itemId,
                rationale: DEGRADED_RESOLUTION_RATIONALE,
                resolvedBy: CLEANUP_ACTOR,
              },
            });
            await appendPlatformEvent(transaction, {
              kind: 'attention.resolved',
              entityType: 'AttentionItem',
              entityId: itemId,
              summary: { kind: 'stalled_run', cleanupFingerprint: candidate.fixture },
            });
            await appendAuditEvent(transaction, {
              action: 'attention.resolved',
              entityType: 'AttentionItem',
              entityId: itemId,
              details: {
                kind: 'stalled_run',
                rationale: DEGRADED_RESOLUTION_RATIONALE,
                cleanupFingerprint: candidate.fixture,
              },
            });
          });
          resolvedTerminal += 1;
          continue;
        }

        await runWithPrincipal(principalFor(candidate), async () => {
          const finishedAt = new Date();
          const updatedRun = await transaction.executionRun.updateMany({
            where: {
              id: candidate.runId,
              workspaceId: candidate.workspaceId,
              departmentId: candidate.departmentId,
              state: ExecutionRunState.PAUSED_BUDGET,
            },
            data: {
              state: ExecutionRunState.CANCELLED,
              message: 'Cancelled: synthetic budget test fixture reconciliation',
              finishedAt,
            },
          });
          if (updatedRun.count !== 1) {
            throw new Error(
              'A reviewed budget-stop fixture changed during cleanup; transaction aborted.',
            );
          }
          await transaction.approvalRequest.updateMany({
            where: {
              runId: candidate.runId,
              state: ApprovalRequestState.PENDING,
              decisionGroupKey: null,
            },
            data: {
              state: ApprovalRequestState.CANCELLED,
              decidedBy: CLEANUP_ACTOR,
              rationale: BUDGET_CANCELLATION_RATIONALE,
              decidedAt: finishedAt,
            },
          });
          const run = await transaction.executionRun.findUniqueOrThrow({
            where: { id: candidate.runId },
          });
          await appendExecutionRunEvent(transaction, run, {
            phase: 'outcome',
            state: 'cancelled',
            message: 'The synthetic budget test run was cancelled before execution began.',
            metadata: { code: 'RUN_CANCELLED', cleanupFingerprint: candidate.fixture },
            occurredAt: finishedAt,
          });
          await appendPlatformEvent(transaction, {
            kind: 'execution.cancelled',
            entityType: 'ExecutionRun',
            entityId: run.id,
            summary: { code: 'RUN_CANCELLED', cleanupFingerprint: candidate.fixture },
            occurredAt: finishedAt,
          });
          await recordDigestDeliveryForRun(transaction, run, {
            state: 'failed',
            code: 'RUN_CANCELLED',
          });
          await appendAuditEvent(transaction, {
            action: 'execution.cancelled',
            entityType: 'ExecutionRun',
            entityId: run.id,
            details: {
              rationale: BUDGET_CANCELLATION_RATIONALE,
              cleanupFingerprint: candidate.fixture,
            },
          });
        });
        cancelledBudget += 1;
      }

      const remaining = await transaction.$queryRaw<Candidate[]>(candidateQuery(false));
      const degradedRemaining = await transaction.$queryRaw<DegradedCandidate[]>(
        degradedCandidateQuery(false),
      );
      if (remaining.length !== 0 || degradedRemaining.length !== 0) {
        throw new Error('Exact test-fixture Attention items remain visible; transaction aborted.');
      }
      return {
        mode: 'apply',
        backup,
        before,
        degradedBefore,
        applied: { rejected, reconciledCancelled, resolvedTerminal, cancelledBudget },
        after: summarize(remaining),
        degradedAfter: summarizeDegraded(degradedRemaining),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 120_000,
    },
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await prisma.$disconnect();
}
