import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  automationScheduleListQuerySchema,
  automationScheduleListResponseSchema,
  automationScheduleSchema,
  createAutomationScheduleRequestSchema,
  createImprovementCandidateRequestSchema,
  createMemoryCandidateRequestSchema,
  createObservationRequestSchema,
  improvementCandidateListQuerySchema,
  improvementCandidateListResponseSchema,
  improvementCandidateSchema,
  memoryCandidateListQuerySchema,
  memoryCandidateListResponseSchema,
  memoryCandidateSchema,
  observationListQuerySchema,
  observationListResponseSchema,
  observationSchema,
  reviewImprovementCandidateRequestSchema,
  reviewMemoryCandidateRequestSchema,
  scheduleDueAutomationsRequestSchema,
  scheduleDueAutomationsResponseSchema,
  updateAutomationScheduleStateRequestSchema,
} from './automation-learning-schemas.js';
import { agentCatalogQueryObjectSchema, agentCatalogResponseSchema } from './catalog-schemas.js';
import {
  attentionItemDetailSchema,
  attentionItemParamsSchema,
  attentionResolutionSchema,
  attentionResponseSchema,
  declineReleaseRequestSchema,
  rejectExecutionRunRequestSchema,
  resolveAttentionItemRequestSchema,
} from './attention-schemas.js';
import {
  certificationRunAcceptedSchema,
  certificationRunDetailSchema,
  certificationRunDetailQuerySchema,
  certificationRunHistoryQuerySchema,
  certificationRunHistoryResponseSchema,
  createCertificationRunRequestSchema,
  createEvalCaseRequestSchema,
  deactivateEvalCaseRequestSchema,
  evalCaseListQuerySchema,
  evalCaseListResponseSchema,
  evalCaseSchema,
  gateConfigListQuerySchema,
  gateConfigListResponseSchema,
  promotionRequestSchema,
  promotionResponseSchema,
  publishEvalCorpusRequestSchema,
  publishEvalCorpusResponseSchema,
  publishGateConfigRequestSchema,
  certificationGateConfigSchema,
  retirementRequestSchema,
  retirementResponseSchema,
} from './certification-schemas.js';
import {
  interpretSpecRequestSchema,
  interpretSpecResponseSchema,
} from './interpretation-schemas.js';
import {
  IDENTITY_OPENAPI_OPERATION_IDS,
  liveResponseSchema,
  readyResponseSchema,
  sessionResponseSchema,
} from './identity-schemas.js';
import {
  agentSchema,
  agentSpecSchema,
  apiErrorSchema,
  createSpecRequestSchema,
  evaluationResponseSchema,
  generationAcceptedSchema,
  generationJobSchema,
  healthResponseSchema,
  recoverAgentResponseSchema,
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
} from './schemas.js';
import {
  approveExecutionRunRequestSchema,
  approveExecutionRunResponseSchema,
  authorityGrantListQuerySchema,
  authorityGrantListResponseSchema,
  authorityGrantSchema,
  createAuthorityGrantRequestSchema,
  createExecutionRunRequestSchema,
  createReleaseRequestSchema,
  executionRunListQuerySchema,
  executionRunListResponseSchema,
  executionRunSchema,
  metricListQuerySchema,
  metricListResponseSchema,
  outcomeListQuerySchema,
  outcomeListResponseSchema,
  releaseBundleSchema,
  repositoryImportRequestSchema,
  repositoryImportResponseSchema,
  resourceListQuerySchema,
  resourceListResponseSchema,
  resourceVersionSchema,
} from './platform-schemas.js';
import {
  configurePluginInstallationRequestSchema,
  installPluginRequestSchema,
  pluginCatalogItemSchema,
  pluginCatalogQuerySchema,
  pluginCatalogResponseSchema,
  pluginHealthCheckSchema,
  pluginInstallationListQuerySchema,
  pluginInstallationListResponseSchema,
  pluginInstallationSchema,
  pluginStateChangeRequestSchema,
  pluginUsedByResponseSchema,
  uninstallPluginRequestSchema,
} from './plugin-schemas.js';
import {
  createReleaseEvaluationRequestSchema,
  productionChannelKeySchema,
  productionChannelMutationResponseSchema,
  productionChannelSchema,
  promoteReleaseRequestSchema,
  releaseEvaluationSchema,
  releaseDeclineResponseSchema,
  rollbackReleaseRequestSchema,
} from './release-governance-schemas.js';
import {
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
  resourceLineageListResponseSchema,
  retireCatalogPublicationRequestSchema,
} from './reuse-schemas.js';
import { REUSE_OPENAPI_OPERATION_IDS } from './reuse-routes.js';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
const json = (schema: z.ZodTypeAny) => ({
  'application/json': { schema },
});
const errorResponse = {
  description: 'Typed API error',
  content: json(apiErrorSchema),
};
const idParam = (name: 'agentId' | 'specId' | 'jobId' | 'runId' | 'caseId') =>
  z.object({ [name]: uuidSchema }) as z.ZodObject<Record<typeof name, typeof uuidSchema>>;

