import {
  agentSchema,
  agentFamilyVersionsResponseSchema,
  agentSearchResponseSchema,
  agentSpecSchema,
  apiErrorSchema,
  apiRoutes,
  certificationRunAcceptedSchema,
  certificationRunDetailSchema,
  certificationRunHistoryResponseSchema,
  evaluationResponseSchema,
  generationAcceptedSchema,
  generationJobSchema,
  interpretSpecResponseSchema,
  promotionResponseSchema,
  recoverAgentResponseSchema,
  retirementResponseSchema,
  shadowDeployResponseSchema,
  similarityResponseSchema,
  sourceListResponseSchema,
  approveExecutionRunResponseSchema,
  automationScheduleListResponseSchema,
  automationScheduleSchema,
  authorityGrantListResponseSchema,
  authorityGrantSchema,
  executionRunListResponseSchema,
  executionRunSchema,
  metricListResponseSchema,
  memoryCandidateListResponseSchema,
  memoryCandidateSchema,
  observationListResponseSchema,
  outcomeListResponseSchema,
  improvementCandidateListResponseSchema,
  improvementCandidateSchema,
  platformApiRoutes,
  productionChannelSchema,
  releaseEvaluationSchema,
  resourceListResponseSchema,
  type AgentCatalogQuery,
  type DerivationMode,
  type GuardrailsSection,
  type InterpretSpecRequest,
  type KnowledgeSection,
  type OutcomesSection,
  type OutputsSection,
  type PromotionRequest,
  type SourceDescriptor,
  type UpdateKnowledgeRequest,
  type AuthorityGrant,
  type AutomationSchedule,
  type ExecutionRun,
  type ImprovementCandidate,
  type MemoryCandidate,
  type ResourceVersion,
} from '@agent-builder/contracts';

type Parser<T> = {
  parse(value: unknown): T;
};

export type AgentSearchResponse = ReturnType<typeof agentSearchResponseSchema.parse>;
export type AgentSearchItem = AgentSearchResponse['items'][number];
export type AgentFamilyVersionsResponse = ReturnType<
  typeof agentFamilyVersionsResponseSchema.parse
>;
export type SimilarityResponse = ReturnType<typeof similarityResponseSchema.parse>;
export type SourceListResponse = ReturnType<typeof sourceListResponseSchema.parse>;
export type GenerationAccepted = ReturnType<typeof generationAcceptedSchema.parse>;
export type EvaluationResponse = ReturnType<typeof evaluationResponseSchema.parse>;
export type PlatformResourceList = ReturnType<typeof resourceListResponseSchema.parse>;
export type PlatformRunList = ReturnType<typeof executionRunListResponseSchema.parse>;
export type AuthorityGrantList = ReturnType<typeof authorityGrantListResponseSchema.parse>;
export type OutcomeList = ReturnType<typeof outcomeListResponseSchema.parse>;
export type MetricList = ReturnType<typeof metricListResponseSchema.parse>;
export type AutomationScheduleList = ReturnType<typeof automationScheduleListResponseSchema.parse>;
export type ObservationList = ReturnType<typeof observationListResponseSchema.parse>;
export type ImprovementCandidateList = ReturnType<
  typeof improvementCandidateListResponseSchema.parse
>;
export type MemoryCandidateList = ReturnType<typeof memoryCandidateListResponseSchema.parse>;

export type ResourceFilters = {
  kind?: ResourceVersion['kind'];
  lifecycle?: ResourceVersion['lifecycle'];
  query?: string;
  limit?: number;
};

export type RunFilters = {
  state?: ExecutionRun['state'];
  limit?: number;
};

export type GrantFilters = {
  state?: AuthorityGrant['state'];
  limit?: number;
};

export type ApproveRunInput = {
  projectId: string | null;
  inputConstraints: Record<string, unknown>;
  toolScopes: string[];
  validUntil: string;
  maxRuns: number;
  maxEstimatedCostPerRunUsd: number;
  totalCostBudgetUsd: number;
  rationale: string;
};

export type ReviewImprovementInput = {
  decision: 'incubate' | 'reject';
  rationale: string;
};

export type ReviewMemoryInput =
  | { decision: 'accept' | 'reject'; rationale: string }
  | { decision: 'edit_accept'; editedValue: Record<string, unknown>; rationale: string };

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL as string | undefined;
const apiBaseUrl = configuredBaseUrl?.replace(/\/+$/, '') ?? '';

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(
    message: string,
    options: { code: string; status: number; requestId?: string; details?: unknown },
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.status = options.status;
    this.requestId = options.requestId ?? null;
    this.details = options.details;
  }
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body.length === 0) return null;

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ApiError('The server returned an unreadable response.', {
      code: 'INVALID_RESPONSE',
      status: response.status,
    });
  }
}

