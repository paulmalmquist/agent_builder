/* eslint-disable @typescript-eslint/require-await */
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  ApprovalRequestState,
  AuthorityGrantState,
  ContextClassification,
  ExecutionRunState,
  ModelProviderKind,
  Prisma,
  type AuthorityGrant as DatabaseAuthorityGrant,
  type ExecutionRun as DatabaseExecutionRun,
  type PrismaClient,
} from '@prisma/client';
import type { JsonValue } from '@agent-builder/contracts';
import { defaultDailyBriefExecutionContext, type ModelProvider } from '@paul-os/runtime';
import { loadConfig, type AppConfig } from '../src/config.js';
import { requestContextMiddleware } from '../src/request-context.js';
import { ExecutionService } from '../src/services/execution-service.js';

const RELEASE_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_RELEASE_ID = '10000000-0000-4000-8000-000000000002';
const GRANT_ID = '20000000-0000-4000-8000-000000000001';
const RUN_ID = '30000000-0000-4000-8000-000000000001';
const RESOURCE_ID = '40000000-0000-4000-8000-000000000001';
const FAMILY_ID = '50000000-0000-4000-8000-000000000001';
const DIGEST = 'a'.repeat(64);
const CONTEXT_DIGEST = defaultDailyBriefExecutionContext.digest;
const NOW = new Date('2026-08-16T12:00:00.000Z');
const workspaceRoot = process.cwd().endsWith(path.join('apps', 'backend'))
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();
const exampleProfilePath = path.join(workspaceRoot, '00-core', 'profiles', 'paul.example.yaml');

const dailyInput = {
  date: '2026-08-16',
  timezone: 'America/New_York',
  priorities: ['Finish verification'],
  calendarItems: [],
  tasks: ['Run tests'],
  signals: ['Coverage needs attention'],
  userConstraints: [],
} satisfies Record<string, JsonValue>;

const baseConfig = loadConfig({
  NODE_ENV: 'test',
  MODEL_PROVIDER: 'deterministic',
  EXECUTION_DISPATCH_MODE: 'in_process',
  ALLOW_UNVERIFIED_REPOSITORY_IMPORTS: 'true',
});

function config(overrides: Partial<AppConfig> = {}): AppConfig {
  return { ...baseConfig, ...overrides };
}

function modelProvider(kind: ModelProvider['kind'] = 'deterministic'): ModelProvider {
  return {
    kind,
    version: 'test-1.0.0',
    model: `${kind}-test-model`,
    async *stream() {
      // Guard-focused tests do not reach the provider stream.
    },
  };
}

function releaseRecord(
  options: {
    id?: string;
    digest?: string;
    projectId?: string | null;
    slug?: string;
    tools?: string[];
  } = {},
) {
  const id = options.id ?? RELEASE_ID;
  const digest = options.digest ?? DIGEST;
  const projectId = options.projectId === undefined ? 'project-alpha' : options.projectId;
  const slug = options.slug ?? 'daily-brief';
  return {
    id,
    digest,
    projectId,
    createdBy: 'human:test',
    createdAt: NOW,
    resources: [
      {
        releaseId: id,
        resourceVersionId: RESOURCE_ID,
        kind: 'SKILL',
        digest,
        ordinal: 0,
        resourceVersion: {
          id: RESOURCE_ID,
          definition: {
            apiVersion: 'paul-os/v1',
            kind: 'Skill',
            metadata: {
              id: RESOURCE_ID,
              slug,
              version: '1.0.0',
              owner: 'local-user',
              purpose: 'Produce a governed daily briefing from supplied planning inputs.',
              lifecycle: 'candidate',
              provenance: 'synthetic',
            },
            dependencies: [],
            spec: {
              inputSchema: { type: 'object' },
              outputSchema: { type: 'object' },
              tools: options.tools ?? [],
              permissions: [],
              contextRequirements: [],
              successCriteria: ['Return a contract-valid briefing.'],
            },
          },
          family: { id: FAMILY_ID },
        },
      },
    ],
  };
}

