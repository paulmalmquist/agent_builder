import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import { Semaphore } from '../generation/semaphore.js';
import { runAsSystem } from '../request-context.js';
import type { ExecutionWorkerApi } from '../services/execution-service.js';

export interface ExecutionDispatcherApi {
  enqueue(runId: string): void;
  recoverAndResume(): Promise<void>;
}

export class ExecutionDispatcher implements ExecutionDispatcherApi {
  private readonly scheduled = new Set<string>();
  private readonly semaphore: Semaphore;
  private readonly workerId = `backend:${randomUUID()}`;

  constructor(
    concurrency: number,
    private readonly work: ExecutionWorkerApi,
    private readonly logger: Logger,
    private readonly leaseMs: number,
  ) {
    this.semaphore = new Semaphore(concurrency);
  }

  enqueue(runId: string): void {
    if (this.scheduled.has(runId)) return;
    this.scheduled.add(runId);
    void this.semaphore
      .use(() => runAsSystem(() => this.run(runId)))
      .catch((error: unknown) =>
        this.logger.error({ err: error, runId }, 'Execution dispatcher failed'),
      )
      .finally(() => this.scheduled.delete(runId));
  }

  async recoverAndResume(): Promise<void> {
    const recovered = await this.work.recoverExpiredLeases();
    const queued = await this.work.queuedRunIds();
    this.logger.info({ recovered, queued: queued.length }, 'Recovered Paul OS execution queue');
    queued.forEach((runId) => this.enqueue(runId));
  }

  private async run(runId: string): Promise<void> {
    if (!(await this.work.claim(runId, this.workerId, this.leaseMs))) return;
    try {
      await this.work.executeClaimed(runId, this.workerId);
      this.logger.info({ runId }, 'Paul OS execution succeeded');
    } catch (error: unknown) {
      await this.work.failClaimed(runId, this.workerId, 'EXECUTION_FAILED');
      this.logger.warn({ err: error, runId }, 'Paul OS execution failed');
    }
  }
}