async function request<T>(path: string, schema: Parser<T>, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body) headers.set('Content-Type', 'application/json');
  const url = new URL(`${apiBaseUrl}${path}`, window.location.origin);
  const response = await fetch(url, {
    ...init,
    headers,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(payload);
    if (parsedError.success) {
      throw new ApiError(parsedError.data.error.message, {
        code: parsedError.data.error.code,
        status: response.status,
        requestId: parsedError.data.error.requestId,
        details: parsedError.data.error.details,
      });
    }
    throw new ApiError(`Request failed with status ${response.status}.`, {
      code: 'HTTP_ERROR',
      status: response.status,
    });
  }

  try {
    return schema.parse(payload);
  } catch (error) {
    throw new ApiError('The server response did not match the shared contract.', {
      code: 'CONTRACT_MISMATCH',
      status: response.status,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

const jsonBody = (value: unknown): Pick<RequestInit, 'body' | 'method'> => ({
  method: 'POST',
  body: JSON.stringify(value),
});

export type CatalogFilters = Partial<AgentCatalogQuery>;
type InterpretationConfirmation = NonNullable<UpdateKnowledgeRequest['interpretationConfirmation']>;

function appendParams(path: string, values: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params.size > 0 ? `${path}?${params.toString()}` : path;
}

export const agentApi = {
  search(query: string) {
    const params = new URLSearchParams();
    if (query.trim()) params.set('query', query.trim());
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return request(`${apiRoutes.agents}${suffix}`, agentSearchResponseSchema);
  },

  listCatalog(filters: CatalogFilters) {
    return request(
      appendParams(apiRoutes.agents, {
        query: filters.query,
        department: filters.department,
        status: filters.status,
        provider: filters.provider,
        limit: filters.limit,
        cursor: filters.cursor,
      }),
      agentSearchResponseSchema,
    );
  },

  listFamilyVersions(familyId: string, includeRetired = true, cursor?: string) {
    return request(
      appendParams(apiRoutes.agents, { familyId, includeRetired, limit: 30, cursor }),
      agentFamilyVersionsResponseSchema,
    );
  },

  similarity(query: string, candidateIds?: string[]) {
    return request(
      apiRoutes.similarity,
      similarityResponseSchema,
      jsonBody({
        query,
        ...(candidateIds && candidateIds.length > 0 ? { candidateIds } : {}),
      }),
    );
  },

  getAgent(agentId: string) {
    return request(apiRoutes.agent(agentId), agentSchema);
  },

  listSources(role?: SourceDescriptor['role']) {
    const suffix = role ? `?${new URLSearchParams({ role }).toString()}` : '';
    return request(`${apiRoutes.sources}${suffix}`, sourceListResponseSchema);
  },

  createSpec(
    outcomes: OutcomesSection,
    baseAgentId: string | null,
    derivationMode: DerivationMode,
    interpretationId: string | null,
  ) {
    return request(
      apiRoutes.specs,
      agentSpecSchema,
      jsonBody({ outcomes, baseAgentId, derivationMode, interpretationId }),
    );
  },

  getSpec(specId: string) {
    return request(apiRoutes.spec(specId), agentSpecSchema);
  },

  updateOutcomes(
    specId: string,
    outcomes: OutcomesSection,
    interpretationConfirmation?: InterpretationConfirmation,
  ) {
    return request(apiRoutes.specSection(specId, 'outcomes'), agentSpecSchema, {
      method: 'PUT',
      body: JSON.stringify({
        value: outcomes,
        ...(interpretationConfirmation ? { interpretationConfirmation } : {}),
      }),
    });
  },

  updateKnowledge(
    specId: string,
    knowledge: KnowledgeSection,
    interpretationConfirmation?: InterpretationConfirmation,
  ) {
    return request(apiRoutes.specSection(specId, 'knowledge'), agentSpecSchema, {
      method: 'PUT',
      body: JSON.stringify({
        value: knowledge,
        ...(interpretationConfirmation ? { interpretationConfirmation } : {}),
      }),
    });
  },

  updateGuardrails(
    specId: string,
    guardrails: GuardrailsSection,
    interpretationConfirmation?: InterpretationConfirmation,
  ) {
    return request(apiRoutes.specSection(specId, 'guardrails'), agentSpecSchema, {
      method: 'PUT',
      body: JSON.stringify({
        value: guardrails,
        ...(interpretationConfirmation ? { interpretationConfirmation } : {}),
      }),
    });
  },

  updateOutputs(
    specId: string,
    outputs: OutputsSection,
    interpretationConfirmation?: InterpretationConfirmation,
  ) {
    return request(apiRoutes.specSection(specId, 'outputs'), agentSpecSchema, {
      method: 'PUT',
      body: JSON.stringify({
        value: outputs,
        ...(interpretationConfirmation ? { interpretationConfirmation } : {}),
      }),
    });
  },

  interpretSpec(value: InterpretSpecRequest) {
    return request(apiRoutes.interpretSpec, interpretSpecResponseSchema, jsonBody(value));
  },

  generate(specId: string) {
    return request(apiRoutes.generate(specId), generationAcceptedSchema, { method: 'POST' });
  },

  getGenerationJob(jobId: string) {
    return request(apiRoutes.generationJob(jobId), generationJobSchema);
  },

  recover(agentId: string) {
    return request(apiRoutes.recover(agentId), recoverAgentResponseSchema, { method: 'POST' });
  },

  shadowDeploy(agentId: string) {
    return request(apiRoutes.shadowDeploy(agentId), shadowDeployResponseSchema, { method: 'POST' });
  },

  getEvaluation(agentId: string) {
    return request(apiRoutes.evaluation(agentId), evaluationResponseSchema);
  },

  createCertificationRun(agentId: string) {
    return request(
      apiRoutes.certificationRuns(agentId),
      certificationRunAcceptedSchema,
      jsonBody({}),
    );
  },

  getCertificationRun(runId: string, cursor?: string) {
    return request(
      appendParams(apiRoutes.certificationRun(runId), { limit: 30, cursor }),
      certificationRunDetailSchema,
    );
  },

  listCertificationRuns(agentId: string, cursor?: string) {
    return request(
      appendParams(apiRoutes.certificationRuns(agentId), { limit: 30, cursor }),
      certificationRunHistoryResponseSchema,
    );
  },

  promote(agentId: string, value: PromotionRequest) {
    return request(apiRoutes.promote(agentId), promotionResponseSchema, jsonBody(value));
  },

  retire(agentId: string, rationale: string) {
    return request(apiRoutes.retire(agentId), retirementResponseSchema, jsonBody({ rationale }));
  },
};

export const platformApi = {
  listResources(filters: ResourceFilters = {}) {
    return request(
      appendParams(platformApiRoutes.resources, {
        kind: filters.kind,
        lifecycle: filters.lifecycle,
        query: filters.query,
        limit: filters.limit ?? 50,
      }),
      resourceListResponseSchema,
    );
  },

  listExecutionRuns(filters: RunFilters = {}) {
    return request(
      appendParams(platformApiRoutes.executionRuns, {
        state: filters.state,
        limit: filters.limit ?? 50,
      }),
      executionRunListResponseSchema,
    );
  },

  getExecutionRun(runId: string) {
    return request(platformApiRoutes.executionRun(runId), executionRunSchema);
  },

  approveExecutionRun(runId: string, value: ApproveRunInput) {
    return request(
      platformApiRoutes.approveExecutionRun(runId),
      approveExecutionRunResponseSchema,
      jsonBody(value),
    );
  },

  cancelExecutionRun(runId: string) {
    return request(platformApiRoutes.cancelExecutionRun(runId), executionRunSchema, {
      method: 'POST',
    });
  },

  listAuthorityGrants(filters: GrantFilters = {}) {
    return request(
      appendParams(platformApiRoutes.authorityGrants, {
        state: filters.state,
        limit: filters.limit ?? 50,
      }),
      authorityGrantListResponseSchema,
    );
  },

  revokeAuthorityGrant(grantId: string) {
    return request(platformApiRoutes.revokeAuthorityGrant(grantId), authorityGrantSchema, {
      method: 'POST',
    });
  },

  listOutcomes(runId?: string) {
    return request(appendParams(platformApiRoutes.outcomes, { runId }), outcomeListResponseSchema);
  },

  listMetrics(runId?: string) {
    return request(appendParams(platformApiRoutes.metrics, { runId }), metricListResponseSchema);
  },

  listAutomationSchedules(state?: AutomationSchedule['state']) {
    return request(
      appendParams(platformApiRoutes.automationSchedules, { state, limit: 50 }),
      automationScheduleListResponseSchema,
    );
  },

  updateAutomationScheduleState(
    scheduleId: string,
    value: { state: AutomationSchedule['state']; rationale: string },
  ) {
    return request(
      platformApiRoutes.automationScheduleState(scheduleId),
      automationScheduleSchema,
      jsonBody(value),
    );
  },

  getProductionChannel(channelKey: string) {
    return request(platformApiRoutes.productionChannel(channelKey), productionChannelSchema);
  },

  getReleaseEvaluation(evaluationId: string) {
    return request(platformApiRoutes.releaseEvaluation(evaluationId), releaseEvaluationSchema);
  },

  listObservations() {
    return request(
      appendParams(platformApiRoutes.observations, { limit: 50 }),
      observationListResponseSchema,
    );
  },

  listImprovementCandidates(state?: ImprovementCandidate['state']) {
    return request(
      appendParams(platformApiRoutes.improvementCandidates, { state, limit: 50 }),
      improvementCandidateListResponseSchema,
    );
  },

  reviewImprovementCandidate(candidateId: string, value: ReviewImprovementInput) {
    return request(
      platformApiRoutes.reviewImprovementCandidate(candidateId),
      improvementCandidateSchema,
      jsonBody(value),
    );
  },

  listMemoryCandidates(state?: MemoryCandidate['state']) {
    return request(
      appendParams(platformApiRoutes.memoryCandidates, { state, limit: 50 }),
      memoryCandidateListResponseSchema,
    );
  },

  reviewMemoryCandidate(candidateId: string, value: ReviewMemoryInput) {
    return request(
      platformApiRoutes.reviewMemoryCandidate(candidateId),
      memoryCandidateSchema,
      jsonBody(value),
    );
  },
};

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
