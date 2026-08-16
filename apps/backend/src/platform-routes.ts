import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import {
  automationScheduleListQuerySchema,
  automationScheduleListResponseSchema,
  automationScheduleSchema,
  approveExecutionRunRequestSchema,
  approveExecutionRunResponseSchema,
  authorityGrantListQuerySchema,
  authorityGrantListResponseSchema,
  authorityGrantSchema,
  createAuthorityGrantRequestSchema,
  createAutomationScheduleRequestSchema,
  createExecutionRunRequestSchema,
  createImprovementCandidateRequestSchema,
  createMemoryCandidateRequestSchema,
  createObservationRequestSchema,
  createReleaseEvaluationRequestSchema,
  createReleaseRequestSchema,
  executionRunListQuerySchema,
  executionRunListResponseSchema,
  executionRunSchema,
  improvementCandidateListQuerySchema,
  improvementCandidateListResponseSchema,
  improvementCandidateSchema,
  memoryCandidateListQuerySchema,
  memoryCandidateListResponseSchema,
  memoryCandidateSchema,
  metricListQuerySchema,
  metricListResponseSchema,
  observationListQuerySchema,
  observationListResponseSchema,
  observationSchema,
  outcomeListQuerySchema,
  outcomeListResponseSchema,
  productionChannelKeySchema,
  productionChannelMutationResponseSchema,
  productionChannelSchema,
  promoteReleaseRequestSchema,
  releaseEvaluationSchema,
  rollbackReleaseRequestSchema,
  releaseBundleSchema,
  repositoryImportRequestSchema,
  repositoryImportResponseSchema,
  resourceListQuerySchema,
  resourceListResponseSchema,
  reviewImprovementCandidateRequestSchema,
  reviewMemoryCandidateRequestSchema,
  scheduleDueAutomationsRequestSchema,
  scheduleDueAutomationsResponseSchema,
  updateAutomationScheduleStateRequestSchema,
  uuidSchema,
} from '@agent-builder/contracts';
import type { z } from 'zod';
import type { PlatformServices } from './services/types.js';

const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<void>): RequestHandler =>
  (request, response, next) => {
    void handler(request, response).catch(next);
  };

const uuidParam =
  (
    name: 'releaseId' | 'grantId' | 'runId' | 'evaluationId' | 'scheduleId' | 'candidateId',
  ): RequestHandler =>
  (request, _response, next: NextFunction) => {
    const value = request.params[name];
    if (typeof value !== 'string' || !uuidSchema.safeParse(value).success) {
      next('route');
      return;
    }
    next();
  };

function send<TSchema extends z.ZodTypeAny>(
  response: Response,
  status: number,
  schema: TSchema,
  value: unknown,
): void {
  response.status(status).json(schema.parse(value));
}

