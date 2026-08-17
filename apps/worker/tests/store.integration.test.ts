import { createHash, randomUUID } from 'node:crypto';
import {
  ApprovalRequestState,
  AuthorityGrantState,
  ContextClassification,
  ExecutionRunState,
  ModelProviderKind,
  PrismaClient,
  ReleaseEvaluationVerdict,
  ReleasePromotionAction,
  ResourceKind,
  ResourceLifecycle,
  type AuthorityGrant,
  type ExecutionRun,
  type ReleaseBundle,
} from '@prisma/client';
import type { DailyBriefInput } from '@agent-builder/contracts';
import { pino } from 'pino';
import {
  DeterministicDailyBriefProvider,
  defaultDailyBriefExecutionContext,
  type ModelProvider,
  type ModelStreamEvent,
} from '@paul-os/runtime';
import type { WorkerConfig } from '../src/config.js';
import { ExecutionEngine } from '../src/engine.js';
import { PrismaWorkerStore } from '../src/store.js';

const databaseEnabled = process.env['RUN_DATABASE_INTEGRATION'] === 'true';
const describeDatabase = databaseEnabled ? describe : describe.skip;
const localScope = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  departmentId: '00000000-0000-4000-8000-000000000002',
} as const;

const prisma = new PrismaClient();
const store = new PrismaWorkerStore(prisma);
const logger = pino({ level: process.env['DEBUG_INTEGRATION'] === 'true' ? 'debug' : 'silent' });

const input: DailyBriefInput = {
  date: '2026-08-16',
  timezone: 'America/New_York',
  priorities: ['Verify durable execution'],
  calendarItems: [],
  tasks: ['Inspect the outcome'],
  signals: [],
  userConstraints: [],
};
const contextDigest = defaultDailyBriefExecutionContext.digest;

const config: WorkerConfig = {
  environment: 'test',
  logLevel: 'silent',
  concurrency: 1,
  pollMs: 5,
  leaseMs: 5_000,
  heartbeatMs: 20,
  shutdownTimeoutMs: 100,
  profilePath: '.local/profile/nonexistent-worker-integration-profile.yaml',
  provider: {
    kind: 'deterministic',
    policy: 'direct_allowed',
    model: 'daily-brief-fixture',
    timeoutMs: 1_000,
  },
  pricing: {
    inputUsdPerMillionTokens: 3,
    outputUsdPerMillionTokens: 15,
    version: 'worker-integration-pricing',
  },
};

interface Fixture {
  release: ReleaseBundle;
  grant: AuthorityGrant;
  run: ExecutionRun;
}

async function dailyBriefRelease(projectId: string | null = null): Promise<ReleaseBundle> {
  let family = await prisma.resourceFamily.findUnique({
    where: { kind_slug: { kind: ResourceKind.SKILL, slug: 'daily-brief' } },
  });
  family ??= await prisma.resourceFamily.create({
    data: {
      ...localScope,
      kind: ResourceKind.SKILL,
      slug: 'daily-brief',
      name: 'Daily Brief',
      createdBy: 'worker-test',
      updatedBy: 'worker-test',
    },
  });
  const suffix = randomUUID().replaceAll('-', '');
  const version = `1.0.0-worker${suffix}`;
  const digest = createHash('sha256').update(`resource:${suffix}`).digest('hex');
  const definition = {
    apiVersion: 'paul-os/v1',
    kind: 'Skill',
    metadata: {
      id: family.id,
      slug: 'daily-brief',
      version,
      name: 'Daily Brief',
      owner: 'worker-test',
      purpose: 'Produce a synthetic, governed daily briefing for worker integration tests.',
      lifecycle: 'candidate',
      provenance: 'worker-integration-test',
    },
    dependencies: [],
    spec: {
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      tools: [],
      permissions: [],
      contextRequirements: [],
      successCriteria: ['Return a schema-valid grounded daily brief'],
    },
  };
  const resource = await prisma.resourceVersion.create({
    data: {
      familyId: family.id,
      version,
      lifecycle: ResourceLifecycle.CANDIDATE,
      owner: 'worker-test',
      purpose: definition.metadata.purpose,
      definition,
      digest,
      sourceCommit: 'worker-integration-test',
      provenance: { source: 'worker-integration-test' },
      dependencyPins: [],
      frozenAt: new Date(),
      createdBy: 'worker-test',
      updatedBy: 'worker-test',
    },
  });
  return prisma.releaseBundle.create({
    data: {
      ...localScope,
      digest: createHash('sha256').update(`release:${suffix}`).digest('hex'),
      projectId,
      createdBy: 'worker-test',
      resources: {
        create: {
          resourceVersionId: resource.id,
          kind: ResourceKind.SKILL,
          digest,
          ordinal: 0,
        },
      },
    },
  });
}

