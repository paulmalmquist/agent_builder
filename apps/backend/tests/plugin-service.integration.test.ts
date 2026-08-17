import { createHash, randomUUID } from 'node:crypto';
import {
  ExecutionRunState,
  PluginEffect,
  PluginInvocationState,
  PrismaClient,
  ResourceKind,
  ResourceLifecycle,
} from '@prisma/client';
import {
  compileResourceYaml,
  defaultDailyBriefExecutionContext,
  type ModelProvider,
  type PluginHealthProbe,
} from '@paul-os/runtime';
import { loadConfig } from '../src/config.js';
import { runWithPrincipal, type RequestPrincipal } from '../src/request-context.js';
import { ExecutionService } from '../src/services/execution-service.js';
import { AttentionService } from '../src/services/attention-service.js';
import { PluginService } from '../src/services/plugin-service.js';

const databaseEnabled =
  process.env['RUN_DATABASE_INTEGRATION'] === 'true' && process.env['DATABASE_URL'];
const describeDatabase = databaseEnabled ? describe : describe.skip;
const prisma = new PrismaClient();

jest.setTimeout(30_000);

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function modelProvider(): ModelProvider {
  return {
    kind: 'deterministic',
    version: 'plugin-service-test',
    model: 'plugin-service-fixture',
    async *stream() {
      // Admission and lifecycle tests do not invoke the provider.
    },
  };
}

type ProbeStatus = 'healthy' | 'degraded' | 'unavailable';

