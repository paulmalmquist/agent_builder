import type { Logger } from 'pino';
import path from 'node:path';
import { pino } from 'pino';
import type { ModelProvider, ModelRequest, ModelStreamEvent } from '@paul-os/runtime';
import {
  defaultDailyBriefExecutionContext,
  DeterministicDailyBriefProvider,
  loadDailyBriefExecutionContext,
} from '@paul-os/runtime';
import type { WorkerConfig } from '../src/config.js';
import { ExecutionEngine } from '../src/engine.js';
import type {
  ClaimedRun,
  CompletedRun,
  FailureDisposition,
  HeartbeatResult,
  ProviderUsageSettlement,
  RecoverySummary,
  WorkerStore,
} from '../src/types.js';

const input = {
  date: '2026-08-16',
  timezone: 'America/New_York',
  priorities: ['Ship the worker'],
  calendarItems: [
    {
      title: 'Architecture review',
      startsAt: '2026-08-16T13:00:00.000Z',
      endsAt: '2026-08-16T14:00:00.000Z',
    },
  ],
  tasks: ['Verify execution'],
  signals: ['A synthetic signal'],
  userConstraints: [],
};
const workspaceRoot = process.cwd().endsWith(path.join('apps', 'worker'))
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();
const exampleProfilePath = path.join(workspaceRoot, '00-core', 'profiles', 'paul.example.yaml');

const claimedRun: ClaimedRun = {
  id: '00000000-0000-4000-8000-000000000001',
  releaseId: '00000000-0000-4000-8000-000000000002',
  releaseDigest: 'a'.repeat(64),
  contextDigest: defaultDailyBriefExecutionContext.digest,
  authorityGrantId: '00000000-0000-4000-8000-000000000003',
  developmentDraft: true,
  productionEpoch: null,
  input,
  providerKind: 'deterministic',
  providerVersion: '1.0.0',
  model: 'daily-brief-fixture',
  pricingVersion: 'test-pricing',
  maxInputTokens: 8_000,
  maxOutputTokens: 2_000,
  maxEstimatedCostUsd: 1,
  estimatedUpperCostUsd: 1,
  attempts: 1,
  maxAttempts: 3,
};

const config: WorkerConfig = {
  environment: 'test',
  logLevel: 'silent',
  concurrency: 1,
  pollMs: 5,
  leaseMs: 100,
  heartbeatMs: 5,
  shutdownTimeoutMs: 50,
  profilePath: '.local/profile/nonexistent-worker-test-profile.yaml',
  provider: {
    kind: 'deterministic',
    policy: 'direct_allowed',
    model: 'daily-brief-fixture',
    timeoutMs: 50,
  },
  pricing: {
    inputUsdPerMillionTokens: 3,
    outputUsdPerMillionTokens: 15,
    version: 'test-pricing',
  },
};

class FakeStore implements WorkerStore {
  claim: ClaimedRun | null = claimedRun;
  heartbeatResults: HeartbeatResult[] = [{ owned: true, cancellationRequested: false }];
  completed: CompletedRun | null = null;
  cancelled = false;
  failures: Array<{ code: string; retryable: boolean }> = [];
  failureSettlements: Array<ProviderUsageSettlement | undefined> = [];
  cancellationSettlement: ProviderUsageSettlement | undefined;
  recovered = false;

  recoverExpiredLeases(): Promise<RecoverySummary> {
    this.recovered = true;
    return Promise.resolve({ requeued: 1, failed: 0 });
  }

  claimNext(): Promise<ClaimedRun | null> {
    const result = this.claim;
    this.claim = null;
    return Promise.resolve(result);
  }

  heartbeat(): Promise<HeartbeatResult> {
    return Promise.resolve(
      this.heartbeatResults.shift() ?? { owned: true, cancellationRequested: false },
    );
  }

  complete(_run: ClaimedRun, _workerId: string, result: CompletedRun): Promise<boolean> {
    this.completed = result;
    return Promise.resolve(true);
  }

  cancelClaimed(
    _runId: string,
    _workerId: string,
    incurred?: ProviderUsageSettlement,
  ): Promise<boolean> {
    this.cancelled = true;
    this.cancellationSettlement = incurred;
    return Promise.resolve(true);
  }

