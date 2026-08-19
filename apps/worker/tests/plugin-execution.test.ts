/* eslint-disable @typescript-eslint/require-await */
import {
  PluginRuntimeError,
  PluginTransportRegistry,
  pluginPayloadDigest,
  type PluginAuthorityScopeRuntime,
  type PluginCallRequest,
  type PluginTool,
  type PluginTransportAdapter,
} from '@paul-os/runtime';
import {
  PluginInvocationPersistenceError,
  WorkerPluginExecutor,
  type PluginCallAuthorizationSnapshot,
  type PluginInvocationLedgerEvent,
  type WorkerPluginCall,
  type WorkerPluginExecutionStore,
} from '../src/plugin-execution.js';

const pluginVersionId = '10000000-0000-4000-8000-000000000001';
const installationId = '20000000-0000-4000-8000-000000000001';
const runId = '30000000-0000-4000-8000-000000000001';
const releaseId = '40000000-0000-4000-8000-000000000001';
const entryResourceVersionId = '50000000-0000-4000-8000-000000000001';
const planId = '60000000-0000-4000-8000-000000000001';
const requirementId = '70000000-0000-4000-8000-000000000001';
const workerId = 'worker:test:1';
const pluginDigest = 'a'.repeat(64);
const releaseDigest = 'b'.repeat(64);
const contextDigest = 'c'.repeat(64);

const tool: PluginTool = {
  name: 'lookup',
  description: 'Looks up one governed synthetic record.',
  effect: 'read',
  inputSchema: {
    type: 'object',
    properties: { id: { type: 'string' } },
    required: ['id'],
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
};

const authorityScope: PluginAuthorityScopeRuntime = {
  installationId,
  pluginVersionId,
  pluginDigest,
  tool: 'lookup',
  effect: 'read',
  scopeDescription: 'Read one synthetic record without modifying it.',
  limits: { ...tool.limits },
};

function call(overrides: Partial<WorkerPluginCall> = {}): WorkerPluginCall {
  return {
    invocationKey: 'invocation:test:1',
    planId,
    requirementId,
    runId,
    workerId,
    releaseId,
    releaseDigest,
    entryResourceVersionId,
    contextDigest,
    installationId,
    pluginVersionId,
    pluginDigest,
    tool: 'lookup',
    effect: 'read',
    input: { id: 'secret-input' },
    ...overrides,
  };
}

function snapshot(
  overrides: {
    cancellationRequested?: boolean;
    reachable?: boolean;
    installationState?: 'installed' | 'enabled' | 'disabled' | 'degraded';
    authorityState?: 'active' | 'revoked' | 'expired' | 'exhausted';
    contextDigest?: string;
    grantScope?: PluginAuthorityScopeRuntime;
    requirementScope?: PluginAuthorityScopeRuntime;
    approvalRequired?: boolean;
    pluginApprovalSatisfied?: boolean;
  } = {},
): PluginCallAuthorizationSnapshot {
  const snapshotContext = overrides.contextDigest ?? contextDigest;
  return {
    run: {
      id: runId,
      releaseId,
      releaseDigest,
      entryResourceVersionId,
      contextDigest: snapshotContext,
      cancellationRequested: overrides.cancellationRequested ?? false,
      developmentDraft: false,
      pluginApprovalSatisfied: overrides.pluginApprovalSatisfied ?? true,
      leaseOwner: workerId,
    },
    release: { id: releaseId, digest: releaseDigest },
    entrypoint: {
      resourceVersionId: entryResourceVersionId,
      belongsToRelease: true,
      pluginReachableThroughDependencies: overrides.reachable ?? true,
    },
    installation: {
      id: installationId,
      pluginVersionId,
      pluginDigest,
      transport: 'http',
      placement: 'control_plane',
      state: overrides.installationState ?? 'enabled',
      developmentOnly: false,
      secretBindings: {},
    },
    requirement: {
      id: requirementId,
      runId,
      installationId,
      pluginVersionId,
      pluginDigest,
      capabilityName: 'lookup',
      effect: 'read',
      contextDigest: snapshotContext,
      executionPlacement: 'control_plane',
      approvalRequired: overrides.approvalRequired ?? false,
      authorityScope: overrides.requirementScope ?? authorityScope,
      state: 'active',
    },
    plan: { id: planId, runId, requirementId, invocationKey: 'invocation:test:1' },
    authority: {
      state: overrides.authorityState ?? 'active',
      releaseId,
      releaseDigest,
      entryResourceVersionId,
      contextDigest: snapshotContext,
      scopes: [overrides.grantScope ?? authorityScope],
    },
    definition: {
      pluginVersionId,
      pluginVersion: '1.0.0',
      pluginDigest,
      transport: 'http',
      placement: 'control_plane',
      tools: [tool],
      secretSlots: [],
      secretEnvironmentVariables: {},
    },
  };
}

class MemoryStore implements WorkerPluginExecutionStore {
  readonly events = new Map<string, PluginInvocationLedgerEvent>();
  readonly appendAttempts: PluginInvocationLedgerEvent[] = [];
  revalidationCount = 0;
  terminalFailures = 0;
  failAfterTerminalInsert = false;

  constructor(
    private readonly snapshots: (
      revalidationNumber: number,
    ) => PluginCallAuthorizationSnapshot = () => snapshot(),
  ) {}

  async revalidate(): Promise<PluginCallAuthorizationSnapshot> {
    this.revalidationCount += 1;
    return this.snapshots(this.revalidationCount);
  }

  async appendInvocation(event: PluginInvocationLedgerEvent): Promise<'inserted' | 'existing'> {
    this.appendAttempts.push(structuredClone(event));
    const key = `${event.invocationKey}:${event.sequence}`;
    const existing = this.events.get(key);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(event)) {
        throw new Error('DIVERGENT_INVOCATION_EVENT');
      }
      return 'existing';
    }
    if (event.sequence === 2 && this.terminalFailures > 0 && !this.failAfterTerminalInsert) {
      this.terminalFailures -= 1;
      throw new Error('LEDGER_UNAVAILABLE');
    }
    this.events.set(key, structuredClone(event));
    if (event.sequence === 2 && this.terminalFailures > 0) {
      this.terminalFailures -= 1;
      throw new Error('ACK_LOST_AFTER_COMMIT');
    }
    return 'inserted';
  }
}