function grantRecord(overrides: Partial<DatabaseAuthorityGrant> = {}): DatabaseAuthorityGrant {
  return {
    id: GRANT_ID,
    releaseId: RELEASE_ID,
    releaseDigest: DIGEST,
    contextDigest: CONTEXT_DIGEST,
    projectId: 'project-alpha',
    inputConstraints: {},
    toolScopes: [],
    validFrom: new Date(Date.now() - 60_000),
    validUntil: new Date(Date.now() + 3_600_000),
    maxRuns: 5,
    usedRuns: 0,
    maxEstimatedCostPerRunUsd: new Prisma.Decimal(1),
    totalCostBudgetUsd: new Prisma.Decimal(5),
    spentCostUsd: new Prisma.Decimal(0),
    reservedCostUsd: new Prisma.Decimal(0),
    state: AuthorityGrantState.ACTIVE,
    actorId: 'human:test',
    rationale: 'Allow the synthetic daily briefing fixture.',
    revokedAt: null,
    revokedBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function runRecord(overrides: Partial<DatabaseExecutionRun> = {}): DatabaseExecutionRun {
  return {
    id: RUN_ID,
    releaseId: RELEASE_ID,
    authorityGrantId: GRANT_ID,
    releaseDigest: DIGEST,
    contextDigest: CONTEXT_DIGEST,
    contextProvenance: [{ source: 'core', classification: 'public', tokenContribution: 27 }],
    contextClassification: ContextClassification.PUBLIC,
    contextEstimatedTokens: defaultDailyBriefExecutionContext.estimatedTokens,
    projectId: 'project-alpha',
    requiredToolScopes: [],
    state: ExecutionRunState.QUEUED,
    input: dailyInput,
    providerKind: ModelProviderKind.DETERMINISTIC,
    developmentDraft: false,
    providerVersion: 'test-1.0.0',
    model: 'deterministic-test-model',
    maxInputTokens: 1_000,
    maxOutputTokens: 200,
    maxEstimatedCostUsd: new Prisma.Decimal(1),
    estimatedUpperCostUsd: new Prisma.Decimal('0.006'),
    actualCostUsd: null,
    pricingVersion: 'test-pricing',
    approvalReasons: [],
    progress: 0,
    message: 'Queued',
    idempotencyKey: 'execution-test-key',
    requestedBy: 'human:test',
    attempts: 0,
    maxAttempts: 3,
    leaseOwner: null,
    leaseExpiresAt: null,
    heartbeatAt: null,
    cancelRequestedAt: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

type TransactionOperation = (client: Prisma.TransactionClient) => Promise<unknown>;

function asyncMock(value: unknown) {
  return jest.fn<Promise<unknown>, [unknown?]>(async () => value);
}

function callArgument(mock: ReturnType<typeof asyncMock>, call = 0): Record<string, unknown> {
  const value = mock.mock.calls[call]?.[0];
  if (value === null || typeof value !== 'object') {
    throw new Error(`Expected object argument for mock call ${call}`);
  }
  return value as Record<string, unknown>;
}

function database() {
  const releaseBundle = {
    findUnique: asyncMock(releaseRecord()),
  };
  const productionChannel = {
    findUnique: asyncMock({
      key: 'project-alpha',
      currentReleaseId: RELEASE_ID,
      promotedAt: NOW,
    }),
  };
  const authorityGrant = {
    findUnique: asyncMock(grantRecord()),
    findMany: asyncMock([] as DatabaseAuthorityGrant[]),
    create: asyncMock(grantRecord()),
    update: asyncMock(grantRecord()),
    updateMany: asyncMock({ count: 1 }),
    findUniqueOrThrow: asyncMock(grantRecord()),
  };
  const executionRun = {
    findUnique: asyncMock(null as DatabaseExecutionRun | null),
    findFirst: asyncMock(null as DatabaseExecutionRun | null),
    findMany: asyncMock([] as DatabaseExecutionRun[]),
    create: asyncMock(runRecord()),
    update: asyncMock(runRecord()),
    updateMany: asyncMock({ count: 1 }),
  };
  const approvalRequest = {
    findFirst: asyncMock({ id: 'approved-epoch-request' }),
    upsert: asyncMock({ id: 'approval-id' }),
    update: asyncMock({ id: 'approval-id' }),
    updateMany: asyncMock({ count: 1 }),
  };
  const auditEvent = { create: asyncMock({ id: 'audit-id' }) };
  const outcomeRecord = { findMany: asyncMock([]) };
  const metricSample = { findMany: asyncMock([]) };
  const transaction = {
    $queryRaw: jest.fn(async () => []),
    releaseBundle,
    productionChannel,
    authorityGrant,
    executionRun,
    approvalRequest,
    auditEvent,
    outcomeRecord,
    metricSample,
  };
  const transactionMock = jest.fn((operation: TransactionOperation) =>
    operation(transaction as unknown as Prisma.TransactionClient),
  );
  const prisma = {
    ...transaction,
    $transaction: transactionMock,
  } as unknown as PrismaClient;
  return {
    prisma,
    transactionMock,
    transaction,
    releaseBundle,
    productionChannel,
    authorityGrant,
    executionRun,
    approvalRequest,
    auditEvent,
    outcomeRecord,
    metricSample,
  };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    releaseId: RELEASE_ID,
    authorityGrantId: GRANT_ID,
    input: dailyInput,
    maxInputTokens: 1_000,
    maxOutputTokens: 200,
    maxEstimatedCostUsd: 1,
    idempotencyKey: 'execution-test-key',
    developmentDraft: false,
    ...overrides,
  };
}

function approval(overrides: Record<string, unknown> = {}) {
  return {
    contextDigest: CONTEXT_DIGEST,
    projectId: 'project-alpha',
    inputConstraints: {},
    toolScopes: [],
    validUntil: new Date(Date.now() + 3_600_000).toISOString(),
    maxRuns: 5,
    maxEstimatedCostPerRunUsd: 1,
    totalCostBudgetUsd: 5,
    rationale: 'Approve the synthetic daily briefing run.',
    ...overrides,
  };
}

function runAsHuman<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const middleware = requestContextMiddleware({ enabled: false, actorId: 'human:test' });
    const req = {
      path: '/v1/execution-runs/test',
      header: () => undefined,
      id: 'execution-branch-request',
    } as unknown as Request;
    const response = { setHeader: jest.fn() } as unknown as Response;
    middleware(req, response, (error?: unknown) => {
      if (error !== undefined) {
        reject(error instanceof Error ? error : new Error('Request context failed'));
        return;
      }
      operation().then(resolve, reject);
    });
  });
}