registry.register('Agent', agentSchema);
registry.register('AgentSpec', agentSpecSchema);
registry.register('GenerationJob', generationJobSchema);
registry.register('ApiError', apiErrorSchema);
registry.register('Session', sessionResponseSchema);
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'Opaque or OIDC access token',
  description:
    'Authentication mode is deployment policy; fixture OIDC is never accepted in production.',
});
registry.register('CertificationRun', certificationRunDetailSchema);
registry.register('CertificationGateConfig', certificationGateConfigSchema);
registry.register('EvalCase', evalCaseSchema);
registry.register('ResourceVersion', resourceVersionSchema);
registry.register('ReleaseBundle', releaseBundleSchema);
registry.register('AuthorityGrant', authorityGrantSchema);
registry.register('ExecutionRun', executionRunSchema);
registry.register('AutomationSchedule', automationScheduleSchema);
registry.register('Observation', observationSchema);
registry.register('ImprovementCandidate', improvementCandidateSchema);
registry.register('MemoryCandidate', memoryCandidateSchema);
registry.register('ReleaseEvaluation', releaseEvaluationSchema);
registry.register('ProductionChannel', productionChannelSchema);
registry.register('AttentionResponse', attentionResponseSchema);
registry.register('AttentionItemDetail', attentionItemDetailSchema);
registry.register('PluginCatalogItem', pluginCatalogItemSchema);
registry.register('PluginInstallation', pluginInstallationSchema);
registry.register('PluginHealthCheck', pluginHealthCheckSchema);
registry.register('CatalogPublication', catalogPublicationSchema);
registry.register('BuilderIntake', builderIntakeSchema);
registry.register('BuilderDecision', builderDecisionSchema);
registry.register('BuilderDraft', builderDraftSchema);
registry.register('Deployment', deploymentSchema);
registry.register('ConfigurationRevision', configurationRevisionSchema);

const platformIdParam = (
  name:
    | 'releaseId'
    | 'grantId'
    | 'runId'
    | 'scheduleId'
    | 'candidateId'
    | 'evaluationId'
    | 'pluginVersionId'
    | 'installationId'
    | 'publicationId'
    | 'intakeId'
    | 'draftId'
    | 'deploymentId'
    | 'resourceVersionId',
) => z.object({ [name]: uuidSchema }) as z.ZodObject<Record<typeof name, typeof uuidSchema>>;

