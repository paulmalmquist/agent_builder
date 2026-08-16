import type { Logger } from 'pino';
import { errorMessage } from '../errors.js';
import type { GenerationService } from '../services/generation-service.js';
import type { DispatcherApi } from '../services/types.js';
import type { GeneratorRunner } from './runner.js';
import { GeneratorRunnerError } from './runner.js';
import { Semaphore } from './semaphore.js';

export class GenerationDispatcher implements DispatcherApi {
  private readonly scheduled = new Set<string>();
  private readonly semaphore: Semaphore;

  constructor(
    concurrency: number,
    private readonly generation: GenerationService,
    private readonly runner: GeneratorRunner,
    private readonly logger: Logger,
  ) {
    this.semaphore = new Semaphore(concurrency);
  }

  enqueue(jobId: string): void {
    if (this.scheduled.has(jobId)) return;
    this.scheduled.add(jobId);
    void this.semaphore
      .use(() => this.run(jobId))
      .catch((error: unknown) => {
        this.logger.error({ error, jobId }, 'Generation dispatcher failed');
      })
      .finally(() => {
        this.scheduled.delete(jobId);
      });
  }

  async recoverAndResume(): Promise<void> {
    const reaped = await this.generation.reapRunningJobs();
    const queued = await this.generation.queuedJobIds();
    this.logger.info({ reaped, queued: queued.length }, 'Recovered generation queue');
    queued.forEach((jobId) => this.enqueue(jobId));
  }

  private async run(jobId: string): Promise<void> {
    const input = await this.generation.claim(jobId);
    if (!input) return;
    try {
      const manifest = await this.runner.run(input, (progress) =>
        this.generation.updateProgress(jobId, progress),
      );
      await this.generation.succeed(jobId, manifest);
      this.logger.info(
        { jobId, agentId: input.agentId, specId: input.spec.id },
        'Agent generation succeeded',
      );
    } catch (error: unknown) {
      const code = error instanceof GeneratorRunnerError ? error.code : 'GENERATOR_FAILED';
      await this.generation.fail(jobId, code, errorMessage(error));
      this.logger.warn(
        { error, jobId, agentId: input.agentId, specId: input.spec.id },
        'Agent generation failed',
      );
    }
  }
}
