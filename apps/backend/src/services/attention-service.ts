import {
  ApprovalRequestState,
  DigestDeliveryAttemptState,
  ExecutionRunState,
  ImprovementCandidateState,
  MemoryCandidateState,
  ReleaseEvaluationVerdict,
  type DigestDeliveryAttempt,
  type DigestSnapshot as DigestSnapshotRecord,
  type ExecutionRun,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  consoleActionCopy,
  attentionItemDetailSchema,
  attentionItemSchema,
  attentionResolutionSchema,
  attentionResponseSchema,
  digestSnapshotSchema,
  digestSnapshotSummarySchema,
  digestSummarySchema,
  executionRunEventSchema,
  jsonObjectSchema,
  resolveAttentionItemRequestSchema,
  type AttentionItem,
  type AttentionItemDetail,
  type AttentionResponse,
  type DigestSnapshot,
  type ExecutionRunEvent,
  type JsonValue,
} from '@agent-builder/contracts';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { currentRequestContext, currentRequestPrincipal } from '../request-context.js';
import { aggregateScope, aggregateScopeWhere } from '../scope.js';
import { requireHumanActor } from './actors.js';

const stringArraySchema = z.array(z.string());
const MAX_DIGEST_EVENTS = 250;

interface PlatformEventInput {
  kind: string;
  entityType: string;
  entityId: string;
  summary: Record<string, JsonValue>;
  occurredAt?: Date;
}

interface RunEventInput {
  phase: string;
  state: string;
  message: string;
  durationMs?: number | null;
  costUsd?: number | null;
  metadata?: Record<string, JsonValue>;
  occurredAt?: Date;
}

interface DeliveryInput {
  attemptKey: string;
  state: 'delivered' | 'failed';
  briefingRunId?: string | null;
  error?: Record<string, JsonValue> | null;
}

type Transaction = Prisma.TransactionClient;

function departmentScopeKey(departmentId: string | null): string {
  return departmentId ?? 'workspace';
}

function platformEventStreamLockKey(workspaceId: string, departmentId: string | null): string {
  return `${workspaceId}:${departmentScopeKey(departmentId)}:platform-events`;
}

async function lockVisiblePlatformEventStreams(
  transaction: Transaction,
  workspaceId: string,
  departmentId: string | null,
): Promise<void> {
  const keys = [
    platformEventStreamLockKey(workspaceId, null),
    ...(departmentId === null ? [] : [platformEventStreamLockKey(workspaceId, departmentId)]),
  ].sort();
  for (const key of keys) {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }
}

function money(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function iso(value: Date): string {
  return value.toISOString();
}

function itemId(kind: AttentionItem['kind'], sourceId: string): string {
  return `${kind}:${sourceId}`;
}

function runScopes(run: { requiredToolScopes: Prisma.JsonValue }): string[] {
  return parseJson(stringArraySchema, run.requiredToolScopes, 'ExecutionRun.requiredToolScopes');
}

function eventDetails(value: Prisma.JsonValue, label: string): Record<string, JsonValue> {
  return parseJson(jsonObjectSchema, value, label);
}

function redactReviewValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactReviewValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        /secret|token|password|credential|api.?key/i.test(key)
          ? '[redacted]'
          : redactReviewValue(nested),
      ]),
    );
  }
  return value;
}

function boundedReviewValue(value: unknown): string {
  const normalized = redactReviewValue(value);
  const text = typeof normalized === 'string' ? normalized : JSON.stringify(normalized);
  return text.length <= 500 ? text : `${text.slice(0, 499)}…`;
}

export async function appendPlatformEvent(
  transaction: Transaction,
  input: PlatformEventInput,
): Promise<string> {
  const context = currentRequestContext();
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${platformEventStreamLockKey(
    context.principal.workspaceId,
    context.principal.departmentId,
  )}))`;
  const created = await transaction.platformEvent.create({
    data: {
      ...aggregateScope(context.principal),
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: toPrismaJson(
        jsonObjectSchema,
        input.summary,
        `PlatformEvent(${input.kind}).summary`,
      ),
      actorId: context.principal.actorId,
      requestId: context.principal.requestId,
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    },
  });
  return created.id;
}

export async function appendExecutionRunEvent(
  transaction: Transaction,
  run: Pick<ExecutionRun, 'id' | 'workspaceId' | 'departmentId'>,
  input: RunEventInput,
): Promise<ExecutionRunEvent> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${run.id + ':events'}))`;
  const latest = await transaction.executionRunEvent.aggregate({
    where: { runId: run.id },
    _max: { sequence: true },
  });
  const record = await transaction.executionRunEvent.create({
    data: {
      workspaceId: run.workspaceId,
      departmentId: run.departmentId,
      runId: run.id,
      sequence: (latest._max.sequence ?? 0) + 1,
      phase: input.phase,
      state: input.state,
      message: input.message,
      durationMs: input.durationMs ?? null,
      costUsd: input.costUsd ?? null,
      metadata: toPrismaJson(
        jsonObjectSchema,
        input.metadata ?? {},
        `ExecutionRunEvent(${input.phase}).metadata`,
      ),
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    },
  });
  return executionRunEventSchema.parse({
    ...record,
    costUsd: money(record.costUsd),
    occurredAt: iso(record.occurredAt),
  });
}

