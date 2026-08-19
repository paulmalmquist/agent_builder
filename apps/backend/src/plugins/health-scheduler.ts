import type { Logger } from 'pino';
import { runAsSystem } from '../request-context.js';
import type { PluginService } from '../services/plugin-service.js';

export interface PluginHealthSchedulerApi {
  start(): Promise<void>;
  stop(): void;
}

export class PluginHealthScheduler implements PluginHealthSchedulerApi {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

  constructor(
    private readonly plugins: PluginService,
    private readonly logger: Logger,
    private readonly enabled: boolean,
    private readonly intervalMs = 30_000,
    private readonly batchSize = 100,
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
      const result = await runAsSystem(() => this.plugins.checkDueHealth(this.batchSize));
      if (result.failed > 0) {
        this.logger.warn(
          { checked: result.checked, failed: result.failed },
          'Some Plugin health checks could not be persisted',
        );
      }
    } catch {
      this.logger.warn('Plugin health-check cycle could not complete');
    } finally {
      this.running = false;
    }
  }
}
