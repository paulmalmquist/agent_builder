import {
  ReleaseEvaluationVerdict,
  ReleasePromotionAction,
  ResourceKind,
  ResourceLifecycle,
  type PrismaClient,
} from '@prisma/client';
import type { Request } from 'express';
import { ReleaseGovernanceService } from '../src/services/release-governance-service.js';
import {
  requestContextMiddleware,
  runWithPrincipal,
  type RequestPrincipal,
} from '../src/request-context.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';

const releaseId = '10000000-0000-4000-8000-000000000001';
const secondReleaseId = '10000000-0000-4000-8000-000000000002';
const skillId = '20000000-0000-4000-8000-000000000001';
const suiteId = '90000000-0000-4000-8000-000000000001';
const unrelatedId = '50000000-0000-4000-8000-000000000001';
const evaluationId = 'e0000000-0000-4000-8000-000000000001';
const decisionId = 'd0000000-0000-4000-8000-000000000001';
const now = new Date('2026-08-16T12:00:00.000Z');

const metadata = (id: string, slug: string, kindPurpose: string) => ({
  id,
  slug,
  version: '1.0.0',
  owner: 'test-owner',
  purpose: kindPurpose,
  lifecycle: 'candidate',
  provenance: 'synthetic',
});

const skillDefinition = {
  apiVersion: 'paul-os/v1',
  kind: 'Skill',
  metadata: metadata(skillId, 'daily-brief', 'Produce a cited daily planning brief for tests.'),
  dependencies: [],
  spec: {
    inputSchema: { type: 'object', properties: { calendarItems: { type: 'array' } } },
    outputSchema: {
      type: 'object',
      required: ['scheduleRisks', 'citations'],
      properties: { scheduleRisks: { type: 'array' }, citations: { type: 'array' } },
    },
    tools: [],
    permissions: [],
    contextRequirements: [],
    successCriteria: ['Return a schema-valid result.'],
  },
};

const suiteDefinition = {
  apiVersion: 'paul-os/v1',
  kind: 'EvaluationSuite',
  metadata: metadata(
    suiteId,
    'daily-brief-contract',
    'Verify deterministic release contract evidence without semantic quality claims.',
  ),
  dependencies: [{ familyId: skillId, version: '1.0.0' }],
  spec: {
    subject: 'daily-brief@1.0.0',
    executorKind: 'deterministic_contract',
    evaluationMode: 'contract_validation',
    corpusVersion: 1,
    cases: [
      {
        key: 'contract-shape',
        fixture: 'synthetic',
        assertions: [
          'output_schema_valid',
          'citations_resolve_to_supplied_calendar_items',
          'no_attempted_actions',
        ],
      },
    ],
    gates: { schemaConformance: 1, citationCoverage: 1, unauthorizedActions: 0 },
  },
};

function releaseResource(id: string, kind: ResourceKind, definition: object) {
  return {
    releaseId,
    resourceVersionId: id,
    kind,
    digest: id === suiteId ? 'b'.repeat(64) : 'a'.repeat(64),
    ordinal: id === suiteId ? 1 : 0,
    resourceVersion: {
      id,
      familyId: id,
      legacyAgentId: null,
      version: '1.0.0',
      lifecycle: ResourceLifecycle.CANDIDATE,
      owner: 'test-owner',
      purpose: 'A bounded synthetic resource used by governance service tests.',
      definition,
      digest: id === suiteId ? 'b'.repeat(64) : 'a'.repeat(64),
      sourceCommit: 'a'.repeat(40),
      provenance: 'synthetic',
      dependencyPins: [],
      revision: 1,
      frozenAt: now,
      createdBy: 'test-owner',
      updatedBy: 'test-owner',
      createdAt: now,
      updatedAt: now,
      family: {
        id,
        kind,
        slug: id === suiteId ? 'daily-brief-contract' : 'daily-brief',
        name: id === suiteId ? 'Daily Brief Contract' : 'Daily Brief',
        createdBy: 'test-owner',
        updatedBy: 'test-owner',
        createdAt: now,
        updatedAt: now,
      },
    },
  };
}

const release = {
  id: releaseId,
  digest: 'c'.repeat(64),
  projectId: null,
  createdBy: 'test-owner',
  createdAt: now,
  resources: [
    releaseResource(skillId, ResourceKind.SKILL, skillDefinition),
    releaseResource(suiteId, ResourceKind.EVALUATION_SUITE, suiteDefinition),
    releaseResource(unrelatedId, ResourceKind.REFERENCE, { notEvaluatedByThisSuite: true }),
  ],
};

