import type { Logger } from 'pino';
import type { CatalogIndexService } from '../services/reuse-service.js';

export interface CatalogIndexSchedulerApi {
  start(): Promise<void>;
  stop(): void;
}

/** Small outbox consumer. The durable outbox remains safe to move to the worker in a later cutover. */
export class CatalogIndexScheduler implements CatalogIndexSchedulerApi {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly indexer: CatalogIndexService,
    private readonly logger: Logger,
    private readonly enabled: boolean,
    private readonly intervalMs = 15_000,
    private readonly batchSize = 25,
  ) {}

  async start(): Promise<void> {
    if (!this.enabled || this.timer !== undefined) return;
    await this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.indexer.processPending(this.batchSize);
      if (result.failed > 0) {
        this.logger.warn(result, 'Some catalog index outbox events will be retried');
      }
    } catch {
      this.logger.warn('Catalog index cycle could not complete');
    } finally {
      this.running = false;
    }
  }
}
