/* eslint-disable @typescript-eslint/require-await */
import { createHash, randomUUID } from 'node:crypto';
import { pino } from 'pino';
import {
  AuthorityGrantState,
  ContextClassification,
  ExecutionRunState,
  ModelProviderKind,
  PluginEffect,
  PluginHealthStatus,
  PluginInstallationState,
  PluginResidency,
  PluginTransport,
  PrismaClient,
  ResourceKind,
  ResourceLifecycle,
} from '@prisma/client';
import {
  defaultDailyBriefExecutionContext,
  DeterministicDailyBriefProvider,
  PluginTransportRegistry,
  type ModelRequest,
  type ModelStreamEvent,
  type PluginCallRequest,
  type PluginTransportAdapter,
} from '@paul-os/runtime';
import type { WorkerConfig } from '../src/config.js';
import { WorkerDaemon } from '../src/daemon.js';
import { ExecutionEngine } from '../src/engine.js';
import { WorkerPluginExecutor, type WorkerPluginCall } from '../src/plugin-execution.js';
import { WorkerPluginPlanCoordinator } from '../src/plugin-plan.js';
import { PrismaWorkerPluginExecutionStore } from '../src/plugin-store.js';
import { PrismaWorkerStore } from '../src/store.js';

const databaseEnabled = process.env['RUN_DATABASE_INTEGRATION'] === 'true';
const describeDatabase = databaseEnabled ? describe : describe.skip;
const prisma = new PrismaClient();

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface PluginFixture {
  call: WorkerPluginCall;
  installationId: string;
  runId: string;
}