describe('ExecutionService idempotency and run admission', () => {
  it('returns an equivalent idempotent run without reloading its release', async () => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce(runRecord());
    const result = await new ExecutionService(db.prisma, config(), modelProvider()).createRun(
      request(),
    );
    expect(result.id).toBe(RUN_ID);
    expect(db.releaseBundle.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    ['release', { releaseId: OTHER_RELEASE_ID }],
    ['authority grant', { authorityGrantId: null }],
    ['input', { input: { ...dailyInput, priorities: ['Different'] } }],
    ['input tokens', { maxInputTokens: 999 }],
    ['output tokens', { maxOutputTokens: 199 }],
    ['cost ceiling', { maxEstimatedCostUsd: 0.5 }],
    ['development mode', { developmentDraft: true }],
  ])('rejects reuse of an idempotency key with different %s', async (_name, change) => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce(runRecord());
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).createRun(request(change)),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
  });

  it('binds idempotency to the assembled private-context digest', async () => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce(runRecord());
    await expect(
      new ExecutionService(
        db.prisma,
        config({ profilePath: exampleProfilePath }),
        modelProvider(),
      ).createRun(request()),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
    expect(db.releaseBundle.findUnique).not.toHaveBeenCalled();
  });

  it('persists only a digest and sanitized private-context summary', async () => {
    const db = database();
    await new ExecutionService(
      db.prisma,
      config({ profilePath: exampleProfilePath }),
      modelProvider(),
    ).createRun(request());
    const data = callArgument(db.executionRun.create)['data'] as Record<string, unknown>;
    expect(data['contextDigest']).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
    expect(data['contextClassification']).toBe(ContextClassification.PRIVATE);
    expect(data['contextProvenance']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'private_profile', classification: 'private' }),
      ]),
    );
    expect(JSON.stringify(data)).not.toContain('briefingPreferences');
    expect(JSON.stringify(data)).not.toContain('MODEL_PROVIDER_API_KEY');
  });

  it('fails closed when a configured private profile cannot be validated', async () => {
    const db = database();
    await expect(
      new ExecutionService(
        db.prisma,
        config({ profilePath: path.join(workspaceRoot, 'package.json') }),
        modelProvider(),
      ).createRun(request()),
    ).rejects.toMatchObject({ code: 'DEPENDENCY_UNAVAILABLE', status: 503 });
    expect(db.executionRun.findUnique).not.toHaveBeenCalled();
  });

  it('returns a typed not-found error for an unknown release', async () => {
    const db = database();
    db.releaseBundle.findUnique.mockResolvedValueOnce(null);
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).createRun(request()),
    ).rejects.toMatchObject({ code: 'RELEASE_NOT_FOUND', status: 404 });
  });

  it('requires a production channel for a live provider', async () => {
    const db = database();
    db.productionChannel.findUnique.mockResolvedValueOnce(null);
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider('anthropic')).createRun(request()),
    ).rejects.toMatchObject({ code: 'PRODUCTION_RELEASE_REQUIRED' });
  });

  it.each([
    ['an implicit development run', config(), false],
    ['a production development run', config({ environment: 'production' }), true],
  ])('rejects %s off the production channel', async (_name, testConfig, developmentDraft) => {
    const db = database();
    db.productionChannel.findUnique.mockResolvedValueOnce(null);
    await expect(
      new ExecutionService(db.prisma, testConfig, modelProvider()).createRun(
        request({ developmentDraft }),
      ),
    ).rejects.toMatchObject({ code: 'EXPLICIT_DEVELOPMENT_RUN_REQUIRED' });
  });

  it('rejects a release without the supported daily-brief skill', async () => {
    const db = database();
    db.releaseBundle.findUnique.mockResolvedValueOnce(releaseRecord({ slug: 'another-skill' }));
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).createRun(request()),
    ).rejects.toMatchObject({ code: 'EXECUTOR_UNAVAILABLE' });
  });

  it('rejects input whose approximate size exceeds the token budget', async () => {
    const db = database();
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).createRun(
        request({ maxInputTokens: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'INPUT_TOKEN_BUDGET_EXCEEDED' });
  });

  it('creates an approval request when no authority grant is supplied', async () => {
    const db = database();
    db.executionRun.create.mockResolvedValueOnce(
      runRecord({
        authorityGrantId: null,
        state: ExecutionRunState.AWAITING_APPROVAL,
        approvalReasons: ['No authority grant is bound to this release'],
        message: 'Awaiting authority approval',
      }),
    );
    const result = await new ExecutionService(db.prisma, config(), modelProvider()).createRun(
      request({ authorityGrantId: null }),
    );
    expect(result.state).toBe('awaiting_approval');
    expect(callArgument(db.executionRun.create)).toMatchObject({
      data: { approvalRequest: { create: { requestedBy: 'system:background' } } },
    });
  });

  it('requires a human-approved first run for each production release epoch', async () => {
    const db = database();
    db.approvalRequest.findFirst.mockResolvedValueOnce(null);
    db.executionRun.create.mockResolvedValueOnce(
      runRecord({
        authorityGrantId: null,
        state: ExecutionRunState.AWAITING_APPROVAL,
        approvalReasons: ['First run of this production release epoch requires human approval'],
        message: 'Awaiting authority approval',
      }),
    );

    const result = await new ExecutionService(db.prisma, config(), modelProvider()).createRun(
      request(),
    );

    expect(result.state).toBe('awaiting_approval');
    expect(callArgument(db.approvalRequest.findFirst)).toMatchObject({
      where: {
        state: ApprovalRequestState.APPROVED,
        decidedAt: { gte: NOW },
        decidedBy: { not: null },
        run: {
          is: { releaseId: RELEASE_ID, releaseDigest: DIGEST, developmentDraft: false },
        },
      },
    });
    expect(callArgument(db.executionRun.create)).toMatchObject({
      data: {
        authorityGrantId: null,
        state: ExecutionRunState.AWAITING_APPROVAL,
        approvalReasons: expect.arrayContaining([
          'First run of this production release epoch requires human approval',
        ]),
      },
    });
  });

  it('queues later envelope-matching runs after approval in the current release epoch', async () => {
    const db = database();
    const result = await new ExecutionService(db.prisma, config(), modelProvider()).createRun(
      request(),
    );

    expect(result.state).toBe('queued');
    expect(db.approvalRequest.findFirst).toHaveBeenCalledTimes(1);
    expect(callArgument(db.executionRun.create)).toMatchObject({
      data: {
        authorityGrantId: GRANT_ID,
        state: ExecutionRunState.QUEUED,
      },
    });
  });

  it('keeps local deterministic development drafts outside the production epoch gate', async () => {
    const db = database();
    const result = await new ExecutionService(db.prisma, config(), modelProvider()).createRun(
      request({ developmentDraft: true }),
    );

    expect(result.state).toBe('queued');
    expect(db.approvalRequest.findFirst).not.toHaveBeenCalled();
  });

  it('pauses a run whose estimate exceeds its own cost ceiling', async () => {
    const db = database();
    db.executionRun.create.mockResolvedValueOnce(
      runRecord({
        authorityGrantId: null,
        state: ExecutionRunState.PAUSED_BUDGET,
        approvalReasons: ['Estimated upper cost exceeds the run cost ceiling'],
        message: 'Paused by run cost budget',
      }),
    );
    const result = await new ExecutionService(db.prisma, config(), modelProvider()).createRun(
      request({ maxEstimatedCostUsd: 0.001 }),
    );
    expect(result.state).toBe('paused_budget');
    expect(callArgument(db.executionRun.create)).toMatchObject({
      data: { state: ExecutionRunState.PAUSED_BUDGET, authorityGrantId: null },
    });
  });

  it('queues a run covered by nested and enumerated input constraints', async () => {
    const db = database();
    db.releaseBundle.findUnique.mockResolvedValueOnce(releaseRecord({ tools: ['calendar.read'] }));
    db.authorityGrant.findUnique.mockResolvedValueOnce(
      grantRecord({
        inputConstraints: {
          timezone: ['UTC', 'America/New_York'],
          preferences: { format: 'concise' },
        },
        toolScopes: ['calendar.read'],
      }),
    );
    const constrainedInput = { ...dailyInput, preferences: { format: 'concise' } };
    const result = await new ExecutionService(db.prisma, config(), modelProvider()).createRun(
      request({ input: constrainedInput }),
    );
    expect(result.state).toBe('queued');
  });

  it('reports all material authority-envelope blockers without reserving budget', async () => {
    const db = database();
    db.releaseBundle.findUnique.mockResolvedValueOnce(releaseRecord({ tools: ['calendar.read'] }));
    db.authorityGrant.findUnique.mockResolvedValueOnce(
      grantRecord({
        state: AuthorityGrantState.REVOKED,
        releaseId: OTHER_RELEASE_ID,
        releaseDigest: 'b'.repeat(64),
        projectId: 'wrong-project',
        validFrom: new Date(Date.now() + 60_000),
        usedRuns: 5,
        maxRuns: 5,
        maxEstimatedCostPerRunUsd: new Prisma.Decimal('0.001'),
        totalCostBudgetUsd: new Prisma.Decimal('0.005'),
        spentCostUsd: new Prisma.Decimal('0.005'),
        inputConstraints: { timezone: 'UTC', preferences: { format: 'detailed' } },
        toolScopes: [],
      }),
    );
    db.executionRun.create.mockResolvedValueOnce(
      runRecord({
        authorityGrantId: null,
        state: ExecutionRunState.AWAITING_APPROVAL,
        approvalReasons: ['Authority grant is revoked'],
        message: 'Awaiting authority approval',
      }),
    );
    await new ExecutionService(db.prisma, config(), modelProvider()).createRun(request());
    const data = callArgument(db.executionRun.create)['data'] as Record<string, unknown>;
    expect(data['approvalReasons']).toEqual(
      expect.arrayContaining([
        'Authority grant is revoked',
        'Authority grant release digest does not match',
        'Authority grant project does not match',
        'Authority grant is outside its validity window',
        'Authority grant run budget is exhausted',
        'Run exceeds the authority per-run cost ceiling',
        'Run exceeds the authority total cost budget',
        'Run input is outside the authority constraints',
        'Run requires a tool scope not present in the authority grant',
      ]),
    );
    expect(db.authorityGrant.update).not.toHaveBeenCalled();
  });
});

