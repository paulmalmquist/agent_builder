import { Buffer } from 'node:buffer';
import { dailyBriefInputSchema, dailyBriefOutputSchema } from '@agent-builder/contracts';
import type { Logger } from 'pino';
import {
  invalidDailyBriefCitations,
  loadDailyBriefExecutionContext,
  providerContextValues,
  scoreDailyBriefQuality,
  type ModelProvider,
  type ModelRequest,
  type ModelStreamEvent,
  type ModelUsage,
} from '@paul-os/runtime';
import type { WorkerConfig } from './config.js';
import type { ClaimedRun, ProviderUsageSettlement, WorkerStore } from './types.js';

class WorkerFault extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'WorkerFault';
  }
}

class LeaseLost extends Error {}
class RunCancelled extends Error {}
class WorkerStopping extends Error {}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as unknown;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('ABORTED');
}

async function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) throw abortError(signal);
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    void iterator.next().then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error('MODEL_PROVIDER_FAILED'));
      },
    );
  });
}

async function consumeModelStream(
  provider: ModelProvider,
  request: ModelRequest,
  signal: AbortSignal,
  onUsage: (usage: ModelUsage) => void,
): Promise<{ text: string; usage: ModelUsage }> {
  const iterator = provider.stream(request, signal)[Symbol.asyncIterator]();
  let text = '';
  let usage: ModelUsage = { inputTokens: 0, outputTokens: 0 };
  let completed = false;
  const maximumBytes = Math.max(4_096, request.maxOutputTokens * 8);
  try {
    while (true) {
      const next = await nextWithAbort<ModelStreamEvent>(iterator, signal);
      if (next.done) break;
      if (next.value.type === 'text_delta') {
        text += next.value.text;
        if (Buffer.byteLength(text, 'utf8') > maximumBytes) {
          throw new WorkerFault('MODEL_OUTPUT_LIMIT_EXCEEDED', false);
        }
      } else if (next.value.type === 'usage') {
        usage = next.value.usage;
        onUsage(usage);
        if (usage.outputTokens > request.maxOutputTokens) {
          throw new WorkerFault('MODEL_OUTPUT_TOKEN_BUDGET_EXCEEDED', false);
        }
      } else if (next.value.type === 'complete') {
        completed = true;
      }
    }
  } finally {
    if (!completed) void iterator.return?.();
  }
  if (!completed) throw new WorkerFault('MODEL_STREAM_INCOMPLETE', true);
  return { text, usage };
}

function classifyFailure(error: unknown): WorkerFault {
  if (error instanceof WorkerFault) return error;
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new WorkerFault('MODEL_TIMEOUT', true);
  }
  if (error instanceof SyntaxError) return new WorkerFault('MODEL_OUTPUT_INVALID_JSON', true);
  return new WorkerFault('MODEL_PROVIDER_FAILED', true);
}