export async function recordDigestDeliveryForRun(
  transaction: Transaction,
  run: Pick<ExecutionRun, 'id' | 'workspaceId' | 'departmentId' | 'digestSnapshotId'>,
  input: { state: 'delivered'; costUsd: number } | { state: 'failed'; code: string },
): Promise<void> {
  if (run.digestSnapshotId === null) return;
  const snapshot = await transaction.digestSnapshot.findUnique({
    where: { id: run.digestSnapshotId },
    include: { attempts: true },
  });
  if (
    snapshot === null ||
    snapshot.workspaceId !== run.workspaceId ||
    snapshot.departmentId !== run.departmentId
  ) {
    throw new AppError(
      409,
      'DIGEST_SCOPE_MISMATCH',
      'The run digest snapshot does not match its execution scope',
    );
  }
  const targetState =
    input.state === 'delivered'
      ? DigestDeliveryAttemptState.DELIVERED
      : DigestDeliveryAttemptState.FAILED;
  const attemptKey = `briefing:${run.id}:${input.state}`;
  if (input.state === 'delivered') {
    const lockKey = `${run.workspaceId}:${snapshot.departmentScopeKey}:${snapshot.actorId}:attention-cursor`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const cursor = await transaction.attentionCursor.findUnique({
      where: {
        workspaceId_departmentScopeKey_actorId: {
          workspaceId: run.workspaceId,
          departmentScopeKey: snapshot.departmentScopeKey,
          actorId: snapshot.actorId,
        },
      },
    });
    if (cursor === null) {
      throw new AppError(409, 'DIGEST_CURSOR_MISSING', 'The digest delivery cursor is unavailable');
    }
    if (snapshot.eventSequenceFrom <= cursor.lastDeliveredEventSequence) {
      return;
    }
  }
  const existing = snapshot.attempts.find((attempt) => attempt.attemptKey === attemptKey);
  if (existing === undefined) {
    const delivered = snapshot.attempts.some(
      ({ state }) => state === DigestDeliveryAttemptState.DELIVERED,
    );
    if (!delivered || input.state !== 'delivered') {
      await transaction.digestDeliveryAttempt.create({
        data: {
          workspaceId: run.workspaceId,
          departmentId: run.departmentId,
          snapshotId: snapshot.id,
          attemptKey,
          state: targetState,
          briefingRunId: run.id,
          ...(input.state === 'failed'
            ? {
                error: toPrismaJson(
                  jsonObjectSchema,
                  { code: input.code },
                  'DigestDeliveryAttempt.error',
                ),
              }
            : {}),
          deliveredAt: input.state === 'delivered' ? new Date() : null,
        },
      });
    }
  }
  if (input.state === 'delivered') {
    const lockKey = `${run.workspaceId}:${snapshot.departmentScopeKey}:${snapshot.actorId}:attention-cursor`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    await transaction.attentionCursor.updateMany({
      where: {
        workspaceId: run.workspaceId,
        departmentScopeKey: snapshot.departmentScopeKey,
        actorId: snapshot.actorId,
        lastDeliveredEventSequence: { lt: snapshot.eventSequenceThrough },
      },
      data: {
        lastDeliveredEventSequence: snapshot.eventSequenceThrough,
        lastDeliveredAt: new Date(),
      },
    });
  }
}

function digestEventLine(record: { kind: string; summary: Prisma.JsonValue }): string {
  const summary = eventDetails(record.summary, `PlatformEvent(${record.kind}).summary`);
  const cost = summary['costUsd'];
  const safeCost =
    typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? `$${cost.toFixed(2)}` : null;
  const safeLabel = (value: unknown) =>
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9 .:_/-]{0,79}$/.test(value.trim())
      ? value.trim().replaceAll('_', ' ')
      : null;
  switch (record.kind) {
    case 'execution.succeeded':
      return safeCost === null
        ? 'A run completed successfully.'
        : typeof summary['qualityScore'] === 'number' &&
            Number.isFinite(summary['qualityScore']) &&
            summary['qualityScore'] >= 0 &&
            summary['qualityScore'] <= 1
          ? `A run completed for ${safeCost} with ${Math.round(summary['qualityScore'] * 100)}% recorded quality.`
          : `A run completed for ${safeCost}.`;
    case 'execution.failed':
      return safeCost === null
        ? 'A run failed before producing an outcome.'
        : `A run failed after incurring ${safeCost}.`;
    case 'execution.cancelled':
      return safeCost === null
        ? 'A run was cancelled before producing an outcome.'
        : `A run was cancelled after incurring ${safeCost}.`;
    case 'execution.rejected':
      return 'A human rejected a requested run.';
    case 'release.promoted':
      return safeLabel(summary['channelKey']) === null
        ? 'A certified release moved into production.'
        : `A certified release moved into the ${safeLabel(summary['channelKey'])} channel.`;
    case 'release.rolled_back':
      return 'Production returned to a prior certified release.';
    case 'release.declined':
      return safeLabel(summary['channelKey']) === null
        ? 'A human declined a release promotion.'
        : `A human declined a release for the ${safeLabel(summary['channelKey'])} channel.`;
    case 'observation.created':
      return safeLabel(summary['signalType']) === null
        ? 'A new improvement observation was recorded.'
        : `A ${safeLabel(summary['signalType'])} observation was recorded.`;
    case 'improvement.proposed':
      return safeLabel(summary['proposedTarget']) === null
        ? 'A new improvement candidate awaits review.'
        : `A new improvement candidate for ${safeLabel(summary['proposedTarget'])} awaits review.`;
    case 'attention.resolved':
      return 'A reviewed issue was cleared from Attention.';
    default:
      return 'Platform activity was recorded.';
  }
}