async function pluginFixture(options: { daemon?: boolean } = {}): Promise<PluginFixture> {
  const suffix = randomUUID();
  const workspaceId = randomUUID();
  const departmentId = randomUUID();
  await prisma.workspace.create({
    data: { id: workspaceId, slug: `plugin-worker-${suffix}`, name: 'Plugin Worker Test' },
  });
  await prisma.department.create({
    data: {
      id: departmentId,
      workspaceId,
      slug: 'engineering',
      name: 'Engineering',
    },
  });
  const [entryFamily, pluginFamily] = await Promise.all([
    prisma.resourceFamily.create({
      data: {
        workspaceId,
        departmentId,
        kind: ResourceKind.SKILL,
        slug: `plugin-entry-${suffix}`,
        name: 'Synthetic Plugin Entrypoint',
        createdBy: 'plugin-worker-test',
        updatedBy: 'plugin-worker-test',
      },
    }),
    prisma.resourceFamily.create({
      data: {
        workspaceId,
        departmentId,
        kind: ResourceKind.PLUGIN,
        slug: `synthetic-http-${suffix}`,
        name: 'Synthetic HTTP Plugin',
        createdBy: 'plugin-worker-test',
        updatedBy: 'plugin-worker-test',
      },
    }),
  ]);
  const entryDigest = digest(`entry:${suffix}`);
  const pluginDigest = digest(`plugin:${suffix}`);
  const version = '1.0.0';
  const entryDefinition = {
    apiVersion: 'paul-os/v1',
    kind: 'Skill',
    metadata: {
      id: entryFamily.id,
      slug: 'daily-brief',
      version,
      name: entryFamily.name,
      owner: 'plugin-worker-test',
      purpose: 'Exercise exact Plugin dependency authorization in a synthetic worker run.',
      lifecycle: 'candidate',
      provenance: 'plugin-store-integration',
    },
    dependencies: [{ familyId: pluginFamily.id, version }],
    spec: {
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      tools: [{ plugin: { familyId: pluginFamily.id, version }, tool: 'lookup' }],
      permissions: [],
      contextRequirements: [],
      successCriteria: ['Return a schema-valid daily brief with governed Plugin context.'],
    },
  };
  const pluginDefinition = {
    apiVersion: 'paul-os/v1',
    kind: 'Plugin',
    metadata: {
      id: pluginFamily.id,
      slug: pluginFamily.slug,
      version,
      name: pluginFamily.name,
      owner: 'plugin-worker-test',
      purpose: 'Expose one read-only synthetic lookup for Plugin worker integration tests.',
      lifecycle: 'candidate',
      provenance: 'plugin-store-integration',
    },
    dependencies: [],
    spec: {
      transport: 'http',
      executionPlacement: 'control_plane',
      classification: 'internal',
      secretSlots: [],
      connection: {
        baseUrl: 'https://api.example.com/',
        allowedHosts: ['api.example.com'],
        defaultHeaders: {},
      },
      health: {
        kind: 'http',
        intervalSeconds: 300,
        timeoutMs: 1_000,
        method: 'GET',
        path: '/health',
        expectedStatuses: [200],
      },
      capabilities: [
        {
          tool: 'lookup',
          description: 'Look up one read-only synthetic record.',
          effect: 'read',
          approval: 'not_required',
          scopeDescription: 'Read one synthetic record without writing external state.',
          inputSchema: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              startsAt: { type: 'string' },
              endsAt: { type: 'string' },
            },
            additionalProperties: false,
          },
          outputSchema: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
          limits: {
            timeoutMs: 1_000,
            maxResponseBytes: 1_000,
            maxRecords: 1,
            maxInvocationsPerRun: 1,
            maxEstimatedCostUsd: 0.01,
          },
          invocation: { method: 'GET', path: '/lookup', headers: {} },
        },
      ],
    },
  };
  const [entryVersion, pluginVersion] = await Promise.all([
    prisma.resourceVersion.create({
      data: {
        familyId: entryFamily.id,
        version,
        lifecycle: ResourceLifecycle.CANDIDATE,
        owner: 'plugin-worker-test',
        purpose: entryDefinition.metadata.purpose,
        definition: entryDefinition,
        digest: entryDigest,
        sourceCommit: 'plugin-store-integration',
        provenance: { source: 'plugin-store-integration' },
        dependencyPins: [],
        frozenAt: new Date(),
        createdBy: 'plugin-worker-test',
        updatedBy: 'plugin-worker-test',
      },
    }),
    prisma.resourceVersion.create({
      data: {
        familyId: pluginFamily.id,
        version,
        lifecycle: ResourceLifecycle.CANDIDATE,
        owner: 'plugin-worker-test',
        purpose: pluginDefinition.metadata.purpose,
        definition: pluginDefinition,
        digest: pluginDigest,
        sourceCommit: 'plugin-store-integration',
        provenance: { source: 'plugin-store-integration' },
        dependencyPins: [],
        frozenAt: new Date(),
        createdBy: 'plugin-worker-test',
        updatedBy: 'plugin-worker-test',
      },
    }),
  ]);
  await prisma.resourceDependencyPin.create({
    data: {
      sourceVersionId: entryVersion.id,
      targetVersionId: pluginVersion.id,
      targetDigest: pluginDigest,
    },
  });
  const release = await prisma.releaseBundle.create({
    data: {
      workspaceId,
      departmentId,
      digest: digest(`release:${suffix}`),
      createdBy: 'plugin-worker-test',
      resources: {
        create: [
          {
            resourceVersionId: entryVersion.id,
            kind: ResourceKind.SKILL,
            digest: entryDigest,
            ordinal: 0,
          },
          {
            resourceVersionId: pluginVersion.id,
            kind: ResourceKind.PLUGIN,
            digest: pluginDigest,
            ordinal: 1,
          },
        ],
      },
    },
  });
  let installation = await prisma.pluginInstallation.create({
    data: {
      workspaceId,
      departmentId,
      pluginVersionId: pluginVersion.id,
      pluginDigest,
      transport: PluginTransport.HTTP,
      residency: PluginResidency.CONTROL_PLANE,
      state: PluginInstallationState.INSTALLED,
      developmentOnly: true,
      configurationDigest: digest(`configuration:${suffix}`),
      installedBy: 'plugin-worker-test',
      updatedBy: 'plugin-worker-test',
    },
  });
  await prisma.pluginHealthCheck.create({
    data: {
      installationId: installation.id,
      status: PluginHealthStatus.HEALTHY,
      probe: 'synthetic-http-health',
      latencyMs: 1,
      summary: 'The synthetic control-plane Plugin probe passed.',
      checkedBy: 'plugin-worker-test',
    },
  });
  installation = await prisma.pluginInstallation.update({
    where: { id: installation.id },
    data: {
      state: PluginInstallationState.ENABLED,
      enableRequestedAt: new Date(),
      enableRequestedBy: 'plugin-worker-test',
      updatedBy: 'plugin-worker-test',
    },
  });
  const requirementScope = {
    installationId: installation.id,
    pluginVersionId: pluginVersion.id,
    pluginDigest,
    tool: 'lookup',
    effect: 'read',
    scopeDescription: 'Read one synthetic record without writing external state.',
    limits: {
      timeoutMs: 1_000,
      maxResponseBytes: 1_000,
      maxRecords: 1,
      maxInvocationsPerRun: 1,
      maxEstimatedCostUsd: 0.01,
    },
  } as const;
  const grantScope = {
    ...requirementScope,
    limits: { ...requirementScope.limits, timeoutMs: 500, maxResponseBytes: 500 },
  };
  const runContextDigest = options.daemon
    ? defaultDailyBriefExecutionContext.digest
    : digest(`context:${suffix}`);
  const grant = await prisma.authorityGrant.create({
    data: {
      workspaceId,
      departmentId,
      releaseId: release.id,
      entryResourceVersionId: entryVersion.id,
      releaseDigest: release.digest,
      contextDigest: runContextDigest,
      inputConstraints: {},
      toolScopes: [],
      pluginScopes: [grantScope],
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 60_000),
      maxRuns: 10,
      maxEstimatedCostPerRunUsd: 1,
      totalCostBudgetUsd: 10,
      state: AuthorityGrantState.ACTIVE,
      actorId: 'plugin-worker-test',
      rationale: 'Allow the exact synthetic Plugin read during this integration test.',
    },
  });
  const run = await prisma.executionRun.create({
    data: {
      workspaceId,
      departmentId,
      releaseId: release.id,
      entryResourceVersionId: entryVersion.id,
      authorityGrantId: grant.id,
      releaseDigest: release.digest,
      contextDigest: runContextDigest,
      contextProvenance: [],
      contextClassification: ContextClassification.PUBLIC,
      requiredToolScopes: [],
      requiredPluginScopes: [
        { ...requirementScope, executionPlacement: 'control_plane', approvalRequired: false },
      ],
      state: options.daemon ? ExecutionRunState.QUEUED : ExecutionRunState.RUNNING,
      leaseOwner: options.daemon ? null : 'plugin-worker-test',
      input: options.daemon
        ? {
            date: '2026-08-17',
            timezone: 'America/New_York',
            priorities: ['Verify the durable Plugin worker path'],
            calendarItems: [
              {
                title: 'Plugin integration review',
                startsAt: '2026-08-17T13:00:00.000Z',
                endsAt: '2026-08-17T14:00:00.000Z',
              },
            ],
            tasks: ['Run the exact immutable Plugin plan'],
            signals: ['The Plugin runtime is ready for integration verification'],
            userConstraints: [],
          }
        : { id: 'sensitive-input' },
      providerKind: ModelProviderKind.DETERMINISTIC,
      developmentDraft: true,
      providerVersion: '1.0.0',
      model: options.daemon ? 'daily-brief-fixture' : 'plugin-store-fixture',
      maxInputTokens: options.daemon ? 8_000 : 100,
      maxOutputTokens: options.daemon ? 2_000 : 100,
      maxEstimatedCostUsd: 1,
      estimatedUpperCostUsd: 0.1,
      pricingVersion: options.daemon ? 'daemon-plugin-test' : 'plugin-store-test',
      idempotencyKey: `plugin-store:${suffix}`,
      requestedBy: 'plugin-worker-test',
    },
  });
  const requirement = await prisma.runPluginRequirement.create({
    data: {
      runId: run.id,
      installationId: installation.id,
      pluginVersionId: pluginVersion.id,
      pluginDigest,
      capabilityName: 'lookup',
      effect: PluginEffect.READ,
      approvalRequired: false,
      authorityScope: requirementScope,
      contextDigest: runContextDigest,
    },
  });
  const invocationKey = `${run.id}:plugin:0`;
  const plan = await prisma.runPluginCallPlan.create({
    data: {
      workspaceId,
      departmentId,
      runId: run.id,
      requirementId: requirement.id,
      ordinal: 0,
      invocationKey,
      inputPath: options.daemon ? ['calendarItems', 0] : [],
      outputContextKey: 'lookup_result',
    },
  });
  return {
    installationId: installation.id,
    runId: run.id,
    call: {
      invocationKey,
      planId: plan.id,
      requirementId: requirement.id,
      runId: run.id,
      workerId: 'plugin-worker-test',
      releaseId: release.id,
      releaseDigest: release.digest,
      entryResourceVersionId: entryVersion.id,
      contextDigest: runContextDigest,
      installationId: installation.id,
      pluginVersionId: pluginVersion.id,
      pluginDigest,
      tool: 'lookup',
      effect: 'read',
      input: options.daemon
        ? {
            title: 'Plugin integration review',
            startsAt: '2026-08-17T13:00:00.000Z',
            endsAt: '2026-08-17T14:00:00.000Z',
          }
        : { id: 'sensitive-input' },
    },
  };
}

