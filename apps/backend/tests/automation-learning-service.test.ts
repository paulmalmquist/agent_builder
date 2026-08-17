import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { pino } from 'pino';
import {
  AutomationCatchUpPolicy,
  AutomationDispatchState,
  AutomationScheduleState,
  AutomationBackoff,
  ExecutionRunState,
  ImprovementCandidateState,
  MemoryCandidateState,
  type PrismaClient,
} from '@prisma/client';
import { createApp } from '../src/app.js';
import {
  appendPlatformDigestSignals,
  AutomationLearningService,
} from '../src/services/automation-learning-service.js';
import type { ExecutionService } from '../src/services/execution-service.js';
import type { ServiceBundle } from '../src/services/types.js';

const now = new Date('2026-08-16T12:00:00.000Z');
const scheduleId = randomUUID();
const releaseId = randomUUID();
const grantId = randomUUID();
const runId = randomUUID();
const outcomeId = randomUUID();
const observationId = randomUUID();
const improvementId = randomUUID();
const memoryId = randomUUID();
const dispatchId = randomUUID();

const schedule = {
  id: scheduleId,
  name: 'Daily briefing',
  channelKey: 'default',
  releaseId,
  releaseDigest: 'a'.repeat(64),
  projectId: null,
  authorityGrantId: grantId,
  timezone: 'America/New_York',
  intervalSeconds: 3600,
  nextRunAt: new Date('2026-08-16T10:00:00.000Z'),
  inputTemplate: {
    date: '2026-08-16',
    timezone: 'America/New_York',
    priorities: ['Ship the governed slice'],
    calendarItems: [],
    tasks: [],
    signals: [],
    userConstraints: [],
  },
  inputConstraints: { timezone: 'America/New_York' },
  catchUpPolicy: AutomationCatchUpPolicy.LATEST_ONLY,
  maxCatchUpRuns: 10,
  deduplicationWindowSeconds: 300,
  maximumAttempts: 3,
  backoff: AutomationBackoff.EXPONENTIAL,
  maxInputTokens: 4000,
  maxOutputTokens: 1000,
  maxEstimatedCostUsd: 0.5,
  outcomeExpectations: { citationsRequired: true },
  state: AutomationScheduleState.ACTIVE,
  lastScheduledAt: null,
  createdBy: 'local-user',
  updatedBy: 'local-user',
  createdAt: now,
  updatedAt: now,
};
const observation = {
  id: observationId,
  signalKey: 'daily-brief:unresolved-risk',
  signalType: 'outcome_gap',
  summary: 'A recurring unresolved schedule risk needs a governed follow-up.',
  evidence: { unresolvedCount: 1 },
  provenance: { source: 'synthetic-test' },
  sourceRunId: runId,
  sourceOutcomeId: outcomeId,
  observedBy: 'system:background',
  observedAt: now,
};
const improvement = {
  id: improvementId,
  observationId,
  title: 'Improve schedule-risk context',
  proposedTarget: 'daily-brief',
  proposedChange: 'Propose an additional context requirement for human review.',
  evidenceRefs: [`observation:${observationId}`],
  state: ImprovementCandidateState.PROPOSED,
  createdBy: 'system:background',
  reviewedBy: null,
  reviewRationale: null,
  createdAt: now,
  reviewedAt: null,
};
const memory = {
  id: memoryId,
  sourceRunId: runId,
  namespace: 'briefing.preferences',
  proposedValue: { style: 'concise' },
  acceptedValue: null,
  provenance: { source: 'explicit-run-output' },
  state: MemoryCandidateState.STAGED,
  stagedBy: 'system:background',
  reviewedBy: null,
  reviewRationale: null,
  stagedAt: now,
  reviewedAt: null,
};

