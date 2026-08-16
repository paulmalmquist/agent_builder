import { AppError } from '../errors.js';

export interface OutboundPolicyOptions {
  timeoutMs: number;
  maxRetries: number;
  baseDelayMs: number;
  cacheTtlMs: number;
  circuitFailureThreshold: number;
  circuitResetMs: number;
}

export class OutboundHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'OutboundHttpError';
  }
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

interface CircuitState {
  failures: number;
  openUntil: number;
}

const retryable = (error: unknown): boolean =>
  (error instanceof OutboundHttpError && (error.status === 429 || error.status >= 500)) ||
  (error instanceof AppError && error.status === 503);

/** Shared timeout/retry/circuit/cache policy for future live HTTP provider connectors. */
export class OutboundHttpPolicy {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly circuits = new Map<string, CircuitState>();

  constructor(
    private readonly options: OutboundPolicyOptions,
    private readonly now: () => number = Date.now,
    private readonly random: () => number = Math.random,
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  ) {}

  async execute<T>(
    dependency: string,
    descriptorId: string,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const cacheKey = `${dependency}:${descriptorId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.value as T;
    if (cached) this.cache.delete(cacheKey);

    const circuit = this.circuits.get(dependency);
    if (circuit && circuit.openUntil > this.now()) {
      throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', `${dependency} circuit is open`, {
        dependency,
        retryAfterMs: circuit.openUntil - this.now(),
      });
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      try {
        const result = await this.withTimeout(operation);
        this.circuits.delete(dependency);
        this.cache.set(cacheKey, {
          expiresAt: this.now() + this.options.cacheTtlMs,
          value: result,
        });
        return result;
      } catch (error: unknown) {
        lastError = error;
        if (!retryable(error) || attempt === this.options.maxRetries) break;
        const exponential = this.options.baseDelayMs * 2 ** attempt;
        const jitter = 0.5 + this.random();
        await this.delay(Math.round(exponential * jitter));
      }
    }

    if (lastError instanceof AppError && !retryable(lastError)) throw lastError;
    const nextFailures = (this.circuits.get(dependency)?.failures ?? 0) + 1;
    this.circuits.set(dependency, {
      failures: nextFailures,
      openUntil:
        nextFailures >= this.options.circuitFailureThreshold
          ? this.now() + this.options.circuitResetMs
          : 0,
    });
    throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', `${dependency} request failed`, {
      dependency,
      retryable: retryable(lastError),
    });
  }

  clear(descriptorId?: string): void {
    if (descriptorId === undefined) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.endsWith(`:${descriptorId}`)) this.cache.delete(key);
    }
  }

  private async withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new OutboundHttpError(504, 'Outbound request timed out'));
      }, this.options.timeoutMs);
      timeout.unref();
    });
    try {
      return await Promise.race([operation(controller.signal), timeoutPromise]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }
}
