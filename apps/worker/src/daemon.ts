import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { WorkerConfig } from './config.js';
import type { ExecutionEngine } from './engine.js';

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export class WorkerDaemon {
  readonly workerId: string;
  private readonly polling = new AbortController();
  private slots: Promise<void>[] = [];
  private accepting = false;

  constructor(
    private readonly engine: ExecutionEngine,
    private readonly config: WorkerConfig,
    private readonly logger: Logger,
  ) {
    this.workerId = config.workerId ?? `worker:${randomUUID()}`;
  }

  async start(): Promise<void> {
    if (this.accepting) return;
    await this.engine.recover();
    this.accepting = true;
    this.slots = Array.from({ length: this.config.concurrency }, (_, index) =>
      this.slotLoop(`${this.workerId}:${index + 1}`),
    );
    this.logger.info(
      { workerId: this.workerId, concurrency: this.config.concurrency },
      'Paul OS worker started',
    );
  }

  async stop(): Promise<void> {
    if (!this.accepting && this.slots.length === 0) return;
    this.accepting = false;
    this.polling.abort();
    const allSlots = Promise.allSettled(this.slots);
    let timedOut = false;
    let shutdownTimer: NodeJS.Timeout | undefined;
    await Promise.race([
      allSlots,
      new Promise<void>((resolve) => {
        shutdownTimer = setTimeout(() => {
          timedOut = true;
          resolve();
        }, this.config.shutdownTimeoutMs);
      }),
    ]);
    if (shutdownTimer !== undefined) clearTimeout(shutdownTimer);
    if (timedOut) {
      this.engine.abortActive();
      this.logger.warn(
        { activeRuns: this.engine.activeCount() },
        'Graceful shutdown expired; active leases will be recovered',
      );
    }
    this.slots = [];
    this.logger.info({ workerId: this.workerId }, 'Paul OS worker stopped');
  }

  private async slotLoop(slotId: string): Promise<void> {
    while (this.accepting) {
      try {
        const worked = await this.engine.runNext(slotId);
        if (!worked) await delay(this.config.pollMs, this.polling.signal);
      } catch (error: unknown) {
        this.logger.error({ error, slotId }, 'Worker slot failed outside a claimed run');
        await delay(this.config.pollMs, this.polling.signal);
      }
    }
  }
}