function harness() {
  const scheduleFind = jest.fn(() => Promise.resolve(schedule));
  const improvementFind = jest.fn(() => Promise.resolve(improvement));
  const memoryFind = jest.fn(() => Promise.resolve(memory));
  const transaction = {
    automationSchedule: {
      create: jest.fn(() => Promise.resolve(schedule)),
      findUnique: scheduleFind,
      findFirst: scheduleFind,
      findMany: jest.fn(() =>
        Promise.resolve([{ ...schedule, channel: { currentReleaseId: releaseId } }]),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...schedule, ...data, updatedAt: now }),
      ),
    },
    automationDispatch: {
      createMany: jest.fn(() => Promise.resolve({ count: 1 })),
      update: jest.fn(() => Promise.resolve(undefined)),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
    executionRun: { update: jest.fn(() => Promise.resolve(undefined)) },
    observation: { create: jest.fn(() => Promise.resolve(observation)) },
    improvementCandidate: {
      create: jest.fn(() => Promise.resolve(improvement)),
      findUnique: improvementFind,
      findFirst: improvementFind,
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...improvement, ...data }),
      ),
    },
    memoryCandidate: {
      create: jest.fn(() => Promise.resolve(memory)),
      findUnique: memoryFind,
      findFirst: memoryFind,
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...memory, ...data }),
      ),
    },
    auditEvent: { create: jest.fn(() => Promise.resolve({ id: randomUUID() })) },
    platformEvent: { create: jest.fn(() => Promise.resolve({ id: randomUUID() })) },
    $executeRaw: jest.fn(() => Promise.resolve(0)),
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([{ id: scheduleId }])
      .mockResolvedValueOnce([{ id: dispatchId }]),
  };
  const releaseFind = jest.fn(() =>
    Promise.resolve({ id: releaseId, digest: 'a'.repeat(64), projectId: null }),
  );
  const channelFind = jest.fn(() =>
    Promise.resolve({ key: 'default', currentReleaseId: releaseId }),
  );
  const grantFind = jest.fn(() =>
    Promise.resolve({ id: grantId, releaseId, releaseDigest: 'a'.repeat(64) }),
  );
  const topScheduleFind = jest.fn(() => Promise.resolve(schedule));
  const outcomeFind = jest.fn(() => Promise.resolve({ id: outcomeId, runId }));
  const runFind = jest.fn(() => Promise.resolve({ id: runId, state: ExecutionRunState.SUCCEEDED }));
  const observationFind = jest.fn(() => Promise.resolve(observation));
  const prisma = {
    releaseBundle: {
      findUnique: releaseFind,
      findFirst: releaseFind,
    },
    productionChannel: {
      findUnique: channelFind,
      findFirst: channelFind,
    },
    authorityGrant: {
      findUnique: grantFind,
      findFirst: grantFind,
    },
    automationSchedule: {
      findMany: jest.fn(() => Promise.resolve([schedule])),
      findUnique: topScheduleFind,
      findFirst: topScheduleFind,
    },
    automationDispatch: {
      findMany: jest.fn(() =>
        Promise.resolve([
          {
            id: dispatchId,
            scheduleId,
            scheduledFor: now,
            idempotencyKey: `automation:${scheduleId}:${now.toISOString()}`,
            state: AutomationDispatchState.PENDING,
            runId: null,
            error: null,
            createdAt: now,
            updatedAt: now,
            schedule: { ...schedule, channel: { currentReleaseId: releaseId } },
          },
        ]),
      ),
    },
    outcomeRecord: { findUnique: outcomeFind, findFirst: outcomeFind },
    executionRun: {
      findUnique: runFind,
      findFirst: runFind,
    },
    observation: {
      findMany: jest.fn(() => Promise.resolve([observation])),
      findUnique: observationFind,
      findFirst: observationFind,
    },
    improvementCandidate: { findMany: jest.fn(() => Promise.resolve([improvement])) },
    memoryCandidate: { findMany: jest.fn(() => Promise.resolve([memory])) },
    $transaction: jest.fn((callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
    ),
  };
  const execution = {
    createRun: jest.fn(() => Promise.resolve({ id: runId, state: 'awaiting_approval' })),
  };
  return {
    prisma,
    transaction,
    execution,
    service: new AutomationLearningService(
      prisma as unknown as PrismaClient,
      execution as unknown as ExecutionService,
    ),
  };
}

