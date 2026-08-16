import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import {
  agentCatalogQuerySchema,
  agentCatalogResponseSchema,
  agentSchema,
  agentSpecSchema,
  certificationGateConfigSchema,
  certificationRunAcceptedSchema,
  certificationRunDetailSchema,
  certificationRunDetailQuerySchema,
  certificationRunHistoryQuerySchema,
  certificationRunHistoryResponseSchema,
  createCertificationRunRequestSchema,
  createEvalCaseRequestSchema,
  createOpenApiDocument,
  createSpecRequestSchema,
  deactivateEvalCaseRequestSchema,
  evalCaseListQuerySchema,
  evalCaseListResponseSchema,
  evalCaseSchema,
  evaluationResponseSchema,
  gateConfigListQuerySchema,
  gateConfigListResponseSchema,
  generationAcceptedSchema,
  generationJobSchema,
  healthResponseSchema,
  interpretSpecRequestSchema,
  interpretSpecResponseSchema,
  promotionRequestSchema,
  promotionResponseSchema,
  publishEvalCorpusRequestSchema,
  publishEvalCorpusResponseSchema,
  publishGateConfigRequestSchema,
  recoverAgentResponseSchema,
  retirementRequestSchema,
  retirementResponseSchema,
  shadowDeployResponseSchema,
  similarityRequestSchema,
  similarityResponseSchema,
  sourceListResponseSchema,
  sourceRoleSchema,
  updateGuardrailsRequestSchema,
  updateKnowledgeRequestSchema,
  updateOutcomesRequestSchema,
  updateOutputsRequestSchema,
  uuidSchema,
} from '@agent-builder/contracts';
import { z } from 'zod';
import type { ServiceBundle } from './services/types.js';

const sourceQuerySchema = z.object({ role: sourceRoleSchema.optional() });
let cachedOpenApiDocument: ReturnType<typeof createOpenApiDocument> | undefined;

const openApiDocument = (): ReturnType<typeof createOpenApiDocument> => {
  cachedOpenApiDocument ??= createOpenApiDocument();
  return cachedOpenApiDocument;
};

const asyncRoute =
  (
    handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
  ): RequestHandler =>
  (request, response, next) => {
    void handler(request, response, next).catch(next);
  };