describe('ExecutionService authority and read operations', () => {
  it('lists grants with and without a state filter and expires stale active grants first', async () => {
    const db = database();
    db.authorityGrant.findMany.mockResolvedValue([
      grantRecord({ state: AuthorityGrantState.REVOKED, revokedAt: NOW }),
    ]);
    const service = new ExecutionService(db.prisma, config(), modelProvider());
    expect((await service.listGrants({ limit: 10 })).items[0]?.revokedAt).toBe(NOW.toISOString());
    await service.listGrants({ state: 'revoked', limit: 2 });
    expect(callArgument(db.authorityGrant.findMany)['where']).toEqual({});
    expect(callArgument(db.authorityGrant.findMany, 1)['where']).toEqual({
      state: AuthorityGrantState.REVOKED,
    });
    expect(db.authorityGrant.updateMany).toHaveBeenCalledTimes(2);
  });

  it('rejects a grant for the wrong project and an already-expired grant', async () => {
    const serviceDb = database();
    const service = new ExecutionService(serviceDb.prisma, config(), modelProvider());
    await expect(
      runAsHuman(() =>
        service.createGrant({ ...approval(), releaseId: RELEASE_ID, projectId: null }),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORITY_PROJECT_MISMATCH' });
    await expect(
      runAsHuman(() =>
        service.createGrant({
          ...approval({ validUntil: new Date(Date.now() - 1_000).toISOString() }),
          releaseId: RELEASE_ID,
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('creates a contract-valid grant with the current human actor', async () => {
    const db = database();
    const result = await runAsHuman(() =>
      new ExecutionService(db.prisma, config(), modelProvider()).createGrant({
        ...approval(),
        releaseId: RELEASE_ID,
      }),
    );
    expect(result.actorId).toBe('human:test');
    expect(callArgument(db.authorityGrant.create)).toMatchObject({
      data: { actorId: 'human:test', releaseDigest: DIGEST },
    });
  });

  it('rejects an unknown grant and treats repeated revocation as idempotent', async () => {
    const missingDb = database();
    missingDb.authorityGrant.findUnique.mockResolvedValueOnce(null);
    await expect(
      runAsHuman(() =>
        new ExecutionService(missingDb.prisma, config(), modelProvider()).revokeGrant(GRANT_ID),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORITY_GRANT_NOT_FOUND' });

    const revokedDb = database();
    revokedDb.authorityGrant.findUnique.mockResolvedValueOnce(
      grantRecord({ state: AuthorityGrantState.REVOKED, revokedAt: NOW }),
    );
    const result = await runAsHuman(() =>
      new ExecutionService(revokedDb.prisma, config(), modelProvider()).revokeGrant(GRANT_ID),
    );
    expect(result.state).toBe('revoked');
    expect(revokedDb.authorityGrant.update).not.toHaveBeenCalled();
  });

  it('retries a serializable revoke conflict reported through a raw Prisma query', async () => {
    const db = database();
    db.authorityGrant.findUniqueOrThrow.mockResolvedValueOnce(
      grantRecord({ state: AuthorityGrantState.REVOKED, revokedAt: NOW }),
    );
    db.transactionMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('could not serialize access', {
        code: 'P2010',
        clientVersion: '6.6.0',
        meta: { code: '40001', message: 'could not serialize access due to concurrent update' },
      }),
    );

    const result = await runAsHuman(() =>
      new ExecutionService(db.prisma, config(), modelProvider()).revokeGrant(GRANT_ID),
    );

    expect(result.state).toBe('revoked');
    expect(db.transactionMock).toHaveBeenCalledTimes(2);
  });

  it('atomically pauses queued runs and requests observed-cost cancellation for running runs', async () => {
    const db = database();
    db.executionRun.findMany
      .mockResolvedValueOnce([runRecord({ id: RUN_ID, state: ExecutionRunState.QUEUED })])
      .mockResolvedValueOnce([
        runRecord({ id: OTHER_RELEASE_ID, state: ExecutionRunState.RUNNING, attempts: 1 }),
      ]);
    db.authorityGrant.findUniqueOrThrow.mockResolvedValueOnce(
      grantRecord({ state: AuthorityGrantState.REVOKED, revokedAt: NOW }),
    );
    const result = await runAsHuman(() =>
      new ExecutionService(db.prisma, config(), modelProvider()).revokeGrant(GRANT_ID),
    );
    expect(result.state).toBe('revoked');
    expect(db.transaction.$queryRaw).toHaveBeenCalledTimes(2);
    const rawCalls = db.transaction.$queryRaw.mock.calls as unknown as Array<[unknown]>;
    const lockSql = rawCalls.map(([value]) => {
      if (Array.isArray(value)) return value.join('?');
      const query = value as { strings?: readonly string[] };
      return query.strings?.join('?') ?? '';
    });
    expect(lockSql[0]).toContain('FROM "ExecutionRun"');
    expect(lockSql[0]).toContain('ORDER BY "id" ASC');
    expect(lockSql[1]).toContain('FROM "AuthorityGrant"');
    expect(db.executionRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: RUN_ID,
          authorityGrantId: GRANT_ID,
          state: ExecutionRunState.QUEUED,
        }),
      }),
    );
    expect(db.executionRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: OTHER_RELEASE_ID,
          authorityGrantId: GRANT_ID,
          state: ExecutionRunState.RUNNING,
        }),
        data: expect.objectContaining({
          cancelRequestedAt: expect.any(Date),
          message: 'Authority revoked; cancellation requested',
        }),
      }),
    );
    const runningMutation = callArgument(db.executionRun.updateMany, 1)['data'] as Record<
      string,
      unknown
    >;
    expect(runningMutation).not.toHaveProperty('state');
    expect(runningMutation).not.toHaveProperty('authorityGrantId');
    expect(runningMutation).not.toHaveProperty('leaseOwner');
    expect(db.authorityGrant.update).not.toHaveBeenCalled();
    expect(db.approvalRequest.upsert).toHaveBeenCalledTimes(1);
    expect(db.authorityGrant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: GRANT_ID, state: { not: AuthorityGrantState.REVOKED } },
      }),
    );
  });

  it('lists and retrieves mapped runs, including terminal optional fields', async () => {
    const db = database();
    const terminal = runRecord({
      state: ExecutionRunState.FAILED,
      actualCostUsd: new Prisma.Decimal('0.002'),
      error: { code: 'FIXTURE_FAILURE' },
      startedAt: NOW,
      finishedAt: NOW,
    });
    db.executionRun.findMany.mockResolvedValue([terminal]);
    db.executionRun.findUnique.mockResolvedValue(terminal);
    const service = new ExecutionService(db.prisma, config(), modelProvider());
    expect((await service.listRuns({ limit: 5 })).items[0]).toMatchObject({
      state: 'failed',
      actualCostUsd: 0.002,
      error: { code: 'FIXTURE_FAILURE' },
    });
    await service.listRuns({ state: 'failed', limit: 1 });
    expect(callArgument(db.executionRun.findMany, 1)['where']).toEqual({
      state: ExecutionRunState.FAILED,
    });
    expect((await service.getRun(RUN_ID)).finishedAt).toBe(NOW.toISOString());
  });

  it('returns a typed not-found error for an unknown run', async () => {
    const db = database();
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).getRun(RUN_ID),
    ).rejects.toMatchObject({ code: 'EXECUTION_RUN_NOT_FOUND' });
  });

  it.each([ExecutionRunState.SUCCEEDED, ExecutionRunState.FAILED, ExecutionRunState.CANCELLED])(
    'does not cancel a terminal %s run',
    async (state) => {
      const db = database();
      db.executionRun.findUnique.mockResolvedValueOnce(runRecord({ state }));
      await expect(
        new ExecutionService(db.prisma, config(), modelProvider()).cancelRun(RUN_ID),
      ).rejects.toMatchObject({ code: 'RUN_TERMINAL' });
    },
  );

  it('rejects cancellation of an unknown run', async () => {
    const db = database();
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).cancelRun(RUN_ID),
    ).rejects.toMatchObject({ code: 'EXECUTION_RUN_NOT_FOUND' });
  });

  it('cancels a waiting run immediately and cancels its pending approval', async () => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce(
      runRecord({ state: ExecutionRunState.AWAITING_APPROVAL, authorityGrantId: null }),
    );
    db.executionRun.update.mockResolvedValueOnce(
      runRecord({ state: ExecutionRunState.CANCELLED, authorityGrantId: null, finishedAt: NOW }),
    );
    const result = await new ExecutionService(db.prisma, config(), modelProvider()).cancelRun(
      RUN_ID,
    );
    expect(result.state).toBe('cancelled');
    expect(db.approvalRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: ApprovalRequestState.CANCELLED }),
      }),
    );
  });

  it('requests cancellation without prematurely finalizing a running run', async () => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce(
      runRecord({ state: ExecutionRunState.RUNNING, leaseOwner: 'worker-1' }),
    );
    db.executionRun.update.mockResolvedValueOnce(
      runRecord({
        state: ExecutionRunState.RUNNING,
        leaseOwner: 'worker-1',
        cancelRequestedAt: NOW,
        message: 'Cancellation requested',
      }),
    );
    const result = await new ExecutionService(db.prisma, config(), modelProvider()).cancelRun(
      RUN_ID,
    );
    expect(result.state).toBe('running');
    expect(db.approvalRequest.updateMany).not.toHaveBeenCalled();
  });
});

