import { randomUUID } from 'node:crypto';
import {
  ApprovalRequestState,
  ContextClassification,
  ExecutionRunState,
  ImprovementCandidateState,
  MemoryCandidateState,
  ModelProviderKind,
  PrismaClient,
  ReleaseEvaluationVerdict,
  ResourceKind,
  ResourceLifecycle,
} from '@prisma/client';
import { runWithPrincipal, type RequestPrincipal } from '../src/request-context.js';
import {
  appendExecutionRunEvent,
  appendPlatformEvent,
  AttentionService,
} from '../src/services/attention-service.js';
import { ReleaseGovernanceService } from '../src/services/release-governance-service.js';
import { ExecutionService } from '../src/services/execution-service.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';

const runDatabaseIntegration =
  process.env['RUN_DATABASE_INTEGRATION'] === 'true' && process.env['DATABASE_URL'];
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;

function principal(
  actorId: string,
  departmentId: string | null = LOCAL_DEPARTMENT_ID,
): RequestPrincipal {
  return {
    actorId,
    workspaceId: LOCAL_WORKSPACE_ID,
    departmentId,
    authentication: 'local',
    requestId: randomUUID(),
  };
}

function digest(seed: string): string {
  return Buffer.from(seed).toString('hex').slice(0, 64).padEnd(64, '0');
}