function registry(
  implementation: (request: PluginCallRequest) => Promise<{ value: string }>,
): PluginTransportRegistry {
  const adapter: PluginTransportAdapter = {
    transport: 'http',
    listTools(definition) {
      return Promise.resolve(definition.tools);
    },
    callTool(request) {
      return implementation(request);
    },
  };
  return new PluginTransportRegistry([adapter]);
}

class ContextCapturingDailyBriefProvider extends DeterministicDailyBriefProvider {
  readonly requests: ModelRequest[] = [];

  override async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    yield* super.stream(request);
  }
}

function daemonConfig(): WorkerConfig {
  return {
    environment: 'test',
    logLevel: 'silent',
    workerId: `plugin-daemon:${randomUUID()}`,
    concurrency: 1,
    pollMs: 10,
    leaseMs: 5_000,
    heartbeatMs: 1_000,
    shutdownTimeoutMs: 2_000,
    profilePath: '.local/profile/nonexistent-plugin-daemon-profile.yaml',
    provider: {
      kind: 'deterministic',
      policy: 'direct_allowed',
      model: 'daily-brief-fixture',
      timeoutMs: 2_000,
    },
    pricing: {
      inputUsdPerMillionTokens: 3,
      outputUsdPerMillionTokens: 15,
      version: 'daemon-plugin-test',
    },
  };
}