  failOrRetry(
    _run: ClaimedRun,
    _workerId: string,
    code: string,
    retryable: boolean,
    incurred?: ProviderUsageSettlement,
  ): Promise<FailureDisposition> {
    this.failures.push({ code, retryable });
    this.failureSettlements.push(incurred);
    return Promise.resolve({
      state: retryable ? 'queued' : 'failed',
      retryAfterMs: retryable ? 2_000 : null,
    });
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

class WrongShapeProvider implements ModelProvider {
  readonly kind = 'deterministic' as const;
  readonly version = '1.0.0';
  readonly model = 'daily-brief-fixture';

  async *stream(): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();
    yield { type: 'text_delta', text: '{}' };
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: 'complete', stopReason: 'end_turn' };
  }
}

class InventedCitationProvider implements ModelProvider {
  readonly kind = 'deterministic' as const;
  readonly version = '1.0.0';
  readonly model = 'daily-brief-fixture';

  async *stream(): AsyncIterable<ModelStreamEvent> {
    await Promise.resolve();
    yield {
      type: 'text_delta',
      text: JSON.stringify({
        topPriorities: ['Ship the worker'],
        scheduleRisks: [],
        decisionsRequired: ['Review signal: A synthetic signal'],
        proposedActions: ['Verify execution'],
        citations: ['calendar:invented'],
        confidence: 1,
        unresolvedItems: [],
      }),
    };
    yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 20 } };
    yield { type: 'complete', stopReason: 'end_turn' };
  }
}

class HangingProvider implements ModelProvider {
  readonly kind = 'deterministic' as const;
  readonly version = '1.0.0';
  readonly model = 'daily-brief-fixture';

