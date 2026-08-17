import type { Logger } from 'pino';
import { runAsSystem } from '../request-context.js';

export interface AutomationScheduleResult {
  runIds: string[];
  claimedSchedules: number;
  dispatchesCreated: number;
  runsCreated: number;
  awaitingApproval: number;
  failedDispatches: number;
}

export interface AutomationScheduleTask {
  scheduleDue(now: Date, limit: number): Promise<AutomationScheduleResult>;
}

export interface AutomationSchedulerApi {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Drives persisted automation schedules without owning any scheduling state. Cross-process
 * exclusion, occurrence deduplication, and dispatch leases remain database invariants inside
 * AutomationLearningService; this class only provides a non-overlapping process-local clock.
 */
export class AutomationScheduler implements AutomationSchedulerApi {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private started = false;
  private stopped = false;

  constructor(
    private readonly task: AutomationScheduleTask,
    private readonly enqueueRun: (runId: string) => void,
    private readonly dispatchMode: 'in_process' | 'external',
    private readonly logger: Logger,
    private readonly enabled: boolean,
    private readonly intervalMs: number,
    private readonly batchSize: number,
  ) {}

  async start(): Promise<void> {
    if (this.started || this.stopped) return;
    this.started = true;
    if (!this.enabled) {
      this.logger.info('Automation scheduler is disabled');
      return;
    }
    await this.tick('boot');
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  private scheduleNext(): void {
    if (this.stopped || !this.enabled) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick('scheduled').finally(() => this.scheduleNext());
    }, this.intervalMs);
    this.timer.unref();
  }

  private async tick(reason: 'boot' | 'scheduled'): Promise<void> {
    if (this.stopped || this.inFlight !== undefined) return;
    const operation = runAsSystem(async () => {
      try {
        const result = await this.task.scheduleDue(new Date(), this.batchSize);
        if (this.dispatchMode === 'in_process') {
          result.runIds.forEach((runId) => this.enqueueRun(runId));
        }
        this.logger.info(
          {
            reason,
            claimedSchedules: result.claimedSchedules,
            dispatchesCreated: result.dispatchesCreated,
            runsCreated: result.runsCreated,
            awaitingApproval: result.awaitingApproval,
            failedDispatches: result.failedDispatches,
          },
          'Automation scheduler tick completed',
        );
      } catch (error: unknown) {
        this.logger.error({ err: error, reason }, 'Automation scheduler tick failed');
      }
    });
    this.inFlight = operation;
    try {
      await operation;
    } finally {
      this.inFlight = undefined;
    }
  }
}