async function createRun(
  release: ReleaseBundle,
  grant: AuthorityGrant,
  estimatedUpperCostUsd = 0.1,
  developmentDraft = true,
): Promise<ExecutionRun> {
  const entry = await prisma.releaseResource.findFirstOrThrow({
    where: { releaseId: release.id, kind: ResourceKind.SKILL },
  });
  return prisma.executionRun.create({
    data: {
      ...localScope,
      releaseId: release.id,
      entryResourceVersionId: entry.resourceVersionId,
      authorityGrantId: grant.id,
      releaseDigest: release.digest,
      contextDigest,
      contextProvenance: [
        {
          source: 'core',
          classification: 'public',
          tokenContribution: defaultDailyBriefExecutionContext.estimatedTokens,
        },
      ],
      contextClassification: ContextClassification.PUBLIC,
      contextEstimatedTokens: defaultDailyBriefExecutionContext.estimatedTokens,
      projectId: release.projectId,
      state: ExecutionRunState.QUEUED,
      input,
      providerKind: ModelProviderKind.DETERMINISTIC,
      developmentDraft,
      providerVersion: '1.0.0',
      model: 'daily-brief-fixture',
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      maxEstimatedCostUsd: estimatedUpperCostUsd,
      estimatedUpperCostUsd,
      pricingVersion: config.pricing.version,
      idempotencyKey: `worker-test:${randomUUID()}`,
      requestedBy: 'worker-test',
    },
  });
}

async function fixture(
  options: {
    state?: AuthorityGrantState;
    validUntil?: Date;
    maxRuns?: number;
    totalCostBudgetUsd?: number;
    estimatedUpperCostUsd?: number;
    projectId?: string;
    developmentDraft?: boolean;
    contextDigest?: string;
  } = {},
): Promise<Fixture> {
  const release = await dailyBriefRelease(options.projectId ?? null);
  const entry = await prisma.releaseResource.findFirstOrThrow({
    where: { releaseId: release.id, kind: ResourceKind.SKILL },
  });
  const grant = await prisma.authorityGrant.create({
    data: {
      ...localScope,
      releaseId: release.id,
      entryResourceVersionId: entry.resourceVersionId,
      releaseDigest: release.digest,
      contextDigest: options.contextDigest ?? contextDigest,
      projectId: release.projectId,
      inputConstraints: {},
      toolScopes: [],
      validFrom: new Date(Date.now() - 60_000),
      validUntil: options.validUntil ?? new Date(Date.now() + 60_000),
      maxRuns: options.maxRuns ?? 10,
      maxEstimatedCostPerRunUsd: options.estimatedUpperCostUsd ?? 0.1,
      totalCostBudgetUsd: options.totalCostBudgetUsd ?? 10,
      state: options.state ?? AuthorityGrantState.ACTIVE,
      actorId: 'worker-test',
      rationale: 'Synthetic worker integration authority',
    },
  });
  return {
    release,
    grant,
    run: await createRun(
      release,
      grant,
      options.estimatedUpperCostUsd,
      options.developmentDraft ?? true,
    ),
  };
}