  async *stream(_request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelStreamEvent> {
    await new Promise<void>((resolve) => {
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    if (signal?.aborted) throw signal.reason;
    yield { type: 'complete', stopReason: 'end_turn' };
  }
}

class ContextCapturingProvider extends DeterministicDailyBriefProvider {
  lastRequest: ModelRequest | null = null;

  override async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.lastRequest = request;
    yield* super.stream(request);
  }
}

const logger: Logger = pino({ level: 'silent' });

describe('ExecutionEngine', () => {
  it('executes a deterministic daily brief and records bounded cost metadata', async () => {
    const store = new FakeStore();
    const engine = new ExecutionEngine(
      store,
      new DeterministicDailyBriefProvider(),
      config,
      logger,
    );
    await expect(engine.runNext('worker:test')).resolves.toBe(true);
    expect(store.completed?.output.topPriorities).toEqual(['Ship the worker']);
    expect(store.completed?.actualCostUsd).toBeGreaterThan(0);
    expect(store.completed?.qualityScore).toBe(1);
    expect(store.failures).toEqual([]);
  });

  it('does not call the provider when cancellation is already requested', async () => {
    const store = new FakeStore();
    store.heartbeatResults = [{ owned: true, cancellationRequested: true }];
    const engine = new ExecutionEngine(
      store,
      new DeterministicDailyBriefProvider(),
      config,
      logger,
    );
    await engine.runNext('worker:test');
    expect(store.cancelled).toBe(true);
    expect(store.completed).toBeNull();
  });

  it('discards work when ownership of the lease is lost', async () => {
    const store = new FakeStore();
    store.heartbeatResults = [{ owned: false, cancellationRequested: false }];
    const engine = new ExecutionEngine(
      store,
      new DeterministicDailyBriefProvider(),
      config,
      logger,
    );
    await engine.runNext('worker:test');
    expect(store.completed).toBeNull();
    expect(store.failures).toEqual([]);
  });

  it('fails closed on provider snapshot drift', async () => {
    const store = new FakeStore();
    store.claim = { ...claimedRun, providerVersion: '2.0.0' };
    const engine = new ExecutionEngine(
      store,
      new DeterministicDailyBriefProvider(),
      config,
      logger,
    );
    await engine.runNext('worker:test');
    expect(store.failures).toEqual([
      { code: 'MODEL_PROVIDER_SNAPSHOT_MISMATCH', retryable: false },
    ]);
  });

  it('fails closed before provider execution when the persisted context digest cannot be reproduced', async () => {
    const store = new FakeStore();
    store.claim = { ...claimedRun, contextDigest: 'b'.repeat(64) };
    const engine = new ExecutionEngine(
      store,
      new DeterministicDailyBriefProvider(),
      config,
      logger,
    );
    await engine.runNext('worker:test');
    expect(store.completed).toBeNull();
    expect(store.failures).toEqual([
      { code: 'EXECUTION_CONTEXT_SNAPSHOT_MISMATCH', retryable: false },
    ]);
  });

  it('fails closed when a configured private profile cannot be validated', async () => {
    const store = new FakeStore();
    const engine = new ExecutionEngine(
      store,
      new DeterministicDailyBriefProvider(),
      { ...config, profilePath: 'package.json' },
      logger,
    );
    await engine.runNext('worker:test');
    expect(store.completed).toBeNull();
    expect(store.failures).toEqual([{ code: 'EXECUTION_CONTEXT_UNAVAILABLE', retryable: false }]);
  });

  it('passes a reproduced private context to the provider only after its digest matches', async () => {
    const executionContext = await loadDailyBriefExecutionContext(exampleProfilePath);
    const store = new FakeStore();
    store.claim = { ...claimedRun, contextDigest: executionContext.digest };
    const provider = new ContextCapturingProvider();
    const engine = new ExecutionEngine(
      store,
      provider,
      { ...config, profilePath: exampleProfilePath },
      logger,
    );
    await engine.runNext('worker:test');
    expect(store.completed).not.toBeNull();
    expect(provider.lastRequest?.context).toMatchObject({
      briefingPreferences: { tone: 'concise' },
    });
  });

  it('schedules a retry for malformed provider output', async () => {
    const store = new FakeStore();
    const engine = new ExecutionEngine(store, new MalformedProvider(), config, logger);
    await engine.runNext('worker:test');
    expect(store.failures).toEqual([{ code: 'MODEL_OUTPUT_INVALID_JSON', retryable: true }]);
    expect(store.failureSettlements[0]?.usage).toEqual({ inputTokens: 1, outputTokens: 1 });
    expect(store.failureSettlements[0]?.actualCostUsd).toBeGreaterThan(0);
  });

  it('rejects invalid stored input before invoking model execution', async () => {
    const store = new FakeStore();
    store.claim = { ...claimedRun, input: {} };
    const engine = new ExecutionEngine(
      store,
      new DeterministicDailyBriefProvider(),
      config,
      logger,
    );
    await engine.runNext('worker:test');
    expect(store.failures).toEqual([{ code: 'RUN_INPUT_SCHEMA_INVALID', retryable: false }]);
  });

  it('retries structurally invalid model output', async () => {
    const store = new FakeStore();
    const engine = new ExecutionEngine(store, new WrongShapeProvider(), config, logger);
    await engine.runNext('worker:test');
    expect(store.failures).toEqual([{ code: 'MODEL_OUTPUT_SCHEMA_INVALID', retryable: true }]);
  });

  it('rejects citations that are not grounded in supplied calendar facts', async () => {
    const store = new FakeStore();
    const engine = new ExecutionEngine(store, new InventedCitationProvider(), config, logger);
    await engine.runNext('worker:test');
    expect(store.completed).toBeNull();
    expect(store.failures).toEqual([
      { code: 'MODEL_CITATION_OUTSIDE_INPUT_PROVENANCE', retryable: false },
    ]);
  });

  it('honors cancellation detected by a heartbeat while streaming', async () => {
    const store = new FakeStore();
    store.heartbeatResults = [
      { owned: true, cancellationRequested: false },
      { owned: true, cancellationRequested: true },
    ];
    const engine = new ExecutionEngine(store, new HangingProvider(), config, logger);
    await engine.runNext('worker:test');
    expect(store.cancelled).toBe(true);
    expect(store.failures).toEqual([]);
  });

  it('recovers persisted leases on boot', async () => {
    const store = new FakeStore();
    const engine = new ExecutionEngine(
      store,
      new DeterministicDailyBriefProvider(),
      config,
      logger,
    );
    await engine.recover();
    expect(store.recovered).toBe(true);
  });
});
