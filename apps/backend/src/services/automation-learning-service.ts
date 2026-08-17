import { randomUUID } from 'node:crypto';
import {
  AutomationBackoff,
  AutomationCatchUpPolicy,
  AutomationDispatchState,
  AutomationScheduleState,
  ExecutionRunState,
  ImprovementCandidateState,
  MemoryCandidateState,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  automationScheduleListResponseSchema,
  automationScheduleSchema,
  createAutomationScheduleRequestSchema,
  createImprovementCandidateRequestSchema,
  createMemoryCandidateRequestSchema,
  createObservationRequestSchema,
  improvementCandidateListResponseSchema,
  improvementCandidateSchema,
  jsonObjectSchema,
  memoryCandidateListResponseSchema,
  memoryCandidateSchema,
  observationListResponseSchema,
  observationSchema,
  reviewImprovementCandidateRequestSchema,
  reviewMemoryCandidateRequestSchema,
  scheduleDueAutomationsResponseSchema,
  updateAutomationScheduleStateRequestSchema,
  type AutomationSchedule,
  type DigestSnapshot,
  type ImprovementCandidate,
  type JsonValue,
  type MemoryCandidate,
  type Observation,
} from '@agent-builder/contracts';
import type { z } from 'zod';
import { AppError } from '../errors.js';
import { appendAuditEvent } from '../audit.js';
import { currentActorId } from '../request-context.js';
import { aggregateScope, aggregateScopeWhere } from '../scope.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { requireHumanActor } from './actors.js';
import type { ExecutionService } from './execution-service.js';
import type { AttentionService } from './attention-service.js';
import { appendPlatformEvent } from './attention-service.js';

const stringListSchema = createImprovementCandidateRequestSchema.shape.evidenceRefs;
const MAX_DAILY_BRIEF_SIGNALS = 100;
const MAX_DAILY_BRIEF_SIGNAL_LENGTH = 1_000;

function packDigestEventLines(lines: readonly string[]): string[] {
  const prefix = 'Platform activity: ';
  const packed: string[] = [];
  let current = prefix;
  for (const line of lines) {
    if (prefix.length + line.length > MAX_DAILY_BRIEF_SIGNAL_LENGTH) {
      throw new AppError(
        422,
        'AUTOMATION_DIGEST_INPUT_INVALID',
        'A platform digest line exceeds the Daily Brief signal limit',
      );
    }
    const candidate = current === prefix ? `${prefix}${line}` : `${current} ${line}`;
    if (candidate.length > MAX_DAILY_BRIEF_SIGNAL_LENGTH) {
      packed.push(current);
      current = `${prefix}${line}`;
    } else {
      current = candidate;
    }
  }
  if (current !== prefix) packed.push(current);
  return packed;
}

export function appendPlatformDigestSignals(
  inputTemplate: Record<string, JsonValue>,
  summary: DigestSnapshot['summary'],
): void {
  if (summary.omittedEventCount !== 0) {
    throw new AppError(
      422,
      'AUTOMATION_DIGEST_INPUT_INVALID',
      'An incomplete historical digest cannot advance the briefing cursor',
    );
  }
  const currentSignals = inputTemplate['signals'];
  if (
    !Array.isArray(currentSignals) ||
    !currentSignals.every((value) => typeof value === 'string')
  ) {
    throw new AppError(
      422,
      'AUTOMATION_DIGEST_INPUT_INVALID',
      'A digest-enabled Daily Brief requires a string signals array',
    );
  }
  const digestSignals = [
    `Platform digest: ${summary.headline}.`,
    ...packDigestEventLines(summary.eventLines),
  ];
  if (currentSignals.length + digestSignals.length > MAX_DAILY_BRIEF_SIGNALS) {
    throw new AppError(
      422,
      'AUTOMATION_DIGEST_INPUT_INVALID',
      'The Daily Brief signals array has no room for the bounded platform digest',
    );
  }
  inputTemplate['signals'] = [...currentSignals, ...digestSignals];
}

const scheduleStateWire = {
  [AutomationScheduleState.ACTIVE]: 'active',
  [AutomationScheduleState.PAUSED]: 'paused',
} as const;
const catchUpWire = {
  [AutomationCatchUpPolicy.LATEST_ONLY]: 'latest_only',
  [AutomationCatchUpPolicy.ALL]: 'all',
  [AutomationCatchUpPolicy.NONE]: 'none',
} as const;
const backoffWire = {
  [AutomationBackoff.FIXED]: 'fixed',
  [AutomationBackoff.EXPONENTIAL]: 'exponential',
} as const;
const improvementStateWire = {
  [ImprovementCandidateState.PROPOSED]: 'proposed',
  [ImprovementCandidateState.INCUBATING]: 'incubating',
  [ImprovementCandidateState.REJECTED]: 'rejected',
} as const;
const memoryStateWire = {
  [MemoryCandidateState.STAGED]: 'staged',
  [MemoryCandidateState.ACCEPTED]: 'accepted',
  [MemoryCandidateState.REJECTED]: 'rejected',
} as const;