export function registerPlatformRoutes(router: Router, services: PlatformServices): void {
  router.get(
    '/v1/resources',
    asyncRoute(async (request, response) => {
      const query = resourceListQuerySchema.parse(request.query);
      send(response, 200, resourceListResponseSchema, await services.registry.listResources(query));
    }),
  );
  router.post(
    '/v1/repository-imports',
    asyncRoute(async (request, response) => {
      const input = repositoryImportRequestSchema.parse(request.body);
      send(
        response,
        201,
        repositoryImportResponseSchema,
        await services.registry.importResource(input),
      );
    }),
  );
  router.post(
    '/v1/releases',
    asyncRoute(async (request, response) => {
      const input = createReleaseRequestSchema.parse(request.body);
      send(response, 201, releaseBundleSchema, await services.registry.createRelease(input));
    }),
  );
  router.get(
    '/v1/releases/:releaseId',
    uuidParam('releaseId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        releaseBundleSchema,
        await services.registry.getRelease(request.params['releaseId'] as string),
      );
    }),
  );
  router.post(
    '/v1/release-evaluations',
    asyncRoute(async (request, response) => {
      const input = createReleaseEvaluationRequestSchema.parse(request.body);
      send(
        response,
        201,
        releaseEvaluationSchema,
        await services.releaseGovernance.evaluate(input),
      );
    }),
  );
  router.get(
    '/v1/release-evaluations/:evaluationId',
    uuidParam('evaluationId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        releaseEvaluationSchema,
        await services.releaseGovernance.getEvaluation(request.params['evaluationId'] as string),
      );
    }),
  );
  router.get(
    '/v1/production-channels/:channelKey',
    asyncRoute(async (request, response) => {
      const channelKey = productionChannelKeySchema.parse(request.params['channelKey']);
      send(
        response,
        200,
        productionChannelSchema,
        await services.releaseGovernance.getChannel(channelKey),
      );
    }),
  );
  router.post(
    '/v1/production-channels/:channelKey/promote',
    asyncRoute(async (request, response) => {
      const channelKey = productionChannelKeySchema.parse(request.params['channelKey']);
      const input = promoteReleaseRequestSchema.parse(request.body);
      send(
        response,
        200,
        productionChannelMutationResponseSchema,
        await services.releaseGovernance.promote(channelKey, input),
      );
    }),
  );
  router.post(
    '/v1/production-channels/:channelKey/rollback',
    asyncRoute(async (request, response) => {
      const channelKey = productionChannelKeySchema.parse(request.params['channelKey']);
      const input = rollbackReleaseRequestSchema.parse(request.body);
      send(
        response,
        200,
        productionChannelMutationResponseSchema,
        await services.releaseGovernance.rollback(channelKey, input),
      );
    }),
  );
  router.post(
    '/v1/automation-schedules/schedule-due',
    asyncRoute(async (request, response) => {
      const input = scheduleDueAutomationsRequestSchema.parse(request.body);
      const result = await services.automationLearning.scheduleDue(
        input.now === undefined ? new Date() : new Date(input.now),
        input.limit,
      );
      if (services.dispatchMode === 'in_process') {
        result.runIds.forEach((runId) => services.executionDispatcher.enqueue(runId));
      }
      send(response, 200, scheduleDueAutomationsResponseSchema, result);
    }),
  );
  router.get(
    '/v1/automation-schedules',
    asyncRoute(async (request, response) => {
      const query = automationScheduleListQuerySchema.parse(request.query);
      send(
        response,
        200,
        automationScheduleListResponseSchema,
        await services.automationLearning.listSchedules(query),
      );
    }),
  );
  router.post(
    '/v1/automation-schedules',
    asyncRoute(async (request, response) => {
      const input = createAutomationScheduleRequestSchema.parse(request.body);
      send(
        response,
        201,
        automationScheduleSchema,
        await services.automationLearning.createSchedule(input),
      );
    }),
  );
  router.get(
    '/v1/automation-schedules/:scheduleId',
    uuidParam('scheduleId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        automationScheduleSchema,
        await services.automationLearning.getSchedule(request.params['scheduleId'] as string),
      );
    }),
  );
  router.post(
    '/v1/automation-schedules/:scheduleId/state',
    uuidParam('scheduleId'),
    asyncRoute(async (request, response) => {
      const input = updateAutomationScheduleStateRequestSchema.parse(request.body);
      send(
        response,
        200,
        automationScheduleSchema,
        await services.automationLearning.updateScheduleState(
          request.params['scheduleId'] as string,
          input,
        ),
      );
    }),
  );
  router.get(
    '/v1/observations',
    asyncRoute(async (request, response) => {
      const query = observationListQuerySchema.parse(request.query);
      send(
        response,
        200,
        observationListResponseSchema,
        await services.automationLearning.listObservations(query),
      );
    }),
  );
  router.post(
    '/v1/observations',
    asyncRoute(async (request, response) => {
      const input = createObservationRequestSchema.parse(request.body);
      send(
        response,
        201,
        observationSchema,
        await services.automationLearning.createObservation(input),
      );
    }),
  );
  router.get(
    '/v1/improvement-candidates',
    asyncRoute(async (request, response) => {
      const query = improvementCandidateListQuerySchema.parse(request.query);
      send(
        response,
        200,
        improvementCandidateListResponseSchema,
        await services.automationLearning.listImprovementCandidates(query),
      );
    }),
  );
  router.post(
    '/v1/improvement-candidates',
    asyncRoute(async (request, response) => {
      const input = createImprovementCandidateRequestSchema.parse(request.body);
      send(
        response,
        201,
        improvementCandidateSchema,
        await services.automationLearning.createImprovementCandidate(input),
      );
    }),
  );
  router.post(
    '/v1/improvement-candidates/:candidateId/review',
    uuidParam('candidateId'),
    asyncRoute(async (request, response) => {
      const input = reviewImprovementCandidateRequestSchema.parse(request.body);
      send(
        response,
        200,
        improvementCandidateSchema,
        await services.automationLearning.reviewImprovementCandidate(
          request.params['candidateId'] as string,
          input,
        ),
      );
    }),
  );
  router.get(
    '/v1/memory-candidates',
    asyncRoute(async (request, response) => {
      const query = memoryCandidateListQuerySchema.parse(request.query);
      send(
        response,
        200,
        memoryCandidateListResponseSchema,
        await services.automationLearning.listMemoryCandidates(query),
      );
    }),
  );
  router.post(
    '/v1/memory-candidates',
    asyncRoute(async (request, response) => {
      const input = createMemoryCandidateRequestSchema.parse(request.body);
      send(
        response,
        201,
        memoryCandidateSchema,
        await services.automationLearning.createMemoryCandidate(input),
      );
    }),
  );
  router.post(
    '/v1/memory-candidates/:candidateId/review',
    uuidParam('candidateId'),
    asyncRoute(async (request, response) => {
      const input = reviewMemoryCandidateRequestSchema.parse(request.body);
      send(
        response,
        200,
        memoryCandidateSchema,
        await services.automationLearning.reviewMemoryCandidate(
          request.params['candidateId'] as string,
          input,
        ),
      );
    }),
  );
  router.get(
    '/v1/authority-grants',
    asyncRoute(async (request, response) => {
      const query = authorityGrantListQuerySchema.parse(request.query);
      send(
        response,
        200,
        authorityGrantListResponseSchema,
        await services.execution.listGrants(query),
      );
    }),
  );
  router.post(
    '/v1/authority-grants',
    asyncRoute(async (request, response) => {
      const input = createAuthorityGrantRequestSchema.parse(request.body);
      send(response, 201, authorityGrantSchema, await services.execution.createGrant(input));
    }),
  );
  router.post(
    '/v1/authority-grants/:grantId/revoke',
    uuidParam('grantId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        authorityGrantSchema,
        await services.execution.revokeGrant(request.params['grantId'] as string),
      );
    }),
  );
  router.get(
    '/v1/execution-runs',
    asyncRoute(async (request, response) => {
      const query = executionRunListQuerySchema.parse(request.query);
      send(response, 200, executionRunListResponseSchema, await services.execution.listRuns(query));
    }),
  );
  router.post(
    '/v1/execution-runs',
    asyncRoute(async (request, response) => {
      const input = createExecutionRunRequestSchema.parse(request.body);
      const run = await services.execution.createRun(input);
      if (run.state === 'queued' && services.dispatchMode === 'in_process') {
        services.executionDispatcher.enqueue(run.id);
      }
      response.location(`/v1/execution-runs/${run.id}`);
      send(response, 202, executionRunSchema, run);
    }),
  );
  router.get(
    '/v1/execution-runs/:runId',
    uuidParam('runId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        executionRunSchema,
        await services.execution.getRun(request.params['runId'] as string),
      );
    }),
  );
  router.post(
    '/v1/execution-runs/:runId/approve',
    uuidParam('runId'),
    asyncRoute(async (request, response) => {
      const input = approveExecutionRunRequestSchema.parse(request.body);
      const result = await services.execution.approveRun(request.params['runId'] as string, input);
      if (services.dispatchMode === 'in_process')
        services.executionDispatcher.enqueue(result.run.id);
      send(response, 200, approveExecutionRunResponseSchema, result);
    }),
  );
  router.post(
    '/v1/execution-runs/:runId/cancel',
    uuidParam('runId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        executionRunSchema,
        await services.execution.cancelRun(request.params['runId'] as string),
      );
    }),
  );
  router.get(
    '/v1/outcomes',
    asyncRoute(async (request, response) => {
      const query = outcomeListQuerySchema.parse(request.query);
      send(
        response,
        200,
        outcomeListResponseSchema,
        await services.execution.listOutcomes(query.runId),
      );
    }),
  );
  router.get(
    '/v1/metrics',
    asyncRoute(async (request, response) => {
      const query = metricListQuerySchema.parse(request.query);
      send(
        response,
        200,
        metricListResponseSchema,
        await services.execution.listMetrics(query.runId),
      );
    }),
  );
}