export function summarizePlatformEventsForDigest(
  records: ReadonlyArray<{
    kind: string;
    entityId: string;
    summary: Prisma.JsonValue;
    occurredAt: Date;
  }>,
  windowStartedAt: Date | null,
  windowEndedAt: Date,
) {
  if (records.length > MAX_DIGEST_EVENTS) {
    throw new AppError(
      422,
      'DIGEST_EVENT_LIMIT_EXCEEDED',
      `The digest contains more than ${MAX_DIGEST_EVENTS} events and cannot be delivered without omission`,
    );
  }
  const summary = summarizePlatformEventCounts(records, windowStartedAt, windowEndedAt);
  return digestSnapshotSummarySchema.parse({
    ...summary,
    eventCount: records.length,
    eventLines: records.map(digestEventLine),
    omittedEventCount: 0,
  });
}

function summarizePlatformEventCounts(
  records: ReadonlyArray<{
    kind: string;
    entityId: string;
    summary: Prisma.JsonValue;
  }>,
  windowStartedAt: Date | null,
  windowEndedAt: Date,
) {
  const runIds = new Set<string>();
  let totalCostUsd = 0;
  let promotionCount = 0;
  let observationCount = 0;
  for (const record of records) {
    const summary = eventDetails(record.summary, `PlatformEvent(${record.kind}).summary`);
    if (record.kind.startsWith('execution.')) runIds.add(record.entityId);
    if (record.kind === 'release.promoted') promotionCount += 1;
    if (record.kind === 'observation.created') observationCount += 1;
    const candidateCost = summary['costUsd'];
    if (typeof candidateCost === 'number' && Number.isFinite(candidateCost)) {
      totalCostUsd += candidateCost;
    }
  }
  const headline =
    records.length === 0
      ? 'No new activity is waiting for the next briefing.'
      : `${runIds.size} runs · $${totalCostUsd.toFixed(2)} · ${promotionCount} promotions since the last briefing`;
  return digestSummarySchema.parse({
    headline,
    runCount: runIds.size,
    totalCostUsd,
    promotionCount,
    observationCount,
    windowStartedAt: windowStartedAt?.toISOString() ?? null,
    windowEndedAt: windowEndedAt.toISOString(),
  });
}

function digestState(attempts: readonly DigestDeliveryAttempt[]) {
  const delivered = attempts.find(
    (attempt) => attempt.state === DigestDeliveryAttemptState.DELIVERED,
  );
  if (delivered !== undefined) return { state: 'delivered' as const, attempt: delivered };
  const failed = attempts.find((attempt) => attempt.state === DigestDeliveryAttemptState.FAILED);
  return failed === undefined
    ? { state: 'pending' as const, attempt: null }
    : { state: 'failed' as const, attempt: failed };
}

function toDigestSnapshot(
  record: DigestSnapshotRecord & { attempts: DigestDeliveryAttempt[] },
): DigestSnapshot {
  const delivery = digestState(record.attempts);
  return digestSnapshotSchema.parse({
    id: record.id,
    windowStartedAt: iso(record.windowStartedAt),
    windowEndedAt: iso(record.windowEndedAt),
    eventSequenceThrough: record.eventSequenceThrough.toString(),
    summary: eventDetails(record.summary, 'DigestSnapshot.summary'),
    state: delivery.state,
    briefingRunId: delivery.attempt?.briefingRunId ?? null,
    deliveredAt: delivery.attempt?.deliveredAt?.toISOString() ?? null,
    createdAt: iso(record.createdAt),
  });
}

