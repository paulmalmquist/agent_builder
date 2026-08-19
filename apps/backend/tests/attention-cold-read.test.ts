import {
  ExecutionRunState,
  MemoryCandidateState,
  PluginInstallationState,
  Prisma,
  ReleaseEvaluationVerdict,
  ResourceKind,
  ResourceLifecycle,
  type PrismaClient,
} from '@prisma/client';
import { AttentionService, approvalScopePresentation } from '../src/services/attention-service.js';
import { runWithPrincipal, type RequestPrincipal } from '../src/request-context.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';
import {
  safeAttentionLabel,
  subjectFromRelease,
  subjectFromResourceVersion,
} from '../src/services/attention-subject.js';
import {
  userFacingExecutionRunWhere,
  userFacingImprovementCandidateWhere,
  userFacingMemoryCandidateWhere,
  userFacingPluginInstallationWhere,
  userFacingReleaseBundleWhere,
} from '../src/services/user-facing-records.js';

const occurredAt = new Date('2026-08-17T16:00:00.000Z');
const releaseId = '10000000-0000-4000-8000-000000000001';
const evaluationId = '10000000-0000-4000-8000-000000000002';
const runId = '10000000-0000-4000-8000-000000000003';
const memoryId = '10000000-0000-4000-8000-000000000004';
const improvementId = '10000000-0000-4000-8000-000000000005';
const observationId = '10000000-0000-4000-8000-000000000006';
const installationId = '10000000-0000-4000-8000-000000000007';
const rawDigest = 'b'.repeat(64);
const rawActor = 'worker-test';

function resourceVersion(name = 'Warehouse Cost Sentinel') {
  return {
    id: '10000000-0000-4000-8000-000000000015',
    familyId: '10000000-0000-4000-8000-000000000015',
    version: '2.1.0',
    lifecycle: ResourceLifecycle.CERTIFIED,
    sourceCommit: 'a'.repeat(40),
    createdBy: 'human:operator',
    updatedBy: 'human:operator',
    updatedAt: occurredAt,
    family: {
      id: '10000000-0000-4000-8000-000000000015',
      slug: 'warehouse-cost-sentinel',
      name,
      kind: ResourceKind.AGENT,
      createdBy: 'human:operator',
      updatedBy: 'human:operator',
    },
  };
}

function release(name = 'Warehouse Cost Sentinel') {
  return {
    projectId: 'warehouse-cost-sentinel',
    digest: rawDigest,
    resources: [{ resourceVersion: resourceVersion(name) }],
  };
}

function run(name = 'Warehouse Cost Sentinel') {
  return {
    id: runId,
    workspaceId: '10000000-0000-4000-8000-000000000010',
    departmentId: '10000000-0000-4000-8000-000000000011',
    releaseId,
    projectId: 'warehouse-cost-sentinel',
    entryResourceVersionId: '10000000-0000-4000-8000-000000000015',
    entryResourceVersion: resourceVersion(name),
    release: release(name),
    state: ExecutionRunState.FAILED,
    requiredToolScopes: [],
    progress: 40,
    message: `Failure ${rawDigest} recorded by ${rawActor}`,
    actualCostUsd: null,
    estimatedUpperCostUsd: new Prisma.Decimal(0.25),
    maxEstimatedCostUsd: new Prisma.Decimal(1),
    requestedBy: rawActor,
    updatedAt: occurredAt,
    leaseExpiresAt: null,
  };
}

function evaluation(name = 'Warehouse Cost Sentinel') {
  return {
    id: evaluationId,
    releaseId,
    corpusVersion: 7,
    executorKind: 'deterministic_contract',
    executorVersion: rawDigest,
    evaluationMode: 'contract_validation',
    gateScores: { schemaConformance: 1 },
    evidence: { digest: rawDigest },
    requestedBy: rawActor,
    finishedAt: occurredAt,
    verdict: ReleaseEvaluationVerdict.PASSED as ReleaseEvaluationVerdict,
    promotionDecisions: [] as Array<{ id: string }>,
    declineDecisions: [] as Array<{ id: string }>,
    release: release(name),
  };
}

