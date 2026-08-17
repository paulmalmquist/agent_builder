import {
  AgentStatus as DatabaseAgentStatus,
  GenerationJobState as DatabaseJobState,
  Prisma,
  SpecStatus as DatabaseSpecStatus,
  type PrismaClient,
} from '@prisma/client';
import {
  agentManifestSchema,
  generationAcceptedSchema,
  generationErrorSchema,
  generatorInputSchema,
  specSnapshotSchema,
  type AgentManifest,
  type GenerationJob,
  type GeneratorInput,
  type GeneratorProgress,
} from '@agent-builder/contracts';
import type { AppConfig } from '../config.js';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { toGenerationJob, toSpecSnapshot } from '../mappers.js';
import { currentActorId } from '../request-context.js';
import { aggregateScopeWhere } from '../scope.js';
import { assertAgentTransition, assertJobTransition, assertSpecTransition } from './transitions.js';
import type { GenerationApi } from './types.js';

const activeJobStates = [DatabaseJobState.QUEUED, DatabaseJobState.RUNNING];

export class GenerationService implements GenerationApi {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: Pick<AppConfig, 'generatorVersion'>,
  ) {}

  async accept(specId: string) {
    const actorId = currentActorId();
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const spec = await transaction.agentSpec.findFirst({
            where: { id: specId, agent: { family: aggregateScopeWhere() } },
            include: { agent: true },
          });
          if (!spec) {
            throw new AppError(404, 'SPEC_NOT_FOUND', 'Agent specification was not found', {
              specId,
            });
          }

          const existingJob = await transaction.generationJob.findFirst({
            where: { agentId: spec.agentId, state: { in: activeJobStates } },
            orderBy: { createdAt: 'desc' },
          });
          if (existingJob) {
            throw this.generationInProgress(existingJob.id, existingJob.agentId);
          }

          const missingSections = (
            [
              ['outcomes', spec.outcomes],
              ['knowledge', spec.knowledge],
              ['guardrails', spec.guardrails],
              ['outputs', spec.outputs],
            ] as const
          )
            .filter(([, value]) => value === null)
            .map(([name]) => name);
          if (spec.status === DatabaseSpecStatus.DRAFT || missingSections.length > 0) {
            throw new AppError(422, 'SPEC_NOT_READY', 'All specification sections are required', {
              missingSections,
            });
          }
          if (spec.status !== DatabaseSpecStatus.READY) {
            throw new AppError(409, 'SPEC_LOCKED', 'Specification is not available to generate', {
              specId,
              status: spec.status.toLowerCase(),
            });
          }
          if (spec.agent.status === DatabaseAgentStatus.FAILED) {
            throw new AppError(
              409,
              'AGENT_RECOVERY_REQUIRED',
              'Recover the failed agent before generating again',
              { agentId: spec.agentId },
            );
          }
          if (spec.agent.status !== DatabaseAgentStatus.DRAFT) {
            throw new AppError(
              409,
              'INVALID_AGENT_TRANSITION',
              'Only draft agents can enter generation',
              { agentId: spec.agentId, status: spec.agent.status.toLowerCase() },
            );
          }

          assertSpecTransition('ready', 'generating');
          assertAgentTransition('draft', 'generating');
          const snapshot = toSpecSnapshot(spec);
          const updatedSpec = await transaction.agentSpec.updateMany({
            where: {
              id: spec.id,
              status: DatabaseSpecStatus.READY,
              revision: spec.revision,
            },
            data: { status: DatabaseSpecStatus.GENERATING, updatedBy: actorId },
          });
          const updatedAgent = await transaction.agent.updateMany({
            where: { id: spec.agentId, status: DatabaseAgentStatus.DRAFT },
            data: { status: DatabaseAgentStatus.GENERATING, updatedBy: actorId },
          });
          if (updatedSpec.count !== 1 || updatedAgent.count !== 1) {
            throw new AppError(
              409,
              'GENERATION_IN_PROGRESS',
              'Specification state changed while generation was being accepted',
            );
          }

          const job = await transaction.generationJob.create({
            data: {
              agentId: spec.agentId,
              specId: spec.id,
              state: DatabaseJobState.QUEUED,
              progress: 0,
              message: 'Queued for generation',
              specRevision: spec.revision,
              generatorVersion: this.config.generatorVersion,
              specSnapshot: toPrismaJson(
                specSnapshotSchema,
                snapshot,
                `GenerationJob(${spec.id}).specSnapshot`,
              ),
            },
          });
          await appendAuditEvent(transaction, {
            action: 'generation.queued',
            entityType: 'GenerationJob',
            entityId: job.id,
            details: {
              agentId: job.agentId,
              specId: job.specId,
              specRevision: job.specRevision,
              generatorVersion: job.generatorVersion,
            },
          });
          return generationAcceptedSchema.parse({
            jobId: job.id,
            agentId: job.agentId,
            state: 'queued',
            statusUrl: `/agents/generation-jobs/${job.id}`,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof AppError) {
        if (error.code === 'GENERATION_IN_PROGRESS' && error.details === undefined) {
          const existing = await this.prisma.generationJob.findFirst({
            where: { specId, agent: { family: aggregateScopeWhere() } },
            orderBy: { createdAt: 'desc' },
          });
          if (existing) throw this.generationInProgress(existing.id, existing.agentId);
        }
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        const existing = await this.prisma.generationJob.findFirst({
          where: {
            specId,
            agent: { family: aggregateScopeWhere() },
            ...(error.code === 'P2002' ? { state: { in: activeJobStates } } : {}),
          },
          orderBy: { createdAt: 'desc' },
        });
        if (existing) throw this.generationInProgress(existing.id, existing.agentId);
      }
      throw error;
    }
  }

  async getJob(jobId: string): Promise<GenerationJob> {
    const job = await this.prisma.generationJob.findFirst({
      where: { id: jobId, agent: { family: aggregateScopeWhere() } },
    });
    if (!job) {
      throw new AppError(404, 'GENERATION_JOB_NOT_FOUND', 'Generation job was not found', {
        jobId,
      });
    }
    return toGenerationJob(job);
  }

  async claim(jobId: string): Promise<GeneratorInput | null> {
    return this.prisma.$transaction(async (transaction) => {
      const job = await transaction.generationJob.findFirst({
        where: { id: jobId, agent: { family: aggregateScopeWhere() } },
      });
      if (!job || job.state !== DatabaseJobState.QUEUED) return null;
      assertJobTransition('queued', 'running');
      const claimed = await transaction.generationJob.updateMany({
        where: { id: jobId, state: DatabaseJobState.QUEUED },
        data: {
          state: DatabaseJobState.RUNNING,
          progress: Math.max(job.progress, 1),
          message: 'Generator started',
          startedAt: new Date(),
        },
      });
      if (claimed.count !== 1) return null;
      await appendAuditEvent(transaction, {
        action: 'generation.started',
        entityType: 'GenerationJob',
        entityId: job.id,
        details: { agentId: job.agentId, specId: job.specId },
      });
      return generatorInputSchema.parse({
        agentId: job.agentId,
        spec: parseJson(
          specSnapshotSchema,
          job.specSnapshot,
          `GenerationJob(${job.id}).specSnapshot`,
        ),
      });
    });
  }

  async updateProgress(jobId: string, progress: GeneratorProgress): Promise<void> {
    await this.prisma.generationJob.updateMany({
      where: { id: jobId, state: DatabaseJobState.RUNNING },
      data: {
        progress: Math.min(progress.progress, 99),
        message: progress.message.slice(0, 500),
      },
    });
  }

  async succeed(jobId: string, rawManifest: AgentManifest): Promise<void> {
    const manifest = agentManifestSchema.parse(rawManifest);
    const actorId = currentActorId();
    await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.generationJob.findFirst({
        where: { id: jobId, agent: { family: aggregateScopeWhere() } },
      });
      if (!job || job.state !== DatabaseJobState.RUNNING) return;
      if (
        manifest.agentId !== job.agentId ||
        manifest.specRevision !== job.specRevision ||
        manifest.generatorVersion !== job.generatorVersion
      ) {
        throw new AppError(
          409,
          'GENERATOR_CONTRACT_MISMATCH',
          'Generator manifest identity does not match the accepted job',
        );
      }
      assertJobTransition('running', 'succeeded');
      assertAgentTransition('generating', 'ready');
      assertSpecTransition('generating', 'generated');
      const manifestJson = toPrismaJson(
        agentManifestSchema,
        manifest,
        `GenerationJob(${jobId}).manifest`,
      );
      await transaction.generationJob.update({
        where: { id: jobId },
        data: {
          state: DatabaseJobState.SUCCEEDED,
          progress: 100,
          message: 'Generation complete',
          manifest: manifestJson,
          error: Prisma.DbNull,
          finishedAt: new Date(),
        },
      });
      await transaction.agent.update({
        where: { id: job.agentId },
        data: {
          status: DatabaseAgentStatus.READY,
          manifest: manifestJson,
          manifestHash: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
          updatedBy: actorId,
        },
      });
      await transaction.agentSpec.update({
        where: { id: job.specId },
        data: { status: DatabaseSpecStatus.GENERATED, updatedBy: actorId },
      });
      await appendAuditEvent(transaction, {
        action: 'generation.succeeded',
        entityType: 'GenerationJob',
        entityId: job.id,
        details: { agentId: job.agentId, specId: job.specId },
      });
    });
  }

  async fail(jobId: string, code: string, message: string): Promise<void> {
    const error = generationErrorSchema.parse({ code, message });
    const actorId = currentActorId();
    await this.prisma.$transaction(async (transaction) => {
      const job = await transaction.generationJob.findFirst({
        where: { id: jobId, agent: { family: aggregateScopeWhere() } },
      });
      if (
        !job ||
        job.state === DatabaseJobState.SUCCEEDED ||
        job.state === DatabaseJobState.FAILED
      ) {
        return;
      }
      assertJobTransition(job.state === DatabaseJobState.QUEUED ? 'queued' : 'running', 'failed');
      await transaction.generationJob.update({
        where: { id: jobId },
        data: {
          state: DatabaseJobState.FAILED,
          message: message.slice(0, 500),
          error: toPrismaJson(generationErrorSchema, error, `GenerationJob(${jobId}).error`),
          finishedAt: new Date(),
        },
      });
      await transaction.agent.updateMany({
        where: { id: job.agentId, status: DatabaseAgentStatus.GENERATING },
        data: { status: DatabaseAgentStatus.FAILED, updatedBy: actorId },
      });
      await transaction.agentSpec.updateMany({
        where: { id: job.specId, status: DatabaseSpecStatus.GENERATING },
        data: { status: DatabaseSpecStatus.READY, updatedBy: actorId },
      });
      await appendAuditEvent(transaction, {
        action: 'generation.failed',
        entityType: 'GenerationJob',
        entityId: job.id,
        details: { agentId: job.agentId, specId: job.specId, code },
      });
    });
  }

  async reapRunningJobs(): Promise<number> {
    const running = await this.prisma.generationJob.findMany({
      where: { state: DatabaseJobState.RUNNING, agent: { family: aggregateScopeWhere() } },
      select: { id: true },
    });
    for (const job of running) {
      await this.fail(
        job.id,
        'ORPHANED_ON_RESTART',
        'Backend restarted while generation was running',
      );
    }
    return running.length;
  }

  async queuedJobIds(): Promise<string[]> {
    const jobs = await this.prisma.generationJob.findMany({
      where: { state: DatabaseJobState.QUEUED, agent: { family: aggregateScopeWhere() } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return jobs.map((job) => job.id);
  }

  private generationInProgress(jobId: string, agentId: string): AppError {
    return new AppError(409, 'GENERATION_IN_PROGRESS', 'Generation is already in progress', {
      jobId,
      agentId,
      statusUrl: `/agents/generation-jobs/${jobId}`,
    });
  }
}
import { createHash } from 'node:crypto';