export class ExecutionEngine {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly store: WorkerStore,
    private readonly provider: ModelProvider,
    private readonly config: WorkerConfig,
    private readonly logger: Logger,
  ) {}

  async recover(): Promise<void> {
    const recovered = await this.store.recoverExpiredLeases();
    this.logger.info(recovered, 'Recovered expired execution leases');
  }

  async runNext(workerId: string): Promise<boolean> {
    const run = await this.store.claimNext(workerId, this.config.leaseMs);
    if (run === null) return false;
    const controller = new AbortController();
    this.active.set(run.id, controller);
    try {
      await this.execute(run, workerId, controller);
    } finally {
      this.active.delete(run.id);
    }
    return true;
  }

  abortActive(): void {
    for (const controller of this.active.values()) controller.abort(new WorkerStopping());
  }

  activeCount(): number {
    return this.active.size;
  }

  private async execute(
    run: ClaimedRun,
    workerId: string,
    controller: AbortController,
  ): Promise<void> {
    let monitoring = true;
    const monitor = this.monitorLease(
      run.id,
      workerId,
      run.productionEpoch,
      controller,
      () => monitoring,
    );
    const started = performance.now();
    let observedUsage: ModelUsage | null = null;
    const incurredUsage = (): ProviderUsageSettlement | undefined => {
      if (observedUsage === null) return undefined;
      return {
        usage: observedUsage,
        actualCostUsd:
          (observedUsage.inputTokens * this.config.pricing.inputUsdPerMillionTokens +
            observedUsage.outputTokens * this.config.pricing.outputUsdPerMillionTokens) /
          1_000_000,
        latencyMs: performance.now() - started,
        pricingVersion: this.config.pricing.version,
        providerKind: this.provider.kind,
        providerVersion: this.provider.version,
        model: this.provider.model,
      };
    };
    try {
      const initialLease = await this.store.heartbeat(
        run.id,
        workerId,
        this.config.leaseMs,
        run.productionEpoch,
      );
      if (!initialLease.owned) throw new LeaseLost();
      if (initialLease.cancellationRequested) throw new RunCancelled();
      this.assertExecutionSnapshot(run);
      const executionContext = await loadDailyBriefExecutionContext(this.config.profilePath).catch(
        () => {
          throw new WorkerFault('EXECUTION_CONTEXT_UNAVAILABLE', false);
        },
      );
      if (executionContext.digest !== run.contextDigest) {
        throw new WorkerFault('EXECUTION_CONTEXT_SNAPSHOT_MISMATCH', false);
      }
      const inputResult = dailyBriefInputSchema.safeParse(run.input);
      if (!inputResult.success) throw new WorkerFault('RUN_INPUT_SCHEMA_INVALID', false);
      const input = inputResult.data;
      const timeout = AbortSignal.timeout(this.config.provider.timeoutMs);
      const signal = AbortSignal.any([controller.signal, timeout]);
      const response = await consumeModelStream(
        this.provider,
        {
          system:
            'Create a concise daily briefing. Return only JSON matching the requested output contract. Never invent source facts or citations.',
          input,
          context: providerContextValues(executionContext),
          maxOutputTokens: run.maxOutputTokens,
          timeoutMs: this.config.provider.timeoutMs,
        },
        signal,
        (usage) => {
          observedUsage = usage;
        },
      );
      if (response.usage.inputTokens > run.maxInputTokens) {
        throw new WorkerFault('MODEL_INPUT_TOKEN_BUDGET_EXCEEDED', false);
      }
      const outputResult = dailyBriefOutputSchema.safeParse(extractJson(response.text));
      if (!outputResult.success) throw new WorkerFault('MODEL_OUTPUT_SCHEMA_INVALID', true);
      const output = outputResult.data;
      if (invalidDailyBriefCitations(input, output).length > 0) {
        throw new WorkerFault('MODEL_CITATION_OUTSIDE_INPUT_PROVENANCE', false);
      }
      const actualCostUsd =
        (response.usage.inputTokens * this.config.pricing.inputUsdPerMillionTokens +
          response.usage.outputTokens * this.config.pricing.outputUsdPerMillionTokens) /
        1_000_000;
      const completed = await this.store.complete(run, workerId, {
        output,
        usage: response.usage,
        actualCostUsd,
        latencyMs: performance.now() - started,
        qualityScore: scoreDailyBriefQuality(input, output),
        pricingVersion: this.config.pricing.version,
        providerKind: this.provider.kind,
        providerVersion: this.provider.version,
        model: this.provider.model,
      });
      if (completed) this.logger.info({ runId: run.id }, 'Execution run completed');
    } catch (error: unknown) {
      this.logger.debug(
        {
          runId: run.id,
          causeName: error instanceof Error ? error.name : typeof error,
          causeMessage: error instanceof Error ? error.message : 'non-error rejection',
        },
        'Execution fault classified',
      );
      if (error instanceof WorkerStopping) {
        this.logger.info({ runId: run.id }, 'Worker stopped with run lease left for recovery');
        return;
      }
      if (error instanceof LeaseLost) {
        this.logger.warn({ runId: run.id }, 'Execution lease was lost; discarded worker result');
        return;
      }
      if (error instanceof RunCancelled) {
        await this.store.cancelClaimed(run.id, workerId, incurredUsage());
        this.logger.info({ runId: run.id }, 'Execution run cancelled');
        return;
      }
      const failure = classifyFailure(error);
      const disposition = await this.store.failOrRetry(
        run,
        workerId,
        failure.code,
        failure.retryable,
        incurredUsage(),
      );
      this.logger.warn(
        { runId: run.id, code: failure.code, disposition: disposition.state },
        'Execution run did not complete',
      );
    } finally {
      monitoring = false;
      if (!controller.signal.aborted) controller.abort(new Error('MONITOR_STOPPED'));
      await monitor;
    }
  }

  private assertExecutionSnapshot(run: ClaimedRun): void {
    if (
      run.providerKind !== this.provider.kind ||
      run.providerVersion !== this.provider.version ||
      run.model !== this.provider.model
    ) {
      throw new WorkerFault('MODEL_PROVIDER_SNAPSHOT_MISMATCH', false);
    }
    if (run.pricingVersion !== this.config.pricing.version) {
      throw new WorkerFault('MODEL_PRICING_SNAPSHOT_MISMATCH', false);
    }
  }

  private async monitorLease(
    runId: string,
    workerId: string,
    productionEpoch: string | null,
    controller: AbortController,
    shouldContinue: () => boolean,
  ): Promise<void> {
    while (shouldContinue() && !controller.signal.aborted) {
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          controller.signal.removeEventListener('abort', onAbort);
          resolve();
        }, this.config.heartbeatMs);
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      if (!shouldContinue() || controller.signal.aborted) return;
      try {
        const heartbeat = await this.store.heartbeat(
          runId,
          workerId,
          this.config.leaseMs,
          productionEpoch,
        );
        if (!heartbeat.owned) controller.abort(new LeaseLost());
        else if (heartbeat.cancellationRequested) controller.abort(new RunCancelled());
      } catch {
        controller.abort(new WorkerFault('HEARTBEAT_FAILED', true));
      }
    }
  }
}
