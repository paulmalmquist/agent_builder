import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import {
  attentionItemDetailSchema,
  attentionItemParamsSchema,
  attentionResolutionSchema,
  attentionResponseSchema,
  automationScheduleListQuerySchema,
  automationScheduleListResponseSchema,
  automationScheduleSchema,
  approveExecutionRunGroupResponseSchema,
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
  declineReleaseRequestSchema,
  createReleaseRequestSchema,
  executionRunListQuerySchema,
  executionRunListResponseSchema,
  executionRunSchema,
  executionApprovalGroupParamsSchema,
  improvementCandidateListQuerySchema,
  improvementCandidateListResponseSchema,
  improvementCandidateSchema,
  memoryCandidateListQuerySchema,
  memoryCandidateListResponseSchema,
  memoryCandidateSchema,
  metricListQuerySchema,
  metricListResponseSchema,
  configurePluginInstallationRequestSchema,
  installPluginRequestSchema,
  pluginCatalogItemSchema,
  pluginCatalogQuerySchema,
  pluginCatalogResponseSchema,
  pluginHealthCheckSchema,
  pluginInstallationListQuerySchema,
  pluginInstallationListResponseSchema,
  pluginInstallationSchema,
  pluginMarkAssetFileSchema,
  pluginStateChangeRequestSchema,
  pluginUsedByResponseSchema,
  uninstallPluginRequestSchema,
  observationListQuerySchema,
  observationListResponseSchema,
  observationSchema,
  outcomeListQuerySchema,
  outcomeListResponseSchema,
  productionChannelKeySchema,
  productionChannelLookupSchema,
  productionChannelMutationResponseSchema,
  promoteReleaseRequestSchema,
  releaseEvaluationSchema,
  releaseDeclineResponseSchema,
  rejectExecutionRunRequestSchema,
  rejectExecutionRunGroupResponseSchema,
  resolveAttentionItemRequestSchema,
  rollbackReleaseRequestSchema,
  releaseBundleSchema,
  repositoryImportRequestSchema,
  repositoryImportResponseSchema,
  resourceListQuerySchema,
  resourceListResponseSchema,
  resourceVersionSchema,
  reviewImprovementCandidateRequestSchema,
  reviewMemoryCandidateRequestSchema,
  scheduleDueAutomationsRequestSchema,
  scheduleDueAutomationsResponseSchema,
  updateAutomationScheduleStateRequestSchema,
  uuidSchema,
  appendConfigurationRevisionRequestSchema,
  builderDecisionSchema,
  builderDraftSchema,
  builderIntakeResultsSchema,
  builderIntakeSchema,
  catalogPublicationListQuerySchema,
  catalogPublicationListResponseSchema,
  catalogPublicationSchema,
  configurationRevisionSchema,
  createBuilderDecisionRequestSchema,
  createBuilderIntakeRequestSchema,
  createDeploymentRequestSchema,
  deploymentSchema,
  idempotencyKeySchema,
  resourceLineageListResponseSchema,
  retireCatalogPublicationRequestSchema,
} from '@agent-builder/contracts';
import type { z } from 'zod';
import type { PlatformServices } from './services/types.js';
import { requireMinimumRole } from './authorization.js';

const asyncRoute =
  (handler: (request: Request, response: Response) => Promise<void>): RequestHandler =>
  (request, response, next) => {
    void handler(request, response).catch(next);
  };

const uuidParam =
  (
    name:
      | 'releaseId'
      | 'grantId'
      | 'runId'
      | 'evaluationId'
      | 'scheduleId'
      | 'candidateId'
      | 'pluginVersionId'
      | 'installationId'
      | 'publicationId'
      | 'intakeId'
      | 'draftId'
      | 'deploymentId'
      | 'resourceVersionId',
  ): RequestHandler =>
  (request, _response, next: NextFunction) => {
    const value = request.params[name];
    if (typeof value !== 'string' || !uuidSchema.safeParse(value).success) {
      next('route');
      return;
    }
    next();
  };