describe('ExecutionService approval, recovery, and worker guards', () => {
  it('rejects expired approval, missing runs, wrong state, and changed releases', async () => {
    const serviceDb = database();
    const service = new ExecutionService(serviceDb.prisma, config(), modelProvider());
    await expect(
      runAsHuman(() =>
        service.approveRun(
          RUN_ID,
          approval({ validUntil: new Date(Date.now() - 1_000).toISOString() }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(runAsHuman(() => service.approveRun(RUN_ID, approval()))).rejects.toMatchObject({
      code: 'EXECUTION_RUN_NOT_FOUND',
    });

    serviceDb.executionRun.findUnique.mockResolvedValueOnce(
      runRecord({ state: ExecutionRunState.QUEUED }),
    );
    await expect(runAsHuman(() => service.approveRun(RUN_ID, approval()))).rejects.toMatchObject({
      code: 'RUN_NOT_AWAITING_APPROVAL',
    });

    serviceDb.executionRun.findUnique.mockResolvedValueOnce(
      runRecord({ state: ExecutionRunState.AWAITING_APPROVAL, authorityGrantId: null }),
    );
    serviceDb.releaseBundle.findUnique.mockResolvedValueOnce(null);
    await expect(runAsHuman(() => service.approveRun(RUN_ID, approval()))).rejects.toMatchObject({
      code: 'RELEASE_CHANGED',
    });
  });

  it('rejects an approval envelope that does not cover the exact run', async () => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce(
      runRecord({ state: ExecutionRunState.AWAITING_APPROVAL, authorityGrantId: null }),
    );
    db.authorityGrant.create.mockResolvedValueOnce(
      grantRecord({ projectId: 'wrong-project', toolScopes: [] }),
    );
    await expect(
      runAsHuman(() =>
        new ExecutionService(db.prisma, config(), modelProvider()).approveRun(
          RUN_ID,
          approval({ projectId: 'wrong-project' }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'AUTHORITY_ENVELOPE_INSUFFICIENT' });
  });

  it('approves a covered run and creates an immutable authority envelope', async () => {
    const db = database();
    const waiting = runRecord({
      state: ExecutionRunState.AWAITING_APPROVAL,
      authorityGrantId: null,
    });
    db.executionRun.findUnique.mockResolvedValueOnce(waiting);
    db.executionRun.update.mockResolvedValueOnce(
      runRecord({ state: ExecutionRunState.QUEUED, authorityGrantId: GRANT_ID }),
    );
    const result = await runAsHuman(() =>
      new ExecutionService(db.prisma, config(), modelProvider()).approveRun(RUN_ID, approval()),
    );
    expect(result.run.state).toBe('queued');
    expect(result.grant.id).toBe(GRANT_ID);
    expect(db.approvalRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: ApprovalRequestState.APPROVED }),
      }),
    );
  });

  it.each([
    ['missing', null],
    ['not running', runRecord({ state: ExecutionRunState.QUEUED })],
    ['no lease', runRecord({ state: ExecutionRunState.RUNNING, leaseExpiresAt: null })],
    [
      'renewed lease',
      runRecord({
        state: ExecutionRunState.RUNNING,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      }),
    ],
  ])('leaves a stale recovery candidate untouched when it is %s', async (_name, candidate) => {
    const db = database();
    db.executionRun.findMany.mockResolvedValueOnce([runRecord({ id: RUN_ID })]);
    db.executionRun.findUnique.mockResolvedValueOnce(candidate);
    expect(
      await new ExecutionService(db.prisma, config(), modelProvider()).recoverExpiredLeases(),
    ).toBe(1);
    expect(db.executionRun.update).not.toHaveBeenCalled();
  });

  it.each([
    [
      'cancelled',
      runRecord({
        state: ExecutionRunState.RUNNING,
        authorityGrantId: null,
        leaseExpiresAt: new Date(Date.now() - 60_000),
        cancelRequestedAt: NOW,
      }),
      ExecutionRunState.CANCELLED,
    ],
    [
      'exhausted',
      runRecord({
        state: ExecutionRunState.RUNNING,
        authorityGrantId: null,
        leaseExpiresAt: new Date(Date.now() - 60_000),
        attempts: 3,
        maxAttempts: 3,
      }),
      ExecutionRunState.FAILED,
    ],
    [
      'retryable',
      runRecord({
        state: ExecutionRunState.RUNNING,
        authorityGrantId: null,
        leaseExpiresAt: new Date(Date.now() - 60_000),
        attempts: 1,
      }),
      ExecutionRunState.QUEUED,
    ],
  ])('recovers an expired %s worker lease safely', async (_name, candidate, expectedState) => {
    const db = database();
    db.executionRun.findMany.mockResolvedValueOnce([candidate]);
    db.executionRun.findUnique.mockResolvedValueOnce(candidate);
    await new ExecutionService(db.prisma, config(), modelProvider()).recoverExpiredLeases();
    expect(db.executionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: expectedState }) }),
    );
  });

  it('lists queued work and reports heartbeat ownership success or loss', async () => {
    const db = database();
    db.executionRun.findMany.mockResolvedValueOnce([
      runRecord({ id: RUN_ID }),
      runRecord({ id: OTHER_RELEASE_ID }),
    ]);
    const service = new ExecutionService(db.prisma, config(), modelProvider());
    expect(await service.queuedRunIds(2)).toEqual([RUN_ID, OTHER_RELEASE_ID]);
    db.executionRun.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await expect(service.heartbeat(RUN_ID, 'worker-1', 5_000)).resolves.toBe(true);
    await expect(service.heartbeat(RUN_ID, 'worker-2')).resolves.toBe(false);
  });

  it.each([
    ['missing', null],
    [
      'not queued',
      { ...runRecord({ state: ExecutionRunState.RUNNING }), release: releaseRecord() },
    ],
    ['without authority', { ...runRecord({ authorityGrantId: null }), release: releaseRecord() }],
  ])('does not claim a run that is %s', async (_name, candidate) => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce(candidate);
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).claim(RUN_ID, 'worker-1'),
    ).resolves.toBe(false);
  });

  it('moves a claim back to approval when its grant disappears', async () => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce({
      ...runRecord(),
      release: releaseRecord(),
    });
    db.authorityGrant.findUnique.mockResolvedValueOnce(null);
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).claim(RUN_ID, 'worker-1'),
    ).resolves.toBe(false);
    expect(db.executionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: ExecutionRunState.AWAITING_APPROVAL }),
      }),
    );
    expect(db.approvalRequest.upsert).toHaveBeenCalled();
  });

  it('moves a queued production run back to approval when its release epoch changed', async () => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce({
      ...runRecord(),
      release: releaseRecord(),
    });
    db.approvalRequest.findFirst.mockResolvedValueOnce(null);

    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).claim(RUN_ID, 'worker-1'),
    ).resolves.toBe(false);

    expect(db.executionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: ExecutionRunState.AWAITING_APPROVAL,
          authorityGrantId: null,
          approvalReasons: expect.arrayContaining([
            'First run of this production release epoch requires human approval',
          ]),
        }),
      }),
    );
    expect(db.authorityGrant.update).not.toHaveBeenCalled();
  });

  it('reserves run and cost budgets atomically when a first attempt is claimed', async () => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce({
      ...runRecord(),
      release: releaseRecord(),
    });
    const claimed = await new ExecutionService(db.prisma, config(), modelProvider()).claim(
      RUN_ID,
      'worker-1',
      5_000,
    );
    expect(claimed).toBe(true);
    expect(db.authorityGrant.update).toHaveBeenCalledWith({
      where: { id: GRANT_ID },
      data: { usedRuns: 1, reservedCostUsd: 0.006 },
    });
  });

  it('allows an exhausted grant to finish a retry without consuming a second run', async () => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce({
      ...runRecord({ attempts: 1 }),
      release: releaseRecord(),
    });
    db.authorityGrant.findUnique.mockResolvedValueOnce(
      grantRecord({
        state: AuthorityGrantState.EXHAUSTED,
        maxRuns: 1,
        usedRuns: 1,
        totalCostBudgetUsd: new Prisma.Decimal(5),
      }),
    );
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).claim(RUN_ID, 'worker-1'),
    ).resolves.toBe(true);
    const updateData = callArgument(db.authorityGrant.update)['data'] as Record<string, unknown>;
    expect(updateData['usedRuns']).toBe(1);
  });

  it('returns false if the queue CAS loses after the budget reservation', async () => {
    const db = database();
    db.executionRun.findUnique.mockResolvedValueOnce({
      ...runRecord(),
      release: releaseRecord(),
    });
    db.executionRun.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      new ExecutionService(db.prisma, config(), modelProvider()).claim(RUN_ID, 'worker-1'),
    ).resolves.toBe(false);
  });

  it('short-circuits claimed execution for lost work, cancellation, and missing authority', async () => {
    const missingDb = database();
    await new ExecutionService(missingDb.prisma, config(), modelProvider()).executeClaimed(
      RUN_ID,
      'worker-1',
    );
    expect(missingDb.executionRun.update).not.toHaveBeenCalled();

    const cancelledDb = database();
    cancelledDb.executionRun.findFirst.mockResolvedValueOnce(
      runRecord({
        state: ExecutionRunState.RUNNING,
        authorityGrantId: null,
        leaseOwner: 'worker-1',
        cancelRequestedAt: NOW,
        attempts: 1,
      }),
    );
    await new ExecutionService(cancelledDb.prisma, config(), modelProvider()).executeClaimed(
      RUN_ID,
      'worker-1',
    );
    expect(cancelledDb.executionRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: ExecutionRunState.CANCELLED }),
      }),
    );

    const unboundDb = database();
    unboundDb.executionRun.findFirst.mockResolvedValueOnce(
      runRecord({
        state: ExecutionRunState.RUNNING,
        authorityGrantId: null,
        leaseOwner: 'worker-1',
        attempts: 1,
      }),
    );
    await new ExecutionService(unboundDb.prisma, config(), modelProvider()).executeClaimed(
      RUN_ID,
      'worker-1',
    );
    expect(unboundDb.approvalRequest.upsert).toHaveBeenCalled();
  });

  it.each([
    ['failed', null, ExecutionRunState.FAILED, 'execution.failed'],
    ['cancelled', NOW, ExecutionRunState.CANCELLED, 'execution.cancelled'],
  ])(
    'finalizes a claimed run as %s and records the matching audit event',
    async (_name, cancelRequestedAt, expectedState, action) => {
      const db = database();
      db.executionRun.findFirst.mockResolvedValueOnce(
        runRecord({
          state: ExecutionRunState.RUNNING,
          authorityGrantId: null,
          leaseOwner: 'worker-1',
          cancelRequestedAt,
        }),
      );
      await new ExecutionService(db.prisma, config(), modelProvider()).failClaimed(
        RUN_ID,
        'worker-1',
        'FIXTURE_FAILURE',
      );
      expect(db.executionRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ state: expectedState }) }),
      );
      expect(db.auditEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action }) }),
      );
    },
  );

  it('ignores failClaimed when the worker no longer owns the run', async () => {
    const db = database();
    await new ExecutionService(db.prisma, config(), modelProvider()).failClaimed(
      RUN_ID,
      'worker-1',
      'FIXTURE_FAILURE',
    );
    expect(db.executionRun.update).not.toHaveBeenCalled();
  });
});