type DatabaseSchedule = Prisma.AutomationScheduleGetPayload<Record<string, never>>;
type DatabaseObservation = Prisma.ObservationGetPayload<Record<string, never>>;
type DatabaseImprovement = Prisma.ImprovementCandidateGetPayload<Record<string, never>>;
type DatabaseMemory = Prisma.MemoryCandidateGetPayload<Record<string, never>>;

function toSchedule(record: DatabaseSchedule): AutomationSchedule {
  return automationScheduleSchema.parse({
    id: record.id,
    name: record.name,
    channelKey: record.channelKey,
    releaseId: record.releaseId,
    releaseDigest: record.releaseDigest,
    projectId: record.projectId,
    authorityGrantId: record.authorityGrantId,
    timezone: record.timezone,
    intervalSeconds: record.intervalSeconds,
    nextRunAt: record.nextRunAt.toISOString(),
    inputTemplate: parseJson(
      jsonObjectSchema,
      record.inputTemplate,
      'AutomationSchedule.inputTemplate',
    ),
    includePlatformDigest: record.includePlatformDigest,
    inputConstraints: parseJson(
      jsonObjectSchema,
      record.inputConstraints,
      'AutomationSchedule.inputConstraints',
    ),
    catchUpPolicy: catchUpWire[record.catchUpPolicy],
    maxCatchUpRuns: record.maxCatchUpRuns,
    deduplicationWindowSeconds: record.deduplicationWindowSeconds,
    retry: { maximumAttempts: record.maximumAttempts, backoff: backoffWire[record.backoff] },
    cost: {
      maxInputTokens: record.maxInputTokens,
      maxOutputTokens: record.maxOutputTokens,
      maxEstimatedCostUsd: Number(record.maxEstimatedCostUsd),
    },
    outcomeExpectations: parseJson(
      jsonObjectSchema,
      record.outcomeExpectations,
      'AutomationSchedule.outcomeExpectations',
    ),
    state: scheduleStateWire[record.state],
    lastScheduledAt: record.lastScheduledAt?.toISOString() ?? null,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function toObservation(record: DatabaseObservation): Observation {
  return observationSchema.parse({
    ...record,
    evidence: parseJson(jsonObjectSchema, record.evidence, 'Observation.evidence'),
    provenance: parseJson(jsonObjectSchema, record.provenance, 'Observation.provenance'),
    observedAt: record.observedAt.toISOString(),
  });
}

function toImprovement(record: DatabaseImprovement): ImprovementCandidate {
  return improvementCandidateSchema.parse({
    ...record,
    evidenceRefs: parseJson(
      stringListSchema,
      record.evidenceRefs,
      'ImprovementCandidate.evidenceRefs',
    ),
    state: improvementStateWire[record.state],
    createdAt: record.createdAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
  });
}

function toMemory(record: DatabaseMemory): MemoryCandidate {
  return memoryCandidateSchema.parse({
    ...record,
    proposedValue: parseJson(
      jsonObjectSchema,
      record.proposedValue,
      'MemoryCandidate.proposedValue',
    ),
    acceptedValue:
      record.acceptedValue === null
        ? null
        : parseJson(jsonObjectSchema, record.acceptedValue, 'MemoryCandidate.acceptedValue'),
    provenance: parseJson(jsonObjectSchema, record.provenance, 'MemoryCandidate.provenance'),
    state: memoryStateWire[record.state],
    stagedAt: record.stagedAt.toISOString(),
    reviewedAt: record.reviewedAt?.toISOString() ?? null,
  });
}

function satisfiesConstraints(
  input: Record<string, JsonValue>,
  constraints: Record<string, JsonValue>,
): boolean {
  return Object.entries(constraints).every(([key, expected]) => {
    const actual = input[key];
    if (Array.isArray(expected)) {
      return expected.some((candidate) => JSON.stringify(candidate) === JSON.stringify(actual));
    }
    if (expected !== null && typeof expected === 'object') {
      return actual !== null && !Array.isArray(actual) && typeof actual === 'object'
        ? satisfiesConstraints(actual, expected)
        : false;
    }
    return actual === expected;
  });
}

export interface DueOccurrencePlan {
  occurrences: Date[];
  nextRunAt: Date;
}

export function planDueOccurrences(
  nextRunAt: Date,
  now: Date,
  intervalSeconds: number,
  policy: 'latest_only' | 'all' | 'none',
  maxCatchUpRuns: number,
): DueOccurrencePlan {
  if (nextRunAt.getTime() > now.getTime()) return { occurrences: [], nextRunAt };
  const intervalMs = intervalSeconds * 1000;
  const dueCount = Math.floor((now.getTime() - nextRunAt.getTime()) / intervalMs) + 1;
  if (policy === 'none') {
    return {
      occurrences: [],
      nextRunAt: new Date(nextRunAt.getTime() + dueCount * intervalMs),
    };
  }
  if (policy === 'latest_only') {
    const latest = new Date(nextRunAt.getTime() + (dueCount - 1) * intervalMs);
    return { occurrences: [latest], nextRunAt: new Date(latest.getTime() + intervalMs) };
  }
  const count = Math.min(dueCount, maxCatchUpRuns);
  return {
    occurrences: Array.from(
      { length: count },
      (_, index) => new Date(nextRunAt.getTime() + index * intervalMs),
    ),
    nextRunAt: new Date(nextRunAt.getTime() + count * intervalMs),
  };
}

function dispatchKey(schedule: DatabaseSchedule, scheduledFor: Date): string {
  const windowMs = Math.max(1, schedule.deduplicationWindowSeconds * 1000);
  const bucket = Math.floor(scheduledFor.getTime() / windowMs) * windowMs;
  return `automation:${schedule.id}:${new Date(bucket).toISOString()}`;
}

export class AutomationLearningService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly execution: ExecutionService,
    private readonly attention?: AttentionService,
  ) {}

  async listSchedules(query: {
    state?: 'active' | 'paused' | undefined;
    limit: number;
  }): Promise<z.infer<typeof automationScheduleListResponseSchema>> {
    const records = await this.prisma.automationSchedule.findMany({
      where: {
        ...aggregateScopeWhere(),
        ...(query.state === undefined
          ? {}
          : {
              state:
                query.state === 'active'
                  ? AutomationScheduleState.ACTIVE
                  : AutomationScheduleState.PAUSED,
            }),
      },
      orderBy: { nextRunAt: 'asc' },
      take: query.limit,
    });
    return automationScheduleListResponseSchema.parse({ items: records.map(toSchedule) });
  }

  async getSchedule(scheduleId: string): Promise<AutomationSchedule> {
    const record = await this.prisma.automationSchedule.findFirst({
      where: { id: scheduleId, ...aggregateScopeWhere() },
    });
    if (record === null)
      throw new AppError(404, 'AUTOMATION_NOT_FOUND', 'Automation schedule was not found');
    return toSchedule(record);
  }

  async createSchedule(
    input: z.input<typeof createAutomationScheduleRequestSchema>,
  ): Promise<AutomationSchedule> {
    const actor = requireHumanActor();
    const parsed = createAutomationScheduleRequestSchema.parse(input);
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: parsed.timezone }).format(new Date());
    } catch {
      throw new AppError(400, 'VALIDATION_ERROR', 'Automation timezone is not recognized');
    }
    if (!satisfiesConstraints(parsed.inputTemplate, parsed.inputConstraints)) {
      throw new AppError(
        422,
        'AUTOMATION_INPUT_CONSTRAINT_MISMATCH',
        'The input template does not satisfy its declared constraints',
      );
    }
    const [release, channel, grant] = await Promise.all([
      this.prisma.releaseBundle.findFirst({
        where: { id: parsed.releaseId, ...aggregateScopeWhere() },
      }),
      this.prisma.productionChannel.findFirst({
        where: { key: parsed.channelKey, ...aggregateScopeWhere() },
      }),
      parsed.authorityGrantId === null
        ? Promise.resolve(null)
        : this.prisma.authorityGrant.findFirst({
            where: { id: parsed.authorityGrantId, ...aggregateScopeWhere() },
          }),
    ]);
    if (release === null) throw new AppError(404, 'RELEASE_NOT_FOUND', 'Release was not found');
    if (channel === null)
      throw new AppError(404, 'PRODUCTION_CHANNEL_NOT_FOUND', 'Production channel was not found');
    if (channel.currentReleaseId !== release.id) {
      throw new AppError(
        409,
        'RELEASE_NOT_PRODUCTION',
        'Automation schedules must target the channel current release',
      );
    }
    if (parsed.authorityGrantId !== null && grant === null) {
      throw new AppError(404, 'AUTHORITY_GRANT_NOT_FOUND', 'Authority grant was not found');
    }
    if (
      grant !== null &&
      (grant.releaseId !== release.id || grant.releaseDigest !== release.digest)
    ) {
      throw new AppError(
        422,
        'AUTHORITY_RELEASE_MISMATCH',
        'Authority grant does not match the scheduled release',
      );
    }
    const record = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.automationSchedule.create({
        data: {
          ...aggregateScope(),
          name: parsed.name,
          channelKey: parsed.channelKey,
          releaseId: release.id,
          releaseDigest: release.digest,
          projectId: release.projectId,
          authorityGrantId: grant?.id ?? null,
          timezone: parsed.timezone,
          intervalSeconds: parsed.intervalSeconds,
          nextRunAt: new Date(parsed.nextRunAt),
          inputTemplate: toPrismaJson(
            jsonObjectSchema,
            parsed.inputTemplate,
            'AutomationSchedule.inputTemplate',
          ),
          includePlatformDigest: parsed.includePlatformDigest,
          inputConstraints: toPrismaJson(
            jsonObjectSchema,
            parsed.inputConstraints,
            'AutomationSchedule.inputConstraints',
          ),
          catchUpPolicy:
            parsed.catchUpPolicy === 'latest_only'
              ? AutomationCatchUpPolicy.LATEST_ONLY
              : parsed.catchUpPolicy === 'all'
                ? AutomationCatchUpPolicy.ALL
                : AutomationCatchUpPolicy.NONE,
          maxCatchUpRuns: parsed.maxCatchUpRuns,
          deduplicationWindowSeconds: parsed.deduplicationWindowSeconds,
          maximumAttempts: parsed.retry.maximumAttempts,
          backoff:
            parsed.retry.backoff === 'fixed'
              ? AutomationBackoff.FIXED
              : AutomationBackoff.EXPONENTIAL,
          maxInputTokens: parsed.cost.maxInputTokens,
          maxOutputTokens: parsed.cost.maxOutputTokens,
          maxEstimatedCostUsd: parsed.cost.maxEstimatedCostUsd,
          outcomeExpectations: toPrismaJson(
            jsonObjectSchema,
            parsed.outcomeExpectations,
            'AutomationSchedule.outcomeExpectations',
          ),
          createdBy: actor,
          updatedBy: actor,
        },
      });
      await appendAuditEvent(transaction, {
        action: 'automation.created',
        entityType: 'AutomationSchedule',
        entityId: created.id,
        details: { channelKey: created.channelKey, releaseDigest: created.releaseDigest },
      });
      return created;
    });
    return toSchedule(record);
  }

  async updateScheduleState(
    scheduleId: string,
    input: z.input<typeof updateAutomationScheduleStateRequestSchema>,
  ): Promise<AutomationSchedule> {
    const actor = requireHumanActor();
    const parsed = updateAutomationScheduleStateRequestSchema.parse(input);
    const record = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.automationSchedule.findFirst({
        where: { id: scheduleId, ...aggregateScopeWhere() },
      });
      if (current === null)
        throw new AppError(404, 'AUTOMATION_NOT_FOUND', 'Automation schedule was not found');
      const state =
        parsed.state === 'active' ? AutomationScheduleState.ACTIVE : AutomationScheduleState.PAUSED;
      if (current.state === state) {
        throw new AppError(
          409,
          'AUTOMATION_STATE_UNCHANGED',
          `Automation is already ${parsed.state}`,
        );
      }
      const updated = await transaction.automationSchedule.update({
        where: { id: scheduleId },
        data: { state, updatedBy: actor },
      });
      await appendAuditEvent(transaction, {
        action: parsed.state === 'active' ? 'automation.resumed' : 'automation.paused',
        entityType: 'AutomationSchedule',
        entityId: scheduleId,
        details: { rationale: parsed.rationale },
      });
      return updated;
    });
    return toSchedule(record);
  }

  async scheduleDue(
    now: Date,
    limit: number,
  ): Promise<z.infer<typeof scheduleDueAutomationsResponseSchema>> {
    const claimToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    const scope = aggregateScope();
    const claimed = await this.prisma.$transaction(async (transaction) => {
      const lock = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(
          hashtext(${'paul-os-automation-scheduler:' + scope.workspaceId})
        ) AS acquired
      `;
      if (lock[0]?.acquired !== true) {
        return {
          lockAcquired: false,
          claimedSchedules: 0,
          dispatchesCreated: 0,
          dispatchIds: [] as string[],
        };
      }
      const rows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "AutomationSchedule"
        WHERE "state" = 'active'
          AND "nextRunAt" <= ${now}
          AND "workspaceId" = ${scope.workspaceId}::uuid
          AND ("departmentId" IS NULL OR "departmentId" IS NOT DISTINCT FROM ${scope.departmentId}::uuid)
        ORDER BY "nextRunAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `;
      const schedules = await transaction.automationSchedule.findMany({
        where: { id: { in: rows.map((row) => row.id) }, ...aggregateScopeWhere() },
        include: { channel: true },
        orderBy: { nextRunAt: 'asc' },
      });
      let dispatchesCreated = 0;
      for (const schedule of schedules) {
        if (schedule.channel.currentReleaseId !== schedule.releaseId) {
          await transaction.automationSchedule.update({
            where: { id: schedule.id },
            data: { state: AutomationScheduleState.PAUSED, updatedBy: currentActorId() },
          });
          await appendAuditEvent(transaction, {
            action: 'automation.paused_release_superseded',
            entityType: 'AutomationSchedule',
            entityId: schedule.id,
            details: { expectedReleaseDigest: schedule.releaseDigest },
          });
          continue;
        }
        const policy = catchUpWire[schedule.catchUpPolicy];
        const plan = planDueOccurrences(
          schedule.nextRunAt,
          now,
          schedule.intervalSeconds,
          policy,
          schedule.maxCatchUpRuns,
        );
        const dispatchRows = plan.occurrences.map((scheduledFor) => ({
          scheduleId: schedule.id,
          scheduledFor,
          idempotencyKey: dispatchKey(schedule, scheduledFor),
        }));
        if (dispatchRows.length > 0) {
          const result = await transaction.automationDispatch.createMany({
            data: dispatchRows,
            skipDuplicates: true,
          });
          dispatchesCreated += result.count;
        }
        await transaction.automationSchedule.update({
          where: { id: schedule.id },
          data: {
            nextRunAt: plan.nextRunAt,
            lastScheduledAt: plan.occurrences.at(-1) ?? schedule.lastScheduledAt,
            updatedBy: currentActorId(),
          },
        });
        await appendAuditEvent(transaction, {
          action:
            plan.occurrences.length === 0
              ? 'automation.catch_up_skipped'
              : 'automation.due_claimed',
          entityType: 'AutomationSchedule',
          entityId: schedule.id,
          details: {
            occurrences: plan.occurrences.length,
            catchUpPolicy: policy,
            nextRunAt: plan.nextRunAt.toISOString(),
          },
        });
      }
      const dispatchRows = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT dispatch."id" FROM "AutomationDispatch" dispatch
        JOIN "AutomationSchedule" schedule ON schedule."id" = dispatch."scheduleId"
        WHERE (
          dispatch."state" = 'pending'
          OR (dispatch."state" = 'processing' AND dispatch."leaseExpiresAt" <= ${now})
        )
          AND schedule."workspaceId" = ${scope.workspaceId}::uuid
          AND (schedule."departmentId" IS NULL OR schedule."departmentId" IS NOT DISTINCT FROM ${scope.departmentId}::uuid)
        ORDER BY dispatch."createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(limit, dispatchesCreated, 1)}
      `;
      const dispatchIds = dispatchRows.map((row) => row.id);
      if (dispatchIds.length > 0) {
        await transaction.automationDispatch.updateMany({
          where: { id: { in: dispatchIds } },
          data: {
            state: AutomationDispatchState.PROCESSING,
            claimToken,
            leaseExpiresAt,
          },
        });
      }
      return {
        lockAcquired: true,
        claimedSchedules: schedules.length,
        dispatchesCreated,
        dispatchIds,
      };
    });

    if (!claimed.lockAcquired) {
      return scheduleDueAutomationsResponseSchema.parse({
        ...claimed,
        runsCreated: 0,
        awaitingApproval: 0,
        failedDispatches: 0,
        runIds: [],
      });
    }

    const pending = await this.prisma.automationDispatch.findMany({
      where: {
        id: { in: claimed.dispatchIds },
        state: AutomationDispatchState.PROCESSING,
        claimToken,
      },
      include: { schedule: { include: { channel: true } } },
      orderBy: { createdAt: 'asc' },
      take: Math.max(limit, claimed.dispatchesCreated),
    });
    const runIds: string[] = [];
    let awaitingApproval = 0;
    let failedDispatches = 0;
    for (const dispatch of pending) {
      try {
        if (
          dispatch.schedule.state !== AutomationScheduleState.ACTIVE ||
          dispatch.schedule.channel.currentReleaseId !== dispatch.schedule.releaseId
        ) {
          throw new AppError(
            409,
            'RELEASE_NOT_PRODUCTION',
            'Scheduled release is no longer active',
          );
        }
        const inputTemplate = parseJson(
          jsonObjectSchema,
          dispatch.schedule.inputTemplate,
          'AutomationSchedule.inputTemplate',
        );
        let digestSnapshotId: string | null = null;
        if (dispatch.schedule.includePlatformDigest) {
          if (this.attention === undefined) {
            throw new AppError(
              503,
              'DEPENDENCY_UNAVAILABLE',
              'The platform digest service is unavailable',
            );
          }
          try {
            const snapshot = await this.attention.createDigestSnapshotForActor(
              dispatch.schedule.createdBy,
              now,
            );
            appendPlatformDigestSignals(inputTemplate, snapshot.summary);
            digestSnapshotId = snapshot.id;
          } catch (error) {
            if (!(error instanceof AppError && error.code === 'DIGEST_WINDOW_EMPTY')) throw error;
          }
        }
        const run = await this.execution.createRun(
          {
            releaseId: dispatch.schedule.releaseId,
            authorityGrantId: dispatch.schedule.authorityGrantId,
            input: inputTemplate,
            maxInputTokens: dispatch.schedule.maxInputTokens,
            maxOutputTokens: dispatch.schedule.maxOutputTokens,
            maxEstimatedCostUsd: Number(dispatch.schedule.maxEstimatedCostUsd),
            idempotencyKey: dispatch.idempotencyKey,
          },
          { digestSnapshotId },
        );
        await this.prisma.$transaction(async (transaction) => {
          await transaction.executionRun.update({
            where: { id: run.id },
            data: {
              maxAttempts: dispatch.schedule.maximumAttempts,
            },
          });
          const completed = await transaction.automationDispatch.updateMany({
            where: { id: dispatch.id, claimToken },
            data: {
              state: AutomationDispatchState.RUN_CREATED,
              runId: run.id,
              claimToken: null,
              leaseExpiresAt: null,
            },
          });
          if (completed.count > 0) {
            await appendAuditEvent(transaction, {
              action: 'automation.run_created',
              entityType: 'AutomationDispatch',
              entityId: dispatch.id,
              details: { scheduleId: dispatch.scheduleId, runId: run.id, runState: run.state },
            });
          }
        });
        runIds.push(run.id);
        if (run.state === 'awaiting_approval') awaitingApproval += 1;
      } catch {
        failedDispatches += 1;
        await this.prisma.$transaction(async (transaction) => {
          const failed = await transaction.automationDispatch.updateMany({
            where: { id: dispatch.id, claimToken },
            data: {
              state: AutomationDispatchState.FAILED,
              claimToken: null,
              leaseExpiresAt: null,
              error: toPrismaJson(
                jsonObjectSchema,
                { code: 'AUTOMATION_DISPATCH_FAILED' },
                'AutomationDispatch.error',
              ),
            },
          });
          if (failed.count > 0) {
            await appendAuditEvent(transaction, {
              action: 'automation.dispatch_failed',
              entityType: 'AutomationDispatch',
              entityId: dispatch.id,
              details: { scheduleId: dispatch.scheduleId, code: 'AUTOMATION_DISPATCH_FAILED' },
            });
          }
        });
      }
    }
    return scheduleDueAutomationsResponseSchema.parse({
      ...claimed,
      runsCreated: runIds.length,
      awaitingApproval,
      failedDispatches,
      runIds,
    });
  }

  async listObservations(query: {
    sourceRunId?: string | undefined;
    limit: number;
  }): Promise<z.infer<typeof observationListResponseSchema>> {
    const records = await this.prisma.observation.findMany({
      where: {
        ...aggregateScopeWhere(),
        ...(query.sourceRunId === undefined ? {} : { sourceRunId: query.sourceRunId }),
      },
      orderBy: { observedAt: 'desc' },
      take: query.limit,
    });
    return observationListResponseSchema.parse({ items: records.map(toObservation) });
  }

  async createObservation(
    input: z.input<typeof createObservationRequestSchema>,
  ): Promise<Observation> {
    const parsed = createObservationRequestSchema.parse(input);
    const outcome =
      parsed.sourceOutcomeId === null
        ? null
        : await this.prisma.outcomeRecord.findFirst({
            where: { id: parsed.sourceOutcomeId, run: aggregateScopeWhere() },
          });
    if (parsed.sourceOutcomeId !== null && outcome === null) {
      throw new AppError(404, 'OUTCOME_NOT_FOUND', 'Source outcome was not found');
    }
    if (outcome !== null && parsed.sourceRunId !== null && outcome.runId !== parsed.sourceRunId) {
      throw new AppError(
        422,
        'OBSERVATION_LINEAGE_MISMATCH',
        'Outcome does not belong to the source run',
      );
    }
    const sourceRunId = parsed.sourceRunId ?? outcome?.runId ?? null;
    if (sourceRunId !== null) {
      const run = await this.prisma.executionRun.findFirst({
        where: { id: sourceRunId, ...aggregateScopeWhere() },
      });
      if (run === null)
        throw new AppError(404, 'EXECUTION_RUN_NOT_FOUND', 'Source run was not found');
    }
    const record = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.observation.create({
        data: {
          ...aggregateScope(),
          ...parsed,
          sourceRunId,
          evidence: toPrismaJson(jsonObjectSchema, parsed.evidence, 'Observation.evidence'),
          provenance: toPrismaJson(jsonObjectSchema, parsed.provenance, 'Observation.provenance'),
          observedBy: currentActorId(),
        },
      });
      await appendAuditEvent(transaction, {
        action: 'observation.recorded',
        entityType: 'Observation',
        entityId: created.id,
        details: { signalKey: created.signalKey, sourceRunId },
      });
      await appendPlatformEvent(transaction, {
        kind: 'observation.created',
        entityType: 'Observation',
        entityId: created.id,
        summary: { signalType: created.signalType },
        occurredAt: created.observedAt,
      });
      return created;
    });
    return toObservation(record);
  }

  async listImprovementCandidates(query: {
    state?: 'proposed' | 'incubating' | 'rejected' | undefined;
    limit: number;
  }): Promise<z.infer<typeof improvementCandidateListResponseSchema>> {
    const databaseState =
      query.state === undefined
        ? undefined
        : query.state === 'proposed'
          ? ImprovementCandidateState.PROPOSED
          : query.state === 'incubating'
            ? ImprovementCandidateState.INCUBATING
            : ImprovementCandidateState.REJECTED;
    const records = await this.prisma.improvementCandidate.findMany({
      where: {
        observation: aggregateScopeWhere(),
        ...(databaseState === undefined ? {} : { state: databaseState }),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return improvementCandidateListResponseSchema.parse({ items: records.map(toImprovement) });
  }

  async createImprovementCandidate(
    input: z.input<typeof createImprovementCandidateRequestSchema>,
  ): Promise<ImprovementCandidate> {
    const parsed = createImprovementCandidateRequestSchema.parse(input);
    if (
      (await this.prisma.observation.findFirst({
        where: { id: parsed.observationId, ...aggregateScopeWhere() },
      })) === null
    ) {
      throw new AppError(404, 'OBSERVATION_NOT_FOUND', 'Observation was not found');
    }
    const record = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.improvementCandidate.create({
        data: {
          ...parsed,
          evidenceRefs: toPrismaJson(
            stringListSchema,
            parsed.evidenceRefs,
            'ImprovementCandidate.evidenceRefs',
          ),
          createdBy: currentActorId(),
        },
      });
      await appendAuditEvent(transaction, {
        action: 'improvement.proposed',
        entityType: 'ImprovementCandidate',
        entityId: created.id,
        details: { observationId: created.observationId },
      });
      await appendPlatformEvent(transaction, {
        kind: 'improvement.proposed',
        entityType: 'ImprovementCandidate',
        entityId: created.id,
        summary: { observationId: created.observationId, proposedTarget: created.proposedTarget },
        occurredAt: created.createdAt,
      });
      return created;
    });
    return toImprovement(record);
  }

  async reviewImprovementCandidate(
    candidateId: string,
    input: z.input<typeof reviewImprovementCandidateRequestSchema>,
  ): Promise<ImprovementCandidate> {
    const actor = requireHumanActor();
    const parsed = reviewImprovementCandidateRequestSchema.parse(input);
    const record = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.improvementCandidate.findFirst({
        where: { id: candidateId, observation: aggregateScopeWhere() },
      });
      if (current === null)
        throw new AppError(404, 'IMPROVEMENT_NOT_FOUND', 'Improvement candidate was not found');
      if (current.state !== ImprovementCandidateState.PROPOSED) {
        throw new AppError(
          409,
          'IMPROVEMENT_ALREADY_REVIEWED',
          'Improvement candidate is already terminal',
        );
      }
      const updated = await transaction.improvementCandidate.update({
        where: { id: candidateId },
        data: {
          state:
            parsed.decision === 'incubate'
              ? ImprovementCandidateState.INCUBATING
              : ImprovementCandidateState.REJECTED,
          reviewedBy: actor,
          reviewRationale: parsed.rationale,
          reviewedAt: new Date(),
        },
      });
      await appendAuditEvent(transaction, {
        action: parsed.decision === 'incubate' ? 'improvement.incubated' : 'improvement.rejected',
        entityType: 'ImprovementCandidate',
        entityId: candidateId,
        details: { rationale: parsed.rationale },
      });
      return updated;
    });
    return toImprovement(record);
  }

  async listMemoryCandidates(query: {
    state?: 'staged' | 'accepted' | 'rejected' | undefined;
    sourceRunId?: string | undefined;
    limit: number;
  }): Promise<z.infer<typeof memoryCandidateListResponseSchema>> {
    const databaseState =
      query.state === undefined
        ? undefined
        : query.state === 'staged'
          ? MemoryCandidateState.STAGED
          : query.state === 'accepted'
            ? MemoryCandidateState.ACCEPTED
            : MemoryCandidateState.REJECTED;
    const records = await this.prisma.memoryCandidate.findMany({
      where: {
        sourceRun: aggregateScopeWhere(),
        ...(databaseState === undefined ? {} : { state: databaseState }),
        ...(query.sourceRunId === undefined ? {} : { sourceRunId: query.sourceRunId }),
      },
      orderBy: { stagedAt: 'desc' },
      take: query.limit,
    });
    return memoryCandidateListResponseSchema.parse({ items: records.map(toMemory) });
  }

  async createMemoryCandidate(
    input: z.input<typeof createMemoryCandidateRequestSchema>,
  ): Promise<MemoryCandidate> {
    const parsed = createMemoryCandidateRequestSchema.parse(input);
    const run = await this.prisma.executionRun.findFirst({
      where: { id: parsed.sourceRunId, ...aggregateScopeWhere() },
    });
    if (run === null)
      throw new AppError(404, 'EXECUTION_RUN_NOT_FOUND', 'Source run was not found');
    if (run.state !== ExecutionRunState.SUCCEEDED) {
      throw new AppError(
        409,
        'MEMORY_SOURCE_NOT_SUCCEEDED',
        'Durable memory can only be staged from a succeeded run',
      );
    }
    const record = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.memoryCandidate.create({
        data: {
          sourceRunId: parsed.sourceRunId,
          namespace: parsed.namespace,
          proposedValue: toPrismaJson(
            jsonObjectSchema,
            parsed.proposedValue,
            'MemoryCandidate.proposedValue',
          ),
          provenance: toPrismaJson(
            jsonObjectSchema,
            parsed.provenance,
            'MemoryCandidate.provenance',
          ),
          stagedBy: currentActorId(),
        },
      });
      await appendAuditEvent(transaction, {
        action: 'memory.staged',
        entityType: 'MemoryCandidate',
        entityId: created.id,
        details: { sourceRunId: created.sourceRunId, namespace: created.namespace },
      });
      return created;
    });
    return toMemory(record);
  }

  async reviewMemoryCandidate(
    candidateId: string,
    input: z.input<typeof reviewMemoryCandidateRequestSchema>,
  ): Promise<MemoryCandidate> {
    const actor = requireHumanActor();
    const parsed = reviewMemoryCandidateRequestSchema.parse(input);
    const record = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.memoryCandidate.findFirst({
        where: { id: candidateId, sourceRun: aggregateScopeWhere() },
      });
      if (current === null)
        throw new AppError(404, 'MEMORY_CANDIDATE_NOT_FOUND', 'Memory candidate was not found');
      if (current.state !== MemoryCandidateState.STAGED) {
        throw new AppError(409, 'MEMORY_ALREADY_REVIEWED', 'Memory candidate is already terminal');
      }
      const accepted = parsed.decision !== 'reject';
      const acceptedValue =
        parsed.decision === 'edit_accept'
          ? parsed.editedValue
          : parseJson(jsonObjectSchema, current.proposedValue, 'MemoryCandidate.proposedValue');
      const updated = await transaction.memoryCandidate.update({
        where: { id: candidateId },
        data: {
          state: accepted ? MemoryCandidateState.ACCEPTED : MemoryCandidateState.REJECTED,
          ...(accepted
            ? {
                acceptedValue: toPrismaJson(
                  jsonObjectSchema,
                  acceptedValue,
                  'MemoryCandidate.acceptedValue',
                ),
              }
            : {}),
          reviewedBy: actor,
          reviewRationale: parsed.rationale,
          reviewedAt: new Date(),
        },
      });
      await appendAuditEvent(transaction, {
        action:
          parsed.decision === 'reject'
            ? 'memory.rejected'
            : parsed.decision === 'edit_accept'
              ? 'memory.edited_and_accepted'
              : 'memory.accepted',
        entityType: 'MemoryCandidate',
        entityId: candidateId,
        details: { rationale: parsed.rationale, sourceRunId: current.sourceRunId },
      });
      return updated;
    });
    return toMemory(record);
  }
}
