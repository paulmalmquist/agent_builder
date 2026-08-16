import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
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
      title: 'Relativity Agent Builder API',
      version: '0.3.0',
      description: 'Reuse-first governed agent specification, certification, and promotion API.',
    },
  });
}