async function fixture(options: { approvalRequired?: boolean } = {}) {
  const suffix = randomUUID();
  const workspaceId = randomUUID();
  const departmentId = randomUUID();
  const pluginFamilyId = randomUUID();
  const entryFamilyId = randomUUID();
  const principal: RequestPrincipal = {
    actorId: `human:plugin-service-${suffix}`,
    workspaceId,
    departmentId,
    authentication: 'local',
    requestId: randomUUID(),
  };
  await prisma.workspace.create({
    data: { id: workspaceId, slug: `plugin-service-${suffix}`, name: 'Plugin Service Test' },
  });
  await prisma.department.create({
    data: { id: departmentId, workspaceId, slug: 'test', name: 'Test' },
  });
  await prisma.resourceFamily.createMany({
    data: [
      {
        id: pluginFamilyId,
        workspaceId,
        departmentId,
        kind: ResourceKind.PLUGIN,
        slug: `synthetic-http-${suffix}`,
        name: 'Synthetic HTTP Plugin',
        createdBy: principal.actorId,
        updatedBy: principal.actorId,
      },
      {
        id: entryFamilyId,
        workspaceId,
        departmentId,
        kind: ResourceKind.SKILL,
        slug: `daily-brief-${suffix}`,
        name: 'Daily Brief Plugin Entrypoint',
        createdBy: principal.actorId,
        updatedBy: principal.actorId,
      },
    ],
  });
  const pluginManifest = compileResourceYaml(
    JSON.stringify({
      apiVersion: 'paul-os/v1',
      kind: 'Plugin',
      metadata: {
        id: pluginFamilyId,
        slug: `synthetic-http-${suffix}`,
        version: '1.0.0',
        name: 'Synthetic HTTP Plugin',
        owner: principal.actorId,
        purpose: 'Exercise governed Plugin installation and authority without external data.',
        lifecycle: 'candidate',
        provenance: 'synthetic-test',
      },
      dependencies: [],
      spec: {
        transport: 'http',
        executionPlacement: 'control_plane',
        classification: 'internal',
        secretSlots: [
          {
            name: 'api_token',
            description: 'Opaque credential reference for the synthetic test transport.',
            required: true,
            environmentVariable: 'PLUGIN_TEST_TOKEN',
          },
        ],
        connection: {
          baseUrl: 'https://api.example.com/',
          allowedHosts: ['api.example.com'],
          defaultHeaders: { Authorization: { secretSlot: 'api_token' } },
        },
        health: {
          kind: 'http',
          intervalSeconds: 30,
          timeoutMs: 1000,
          method: 'GET',
          path: '/health',
          expectedStatuses: [200],
        },
        capabilities: [
          {
            tool: 'lookup',
            description: 'Read one bounded synthetic planning record by identifier.',
            effect: 'read',
            approval: options.approvalRequired === true ? 'approval_required' : 'not_required',
            scopeDescription: 'Read one synthetic planning record; it cannot write or delete.',
            inputSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['id'],
              properties: { id: { type: 'string' } },
            },
            outputSchema: {
              type: 'object',
              additionalProperties: false,
              required: ['value'],
              properties: { value: { type: 'string' } },
            },
            limits: {
              timeoutMs: 1000,
              maxResponseBytes: 1000,
              maxRecords: 1,
              maxInvocationsPerRun: 2,
              maxEstimatedCostUsd: 0.01,
            },
            invocation: {
              method: 'GET',
              path: '/records',
              headers: {},
            },
          },
        ],
      },
    }),
  );
  const entryDefinition = {
    apiVersion: 'paul-os/v1',
    kind: 'Skill',
    metadata: {
      id: entryFamilyId,
      slug: 'daily-brief',
      version: '1.0.0',
      name: 'Daily Brief Plugin Entrypoint',
      owner: principal.actorId,
      purpose: 'Exercise entrypoint-scoped Plugin authority in a synthetic daily brief.',
      lifecycle: 'candidate',
      provenance: 'synthetic-test',
    },
    dependencies: [{ familyId: pluginFamilyId, version: '1.0.0' }],
    spec: {
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      tools: [{ plugin: { familyId: pluginFamilyId, version: '1.0.0' }, tool: 'lookup' }],
      permissions: [],
      contextRequirements: [],
      successCriteria: ['Return a contract-valid synthetic briefing.'],
    },
  };
  const entryDigest = digest(JSON.stringify(entryDefinition));
  const [pluginVersion, entryVersion] = await Promise.all([
    prisma.resourceVersion.create({
      data: {
        familyId: pluginFamilyId,
        version: '1.0.0',
        lifecycle: ResourceLifecycle.CANDIDATE,
        owner: principal.actorId,
        purpose: pluginManifest.manifest.metadata.purpose,
        definition: pluginManifest.manifest,
        digest: pluginManifest.digest,
        sourceCommit: 'local-unverified',
        provenance: { source: 'synthetic-test' },
        dependencyPins: [],
        frozenAt: new Date(),
        createdBy: principal.actorId,
        updatedBy: principal.actorId,
      },
    }),
    prisma.resourceVersion.create({
      data: {
        familyId: entryFamilyId,
        version: '1.0.0',
        lifecycle: ResourceLifecycle.CANDIDATE,
        owner: principal.actorId,
        purpose: entryDefinition.metadata.purpose,
        definition: entryDefinition,
        digest: entryDigest,
        sourceCommit: digest(suffix).slice(0, 40),
        provenance: { source: 'synthetic-test' },
        dependencyPins: entryDefinition.dependencies,
        frozenAt: new Date(),
        createdBy: principal.actorId,
        updatedBy: principal.actorId,
      },
    }),
  ]);
  await prisma.resourceDependencyPin.create({
    data: {
      sourceVersionId: entryVersion.id,
      targetVersionId: pluginVersion.id,
      targetDigest: pluginVersion.digest,
    },
  });
  const release = await prisma.releaseBundle.create({
    data: {
      workspaceId,
      departmentId,
      digest: digest(`release:${suffix}`),
      projectId: null,
      createdBy: principal.actorId,
      resources: {
        create: [
          {
            resourceVersionId: entryVersion.id,
            kind: ResourceKind.SKILL,
            digest: entryVersion.digest,
            ordinal: 0,
          },
          {
            resourceVersionId: pluginVersion.id,
            kind: ResourceKind.PLUGIN,
            digest: pluginVersion.digest,
            ordinal: 1,
          },
        ],
      },
    },
  });
  let probeStatus: ProbeStatus = 'healthy';
  const healthProbe: PluginHealthProbe = {
    probe: () =>
      Promise.resolve({
        status: probeStatus,
        message: 'This adapter message must never be persisted.',
        latencyMs: 2,
      }),
  };
  const plugins = new PluginService(prisma, { environment: 'test' }, healthProbe);
  const execution = new ExecutionService(
    prisma,
    loadConfig({
      NODE_ENV: 'test',
      MODEL_PROVIDER: 'deterministic',
      EXECUTION_DISPATCH_MODE: 'in_process',
      ALLOW_UNVERIFIED_REPOSITORY_IMPORTS: 'true',
      PAUL_OS_PROFILE_PATH: `.local/profile/missing-${suffix}.yaml`,
    }),
    modelProvider(),
  );
  return {
    principal,
    plugins,
    execution,
    pluginVersion,
    entryVersion,
    release,
    setProbeStatus(status: ProbeStatus) {
      probeStatus = status;
    },
  };
}

