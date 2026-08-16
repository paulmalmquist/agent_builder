import type { Logger } from 'pino';

export interface MaintenanceTask {
  run(reason: 'boot' | 'scheduled'): Promise<void>;
}

export interface MaintenanceSchedulerApi {
  start(): Promise<void>;
  stop(): void;
}

export function millisecondsUntilNextUtcHour(now: Date, hourUtc: number): number {
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

export class MaintenanceScheduler implements MaintenanceSchedulerApi {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(
    private readonly task: MaintenanceTask,
    private readonly logger: Logger,
    private readonly enabled: boolean,
    private readonly hourUtc: number,
  ) {}

  async start(): Promise<void> {
    await this.task.run('boot');
    if (this.enabled) this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    if (this.stopped) return;
    const delay = millisecondsUntilNextUtcHour(new Date(), this.hourUtc);
    this.timer = setTimeout(() => {
      void this.task
        .run('scheduled')
        .catch((error: unknown) => this.logger.error({ error }, 'Nightly maintenance failed'))
        .finally(() => this.schedule());
    }, delay);
    this.timer.unref();
  }
}
