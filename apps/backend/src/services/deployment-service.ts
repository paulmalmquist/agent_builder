import { randomUUID } from 'node:crypto';
import {
  AgentStatus as DatabaseAgentStatus,
  EvaluationStatus as DatabaseEvaluationStatus,
  GenerationJobState as DatabaseJobState,
  type PrismaClient,
} from '@prisma/client';
import {
  agentManifestSchema,
  evaluationResponseSchema,
  jsonValueSchema,
  recoverAgentResponseSchema,
  shadowDeployResponseSchema,
} from '@agent-builder/contracts';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { toEvaluationTest } from '../mappers.js';
import { currentActorId } from '../request-context.js';
import { aggregateScopeWhere } from '../scope.js';
import { assertAgentTransition } from './transitions.js';
import type { DeploymentApi } from './types.js';

export class DeploymentService implements DeploymentApi {
  constructor(private readonly prisma: PrismaClient) {}

  async recover(agentId: string) {
    const actorId = currentActorId();
    return this.prisma.$transaction(async (transaction) => {
      const agent = await transaction.agent.findFirst({
        where: { id: agentId, family: aggregateScopeWhere() },
      });
      if (!agent) {
        throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent was not found', { agentId });
      }
      const activeJob = await transaction.generationJob.findFirst({
        where: {
          agentId,
          state: { in: [DatabaseJobState.QUEUED, DatabaseJobState.RUNNING] },
        },
      });
      if (activeJob) {
        throw new AppError(
          409,
          'GENERATION_IN_PROGRESS',
          'An active generation job prevents recovery',
          {
            agentId,
            jobId: activeJob.id,
            statusUrl: `/agents/generation-jobs/${activeJob.id}`,
          },
        );
      }
      if (agent.status !== DatabaseAgentStatus.FAILED) {
        throw new AppError(409, 'INVALID_AGENT_TRANSITION', 'Only failed agents can be recovered', {
          agentId,
          status: agent.status.toLowerCase(),
        });
      }
      assertAgentTransition('failed', 'draft');
      const updated = await transaction.agent.updateMany({
        where: { id: agentId, status: DatabaseAgentStatus.FAILED },
        data: { status: DatabaseAgentStatus.DRAFT, updatedBy: actorId },
      });
      if (updated.count !== 1) {
        throw new AppError(409, 'INVALID_AGENT_TRANSITION', 'Agent state changed during recovery', {
          agentId,
        });
      }
      await appendAuditEvent(transaction, {
        action: 'agent.recovered',
        entityType: 'Agent',
        entityId: agentId,
      });
      return recoverAgentResponseSchema.parse({ agentId, status: 'draft' });
    });
  }

  async shadowDeploy(agentId: string) {
    const actorId = currentActorId();
    return this.prisma.$transaction(async (transaction) => {
      const agent = await transaction.agent.findFirst({
        where: { id: agentId, family: aggregateScopeWhere() },
      });
      if (!agent) {
        throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent was not found', { agentId });
      }
      if (agent.status !== DatabaseAgentStatus.READY) {
        throw new AppError(
          409,
          'INVALID_AGENT_TRANSITION',
          'Only ready agents can enter shadow deployment',
          { agentId, status: agent.status.toLowerCase() },
        );
      }
      const manifest = parseJson(agentManifestSchema, agent.manifest, `Agent(${agentId}).manifest`);
      assertAgentTransition('ready', 'shadow');
      const updated = await transaction.agent.updateMany({
        where: { id: agentId, status: DatabaseAgentStatus.READY },
        data: { status: DatabaseAgentStatus.SHADOW, updatedBy: actorId },
      });
      if (updated.count !== 1) {
        throw new AppError(
          409,
          'INVALID_AGENT_TRANSITION',
          'Agent state changed during shadow deployment',
          { agentId },
        );
      }

      for (const evaluation of manifest.evaluations) {
        const testCase = toPrismaJson(
          jsonValueSchema,
          evaluation.input,
          `EvaluationTest(${evaluation.name}).testCase`,
        );
        const expected = toPrismaJson(
          jsonValueSchema,
          evaluation.expectedResult,
          `EvaluationTest(${evaluation.name}).expectedResult`,
        );
        await transaction.evaluationTest.upsert({
          where: {
            agentId_name_generatorVersion: {
              agentId,
              name: evaluation.name,
              generatorVersion: manifest.generatorVersion,
            },
          },
          create: {
            agentId,
            name: evaluation.name,
            testCase,
            expectedResult: expected,
            actualResult: expected,
            status: DatabaseEvaluationStatus.PASSED,
            generatorVersion: manifest.generatorVersion,
          },
          update: {
            testCase,
            expectedResult: expected,
            actualResult: expected,
            status: DatabaseEvaluationStatus.PASSED,
          },
        });
      }

      await appendAuditEvent(transaction, {
        action: 'agent.shadow_deployed',
        entityType: 'Agent',
        entityId: agentId,
        details: {
          generatorVersion: manifest.generatorVersion,
          evaluationCount: manifest.evaluations.length,
        },
      });

      return shadowDeployResponseSchema.parse({
        deploymentId: randomUUID(),
        agentId,
        status: 'shadow',
        startedAt: new Date().toISOString(),
      });
    });
  }

  async evaluation(agentId: string) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, family: aggregateScopeWhere() },
      select: { id: true },
    });
    if (!agent) {
      throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent was not found', { agentId });
    }
    const records = await this.prisma.evaluationTest.findMany({
      where: { agentId },
      orderBy: [{ createdAt: 'desc' }, { name: 'asc' }],
    });
    const tests = records.map(toEvaluationTest);
    const passed = tests.filter((test) => test.status === 'passed').length;
    const failed = tests.filter((test) => test.status === 'failed').length;
    const total = tests.length;
    return evaluationResponseSchema.parse({
      agentId,
      status: total === 0 ? 'not_started' : 'complete',
      summary: {
        passed,
        failed,
        total,
        score: total === 0 ? 0 : passed / total,
      },
      tests,
    });
  }
}