function appFor(service: AutomationLearningService) {
  return createApp(
    {
      health: { check: jest.fn() },
      platform: {
        registry: {},
        releaseGovernance: {},
        execution: {},
        automationLearning: service,
        executionDispatcher: { enqueue: jest.fn(), recoverAndResume: jest.fn() },
        dispatchMode: 'external',
      },
    } as unknown as ServiceBundle,
    pino({ level: 'silent' }),
  );
}

function scheduleBody(overrides: Record<string, unknown> = {}) {
  return {
    name: schedule.name,
    channelKey: schedule.channelKey,
    releaseId,
    authorityGrantId: grantId,
    timezone: schedule.timezone,
    intervalSeconds: schedule.intervalSeconds,
    nextRunAt: schedule.nextRunAt.toISOString(),
    inputTemplate: schedule.inputTemplate,
    inputConstraints: schedule.inputConstraints,
    catchUpPolicy: 'latest_only',
    maxCatchUpRuns: 10,
    deduplicationWindowSeconds: 300,
    retry: { maximumAttempts: 3, backoff: 'exponential' },
    cost: { maxInputTokens: 4000, maxOutputTokens: 1000, maxEstimatedCostUsd: 0.5 },
    outcomeExpectations: schedule.outcomeExpectations,
    ...overrides,
  };
}