const gateResults = [
  {
    key: 'schema_conformance',
    category: 'contract',
    operator: 'gte',
    threshold: 1,
    measuredValue: 1,
    status: 'passed',
    sampleSize: 1,
    evidenceSource: 'manifest_declaration',
    detail: 'Measured from the suite assertions against the immutable resource declaration.',
  },
  {
    key: 'citation_coverage',
    category: 'contract',
    operator: 'gte',
    threshold: 1,
    measuredValue: 1,
    status: 'passed',
    sampleSize: 1,
    evidenceSource: 'manifest_declaration',
    detail: 'Measured from the suite assertions against the immutable resource declaration.',
  },
  {
    key: 'unauthorized_actions',
    category: 'contract',
    operator: 'lte',
    threshold: 0,
    measuredValue: 0,
    status: 'passed',
    sampleSize: 1,
    evidenceSource: 'manifest_declaration',
    detail: 'Measured from the suite assertions against the immutable resource declaration.',
  },
] as const;

function runAsHuman<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const middleware = requestContextMiddleware({ enabled: false, actorId: 'human:test' });
    const request = {
      path: '/v1/production-channels/default/promote',
      header: () => undefined,
    } as unknown as Request;
    const response = { setHeader: jest.fn() };
    middleware(request, response as never, (error?: unknown) => {
      if (error !== undefined) {
        reject(error instanceof Error ? error : new Error('Request context setup failed'));
        return;
      }
      void operation().then(resolve, reject);
    });
  });
}

function scopedPrincipal(
  roles: RequestPrincipal['roles'],
  departmentId: string | null = LOCAL_DEPARTMENT_ID,
): RequestPrincipal {
  return {
    principalId: '10000000-0000-4000-8000-000000000099',
    actorId: 'human:test',
    workspaceId: LOCAL_WORKSPACE_ID,
    departmentId,
    authentication: 'local',
    roles,
    requestId: 'request-release-governance-test',
  };
}