function memory(name = 'Warehouse Cost Sentinel') {
  return {
    id: memoryId,
    sourceRunId: runId,
    namespace: `preferences.${rawDigest}`,
    stagedBy: rawActor,
    stagedAt: occurredAt,
    proposedValue: { ordering: 'risk-first' },
    provenance: { actor: rawActor },
    state: MemoryCandidateState.STAGED,
    sourceRun: run(name),
  };
}

function improvement(name = 'Warehouse Cost Sentinel') {
  return {
    id: improvementId,
    title: 'Candidate 3f8bdaf6',
    proposedTarget: 'warehouse-cost-sentinel@next',
    createdBy: rawActor,
    createdAt: occurredAt,
    observationId,
    proposedChange: 'Tighten the bounded validation rule.',
    evidenceRefs: [`observation:${observationId}`],
    observation: {
      workspaceId: '10000000-0000-4000-8000-000000000010',
      departmentId: '10000000-0000-4000-8000-000000000011',
      sourceRunId: runId,
      sourceRun: run(name),
    },
  };
}

function plugin(name = 'BigQuery') {
  return {
    id: installationId,
    state: PluginInstallationState.DEGRADED,
    updatedBy: rawActor,
    updatedAt: occurredAt,
    pluginVersionId: '10000000-0000-4000-8000-000000000008',
    pluginDigest: rawDigest,
    pluginVersion: {
      version: '1.4.0',
      family: { name },
    },
  };
}

type EvaluationFixture = Omit<
  ReturnType<typeof evaluation>,
  'verdict' | 'promotionDecisions' | 'declineDecisions'
> & {
  verdict: ReleaseEvaluationVerdict;
  promotionDecisions: Array<{ id: string }>;
  declineDecisions: Array<{ id: string }>;
};

function prismaFor(input: {
  approvals?: unknown[];
  evaluations?: EvaluationFixture[];
  memory?: unknown[];
  improvements?: unknown[];
  runs?: unknown[];
  plugins?: unknown[];
  resourceVersions?: unknown[];
  resolutions?: Array<{ itemId: string }>;
  events?: unknown[];
  digestRuns?: unknown[];
  digestObservations?: unknown[];
  digestReleases?: unknown[];
  digestEvaluations?: unknown[];
  digestPlugins?: unknown[];
  digestPublications?: unknown[];
  digestImprovements?: unknown[];
}): PrismaClient {
  const evaluations = input.evaluations ?? [];
  return {
    attentionCursor: { findFirst: jest.fn(() => Promise.resolve(null)) },
    approvalRequest: { findMany: jest.fn(() => Promise.resolve(input.approvals ?? [])) },
    releaseEvaluation: {
      findMany: jest.fn((query: { select?: unknown }) =>
        Promise.resolve(
          query.select === undefined
            ? evaluations.filter(
                ({ verdict, promotionDecisions, declineDecisions }) =>
                  verdict === ReleaseEvaluationVerdict.PASSED &&
                  promotionDecisions.length === 0 &&
                  declineDecisions.length === 0,
              )
            : (input.digestEvaluations ?? []),
        ),
      ),
      findFirst: jest.fn(({ where }: { where: { releaseId: string } }) =>
        Promise.resolve(
          [...evaluations]
            .filter(({ releaseId: candidateReleaseId }) => candidateReleaseId === where.releaseId)
            .sort(
              (left, right) =>
                right.finishedAt.getTime() - left.finishedAt.getTime() ||
                right.id.localeCompare(left.id),
            )[0] ?? null,
        ),
      ),
    },
    memoryCandidate: {
      findMany: jest.fn(() =>
        Promise.resolve(
          (input.memory ?? []).filter(
            (record) =>
              (record as { state?: MemoryCandidateState }).state === MemoryCandidateState.STAGED,
          ),
        ),
      ),
    },
    improvementCandidate: {
      findMany: jest.fn((query: { select?: unknown }) =>
        Promise.resolve(
          query.select === undefined
            ? (input.improvements ?? [])
            : (input.digestImprovements ?? []),
        ),
      ),
    },
    resourceVersion: {
      findMany: jest.fn(() => Promise.resolve(input.resourceVersions ?? [resourceVersion()])),
    },
    executionRun: {
      findMany: jest.fn((query: { select?: unknown }) =>
        Promise.resolve(query.select === undefined ? (input.runs ?? []) : (input.digestRuns ?? [])),
      ),
    },
    observation: {
      findMany: jest.fn(() => Promise.resolve(input.digestObservations ?? [])),
    },
    releaseBundle: {
      findMany: jest.fn(() => Promise.resolve(input.digestReleases ?? [])),
    },
    pluginInstallation: {
      findMany: jest.fn((query: { select?: unknown }) =>
        Promise.resolve(
          query.select === undefined ? (input.plugins ?? []) : (input.digestPlugins ?? []),
        ),
      ),
    },
    catalogPublication: {
      findMany: jest.fn(() => Promise.resolve(input.digestPublications ?? [])),
    },
    attentionResolution: { findMany: jest.fn(() => Promise.resolve(input.resolutions ?? [])) },
    platformEvent: { findMany: jest.fn(() => Promise.resolve(input.events ?? [])) },
  } as unknown as PrismaClient;
}