registry.registerPath({
  method: 'get',
  path: '/v1/catalog/publications',
  operationId: REUSE_OPENAPI_OPERATION_IDS.listCatalogPublications,
  request: { query: catalogPublicationListQuerySchema },
  responses: {
    200: {
      description: 'Active governed catalog publications',
      content: json(catalogPublicationListResponseSchema),
    },
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/catalog/publications/{publicationId}',
  operationId: REUSE_OPENAPI_OPERATION_IDS.getCatalogPublication,
  request: { params: platformIdParam('publicationId') },
  responses: {
    200: { description: 'Governed catalog publication', content: json(catalogPublicationSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/catalog/publications/{publicationId}/retirement',
  operationId: REUSE_OPENAPI_OPERATION_IDS.retireCatalogPublication,
  request: {
    params: platformIdParam('publicationId'),
    body: { content: json(retireCatalogPublicationRequestSchema) },
  },
  responses: {
    200: {
      description: 'Retired publication and queued index removal',
      content: json(catalogPublicationSchema),
    },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/builder/intakes',
  operationId: REUSE_OPENAPI_OPERATION_IDS.createBuilderIntake,
  request: { body: { content: json(createBuilderIntakeRequestSchema) } },
  responses: {
    201: {
      description: 'Builder intake before specification creation',
      content: json(builderIntakeSchema),
    },
    400: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/builder/intakes/{intakeId}',
  operationId: REUSE_OPENAPI_OPERATION_IDS.getBuilderIntake,
  request: { params: platformIdParam('intakeId') },
  responses: {
    200: { description: 'Builder intake', content: json(builderIntakeSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/builder/intakes/{intakeId}/referred-choices',
  operationId: REUSE_OPENAPI_OPERATION_IDS.listReferredChoices,
  request: { params: platformIdParam('intakeId') },
  responses: {
    200: {
      description: 'Indexed reuse choices and bounded skill compositions',
      content: json(builderIntakeResultsSchema),
    },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/builder/intakes/{intakeId}/decisions',
  operationId: REUSE_OPENAPI_OPERATION_IDS.createBuilderDecision,
  request: {
    params: platformIdParam('intakeId'),
    headers: z.object({ 'idempotency-key': z.string().min(8).max(200) }),
    body: { content: json(createBuilderDecisionRequestSchema) },
  },
  responses: {
    201: {
      description: 'Immutable idempotent Builder decision',
      content: json(builderDecisionSchema),
    },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/builder/drafts/{draftId}',
  operationId: REUSE_OPENAPI_OPERATION_IDS.getBuilderDraft,
  request: { params: platformIdParam('draftId') },
  responses: {
    200: { description: 'Builder draft or lineage intent', content: json(builderDraftSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/deployments',
  operationId: REUSE_OPENAPI_OPERATION_IDS.createDeployment,
  request: { body: { content: json(createDeploymentRequestSchema) } },
  responses: {
    201: {
      description: 'Deployment materialized by a reuse decision',
      content: json(deploymentSchema),
    },
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/deployments/{deploymentId}',
  operationId: REUSE_OPENAPI_OPERATION_IDS.getDeployment,
  request: { params: platformIdParam('deploymentId') },
  responses: {
    200: { description: 'Deployment and retired-source warning', content: json(deploymentSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/deployments/{deploymentId}/configuration-revisions',
  operationId: REUSE_OPENAPI_OPERATION_IDS.appendConfigurationRevision,
  request: {
    params: platformIdParam('deploymentId'),
    body: { content: json(appendConfigurationRevisionRequestSchema) },
  },
  responses: {
    201: {
      description: 'Append-only configuration overlay revision',
      content: json(configurationRevisionSchema),
    },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/resources/{resourceVersionId}/lineage',
  operationId: REUSE_OPENAPI_OPERATION_IDS.getResourceLineage,
  request: { params: platformIdParam('resourceVersionId') },
  responses: {
    200: {
      description: 'Materialized resource lineage',
      content: json(resourceLineageListResponseSchema),
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/builder/sources',
  operationId: 'listBuilderSources',
  request: { query: z.object({ role: sourceRoleSchema.optional() }) },
  responses: {
    200: { description: 'Builder source registry facade', content: json(sourceListResponseSchema) },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/builder/specs/interpret',
  operationId: 'interpretBuilderSpec',
  request: { body: { content: json(interpretSpecRequestSchema) } },
  responses: {
    200: { description: 'Interpreted Builder scope', content: json(interpretSpecResponseSchema) },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/builder/specs',
  operationId: 'createBuilderSpec',
  request: { body: { content: json(createSpecRequestSchema) } },
  responses: {
    201: { description: 'Builder specification facade', content: json(agentSpecSchema) },
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/builder/specs/{specId}',
  operationId: 'getBuilderSpec',
  request: { params: idParam('specId') },
  responses: {
    200: { description: 'Builder specification', content: json(agentSpecSchema) },
    404: errorResponse,
  },
});
for (const [section, schema] of [
  ['outcomes', updateOutcomesRequestSchema],
  ['knowledge', updateKnowledgeRequestSchema],
  ['guardrails', updateGuardrailsRequestSchema],
  ['outputs', updateOutputsRequestSchema],
] as const) {
  registry.registerPath({
    method: 'put',
    path: `/v1/builder/specs/{specId}/${section}`,
    operationId: `updateBuilderSpec${section[0]!.toUpperCase()}${section.slice(1)}`,
    request: { params: idParam('specId'), body: { content: json(schema) } },
    responses: {
      200: { description: `Updated Builder ${section}`, content: json(agentSpecSchema) },
      404: errorResponse,
    },
  });
}
registry.registerPath({
  method: 'post',
  path: '/v1/builder/specs/{specId}/generate',
  operationId: 'generateBuilderSpec',
  request: { params: idParam('specId') },
  responses: {
    202: {
      description: 'Accepted Builder generation job',
      content: json(generationAcceptedSchema),
    },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/builder/generation-jobs/{jobId}',
  operationId: 'getBuilderGenerationJob',
  request: { params: idParam('jobId') },
  responses: {
    200: { description: 'Builder generation job', content: json(generationJobSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/builder/agents/{agentId}/recover',
  operationId: 'recoverBuilderAgent',
  request: { params: idParam('agentId') },
  responses: {
    200: { description: 'Recovered Builder agent', content: json(recoverAgentResponseSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/builder/agents/{agentId}/shadow-deploy',
  operationId: 'shadowDeployBuilderAgent',
  request: { params: idParam('agentId') },
  responses: {
    200: {
      description: 'Shadow-deployed Builder agent',
      content: json(shadowDeployResponseSchema),
    },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/builder/agents/{agentId}/evaluation',
  operationId: 'getBuilderAgentEvaluation',
  request: { params: idParam('agentId') },
  responses: {
    200: {
      description: 'Builder agent evaluation facade',
      content: json(evaluationResponseSchema),
    },
    404: errorResponse,
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/attention',
  responses: {
    200: { description: 'Decision-grade Attention queue', content: json(attentionResponseSchema) },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/attention-items/{itemId}/resolve',
  request: {
    params: attentionItemParamsSchema,
    body: { content: json(resolveAttentionItemRequestSchema) },
  },
  responses: {
    200: {
      description: 'Immutable human acknowledgement of a terminal degraded item',
      content: json(attentionResolutionSchema),
    },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/attention-items/{itemId}',
  request: { params: attentionItemParamsSchema },
  responses: {
    200: {
      description: 'Attention item with provenance and flight-recorder detail',
      content: json(attentionItemDetailSchema),
    },
    404: errorResponse,
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/resources',
  request: { query: resourceListQuerySchema },
  responses: {
    200: { description: 'Versioned registry resources', content: json(resourceListResponseSchema) },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/repository-imports',
  request: { body: { content: json(repositoryImportRequestSchema) } },
  responses: {
    201: {
      description: 'Compiled and imported resource',
      content: json(repositoryImportResponseSchema),
    },
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/plugins',
  operationId: 'listPlugins',
  request: { query: pluginCatalogQuerySchema },
  responses: {
    200: { description: 'Sanitized Plugin catalog', content: json(pluginCatalogResponseSchema) },
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/plugins/{pluginVersionId}',
  operationId: 'getPlugin',
  request: { params: platformIdParam('pluginVersionId') },
  responses: {
    200: { description: 'Sanitized Plugin catalog item', content: json(pluginCatalogItemSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/plugin-installations',
  operationId: 'listPluginInstallations',
  request: { query: pluginInstallationListQuerySchema },
  responses: {
    200: {
      description: 'Scoped Plugin installations',
      content: json(pluginInstallationListResponseSchema),
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/plugin-installations',
  operationId: 'installPlugin',
  request: { body: { content: json(installPluginRequestSchema) } },
  responses: {
    201: { description: 'Installed exact Plugin version', content: json(pluginInstallationSchema) },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/plugin-installations/{installationId}',
  operationId: 'getPluginInstallation',
  request: { params: platformIdParam('installationId') },
  responses: {
    200: { description: 'Plugin installation', content: json(pluginInstallationSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/plugin-installations/{installationId}/configure',
  operationId: 'configurePluginInstallation',
  request: {
    params: platformIdParam('installationId'),
    body: { content: json(configurePluginInstallationRequestSchema) },
  },
  responses: {
    200: { description: 'Configured secret references', content: json(pluginInstallationSchema) },
    403: errorResponse,
    404: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/plugin-installations/{installationId}/health-check',
  operationId: 'checkPluginHealth',
  request: { params: platformIdParam('installationId') },
  responses: {
    200: { description: 'Plugin health probe result', content: json(pluginHealthCheckSchema) },
    404: errorResponse,
    503: errorResponse,
  },
});
for (const action of ['enable', 'disable'] as const) {
  registry.registerPath({
    method: 'post',
    path: `/v1/plugin-installations/{installationId}/${action}`,
    operationId: action === 'enable' ? 'enablePluginInstallation' : 'disablePluginInstallation',
    request: {
      params: platformIdParam('installationId'),
      body: { content: json(pluginStateChangeRequestSchema) },
    },
    responses: {
      200: {
        description: `${action === 'enable' ? 'Enabled' : 'Disabled'} Plugin installation`,
        content: json(pluginInstallationSchema),
      },
      403: errorResponse,
      404: errorResponse,
      409: errorResponse,
    },
  });
}
registry.registerPath({
  method: 'get',
  path: '/v1/plugin-installations/{installationId}/used-by',
  operationId: 'getPluginUsedBy',
  request: { params: platformIdParam('installationId') },
  responses: {
    200: { description: 'Exact Plugin dependents', content: json(pluginUsedByResponseSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/plugin-installations/{installationId}/uninstall',
  operationId: 'uninstallPlugin',
  request: {
    params: platformIdParam('installationId'),
    body: { content: json(uninstallPluginRequestSchema) },
  },
  responses: {
    204: { description: 'Uninstalled unused Plugin version' },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/releases',
  request: { body: { content: json(createReleaseRequestSchema) } },
  responses: {
    201: { description: 'Immutable release bundle', content: json(releaseBundleSchema) },
    404: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/releases/{releaseId}',
  request: { params: platformIdParam('releaseId') },
  responses: {
    200: { description: 'Immutable release bundle', content: json(releaseBundleSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/release-evaluations',
  request: { body: { content: json(createReleaseEvaluationRequestSchema) } },
  responses: {
    201: {
      description: 'Immutable deterministic release evidence',
      content: json(releaseEvaluationSchema),
    },
    404: errorResponse,
    422: errorResponse,
    503: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/release-evaluations/{evaluationId}',
  request: { params: platformIdParam('evaluationId') },
  responses: {
    200: {
      description: 'Immutable release evaluation evidence',
      content: json(releaseEvaluationSchema),
    },
    404: errorResponse,
  },
});
const channelParam = z.object({ channelKey: productionChannelKeySchema });
registry.registerPath({
  method: 'get',
  path: '/v1/production-channels/{channelKey}',
  request: { params: channelParam },
  responses: {
    200: {
      description: 'Current production release pointer',
      content: json(productionChannelSchema),
    },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/production-channels/{channelKey}/promote',
  request: {
    params: channelParam,
    body: { content: json(promoteReleaseRequestSchema) },
  },
  responses: {
    200: {
      description: 'Human-approved atomic production promotion',
      content: json(productionChannelMutationResponseSchema),
    },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/production-channels/{channelKey}/rollback',
  request: {
    params: channelParam,
    body: { content: json(rollbackReleaseRequestSchema) },
  },
  responses: {
    200: {
      description: 'Human-approved atomic rollback to prior certified evidence',
      content: json(productionChannelMutationResponseSchema),
    },
    403: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/production-channels/{channelKey}/decline',
  request: {
    params: channelParam,
    body: { content: json(declineReleaseRequestSchema) },
  },
  responses: {
    200: {
      description: 'Immutable human decline with no production-pointer mutation',
      content: json(releaseDeclineResponseSchema),
    },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/authority-grants',
  request: { query: authorityGrantListQuerySchema },
  responses: {
    200: { description: 'Authority grants', content: json(authorityGrantListResponseSchema) },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/authority-grants',
  request: { body: { content: json(createAuthorityGrantRequestSchema) } },
  responses: {
    201: { description: 'Digest-bound authority grant', content: json(authorityGrantSchema) },
    400: errorResponse,
    403: errorResponse,
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/authority-grants/{grantId}/revoke',
  request: { params: platformIdParam('grantId') },
  responses: {
    200: { description: 'Revoked authority grant', content: json(authorityGrantSchema) },
    403: errorResponse,
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/execution-runs',
  request: { query: executionRunListQuerySchema },
  responses: {
    200: { description: 'Execution run ledger', content: json(executionRunListResponseSchema) },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/execution-runs',
  request: { body: { content: json(createExecutionRunRequestSchema) } },
  responses: {
    202: {
      description: 'Execution accepted or awaiting authority',
      content: json(executionRunSchema),
    },
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/execution-runs/{runId}',
  request: { params: platformIdParam('runId') },
  responses: {
    200: { description: 'Execution run', content: json(executionRunSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/execution-runs/{runId}/approve',
  request: {
    params: platformIdParam('runId'),
    body: { content: json(approveExecutionRunRequestSchema) },
  },
  responses: {
    200: {
      description: 'Approved run and authority grant',
      content: json(approveExecutionRunResponseSchema),
    },
    403: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/execution-runs/{runId}/cancel',
  request: { params: platformIdParam('runId') },
  responses: {
    200: {
      description: 'Cancelled run or cancellation request',
      content: json(executionRunSchema),
    },
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/execution-runs/{runId}/reject',
  request: {
    params: platformIdParam('runId'),
    body: { content: json(rejectExecutionRunRequestSchema) },
  },
  responses: {
    200: {
      description: 'Human rejection of a pending execution request',
      content: json(executionRunSchema),
    },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/outcomes',
  request: { query: outcomeListQuerySchema },
  responses: {
    200: { description: 'Execution outcomes', content: json(outcomeListResponseSchema) },
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/metrics',
  request: { query: metricListQuerySchema },
  responses: {
    200: {
      description: 'Usage, cost, latency, and quality metrics',
      content: json(metricListResponseSchema),
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/agents',
  request: { query: agentCatalogQueryObjectSchema },
  responses: {
    200: {
      description: 'Search agent families or list family versions',
      content: json(agentCatalogResponseSchema),
    },
    400: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/similarity',
  request: { body: { content: json(similarityRequestSchema) } },
  responses: {
    200: { description: 'Similarity matches', content: json(similarityResponseSchema) },
    400: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/agents/sources',
  request: {
    query: z.object({
      role: z.enum(['knowledge', 'signal', 'telemetry', 'evaluation']).optional(),
    }),
  },
  responses: {
    200: { description: 'Governed source descriptors', content: json(sourceListResponseSchema) },
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/specs/interpret',
  request: { body: { content: json(interpretSpecRequestSchema) } },
  responses: {
    200: {
      description: 'Single-shot interpretation result',
      content: json(interpretSpecResponseSchema),
    },
    400: errorResponse,
    503: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/specs',
  request: { body: { content: json(createSpecRequestSchema) } },
  responses: {
    201: { description: 'Draft agent specification', content: json(agentSpecSchema) },
    400: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/agents/specs/{specId}',
  request: { params: idParam('specId') },
  responses: {
    200: { description: 'Agent specification', content: json(agentSpecSchema) },
    404: errorResponse,
  },
});

const sectionPaths = [
  ['outcomes', updateOutcomesRequestSchema],
  ['knowledge', updateKnowledgeRequestSchema],
  ['guardrails', updateGuardrailsRequestSchema],
  ['outputs', updateOutputsRequestSchema],
] as const;
for (const [section, schema] of sectionPaths) {
  registry.registerPath({
    method: 'put',
    path: `/agents/specs/{specId}/${section}`,
    request: { params: idParam('specId'), body: { content: json(schema) } },
    responses: {
      200: { description: `Updated ${section} section`, content: json(agentSpecSchema) },
      400: errorResponse,
      404: errorResponse,
      409: errorResponse,
    },
  });
}

registry.registerPath({
  method: 'post',
  path: '/agents/specs/{specId}/generate',
  request: { params: idParam('specId') },
  responses: {
    202: { description: 'Generation accepted', content: json(generationAcceptedSchema) },
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/agents/generation-jobs/{jobId}',
  request: { params: idParam('jobId') },
  responses: {
    200: { description: 'Generation job status', content: json(generationJobSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/{agentId}/recover',
  request: { params: idParam('agentId') },
  responses: {
    200: { description: 'Recovered draft agent', content: json(recoverAgentResponseSchema) },
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/{agentId}/shadow-deploy',
  request: { params: idParam('agentId') },
  responses: {
    200: { description: 'Shadow deployment started', content: json(shadowDeployResponseSchema) },
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/agents/{agentId}/evaluation',
  request: { params: idParam('agentId') },
  responses: {
    200: { description: 'Evaluation results', content: json(evaluationResponseSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/agents/{agentId}',
  request: { params: idParam('agentId') },
  responses: {
    200: { description: 'Agent detail', content: json(agentSchema) },
    404: errorResponse,
  },
});

registry.registerPath({
  method: 'post',
  path: '/agents/{agentId}/certification-runs',
  request: {
    params: idParam('agentId'),
    body: { content: json(createCertificationRunRequestSchema) },
  },
  responses: {
    202: {
      description: 'Certification run accepted',
      content: json(certificationRunAcceptedSchema),
    },
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/agents/certification-runs/{runId}',
  request: { params: idParam('runId'), query: certificationRunDetailQuerySchema },
  responses: {
    200: { description: 'Certification run evidence', content: json(certificationRunDetailSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/agents/{agentId}/certification-runs',
  request: { params: idParam('agentId'), query: certificationRunHistoryQuerySchema },
  responses: {
    200: {
      description: 'Certification run history',
      content: json(certificationRunHistoryResponseSchema),
    },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/{agentId}/promote',
  request: { params: idParam('agentId'), body: { content: json(promotionRequestSchema) } },
  responses: {
    200: { description: 'Atomic champion promotion', content: json(promotionResponseSchema) },
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/{agentId}/retire',
  request: { params: idParam('agentId'), body: { content: json(retirementRequestSchema) } },
  responses: {
    200: {
      description: 'Explicit agent-version retirement',
      content: json(retirementResponseSchema),
    },
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/agents/eval-cases',
  request: { query: evalCaseListQuerySchema },
  responses: {
    200: { description: 'Governed evaluation cases', content: json(evalCaseListResponseSchema) },
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/eval-cases',
  request: { body: { content: json(createEvalCaseRequestSchema) } },
  responses: {
    201: { description: 'Evaluation case candidate', content: json(evalCaseSchema) },
    400: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/eval-cases/{caseId}/deactivate',
  request: {
    params: idParam('caseId'),
    body: { content: json(deactivateEvalCaseRequestSchema) },
  },
  responses: {
    200: { description: 'Deactivated evaluation case', content: json(evalCaseSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/eval-corpus/publish',
  request: { body: { content: json(publishEvalCorpusRequestSchema) } },
  responses: {
    201: {
      description: 'Immutable evaluation corpus version',
      content: json(publishEvalCorpusResponseSchema),
    },
    400: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/agents/certification-gate-configs',
  request: { query: gateConfigListQuerySchema },
  responses: {
    200: {
      description: 'Certification gate configuration',
      content: json(gateConfigListResponseSchema),
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/agents/certification-gate-configs/publish',
  request: { body: { content: json(publishGateConfigRequestSchema) } },
  responses: {
    201: {
      description: 'Published immutable gate configuration',
      content: json(certificationGateConfigSchema),
    },
    400: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/automation-schedules',
  request: { query: automationScheduleListQuerySchema },
  responses: {
    200: {
      description: 'Durable automation schedules',
      content: json(automationScheduleListResponseSchema),
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/automation-schedules',
  request: { body: { content: json(createAutomationScheduleRequestSchema) } },
  responses: {
    201: { description: 'Created automation schedule', content: json(automationScheduleSchema) },
    404: errorResponse,
    409: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/automation-schedules/{scheduleId}',
  request: { params: platformIdParam('scheduleId') },
  responses: {
    200: { description: 'Automation schedule', content: json(automationScheduleSchema) },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/automation-schedules/{scheduleId}/state',
  request: {
    params: platformIdParam('scheduleId'),
    body: { content: json(updateAutomationScheduleStateRequestSchema) },
  },
  responses: {
    200: {
      description: 'Updated schedule lifecycle state',
      content: json(automationScheduleSchema),
    },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/automation-schedules/schedule-due',
  request: { body: { content: json(scheduleDueAutomationsRequestSchema) } },
  responses: {
    200: {
      description: 'Idempotent due-schedule pass',
      content: json(scheduleDueAutomationsResponseSchema),
    },
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/observations',
  request: { query: observationListQuerySchema },
  responses: {
    200: { description: 'Run-linked observations', content: json(observationListResponseSchema) },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/observations',
  request: { body: { content: json(createObservationRequestSchema) } },
  responses: {
    201: { description: 'Recorded observation', content: json(observationSchema) },
    404: errorResponse,
    422: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/improvement-candidates',
  request: { query: improvementCandidateListQuerySchema },
  responses: {
    200: {
      description: 'Human-curated improvement candidates',
      content: json(improvementCandidateListResponseSchema),
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/improvement-candidates',
  request: { body: { content: json(createImprovementCandidateRequestSchema) } },
  responses: {
    201: {
      description: 'Proposed improvement candidate',
      content: json(improvementCandidateSchema),
    },
    404: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/improvement-candidates/{candidateId}/review',
  request: {
    params: platformIdParam('candidateId'),
    body: { content: json(reviewImprovementCandidateRequestSchema) },
  },
  responses: {
    200: {
      description: 'Reviewed improvement candidate',
      content: json(improvementCandidateSchema),
    },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/memory-candidates',
  request: { query: memoryCandidateListQuerySchema },
  responses: {
    200: {
      description: 'Staged durable-memory candidates',
      content: json(memoryCandidateListResponseSchema),
    },
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/memory-candidates',
  request: { body: { content: json(createMemoryCandidateRequestSchema) } },
  responses: {
    201: { description: 'Staged durable-memory write', content: json(memoryCandidateSchema) },
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'post',
  path: '/v1/memory-candidates/{candidateId}/review',
  request: {
    params: platformIdParam('candidateId'),
    body: { content: json(reviewMemoryCandidateRequestSchema) },
  },
  responses: {
    200: { description: 'Human-reviewed memory candidate', content: json(memoryCandidateSchema) },
    403: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/health',
  operationId: 'getHealth',
  security: [],
  responses: {
    200: { description: 'Database-backed health check', content: json(healthResponseSchema) },
    503: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/live',
  operationId: IDENTITY_OPENAPI_OPERATION_IDS.live,
  security: [],
  responses: {
    200: {
      description: 'Process liveness; does not probe dependencies',
      content: json(liveResponseSchema),
    },
  },
});
registry.registerPath({
  method: 'get',
  path: '/ready',
  operationId: IDENTITY_OPENAPI_OPERATION_IDS.ready,
  security: [],
  responses: {
    200: { description: 'Dependency-backed readiness', content: json(readyResponseSchema) },
    503: errorResponse,
  },
});
registry.registerPath({
  method: 'get',
  path: '/v1/session',
  operationId: IDENTITY_OPENAPI_OPERATION_IDS.session,
  responses: {
    200: {
      description: 'Resolved request principal and effective authorization',
      content: json(sessionResponseSchema),
    },
    401: errorResponse,
    503: errorResponse,
  },
});

export function createOpenApiDocument() {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Paul OS API',
      version: '0.3.0',
      description: 'Governed resource, execution, agent specification, and certification API.',
    },
    security: [{ bearerAuth: [] }],
  });
}