async function activateProductionRelease(release: ReleaseBundle): Promise<void> {
  const releaseResource = await prisma.releaseResource.findFirstOrThrow({
    where: { releaseId: release.id },
  });
  const executorKind = 'worker_test';
  const executorVersion = '1.0.0';
  const evaluationMode = 'deterministic_contract';
  const historySnapshotDigest = createHash('sha256').update('[]').digest('hex');
  const evaluation = await prisma.releaseEvaluation.upsert({
    where: {
      releaseId_suiteVersionId_suiteDigest_executorKind_executorVersion_evaluationMode_historySnapshotDigest:
        {
          releaseId: release.id,
          suiteVersionId: releaseResource.resourceVersionId,
          suiteDigest: releaseResource.digest,
          executorKind,
          executorVersion,
          evaluationMode,
          historySnapshotDigest,
        },
    },
    create: {
      releaseId: release.id,
      releaseDigest: release.digest,
      suiteVersionId: releaseResource.resourceVersionId,
      suiteDigest: releaseResource.digest,
      executorKind,
      executorVersion,
      evaluationMode,
      historySnapshotDigest,
      corpusVersion: 1,
      verdict: ReleaseEvaluationVerdict.PASSED,
      results: [],
      gateScores: {},
      evidence: { source: 'worker-integration-test' },
      requestedBy: 'worker-test',
      finishedAt: new Date(),
    },
    update: {},
  });
  const channelKey = release.projectId ?? 'default';
  await prisma.$transaction(async (transaction) => {
    const channel = await transaction.productionChannel.upsert({
      where: { key: channelKey },
      create: { ...localScope, key: channelKey, projectId: release.projectId },
      update: {},
    });
    const decision = await transaction.releasePromotionDecision.create({
      data: {
        channelKey,
        action: ReleasePromotionAction.PROMOTED,
        releaseId: release.id,
        previousReleaseId: channel.currentReleaseId,
        evaluationId: evaluation.id,
        rationale: 'Activate an isolated release for worker pointer tests.',
        decidedBy: 'worker-test',
      },
    });
    await transaction.$queryRaw`SELECT set_config('paul_os.production_decision_id', ${decision.id}, true)`;
    await transaction.productionChannel.update({
      where: { key: channelKey },
      data: {
        currentReleaseId: release.id,
        priorReleaseId: channel.currentReleaseId,
        promotedBy: 'worker-test',
        promotedAt: new Date(),
      },
    });
  });
}

async function approveProductionEpoch(runId: string): Promise<void> {
  await prisma.approvalRequest.create({
    data: {
      runId,
      state: ApprovalRequestState.APPROVED,
      reasons: ['First run of a newly promoted release'],
      requestedBy: 'worker-test',
      decidedBy: 'worker-test-human',
      rationale: 'Approve the first execution in this isolated production epoch.',
      decidedAt: new Date(),
    },
  });
}

class HangingProvider implements ModelProvider {
  readonly kind = 'deterministic' as const;
  readonly version = '1.0.0';
  readonly model = 'daily-brief-fixture';

  async *stream(_request: unknown, signal?: AbortSignal): AsyncIterable<ModelStreamEvent> {
    await new Promise<void>((resolve) => {
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    if (signal?.aborted) throw signal.reason;
    yield { type: 'complete', stopReason: 'end_turn' };
  }
}

class MalformedProvider implements ModelProvider {
  readonly kind = 'deterministic' as const;
  readonly version = '1.0.0';
  readonly model = 'daily-brief-fixture';

  async *stream(): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();
    yield { type: 'text_delta', text: 'not-json' };
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: 'complete', stopReason: 'end_turn' };
  }
}

async function waitForRunning(runId: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const run = await prisma.executionRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.state === ExecutionRunState.RUNNING) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Run did not enter running state');
}

