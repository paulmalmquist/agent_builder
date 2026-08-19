import { randomUUID } from 'node:crypto';
import {
  jsonObjectSchema,
  platformEvaluationSuiteSpecSchema,
  resourceManifestSchema,
  skillSpecSchema,
  type ResourceManifest,
} from '@agent-builder/contracts';
import { canonicalJson, sha256 } from '@paul-os/runtime';
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
  type Prisma,
} from '@prisma/client';
import { runWithPrincipal, type RequestPrincipal } from '../src/request-context.js';
import {
  appendExecutionRunEvent,
  appendPlatformEvent,
  AttentionService,
} from '../src/services/attention-service.js';
import { ReleaseGovernanceService } from '../src/services/release-governance-service.js';
import { ExecutionService } from '../src/services/execution-service.js';
import { AutomationLearningService } from '../src/services/automation-learning-service.js';
import { RegistryService } from '../src/services/registry-service.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';

const runDatabaseIntegration =
  process.env['RUN_DATABASE_INTEGRATION'] === 'true' && process.env['DATABASE_URL'];
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;

function principal(
  actorId: string,
  departmentId: string | null = LOCAL_DEPARTMENT_ID,
): RequestPrincipal {
  return {
    principalId: randomUUID(),
    actorId,
    workspaceId: LOCAL_WORKSPACE_ID,
    departmentId,
    authentication: 'local',
    roles: ['admin'],
    requestId: randomUUID(),
  };
}

function digest(seed: string): string {
  return Buffer.from(seed).toString('hex').slice(0, 64).padEnd(64, '0');
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((next) => {
    resolve = () => next();
  });
  return { promise, resolve };
}

async function waitingAdvisoryLocks(prisma: PrismaClient): Promise<number> {
  const [row] = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count
    FROM pg_locks
    WHERE locktype = 'advisory' AND NOT granted
  `;
  return Number(row?.count ?? 0n);
}

async function waitForAdvisoryWaiters(
  prisma: PrismaClient,
  minimum: number,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await waitingAdvisoryLocks(prisma)) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${minimum} advisory-lock waiters`);
}

function canonicalManifest(manifest: ResourceManifest): {
  definition: ResourceManifest;
  digest: string;
} {
  const definition = resourceManifestSchema.parse(manifest);
  return { definition, digest: sha256(canonicalJson(definition)) };
}