const pluginMarkAssetParam: RequestHandler = (request, _response, next) => {
  const value = request.params['assetFile'];
  if (typeof value !== 'string' || !pluginMarkAssetFileSchema.safeParse(value).success) {
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
    '/v1/catalog/publications',
    asyncRoute(async (request, response) => {
      catalogPublicationListQuerySchema.parse(request.query);
      send(
        response,
        200,
        catalogPublicationListResponseSchema,
        await services.reuse.listPublications(request.query),
      );
    }),
  );
  router.get(
    '/v1/catalog/publications/:publicationId',
    uuidParam('publicationId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        catalogPublicationSchema,
        await services.reuse.getPublication(request.params['publicationId'] as string),
      );
    }),
  );
  router.post(
    '/v1/catalog/publications/:publicationId/retirement',
    uuidParam('publicationId'),
    requireMinimumRole('owner'),
    asyncRoute(async (request, response) => {
      const input = retireCatalogPublicationRequestSchema.parse(request.body);
      send(
        response,
        200,
        catalogPublicationSchema,
        await services.reuse.retirePublication(request.params['publicationId'] as string, input),
      );
    }),
  );
  router.post(
    '/v1/builder/intakes',
    requireMinimumRole('builder'),
    asyncRoute(async (request, response) => {
      const input = createBuilderIntakeRequestSchema.parse(request.body);
      send(response, 201, builderIntakeSchema, await services.reuse.createIntake(input));
    }),
  );
  router.get(
    '/v1/builder/intakes/:intakeId',
    uuidParam('intakeId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        builderIntakeSchema,
        await services.reuse.getIntake(request.params['intakeId'] as string),
      );
    }),
  );
  router.get(
    '/v1/builder/intakes/:intakeId/referred-choices',
    uuidParam('intakeId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        builderIntakeResultsSchema,
        await services.reuse.referredChoices(request.params['intakeId'] as string),
      );
    }),
  );
  router.post(
    '/v1/builder/intakes/:intakeId/decisions',
    uuidParam('intakeId'),
    requireMinimumRole('builder'),
    asyncRoute(async (request, response) => {
      const input = createBuilderDecisionRequestSchema.parse(request.body);
      send(
        response,
        201,
        builderDecisionSchema,
        await services.reuse.createDecision(
          request.params['intakeId'] as string,
          input,
          idempotencyKeySchema.parse(request.header('idempotency-key')),
        ),
      );
    }),
  );
  router.get(
    '/v1/builder/drafts/:draftId',
    uuidParam('draftId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        builderDraftSchema,
        await services.reuse.getDraft(request.params['draftId'] as string),
      );
    }),
  );
  router.post(
    '/v1/deployments',
    asyncRoute(async (request, response) => {
      const input = createDeploymentRequestSchema.parse(request.body);
      send(response, 201, deploymentSchema, await services.reuse.createDeployment(input));
    }),
  );
  router.get(
    '/v1/deployments/:deploymentId',
    uuidParam('deploymentId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        deploymentSchema,
        await services.reuse.getDeployment(request.params['deploymentId'] as string),
      );
    }),
  );
  router.post(
    '/v1/deployments/:deploymentId/configuration-revisions',
    uuidParam('deploymentId'),
    asyncRoute(async (request, response) => {
      const input = appendConfigurationRevisionRequestSchema.parse(request.body);
      send(
        response,
        201,
        configurationRevisionSchema,
        await services.reuse.appendConfigurationRevision(
          request.params['deploymentId'] as string,
          input.configuration,
        ),
      );
    }),
  );
  router.get(
    '/v1/resources/:resourceVersionId/lineage',
    uuidParam('resourceVersionId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        resourceLineageListResponseSchema,
        await services.reuse.getLineage(request.params['resourceVersionId'] as string),
      );
    }),
  );
  router.get(
    '/v1/plugins',
    asyncRoute(async (request, response) => {
      const query = pluginCatalogQuerySchema.parse(request.query);
      send(response, 200, pluginCatalogResponseSchema, await services.plugins.listCatalog(query));
    }),
  );
  router.get(
    '/v1/plugins/:pluginVersionId',
    uuidParam('pluginVersionId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        pluginCatalogItemSchema,
        await services.plugins.getCatalogItem(request.params['pluginVersionId'] as string),
      );
    }),
  );
  router.get(
    '/v1/plugins/:pluginVersionId/mark/:assetFile',
    uuidParam('pluginVersionId'),
    pluginMarkAssetParam,
    asyncRoute(async (request, response) => {
      const assetFile = pluginMarkAssetFileSchema.parse(request.params['assetFile']);
      const asset = await services.plugins.getMarkAsset(
        request.params['pluginVersionId'] as string,
        assetFile.slice(0, -'.svg'.length),
      );
      response.set({
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Disposition': 'inline; filename="connector-mark.svg"',
        'Content-Length': String(asset.bytes.byteLength),
        'Content-Security-Policy':
          "default-src 'none'; style-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox",
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cross-Origin-Resource-Policy': 'same-origin',
        ETag: `"sha256-${asset.digest}"`,
        'Referrer-Policy': 'no-referrer',
        Vary: 'Authorization',
        'X-Content-Type-Options': 'nosniff',
      });
      response.status(200).end(asset.bytes);
    }),
  );
  router.get(
    '/v1/plugin-installations',
    asyncRoute(async (request, response) => {
      const query = pluginInstallationListQuerySchema.parse(request.query);
      send(
        response,
        200,
        pluginInstallationListResponseSchema,
        await services.plugins.listInstallations(query),
      );
    }),
  );
  router.post(
    '/v1/plugin-installations',
    requireMinimumRole('admin'),
    asyncRoute(async (request, response) => {
      const input = installPluginRequestSchema.parse(request.body);
      send(response, 201, pluginInstallationSchema, await services.plugins.install(input));
    }),
  );
  router.get(
    '/v1/plugin-installations/:installationId',
    uuidParam('installationId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        pluginInstallationSchema,
        await services.plugins.getInstallation(request.params['installationId'] as string),
      );
    }),
  );
  router.post(
    '/v1/plugin-installations/:installationId/configure',
    uuidParam('installationId'),
    requireMinimumRole('admin'),
    asyncRoute(async (request, response) => {
      const input = configurePluginInstallationRequestSchema.parse(request.body);
      send(
        response,
        200,
        pluginInstallationSchema,
        await services.plugins.configure(request.params['installationId'] as string, input),
      );
    }),
  );
  router.post(
    '/v1/plugin-installations/:installationId/health-check',
    uuidParam('installationId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        pluginHealthCheckSchema,
        await services.plugins.checkHealth(request.params['installationId'] as string),
      );
    }),
  );
  for (const action of ['enable', 'disable'] as const) {
    router.post(
      `/v1/plugin-installations/:installationId/${action}`,
      uuidParam('installationId'),
      requireMinimumRole('admin'),
      asyncRoute(async (request, response) => {
        const input = pluginStateChangeRequestSchema.parse(request.body);
        send(
          response,
          200,
          pluginInstallationSchema,
          await services.plugins[action](request.params['installationId'] as string, input),
        );
      }),
    );
  }
  router.get(
    '/v1/plugin-installations/:installationId/used-by',
    uuidParam('installationId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        pluginUsedByResponseSchema,
        await services.plugins.usedBy(request.params['installationId'] as string),
      );
    }),
  );
  router.post(
    '/v1/plugin-installations/:installationId/uninstall',
    uuidParam('installationId'),
    requireMinimumRole('admin'),
    asyncRoute(async (request, response) => {
      const input = uninstallPluginRequestSchema.parse(request.body);
      await services.plugins.uninstall(request.params['installationId'] as string, input);
      response.status(204).end();
    }),
  );
  router.get(
    '/v1/attention',
    asyncRoute(async (_request, response) => {
      send(response, 200, attentionResponseSchema, await services.attention.list());
    }),
  );
  router.post(
    '/v1/attention-items/:itemId/resolve',
    asyncRoute(async (request, response) => {
      const { itemId } = attentionItemParamsSchema.parse(request.params);
      const input = resolveAttentionItemRequestSchema.parse(request.body);
      send(
        response,
        200,
        attentionResolutionSchema,
        await services.attention.resolveItem(itemId, input),
      );
    }),
  );
  router.get(
    '/v1/attention-items/:itemId',
    asyncRoute(async (request, response) => {
      const { itemId } = attentionItemParamsSchema.parse(request.params);
      send(response, 200, attentionItemDetailSchema, await services.attention.getItem(itemId));
    }),
  );
  router.get(
    '/v1/resources',
    asyncRoute(async (request, response) => {
      const query = resourceListQuerySchema.parse(request.query);
      send(response, 200, resourceListResponseSchema, await services.registry.listResources(query));
    }),
  );
  router.get(
    '/v1/resources/:resourceVersionId',
    uuidParam('resourceVersionId'),
    asyncRoute(async (request, response) => {
      send(
        response,
        200,
        resourceVersionSchema,
        await services.registry.getResource(request.params['resourceVersionId'] as string),
      );
    }),
  );
  router.post(
    '/v1/repository-imports',
    requireMinimumRole('builder'),
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
    requireMinimumRole('builder'),
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
    requireMinimumRole('builder'),
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
        productionChannelLookupSchema,
        await services.releaseGovernance.getChannel(channelKey),
      );
    }),
  );
  router.post(
    '/v1/production-channels/:channelKey/promote',
    requireMinimumRole('owner'),
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
    '/v1/production-channels/:channelKey/decline',
    requireMinimumRole('owner'),
    asyncRoute(async (request, response) => {
      const channelKey = productionChannelKeySchema.parse(request.params['channelKey']);
      const input = declineReleaseRequestSchema.parse(request.body);
      send(
        response,
        200,
        releaseDeclineResponseSchema,
        await services.releaseGovernance.decline(channelKey, input),
      );
    }),
  );
  router.post(
    '/v1/production-channels/:channelKey/rollback',
    requireMinimumRole('owner'),
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
    requireMinimumRole('owner'),
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
    requireMinimumRole('owner'),
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
    requireMinimumRole('owner'),
    asyncRoute(async (request, response) => {
      const input = createAuthorityGrantRequestSchema.parse(request.body);
      send(response, 201, authorityGrantSchema, await services.execution.createGrant(input));
    }),
  );
  router.post(
    '/v1/authority-grants/:grantId/revoke',
    uuidParam('grantId'),
    requireMinimumRole('owner'),
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
    '/v1/execution-approval-groups/:groupKey/approve',
    requireMinimumRole('owner'),
    asyncRoute(async (request, response) => {
      const { groupKey } = executionApprovalGroupParamsSchema.parse(request.params);
      const input = approveExecutionRunRequestSchema.parse(request.body);
      const result = await services.execution.approveRunGroup(groupKey, input);
      if (services.dispatchMode === 'in_process') {
        for (const run of result.runs) {
          if (run.state === 'queued') services.executionDispatcher.enqueue(run.id);
        }
      }
      send(response, 200, approveExecutionRunGroupResponseSchema, result);
    }),
  );
  router.post(
    '/v1/execution-approval-groups/:groupKey/reject',
    requireMinimumRole('owner'),
    asyncRoute(async (request, response) => {
      const { groupKey } = executionApprovalGroupParamsSchema.parse(request.params);
      const input = rejectExecutionRunRequestSchema.parse(request.body);
      send(
        response,
        200,
        rejectExecutionRunGroupResponseSchema,
        await services.execution.rejectRunGroup(groupKey, input),
      );
    }),
  );
  router.post(
    '/v1/execution-runs/:runId/approve',
    uuidParam('runId'),
    requireMinimumRole('owner'),
    asyncRoute(async (request, response) => {
      const input = approveExecutionRunRequestSchema.parse(request.body);
      const result = await services.execution.approveRun(request.params['runId'] as string, input);
      if (services.dispatchMode === 'in_process')
        services.executionDispatcher.enqueue(result.run.id);
      send(response, 200, approveExecutionRunResponseSchema, result);
    }),
  );
  router.post(
    '/v1/execution-runs/:runId/reject',
    uuidParam('runId'),
    requireMinimumRole('owner'),
    asyncRoute(async (request, response) => {
      const input = rejectExecutionRunRequestSchema.parse(request.body);
      send(
        response,
        200,
        executionRunSchema,
        await services.execution.rejectRun(request.params['runId'] as string, input),
      );
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