const dailyBriefInput = {
  date: '2026-08-17',
  timezone: 'America/New_York',
  priorities: ['Verify Plugin authority'],
  calendarItems: [],
  tasks: ['Run the scoped integration test'],
  signals: ['Plugin lifecycle changed'],
  userConstraints: [],
};

describeDatabase('PluginService PostgreSQL lifecycle', () => {
  afterAll(async () => prisma.$disconnect());

  it('requires explicit enable intent and never exposes opaque secret references', async () => {
    const test = await fixture();
    await runWithPrincipal(test.principal, async () => {
      const installed = await test.plugins.install({
        pluginVersionId: test.pluginVersion.id,
        developmentOnly: true,
        secretBindings: [{ slot: 'api_token', reference: 'env://PLUGIN_TEST_TOKEN' }],
      });
      expect(installed.state).toBe('installed');
      expect(JSON.stringify(installed)).not.toContain('PLUGIN_TEST_TOKEN');
      expect(JSON.stringify(installed)).not.toContain('env://');

      await expect(
        test.plugins.configure(installed.id, {
          secretBindings: [],
          rationale: 'A required credential cannot be silently removed.',
        }),
      ).rejects.toMatchObject({ code: 'PLUGIN_CONFIGURATION_INCOMPLETE' });
      expect(
        await prisma.pluginSecretBinding.findUnique({
          where: { installationId_slot: { installationId: installed.id, slot: 'api_token' } },
        }),
      ).not.toBeNull();

      await test.plugins.checkHealth(installed.id);
      expect((await test.plugins.getInstallation(installed.id)).state).toBe('installed');
      expect(
        (await prisma.pluginInstallation.findUniqueOrThrow({ where: { id: installed.id } }))
          .enableRequestedAt,
      ).toBeNull();

      expect(
        (await test.plugins.enable(installed.id, { rationale: 'Enable after health review.' }))
          .state,
      ).toBe('enabled');
      await test.plugins.configure(installed.id, {
        secretBindings: [{ slot: 'api_token', reference: 'env://PLUGIN_TEST_TOKEN' }],
        rationale: 'Rotate the opaque binding and require a fresh health check.',
      });
      expect(
        (await test.plugins.enable(installed.id, { rationale: 'Request re-enablement.' })).state,
      ).toBe('installed');
      test.setProbeStatus('degraded');
      await test.plugins.checkHealth(installed.id);
      expect((await test.plugins.getInstallation(installed.id)).state).toBe('degraded');
      const catalog = await test.plugins.listCatalog({ includeDisabled: false, limit: 50 });
      const catalogJson = JSON.stringify(catalog);
      expect(
        catalog.items.find(({ pluginVersionId }) => pluginVersionId === test.pluginVersion.id),
      ).toMatchObject({ installationState: 'degraded', healthStatus: 'degraded' });
      expect(catalogJson).not.toContain('PLUGIN_TEST_TOKEN');
      expect(catalogJson).not.toContain('environmentVariable');
      expect(catalogJson).not.toContain('env://');

      test.setProbeStatus('healthy');
      await test.plugins.checkHealth(installed.id);
      expect((await test.plugins.getInstallation(installed.id)).state).toBe('enabled');
      await test.plugins.disable(installed.id, { rationale: 'Exercise the governed kill switch.' });
      await test.plugins.checkHealth(installed.id);
      expect((await test.plugins.getInstallation(installed.id)).state).toBe('disabled');
    });
  });

  it('accepts narrowed scopes, rejects broadening, and holds affected runs on disable', async () => {
    const test = await fixture();
    await runWithPrincipal(test.principal, async () => {
      const installed = await test.plugins.install({
        pluginVersionId: test.pluginVersion.id,
        developmentOnly: true,
        secretBindings: [{ slot: 'api_token', reference: 'env://PLUGIN_TEST_TOKEN' }],
      });
      await test.plugins.enable(installed.id, { rationale: 'Request exact Plugin enablement.' });
      await test.plugins.checkHealth(installed.id);
      const narrowLimits = {
        timeoutMs: 500,
        maxResponseBytes: 500,
        maxRecords: 1,
        maxInvocationsPerRun: 1,
        maxEstimatedCostUsd: 0.005,
      };
      const grantInput = {
        releaseId: test.release.id,
        entryResourceVersionId: test.entryVersion.id,
        contextDigest: defaultDailyBriefExecutionContext.digest,
        projectId: null,
        inputConstraints: {},
        toolScopes: [],
        pluginScopes: [
          {
            installationId: installed.id,
            pluginVersionId: test.pluginVersion.id,
            tool: 'lookup',
            limits: narrowLimits,
          },
        ],
        validUntil: new Date(Date.now() + 3_600_000).toISOString(),
        maxRuns: 10,
        maxEstimatedCostPerRunUsd: 1,
        totalCostBudgetUsd: 10,
        rationale: 'Allow one tightly bounded synthetic Plugin lookup.',
      };
      const grant = await test.execution.createGrant(grantInput);
      expect(grant.pluginScopes[0]).toMatchObject({
        pluginDigest: test.pluginVersion.digest,
        effect: 'read',
        limits: narrowLimits,
      });
      await expect(
        test.execution.createGrant({
          ...grantInput,
          rationale: 'This attempted scope is intentionally broader than the declaration.',
          pluginScopes: [
            {
              installationId: installed.id,
              pluginVersionId: test.pluginVersion.id,
              tool: 'lookup',
              limits: { ...narrowLimits, maxRecords: 2 },
            },
          ],
        }),
      ).rejects.toMatchObject({ code: 'PLUGIN_SCOPE_BROADENED' });
      await expect(
        test.execution.createGrant({
          ...grantInput,
          rationale: 'An undeclared limit cannot be invented by an authority envelope.',
          pluginScopes: [
            {
              installationId: installed.id,
              pluginVersionId: test.pluginVersion.id,
              tool: 'lookup',
              limits: { ...narrowLimits, maximumBytesBilled: 1 },
            },
          ],
        }),
      ).rejects.toMatchObject({ code: 'PLUGIN_SCOPE_BROADENED' });

      const createRun = (suffix: string) =>
        test.execution.createRun({
          releaseId: test.release.id,
          entryResourceVersionId: test.entryVersion.id,
          authorityGrantId: grant.id,
          input: dailyBriefInput,
          maxInputTokens: 1000,
          maxOutputTokens: 200,
          maxEstimatedCostUsd: 1,
          idempotencyKey: `plugin-run:${suffix}:${randomUUID()}`,
          developmentDraft: true,
        });
      const queued = await createRun('queued');
      const running = await createRun('running');
      expect(queued.state).toBe('queued');
      expect(queued.requiredPluginScopes[0]?.limits).toMatchObject({
        timeoutMs: 1000,
        maxResponseBytes: 1000,
        maxInvocationsPerRun: 2,
      });
      await prisma.executionRun.update({
        where: { id: running.id },
        data: { state: ExecutionRunState.RUNNING },
      });

      const invocationKey = `${running.id}:plugin:0`;
      const runRequirement = await prisma.runPluginRequirement.findFirstOrThrow({
        where: {
          runId: running.id,
          installationId: installed.id,
          pluginVersionId: test.pluginVersion.id,
          capabilityName: 'lookup',
        },
      });
      const callPlan = await prisma.runPluginCallPlan.create({
        data: {
          workspaceId: test.principal.workspaceId,
          departmentId: test.principal.departmentId,
          runId: running.id,
          requirementId: runRequirement.id,
          ordinal: 0,
          invocationKey,
          inputPath: [],
          outputContextKey: 'lookup_result',
        },
      });
      const requestDigest = digest('sensitive-input-is-never-persisted');
      const invocationBase = {
        workspaceId: test.principal.workspaceId,
        departmentId: test.principal.departmentId,
        installationId: installed.id,
        runId: running.id,
        pluginVersionId: test.pluginVersion.id,
        pluginDigest: test.pluginVersion.digest,
        toolName: 'lookup',
        effect: PluginEffect.READ,
        requestDigest,
        planId: callPlan.id,
      };
      await expect(
        prisma.pluginInvocation.create({
          data: {
            ...invocationBase,
            invocationKey: `${invocationKey}:terminal-first`,
            sequence: 2,
            state: PluginInvocationState.SUCCEEDED,
            responseDigest: digest('output'),
            finishedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
      const started = await prisma.pluginInvocation.create({
        data: {
          ...invocationBase,
          invocationKey,
          sequence: 1,
          state: PluginInvocationState.RUNNING,
          startedAt: new Date(),
        },
      });
      await expect(
        prisma.pluginInvocation.create({
          data: {
            ...invocationBase,
            invocationKey,
            sequence: 3,
            state: PluginInvocationState.SUCCEEDED,
            responseDigest: digest('output'),
            finishedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.pluginInvocation.create({
          data: {
            ...invocationBase,
            invocationKey,
            requestDigest: digest('different-input'),
            sequence: 2,
            state: PluginInvocationState.SUCCEEDED,
            responseDigest: digest('output'),
            finishedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
      await prisma.pluginInvocation.create({
        data: {
          ...invocationBase,
          invocationKey,
          sequence: 2,
          state: PluginInvocationState.SUCCEEDED,
          responseDigest: digest('synthetic-output'),
          finishedAt: new Date(),
        },
      });
      await expect(
        prisma.pluginInvocation.update({
          where: { id: started.id },
          data: { summary: 'Mutation must fail.' },
        }),
      ).rejects.toThrow();

      test.setProbeStatus('unavailable');
      await test.plugins.checkHealth(installed.id);
      expect(
        await prisma.executionRun.findUniqueOrThrow({ where: { id: queued.id } }),
      ).toMatchObject({
        state: ExecutionRunState.PAUSED_PLUGIN,
      });
      expect(
        await prisma.executionRun.findUniqueOrThrow({ where: { id: running.id } }),
      ).toMatchObject({ state: ExecutionRunState.RUNNING, cancelRequestedAt: expect.any(Date) });

      const paused = await createRun('plugin-unavailable');
      expect(paused).toMatchObject({ state: 'paused_plugin', requiresPluginApproval: false });
      expect(
        await prisma.runPluginRequirement.findUniqueOrThrow({
          where: {
            runId_installationId_pluginVersionId_capabilityName: {
              runId: paused.id,
              installationId: installed.id,
              pluginVersionId: test.pluginVersion.id,
              capabilityName: 'lookup',
            },
          },
        }),
      ).toMatchObject({ approvalRequired: false });

      const attention = await new AttentionService(prisma).list();
      expect(attention.degraded).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: `plugin_health:${paused.id}`,
            kind: 'plugin_health',
            secondaryAction: null,
            payload: expect.objectContaining({
              metadata: expect.objectContaining({ state: 'paused_plugin' }),
            }),
          }),
          expect.objectContaining({
            id: `plugin_health:${installed.id}`,
            kind: 'plugin_health',
            secondaryAction: null,
            payload: expect.objectContaining({
              metadata: expect.objectContaining({ state: 'degraded' }),
            }),
          }),
        ]),
      );
      await expect(
        new AttentionService(prisma).resolveItem(`plugin_health:${paused.id}`, {
          rationale: 'A live Plugin hold must remain visible until its condition changes.',
        }),
      ).rejects.toMatchObject({ code: 'ATTENTION_ITEM_NOT_TERMINAL', status: 409 });
      expect(
        await prisma.platformEvent.count({
          where: {
            entityType: 'ExecutionRun',
            entityId: { in: [queued.id, running.id] },
          },
        }),
      ).toBe(2);

      const dependencies = await test.plugins.usedBy(installed.id);
      expect(dependencies.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: test.entryVersion.id })]),
      );
      await expect(
        test.plugins.uninstall(installed.id, {
          rationale: 'Active run requirements must block this attempted uninstall.',
        }),
      ).rejects.toMatchObject({ code: 'PLUGIN_IN_USE' });
    });
  });

  it('requires a fresh human decision for every approval-required Plugin run', async () => {
    const test = await fixture({ approvalRequired: true });
    await runWithPrincipal(test.principal, async () => {
      const installed = await test.plugins.install({
        pluginVersionId: test.pluginVersion.id,
        developmentOnly: true,
        secretBindings: [{ slot: 'api_token', reference: 'env://PLUGIN_TEST_TOKEN' }],
      });
      await test.plugins.enable(installed.id, { rationale: 'Request exact Plugin enablement.' });
      await test.plugins.checkHealth(installed.id);
      const pluginScope = {
        installationId: installed.id,
        pluginVersionId: test.pluginVersion.id,
        tool: 'lookup',
        limits: {
          timeoutMs: 500,
          maxResponseBytes: 500,
          maxRecords: 1,
          maxInvocationsPerRun: 1,
          maxEstimatedCostUsd: 0.005,
        },
      };
      const grantInput = {
        releaseId: test.release.id,
        entryResourceVersionId: test.entryVersion.id,
        contextDigest: defaultDailyBriefExecutionContext.digest,
        projectId: null,
        inputConstraints: {},
        toolScopes: [],
        pluginScopes: [pluginScope],
        validUntil: new Date(Date.now() + 3_600_000).toISOString(),
        maxRuns: 10,
        maxEstimatedCostPerRunUsd: 1,
        totalCostBudgetUsd: 10,
        rationale: 'Allow the bounded Plugin capability under a reusable envelope.',
      };
      const reusableGrant = await test.execution.createGrant(grantInput);
      const createRun = () =>
        test.execution.createRun({
          releaseId: test.release.id,
          entryResourceVersionId: test.entryVersion.id,
          authorityGrantId: reusableGrant.id,
          input: dailyBriefInput,
          maxInputTokens: 1000,
          maxOutputTokens: 200,
          maxEstimatedCostUsd: 1,
          idempotencyKey: `approval-required-plugin:${randomUUID()}`,
          developmentDraft: true,
        });

      const first = await createRun();
      expect(first).toMatchObject({
        state: 'awaiting_approval',
        requiresPluginApproval: true,
      });
      expect(first.approvalReasons).toEqual(
        expect.arrayContaining([expect.stringMatching(/human approval.*exact run/i)]),
      );
      expect(
        await prisma.runPluginRequirement.findUniqueOrThrow({
          where: {
            runId_installationId_pluginVersionId_capabilityName: {
              runId: first.id,
              installationId: installed.id,
              pluginVersionId: test.pluginVersion.id,
              capabilityName: 'lookup',
            },
          },
        }),
      ).toMatchObject({ approvalRequired: true });

      const approved = await test.execution.approveRun(first.id, {
        entryResourceVersionId: test.entryVersion.id,
        projectId: null,
        inputConstraints: {},
        toolScopes: [],
        pluginScopes: [pluginScope],
        validUntil: new Date(Date.now() + 3_600_000).toISOString(),
        maxRuns: 10,
        maxEstimatedCostPerRunUsd: 1,
        totalCostBudgetUsd: 10,
        rationale: 'Approve this exact run and its bounded Plugin call after human review.',
      });
      expect(approved.run).toMatchObject({ state: 'queued', requiresPluginApproval: true });
      expect(
        await prisma.approvalRequest.findUniqueOrThrow({ where: { runId: first.id } }),
      ).toMatchObject({
        state: 'APPROVED',
        decidedBy: test.principal.actorId,
        rationale: 'Approve this exact run and its bounded Plugin call after human review.',
        decidedAt: expect.any(Date),
      });
      expect(await test.execution.claim(first.id, 'plugin-approval-test-worker')).toBe(true);

      const second = await createRun();
      expect(second).toMatchObject({ state: 'awaiting_approval', requiresPluginApproval: true });
      expect(await test.execution.claim(second.id, 'plugin-approval-test-worker')).toBe(false);

      // Even a forged run-state transition cannot bypass the database evidence guard.
      await prisma.executionRun.update({
        where: { id: second.id },
        data: { state: ExecutionRunState.RUNNING, authorityGrantId: reusableGrant.id },
      });
      const secondRequirement = await prisma.runPluginRequirement.findFirstOrThrow({
        where: {
          runId: second.id,
          installationId: installed.id,
          pluginVersionId: test.pluginVersion.id,
          capabilityName: 'lookup',
        },
      });
      const secondInvocationKey = `${second.id}:plugin:0`;
      const secondPlan = await prisma.runPluginCallPlan.create({
        data: {
          workspaceId: test.principal.workspaceId,
          departmentId: test.principal.departmentId,
          runId: second.id,
          requirementId: secondRequirement.id,
          ordinal: 0,
          invocationKey: secondInvocationKey,
          inputPath: [],
          outputContextKey: 'lookup_result',
        },
      });
      await expect(
        prisma.pluginInvocation.create({
          data: {
            workspaceId: test.principal.workspaceId,
            departmentId: test.principal.departmentId,
            installationId: installed.id,
            runId: second.id,
            planId: secondPlan.id,
            pluginVersionId: test.pluginVersion.id,
            pluginDigest: test.pluginVersion.digest,
            invocationKey: secondInvocationKey,
            sequence: 1,
            toolName: 'lookup',
            effect: PluginEffect.READ,
            state: PluginInvocationState.RUNNING,
            requestDigest: digest('approval-required-input'),
            startedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/human decision for this run/i);
    });
  });
});