function cardFace(item: Awaited<ReturnType<AttentionService['list']>>['decide'][number]): string {
  return [
    item.headline,
    item.delta,
    item.reason,
    item.payload.subject?.name,
    item.payload.subject?.kind,
    item.payload.subject?.version,
    item.primaryAction?.label,
    item.primaryAction?.consequence,
    item.primaryAction?.undo,
    item.secondaryAction?.label,
    item.secondaryAction?.consequence,
    item.secondaryAction?.undo,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

describe('Attention cold-read projection', () => {
  it('accepts canonical display names and rejects identifier, address, URI, and path labels', () => {
    expect(subjectFromResourceVersion(resourceVersion('Daily Brief'))).toMatchObject({
      name: 'Daily Brief',
      kind: 'agent',
      version: '2.1.0',
    });
    expect(
      subjectFromResourceVersion({
        ...resourceVersion('daily-brief'),
        family: {
          id: '20000000-0000-4000-8000-000000000001',
          name: 'daily-brief',
          kind: ResourceKind.SKILL,
        },
      }),
    ).toMatchObject({ name: 'Daily Brief', kind: 'skill', version: '2.1.0' });
    for (const unsafe of [
      'daily-brief',
      'Candidate 3f8bdaf6',
      'worker-test',
      'owner@example.com',
      'https://example.com/agent',
      'urn:paul-os:agent:daily-brief',
      'C:\\agents\\daily-brief',
      '/agents/daily-brief',
      'Input/foo bar',
      'Input\\foo bar',
    ]) {
      expect(safeAttentionLabel(unsafe)).toBeNull();
    }
    expect(
      subjectFromResourceVersion({
        ...resourceVersion('Daily Brief'),
        version: 'https://example.com/version',
      }),
    ).toBeNull();
    for (const version of ['foo/bar', 'foo\\bar', 'foo@bar']) {
      expect(subjectFromResourceVersion({ ...resourceVersion('Daily Brief'), version })).toBeNull();
    }
  });

  it('does not erase release ambiguity by filtering an unsafe duplicate', () => {
    expect(
      subjectFromRelease(
        [
          { resourceVersion: resourceVersion('Warehouse Cost Sentinel') },
          { resourceVersion: resourceVersion('Candidate 3f8bdaf6') },
        ],
        'warehouse-cost-sentinel',
      ),
    ).toBeNull();
  });

  it('collapses exact release and memory requests while keeping only the newest decision state', async () => {
    const olderEvaluation = {
      ...evaluation(),
      id: '10000000-0000-4000-8000-000000000012',
      finishedAt: new Date('2026-08-17T15:00:00.000Z'),
    };
    const olderMemory = {
      ...memory(),
      id: '10000000-0000-4000-8000-000000000013',
      stagedAt: new Date('2026-08-17T15:00:00.000Z'),
      provenance: { sourceRunId: '10000000-0000-4000-8000-000000000099' },
    };
    const service = new AttentionService(
      prismaFor({
        evaluations: [olderEvaluation, evaluation()],
        memory: [olderMemory, memory()],
      }),
    );
    const pending = await service.list();
    expect(pending.decide).toHaveLength(2);
    expect(pending.decide.map(({ payload }) => payload.requestCount)).toEqual([2, 2]);
    expect(pending.decide.map(({ payload }) => payload.evaluationId)).toContain(evaluationId);
    expect(pending.decide.map(({ payload }) => payload.candidateId)).toContain(memoryId);
    expect(
      pending.decide.find(({ kind }) => kind === 'release_promotion')?.primaryAction?.consequence,
    ).toContain('all 2 byte-equivalent evaluation requests');
    expect(
      pending.decide.find(({ kind }) => kind === 'memory_review')?.primaryAction?.consequence,
    ).toContain('all 2 exact matching proposals');

    const releaseItem = pending.decide.find(({ kind }) => kind === 'release_promotion');
    expect(releaseItem).toBeDefined();
    const releaseDetail = await service.getItem(releaseItem?.id ?? 'missing-release-item');
    expect(releaseDetail.membership).toMatchObject({
      exactCount: 2,
      records: [
        {
          label: 'Release evaluation 01',
          subject: { name: 'Warehouse Cost Sentinel' },
          technicalReferences: [
            { label: 'Release evaluation', value: olderEvaluation.id },
            { label: 'Release', value: releaseId },
          ],
        },
        {
          label: 'Release evaluation 02',
          subject: { name: 'Warehouse Cost Sentinel' },
          technicalReferences: [
            { label: 'Release evaluation', value: evaluationId },
            { label: 'Release', value: releaseId },
          ],
        },
      ],
    });
    expect(cardFace(releaseDetail.item)).not.toContain(olderEvaluation.id);

    const decidedEvaluation = {
      ...evaluation(),
      promotionDecisions: [{ id: '10000000-0000-4000-8000-000000000014' }],
    };
    const acceptedMemory = { ...memory(), state: MemoryCandidateState.ACCEPTED };
    const acceptedOlderMemory = {
      ...olderMemory,
      state: MemoryCandidateState.ACCEPTED,
    };
    const resolved = await new AttentionService(
      prismaFor({
        evaluations: [olderEvaluation, decidedEvaluation],
        memory: [acceptedOlderMemory, acceptedMemory],
      }),
    ).list();
    expect(resolved.decide).toEqual([]);

    const newerFailed = {
      ...evaluation(),
      id: '10000000-0000-4000-8000-000000000016',
      verdict: ReleaseEvaluationVerdict.FAILED,
      finishedAt: new Date('2026-08-17T17:00:00.000Z'),
    };
    const failedLatest = await new AttentionService(
      prismaFor({ evaluations: [olderEvaluation, newerFailed] }),
    ).list();
    expect(failedLatest.decide).toEqual([]);
  });

  it('collapses byte-equivalent improvement requests and preserves the exact count', async () => {
    const candidates = [0, 1, 2].map((offset) => ({
      ...improvement(),
      id: `10000000-0000-4000-8000-00000000002${offset}`,
      observationId: `10000000-0000-4000-8000-00000000003${offset}`,
      createdAt: new Date(occurredAt.getTime() + offset * 1_000),
      observation: {
        ...improvement().observation,
        sourceRunId: `10000000-0000-4000-8000-00000000004${offset}`,
        sourceRun: {
          ...run(),
          id: `10000000-0000-4000-8000-00000000004${offset}`,
        },
      },
    }));

    const queue = await new AttentionService(prismaFor({ improvements: candidates })).list();

    expect(queue.decide).toHaveLength(1);
    expect(queue.decide[0]).toMatchObject({
      headline: 'Warehouse Cost Sentinel has an improvement proposal.',
      payload: {
        candidateId: candidates[2]?.id,
        requestCount: 3,
        decisionGroupKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        subject: { name: 'Warehouse Cost Sentinel' },
      },
    });
    expect(queue.decide[0]?.primaryAction?.consequence).toContain('all 3 exact matching proposals');
    expect(queue.decide[0]?.secondaryAction?.consequence).toContain(
      'all 3 exact matching proposals',
    );
    expect(cardFace(queue.decide[0]!)).not.toContain(candidates[2]?.title);
  });

  it('uses the certified proposed target rather than the source-run subject', async () => {
    const crossTarget = {
      ...improvement(),
      title: 'Review the synthetic repeated behavior',
      proposedTarget: 'daily-brief@next',
    };
    const governedDailyBrief = {
      id: '10000000-0000-4000-8000-000000000050',
      familyId: '20000000-0000-4000-8000-000000000001',
      version: '1.1.0',
      lifecycle: ResourceLifecycle.CERTIFIED,
      updatedAt: occurredAt,
      family: {
        id: '20000000-0000-4000-8000-000000000001',
        slug: 'daily-brief',
        name: 'daily-brief',
        kind: ResourceKind.SKILL,
      },
    };

    const queue = await new AttentionService(
      prismaFor({ improvements: [crossTarget], resourceVersions: [governedDailyBrief] }),
    ).list();

    expect(queue.decide[0]).toMatchObject({
      headline: 'Daily Brief has an improvement proposal.',
      reason: expect.stringContaining('change to Daily Brief'),
      payload: {
        subject: { name: 'Daily Brief', kind: 'skill', version: '1.1.0' },
        reviewFacts: expect.arrayContaining([
          { label: 'Target intent', value: 'Successor to governed version 1.1.0' },
        ]),
      },
    });
    expect(cardFace(queue.decide[0]!)).not.toMatch(/synthetic repeated behavior|daily-brief/iu);
    expect(cardFace(queue.decide[0]!)).not.toContain('Warehouse Cost Sentinel');
  });

  it('resolves an exact improvement target version instead of substituting the newest version', async () => {
    const exactTarget = {
      ...improvement(),
      proposedTarget: 'Skill:daily-brief@1.0.0',
    };
    const governedVersion = (version: string, updatedAt: Date) => ({
      ...resourceVersion('daily-brief'),
      id:
        version === '1.0.0'
          ? '10000000-0000-4000-8000-000000000057'
          : '10000000-0000-4000-8000-000000000058',
      familyId: '20000000-0000-4000-8000-000000000001',
      version,
      updatedAt,
      family: {
        ...resourceVersion().family,
        id: '20000000-0000-4000-8000-000000000001',
        slug: 'daily-brief',
        name: 'daily-brief',
        kind: ResourceKind.SKILL,
      },
    });
    const queue = await new AttentionService(
      prismaFor({
        improvements: [exactTarget],
        resourceVersions: [
          governedVersion('2.0.0', new Date('2026-08-18T00:00:00.000Z')),
          governedVersion('1.0.0', occurredAt),
        ],
      }),
    ).list();

    expect(queue.decide[0]?.payload.subject).toMatchObject({
      name: 'Daily Brief',
      version: '1.0.0',
    });
    expect(queue.decide[0]?.payload.reviewFacts).toContainEqual({
      label: 'Target intent',
      value: 'Exact governed version 1.0.0',
    });
  });

  it('bounds pending queries and excludes active releases before projection', async () => {
    const prisma = prismaFor({ evaluations: [evaluation()] });
    await new AttentionService(prisma).list();

    const releaseQuery = (prisma.releaseEvaluation.findMany as unknown as jest.Mock).mock
      .calls[0]?.[0];
    const approvalQuery = (prisma.approvalRequest.findMany as unknown as jest.Mock).mock
      .calls[0]?.[0];
    const memoryQuery = (prisma.memoryCandidate.findMany as unknown as jest.Mock).mock
      .calls[0]?.[0];
    const improvementQuery = (prisma.improvementCandidate.findMany as unknown as jest.Mock).mock
      .calls[0]?.[0];
    expect(releaseQuery).toMatchObject({
      where: {
        verdict: ReleaseEvaluationVerdict.PASSED,
        promotionDecisions: { none: {} },
        declineDecisions: { none: {} },
      },
      take: 251,
    });
    expect(releaseQuery.where.release.AND).toEqual(
      expect.arrayContaining([
        { workspaceId: LOCAL_WORKSPACE_ID, departmentId: LOCAL_DEPARTMENT_ID },
        userFacingReleaseBundleWhere,
        { activeChannels: { none: {} } },
      ]),
    );
    expect(approvalQuery).toMatchObject({ take: 251 });
    expect(approvalQuery.where.run.AND).toContainEqual(userFacingExecutionRunWhere);
    expect(memoryQuery.where.AND).toContainEqual(userFacingMemoryCandidateWhere);
    expect(memoryQuery).toMatchObject({ take: 251 });
    expect(improvementQuery.where.AND).toContainEqual(userFacingImprovementCandidateWhere);
    expect(improvementQuery).toMatchObject({ take: 251 });
    const degradedRunQuery = (prisma.executionRun.findMany as unknown as jest.Mock).mock
      .calls[0]?.[0];
    const degradedPluginQuery = (prisma.pluginInstallation.findMany as unknown as jest.Mock).mock
      .calls[0]?.[0];
    expect(degradedRunQuery.where.AND).toContainEqual(userFacingExecutionRunWhere);
    expect(degradedPluginQuery.where.AND).toContainEqual(userFacingPluginInstallationWhere);

    const workspaceOwner: RequestPrincipal = {
      principalId: '10000000-0000-4000-8000-000000000090',
      actorId: 'human:workspace-owner',
      workspaceId: LOCAL_WORKSPACE_ID,
      departmentId: null,
      authentication: 'local',
      roles: ['owner'],
      requestId: 'attention-workspace-owner',
    };
    const ownerPrisma = prismaFor({ evaluations: [evaluation()] });
    await runWithPrincipal(workspaceOwner, () => new AttentionService(ownerPrisma).list());
    expect(
      (ownerPrisma.releaseEvaluation.findMany as unknown as jest.Mock).mock.calls[0]?.[0],
    ).toMatchObject({
      where: expect.objectContaining({
        release: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              workspaceId: LOCAL_WORKSPACE_ID,
              departmentId: null,
              id: { in: [] },
            }),
          ]),
        }),
      }),
    });

    await expect(
      new AttentionService(
        prismaFor({ improvements: Array.from({ length: 251 }, () => improvement()) }),
      ).list(),
    ).rejects.toMatchObject({ code: 'ATTENTION_QUEUE_LIMIT_EXCEEDED', status: 503 });
    await expect(
      new AttentionService(
        prismaFor({ approvals: Array.from({ length: 251 }, () => ({})) }),
      ).list(),
    ).rejects.toMatchObject({ code: 'ATTENTION_QUEUE_LIMIT_EXCEEDED', status: 503 });
  });

  it('keeps quarantined ledger entities out of the digest while retaining governed activity', async () => {
    const governedRunId = '10000000-0000-4000-8000-000000000051';
    const fixtureRunId = '10000000-0000-4000-8000-000000000052';
    const failedRunId = '10000000-0000-4000-8000-000000000053';
    const governedReleaseId = '10000000-0000-4000-8000-000000000054';
    const fixtureReleaseId = '10000000-0000-4000-8000-000000000055';
    const governedEvaluationId = '10000000-0000-4000-8000-000000000056';
    const event = (kind: string, entityType: string, entityId: string, costUsd?: number) => ({
      kind,
      entityType,
      entityId,
      summary: costUsd === undefined ? {} : { costUsd },
      occurredAt,
    });
    const prisma = prismaFor({
      events: [
        event('execution.succeeded', 'ExecutionRun', governedRunId, 1.25),
        event('execution.failed', 'ExecutionRun', fixtureRunId, 99),
        event('release.promoted', 'ReleaseBundle', governedReleaseId),
        event('release.promoted', 'ReleaseBundle', fixtureReleaseId),
        event('release.declined', 'ReleaseEvaluation', governedEvaluationId),
        event('attention.resolved', 'AttentionItem', `stalled_run:${failedRunId}`),
        event('fixture.unknown', 'UnknownFixture', fixtureRunId, 50),
      ],
      digestRuns: [
        { id: governedRunId, state: ExecutionRunState.SUCCEEDED },
        { id: failedRunId, state: ExecutionRunState.FAILED },
      ],
      digestReleases: [{ id: governedReleaseId }],
      digestEvaluations: [{ id: governedEvaluationId }],
    });

    const queue = await new AttentionService(prisma).list();

    expect(queue.digest).toMatchObject({
      runCount: 1,
      totalCostUsd: 1.25,
      promotionCount: 1,
    });
    expect(queue.digest.headline).toBe('1 runs · $1.25 · 1 promotions since the last briefing');
    const releaseEvaluationQueries = (prisma.releaseEvaluation.findMany as unknown as jest.Mock)
      .mock.calls;
    expect(releaseEvaluationQueries).toContainEqual([
      expect.objectContaining({ select: { id: true } }),
    ]);
  });

  it('keeps secret, URI, path, and identifier-shaped authority labels off card copy', () => {
    const presentation = approvalScopePresentation({
      requiredToolScopes: ['calendar.read'],
      requiredPluginScopes: [
        {
          installationId: '10000000-0000-4000-8000-000000000021',
          pluginVersionId: '10000000-0000-4000-8000-000000000022',
          pluginDigest: 'c'.repeat(64),
          tool: 'lookup',
          effect: 'read',
          executionPlacement: 'control_plane',
          approvalRequired: true,
          scopeDescription:
            'Read https://private.example/v1/Candidate-3f8bdaf6 with api_key=classified',
          limits: {
            maxInvocationsPerRun: 1,
            maxRecords: 10,
            maxResponseBytes: 1_000,
            timeoutMs: 1_000,
            maxEstimatedCostUsd: 0.01,
          },
        },
      ],
    });

    expect(presentation).toEqual({
      labels: ['2 exact authority boundaries'],
      total: 2,
    });
    expect(JSON.stringify(presentation)).not.toMatch(
      /private\.example|3f8bdaf6|api_key|classified/iu,
    );
  });

  it('names every non-execution subject and keeps identifiers, actors, and messages off cards', async () => {
    const queue = await new AttentionService(
      prismaFor({
        evaluations: [evaluation()],
        memory: [memory()],
        improvements: [improvement()],
        runs: [run()],
        plugins: [plugin()],
      }),
    ).list();

    expect(queue.decide.map(({ headline }) => headline)).toEqual([
      'Warehouse Cost Sentinel is ready for a production decision.',
      'Warehouse Cost Sentinel proposed a durable memory.',
      'Warehouse Cost Sentinel has an improvement proposal.',
    ]);
    expect(queue.degraded.map(({ headline }) => headline)).toEqual([
      'BigQuery is degraded.',
      'Warehouse Cost Sentinel failed before producing an outcome.',
    ]);

    for (const item of [...queue.decide, ...queue.degraded]) {
      expect(item.payload.subject).not.toBeNull();
      expect(item.primaryAction?.consequence).toBeTruthy();
      expect(cardFace(item)).not.toMatch(
        new RegExp(`${rawDigest}|${rawActor}|3f8bdaf6|daily-brief|preferences\\.`, 'iu'),
      );
    }
  });

  it('moves identifier-shaped or missing subjects to read-only safety stops', async () => {
    const unsafeName = 'Candidate 3f8bdaf6';
    const unsafeRun = {
      ...run(unsafeName),
      entryResourceVersion: null,
      release: { ...release(unsafeName), resources: [] },
    };
    const unsafeMemory = { ...memory(unsafeName), sourceRun: unsafeRun };
    const unsafeImprovement = {
      ...improvement(unsafeName),
      observation: {
        workspaceId: '10000000-0000-4000-8000-000000000010',
        departmentId: '10000000-0000-4000-8000-000000000011',
        sourceRunId: null,
        sourceRun: null,
      },
    };

    const queue = await new AttentionService(
      prismaFor({
        evaluations: [evaluation(unsafeName)],
        memory: [unsafeMemory],
        improvements: [unsafeImprovement],
        runs: [unsafeRun],
        plugins: [plugin(unsafeName)],
        resourceVersions: [],
      }),
    ).list();

    expect(queue.decide).toEqual([]);
    expect(queue.degraded).toHaveLength(5);
    for (const item of queue.degraded) {
      expect(item).toMatchObject({
        kind: 'safety_stop',
        shelf: 'degraded',
        status: 'safety_stop',
        headline: 'Review stopped: the governed subject is unavailable.',
        secondaryAction: null,
        primaryAction: { kind: 'open_details' },
        payload: { subject: null },
      });
      expect(cardFace(item)).not.toMatch(/3f8bdaf6|worker-test|[a-f0-9]{64}/iu);
    }
  });

  it('keeps acknowledged failures hidden when their presentation becomes a safety stop', async () => {
    const unsafeRun = {
      ...run('Candidate 3f8bdaf6'),
      entryResourceVersion: null,
      release: { ...release('Candidate 3f8bdaf6'), resources: [] },
    };

    const queue = await new AttentionService(
      prismaFor({
        runs: [unsafeRun],
        resolutions: [{ itemId: `stalled_run:${runId}` }],
      }),
    ).list();

    expect(queue.degraded).toEqual([]);
  });
});