describe('AutomationLearningService', () => {
  it('packs every sanitized digest line into the Daily Brief signals input', () => {
    const inputTemplate = structuredClone(schedule.inputTemplate);
    const summary = {
      headline: '2 runs · $0.42 · 1 promotion since the last briefing',
      runCount: 2,
      totalCostUsd: 0.42,
      promotionCount: 1,
      observationCount: 1,
      windowStartedAt: '2026-08-16T10:00:00.000Z',
      windowEndedAt: '2026-08-16T12:00:00.000Z',
      eventCount: 2,
      eventLines: ['A run completed for $0.42.', 'A certified release moved into production.'],
      omittedEventCount: 0,
    };

    appendPlatformDigestSignals(inputTemplate, summary);

    expect(inputTemplate.signals).toEqual([
      `Platform digest: ${summary.headline}.`,
      'Platform activity: A run completed for $0.42. A certified release moved into production.',
    ]);
    expect(() =>
      appendPlatformDigestSignals(
        { ...structuredClone(schedule.inputTemplate), signals: Array(99).fill('existing') },
        summary,
      ),
    ).toThrow('The Daily Brief signals array has no room');
  });

  it('maps schedules and executes a restart-safe due scheduling pass', async () => {
    const { service, execution, transaction } = harness();
    await expect(service.listSchedules({ state: 'active', limit: 20 })).resolves.toMatchObject({
      items: [{ id: scheduleId, state: 'active', retry: { backoff: 'exponential' } }],
    });
    await expect(service.getSchedule(scheduleId)).resolves.toMatchObject({ id: scheduleId });
    const result = await service.scheduleDue(now, 25);
    expect(result).toMatchObject({
      lockAcquired: true,
      claimedSchedules: 1,
      dispatchesCreated: 1,
      runsCreated: 1,
      awaitingApproval: 1,
    });
    expect(execution.createRun).toHaveBeenCalledWith(
      expect.objectContaining({ releaseId, authorityGrantId: grantId }),
      { digestSnapshotId: null },
    );
    expect(transaction.executionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { maxAttempts: 3 } }),
    );
  });

  it('records traceable observations and creates human-curated improvement candidates', async () => {
    const { service } = harness();
    await expect(
      service.listObservations({ sourceRunId: runId, limit: 20 }),
    ).resolves.toMatchObject({
      items: [{ id: observationId }],
    });
    await expect(
      service.createObservation({
        signalKey: observation.signalKey,
        signalType: observation.signalType,
        summary: observation.summary,
        evidence: observation.evidence,
        provenance: observation.provenance,
        sourceRunId: runId,
        sourceOutcomeId: outcomeId,
      }),
    ).resolves.toMatchObject({ id: observationId, sourceRunId: runId });
    await expect(service.listImprovementCandidates({ limit: 20 })).resolves.toMatchObject({
      items: [{ id: improvementId, state: 'proposed' }],
    });
    await expect(
      service.createImprovementCandidate({
        observationId,
        title: improvement.title,
        proposedTarget: improvement.proposedTarget,
        proposedChange: improvement.proposedChange,
        evidenceRefs: improvement.evidenceRefs,
      }),
    ).resolves.toMatchObject({ id: improvementId, state: 'proposed' });
  });

  it('stages memory only from a succeeded run and never accepts it automatically', async () => {
    const { service } = harness();
    await expect(
      service.listMemoryCandidates({ sourceRunId: runId, limit: 20 }),
    ).resolves.toMatchObject({
      items: [{ id: memoryId, state: 'staged', acceptedValue: null }],
    });
    await expect(
      service.createMemoryCandidate({
        sourceRunId: runId,
        namespace: memory.namespace,
        proposedValue: memory.proposedValue,
        provenance: memory.provenance,
      }),
    ).resolves.toMatchObject({ id: memoryId, state: 'staged' });
  });

  it('requires human routes for schedule and learning decisions and audits the mutations', async () => {
    const { service, transaction } = harness();
    const app = appFor(service);
    await request(app).post('/v1/automation-schedules').send(scheduleBody()).expect(201);
    await request(app)
      .post(`/v1/automation-schedules/${scheduleId}/state`)
      .send({ state: 'paused', rationale: 'Pause while the synthetic release is reviewed.' })
      .expect(200);
    await request(app)
      .post(`/v1/improvement-candidates/${improvementId}/review`)
      .send({
        decision: 'incubate',
        rationale: 'Preserve this proposal for a governed experiment.',
      })
      .expect(200);
    await request(app)
      .post(`/v1/memory-candidates/${memoryId}/review`)
      .send({
        decision: 'edit_accept',
        editedValue: { style: 'precise' },
        rationale: 'Accept the corrected preference after source review.',
      })
      .expect(200);
    expect(transaction.auditEvent.create).toHaveBeenCalled();
  });

  it('fails closed for invalid schedule constraints, authority, release, and channel state', async () => {
    const invalidTimezone = harness();
    await request(appFor(invalidTimezone.service))
      .post('/v1/automation-schedules')
      .send(scheduleBody({ timezone: 'Not/A_Timezone' }))
      .expect(400);

    const invalidConstraints = harness();
    await request(appFor(invalidConstraints.service))
      .post('/v1/automation-schedules')
      .send(
        scheduleBody({
          inputConstraints: { timezone: ['UTC'], nested: { required: true } },
        }),
      )
      .expect(422);

    const missingRelease = harness();
    missingRelease.prisma.releaseBundle.findUnique.mockResolvedValueOnce(null as never);
    await request(appFor(missingRelease.service))
      .post('/v1/automation-schedules')
      .send(scheduleBody())
      .expect(404);

    const missingChannel = harness();
    missingChannel.prisma.productionChannel.findUnique.mockResolvedValueOnce(null as never);
    await request(appFor(missingChannel.service))
      .post('/v1/automation-schedules')
      .send(scheduleBody())
      .expect(404);

    const staleChannel = harness();
    staleChannel.prisma.productionChannel.findUnique.mockResolvedValueOnce({
      key: 'default',
      currentReleaseId: randomUUID(),
    });
    await request(appFor(staleChannel.service))
      .post('/v1/automation-schedules')
      .send(scheduleBody())
      .expect(409);

    const missingGrant = harness();
    missingGrant.prisma.authorityGrant.findUnique.mockResolvedValueOnce(null as never);
    await request(appFor(missingGrant.service))
      .post('/v1/automation-schedules')
      .send(scheduleBody())
      .expect(404);

    const mismatchedGrant = harness();
    mismatchedGrant.prisma.authorityGrant.findUnique.mockResolvedValueOnce({
      id: grantId,
      releaseId: randomUUID(),
      releaseDigest: 'b'.repeat(64),
    });
    await request(appFor(mismatchedGrant.service))
      .post('/v1/automation-schedules')
      .send(scheduleBody())
      .expect(422);
  });

  it('handles scheduler lock contention, superseded releases, and failed dispatches', async () => {
    const locked = harness();
    locked.transaction.$queryRaw.mockReset().mockResolvedValueOnce([{ acquired: false }]);
    await expect(locked.service.scheduleDue(now, 25)).resolves.toMatchObject({
      lockAcquired: false,
      runsCreated: 0,
    });

    const superseded = harness();
    superseded.transaction.automationSchedule.findMany.mockResolvedValueOnce([
      { ...schedule, channel: { currentReleaseId: randomUUID() } },
    ]);
    superseded.prisma.automationDispatch.findMany.mockResolvedValueOnce([]);
    await expect(superseded.service.scheduleDue(now, 25)).resolves.toMatchObject({
      claimedSchedules: 1,
      dispatchesCreated: 0,
      runsCreated: 0,
    });

    const failed = harness();
    failed.execution.createRun.mockRejectedValueOnce(new Error('synthetic dependency failure'));
    await expect(failed.service.scheduleDue(now, 25)).resolves.toMatchObject({
      runsCreated: 0,
      failedDispatches: 1,
    });
  });

  it('rejects broken observation, improvement, and memory lineage and repeated reviews', async () => {
    const missingOutcome = harness();
    missingOutcome.prisma.outcomeRecord.findUnique.mockResolvedValueOnce(null as never);
    await expect(
      missingOutcome.service.createObservation({
        signalKey: 'missing-outcome',
        signalType: 'gap',
        summary: 'This observation points at a missing outcome record.',
        evidence: {},
        provenance: {},
        sourceRunId: runId,
        sourceOutcomeId: outcomeId,
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_NOT_FOUND' });

    const mismatch = harness();
    mismatch.prisma.outcomeRecord.findUnique.mockResolvedValueOnce({
      id: outcomeId,
      runId: randomUUID(),
    });
    await expect(
      mismatch.service.createObservation({
        signalKey: 'lineage-mismatch',
        signalType: 'gap',
        summary: 'This observation has deliberately mismatched lineage.',
        evidence: {},
        provenance: {},
        sourceRunId: runId,
        sourceOutcomeId: outcomeId,
      }),
    ).rejects.toMatchObject({ code: 'OBSERVATION_LINEAGE_MISMATCH' });

    const missingObservation = harness();
    missingObservation.prisma.observation.findUnique.mockResolvedValueOnce(null as never);
    await expect(
      missingObservation.service.createImprovementCandidate({
        observationId,
        title: improvement.title,
        proposedTarget: improvement.proposedTarget,
        proposedChange: improvement.proposedChange,
        evidenceRefs: [],
      }),
    ).rejects.toMatchObject({ code: 'OBSERVATION_NOT_FOUND' });

    const failedRun = harness();
    failedRun.prisma.executionRun.findUnique.mockResolvedValueOnce({
      id: runId,
      state: ExecutionRunState.FAILED,
    } as never);
    await expect(
      failedRun.service.createMemoryCandidate({
        sourceRunId: runId,
        namespace: memory.namespace,
        proposedValue: memory.proposedValue,
        provenance: memory.provenance,
      }),
    ).rejects.toMatchObject({ code: 'MEMORY_SOURCE_NOT_SUCCEEDED' });

    const terminal = harness();
    terminal.transaction.improvementCandidate.findUnique.mockResolvedValueOnce({
      ...improvement,
      state: ImprovementCandidateState.REJECTED,
    } as never);
    terminal.transaction.memoryCandidate.findUnique.mockResolvedValueOnce({
      ...memory,
      state: MemoryCandidateState.ACCEPTED,
      acceptedValue: memory.proposedValue,
    } as never);
    await request(appFor(terminal.service))
      .post(`/v1/improvement-candidates/${improvementId}/review`)
      .send({ decision: 'reject', rationale: 'This candidate has already been reviewed once.' })
      .expect(409);
    await request(appFor(terminal.service))
      .post(`/v1/memory-candidates/${memoryId}/review`)
      .send({ decision: 'reject', rationale: 'This memory has already been reviewed once.' })
      .expect(409);
  });
});