async function waitForRunState(
  runId: string,
  expected: ExecutionRunState,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await prisma.executionRun.findUnique({ where: { id: runId } });
    if (run?.state === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const run = await prisma.executionRun.findUnique({ where: { id: runId } });
  throw new Error(`RUN_STATE_TIMEOUT:${run?.state ?? 'missing'}:${expected}`);
}

function daemonWithPlugin(
  provider: ContextCapturingDailyBriefProvider,
  implementation: (request: PluginCallRequest) => Promise<{ value: string }>,
): WorkerDaemon {
  const config = daemonConfig();
  const pluginStore = new PrismaWorkerPluginExecutionStore(prisma);
  const executor = new WorkerPluginExecutor(pluginStore, registry(implementation), 2_000);
  const plans = new WorkerPluginPlanCoordinator(pluginStore, executor);
  const engine = new ExecutionEngine(
    new PrismaWorkerStore(prisma),
    provider,
    config,
    pino({ level: 'silent' }),
    plans,
  );
  return new WorkerDaemon(engine, config, pino({ level: 'silent' }));
}

describeDatabase('PrismaWorkerPluginExecutionStore integration', () => {
  afterAll(async () => prisma.$disconnect());

  it('revalidates exact dependency authority and persists a digest-only append ledger', async () => {
    const fixture = await pluginFixture();
    let effects = 0;
    const executor = new WorkerPluginExecutor(
      new PrismaWorkerPluginExecutionStore(prisma),
      registry(async () => {
        effects += 1;
        return { value: 'sensitive-output' };
      }),
      1_000,
    );
    await expect(executor.execute(fixture.call)).resolves.toMatchObject({
      output: { value: 'sensitive-output' },
    });

    const rows = await prisma.pluginInvocation.findMany({
      where: { invocationKey: fixture.call.invocationKey },
      orderBy: { sequence: 'asc' },
    });
    expect(rows.map(({ state }) => state)).toEqual(['RUNNING', 'SUCCEEDED']);
    expect(JSON.stringify(rows)).not.toContain('sensitive-input');
    expect(JSON.stringify(rows)).not.toContain('sensitive-output');
    await expect(executor.execute(fixture.call)).rejects.toMatchObject({
      code: 'PLUGIN_INVOCATION_ALREADY_STARTED',
    });
    expect(effects).toBe(1);

    const secondPlan = await prisma.runPluginCallPlan.create({
      data: {
        workspaceId: (
          await prisma.executionRun.findUniqueOrThrow({ where: { id: fixture.call.runId } })
        ).workspaceId,
        departmentId: (
          await prisma.executionRun.findUniqueOrThrow({ where: { id: fixture.call.runId } })
        ).departmentId,
        runId: fixture.call.runId,
        requirementId: fixture.call.requirementId,
        ordinal: 1,
        invocationKey: `${fixture.call.runId}:plugin:1`,
        inputPath: [],
        outputContextKey: 'lookup_result_second',
      },
    });
    await expect(
      executor.execute({
        ...fixture.call,
        planId: secondPlan.id,
        invocationKey: secondPlan.invocationKey,
      }),
    ).rejects.toMatchObject({ code: 'PLUGIN_INVOCATION_LIMIT_EXCEEDED' });
    expect(effects).toBe(1);
  });

  it('rechecks installation state after return and never records a disabled call as success', async () => {
    const fixture = await pluginFixture();
    const executor = new WorkerPluginExecutor(
      new PrismaWorkerPluginExecutionStore(prisma),
      registry(async () => {
        await prisma.pluginInstallation.update({
          where: { id: fixture.installationId },
          data: {
            state: PluginInstallationState.DISABLED,
            disabledAt: new Date(),
            disabledBy: 'plugin-worker-test',
            disabledReason: 'Synthetic mid-call kill switch',
          },
        });
        return { value: 'must-not-be-accepted' };
      }),
      1_000,
    );

    await expect(executor.execute(fixture.call)).rejects.toMatchObject({
      code: 'PLUGIN_DISABLED',
    });
    const terminal = await prisma.pluginInvocation.findFirstOrThrow({
      where: { invocationKey: fixture.call.invocationKey, sequence: 2 },
    });
    expect(terminal.state).toBe('CANCELLED');
    expect(terminal.responseDigest).toBeNull();
    expect(terminal.errorCode).toBe('PLUGIN_DISABLED');
  });

  it('has the production daemon claim and execute an immutable plan before model execution', async () => {
    const fixture = await pluginFixture({ daemon: true });
    const provider = new ContextCapturingDailyBriefProvider();
    let effects = 0;
    const daemon = daemonWithPlugin(provider, async () => {
      effects += 1;
      return { value: 'governed-plugin-result' };
    });

    await daemon.start();
    try {
      await waitForRunState(fixture.runId, ExecutionRunState.SUCCEEDED);
    } finally {
      await daemon.stop();
    }

    expect(effects).toBe(1);
    expect(provider.requests).toHaveLength(1);
    expect(provider.requests[0]?.context).toMatchObject({
      pluginResults: { lookup_result: { value: 'governed-plugin-result' } },
    });
    const invocationRows = await prisma.pluginInvocation.findMany({
      where: { invocationKey: fixture.call.invocationKey },
      orderBy: { sequence: 'asc' },
    });
    expect(invocationRows.map(({ state }) => state)).toEqual(['RUNNING', 'SUCCEEDED']);
    expect(invocationRows.every(({ planId }) => planId === fixture.call.planId)).toBe(true);
    expect(await prisma.outcomeRecord.count({ where: { runId: fixture.runId } })).toBe(1);
  });

  it('pauses the durable run when the exact Plugin is disabled during a call', async () => {
    const fixture = await pluginFixture({ daemon: true });
    const provider = new ContextCapturingDailyBriefProvider();
    const daemon = daemonWithPlugin(provider, async () => {
      await prisma.pluginInstallation.update({
        where: { id: fixture.installationId },
        data: {
          state: PluginInstallationState.DISABLED,
          disabledAt: new Date(),
          disabledBy: 'plugin-daemon-test',
          disabledReason: 'Exercise the production kill switch.',
        },
      });
      return { value: 'must-not-reach-the-model' };
    });

    await daemon.start();
    try {
      await waitForRunState(fixture.runId, ExecutionRunState.PAUSED_PLUGIN);
    } finally {
      await daemon.stop();
    }

    expect(provider.requests).toHaveLength(0);
    const run = await prisma.executionRun.findUniqueOrThrow({ where: { id: fixture.runId } });
    expect(run.leaseOwner).toBeNull();
    expect(run.message).toBe('A required Plugin became unavailable. The run is held.');
    expect(run.error).toEqual({ code: 'PLUGIN_DISABLED' });
    const terminal = await prisma.pluginInvocation.findFirstOrThrow({
      where: { invocationKey: fixture.call.invocationKey, sequence: 2 },
    });
    expect(terminal.state).toBe('CANCELLED');
    expect(terminal.errorCode).toBe('PLUGIN_DISABLED');
  });
});