describeDatabase('Quiet Console Attention ledger', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createRelease(actorId: string, departmentId: string | null = LOCAL_DEPARTMENT_ID) {
    const releaseId = randomUUID();
    const familyId = randomUUID();
    const entryResourceVersionId = randomUUID();
    const projectId = `attention-${randomUUID()}`;
    const release = await prisma.$transaction(async (transaction) => {
      await transaction.resourceFamily.create({
        data: {
          id: familyId,
          workspaceId: LOCAL_WORKSPACE_ID,
          departmentId,
          kind: ResourceKind.SKILL,
          slug: `attention-entry-${familyId}`,
          name: 'Attention fixture entrypoint',
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      await transaction.resourceVersion.create({
        data: {
          id: entryResourceVersionId,
          familyId,
          version: '1.0.0',
          lifecycle: ResourceLifecycle.CANDIDATE,
          owner: actorId,
          purpose: 'Provide an exact entrypoint for Attention integration runs.',
          definition: {},
          digest: digest(`entry-${entryResourceVersionId}`),
          sourceCommit: 'a'.repeat(40),
          provenance: {},
          dependencyPins: [],
          frozenAt: new Date(),
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      return transaction.releaseBundle.create({
        data: {
          id: releaseId,
          workspaceId: LOCAL_WORKSPACE_ID,
          departmentId,
          digest: digest(releaseId),
          projectId,
          createdBy: actorId,
          resources: {
            create: {
              resourceVersionId: entryResourceVersionId,
              kind: ResourceKind.SKILL,
              digest: digest(`entry-${entryResourceVersionId}`),
              ordinal: 1,
            },
          },
        },
      });
    });
    return { ...release, entryResourceVersionId };
  }

  async function createRun(
    release: {
      id: string;
      digest: string;
      projectId: string | null;
      entryResourceVersionId: string;
    },
    actorId: string,
    state: ExecutionRunState,
    digestSnapshotId: string | null = null,
    departmentId: string | null = LOCAL_DEPARTMENT_ID,
  ) {
    const runId = randomUUID();
    return prisma.executionRun.create({
      data: {
        id: runId,
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId,
        digestSnapshotId,
        releaseId: release.id,
        entryResourceVersionId: release.entryResourceVersionId,
        releaseDigest: release.digest,
        contextDigest: digest(`context-${runId}`),
        contextProvenance: [],
        contextClassification: ContextClassification.PUBLIC,
        contextEstimatedTokens: 10,
        projectId: release.projectId,
        requiredToolScopes: ['calendar.read'],
        state,
        input: {},
        providerKind: ModelProviderKind.DETERMINISTIC,
        developmentDraft: true,
        providerVersion: '1.0.0',
        model: 'attention-fixture',
        maxInputTokens: 1_000,
        maxOutputTokens: 500,
        maxEstimatedCostUsd: 1,
        estimatedUpperCostUsd: 0.25,
        pricingVersion: 'fixture-v1',
        approvalReasons: state === ExecutionRunState.AWAITING_APPROVAL ? ['Needs authority'] : [],
        progress: state === ExecutionRunState.FAILED ? 40 : 0,
        message:
          state === ExecutionRunState.FAILED ? 'Fixture failure' : 'Awaiting authority approval',
        idempotencyKey: `attention-${runId}`,
        requestedBy: actorId,
        ...(state === ExecutionRunState.FAILED ? { finishedAt: new Date() } : {}),
      },
    });
  }

  async function createPassingEvaluation(releaseId: string, actorId: string) {
    const familyId = randomUUID();
    const suiteVersionId = randomUUID();
    await prisma.resourceFamily.create({
      data: {
        id: familyId,
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        kind: ResourceKind.EVALUATION_SUITE,
        slug: `attention-suite-${familyId}`,
        name: 'Attention fixture suite',
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await prisma.resourceVersion.create({
      data: {
        id: suiteVersionId,
        familyId,
        version: '1.0.0',
        lifecycle: ResourceLifecycle.CANDIDATE,
        owner: actorId,
        purpose: 'Provide immutable passing evidence for the Attention integration test.',
        definition: {},
        digest: digest(`suite-${suiteVersionId}`),
        sourceCommit: 'a'.repeat(40),
        provenance: {},
        dependencyPins: [],
        frozenAt: new Date(),
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await prisma.releaseResource.create({
      data: {
        releaseId,
        resourceVersionId: suiteVersionId,
        kind: ResourceKind.EVALUATION_SUITE,
        digest: digest(`suite-${suiteVersionId}`),
        ordinal: 0,
      },
    });
    const evaluation = await prisma.releaseEvaluation.create({
      data: {
        releaseId,
        releaseDigest: (await prisma.releaseBundle.findUniqueOrThrow({ where: { id: releaseId } }))
          .digest,
        suiteVersionId,
        suiteDigest: digest(`suite-${suiteVersionId}`),
        executorKind: 'deterministic_contract',
        executorVersion: randomUUID(),
        evaluationMode: 'contract_validation',
        historySnapshotDigest: digest(`history-${randomUUID()}`),
        corpusVersion: 7,
        verdict: ReleaseEvaluationVerdict.PASSED,
        results: [],
        gateScores: {},
        evidence: { gateResults: [] },
        requestedBy: actorId,
        finishedAt: new Date(),
      },
    });
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT set_config('paul_os.certification_evidence_id', ${evaluation.id}, true)`;
      await transaction.resourceVersion.updateMany({
        where: {
          lifecycle: ResourceLifecycle.CANDIDATE,
          releases: { some: { releaseId } },
        },
        data: { lifecycle: ResourceLifecycle.CERTIFIED, updatedBy: actorId },
      });
    });
    return evaluation;
  }

  it('projects governed decisions and degraded runs, then records human decisions', async () => {
    const actorId = `human:attention-${randomUUID()}`;
    const requestPrincipal = principal(actorId);
    const release = await createRelease(actorId);
    const awaiting = await createRun(release, actorId, ExecutionRunState.AWAITING_APPROVAL);
    const failed = await createRun(release, actorId, ExecutionRunState.FAILED);
    const approval = await prisma.approvalRequest.create({
      data: {
        runId: awaiting.id,
        state: ApprovalRequestState.PENDING,
        reasons: ['Needs authority'],
        requestedBy: actorId,
      },
    });
    const memory = await prisma.memoryCandidate.create({
      data: {
        sourceRunId: awaiting.id,
        namespace: `attention.${randomUUID()}`,
        proposedValue: { priority: 'fixture' },
        provenance: { source: 'integration-test' },
        state: MemoryCandidateState.STAGED,
        stagedBy: actorId,
      },
    });
    const observation = await prisma.observation.create({
      data: {
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        signalKey: `attention-${randomUUID()}`,
        signalType: 'fixture',
        summary: 'A synthetic repeated behavior needs governed review.',
        observedBy: actorId,
      },
    });
    const improvement = await prisma.improvementCandidate.create({
      data: {
        observationId: observation.id,
        title: 'Review the synthetic repeated behavior',
        proposedTarget: 'daily-brief',
        proposedChange: 'Add a bounded synthetic fixture to the daily brief.',
        state: ImprovementCandidateState.PROPOSED,
        createdBy: actorId,
      },
    });
    const evaluation = await createPassingEvaluation(release.id, actorId);
    await runWithPrincipal(requestPrincipal, () =>
      prisma.$transaction((transaction) =>
        appendExecutionRunEvent(transaction, awaiting, {
          phase: 'authority',
          state: 'waiting',
          message: 'Waiting for a human authority decision.',
        }),
      ),
    );
    await prisma.runStep.create({
      data: {
        runId: awaiting.id,
        stepKey: 'context-assembly',
        idempotencyKey: `attention-step-${awaiting.id}`,
        state: 'succeeded',
      },
    });

    const service = new AttentionService(prisma);
    const queue = await runWithPrincipal(requestPrincipal, () => service.list());
    expect(queue.decide.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        `execution_approval:${awaiting.id}`,
        `release_promotion:${evaluation.id}`,
        `memory_review:${memory.id}`,
        `improvement_review:${improvement.id}`,
      ]),
    );
    expect(queue.degraded.map(({ id }) => id)).toContain(`stalled_run:${failed.id}`);
    expect(queue.decideBadgeCount).toBe(queue.decide.length);
    const promotionItem = queue.decide.find(
      ({ id }) => id === `release_promotion:${evaluation.id}`,
    );
    expect(promotionItem?.payload.reviewFacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Executor',
          value: expect.stringContaining('deterministic_contract'),
        }),
        expect.objectContaining({
          label: 'Evidence meaning',
          value: expect.stringContaining('semantic answer quality'),
        }),
      ]),
    );

    const detail = await runWithPrincipal(requestPrincipal, () =>
      service.getItem(`execution_approval:${awaiting.id}`),
    );
    expect(detail.item.payload.sourceId).toBe(approval.id);
    expect(detail.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'authority', state: 'waiting' }),
        expect.objectContaining({ phase: 'context-assembly', state: 'succeeded' }),
      ]),
    );
    expect(detail.details).toMatchObject({ runId: awaiting.id, requiredScopes: ['calendar.read'] });

    const channelCountBefore = await prisma.productionChannel.count({
      where: { key: release.projectId as string },
    });
    const governance = new ReleaseGovernanceService(prisma);
    const decline = await runWithPrincipal(requestPrincipal, () =>
      governance.decline(release.projectId as string, {
        releaseId: release.id,
        evaluationId: evaluation.id,
        rationale: 'Keep the current production release while this evidence is reviewed again.',
      }),
    );
    expect(decline.channel).toBeNull();
    expect(decline.decision.action).toBe('declined');
    expect(
      await prisma.productionChannel.count({ where: { key: release.projectId as string } }),
    ).toBe(channelCountBefore);
    await expect(
      runWithPrincipal(requestPrincipal, () =>
        governance.promote(release.projectId as string, {
          releaseId: release.id,
          evaluationId: evaluation.id,
          rationale: 'Promotion must not bypass the immutable decline decision.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'RELEASE_EVIDENCE_ALREADY_DECIDED', status: 409 });
    await expect(
      runWithPrincipal(requestPrincipal, () =>
        governance.decline(release.projectId as string, {
          releaseId: release.id,
          evaluationId: evaluation.id,
          rationale: 'Use a different rationale to prove the evidence decision is immutable.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'RELEASE_EVIDENCE_ALREADY_DECIDED', status: 409 });
    await expect(
      prisma.releaseDeclineDecision.update({
        where: { evaluationId: evaluation.id },
        data: { rationale: 'Mutation must fail.' },
      }),
    ).rejects.toThrow(/immutable|append-only/i);

    const execution = new ExecutionService(prisma, { environment: 'test' } as never, {} as never);
    const rejected = await runWithPrincipal(requestPrincipal, () =>
      execution.rejectRun(awaiting.id, {
        rationale: 'Do not grant this run access to the requested calendar scope.',
      }),
    );
    expect(rejected.state).toBe('cancelled');
    await expect(
      runWithPrincipal(requestPrincipal, () =>
        execution.rejectRun(awaiting.id, {
          rationale: 'A repeated decision must not change the terminal run.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'RUN_NOT_AWAITING_APPROVAL', status: 409 });
    expect(
      await prisma.approvalRequest.findUnique({ where: { runId: awaiting.id } }),
    ).toMatchObject({
      state: ApprovalRequestState.REJECTED,
      rationale: 'Do not grant this run access to the requested calendar scope.',
    });
    expect(
      await prisma.executionRunEvent.findMany({
        where: { runId: awaiting.id },
        orderBy: { sequence: 'asc' },
      }),
    ).toHaveLength(2);
    expect(
      await prisma.auditEvent.findMany({
        where: { entityId: awaiting.id, action: 'execution.rejected' },
      }),
    ).toHaveLength(1);

    const after = await runWithPrincipal(requestPrincipal, () => service.list());
    expect(after.decide.map(({ id }) => id)).not.toContain(`execution_approval:${awaiting.id}`);
    expect(after.decide.map(({ id }) => id)).not.toContain(`release_promotion:${evaluation.id}`);

    const resolution = await runWithPrincipal(requestPrincipal, () =>
      service.resolveItem(`stalled_run:${failed.id}`, {
        rationale: 'The terminal fixture failure was reviewed and requires no retry.',
      }),
    );
    expect(resolution.itemId).toBe(`stalled_run:${failed.id}`);
    const afterResolution = await runWithPrincipal(requestPrincipal, () => service.list());
    expect(afterResolution.degraded.map(({ id }) => id)).not.toContain(`stalled_run:${failed.id}`);
    const idempotentResolution = await runWithPrincipal(requestPrincipal, () =>
      service.resolveItem(`stalled_run:${failed.id}`, {
        rationale: 'The terminal fixture failure was reviewed and requires no retry.',
      }),
    );
    expect(idempotentResolution.id).toBe(resolution.id);

    const paused = await createRun(release, actorId, ExecutionRunState.PAUSED_BUDGET);
    await expect(
      runWithPrincipal(requestPrincipal, () =>
        service.resolveItem(`budget_stop:${paused.id}`, {
          rationale: 'A live budget stop must remain visible until its condition changes.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ATTENTION_ITEM_NOT_TERMINAL', status: 409 });

    const otherDepartmentId = randomUUID();
    await prisma.department.create({
      data: {
        id: otherDepartmentId,
        workspaceId: LOCAL_WORKSPACE_ID,
        slug: `attention-other-${otherDepartmentId}`,
        name: 'Attention Other Department',
      },
    });
    await expect(
      runWithPrincipal(principal(actorId, otherDepartmentId), () =>
        service.resolveItem(`stalled_run:${failed.id}`, {
          rationale: 'The terminal fixture failure was reviewed and requires no retry.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'ATTENTION_ITEM_NOT_FOUND', status: 404 });
    await expect(
      prisma.executionRunEvent.create({
        data: {
          workspaceId: LOCAL_WORKSPACE_ID,
          departmentId: otherDepartmentId,
          runId: failed.id,
          sequence: 1,
          phase: 'scope-bypass',
          state: 'failed',
          message: 'This forged child scope must be rejected.',
          metadata: {},
        },
      }),
    ).rejects.toThrow(/parent scope mismatch/i);
  });

  it('isolates workspace-global terminal acknowledgements by department scope', async () => {
    const actorId = `human:global-resolution-${randomUUID()}`;
    const departmentA = randomUUID();
    const departmentB = randomUUID();
    await prisma.department.createMany({
      data: [
        {
          id: departmentA,
          workspaceId: LOCAL_WORKSPACE_ID,
          slug: `resolution-a-${departmentA}`,
          name: 'Resolution Department A',
        },
        {
          id: departmentB,
          workspaceId: LOCAL_WORKSPACE_ID,
          slug: `resolution-b-${departmentB}`,
          name: 'Resolution Department B',
        },
      ],
    });
    const release = await createRelease(actorId, null);
    const failed = await createRun(release, actorId, ExecutionRunState.FAILED, null, null);
    const failedItemId = `stalled_run:${failed.id}`;
    const service = new AttentionService(prisma);
    const principalA = principal(actorId, departmentA);
    const principalB = principal(actorId, departmentB);
    const workspacePrincipal = principal(actorId, null);

    for (const scopedPrincipal of [principalA, principalB, workspacePrincipal]) {
      const queue = await runWithPrincipal(scopedPrincipal, () => service.list());
      expect(queue.degraded.map(({ id }) => id)).toContain(failedItemId);
    }

    await runWithPrincipal(principalA, () =>
      service.resolveItem(failedItemId, {
        rationale: 'Department A reviewed the global terminal failure independently.',
      }),
    );
    expect(
      (await runWithPrincipal(principalA, () => service.list())).degraded.map(({ id }) => id),
    ).not.toContain(failedItemId);
    expect(
      (await runWithPrincipal(principalB, () => service.list())).degraded.map(({ id }) => id),
    ).toContain(failedItemId);
    expect(
      (await runWithPrincipal(workspacePrincipal, () => service.list())).degraded.map(
        ({ id }) => id,
      ),
    ).toContain(failedItemId);

    await runWithPrincipal(principalB, () =>
      service.resolveItem(failedItemId, {
        rationale: 'Department B reviewed the global terminal failure independently.',
      }),
    );
    const resolutions = await prisma.attentionResolution.findMany({
      where: { workspaceId: LOCAL_WORKSPACE_ID, itemId: failedItemId },
      orderBy: { departmentScopeKey: 'asc' },
    });
    expect(
      resolutions.map(({ departmentId, departmentScopeKey }) => ({
        departmentId,
        departmentScopeKey,
      })),
    ).toEqual(
      [departmentA, departmentB]
        .sort()
        .map((departmentId) => ({ departmentId, departmentScopeKey: departmentId })),
    );

    await expect(
      prisma.attentionResolution.create({
        data: {
          workspaceId: LOCAL_WORKSPACE_ID,
          departmentId: departmentA,
          departmentScopeKey: departmentB,
          itemId: `stalled_run:${randomUUID()}`,
          rationale: 'This forged scope key must be rejected by the database.',
          resolvedBy: actorId,
        },
      }),
    ).rejects.toThrow(/department scope key mismatch/i);
  });

  it('advances the digest cursor only once after a delivered briefing', async () => {
    const actorId = `human:digest-${randomUUID()}`;
    const requestPrincipal = principal(actorId);
    const service = new AttentionService(prisma);
    await runWithPrincipal(requestPrincipal, () =>
      prisma.$transaction(async (transaction) => {
        await appendPlatformEvent(transaction, {
          kind: 'execution.succeeded',
          entityType: 'ExecutionRun',
          entityId: randomUUID(),
          summary: { costUsd: 0.21 },
        });
        await appendPlatformEvent(transaction, {
          kind: 'release.promoted',
          entityType: 'ReleaseBundle',
          entityId: randomUUID(),
          summary: {},
        });
      }),
    );

    const snapshot = await runWithPrincipal(requestPrincipal, () => service.createDigestSnapshot());
    expect(snapshot.state).toBe('pending');
    expect(snapshot.summary.runCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.summary.promotionCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.summary.totalCostUsd).toBeGreaterThanOrEqual(0.21);

    const failed = await runWithPrincipal(requestPrincipal, () =>
      service.recordDigestDelivery(snapshot.id, {
        attemptKey: `failed-${randomUUID()}`,
        state: 'failed',
        error: { code: 'BRIEFING_PROVIDER_UNAVAILABLE' },
      }),
    );
    expect(failed.state).toBe('failed');
    expect(
      await prisma.attentionCursor.findUniqueOrThrow({
        where: {
          workspaceId_departmentScopeKey_actorId: {
            workspaceId: LOCAL_WORKSPACE_ID,
            departmentScopeKey: LOCAL_DEPARTMENT_ID,
            actorId,
          },
        },
      }),
    ).toMatchObject({ lastDeliveredEventSequence: 0n, lastDeliveredAt: null });

    await runWithPrincipal(requestPrincipal, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'observation.created',
          entityType: 'Observation',
          entityId: randomUUID(),
          summary: {},
        }),
      ),
    );
    const reusedAfterFailure = await runWithPrincipal(requestPrincipal, () =>
      service.createDigestSnapshot(),
    );
    expect(reusedAfterFailure.id).toBe(snapshot.id);

    const attemptKey = `delivered-${randomUUID()}`;
    const delivered = await runWithPrincipal(requestPrincipal, () =>
      service.recordDigestDelivery(snapshot.id, { attemptKey, state: 'delivered' }),
    );
    expect(delivered.state).toBe('delivered');
    const cursor = await prisma.attentionCursor.findUniqueOrThrow({
      where: {
        workspaceId_departmentScopeKey_actorId: {
          workspaceId: LOCAL_WORKSPACE_ID,
          departmentScopeKey: LOCAL_DEPARTMENT_ID,
          actorId,
        },
      },
    });
    expect(cursor.lastDeliveredEventSequence.toString()).toBe(snapshot.eventSequenceThrough);
    expect(cursor.lastDeliveredAt).not.toBeNull();

    const idempotent = await runWithPrincipal(requestPrincipal, () =>
      service.recordDigestDelivery(snapshot.id, { attemptKey, state: 'delivered' }),
    );
    const duplicateDelivery = await runWithPrincipal(requestPrincipal, () =>
      service.recordDigestDelivery(snapshot.id, {
        attemptKey: `second-delivery-${randomUUID()}`,
        state: 'delivered',
      }),
    );
    expect(idempotent).toEqual(delivered);
    expect(duplicateDelivery).toEqual(delivered);
    expect(await prisma.digestDeliveryAttempt.count({ where: { snapshotId: snapshot.id } })).toBe(
      2,
    );

    await expect(
      prisma.digestSnapshot.update({
        where: { id: snapshot.id },
        data: { windowEndedAt: new Date() },
      }),
    ).rejects.toThrow(/immutable|append-only/i);
    const nextSnapshot = await runWithPrincipal(requestPrincipal, () =>
      service.createDigestSnapshot(),
    );
    expect(nextSnapshot.id).not.toBe(snapshot.id);
    expect(nextSnapshot.summary.observationCount).toBeGreaterThanOrEqual(1);
  });

  it('keeps Attention available and drains an oversized digest in lossless sequence chunks', async () => {
    const workspaceId = randomUUID();
    const departmentId = randomUUID();
    const actorId = `human:digest-overflow-${randomUUID()}`;
    const requestPrincipal: RequestPrincipal = {
      actorId,
      workspaceId,
      departmentId,
      authentication: 'local',
      requestId: randomUUID(),
    };
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        slug: `digest-overflow-${workspaceId}`,
        name: 'Digest Overflow Workspace',
      },
    });
    await prisma.department.create({
      data: {
        id: departmentId,
        workspaceId,
        slug: `digest-overflow-${departmentId}`,
        name: 'Digest Overflow Department',
      },
    });
    const eventPeriodStart = new Date('2026-08-15T10:00:00.000Z');
    await prisma.platformEvent.createMany({
      data: Array.from({ length: 251 }, (_, index) => ({
        id: randomUUID(),
        workspaceId,
        departmentId,
        kind: 'execution.succeeded',
        entityType: 'ExecutionRun',
        entityId: `overflow-run-${index}`,
        summary: { costUsd: 0.01 },
        actorId,
        requestId: randomUUID(),
        occurredAt: new Date(eventPeriodStart.getTime() + index * 1000),
      })),
    });

    const service = new AttentionService(prisma);
    const queue = await runWithPrincipal(requestPrincipal, () => service.list());
    expect(queue.digest.runCount).toBe(251);

    const first = await runWithPrincipal(requestPrincipal, () => service.createDigestSnapshot());
    expect(first.summary).toMatchObject({ eventCount: 250, omittedEventCount: 0 });
    expect(first.summary.eventLines).toHaveLength(250);
    expect(first.summary.windowStartedAt).toBe(eventPeriodStart.toISOString());
    expect(first.summary.windowEndedAt).toBe(
      new Date(eventPeriodStart.getTime() + 249_000).toISOString(),
    );
    await runWithPrincipal(requestPrincipal, () =>
      service.recordDigestDelivery(first.id, {
        attemptKey: `overflow-first-${randomUUID()}`,
        state: 'delivered',
      }),
    );

    const second = await runWithPrincipal(requestPrincipal, () => service.createDigestSnapshot());
    expect(second.summary).toMatchObject({ eventCount: 1, omittedEventCount: 0 });
    expect(second.summary.windowStartedAt).toBe(
      new Date(eventPeriodStart.getTime() + 250_000).toISOString(),
    );
    expect(second.summary.windowEndedAt).toBe(second.summary.windowStartedAt);
    expect(BigInt(second.eventSequenceThrough)).toBeGreaterThan(BigInt(first.eventSequenceThrough));
    await runWithPrincipal(requestPrincipal, () =>
      service.recordDigestDelivery(second.id, {
        attemptKey: `overflow-second-${randomUUID()}`,
        state: 'delivered',
      }),
    );

    const cursor = await prisma.attentionCursor.findUniqueOrThrow({
      where: {
        workspaceId_departmentScopeKey_actorId: {
          workspaceId,
          departmentScopeKey: departmentId,
          actorId,
        },
      },
    });
    expect(cursor.lastDeliveredEventSequence.toString()).toBe(second.eventSequenceThrough);
    expect(first.summary.eventCount + second.summary.eventCount).toBe(251);
    await expect(
      runWithPrincipal(requestPrincipal, () => service.createDigestSnapshot()),
    ).rejects.toMatchObject({ code: 'DIGEST_WINDOW_EMPTY', status: 409 });
  });

  it('waits for an in-flight event append before taking a sequence snapshot', async () => {
    const workspaceId = randomUUID();
    const departmentId = randomUUID();
    const actorId = `human:digest-race-${randomUUID()}`;
    const requestPrincipal: RequestPrincipal = {
      actorId,
      workspaceId,
      departmentId,
      authentication: 'local',
      requestId: randomUUID(),
    };
    await prisma.workspace.create({
      data: {
        id: workspaceId,
        slug: `digest-race-${workspaceId}`,
        name: 'Digest Race Workspace',
      },
    });
    await prisma.department.create({
      data: {
        id: departmentId,
        workspaceId,
        slug: `digest-race-${departmentId}`,
        name: 'Digest Race Department',
      },
    });

    let releaseAppend!: () => void;
    const holdAppend = new Promise<void>((resolve) => {
      releaseAppend = resolve;
    });
    let eventInserted!: () => void;
    const inserted = new Promise<void>((resolve) => {
      eventInserted = resolve;
    });
    const append = runWithPrincipal(requestPrincipal, () =>
      prisma.$transaction(async (transaction) => {
        await appendPlatformEvent(transaction, {
          kind: 'observation.created',
          entityType: 'Observation',
          entityId: randomUUID(),
          summary: { signalType: 'digest-race' },
        });
        eventInserted();
        await holdAppend;
      }),
    );
    await inserted;

    const snapshotPromise = runWithPrincipal(requestPrincipal, () =>
      new AttentionService(prisma).createDigestSnapshot(),
    );
    const stateBeforeCommit = await Promise.race([
      snapshotPromise.then(() => 'settled'),
      new Promise<'waiting'>((resolve) => setTimeout(() => resolve('waiting'), 100)),
    ]);
    expect(stateBeforeCommit).toBe('waiting');

    releaseAppend();
    await append;
    const snapshot = await snapshotPromise;
    expect(snapshot.summary).toMatchObject({ eventCount: 1, observationCount: 1 });
    expect(snapshot.summary.eventLines).toEqual(['A digest-race observation was recorded.']);
  });

  it('claims one active briefing run per snapshot and permits retry after terminal failure', async () => {
    const actorId = `human:digest-claim-${randomUUID()}`;
    const requestPrincipal = principal(actorId);
    const service = new AttentionService(prisma);
    await runWithPrincipal(requestPrincipal, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'observation.created',
          entityType: 'Observation',
          entityId: randomUUID(),
          summary: {},
        }),
      ),
    );
    const snapshot = await runWithPrincipal(requestPrincipal, () => service.createDigestSnapshot());
    const release = await createRelease(actorId);

    const claims = await Promise.allSettled([
      createRun(release, actorId, ExecutionRunState.QUEUED, snapshot.id),
      createRun(release, actorId, ExecutionRunState.QUEUED, snapshot.id),
    ]);
    const fulfilled = claims.filter(
      (claim): claim is PromiseFulfilledResult<Awaited<ReturnType<typeof createRun>>> =>
        claim.status === 'fulfilled',
    );
    const rejected = claims.filter((claim) => claim.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const claimedRun = fulfilled[0]?.value;
    expect(claimedRun).toBeDefined();
    if (claimedRun === undefined) throw new Error('Expected one active digest run claim');
    await prisma.executionRun.update({
      where: { id: claimedRun.id },
      data: { state: ExecutionRunState.FAILED, finishedAt: new Date() },
    });
    const retry = await createRun(release, actorId, ExecutionRunState.QUEUED, snapshot.id);
    expect(retry.digestSnapshotId).toBe(snapshot.id);

    await prisma.executionRun.update({
      where: { id: retry.id },
      data: { state: ExecutionRunState.SUCCEEDED, finishedAt: new Date() },
    });
    await runWithPrincipal(requestPrincipal, () =>
      service.recordDigestDelivery(snapshot.id, {
        attemptKey: `delivered-claim-${randomUUID()}`,
        state: 'delivered',
        briefingRunId: retry.id,
      }),
    );
    await expect(
      createRun(release, actorId, ExecutionRunState.QUEUED, snapshot.id),
    ).rejects.toThrow(/already delivered/i);
  });

  it('isolates digest cursors and pending snapshots by department for the same actor', async () => {
    const actorId = `human:multi-department-${randomUUID()}`;
    const departmentA = randomUUID();
    const departmentB = randomUUID();
    await prisma.department.createMany({
      data: [
        {
          id: departmentA,
          workspaceId: LOCAL_WORKSPACE_ID,
          slug: `digest-a-${departmentA}`,
          name: 'Digest Department A',
        },
        {
          id: departmentB,
          workspaceId: LOCAL_WORKSPACE_ID,
          slug: `digest-b-${departmentB}`,
          name: 'Digest Department B',
        },
      ],
    });
    const principalA = principal(actorId, departmentA);
    const principalB = principal(actorId, departmentB);
    const service = new AttentionService(prisma);

    await runWithPrincipal(principalA, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'observation.created',
          entityType: 'Observation',
          entityId: randomUUID(),
          summary: {},
        }),
      ),
    );
    await runWithPrincipal(principalB, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'release.promoted',
          entityType: 'ReleaseBundle',
          entityId: randomUUID(),
          summary: {},
        }),
      ),
    );
    await runWithPrincipal(principalA, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'execution.succeeded',
          entityType: 'ExecutionRun',
          entityId: randomUUID(),
          summary: { costUsd: 0.1 },
        }),
      ),
    );

    const snapshotA = await runWithPrincipal(principalA, () => service.createDigestSnapshot());
    const snapshotB = await runWithPrincipal(principalB, () => service.createDigestSnapshot());
    expect(snapshotA.id).not.toBe(snapshotB.id);
    expect(snapshotA.summary).toMatchObject({
      observationCount: 1,
      runCount: 1,
      promotionCount: 0,
    });
    expect(snapshotB.summary).toMatchObject({
      observationCount: 0,
      runCount: 0,
      promotionCount: 1,
    });

    await runWithPrincipal(principalA, () =>
      service.recordDigestDelivery(snapshotA.id, {
        attemptKey: `failed-department-a-${randomUUID()}`,
        state: 'failed',
      }),
    );
    await runWithPrincipal(principalA, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'observation.created',
          entityType: 'Observation',
          entityId: randomUUID(),
          summary: {},
        }),
      ),
    );
    const reusedA = await runWithPrincipal(principalA, () => service.createDigestSnapshot());
    expect(reusedA.id).toBe(snapshotA.id);

    await runWithPrincipal(principalA, () =>
      service.recordDigestDelivery(snapshotA.id, {
        attemptKey: `delivered-department-a-${randomUUID()}`,
        state: 'delivered',
      }),
    );
    const [cursorA, cursorB] = await Promise.all([
      prisma.attentionCursor.findUniqueOrThrow({
        where: {
          workspaceId_departmentScopeKey_actorId: {
            workspaceId: LOCAL_WORKSPACE_ID,
            departmentScopeKey: departmentA,
            actorId,
          },
        },
      }),
      prisma.attentionCursor.findUniqueOrThrow({
        where: {
          workspaceId_departmentScopeKey_actorId: {
            workspaceId: LOCAL_WORKSPACE_ID,
            departmentScopeKey: departmentB,
            actorId,
          },
        },
      }),
    ]);
    expect(cursorA.lastDeliveredEventSequence.toString()).toBe(snapshotA.eventSequenceThrough);
    expect(cursorB.lastDeliveredEventSequence).toBe(0n);
    expect(cursorB.lastDeliveredAt).toBeNull();
  });
});
