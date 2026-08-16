import type { Logger } from 'pino';
import { errorMessage } from '../errors.js';
import { Semaphore } from '../generation/semaphore.js';
import { runAsSystem } from '../request-context.js';

export interface CertificationWorkQueue {
  reapRunningRuns(): Promise<number>;
  queuedRunIds(): Promise<string[]>;
  executeRun(runId: string): Promise<void>;
  failRun(runId: string, code: string, message: string): Promise<void>;
}

export interface CertificationDispatcherApi {
  enqueue(runId: string): void;
  recoverAndResume(): Promise<void>;
}

class CertificationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Certification exceeded ${timeoutMs}ms`);
    this.name = 'CertificationTimeoutError';
  }
}

export class CertificationDispatcher implements CertificationDispatcherApi {
  private readonly scheduled = new Set<string>();
  private readonly semaphore: Semaphore;

  constructor(
    concurrency: number,
    private readonly work: CertificationWorkQueue,
    private readonly logger: Logger,
    private readonly timeoutMs: number,
  ) {
    this.semaphore = new Semaphore(concurrency);
  }

  enqueue(runId: string): void {
    if (this.scheduled.has(runId)) return;
    this.scheduled.add(runId);
    void this.semaphore
      .use(() => runAsSystem(() => this.runWithTimeout(runId)))
      .catch((error: unknown) => {
        this.logger.error({ error, runId }, 'Certification dispatcher failed');
      })
      .finally(() => this.scheduled.delete(runId));
  }

  async recoverAndResume(): Promise<void> {
    const reaped = await this.work.reapRunningRuns();
    const queued = await this.work.queuedRunIds();
    this.logger.info({ reaped, queued: queued.length }, 'Recovered certification queue');
    queued.forEach((runId) => this.enqueue(runId));
  }

  private async runWithTimeout(runId: string): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const execution = this.work.executeRun(runId);
    try {
      await Promise.race([
        execution,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new CertificationTimeoutError(this.timeoutMs)),
            this.timeoutMs,
          );
          timer.unref();
        }),
      ]);
    } catch (error: unknown) {
      timedOut = error instanceof CertificationTimeoutError;
      await this.work.failRun(
        runId,
        timedOut ? 'CERTIFICATION_TIMEOUT' : 'CERTIFICATION_EXECUTION_ERROR',
        errorMessage(error),
      );
      this.logger.warn({ error, runId }, 'Certification run failed');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    // The executor API cannot yet cancel work. Keep the semaphore permit until a
    // timed-out execution actually settles so zombie work can never exceed the
    // configured concurrency. CertificationService's terminal CAS prevents a
    // late result from changing the persisted timeout outcome.
    if (timedOut) await execution.catch(() => undefined);
  }
}