describeDatabase('Quiet Console Attention ledger', () => {
  jest.setTimeout(15_000);
  const prisma = new PrismaClient();

  async function expectNoLeakedAttentionApprovals() {
    expect(
      await prisma.approvalRequest.count({
        where: {
          state: ApprovalRequestState.PENDING,
          requestedBy: { startsWith: 'human:governance-spec-' },
        },
      }),
    ).toBe(0);
  }

  afterEach(expectNoLeakedAttentionApprovals);

  afterAll(async () => {
    await expectNoLeakedAttentionApprovals();
    await prisma.$disconnect();
  });

  async function createRelease(
    actorId: string,
    departmentId: string | null = LOCAL_DEPARTMENT_ID,
    workspaceId = LOCAL_WORKSPACE_ID,
  ) {
    const releaseId = randomUUID();
    const familyId = randomUUID();
    const entryResourceVersionId = randomUUID();
    const projectId = `attention-${randomUUID()}`;
    const slug = `attention-entry-${familyId}`;
    const skillSpec = skillSpecSchema.parse({
      inputSchema: { type: 'object', additionalProperties: false },
      outputSchema: { type: 'object', additionalProperties: false },
      tools: [],
      permissions: [],
      contextRequirements: [],
      successCriteria: ['Return a schema-valid synthetic Attention fixture result.'],
    });
    const manifest = canonicalManifest({
      apiVersion: 'paul-os/v1',
      kind: 'Skill',
      metadata: {
        id: familyId,
        slug,
        version: '1.0.0',
        name: 'Attention fixture entrypoint',
        owner: actorId,
        purpose: 'Provide an exact entrypoint for Attention integration runs.',
        lifecycle: 'candidate',
        provenance: { source: 'attention-service.integration.test' },
      },
      dependencies: [],
      spec: skillSpec,
    });
    const release = await prisma.$transaction(async (transaction) => {
      await transaction.resourceFamily.create({
        data: {
          id: familyId,
          workspaceId,
          departmentId,
          kind: ResourceKind.SKILL,
          slug,
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
          definition: manifest.definition,
          digest: manifest.digest,
          sourceCommit: 'a'.repeat(40),
          provenance: manifest.definition.metadata.provenance,
          dependencyPins: [],
          frozenAt: new Date(),
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      return transaction.releaseBundle.create({
        data: {
          id: releaseId,
          workspaceId,
          departmentId,
          digest: digest(releaseId),
          projectId,
          createdBy: actorId,
          resources: {
            create: {
              resourceVersionId: entryResourceVersionId,
              kind: ResourceKind.SKILL,
              digest: manifest.digest,
              ordinal: 1,
            },
          },
        },
      });
    });
    return { ...release, entryResourceVersionId, entrySlug: slug };
  }

  async function createRun(
    release: {
      id: string;
      digest: string;
      projectId: string | null;
      entryResourceVersionId: string;
      workspaceId: string;
    },
    actorId: string,
    state: ExecutionRunState,
    digestSnapshotId: string | null = null,
    departmentId: string | null = LOCAL_DEPARTMENT_ID,
    overrides: {
      contextDigest?: string;
      input?: Record<string, string>;
      requiredToolScopes?: string[];
      requiresPluginApproval?: boolean;
      entryResourceVersionId?: string | null;
      transaction?: Prisma.TransactionClient;
    } = {},
  ) {
    const runId = randomUUID();
    return (overrides.transaction ?? prisma).executionRun.create({
      data: {
        id: runId,
        workspaceId: release.workspaceId,
        departmentId,
        digestSnapshotId,
        releaseId: release.id,
        entryResourceVersionId:
          overrides.entryResourceVersionId === undefined
            ? release.entryResourceVersionId
            : overrides.entryResourceVersionId,
        legacyEntrypointUnresolved: overrides.entryResourceVersionId === null,
        releaseDigest: release.digest,
        contextDigest: overrides.contextDigest ?? digest(`context-${runId}`),
        contextProvenance: [],
        contextClassification: ContextClassification.PUBLIC,
        contextEstimatedTokens: 10,
        projectId: release.projectId,
        requiredToolScopes: overrides.requiredToolScopes ?? ['calendar.read'],
        requiresPluginApproval: overrides.requiresPluginApproval ?? false,
        state,
        input: overrides.input ?? {},
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

  async function createDigestObservation(
    actorId: string,
    departmentId: string | null = LOCAL_DEPARTMENT_ID,
    workspaceId = LOCAL_WORKSPACE_ID,
    observedAt = new Date(),
  ) {
    const id = randomUUID();
    return prisma.observation.create({
      data: {
        id,
        workspaceId,
        departmentId,
        signalKey: `attention-digest-${id}`,
        signalType: 'digest_governance',
        summary: 'A governed Attention digest signal was recorded.',
        evidence: {},
        provenance: { source: 'attention-service.integration.test' },
        sourceRunId: null,
        sourceOutcomeId: null,
        observedBy: actorId,
        observedAt,
      },
    });
  }

  async function createPassingEvaluation(releaseId: string, actorId: string) {
    const entrypoint = await prisma.releaseResource.findFirstOrThrow({
      where: { releaseId, kind: ResourceKind.SKILL },
      include: { resourceVersion: { include: { family: true } } },
    });
    const familyId = randomUUID();
    const suiteVersionId = randomUUID();
    const slug = `attention-suite-${familyId}`;
    const dependency = {
      familyId: entrypoint.resourceVersion.familyId,
      version: entrypoint.resourceVersion.version,
    };
    const suiteSpec = platformEvaluationSuiteSpecSchema.parse({
      subject: `${entrypoint.resourceVersion.family.slug}@${entrypoint.resourceVersion.version}`,
      executorKind: 'deterministic_contract',
      evaluationMode: 'contract_validation',
      corpusVersion: 7,
      cases: [
        {
          key: 'attention-contract-shape',
          fixture: 'synthetic',
          assertions: ['output_schema_valid', 'no_attempted_actions'],
        },
      ],
      gates: { schemaConformance: 1, citationCoverage: 1, unauthorizedActions: 0 },
    });
    const manifest = canonicalManifest({
      apiVersion: 'paul-os/v1',
      kind: 'EvaluationSuite',
      metadata: {
        id: familyId,
        slug,
        version: '1.0.0',
        name: 'Attention fixture suite',
        owner: actorId,
        purpose: 'Provide immutable passing evidence for the Attention integration test.',
        lifecycle: 'candidate',
        provenance: { source: 'attention-service.integration.test' },
      },
      dependencies: [dependency],
      spec: jsonObjectSchema.parse(suiteSpec),
    });
    await prisma.resourceFamily.create({
      data: {
        id: familyId,
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        kind: ResourceKind.EVALUATION_SUITE,
        slug,
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
        definition: manifest.definition,
        digest: manifest.digest,
        sourceCommit: 'a'.repeat(40),
        provenance: manifest.definition.metadata.provenance,
        dependencyPins: manifest.definition.dependencies,
        frozenAt: new Date(),
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    await prisma.resourceDependencyPin.create({
      data: {
        sourceVersionId: suiteVersionId,
        targetVersionId: entrypoint.resourceVersionId,
        targetDigest: entrypoint.digest,
      },
    });
    await prisma.releaseResource.create({
      data: {
        releaseId,
        resourceVersionId: suiteVersionId,
        kind: ResourceKind.EVALUATION_SUITE,
        digest: manifest.digest,
        ordinal: 0,
      },
    });
    const evaluation = await prisma.releaseEvaluation.create({
      data: {
        releaseId,
        releaseDigest: (await prisma.releaseBundle.findUniqueOrThrow({ where: { id: releaseId } }))
          .digest,
        suiteVersionId,
        suiteDigest: manifest.digest,
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
    const actorId = `human:governance-spec-${randomUUID()}`;
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
        proposedTarget: `Skill:${release.entrySlug}@1.0.0`,
        proposedChange: 'Add a bounded synthetic fixture to the daily brief.',
        state: ImprovementCandidateState.PROPOSED,
        createdBy: actorId,
      },
    });
    const evaluation = await createPassingEvaluation(release.id, actorId);
    const registry = await runWithPrincipal(requestPrincipal, () =>
      new RegistryService(prisma, 'a'.repeat(40)).listResources({ limit: 100 }),
    );
    expect(registry.items.map(({ id }) => id)).toEqual(
      expect.arrayContaining([release.entryResourceVersionId, evaluation.suiteVersionId]),
    );
    for (const resource of registry.items.filter(({ id }) =>
      [release.entryResourceVersionId, evaluation.suiteVersionId].includes(id),
    )) {
      expect(() => resourceManifestSchema.parse(resource.definition)).not.toThrow();
    }
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
    await prisma.runStep.create({
      data: {
        runId: awaiting.id,
        stepKey: 'authority',
        idempotencyKey: `attention-duplicate-phase-${awaiting.id}`,
        state: 'waiting',
      },
    });

    const service = new AttentionService(prisma);
    const queue = await runWithPrincipal(requestPrincipal, () => service.list());
    const executionApproval = queue.decide.find(
      ({ kind, payload }) => kind === 'execution_approval' && payload.runId === awaiting.id,
    );
    expect(executionApproval).toBeDefined();
    expect(queue.decide.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        executionApproval?.id,
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
      service.getItem(executionApproval?.id ?? 'missing-execution-approval'),
    );
    expect(detail.item.payload.metadata['approvalRequestIds']).toContain(approval.id);
    expect(detail.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'authority', state: 'waiting' }),
        expect.objectContaining({ phase: 'context-assembly', state: 'succeeded' }),
      ]),
    );
    expect(detail.timeline.filter(({ phase }) => phase === 'authority')).toHaveLength(1);
    expect(detail.timeline.map(({ occurredAt }) => occurredAt)).toEqual(
      [...detail.timeline.map(({ occurredAt }) => occurredAt)].sort(),
    );
    expect(detail.details).toMatchObject({ runId: awaiting.id, requiredScopes: ['calendar.read'] });

    const channelCountBefore = await prisma.productionChannel.count({
      where: { workspaceId: requestPrincipal.workspaceId, key: release.projectId as string },
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
      await prisma.productionChannel.count({
        where: { workspaceId: requestPrincipal.workspaceId, key: release.projectId as string },
      }),
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
    expect(after.decide.map(({ id }) => id)).not.toContain(executionApproval?.id);
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

  it('collapses exact pending authority, decides the reviewed group atomically, and keeps Plugin approval per-run', async () => {
    const actorId = `human:governance-spec-group-${randomUUID()}`;
    const requestPrincipal = principal(actorId);
    const release = await createRelease(actorId);
    const sharedContextDigest = digest(`attention-group-context-${randomUUID()}`);
    const runOptions = {
      contextDigest: sharedContextDigest,
      input: { date: '2026-08-17' },
      requiredToolScopes: ['calendar.read'],
    };
    const first = await createRun(
      release,
      actorId,
      ExecutionRunState.AWAITING_APPROVAL,
      null,
      LOCAL_DEPARTMENT_ID,
      runOptions,
    );
    const second = await createRun(
      release,
      actorId,
      ExecutionRunState.AWAITING_APPROVAL,
      null,
      LOCAL_DEPARTMENT_ID,
      runOptions,
    );
    const cancelledOrphan = await createRun(
      release,
      actorId,
      ExecutionRunState.CANCELLED,
      null,
      LOCAL_DEPARTMENT_ID,
      runOptions,
    );
    await prisma.approvalRequest.createMany({
      data: [first, second, cancelledOrphan].map(({ id }) => ({
        runId: id,
        reasons: ['No matching authority grant'],
        requestedBy: actorId,
      })),
    });

    const attention = new AttentionService(prisma);
    const queue = await runWithPrincipal(requestPrincipal, () => attention.list());
    const groupItem = queue.decide.find(
      ({ kind, payload }) =>
        kind === 'execution_approval' &&
        Array.isArray(payload.metadata['runIds']) &&
        (payload.metadata['runIds'] as string[]).includes(first.id),
    );
    expect(groupItem).toMatchObject({
      headline: 'Attention fixture entrypoint wants authority for 2 runs.',
      provenance: { actorId: null, sourceType: 'ApprovalRequestGroup' },
      payload: {
        requestCount: 2,
        scopes: ['Calendar · Read'],
        subject: { name: 'Attention fixture entrypoint', kind: 'skill', version: '1.0.0' },
      },
    });
    expect(groupItem?.payload.approvalGroupKey).toMatch(/^[a-f0-9]{64}$/);
    expect(
      queue.decide.some(
        ({ payload }) =>
          payload.runId === cancelledOrphan.id ||
          (Array.isArray(payload.metadata['runIds']) &&
            (payload.metadata['runIds'] as string[]).includes(cancelledOrphan.id)),
      ),
    ).toBe(false);
    const cardFace = JSON.stringify({
      headline: groupItem?.headline,
      delta: groupItem?.delta,
      reason: groupItem?.reason,
      scopes: groupItem?.payload.scopes,
      reviewFacts: groupItem?.payload.reviewFacts,
    });
    expect(cardFace).not.toContain(actorId);
    expect(cardFace).not.toContain(first.id);
    expect(cardFace).not.toContain(second.id);
    expect(cardFace).not.toContain(release.digest);

    const execution = new ExecutionService(prisma, { environment: 'test' } as never, {} as never);
    const groupKey = groupItem?.payload.approvalGroupKey;
    if (groupKey === null || groupKey === undefined) throw new Error('Expected an approval group');
    const validUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const approvalInput = {
      entryResourceVersionId: release.entryResourceVersionId,
      projectId: release.projectId,
      inputConstraints: { date: '2026-08-17' },
      toolScopes: ['calendar.read'],
      pluginScopes: [],
      validUntil,
      maxRuns: 2,
      maxEstimatedCostPerRunUsd: 0.25,
      totalCostBudgetUsd: 0.5,
      rationale: 'Allow these two exact synthetic Attention runs within the reviewed limits.',
    };
    const grantsBefore = await prisma.authorityGrant.count({ where: { releaseId: release.id } });
    await expect(
      runWithPrincipal(requestPrincipal, () =>
        execution.approveRunGroup(groupKey, { ...approvalInput, maxRuns: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORITY_ENVELOPE_INSUFFICIENT', status: 422 });
    expect(await prisma.authorityGrant.count({ where: { releaseId: release.id } })).toBe(
      grantsBefore,
    );
    expect(
      await prisma.executionRun.count({
        where: { id: { in: [first.id, second.id] }, state: ExecutionRunState.AWAITING_APPROVAL },
      }),
    ).toBe(2);

    const decisions = await Promise.all([
      runWithPrincipal(requestPrincipal, () => execution.approveRunGroup(groupKey, approvalInput)),
      runWithPrincipal(requestPrincipal, () => execution.approveRunGroup(groupKey, approvalInput)),
    ]);
    expect(decisions[0]?.grant.id).toBe(decisions[1]?.grant.id);
    expect(decisions[0]?.runs).toHaveLength(2);
    expect(new Set(decisions[0]?.runs.map(({ authorityGrantId }) => authorityGrantId))).toEqual(
      new Set([decisions[0]?.grant.id]),
    );
    expect(await prisma.authorityGrant.count({ where: { releaseId: release.id } })).toBe(
      grantsBefore + 1,
    );
    expect(
      await prisma.approvalRequest.findMany({
        where: { runId: { in: [first.id, second.id] } },
        select: { state: true, decisionGroupKey: true, decisionGroupSize: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        {
          state: ApprovalRequestState.APPROVED,
          decisionGroupKey: groupKey,
          decisionGroupSize: 2,
        },
        {
          state: ApprovalRequestState.APPROVED,
          decisionGroupKey: groupKey,
          decisionGroupSize: 2,
        },
      ]),
    );
    await prisma.$transaction(async (transaction) => {
      await transaction.executionRun.update({
        where: { id: first.id },
        data: {
          state: ExecutionRunState.AWAITING_APPROVAL,
          authorityGrantId: null,
          approvalReasons: ['Authority changed after the grouped decision'],
          message: 'Awaiting renewed authority',
        },
      });
      await transaction.approvalRequest.update({
        where: { runId: first.id },
        data: {
          state: ApprovalRequestState.PENDING,
          requestVersion: { increment: 1 },
          decisionGroupKey: null,
          decisionGroupSize: null,
          reasons: ['Authority changed after the grouped decision'],
          decidedBy: null,
          rationale: null,
          decidedAt: null,
        },
      });
    });
    await expect(
      runWithPrincipal(requestPrincipal, () => execution.approveRunGroup(groupKey, approvalInput)),
    ).rejects.toMatchObject({ code: 'ATTENTION_GROUP_MEMBERSHIP_CHANGED', status: 409 });
    expect(
      await prisma.executionRun.findMany({
        where: { id: { in: [first.id, second.id] } },
        select: { id: true, state: true, authorityGrantId: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(
      [
        { id: first.id, state: ExecutionRunState.AWAITING_APPROVAL, authorityGrantId: null },
        {
          id: second.id,
          state: ExecutionRunState.QUEUED,
          authorityGrantId: decisions[0]?.grant.id,
        },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const rejectContextDigest = digest(`attention-reject-context-${randomUUID()}`);
    const rejectOptions = {
      contextDigest: rejectContextDigest,
      input: { date: '2026-08-19' },
      requiredToolScopes: [],
    };
    const rejectFirst = await createRun(
      release,
      actorId,
      ExecutionRunState.AWAITING_APPROVAL,
      null,
      LOCAL_DEPARTMENT_ID,
      rejectOptions,
    );
    const rejectSecond = await createRun(
      release,
      actorId,
      ExecutionRunState.AWAITING_APPROVAL,
      null,
      LOCAL_DEPARTMENT_ID,
      rejectOptions,
    );
    await prisma.approvalRequest.createMany({
      data: [rejectFirst, rejectSecond].map(({ id }) => ({
        runId: id,
        reasons: ['No matching authority grant'],
        requestedBy: actorId,
      })),
    });
    const rejectQueue = await runWithPrincipal(requestPrincipal, () => attention.list());
    const rejectItem = rejectQueue.decide.find(
      ({ kind, payload }) =>
        kind === 'execution_approval' &&
        Array.isArray(payload.metadata['runIds']) &&
        (payload.metadata['runIds'] as string[]).includes(rejectFirst.id),
    );
    const rejectGroupKey = rejectItem?.payload.approvalGroupKey;
    if (rejectGroupKey === null || rejectGroupKey === undefined) {
      throw new Error('Expected a grouped rejection fixture');
    }
    const groupedRejectionInput = {
      rationale: 'Reject both matching synthetic runs after reviewing their exact shared limits.',
    };
    const groupedRejection = await runWithPrincipal(requestPrincipal, () =>
      execution.rejectRunGroup(rejectGroupKey, groupedRejectionInput),
    );
    expect(groupedRejection.runs).toHaveLength(2);
    await prisma.$transaction(async (transaction) => {
      await transaction.executionRun.update({
        where: { id: rejectFirst.id },
        data: {
          state: ExecutionRunState.AWAITING_APPROVAL,
          finishedAt: null,
          approvalReasons: ['Authority request reopened after rejection'],
          message: 'Awaiting renewed authority',
        },
      });
      await transaction.approvalRequest.update({
        where: { runId: rejectFirst.id },
        data: {
          state: ApprovalRequestState.PENDING,
          requestVersion: { increment: 1 },
          decisionGroupKey: null,
          decisionGroupSize: null,
          reasons: ['Authority request reopened after rejection'],
          decidedBy: null,
          rationale: null,
          decidedAt: null,
        },
      });
    });
    await expect(
      runWithPrincipal(requestPrincipal, () =>
        execution.rejectRunGroup(rejectGroupKey, groupedRejectionInput),
      ),
    ).rejects.toMatchObject({ code: 'ATTENTION_GROUP_MEMBERSHIP_CHANGED', status: 409 });
    expect(
      await prisma.executionRun.findMany({
        where: { id: { in: [rejectFirst.id, rejectSecond.id] } },
        select: { id: true, state: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(
      [
        { id: rejectFirst.id, state: ExecutionRunState.AWAITING_APPROVAL },
        { id: rejectSecond.id, state: ExecutionRunState.CANCELLED },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const pluginContextDigest = digest(`attention-plugin-context-${randomUUID()}`);
    const pluginOptions = {
      contextDigest: pluginContextDigest,
      input: { date: '2026-08-18' },
      requiredToolScopes: [],
      requiresPluginApproval: true,
    };
    const pluginFirst = await createRun(
      release,
      actorId,
      ExecutionRunState.AWAITING_APPROVAL,
      null,
      LOCAL_DEPARTMENT_ID,
      pluginOptions,
    );
    const pluginSecond = await createRun(
      release,
      actorId,
      ExecutionRunState.AWAITING_APPROVAL,
      null,
      LOCAL_DEPARTMENT_ID,
      pluginOptions,
    );
    await prisma.approvalRequest.createMany({
      data: [pluginFirst, pluginSecond].map(({ id }) => ({
        runId: id,
        reasons: ['A required Plugin action needs approval for this exact run'],
        requestedBy: actorId,
      })),
    });
    const pluginQueue = await runWithPrincipal(requestPrincipal, () => attention.list());
    const pluginItems = pluginQueue.decide.filter(
      ({ kind, payload }) =>
        kind === 'execution_approval' &&
        [pluginFirst.id, pluginSecond.id].includes(payload.runId ?? ''),
    );
    expect(pluginItems).toHaveLength(2);
    expect(pluginItems.every(({ payload }) => payload.requestCount === 1)).toBe(true);
    expect(pluginItems.every(({ payload }) => payload.scopes[0] === 'Run and spend limit')).toBe(
      true,
    );

    const rejectedItem = pluginItems.find(({ payload }) => payload.runId === pluginFirst.id);
    const rejectedGroupKey = rejectedItem?.payload.approvalGroupKey;
    if (rejectedGroupKey === null || rejectedGroupKey === undefined) {
      throw new Error('Expected a run-specific Plugin approval group');
    }
    const rejectionInput = {
      rationale: 'Keep this exact Plugin-bearing synthetic run paused and record the rejection.',
    };
    const rejected = await runWithPrincipal(requestPrincipal, () =>
      execution.rejectRunGroup(rejectedGroupKey, rejectionInput),
    );
    const idempotentRejection = await runWithPrincipal(requestPrincipal, () =>
      execution.rejectRunGroup(rejectedGroupKey, rejectionInput),
    );
    expect(rejected).toEqual(idempotentRejection);
    expect(rejected.runs).toHaveLength(1);
    expect(
      await prisma.executionRun.findMany({
        where: { id: { in: [pluginFirst.id, pluginSecond.id] } },
        select: { id: true, state: true },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(
      [
        { id: pluginFirst.id, state: ExecutionRunState.CANCELLED },
        { id: pluginSecond.id, state: ExecutionRunState.AWAITING_APPROVAL },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );

    const unresolved = await prisma.$transaction(async (transaction) => {
      // Legacy unresolved rows are migration-only. Temporarily disabling this one guard inside the
      // disposable transaction reproduces that historical shape without weakening the live table.
      await transaction.$executeRawUnsafe(
        'ALTER TABLE "ExecutionRun" DISABLE TRIGGER "ExecutionRun_release_entrypoint"',
      );
      const created = await createRun(
        release,
        actorId,
        ExecutionRunState.AWAITING_APPROVAL,
        null,
        LOCAL_DEPARTMENT_ID,
        { entryResourceVersionId: null, requiredToolScopes: [], transaction },
      );
      await transaction.$executeRawUnsafe(
        'ALTER TABLE "ExecutionRun" ENABLE TRIGGER "ExecutionRun_release_entrypoint"',
      );
      return created;
    });
    await prisma.approvalRequest.create({
      data: {
        runId: unresolved.id,
        reasons: ['Legacy entrypoint could not be resolved'],
        requestedBy: actorId,
      },
    });
    const unresolvedQueue = await runWithPrincipal(requestPrincipal, () => attention.list());
    expect(
      unresolvedQueue.degraded.find(({ payload }) => payload.runId === unresolved.id),
    ).toMatchObject({
      headline: 'Approval stopped: the governed subject is unavailable.',
      status: 'safety_stop',
      secondaryAction: null,
      payload: { approvalGroupKey: null, subject: null },
    });

    const testRunIds = new Set([
      first.id,
      second.id,
      rejectFirst.id,
      rejectSecond.id,
      pluginFirst.id,
      pluginSecond.id,
    ]);
    const cleanupQueue = await runWithPrincipal(requestPrincipal, () => attention.list());
    const cleanupGroups = cleanupQueue.decide.filter(
      ({ kind, payload }) =>
        kind === 'execution_approval' &&
        Array.isArray(payload.metadata['runIds']) &&
        (payload.metadata['runIds'] as string[]).some((runId) => testRunIds.has(runId)),
    );
    for (const cleanupGroup of cleanupGroups) {
      const cleanupGroupKey = cleanupGroup.payload.approvalGroupKey;
      if (cleanupGroupKey === null) throw new Error('Expected an exact cleanup group');
      await runWithPrincipal(requestPrincipal, () =>
        execution.rejectRunGroup(cleanupGroupKey, {
          rationale: 'Close the remaining synthetic authority request after the regression review.',
        }),
      );
    }
    await runWithPrincipal(requestPrincipal, () =>
      execution.rejectRun(unresolved.id, {
        rationale: 'Close the migration-only unresolved synthetic approval after review.',
      }),
    );
    await prisma.approvalRequest.update({
      where: { runId: cancelledOrphan.id },
      data: {
        state: ApprovalRequestState.CANCELLED,
        decidedBy: actorId,
        rationale:
          'Close the deliberately orphaned pending fixture after its exclusion was proved.',
        decidedAt: new Date(),
      },
    });
    expect(
      await prisma.approvalRequest.count({
        where: {
          runId: {
            in: [...testRunIds, unresolved.id, cancelledOrphan.id],
          },
          state: ApprovalRequestState.PENDING,
        },
      }),
    ).toBe(0);
  });

  it('keeps authority mutations in the exact department and reserves workspace-global decisions for admins', async () => {
    const actorId = `human:governance-spec-scope-${randomUUID()}`;
    const workspaceId = randomUUID();
    const ownerDepartmentId = randomUUID();
    const siblingDepartmentId = randomUUID();
    const departmentOwner: RequestPrincipal = {
      ...principal(actorId, ownerDepartmentId),
      workspaceId,
      roles: ['owner'],
    };
    const workspaceOwner: RequestPrincipal = {
      ...principal(actorId, null),
      workspaceId,
      roles: ['owner'],
    };
    const workspaceAdmin: RequestPrincipal = {
      ...principal(actorId, null),
      workspaceId,
    };
    await prisma.workspace.create({
      data: { id: workspaceId, slug: `attention-scope-${workspaceId}`, name: 'Attention scope' },
    });
    await prisma.department.createMany({
      data: [
        {
          id: ownerDepartmentId,
          workspaceId,
          slug: `attention-owner-${ownerDepartmentId}`,
          name: 'Attention owner department',
        },
        {
          id: siblingDepartmentId,
          workspaceId,
          slug: `attention-sibling-${siblingDepartmentId}`,
          name: 'Attention sibling department',
        },
      ],
    });
    const ownRelease = await createRelease(actorId, ownerDepartmentId, workspaceId);
    const globalRelease = await createRelease(actorId, null, workspaceId);
    const siblingRelease = await createRelease(actorId, siblingDepartmentId, workspaceId);
    const own = await createRun(
      ownRelease,
      actorId,
      ExecutionRunState.AWAITING_APPROVAL,
      null,
      ownerDepartmentId,
    );
    const global = await createRun(
      globalRelease,
      actorId,
      ExecutionRunState.AWAITING_APPROVAL,
      null,
      null,
    );
    const sibling = await createRun(
      siblingRelease,
      actorId,
      ExecutionRunState.AWAITING_APPROVAL,
      null,
      siblingDepartmentId,
    );
    await prisma.approvalRequest.createMany({
      data: [own, global, sibling].map(({ id }) => ({
        runId: id,
        reasons: ['No matching authority grant'],
        requestedBy: actorId,
      })),
    });

    const attention = new AttentionService(prisma);
    const execution = new ExecutionService(prisma, { environment: 'test' } as never, {} as never);
    const departmentQueue = await runWithPrincipal(departmentOwner, () => attention.list());
    expect(departmentQueue.decide.find(({ payload }) => payload.runId === own.id)).toMatchObject({
      kind: 'execution_approval',
      shelf: 'decide',
    });
    expect(departmentQueue.decide.some(({ payload }) => payload.runId === global.id)).toBe(false);
    expect(
      departmentQueue.degraded.find(({ payload }) => payload.runId === global.id),
    ).toMatchObject({
      kind: 'safety_stop',
      shelf: 'degraded',
      status: 'safety_stop',
      headline: 'Attention fixture entrypoint needs workspace-admin review.',
      primaryAction: { kind: 'open_details' },
      secondaryAction: null,
      payload: {
        approvalGroupKey: null,
        requestCount: 1,
        metadata: { adminRequired: true },
      },
    });
    const workspaceOwnerQueue = await runWithPrincipal(workspaceOwner, () => attention.list());
    expect(workspaceOwnerQueue.decide.some(({ payload }) => payload.runId === global.id)).toBe(
      false,
    );
    expect(
      workspaceOwnerQueue.degraded.find(({ payload }) => payload.runId === global.id),
    ).toMatchObject({ kind: 'safety_stop', primaryAction: { kind: 'open_details' } });
    const globalQueue = await runWithPrincipal(workspaceAdmin, () => attention.list());
    const globalGroupKey = globalQueue.decide.find(
      ({ kind, payload }) => kind === 'execution_approval' && payload.runId === global.id,
    )?.payload.approvalGroupKey;
    if (globalGroupKey === null || globalGroupKey === undefined) {
      throw new Error('Expected a workspace-global approval group');
    }
    const rejection = {
      rationale:
        'Reject this exact scoped synthetic request after reviewing its authority boundary.',
    };

    await expect(
      runWithPrincipal(departmentOwner, () => execution.rejectRun(global.id, rejection)),
    ).rejects.toMatchObject({ code: 'EXECUTION_RUN_NOT_FOUND', status: 404 });
    await expect(
      runWithPrincipal(departmentOwner, () => execution.rejectRun(sibling.id, rejection)),
    ).rejects.toMatchObject({ code: 'EXECUTION_RUN_NOT_FOUND', status: 404 });
    await expect(
      runWithPrincipal(departmentOwner, () => execution.rejectRunGroup(globalGroupKey, rejection)),
    ).rejects.toMatchObject({ code: 'ATTENTION_GROUP_NOT_FOUND', status: 404 });
    await expect(
      runWithPrincipal(workspaceOwner, () => execution.rejectRun(global.id, rejection)),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED', status: 403 });

    await expect(
      runWithPrincipal(departmentOwner, () => execution.rejectRun(own.id, rejection)),
    ).resolves.toMatchObject({ state: 'cancelled' });
    await expect(
      runWithPrincipal(workspaceAdmin, () => execution.rejectRunGroup(globalGroupKey, rejection)),
    ).resolves.toMatchObject({ runs: [{ id: global.id, state: 'cancelled' }] });
    await expect(
      runWithPrincipal(
        {
          ...principal(actorId, siblingDepartmentId),
          workspaceId,
          roles: ['owner'],
        },
        () => execution.rejectRun(sibling.id, rejection),
      ),
    ).resolves.toMatchObject({ state: 'cancelled' });
  });

  it('serializes grouped rejection against individual rejection and cancellation without rewriting group evidence', async () => {
    const actorId = `human:governance-spec-race-${randomUUID()}`;
    const requestPrincipal = principal(actorId);
    const release = await createRelease(actorId);
    const attention = new AttentionService(prisma);
    const execution = new ExecutionService(prisma, { environment: 'test' } as never, {} as never);

    const runInterleaving = async (individualAction: 'reject' | 'cancel') => {
      const contextDigest = digest(`attention-race-${individualAction}-${randomUUID()}`);
      const options = {
        contextDigest,
        input: { action: individualAction },
        requiredToolScopes: ['calendar.read'],
      };
      const pair = await Promise.all([
        createRun(
          release,
          actorId,
          ExecutionRunState.AWAITING_APPROVAL,
          null,
          LOCAL_DEPARTMENT_ID,
          options,
        ),
        createRun(
          release,
          actorId,
          ExecutionRunState.AWAITING_APPROVAL,
          null,
          LOCAL_DEPARTMENT_ID,
          options,
        ),
      ]);
      await prisma.approvalRequest.createMany({
        data: pair.map(({ id }) => ({
          runId: id,
          reasons: ['No matching authority grant'],
          requestedBy: actorId,
        })),
      });
      const queue = await runWithPrincipal(requestPrincipal, () => attention.list());
      const groupKey = queue.decide.find(
        ({ kind, payload }) =>
          kind === 'execution_approval' &&
          Array.isArray(payload.metadata['runIds']) &&
          (payload.metadata['runIds'] as string[]).includes(pair[0]?.id ?? ''),
      )?.payload.approvalGroupKey;
      if (groupKey === null || groupKey === undefined) throw new Error('Expected a race group');
      const targetRunId = pair.map(({ id }) => id).sort()[0];
      if (targetRunId === undefined) throw new Error('Expected a target run');
      const rationale = `Reject the exact ${individualAction} interleaving fixture as one reviewed group.`;
      const releaseBlocker = deferred();
      const blockerReady = deferred();
      const decisionLockKey = `${LOCAL_WORKSPACE_ID}:${LOCAL_DEPARTMENT_ID}:execution-decision:${targetRunId}`;
      const blocker = prisma.$transaction(
        async (transaction) => {
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${decisionLockKey}))`;
          blockerReady.resolve();
          await releaseBlocker.promise;
        },
        { timeout: 15_000 },
      );
      await blockerReady.promise;
      const initialWaiters = await waitingAdvisoryLocks(prisma);
      const groupDecision = runWithPrincipal(requestPrincipal, () =>
        execution.rejectRunGroup(groupKey, { rationale }),
      );
      let individualDecision: Promise<unknown> | undefined;
      let waitError: unknown;
      try {
        await waitForAdvisoryWaiters(prisma, initialWaiters + 1);
        individualDecision = runWithPrincipal(requestPrincipal, () =>
          individualAction === 'reject'
            ? execution.rejectRun(targetRunId, {
                rationale: 'Reject only this run while the matching group is also being decided.',
              })
            : execution.cancelRun(targetRunId),
        );
        await waitForAdvisoryWaiters(prisma, initialWaiters + 2);
      } catch (error) {
        waitError = error;
      } finally {
        releaseBlocker.resolve();
      }
      const waitFailure =
        waitError instanceof Error
          ? waitError
          : new Error('Concurrent individual decision setup failed', { cause: waitError });
      const [groupResult, individualResult] = await Promise.allSettled([
        groupDecision,
        individualDecision ?? Promise.reject(waitFailure),
      ]);
      await blocker;
      if (waitError !== undefined) throw waitFailure;

      expect(groupResult).toMatchObject({ status: 'fulfilled', value: { runs: [{}, {}] } });
      expect(individualResult.status).toBe('rejected');
      if (individualResult.status === 'rejected') {
        expect(individualResult.reason).toMatchObject({
          code: individualAction === 'reject' ? 'RUN_NOT_AWAITING_APPROVAL' : 'RUN_TERMINAL',
          status: 409,
        });
      }
      const decisions = await prisma.approvalRequest.findMany({
        where: { runId: { in: pair.map(({ id }) => id) } },
        orderBy: { runId: 'asc' },
      });
      expect(decisions).toHaveLength(2);
      expect(
        decisions.every(
          (decision) =>
            decision.state === ApprovalRequestState.REJECTED &&
            decision.decisionGroupKey === groupKey &&
            decision.decisionGroupSize === 2 &&
            decision.rationale === rationale &&
            decision.decidedBy === actorId,
        ),
      ).toBe(true);
      await expect(
        prisma.approvalRequest.update({
          where: { id: decisions[0]?.id ?? randomUUID() },
          data: { rationale: 'A stale individual decision must not rewrite group evidence.' },
        }),
      ).rejects.toThrow(/immutable/i);
    };

    await runInterleaving('reject');
    await runInterleaving('cancel');
  });

  it('isolates workspace-global terminal acknowledgements by department scope', async () => {
    const actorId = `human:governance-resolution-${randomUUID()}`;
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
    const actorId = `human:governance-digest-${randomUUID()}`;
    const requestPrincipal = principal(actorId);
    const service = new AttentionService(prisma);
    const digestRelease = await createRelease(actorId);
    const digestRun = await createRun(digestRelease, actorId, ExecutionRunState.SUCCEEDED);
    await runWithPrincipal(requestPrincipal, () =>
      prisma.$transaction(async (transaction) => {
        await appendPlatformEvent(transaction, {
          kind: 'execution.succeeded',
          entityType: 'ExecutionRun',
          entityId: digestRun.id,
          summary: { costUsd: 0.21 },
        });
        await appendPlatformEvent(transaction, {
          kind: 'release.promoted',
          entityType: 'ReleaseBundle',
          entityId: digestRelease.id,
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

    const observation = await createDigestObservation(actorId);
    await runWithPrincipal(requestPrincipal, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'observation.created',
          entityType: 'Observation',
          entityId: observation.id,
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
    const actorId = `human:governance-digest-overflow-${randomUUID()}`;
    const requestPrincipal: RequestPrincipal = {
      principalId: randomUUID(),
      actorId,
      workspaceId,
      departmentId,
      authentication: 'local',
      roles: ['admin'],
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
    const overflowObservations = Array.from({ length: 251 }, (_, index) => {
      const id = randomUUID();
      const observedAt = new Date(eventPeriodStart.getTime() + index * 1000);
      return {
        id,
        workspaceId,
        departmentId,
        signalKey: `digest-overflow-${id}`,
        signalType: 'digest_overflow',
        summary: 'A governed digest overflow signal was recorded.',
        evidence: {},
        provenance: { source: 'attention-service.integration.test' },
        sourceRunId: null,
        sourceOutcomeId: null,
        observedBy: actorId,
        observedAt,
      };
    });
    await prisma.observation.createMany({ data: overflowObservations });
    await prisma.platformEvent.createMany({
      data: overflowObservations.map((observation) => ({
        id: randomUUID(),
        workspaceId,
        departmentId,
        kind: 'observation.created',
        entityType: 'Observation',
        entityId: observation.id,
        summary: { signalType: observation.signalType },
        actorId,
        requestId: randomUUID(),
        occurredAt: observation.observedAt,
      })),
    });

    const service = new AttentionService(prisma);
    const queue = await runWithPrincipal(requestPrincipal, () => service.list());
    expect(queue.digest.observationCount).toBe(251);

    const first = await runWithPrincipal(requestPrincipal, () => service.createDigestSnapshot());
    expect(first.summary).toMatchObject({
      eventCount: 250,
      observationCount: 250,
      omittedEventCount: 0,
    });
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
    expect(second.summary).toMatchObject({
      eventCount: 1,
      observationCount: 1,
      omittedEventCount: 0,
    });
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
    expect(first.summary.observationCount + second.summary.observationCount).toBe(251);
    await expect(
      runWithPrincipal(requestPrincipal, () => service.createDigestSnapshot()),
    ).rejects.toMatchObject({ code: 'DIGEST_WINDOW_EMPTY', status: 409 });
  });

  it('waits for an in-flight event append before taking a sequence snapshot', async () => {
    const workspaceId = randomUUID();
    const departmentId = randomUUID();
    const actorId = `human:governance-digest-race-${randomUUID()}`;
    const requestPrincipal: RequestPrincipal = {
      principalId: randomUUID(),
      actorId,
      workspaceId,
      departmentId,
      authentication: 'local',
      roles: ['admin'],
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
    const raceObservation = await createDigestObservation(
      actorId,
      departmentId,
      workspaceId,
      new Date('2026-08-15T11:00:00.000Z'),
    );

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
          entityId: raceObservation.id,
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
    const actorId = `human:governance-digest-claim-${randomUUID()}`;
    const requestPrincipal = principal(actorId);
    const service = new AttentionService(prisma);
    const claimObservation = await createDigestObservation(actorId);
    await runWithPrincipal(requestPrincipal, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'observation.created',
          entityType: 'Observation',
          entityId: claimObservation.id,
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

  it('serializes learning decisions, collapses equivalent memory, and enforces exact mutation scope', async () => {
    const actorId = `human:governance-spec-learning-${randomUUID()}`;
    const requestPrincipal = principal(actorId);
    const release = await createRelease(actorId);
    const succeeded = await createRun(release, actorId, ExecutionRunState.SUCCEEDED);
    const duplicateSource = await createRun(release, actorId, ExecutionRunState.SUCCEEDED);
    const namespace = `attention.learning.${randomUUID()}`;
    const [firstMemory, duplicateMemory] = await Promise.all([
      prisma.memoryCandidate.create({
        data: {
          sourceRunId: duplicateSource.id,
          namespace,
          proposedValue: { ordering: 'risk-first' },
          provenance: { source: 'first-observation' },
          stagedBy: actorId,
        },
      }),
      prisma.memoryCandidate.create({
        data: {
          sourceRunId: succeeded.id,
          namespace,
          proposedValue: { ordering: 'risk-first' },
          provenance: { source: 'second-observation' },
          stagedBy: actorId,
        },
      }),
    ]);
    const observation = await prisma.observation.create({
      data: {
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        sourceRunId: succeeded.id,
        signalKey: `attention-learning-${randomUUID()}`,
        signalType: 'fixture',
        summary: 'A bounded fixture needs one governed improvement decision.',
        observedBy: actorId,
      },
    });
    const improvement = await prisma.improvementCandidate.create({
      data: {
        observationId: observation.id,
        title: 'Review bounded schedule context',
        proposedTarget: `Skill:${release.entrySlug}@1.0.0`,
        proposedChange: 'Add a bounded schedule-context fixture.',
        createdBy: actorId,
      },
    });
    const duplicateObservation = await prisma.observation.create({
      data: {
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        sourceRunId: duplicateSource.id,
        signalKey: `attention-learning-duplicate-${randomUUID()}`,
        signalType: 'fixture',
        summary: 'The same bounded fixture produced equivalent governed evidence.',
        observedBy: actorId,
      },
    });
    const duplicateImprovement = await prisma.improvementCandidate.create({
      data: {
        observationId: duplicateObservation.id,
        title: improvement.title,
        proposedTarget: improvement.proposedTarget,
        proposedChange: improvement.proposedChange,
        evidenceRefs: [`observation:${duplicateObservation.id}`],
        createdBy: actorId,
      },
    });
    await createPassingEvaluation(release.id, actorId);
    const learning = new AutomationLearningService(prisma, {} as ExecutionService);
    const learningQueue = await runWithPrincipal(requestPrincipal, () =>
      new AttentionService(prisma).list(),
    );
    const memoryAttentionItem = learningQueue.decide.find(
      ({ kind, payload }) =>
        kind === 'memory_review' &&
        payload.candidateId !== null &&
        [firstMemory.id, duplicateMemory.id].includes(payload.candidateId),
    );
    const improvementAttentionItem = learningQueue.decide.find(
      ({ kind, payload }) =>
        kind === 'improvement_review' &&
        payload.candidateId !== null &&
        [improvement.id, duplicateImprovement.id].includes(payload.candidateId),
    );
    expect(memoryAttentionItem?.payload).toMatchObject({
      requestCount: 2,
      decisionGroupKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(improvementAttentionItem?.payload).toMatchObject({
      requestCount: 2,
      decisionGroupKey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    if (
      !memoryAttentionItem?.payload.decisionGroupKey ||
      !improvementAttentionItem?.payload.decisionGroupKey
    ) {
      throw new Error('Expected immutable Attention learning-group bindings');
    }
    const acceptMemory = {
      decision: 'accept' as const,
      rationale: 'Accept the reviewed preference for this exact governed scope.',
      decisionGroupKey: memoryAttentionItem.payload.decisionGroupKey,
      expectedRequestCount: memoryAttentionItem.payload.requestCount,
    };
    const rejectMemory = {
      decision: 'reject' as const,
      rationale: 'Reject the reviewed preference for this exact governed scope.',
      decisionGroupKey: memoryAttentionItem.payload.decisionGroupKey,
      expectedRequestCount: memoryAttentionItem.payload.requestCount,
    };
    const memoryResults = await Promise.allSettled([
      runWithPrincipal(requestPrincipal, () =>
        learning.reviewMemoryCandidate(firstMemory.id, acceptMemory),
      ),
      runWithPrincipal(requestPrincipal, () =>
        learning.reviewMemoryCandidate(firstMemory.id, rejectMemory),
      ),
    ]);
    expect(memoryResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(memoryResults.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(memoryResults.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'MEMORY_ALREADY_REVIEWED', status: 409 },
    });
    const reviewedMemory = await prisma.memoryCandidate.findMany({
      where: { id: { in: [firstMemory.id, duplicateMemory.id] } },
      orderBy: { id: 'asc' },
    });
    expect(reviewedMemory).toHaveLength(2);
    expect(new Set(reviewedMemory.map(({ state }) => state)).size).toBe(1);
    expect(new Set(reviewedMemory.map(({ reviewRationale }) => reviewRationale)).size).toBe(1);
    const memoryWinner =
      reviewedMemory[0]?.state === MemoryCandidateState.ACCEPTED ? acceptMemory : rejectMemory;
    const memoryLoser = memoryWinner === acceptMemory ? rejectMemory : acceptMemory;
    await expect(
      runWithPrincipal(requestPrincipal, () =>
        learning.reviewMemoryCandidate(firstMemory.id, memoryWinner),
      ),
    ).resolves.toMatchObject({ id: firstMemory.id });
    await expect(
      runWithPrincipal(requestPrincipal, () =>
        learning.reviewMemoryCandidate(firstMemory.id, memoryLoser),
      ),
    ).rejects.toMatchObject({ code: 'MEMORY_ALREADY_REVIEWED', status: 409 });
    expect(
      await prisma.auditEvent.count({
        where: {
          entityId: { in: [firstMemory.id, duplicateMemory.id] },
          action: { in: ['memory.accepted', 'memory.rejected'] },
        },
      }),
    ).toBe(2);

    const incubate = {
      decision: 'incubate' as const,
      rationale: 'Keep this bounded proposal for a governed experiment.',
      decisionGroupKey: improvementAttentionItem.payload.decisionGroupKey,
      expectedRequestCount: improvementAttentionItem.payload.requestCount,
    };
    const rejectImprovement = {
      decision: 'reject' as const,
      rationale: 'Reject this bounded proposal after governed review.',
      decisionGroupKey: improvementAttentionItem.payload.decisionGroupKey,
      expectedRequestCount: improvementAttentionItem.payload.requestCount,
    };
    const improvementResults = await Promise.allSettled([
      runWithPrincipal(requestPrincipal, () =>
        learning.reviewImprovementCandidate(improvement.id, incubate),
      ),
      runWithPrincipal(requestPrincipal, () =>
        learning.reviewImprovementCandidate(duplicateImprovement.id, rejectImprovement),
      ),
    ]);
    expect(improvementResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(improvementResults.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(improvementResults.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'IMPROVEMENT_ALREADY_REVIEWED', status: 409 },
    });
    const reviewedImprovements = await prisma.improvementCandidate.findMany({
      where: { id: { in: [improvement.id, duplicateImprovement.id] } },
      orderBy: { id: 'asc' },
    });
    expect(reviewedImprovements).toHaveLength(2);
    expect(new Set(reviewedImprovements.map(({ state }) => state)).size).toBe(1);
    expect(new Set(reviewedImprovements.map(({ reviewRationale }) => reviewRationale)).size).toBe(
      1,
    );
    const reviewedImprovement = reviewedImprovements[0];
    if (reviewedImprovement === undefined) throw new Error('Expected grouped improvement review');
    const improvementWinner =
      reviewedImprovement.state === ImprovementCandidateState.INCUBATING
        ? incubate
        : rejectImprovement;
    const improvementLoser = improvementWinner === incubate ? rejectImprovement : incubate;
    await expect(
      runWithPrincipal(requestPrincipal, () =>
        learning.reviewImprovementCandidate(improvement.id, improvementWinner),
      ),
    ).resolves.toMatchObject({ id: improvement.id });
    await expect(
      runWithPrincipal(requestPrincipal, () =>
        learning.reviewImprovementCandidate(duplicateImprovement.id, improvementLoser),
      ),
    ).rejects.toMatchObject({ code: 'IMPROVEMENT_ALREADY_REVIEWED', status: 409 });
    expect(
      await prisma.auditEvent.count({
        where: {
          entityId: { in: [improvement.id, duplicateImprovement.id] },
          action: { in: ['improvement.incubated', 'improvement.rejected'] },
        },
      }),
    ).toBe(2);

    const consumer: RequestPrincipal = { ...requestPrincipal, roles: ['consumer'] };
    await expect(
      runWithPrincipal(consumer, () =>
        learning.reviewMemoryCandidate(firstMemory.id, memoryWinner),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED', status: 403 });

    const globalRelease = await createRelease(actorId, null);
    const globalRun = await createRun(
      globalRelease,
      actorId,
      ExecutionRunState.SUCCEEDED,
      null,
      null,
    );
    const globalMemory = await prisma.memoryCandidate.create({
      data: {
        sourceRunId: globalRun.id,
        namespace: `attention.global.${randomUUID()}`,
        proposedValue: { style: 'precise' },
        provenance: { source: 'global-fixture' },
        stagedBy: actorId,
      },
    });
    const globalAcceptMemory = {
      decision: 'accept' as const,
      rationale: 'Accept this workspace-global preference after an exact individual review.',
    };
    const workspaceOwner: RequestPrincipal = { ...principal(actorId, null), roles: ['owner'] };
    await expect(
      runWithPrincipal(workspaceOwner, () =>
        learning.reviewMemoryCandidate(globalMemory.id, globalAcceptMemory),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED', status: 403 });
    await expect(
      runWithPrincipal(principal(actorId, null), () =>
        learning.reviewMemoryCandidate(globalMemory.id, globalAcceptMemory),
      ),
    ).resolves.toMatchObject({ id: globalMemory.id, state: 'accepted' });
  });

  it('isolates digest cursors and pending snapshots by department for the same actor', async () => {
    const actorId = `human:governance-multi-department-${randomUUID()}`;
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
    const observationA = await createDigestObservation(actorId, departmentA);
    const releaseB = await createRelease(actorId, departmentB);
    const releaseA = await createRelease(actorId, departmentA);
    const runA = await createRun(releaseA, actorId, ExecutionRunState.SUCCEEDED, null, departmentA);

    await runWithPrincipal(principalA, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'observation.created',
          entityType: 'Observation',
          entityId: observationA.id,
          summary: {},
        }),
      ),
    );
    await runWithPrincipal(principalB, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'release.promoted',
          entityType: 'ReleaseBundle',
          entityId: releaseB.id,
          summary: {},
        }),
      ),
    );
    await runWithPrincipal(principalA, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'execution.succeeded',
          entityType: 'ExecutionRun',
          entityId: runA.id,
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
    const secondObservationA = await createDigestObservation(actorId, departmentA);
    await runWithPrincipal(principalA, () =>
      prisma.$transaction((transaction) =>
        appendPlatformEvent(transaction, {
          kind: 'observation.created',
          entityType: 'Observation',
          entityId: secondObservationA.id,
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
