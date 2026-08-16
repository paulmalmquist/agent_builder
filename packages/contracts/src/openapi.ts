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
  createReleaseEvaluationRequestSchema,
  productionChannelKeySchema,
  productionChannelMutationResponseSchema,
  productionChannelSchema,
  promoteReleaseRequestSchema,
  releaseEvaluationSchema,
  rollbackReleaseRequestSchema,
} from './release-governance-schemas.js';

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

const platformIdParam = (
  name: 'releaseId' | 'grantId' | 'runId' | 'scheduleId' | 'candidateId' | 'evaluationId',
) => z.object({ [name]: uuidSchema }) as z.ZodObject<Record<typeof name, typeof uuidSchema>>;

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
  responses: {
    200: { description: 'Database-backed health check', content: json(healthResponseSchema) },
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
  });
}