function runtime(
  implementation: (request: PluginCallRequest, signal: AbortSignal) => Promise<{ value: string }>,
  calls: WorkerPluginCall[] = [],
): PluginTransportRegistry {
  const adapter: PluginTransportAdapter = {
    transport: 'http',
    async listTools(definition) {
      return definition.tools;
    },
    async callTool(request, _tool, signal) {
      calls.push(call({ input: request.input }));
      return implementation(request, signal);
    },
  };
  return new PluginTransportRegistry([adapter]);
}

describe('WorkerPluginExecutor', () => {
  it('revalidates after the call and records only digests and governed metadata', async () => {
    const store = new MemoryStore();
    const transportCalls: WorkerPluginCall[] = [];
    const executor = new WorkerPluginExecutor(
      store,
      runtime(async () => ({ value: 'secret-output' }), transportCalls),
      1_000,
    );

    await expect(executor.execute(call())).resolves.toMatchObject({
      output: { value: 'secret-output' },
    });
    expect(store.revalidationCount).toBeGreaterThanOrEqual(3);
    expect(transportCalls).toHaveLength(1);
    expect([...store.events.values()].map(({ state }) => state)).toEqual(['running', 'succeeded']);
    const serialized = JSON.stringify([...store.events.values()]);
    expect(serialized).not.toContain('secret-input');
    expect(serialized).not.toContain('secret-output');
    expect(serialized).toContain('inputDigest');
    expect(serialized).toContain('outputDigest');
  });

  it('does not record success when the Plugin is disabled after the adapter returns', async () => {
    const store = new MemoryStore((count) =>
      count >= 3 ? snapshot({ installationState: 'disabled' }) : snapshot(),
    );
    const executor = new WorkerPluginExecutor(
      store,
      runtime(async () => ({ value: 'completed-but-revoked' })),
      1_000,
    );

    await expect(executor.execute(call())).rejects.toMatchObject({ code: 'PLUGIN_DISABLED' });
    expect(store.events.get('invocation:test:1:2')).toMatchObject({
      state: 'cancelled',
      outputDigest: null,
      errorCode: 'PLUGIN_DISABLED',
    });
  });

  it('cancels an active call when periodic revalidation sees a disable', async () => {
    const store = new MemoryStore((count) =>
      count >= 3 ? snapshot({ installationState: 'disabled' }) : snapshot(),
    );
    const executor = new WorkerPluginExecutor(
      store,
      runtime(
        (_request, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              'abort',
              () => {
                const reason: unknown = signal.reason as unknown;
                reject(reason instanceof Error ? reason : new Error('PLUGIN_CALL_CANCELLED'));
              },
              { once: true },
            );
          }),
      ),
      10,
    );

    await expect(executor.execute(call())).rejects.toMatchObject({ code: 'PLUGIN_DISABLED' });
    expect(store.events.get('invocation:test:1:2')).toMatchObject({
      state: 'cancelled',
      errorCode: 'PLUGIN_DISABLED',
    });
  });

  it('rejects sibling authority, context drift, and cancellation before any effect', async () => {
    for (const invalid of [
      snapshot({ reachable: false }),
      snapshot({ contextDigest: 'd'.repeat(64) }),
      snapshot({ cancellationRequested: true }),
    ]) {
      const store = new MemoryStore(() => invalid);
      const transportCalls: WorkerPluginCall[] = [];
      const executor = new WorkerPluginExecutor(
        store,
        runtime(async () => ({ value: 'must-not-run' }), transportCalls),
      );
      await expect(executor.execute(call())).rejects.toBeInstanceOf(PluginRuntimeError);
      expect(transportCalls).toHaveLength(0);
      expect(store.events.size).toBe(0);
    }
  });

  it('requires a human decision for this exact run before an approval-required call', async () => {
    const store = new MemoryStore(() =>
      snapshot({ approvalRequired: true, pluginApprovalSatisfied: false }),
    );
    const transportCalls: WorkerPluginCall[] = [];
    const executor = new WorkerPluginExecutor(
      store,
      runtime(async () => ({ value: 'must-not-run' }), transportCalls),
    );

    await expect(executor.execute(call())).rejects.toMatchObject({
      code: 'PLUGIN_PER_RUN_APPROVAL_REQUIRED',
    });
    expect(transportCalls).toHaveLength(0);
    expect(store.events.size).toBe(0);
  });

  it('executes with a narrowed grant and rejects a grant that broadens the requirement', async () => {
    const narrowed = {
      ...authorityScope,
      limits: { ...authorityScope.limits, maxResponseBytes: 500 },
    };
    const narrowedStore = new MemoryStore(() => snapshot({ grantScope: narrowed }));
    await expect(
      new WorkerPluginExecutor(
        narrowedStore,
        runtime(async () => ({ value: 'narrowed' })),
      ).execute(call()),
    ).resolves.toMatchObject({ output: { value: 'narrowed' } });

    const requirementMaximum = {
      ...authorityScope,
      limits: { ...authorityScope.limits, maxResponseBytes: 500 },
    };
    const broadenedGrant = {
      ...authorityScope,
      limits: { ...authorityScope.limits, maxResponseBytes: 600 },
    };
    const broadenedStore = new MemoryStore(() =>
      snapshot({ requirementScope: requirementMaximum, grantScope: broadenedGrant }),
    );
    await expect(
      new WorkerPluginExecutor(
        broadenedStore,
        runtime(async () => ({ value: 'must-not-run' })),
      ).execute(call()),
    ).rejects.toMatchObject({ code: 'PLUGIN_REQUIREMENT_SCOPE_BROADENED' });
    expect([...broadenedStore.events.values()]).toHaveLength(0);
  });

  it('retries an ambiguous sequence-two acknowledgement without replaying the effect', async () => {
    const store = new MemoryStore();
    store.terminalFailures = 1;
    store.failAfterTerminalInsert = true;
    let effects = 0;
    const executor = new WorkerPluginExecutor(
      store,
      runtime(async () => {
        effects += 1;
        return { value: 'once' };
      }),
      1_000,
      3,
    );

    await expect(executor.execute(call())).resolves.toMatchObject({ output: { value: 'once' } });
    expect(effects).toBe(1);
    expect(store.events.get('invocation:test:1:2')).toMatchObject({ state: 'succeeded' });
    expect(store.appendAttempts.filter(({ sequence }) => sequence === 2)).toHaveLength(2);
  });

  it('leaves an ambiguous running event and never fabricates failure after terminal persistence exhausts', async () => {
    const store = new MemoryStore();
    store.terminalFailures = 10;
    let effects = 0;
    const executor = new WorkerPluginExecutor(
      store,
      runtime(async () => {
        effects += 1;
        return { value: 'effect-happened' };
      }),
      1_000,
      3,
    );

    await expect(executor.execute(call())).rejects.toBeInstanceOf(PluginInvocationPersistenceError);
    expect(effects).toBe(1);
    expect([...store.events.values()]).toHaveLength(1);
    expect(store.events.get('invocation:test:1:1')).toMatchObject({ state: 'running' });
    expect(store.appendAttempts.filter(({ sequence }) => sequence === 2)).toHaveLength(3);
  });

  it('does not replay an invocation whose running event already exists', async () => {
    const store = new MemoryStore();
    const invocation = call();
    const firstExecutor = new WorkerPluginExecutor(
      store,
      runtime(async () => ({ value: 'must-not-run' })),
    );
    store.events.set(`${invocation.invocationKey}:1`, {
      invocationKey: invocation.invocationKey,
      planId: invocation.planId,
      sequence: 1,
      runId: invocation.runId,
      workerId: invocation.workerId,
      installationId: invocation.installationId,
      toolName: invocation.tool,
      effect: invocation.effect,
      state: 'running',
      inputDigest: pluginPayloadDigest(invocation.input),
      outputDigest: null,
      latencyMs: null,
      costUsd: null,
      errorCode: null,
    });

    await expect(firstExecutor.execute(invocation)).rejects.toMatchObject({
      code: 'PLUGIN_INVOCATION_ALREADY_STARTED',
    });
    expect([...store.events.values()].filter(({ sequence }) => sequence === 2)).toHaveLength(0);
  });
});