describe('ExecutionService evidence collection reads', () => {
  it('maps filtered and unfiltered outcomes and metrics including nullable fields', async () => {
    const db = database();
    db.outcomeRecord.findMany.mockResolvedValue([
      {
        id: '60000000-0000-4000-8000-000000000001',
        runId: RUN_ID,
        output: { topPriorities: ['Finish verification'] },
        confidence: null,
        citations: [],
        unresolvedItems: [],
        qualityScore: null,
        createdAt: NOW,
      },
    ]);
    db.metricSample.findMany.mockResolvedValue([
      {
        id: '70000000-0000-4000-8000-000000000001',
        runId: null,
        name: 'platform.health',
        value: 1,
        unit: 'ratio',
        metadata: {},
        observedAt: NOW,
      },
    ]);
    const service = new ExecutionService(db.prisma, config(), modelProvider());
    expect((await service.listOutcomes()).items[0]?.confidence).toBeNull();
    await service.listOutcomes(RUN_ID);
    expect(callArgument(db.outcomeRecord.findMany, 1)['where']).toEqual({ runId: RUN_ID });
    expect((await service.listMetrics()).items[0]?.runId).toBeNull();
    await service.listMetrics(RUN_ID);
    expect(callArgument(db.metricSample.findMany, 1)['where']).toEqual({ runId: RUN_ID });
  });
});