describe('ReleaseGovernanceService', () => {
  it('stores immutable deterministic evidence and certifies only the suite and declared subject', async () => {
    const evaluationRecord = {
      id: evaluationId,
      releaseId,
      releaseDigest: release.digest,
      suiteVersionId: suiteId,
      suiteDigest: 'b'.repeat(64),
      executorKind: 'deterministic_contract',
      executorVersion: '1.0.0',
      evaluationMode: 'contract_validation',
      historySnapshotDigest: '0'.repeat(64),
      corpusVersion: 1,
      verdict: ReleaseEvaluationVerdict.PASSED,
      results: [
        {
          caseKey: 'contract-shape',
          assertions: [
            {
              key: 'output_schema_valid',
              passed: true,
              detail: 'The subject declares a bounded object output contract.',
            },
            {
              key: 'no_attempted_actions',
              passed: true,
              detail: 'The subject declares no authority-bearing tools or permissions.',
            },
          ],
          passed: true,
        },
      ],
      gateScores: { schemaConformance: 1, citationCoverage: 1, unauthorizedActions: 0 },
      evidence: {
        schemaVersion: 1,
        historySnapshotDigest: '0'.repeat(64),
        historyRunIds: [],
        suiteCaseCount: 1,
        assertionCount: 3,
        subjectPresent: true,
        subjectDigest: 'a'.repeat(64),
        gateResults,
      },
      requestedBy: 'system:background',
      createdAt: now,
      finishedAt: now,
    };
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      releaseBundle: { findFirst: jest.fn().mockResolvedValue(release) },
      releaseEvaluation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(evaluationRecord),
      },
      resourceVersion: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        Promise.resolve(operation(transaction)),
      ),
    } as unknown as PrismaClient;

    const result = await new ReleaseGovernanceService(prisma).evaluate({
      releaseId,
      suiteVersionId: suiteId,
    });

    expect(result.verdict).toBe('passed');
    expect(result.disclaimer).toContain('does not measure semantic model quality');
    expect(result.gateResults).toEqual(gateResults);
    expect(transaction.resourceVersion.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [suiteId, skillId] },
        }),
        data: expect.objectContaining({ lifecycle: ResourceLifecycle.CERTIFIED }),
      }),
    );
  });

  it('fails closed before database access when semantic execution is requested without an evaluator', async () => {
    const transactionMock = jest.fn();
    const prisma = { $transaction: transactionMock } as unknown as PrismaClient;

    await expect(
      new ReleaseGovernanceService(prisma).evaluate({
        releaseId,
        suiteVersionId: suiteId,
        requestedMode: 'semantic_execution',
      }),
    ).rejects.toMatchObject({
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
      details: { requestedMode: 'semantic_execution' },
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('creates new immutable evidence when production history changes from unavailable to sufficient', async () => {
    const releaseWithHistory = structuredClone(release);
    const suiteMember = releaseWithHistory.resources.find(
      ({ resourceVersionId }) => resourceVersionId === suiteId,
    );
    if (suiteMember === undefined) throw new Error('Suite fixture missing');
    suiteMember.resourceVersion.definition = {
      ...suiteDefinition,
      spec: {
        ...suiteDefinition.spec,
        gates: {
          ...suiteDefinition.spec.gates,
          historical: {
            maxMeanCostUsd: 0.1,
            maxP95LatencyMs: 2_000,
            minMeanOutcomeQuality: 0.9,
            minSampleSize: 2,
            historyWindow: 20,
          },
        },
      },
    };
    const firstHistoryRunId = '31000000-0000-4000-8000-000000000001';
    const secondHistoryRunId = '31000000-0000-4000-8000-000000000002';
    let historicalRuns: Array<Record<string, unknown>> = [];
    const storedEvaluations = new Map<string, Record<string, unknown>>();
    let createCount = 0;
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      releaseBundle: { findFirst: jest.fn().mockResolvedValue(releaseWithHistory) },
      releaseEvaluation: {
        findUnique: jest.fn(({ where }: { where: Record<string, Record<string, string>> }) => {
          const key = Object.values(where)[0]?.['historySnapshotDigest'];
          return Promise.resolve(key === undefined ? null : (storedEvaluations.get(key) ?? null));
        }),
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          createCount += 1;
          const created = {
            id: createCount === 1 ? evaluationId : 'e0000000-0000-4000-8000-000000000002',
            createdAt: now,
            ...data,
          };
          storedEvaluations.set(data['historySnapshotDigest'] as string, created);
          return Promise.resolve(created);
        }),
      },
      executionRun: {
        findMany: jest.fn(() => Promise.resolve(historicalRuns)),
      },
      resourceVersion: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        Promise.resolve(operation(transaction)),
      ),
    } as unknown as PrismaClient;

    const service = new ReleaseGovernanceService(prisma);
    const preProduction = await service.evaluate({
      releaseId,
      suiteVersionId: suiteId,
    });

    expect(preProduction.verdict).toBe('passed');
    expect(preProduction.gateResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'mean_cost_usd', status: 'not_applicable' }),
        expect.objectContaining({ key: 'p95_latency_ms', status: 'not_applicable' }),
        expect.objectContaining({ key: 'mean_outcome_quality', status: 'not_applicable' }),
      ]),
    );

    historicalRuns = [
      {
        id: firstHistoryRunId,
        finishedAt: new Date('2026-08-17T12:00:00.000Z'),
        actualCostUsd: { toNumber: () => 0.03 },
        outcome: { qualityScore: 0.95 },
        metrics: [{ value: 1_000 }],
      },
      {
        id: secondHistoryRunId,
        finishedAt: new Date('2026-08-16T12:00:00.000Z'),
        actualCostUsd: { toNumber: () => 0.05 },
        outcome: { qualityScore: 0.91 },
        metrics: [{ value: 1_500 }],
      },
    ];
    const withProductionHistory = await service.evaluate({ releaseId, suiteVersionId: suiteId });
    const sameSnapshot = await service.evaluate({ releaseId, suiteVersionId: suiteId });

    expect(withProductionHistory.id).not.toBe(preProduction.id);
    expect(withProductionHistory.historySnapshotDigest).not.toBe(
      preProduction.historySnapshotDigest,
    );
    expect(withProductionHistory.executorVersion).toBe('1.1.0');
    expect(withProductionHistory.evidence.historyRunIds).toEqual([
      firstHistoryRunId,
      secondHistoryRunId,
    ]);
    expect(sameSnapshot.id).toBe(withProductionHistory.id);
    expect(transaction.releaseEvaluation.create).toHaveBeenCalledTimes(2);
    expect(transaction.executionRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          releaseId,
          releaseDigest: release.digest,
          developmentDraft: false,
        }),
        take: 20,
      }),
    );
    expect(withProductionHistory.gateResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'mean_cost_usd', measuredValue: 0.04, status: 'passed' }),
        expect.objectContaining({ key: 'p95_latency_ms', measuredValue: 1_500, status: 'passed' }),
        expect.objectContaining({
          key: 'mean_outcome_quality',
          measuredValue: 0.9299999999999999,
          status: 'passed',
        }),
      ]),
    );
  });

  it('requires an exact passing evaluation and verified certified resources for promotion', async () => {
    const evidence = {
      id: evaluationId,
      releaseId,
      releaseDigest: release.digest,
      verdict: ReleaseEvaluationVerdict.PASSED,
      declineDecisions: [],
    };
    const certifiedRelease = {
      ...release,
      resources: release.resources.map((member) => ({
        ...member,
        resourceVersion: { ...member.resourceVersion, lifecycle: ResourceLifecycle.CERTIFIED },
      })),
    };
    const channel = {
      key: 'default',
      projectId: null,
      currentReleaseId: null,
      priorReleaseId: null,
      promotedBy: null,
      promotedAt: null,
      updatedAt: now,
      currentRelease: null,
    };
    const decision = {
      id: decisionId,
      channelKey: 'default',
      action: ReleasePromotionAction.PROMOTED,
      releaseId,
      previousReleaseId: null,
      evaluationId,
      rationale: 'Promote this certified release for a bounded integration test.',
      decidedBy: 'human:test',
      decidedAt: now,
    };
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      releaseBundle: { findFirst: jest.fn().mockResolvedValue(certifiedRelease) },
      releaseEvaluation: { findFirst: jest.fn().mockResolvedValue(evidence) },
      productionChannel: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(channel),
        update: jest.fn().mockResolvedValue({
          ...channel,
          currentReleaseId: releaseId,
          currentRelease: certifiedRelease,
          promotedBy: 'human:test',
          promotedAt: now,
        }),
      },
      releasePromotionDecision: { create: jest.fn().mockResolvedValue(decision) },
      catalogPublication: { findMany: jest.fn().mockResolvedValue([]) },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
      platformEvent: { create: jest.fn().mockResolvedValue({ id: 'platform-event-id' }) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        Promise.resolve(operation(transaction)),
      ),
    } as unknown as PrismaClient;
    const service = new ReleaseGovernanceService(prisma);

    await expect(
      service.promote('default', {
        releaseId,
        evaluationId,
        rationale: decision.rationale,
      }),
    ).rejects.toMatchObject({ code: 'HUMAN_APPROVAL_REQUIRED' });

    const promoted = await runAsHuman(() =>
      service.promote('default', {
        releaseId,
        evaluationId,
        rationale: decision.rationale,
      }),
    );
    expect(promoted.channel.currentReleaseId).toBe(releaseId);
    expect(promoted.decision.decidedBy).toBe('human:test');
    expect(transaction.releaseBundle.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: releaseId,
          workspaceId: LOCAL_WORKSPACE_ID,
          departmentId: LOCAL_DEPARTMENT_ID,
        },
      }),
    );

    transaction.releaseEvaluation.findFirst
      .mockReset()
      .mockResolvedValueOnce(evidence)
      .mockResolvedValueOnce({ id: 'e0000000-0000-4000-8000-000000000099' });
    await expect(
      runAsHuman(() =>
        service.promote('default', {
          releaseId,
          evaluationId,
          rationale: 'Reject a stale passing evaluation after newer evidence was recorded.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'RELEASE_EVALUATION_SUPERSEDED', status: 409 });

    transaction.releaseBundle.findFirst.mockResolvedValue({
      ...certifiedRelease,
      id: secondReleaseId,
      digest: 'd'.repeat(64),
      resources: certifiedRelease.resources.map((member) => ({
        ...member,
        resourceVersion: { ...member.resourceVersion, sourceCommit: 'legacy-unverified' },
      })),
    });
    transaction.releaseEvaluation.findFirst.mockResolvedValue({
      ...evidence,
      releaseId: secondReleaseId,
      releaseDigest: 'd'.repeat(64),
    });
    await expect(
      runAsHuman(() =>
        service.promote('default', {
          releaseId: secondReleaseId,
          evaluationId,
          rationale: 'Attempt to promote an unverified local release into production.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'UNVERIFIED_RELEASE_PROVENANCE' });
  });

  it('rejects stale decline evidence and requires admin for workspace-global decisions', async () => {
    const evidence = {
      id: evaluationId,
      releaseId,
      releaseDigest: release.digest,
      verdict: ReleaseEvaluationVerdict.PASSED,
      release,
      promotionDecisions: [],
      declineDecisions: [],
    };
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      releaseEvaluation: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(evidence)
          .mockResolvedValueOnce({ id: 'e0000000-0000-4000-8000-000000000099' }),
      },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
        Promise.resolve(operation(transaction)),
      ),
    } as unknown as PrismaClient;
    const service = new ReleaseGovernanceService(prisma);

    await expect(
      runAsHuman(() =>
        service.decline('default', {
          releaseId,
          evaluationId,
          rationale: 'Do not decide from evidence superseded by a newer release evaluation.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'RELEASE_EVALUATION_SUPERSEDED', status: 409 });
    expect(transaction.releaseEvaluation.findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          id: evaluationId,
          release: {
            workspaceId: LOCAL_WORKSPACE_ID,
            departmentId: LOCAL_DEPARTMENT_ID,
          },
        },
      }),
    );

    const transactionMock = jest.fn();
    const noTransaction = {
      $transaction: transactionMock,
    } as unknown as PrismaClient;
    const globalService = new ReleaseGovernanceService(noTransaction);
    await expect(
      runWithPrincipal(scopedPrincipal(['owner'], null), () =>
        globalService.decline('default', {
          releaseId,
          evaluationId,
          rationale: 'A workspace owner must not decide a global release without admin.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED', status: 403 });
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