export class AttentionService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<AttentionResponse> {
    const now = new Date();
    const scope = aggregateScopeWhere();
    const principal = currentRequestPrincipal();
    const cursor = await this.prisma.attentionCursor.findFirst({
      where: {
        workspaceId: principal.workspaceId,
        departmentScopeKey: departmentScopeKey(principal.departmentId),
        actorId: principal.actorId,
      },
    });
    const [approvals, evaluations, memory, improvements, degradedRuns, resolutions, events] =
      await Promise.all([
        this.prisma.approvalRequest.findMany({
          where: { state: ApprovalRequestState.PENDING, run: scope },
          include: { run: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.releaseEvaluation.findMany({
          where: {
            verdict: ReleaseEvaluationVerdict.PASSED,
            release: scope,
            promotionDecisions: { none: {} },
            declineDecisions: { none: {} },
          },
          include: {
            release: {
              include: { resources: { include: { resourceVersion: true } } },
            },
          },
          orderBy: { finishedAt: 'asc' },
        }),
        this.prisma.memoryCandidate.findMany({
          where: { state: MemoryCandidateState.STAGED, sourceRun: scope },
          include: { sourceRun: true },
          orderBy: { stagedAt: 'asc' },
        }),
        this.prisma.improvementCandidate.findMany({
          where: { state: ImprovementCandidateState.PROPOSED, observation: scope },
          include: { observation: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.executionRun.findMany({
          where: {
            AND: [
              scope,
              {
                OR: [
                  { state: ExecutionRunState.FAILED },
                  { state: ExecutionRunState.PAUSED_BUDGET },
                  {
                    state: ExecutionRunState.RUNNING,
                    leaseExpiresAt: { lt: now },
                  },
                ],
              },
            ],
          },
          orderBy: { updatedAt: 'desc' },
          take: 50,
        }),
        this.prisma.attentionResolution.findMany({
          where: {
            workspaceId: principal.workspaceId,
            departmentScopeKey: departmentScopeKey(principal.departmentId),
          },
          select: { itemId: true },
        }),
        this.prisma.platformEvent.findMany({
          where: {
            ...scope,
            sequence: { gt: cursor?.lastDeliveredEventSequence ?? 0n },
            occurredAt: { lte: now },
          },
          orderBy: { sequence: 'asc' },
        }),
      ]);

    const decide: AttentionItem[] = [
      ...approvals.map(({ run, ...approval }) => this.executionApprovalItem(run, approval)),
      ...evaluations
        .filter(
          ({ release }) =>
            release.resources.length > 0 &&
            release.resources.every(
              ({ resourceVersion }) =>
                resourceVersion.lifecycle === 'CERTIFIED' &&
                /^[a-f0-9]{7,64}$/i.test(resourceVersion.sourceCommit),
            ),
        )
        .map((evaluation) => this.releasePromotionItem(evaluation)),
      ...memory.map((candidate) => this.memoryItem(candidate)),
      ...improvements.map((candidate) => this.improvementItem(candidate)),
    ];
    const resolvedIds = new Set(resolutions.map(({ itemId: resolvedItemId }) => resolvedItemId));
    const degraded = degradedRuns
      .map((run) => this.degradedRunItem(run, now))
      .filter(
        ({ id: degradedItemId, payload }) =>
          payload.metadata['state'] !== 'failed' || !resolvedIds.has(degradedItemId),
      );
    const digest = summarizePlatformEventCounts(events, cursor?.lastDeliveredAt ?? null, now);
    return attentionResponseSchema.parse({
      generatedAt: now.toISOString(),
      decide,
      degraded,
      digest,
      decideBadgeCount: decide.length,
      lastDeliveredBriefingAt: cursor?.lastDeliveredAt?.toISOString() ?? null,
    });
  }

  async getItem(id: string): Promise<AttentionItemDetail> {
    const response = await this.list();
    const item = [...response.decide, ...response.degraded].find(
      (candidate) => candidate.id === id,
    );
    if (item === undefined) {
      throw new AppError(404, 'ATTENTION_ITEM_NOT_FOUND', 'Attention item was not found');
    }
    if (item.payload.runId !== null) {
      const run = await this.prisma.executionRun.findFirst({
        where: { id: item.payload.runId, ...aggregateScopeWhere() },
        include: {
          events: { orderBy: { sequence: 'asc' } },
          steps: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (run === null) {
        throw new AppError(404, 'EXECUTION_RUN_NOT_FOUND', 'Execution run was not found');
      }
      const timeline = [
        ...run.events.map((event) => ({
          id: event.id,
          phase: event.phase,
          state: event.state,
          message: event.message,
          durationMs: event.durationMs,
          costUsd: money(event.costUsd),
          occurredAt: iso(event.occurredAt),
        })),
        ...run.steps.map((step) => ({
          id: step.id,
          phase: step.stepKey,
          state: step.state,
          message: `Run phase ${step.stepKey} is ${step.state}.`,
          durationMs: null,
          costUsd: null,
          occurredAt: iso(step.createdAt),
        })),
      ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
      return attentionItemDetailSchema.parse({
        item,
        timeline,
        details: {
          runId: run.id,
          state: run.state.toLowerCase(),
          releaseId: run.releaseId,
          releaseDigest: run.releaseDigest,
          progress: run.progress,
          message: run.message,
          requiredScopes: runScopes(run),
          estimatedUpperCostUsd: run.estimatedUpperCostUsd.toNumber(),
          actualCostUsd: money(run.actualCostUsd),
        },
      });
    }
    return attentionItemDetailSchema.parse({
      item,
      timeline: [],
      details: item.payload.metadata,
    });
  }

  async createDigestSnapshot(windowEndedAt = new Date()): Promise<DigestSnapshot> {
    const principal = currentRequestPrincipal();
    return this.createDigestSnapshotForActor(principal.actorId, windowEndedAt);
  }

  async createDigestSnapshotForActor(
    actorId: string,
    windowEndedAt = new Date(),
  ): Promise<DigestSnapshot> {
    const principal = currentRequestPrincipal();
    if (principal.authentication !== 'system' && principal.actorId !== actorId) {
      throw new AppError(
        403,
        'ACTOR_SCOPE_MISMATCH',
        'A human actor can create only their own digest snapshot',
      );
    }
    const scope = aggregateScope();
    const scopeKey = departmentScopeKey(scope.departmentId);
    const record = await this.prisma.$transaction(
      async (transaction) => {
        const lockKey = `${scope.workspaceId}:${scopeKey}:${actorId}:attention-digest`;
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        await lockVisiblePlatformEventStreams(transaction, scope.workspaceId, scope.departmentId);
        const cursor = await transaction.attentionCursor.upsert({
          where: {
            workspaceId_departmentScopeKey_actorId: {
              workspaceId: scope.workspaceId,
              departmentScopeKey: scopeKey,
              actorId,
            },
          },
          update: {},
          create: { ...scope, departmentScopeKey: scopeKey, actorId },
        });
        const pending = await transaction.digestSnapshot.findFirst({
          where: {
            workspaceId: scope.workspaceId,
            departmentScopeKey: scopeKey,
            actorId,
            eventSequenceFrom: { gt: cursor.lastDeliveredEventSequence },
            attempts: { none: { state: DigestDeliveryAttemptState.DELIVERED } },
          },
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
          orderBy: { createdAt: 'asc' },
        });
        if (pending !== null) return pending;
        // The cursor is a sequence high-water mark, so every snapshot must cover a
        // contiguous visible prefix. Filtering by occurredAt could skip a lower
        // sequence forever when event timestamps arrive out of order.
        const events = await transaction.platformEvent.findMany({
          where: {
            ...aggregateScopeWhere(),
            sequence: { gt: cursor.lastDeliveredEventSequence },
          },
          orderBy: { sequence: 'asc' },
          take: MAX_DIGEST_EVENTS,
        });
        if (events.length === 0) {
          throw new AppError(409, 'DIGEST_WINDOW_EMPTY', 'No new platform events need delivery');
        }
        const first = events[0];
        const last = events.at(-1);
        if (first === undefined || last === undefined) {
          throw new AppError(500, 'INTERNAL_ERROR', 'Digest sequence window is unavailable');
        }
        const windowStartedAt = cursor.lastDeliveredAt ?? first.occurredAt;
        const summary = summarizePlatformEventsForDigest(events, windowStartedAt, windowEndedAt);
        return transaction.digestSnapshot.upsert({
          where: {
            workspaceId_departmentScopeKey_actorId_eventSequenceFrom_eventSequenceThrough: {
              workspaceId: scope.workspaceId,
              departmentScopeKey: scopeKey,
              actorId,
              eventSequenceFrom: first.sequence,
              eventSequenceThrough: last.sequence,
            },
          },
          update: {},
          create: {
            ...scope,
            departmentScopeKey: scopeKey,
            actorId,
            windowStartedAt,
            windowEndedAt,
            eventSequenceFrom: first.sequence,
            eventSequenceThrough: last.sequence,
            summary: toPrismaJson(jsonObjectSchema, summary, 'DigestSnapshot.summary'),
          },
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );
    return toDigestSnapshot(record);
  }

  async recordDigestDelivery(snapshotId: string, input: DeliveryInput): Promise<DigestSnapshot> {
    const principal = currentRequestPrincipal();
    const record = await this.prisma.$transaction(
      async (transaction) => {
        const snapshot = await transaction.digestSnapshot.findFirst({
          where: { id: snapshotId, ...aggregateScopeWhere() },
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
        });
        if (snapshot === null) {
          throw new AppError(404, 'DIGEST_SNAPSHOT_NOT_FOUND', 'Digest snapshot was not found');
        }
        if (snapshot.actorId !== principal.actorId && principal.authentication !== 'system') {
          throw new AppError(404, 'DIGEST_SNAPSHOT_NOT_FOUND', 'Digest snapshot was not found');
        }
        const existingAttempt = snapshot.attempts.find(
          (attempt) => attempt.attemptKey === input.attemptKey,
        );
        if (existingAttempt !== undefined) {
          if (
            existingAttempt.state !==
              (input.state === 'delivered'
                ? DigestDeliveryAttemptState.DELIVERED
                : DigestDeliveryAttemptState.FAILED) ||
            existingAttempt.briefingRunId !== (input.briefingRunId ?? null)
          ) {
            throw new AppError(
              409,
              'IDEMPOTENCY_KEY_REUSED',
              'Digest attempt key is bound to a different delivery result',
            );
          }
          return snapshot;
        }
        const alreadyDelivered = snapshot.attempts.find(
          ({ state }) => state === DigestDeliveryAttemptState.DELIVERED,
        );
        if (alreadyDelivered !== undefined && input.state === 'delivered') return snapshot;

        if (input.state === 'delivered') {
          const lockKey = `${snapshot.workspaceId}:${snapshot.departmentScopeKey}:${snapshot.actorId}:attention-cursor`;
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
          const cursor = await transaction.attentionCursor.findUnique({
            where: {
              workspaceId_departmentScopeKey_actorId: {
                workspaceId: snapshot.workspaceId,
                departmentScopeKey: snapshot.departmentScopeKey,
                actorId: snapshot.actorId,
              },
            },
          });
          if (cursor === null) {
            throw new AppError(
              409,
              'DIGEST_CURSOR_MISSING',
              'The digest delivery cursor is unavailable',
            );
          }
          if (snapshot.eventSequenceFrom <= cursor.lastDeliveredEventSequence) {
            throw new AppError(
              409,
              'DIGEST_SNAPSHOT_SUPERSEDED',
              'A later digest delivery already covers this snapshot window',
            );
          }
        }

        await transaction.digestDeliveryAttempt.create({
          data: {
            workspaceId: snapshot.workspaceId,
            departmentId: snapshot.departmentId,
            snapshotId,
            attemptKey: input.attemptKey,
            state:
              input.state === 'delivered'
                ? DigestDeliveryAttemptState.DELIVERED
                : DigestDeliveryAttemptState.FAILED,
            briefingRunId: input.briefingRunId ?? null,
            ...(input.error === null || input.error === undefined
              ? {}
              : {
                  error: toPrismaJson(jsonObjectSchema, input.error, 'DigestDeliveryAttempt.error'),
                }),
            deliveredAt: input.state === 'delivered' ? new Date() : null,
          },
        });

        if (input.state === 'delivered') {
          const lockKey = `${snapshot.workspaceId}:${snapshot.departmentScopeKey}:${snapshot.actorId}:attention-cursor`;
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
          await transaction.attentionCursor.updateMany({
            where: {
              workspaceId: snapshot.workspaceId,
              departmentScopeKey: snapshot.departmentScopeKey,
              actorId: snapshot.actorId,
              lastDeliveredEventSequence: { lt: snapshot.eventSequenceThrough },
            },
            data: {
              lastDeliveredEventSequence: snapshot.eventSequenceThrough,
              lastDeliveredAt: new Date(),
            },
          });
        }
        return transaction.digestSnapshot.findUniqueOrThrow({
          where: { id: snapshot.id },
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return toDigestSnapshot(record);
  }

  async resolveItem(
    itemIdToResolve: string,
    input: z.input<typeof resolveAttentionItemRequestSchema>,
  ) {
    const actor = requireHumanActor();
    const { rationale } = resolveAttentionItemRequestSchema.parse(input);
    const resolutionScope = aggregateScope();
    const resolutionScopeKey = departmentScopeKey(resolutionScope.departmentId);
    const queue = await this.list();
    const item = queue.degraded.find(({ id }) => id === itemIdToResolve);
    if (item === undefined) {
      const existing = await this.prisma.attentionResolution.findUnique({
        where: {
          workspaceId_departmentScopeKey_itemId: {
            workspaceId: resolutionScope.workspaceId,
            departmentScopeKey: resolutionScopeKey,
            itemId: itemIdToResolve,
          },
        },
      });
      if (existing !== null) {
        if (existing.rationale !== rationale) {
          throw new AppError(
            409,
            'ATTENTION_ITEM_ALREADY_RESOLVED',
            'This Attention resolution is immutable',
          );
        }
        return attentionResolutionSchema.parse({
          ...existing,
          resolvedAt: existing.resolvedAt.toISOString(),
        });
      }
      throw new AppError(404, 'ATTENTION_ITEM_NOT_FOUND', 'Attention item was not found');
    }
    if (item.payload.metadata['state'] !== 'failed') {
      throw new AppError(
        409,
        'ATTENTION_ITEM_NOT_TERMINAL',
        'Only a terminal failed run can be acknowledged',
      );
    }
    const created = await this.prisma.$transaction(async (transaction) => {
      const resolution = await transaction.attentionResolution.create({
        data: {
          ...resolutionScope,
          departmentScopeKey: resolutionScopeKey,
          itemId: item.id,
          rationale,
          resolvedBy: actor,
        },
      });
      await appendPlatformEvent(transaction, {
        kind: 'attention.resolved',
        entityType: 'AttentionItem',
        entityId: item.id,
        summary: { kind: item.kind },
      });
      await appendAuditEvent(transaction, {
        action: 'attention.resolved',
        entityType: 'AttentionItem',
        entityId: item.id,
        details: { kind: item.kind, rationale },
      });
      return resolution;
    });
    return attentionResolutionSchema.parse({
      ...created,
      resolvedAt: created.resolvedAt.toISOString(),
    });
  }

  private executionApprovalItem(
    run: ExecutionRun,
    approval: { id: string; requestedBy: string; createdAt: Date },
  ): AttentionItem {
    const scopes = runScopes(run);
    const estimated = run.estimatedUpperCostUsd.toNumber();
    return attentionItemSchema.parse({
      id: itemId('execution_approval', run.id),
      kind: 'execution_approval',
      shelf: 'decide',
      headline: 'A run is asking for permission.',
      delta: `${scopes.length} tool scopes · about $${estimated.toFixed(2)} at most`,
      status: 'decide',
      primaryAction: {
        kind: 'approve_run',
        ...consoleActionCopy.approveRun,
        resourceId: run.id,
        requiresRationale: true,
      },
      secondaryAction: {
        kind: 'reject_run',
        ...consoleActionCopy.rejectRun,
        resourceId: run.id,
        requiresRationale: true,
      },
      cost: { period: 'run', usd: estimated, budgetUsd: run.maxEstimatedCostUsd.toNumber() },
      reason: 'This run needs authority before it can use tools or spend its budget.',
      provenance: {
        sourceType: 'ApprovalRequest',
        sourceId: approval.id,
        actorId: approval.requestedBy,
        requestId: null,
        explanation: 'The execution service paused because no matching authority grant exists.',
      },
      occurredAt: iso(approval.createdAt),
      payload: {
        sourceType: 'ApprovalRequest',
        sourceId: approval.id,
        detailPath: `/v1/execution-runs/${run.id}`,
        scopes,
        runId: run.id,
        candidateId: null,
        channelKey: null,
        releaseId: run.releaseId,
        evaluationId: null,
        expiresAt: null,
        reviewFacts: [
          { label: 'Release', value: `${run.releaseId} · ${run.releaseDigest}` },
          { label: 'Tool scopes', value: scopes.length === 0 ? 'No tools' : scopes.join(', ') },
          {
            label: 'Cost limit',
            value: `$${run.maxEstimatedCostUsd.toNumber().toFixed(2)} per run`,
          },
          { label: 'Requested by', value: run.requestedBy },
        ],
        metadata: {
          reasons: parseJson(
            stringArraySchema,
            run.approvalReasons,
            'ExecutionRun.approvalReasons',
          ),
        },
      },
    });
  }

  private releasePromotionItem(evaluation: {
    id: string;
    releaseId: string;
    corpusVersion: number;
    executorKind: string;
    executorVersion: string;
    evaluationMode: string;
    gateScores: Prisma.JsonValue;
    evidence: Prisma.JsonValue;
    requestedBy: string;
    finishedAt: Date;
    release: { projectId: string | null; digest: string };
  }): AttentionItem {
    const channelKey = evaluation.release.projectId ?? 'default';
    return attentionItemSchema.parse({
      id: itemId('release_promotion', evaluation.id),
      kind: 'release_promotion',
      shelf: 'decide',
      headline: 'A certified release is ready for your decision.',
      delta: `Corpus ${evaluation.corpusVersion} passed · production has not changed`,
      status: 'decide',
      primaryAction: {
        kind: 'promote_release',
        ...consoleActionCopy.promoteRelease,
        resourceId: evaluation.id,
        requiresRationale: true,
      },
      secondaryAction: {
        kind: 'decline_release',
        ...consoleActionCopy.declineRelease,
        resourceId: evaluation.id,
        requiresRationale: true,
      },
      cost: null,
      reason: 'Passing evidence needs a human decision before production can change.',
      provenance: {
        sourceType: 'ReleaseEvaluation',
        sourceId: evaluation.id,
        actorId: evaluation.requestedBy,
        requestId: null,
        explanation: 'The governed evaluation finished with a passing verdict.',
      },
      occurredAt: iso(evaluation.finishedAt),
      payload: {
        sourceType: 'ReleaseEvaluation',
        sourceId: evaluation.id,
        detailPath: `/evidence/releases/${evaluation.id}`,
        scopes: [],
        runId: null,
        candidateId: null,
        channelKey,
        releaseId: evaluation.releaseId,
        evaluationId: evaluation.id,
        expiresAt: null,
        reviewFacts: [
          { label: 'Release digest', value: evaluation.release.digest },
          { label: 'Corpus', value: `Version ${evaluation.corpusVersion}` },
          {
            label: 'Executor',
            value: `${evaluation.executorKind}@${evaluation.executorVersion} · ${evaluation.evaluationMode}`,
          },
          { label: 'Gate scores', value: boundedReviewValue(evaluation.gateScores) },
          {
            label: 'Evidence meaning',
            value:
              'Deterministic contract coverage only. It does not prove semantic answer quality.',
          },
        ],
        metadata: {
          releaseDigest: evaluation.release.digest,
          corpusVersion: evaluation.corpusVersion,
          executorKind: evaluation.executorKind,
          executorVersion: evaluation.executorVersion,
          evaluationMode: evaluation.evaluationMode,
          gateScores: evaluation.gateScores as JsonValue,
          evidence: evaluation.evidence as JsonValue,
          disclaimer:
            'Deterministic contract coverage only. It does not prove semantic answer quality.',
        },
      },
    });
  }

  private memoryItem(candidate: {
    id: string;
    sourceRunId: string;
    namespace: string;
    stagedBy: string;
    stagedAt: Date;
    proposedValue: Prisma.JsonValue;
    provenance: Prisma.JsonValue;
  }): AttentionItem {
    return attentionItemSchema.parse({
      id: itemId('memory_review', candidate.id),
      kind: 'memory_review',
      shelf: 'decide',
      headline: 'A run proposed a durable memory.',
      delta: `Namespace ${candidate.namespace} · nothing is stored yet`,
      status: 'decide',
      primaryAction: {
        kind: 'accept_memory',
        ...consoleActionCopy.acceptMemory,
        resourceId: candidate.id,
        requiresRationale: true,
      },
      secondaryAction: {
        kind: 'reject_memory',
        ...consoleActionCopy.rejectMemory,
        resourceId: candidate.id,
        requiresRationale: true,
      },
      cost: null,
      reason: 'Durable memory never changes without your review.',
      provenance: {
        sourceType: 'MemoryCandidate',
        sourceId: candidate.id,
        actorId: candidate.stagedBy,
        requestId: null,
        explanation: 'The execution produced a staged memory candidate.',
      },
      occurredAt: iso(candidate.stagedAt),
      payload: {
        sourceType: 'MemoryCandidate',
        sourceId: candidate.id,
        detailPath: `/v1/memory-candidates?sourceRunId=${candidate.sourceRunId}`,
        scopes: [],
        runId: candidate.sourceRunId,
        candidateId: candidate.id,
        channelKey: null,
        releaseId: null,
        evaluationId: null,
        expiresAt: null,
        reviewFacts: [
          { label: 'Namespace', value: candidate.namespace },
          { label: 'Source run', value: candidate.sourceRunId },
          { label: 'Proposed value', value: boundedReviewValue(candidate.proposedValue) },
        ],
        metadata: {
          namespace: candidate.namespace,
          proposedValue: redactReviewValue(candidate.proposedValue) as JsonValue,
          provenance: redactReviewValue(candidate.provenance) as JsonValue,
        },
      },
    });
  }

  private improvementItem(candidate: {
    id: string;
    title: string;
    proposedTarget: string;
    createdBy: string;
    createdAt: Date;
    observationId: string;
    proposedChange: string;
    evidenceRefs: Prisma.JsonValue;
  }): AttentionItem {
    return attentionItemSchema.parse({
      id: itemId('improvement_review', candidate.id),
      kind: 'improvement_review',
      shelf: 'decide',
      headline: candidate.title,
      delta: `Proposed for ${candidate.proposedTarget} · no repository change exists`,
      status: 'decide',
      primaryAction: {
        kind: 'incubate_candidate',
        ...consoleActionCopy.incubateCandidate,
        resourceId: candidate.id,
        requiresRationale: true,
      },
      secondaryAction: {
        kind: 'reject_candidate',
        ...consoleActionCopy.rejectCandidate,
        resourceId: candidate.id,
        requiresRationale: true,
      },
      cost: null,
      reason: 'A repeated signal was converted into a candidate improvement for review.',
      provenance: {
        sourceType: 'ImprovementCandidate',
        sourceId: candidate.id,
        actorId: candidate.createdBy,
        requestId: null,
        explanation: `Observation ${candidate.observationId} supports this proposal.`,
      },
      occurredAt: iso(candidate.createdAt),
      payload: {
        sourceType: 'ImprovementCandidate',
        sourceId: candidate.id,
        detailPath: `/incubator?candidateId=${candidate.id}`,
        scopes: [],
        runId: null,
        candidateId: candidate.id,
        channelKey: null,
        releaseId: null,
        evaluationId: null,
        expiresAt: null,
        reviewFacts: [
          { label: 'Target', value: candidate.proposedTarget },
          { label: 'Observation', value: candidate.observationId },
          { label: 'Proposed change', value: boundedReviewValue(candidate.proposedChange) },
          { label: 'Evidence', value: boundedReviewValue(candidate.evidenceRefs) },
        ],
        metadata: {
          observationId: candidate.observationId,
          proposedTarget: candidate.proposedTarget,
          proposedChange: candidate.proposedChange,
          evidenceRefs: candidate.evidenceRefs as JsonValue,
        },
      },
    });
  }

  private degradedRunItem(run: ExecutionRun, now: Date): AttentionItem {
    const budgetStop = run.state === ExecutionRunState.PAUSED_BUDGET;
    const stalled =
      run.state === ExecutionRunState.RUNNING &&
      (run.leaseExpiresAt?.getTime() ?? 0) < now.getTime();
    const kind: AttentionItem['kind'] = budgetStop ? 'budget_stop' : 'stalled_run';
    return attentionItemSchema.parse({
      id: itemId(kind, run.id),
      kind,
      shelf: 'degraded',
      headline: budgetStop
        ? 'Safety stop: this run exceeds its cost limit.'
        : stalled
          ? 'A run stopped sending heartbeats.'
          : 'A run failed before it produced an outcome.',
      delta: `${run.progress}% complete · ${run.message}`,
      status: budgetStop ? 'safety_stop' : 'degraded',
      primaryAction: {
        kind: 'open_details',
        ...consoleActionCopy.reviewFlightRecorder,
        resourceId: run.id,
        requiresRationale: false,
      },
      secondaryAction:
        run.state === ExecutionRunState.FAILED
          ? {
              kind: 'resolve_item',
              ...consoleActionCopy.acknowledgeFailure,
              resourceId: itemId(kind, run.id),
              requiresRationale: true,
            }
          : null,
      cost: {
        period: 'run',
        usd: money(run.actualCostUsd) ?? run.estimatedUpperCostUsd.toNumber(),
        budgetUsd: run.maxEstimatedCostUsd.toNumber(),
      },
      reason: budgetStop
        ? 'The configured cost ceiling stopped execution before more could be spent.'
        : stalled
          ? 'The worker lease expired. Recovery must decide whether to retry.'
          : 'The execution service recorded a terminal failure.',
      provenance: {
        sourceType: 'ExecutionRun',
        sourceId: run.id,
        actorId: run.requestedBy,
        requestId: null,
        explanation: 'Execution ledger state placed this item on the Degraded shelf.',
      },
      occurredAt: iso(run.updatedAt),
      payload: {
        sourceType: 'ExecutionRun',
        sourceId: run.id,
        detailPath: `/v1/execution-runs/${run.id}`,
        scopes: runScopes(run),
        runId: run.id,
        candidateId: null,
        channelKey: null,
        releaseId: run.releaseId,
        evaluationId: null,
        expiresAt: run.leaseExpiresAt?.toISOString() ?? null,
        reviewFacts: [
          { label: 'Run', value: run.id },
          { label: 'Release', value: run.releaseDigest },
          { label: 'Recorded state', value: run.state.toLowerCase() },
          { label: 'Cost limit', value: `$${run.maxEstimatedCostUsd.toNumber().toFixed(2)}` },
        ],
        metadata: { state: run.state.toLowerCase(), message: run.message },
      },
    });
  }
}