const uuidRouteParam =
  (name: 'agentId' | 'specId' | 'jobId' | 'runId' | 'caseId'): RequestHandler =>
  (request, _response, next) => {
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

export function registerRoutes(router: Router, services: ServiceBundle): void {
  router.get(
    '/health',
    asyncRoute(async (_request, response) => {
      send(response, 200, healthResponseSchema, await services.health.check());
    }),
  );
  router.get('/openapi.json', (_request, response) => {
    response.status(200).json(openApiDocument());
  });

  // Static /agents routes precede all dynamic identifiers.
  router.post(
    '/agents/similarity',
    asyncRoute(async (request, response) => {
      const input = similarityRequestSchema.parse(request.body);
      send(response, 200, similarityResponseSchema, await services.catalog.similarity(input));
    }),
  );
  router.get(
    '/agents/sources',
    asyncRoute(async (request, response) => {
      const query = sourceQuerySchema.parse(request.query);
      const role = query.role ?? null;
      send(response, 200, sourceListResponseSchema, {
        role,
        items: await services.sources.list(role),
      });
    }),
  );
  router.post(
    '/agents/specs/interpret',
    asyncRoute(async (request, response) => {
      const input = interpretSpecRequestSchema.parse(request.body);
      send(
        response,
        200,
        interpretSpecResponseSchema,
        await services.interpretations.interpret(input),
      );
    }),
  );
  router.post(
    '/agents/specs',
    asyncRoute(async (request, response) => {
      const input = createSpecRequestSchema.parse(request.body);
      send(response, 201, agentSpecSchema, await services.specs.create(input));
    }),
  );
  router.get(
    '/agents/specs/:specId',
    uuidRouteParam('specId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        agentSpecSchema,
        await services.specs.get(request.params['specId'] as string),
      );
    }),
  );
  router.put(
    '/agents/specs/:specId/outcomes',
    uuidRouteParam('specId'),
    asyncRoute(async (request, response) => {
      const input = updateOutcomesRequestSchema.parse(request.body);
      send(
        response,
        200,
        agentSpecSchema,
        await services.specs.updateOutcomes(request.params['specId'] as string, input),
      );
    }),
  );
  router.put(
    '/agents/specs/:specId/knowledge',
    uuidRouteParam('specId'),
    asyncRoute(async (request, response) => {
      const input = updateKnowledgeRequestSchema.parse(request.body);
      send(
        response,
        200,
        agentSpecSchema,
        await services.specs.updateKnowledge(request.params['specId'] as string, input),
      );
    }),
  );
  router.put(
    '/agents/specs/:specId/guardrails',
    uuidRouteParam('specId'),
    asyncRoute(async (request, response) => {
      const input = updateGuardrailsRequestSchema.parse(request.body);
      send(
        response,
        200,
        agentSpecSchema,
        await services.specs.updateGuardrails(request.params['specId'] as string, input),
      );
    }),
  );
  router.put(
    '/agents/specs/:specId/outputs',
    uuidRouteParam('specId'),
    asyncRoute(async (request, response) => {
      const input = updateOutputsRequestSchema.parse(request.body);
      send(
        response,
        200,
        agentSpecSchema,
        await services.specs.updateOutputs(request.params['specId'] as string, input),
      );
    }),
  );
  router.post(
    '/agents/specs/:specId/generate',
    uuidRouteParam('specId'),
    asyncRoute(async (request, response) => {
      const accepted = await services.generation.accept(request.params['specId'] as string);
      response.location(accepted.statusUrl);
      services.dispatcher.enqueue(accepted.jobId);
      send(response, 202, generationAcceptedSchema, accepted);
    }),
  );
  router.get(
    '/agents/generation-jobs/:jobId',
    uuidRouteParam('jobId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        generationJobSchema,
        await services.generation.getJob(request.params['jobId'] as string),
      );
    }),
  );

  router.get(
    '/agents/certification-runs/:runId',
    uuidRouteParam('runId'),
    asyncRoute(async (request, response) => {
      const query = certificationRunDetailQuerySchema.parse(request.query);
      send(
        response,
        200,
        certificationRunDetailSchema,
        await services.certification.getRun(
          request.params['runId'] as string,
          query.limit,
          query.cursor,
        ),
      );
    }),
  );
  router.get(
    '/agents/certification-gate-configs',
    asyncRoute(async (request, response) => {
      const query = gateConfigListQuerySchema.parse(request.query);
      send(
        response,
        200,
        gateConfigListResponseSchema,
        await services.gateConfigs.list(query.includeSuperseded === 'true'),
      );
    }),
  );
  router.post(
    '/agents/certification-gate-configs/publish',
    asyncRoute(async (request, response) => {
      const input = publishGateConfigRequestSchema.parse(request.body);
      send(response, 201, certificationGateConfigSchema, await services.gateConfigs.publish(input));
    }),
  );
  router.get(
    '/agents/eval-cases',
    asyncRoute(async (request, response) => {
      const query = evalCaseListQuerySchema.parse(request.query);
      send(response, 200, evalCaseListResponseSchema, await services.corpus.listCases(query));
    }),
  );
  router.post(
    '/agents/eval-cases',
    asyncRoute(async (request, response) => {
      const input = createEvalCaseRequestSchema.parse(request.body);
      send(response, 201, evalCaseSchema, await services.corpus.createCase(input));
    }),
  );
  router.post(
    '/agents/eval-cases/:caseId/deactivate',
    uuidRouteParam('caseId'),
    asyncRoute(async (request, response) => {
      const input = deactivateEvalCaseRequestSchema.parse(request.body);
      send(
        response,
        200,
        evalCaseSchema,
        await services.corpus.deactivateCase(request.params['caseId'] as string, input),
      );
    }),
  );
  router.post(
    '/agents/eval-corpus/publish',
    asyncRoute(async (request, response) => {
      const input = publishEvalCorpusRequestSchema.parse(request.body);
      send(response, 201, publishEvalCorpusResponseSchema, await services.corpus.publish(input));
    }),
  );

  router.get(
    '/agents',
    asyncRoute(async (request, response) => {
      const query = agentCatalogQuerySchema.parse(request.query);
      send(response, 200, agentCatalogResponseSchema, await services.catalog.list(query));
    }),
  );

  // Nested concrete-version routes precede final agent detail.
  router.post(
    '/agents/:agentId/certification-runs',
    uuidRouteParam('agentId'),
    asyncRoute(async (request, response) => {
      createCertificationRunRequestSchema.parse(request.body ?? {});
      const accepted = await services.certification.createRun(request.params['agentId'] as string);
      response.location(accepted.statusUrl);
      services.certificationDispatcher.enqueue(accepted.runId);
      send(response, 202, certificationRunAcceptedSchema, accepted);
    }),
  );
  router.get(
    '/agents/:agentId/certification-runs',
    uuidRouteParam('agentId'),
    asyncRoute(async (request, response) => {
      const query = certificationRunHistoryQuerySchema.parse(request.query);
      send(
        response,
        200,
        certificationRunHistoryResponseSchema,
        await services.certification.listRuns(request.params['agentId'] as string, query),
      );
    }),
  );
  router.post(
    '/agents/:agentId/promote',
    uuidRouteParam('agentId'),
    asyncRoute(async (request, response) => {
      const input = promotionRequestSchema.parse(request.body);
      send(
        response,
        200,
        promotionResponseSchema,
        await services.promotion.promote(request.params['agentId'] as string, input),
      );
    }),
  );
  router.post(
    '/agents/:agentId/retire',
    uuidRouteParam('agentId'),
    asyncRoute(async (request, response) => {
      const input = retirementRequestSchema.parse(request.body);
      send(
        response,
        200,
        retirementResponseSchema,
        await services.promotion.retire(request.params['agentId'] as string, input),
      );
    }),
  );
  router.post(
    '/agents/:agentId/recover',
    uuidRouteParam('agentId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        recoverAgentResponseSchema,
        await services.deployment.recover(request.params['agentId'] as string),
      );
    }),
  );
  router.post(
    '/agents/:agentId/shadow-deploy',
    uuidRouteParam('agentId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        shadowDeployResponseSchema,
        await services.deployment.shadowDeploy(request.params['agentId'] as string),
      );
    }),
  );
  router.get(
    '/agents/:agentId/evaluation',
    uuidRouteParam('agentId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        evaluationResponseSchema,
        await services.deployment.evaluation(request.params['agentId'] as string),
      );
    }),
  );
  router.get(
    '/agents/:agentId',
    uuidRouteParam('agentId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        agentSchema,
        await services.catalog.getAgent(request.params['agentId'] as string),
      );
    }),
  );
}