describeDatabase('PrismaWorkerStore integration', () => {
  beforeEach(async () => {
    await prisma.executionRun.updateMany({
      where: {
        state: { in: [ExecutionRunState.QUEUED, ExecutionRunState.RUNNING] },
      },
      data: {
        state: ExecutionRunState.CANCELLED,
        message: 'Superseded by the next isolated worker integration case',
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
      },
    });
  });

  afterAll(async () => prisma.$disconnect());

  it.each(['revoked', 'expired'])(
    'does not execute a %s grant after queueing',
    async (condition) => {
      const created = await fixture();
      await prisma.authorityGrant.update({
        where: { id: created.grant.id },
        data:
          condition === 'revoked'
            ? {
                state: AuthorityGrantState.REVOKED,
                revokedAt: new Date(),
                revokedBy: 'worker-test',
              }
            : { validUntil: new Date(Date.now() - 1_000) },
      });
      await expect(store.claimNext(`worker:${randomUUID()}`, 5_000)).resolves.toBeNull();
      const [run, grant] = await Promise.all([
        prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } }),
        prisma.authorityGrant.findUniqueOrThrow({ where: { id: created.grant.id } }),
      ]);
      expect(run.state).toBe(ExecutionRunState.AWAITING_APPROVAL);
      expect(grant.usedRuns).toBe(0);
      expect(Number(grant.reservedCostUsd)).toBe(0);
    },
  );

  it('rejects a queued run whose authority was granted for a different context snapshot', async () => {
    const created = await fixture({ contextDigest: 'f'.repeat(64) });
    await expect(store.claimNext(`worker:${randomUUID()}`, 5_000)).resolves.toBeNull();
    const run = await prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } });
    expect(run.state).toBe(ExecutionRunState.AWAITING_APPROVAL);
    expect(run.authorityGrantId).toBeNull();
  });

  it('enforces immutable context bindings in PostgreSQL', async () => {
    const created = await fixture();
    await expect(
      prisma.executionRun.update({
        where: { id: created.run.id },
        data: { contextDigest: 'e'.repeat(64) },
      }),
    ).rejects.toThrow(/context summary is immutable/i);
    await expect(
      prisma.authorityGrant.update({
        where: { id: created.grant.id },
        data: { contextDigest: 'e'.repeat(64) },
      }),
    ).rejects.toThrow(/context digest is immutable/i);
  });

  it('rejects queued non-development work after the production pointer moves', async () => {
    const projectId = `worker-pointer-${randomUUID()}`;
    const created = await fixture({ projectId, developmentDraft: false });
    await activateProductionRelease(created.release);
    await approveProductionEpoch(created.run.id);
    const successor = await dailyBriefRelease(projectId);
    await activateProductionRelease(successor);

    await expect(store.claimNext(`worker:${randomUUID()}`, 5_000)).resolves.toBeNull();

    const [run, grant] = await Promise.all([
      prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } }),
      prisma.authorityGrant.findUniqueOrThrow({ where: { id: created.grant.id } }),
    ]);
    expect(run.state).toBe(ExecutionRunState.AWAITING_APPROVAL);
    expect(run.message).toContain('no longer the current production release');
    expect(grant.usedRuns).toBe(0);
    expect(Number(grant.reservedCostUsd)).toBe(0);
  });

  it('requires a human-approved first run for the exact production epoch', async () => {
    const projectId = `worker-approval-${randomUUID()}`;
    const created = await fixture({ projectId, developmentDraft: false });
    await activateProductionRelease(created.release);

    await expect(store.claimNext(`worker:${randomUUID()}`, 5_000)).resolves.toBeNull();

    const run = await prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } });
    expect(run.state).toBe(ExecutionRunState.AWAITING_APPROVAL);
    expect(run.message).toContain('requires human approval');
  });

  it('does not reuse first-run approval after the same release enters a new epoch', async () => {
    const projectId = `worker-epoch-${randomUUID()}`;
    const created = await fixture({ projectId, developmentDraft: false });
    await activateProductionRelease(created.release);
    await approveProductionEpoch(created.run.id);
    const successor = await dailyBriefRelease(projectId);
    await activateProductionRelease(successor);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    await activateProductionRelease(created.release);

    await expect(store.claimNext(`worker:${randomUUID()}`, 5_000)).resolves.toBeNull();

    const run = await prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } });
    expect(run.state).toBe(ExecutionRunState.AWAITING_APPROVAL);
    expect(run.message).toContain('requires human approval');
  });

  it('discards an in-flight result and records its cost after the production pointer moves', async () => {
    const projectId = `worker-inflight-${randomUUID()}`;
    const created = await fixture({ projectId, developmentDraft: false });
    await activateProductionRelease(created.release);
    await approveProductionEpoch(created.run.id);
    const workerId = `worker:${randomUUID()}`;
    const claimed = await store.claimNext(workerId, 5_000);
    expect(claimed?.id).toBe(created.run.id);
    if (claimed === null) throw new Error('Expected the production run to be claimed');

    const successor = await dailyBriefRelease(projectId);
    await activateProductionRelease(successor);
    await expect(
      store.heartbeat(claimed.id, workerId, 5_000, claimed.productionEpoch),
    ).resolves.toMatchObject({ owned: true, cancellationRequested: true });
    await expect(
      store.complete(claimed, workerId, {
        output: {
          topPriorities: ['Verify durable execution'],
          scheduleRisks: [],
          decisionsRequired: [],
          proposedActions: ['Inspect the outcome'],
          citations: [],
          confidence: 0.9,
          unresolvedItems: [],
        },
        usage: { inputTokens: 10, outputTokens: 10 },
        actualCostUsd: 0.001,
        latencyMs: 25,
        qualityScore: 1,
        pricingVersion: config.pricing.version,
        providerKind: 'deterministic',
        providerVersion: '1.0.0',
        model: 'daily-brief-fixture',
      }),
    ).resolves.toBe(false);

    const [run, grant, outcome, costMetric] = await Promise.all([
      prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } }),
      prisma.authorityGrant.findUniqueOrThrow({ where: { id: created.grant.id } }),
      prisma.outcomeRecord.findUnique({ where: { runId: created.run.id } }),
      prisma.metricSample.findFirst({
        where: { runId: created.run.id, name: 'model.cost' },
      }),
    ]);
    expect(run.state).toBe(ExecutionRunState.CANCELLED);
    expect(outcome).toBeNull();
    expect(costMetric?.value).toBeCloseTo(0.001);
    expect(Number(grant.spentCostUsd)).toBeCloseTo(0.001);
    expect(Number(grant.reservedCostUsd)).toBe(0);
  });

  it('serializes concurrent claims against the same grant budget', async () => {
    const created = await fixture({ totalCostBudgetUsd: 0.15, estimatedUpperCostUsd: 0.1 });
    const second = await createRun(created.release, created.grant, 0.1);
    const workers = [`worker:${randomUUID()}`, `worker:${randomUUID()}`];
    const claims = await Promise.all([
      store.claimNext(workers[0]!, 5_000),
      store.claimNext(workers[1]!, 5_000),
    ]);
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    const grant = await prisma.authorityGrant.findUniqueOrThrow({
      where: { id: created.grant.id },
    });
    expect(grant.usedRuns).toBe(1);
    expect(Number(grant.reservedCostUsd)).toBeCloseTo(0.1);
    const states = await prisma.executionRun.findMany({
      where: { id: { in: [created.run.id, second.id] } },
      select: { state: true },
    });
    expect(states.map(({ state }) => state).sort()).toEqual(
      [ExecutionRunState.PAUSED_BUDGET, ExecutionRunState.RUNNING].sort(),
    );
    const claimedIndex = claims.findIndex((claim) => claim !== null);
    const claimed = claims[claimedIndex];
    if (claimedIndex >= 0 && claimed !== undefined && claimed !== null) {
      await store.cancelClaimed(claimed.id, workers[claimedIndex]!);
    }
  });

  it('aborts an in-flight stream and releases its reservation on cancellation', async () => {
    const created = await fixture();
    const engine = new ExecutionEngine(store, new HangingProvider(), config, logger);
    const running = engine.runNext('worker:cancellation');
    await waitForRunning(created.run.id);
    await prisma.executionRun.update({
      where: { id: created.run.id },
      data: { cancelRequestedAt: new Date() },
    });
    await running;
    const [run, grant, outcome] = await Promise.all([
      prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } }),
      prisma.authorityGrant.findUniqueOrThrow({ where: { id: created.grant.id } }),
      prisma.outcomeRecord.findUnique({ where: { runId: created.run.id } }),
    ]);
    expect(run.state).toBe(ExecutionRunState.CANCELLED);
    expect(Number(grant.reservedCostUsd)).toBe(0);
    expect(outcome).toBeNull();
  });

  it('records a deterministic outcome, metrics, spend, and reservation release atomically', async () => {
    const created = await fixture();
    const digestActor = `human:worker-digest-${randomUUID()}`;
    const digestEvent = await prisma.platformEvent.create({
      data: {
        ...localScope,
        kind: 'observation.created',
        entityType: 'Observation',
        entityId: randomUUID(),
        summary: {},
        actorId: digestActor,
      },
    });
    await prisma.attentionCursor.create({
      data: {
        ...localScope,
        departmentScopeKey: localScope.departmentId,
        actorId: digestActor,
      },
    });
    const digestSnapshot = await prisma.digestSnapshot.create({
      data: {
        ...localScope,
        departmentScopeKey: localScope.departmentId,
        actorId: digestActor,
        windowStartedAt: digestEvent.occurredAt,
        windowEndedAt: new Date(),
        eventSequenceFrom: digestEvent.sequence,
        eventSequenceThrough: digestEvent.sequence,
        summary: {
          headline: 'One observation is ready for the Daily Brief.',
          runCount: 0,
          totalCostUsd: 0,
          promotionCount: 0,
          observationCount: 1,
          windowStartedAt: digestEvent.occurredAt.toISOString(),
          windowEndedAt: new Date().toISOString(),
        },
      },
    });
    await prisma.executionRun.update({
      where: { id: created.run.id },
      data: { digestSnapshotId: digestSnapshot.id },
    });
    const engine = new ExecutionEngine(
      store,
      new DeterministicDailyBriefProvider(),
      config,
      logger,
    );
    await engine.runNext('worker:success');
    const [run, grant, outcome, metrics, runEvents, delivery, cursor] = await Promise.all([
      prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } }),
      prisma.authorityGrant.findUniqueOrThrow({ where: { id: created.grant.id } }),
      prisma.outcomeRecord.findUnique({ where: { runId: created.run.id } }),
      prisma.metricSample.findMany({ where: { runId: created.run.id } }),
      prisma.executionRunEvent.findMany({
        where: { runId: created.run.id },
        orderBy: { sequence: 'asc' },
      }),
      prisma.digestDeliveryAttempt.findFirst({
        where: { snapshotId: digestSnapshot.id, state: 'DELIVERED' },
      }),
      prisma.attentionCursor.findUniqueOrThrow({
        where: {
          workspaceId_departmentScopeKey_actorId: {
            workspaceId: localScope.workspaceId,
            departmentScopeKey: localScope.departmentId,
            actorId: digestActor,
          },
        },
      }),
    ]);
    expect(run.state).toBe(ExecutionRunState.SUCCEEDED);
    expect(outcome).not.toBeNull();
    expect(metrics.map(({ name }) => name)).toContain('model.cost');
    expect(Number(grant.reservedCostUsd)).toBe(0);
    expect(Number(grant.spentCostUsd)).toBeGreaterThan(0);
    expect(runEvents.map(({ state }) => state)).toEqual(
      expect.arrayContaining(['running', 'succeeded']),
    );
    expect(delivery?.briefingRunId).toBe(created.run.id);
    expect(cursor.lastDeliveredEventSequence).toBe(digestEvent.sequence);
  });

  it('records incurred provider cost but publishes no outcome after a late cancellation', async () => {
    const created = await fixture();
    const workerId = 'worker:late-cancel';
    const claimed = await store.claimNext(workerId, 5_000);
    expect(claimed?.id).toBe(created.run.id);
    if (claimed === null) throw new Error('Expected the fixture run to be claimed');
    await prisma.executionRun.update({
      where: { id: created.run.id },
      data: { cancelRequestedAt: new Date() },
    });
    await expect(
      store.complete(claimed, workerId, {
        output: {
          topPriorities: ['Verify durable execution'],
          scheduleRisks: [],
          decisionsRequired: [],
          proposedActions: ['Inspect the outcome'],
          citations: [],
          confidence: 0.9,
          unresolvedItems: [],
        },
        usage: { inputTokens: 10, outputTokens: 10 },
        actualCostUsd: 0.001,
        latencyMs: 25,
        qualityScore: 1,
        pricingVersion: config.pricing.version,
        providerKind: 'deterministic',
        providerVersion: '1.0.0',
        model: 'daily-brief-fixture',
      }),
    ).resolves.toBe(false);
    const [run, grant, outcome, costMetric] = await Promise.all([
      prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } }),
      prisma.authorityGrant.findUniqueOrThrow({ where: { id: created.grant.id } }),
      prisma.outcomeRecord.findUnique({ where: { runId: created.run.id } }),
      prisma.metricSample.findFirst({
        where: { runId: created.run.id, name: 'model.cost' },
      }),
    ]);
    expect(run.state).toBe(ExecutionRunState.CANCELLED);
    expect(outcome).toBeNull();
    expect(costMetric?.value).toBeCloseTo(0.001);
    expect(Number(grant.reservedCostUsd)).toBe(0);
    expect(Number(grant.spentCostUsd)).toBeCloseTo(0.001);
  });

  it('publishes no outcome but settles observed usage when authority is revoked in flight', async () => {
    const created = await fixture();
    const workerId = 'worker:inflight-revoke';
    const claimed = await store.claimNext(workerId, 5_000);
    expect(claimed?.id).toBe(created.run.id);
    if (claimed === null) throw new Error('Expected the fixture run to be claimed');
    await prisma.authorityGrant.update({
      where: { id: created.grant.id },
      data: {
        state: AuthorityGrantState.REVOKED,
        revokedAt: new Date(),
        revokedBy: 'worker-test-human',
      },
    });

    await expect(
      store.complete(claimed, workerId, {
        output: {
          topPriorities: ['Verify durable execution'],
          scheduleRisks: [],
          decisionsRequired: [],
          proposedActions: ['Inspect the outcome'],
          citations: [],
          confidence: 0.9,
          unresolvedItems: [],
        },
        usage: { inputTokens: 10, outputTokens: 10 },
        actualCostUsd: 0.001,
        latencyMs: 25,
        qualityScore: 1,
        pricingVersion: config.pricing.version,
        providerKind: 'deterministic',
        providerVersion: '1.0.0',
        model: 'daily-brief-fixture',
      }),
    ).resolves.toBe(false);

    const [run, grant, outcome, costMetric] = await Promise.all([
      prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } }),
      prisma.authorityGrant.findUniqueOrThrow({ where: { id: created.grant.id } }),
      prisma.outcomeRecord.findUnique({ where: { runId: created.run.id } }),
      prisma.metricSample.findFirst({
        where: { runId: created.run.id, name: 'model.cost' },
      }),
    ]);
    expect(run.state).toBe(ExecutionRunState.CANCELLED);
    expect(outcome).toBeNull();
    expect(costMetric?.value).toBeCloseTo(0.001);
    expect(Number(grant.spentCostUsd)).toBeCloseTo(0.001);
    expect(Number(grant.reservedCostUsd)).toBe(0);
    expect(grant.state).toBe(AuthorityGrantState.REVOKED);
  });

  it('releases a reservation before scheduling a retry', async () => {
    const created = await fixture();
    const engine = new ExecutionEngine(store, new MalformedProvider(), config, logger);
    await engine.runNext('worker:failure');
    const [run, grant, outcome, costMetric] = await Promise.all([
      prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } }),
      prisma.authorityGrant.findUniqueOrThrow({ where: { id: created.grant.id } }),
      prisma.outcomeRecord.findUnique({ where: { runId: created.run.id } }),
      prisma.metricSample.findFirst({
        where: { runId: created.run.id, name: 'model.cost' },
      }),
    ]);
    expect(run.state).toBe(ExecutionRunState.QUEUED);
    expect(Number(run.actualCostUsd)).toBeGreaterThan(0);
    expect(Number(grant.reservedCostUsd)).toBe(0);
    expect(Number(grant.spentCostUsd)).toBeGreaterThan(0);
    expect(grant.usedRuns).toBe(1);
    expect(costMetric?.value).toBeGreaterThan(0);
    expect(outcome).toBeNull();
  });

  it('charges maxRuns once per logical run while reserving cost for every retry attempt', async () => {
    const created = await fixture({ maxRuns: 1 });
    const firstWorker = `worker:${randomUUID()}`;
    const firstClaim = await store.claimNext(firstWorker, 5_000);
    expect(firstClaim?.id).toBe(created.run.id);
    if (firstClaim === null) throw new Error('Expected the first attempt to be claimed');
    await store.failOrRetry(firstClaim, firstWorker, 'RETRYABLE_TEST_FAILURE', true);
    await prisma.executionRun.update({
      where: { id: created.run.id },
      data: { updatedAt: new Date(Date.now() - 10_000) },
    });

    const secondWorker = `worker:${randomUUID()}`;
    const secondClaim = await store.claimNext(secondWorker, 5_000);
    expect(secondClaim?.id).toBe(created.run.id);
    const grant = await prisma.authorityGrant.findUniqueOrThrow({
      where: { id: created.grant.id },
    });
    expect(grant.usedRuns).toBe(1);
    expect(Number(grant.reservedCostUsd)).toBeCloseTo(0.1);
    if (secondClaim !== null) await store.cancelClaimed(secondClaim.id, secondWorker);
  });

  it('reconciles reservations while recovering expired leases', async () => {
    const created = await fixture();
    await prisma.$transaction([
      prisma.authorityGrant.update({
        where: { id: created.grant.id },
        data: { usedRuns: 1, reservedCostUsd: 0.1 },
      }),
      prisma.executionRun.update({
        where: { id: created.run.id },
        data: {
          state: ExecutionRunState.RUNNING,
          attempts: 1,
          leaseOwner: 'dead-worker',
          leaseExpiresAt: new Date(Date.now() - 1_000),
          heartbeatAt: new Date(Date.now() - 2_000),
        },
      }),
    ]);
    await store.recoverExpiredLeases();
    const [run, grant] = await Promise.all([
      prisma.executionRun.findUniqueOrThrow({ where: { id: created.run.id } }),
      prisma.authorityGrant.findUniqueOrThrow({ where: { id: created.grant.id } }),
    ]);
    expect(run.state).toBe(ExecutionRunState.QUEUED);
    expect(Number(grant.reservedCostUsd)).toBe(0);
  });
});
