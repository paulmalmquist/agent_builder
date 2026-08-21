import {
  agentSchema,
  agentFamilyVersionsResponseSchema,
  agentSearchResponseSchema,
  agentSpecSchema,
  attentionItemDetailSchema,
  attentionResolutionSchema,
  attentionResponseSchema,
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
  approveExecutionRunGroupResponseSchema,
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
  productionChannelLookupSchema,
  productionChannelMutationResponseSchema,
  rejectExecutionRunGroupResponseSchema,
  pluginCatalogItemSchema,
  pluginCatalogResponseSchema,
  pluginHealthCheckSchema,
  pluginInstallationListResponseSchema,
  pluginInstallationSchema,
  pluginUsedByResponseSchema,
  builderDecisionSchema,
  builderIntakeResultsSchema,
  builderIntakeSchema,
  catalogPublicationListResponseSchema,
  REUSE_V1_ROUTES,
  releaseDeclineResponseSchema,
  releaseEvaluationSchema,
  resourceListResponseSchema,
  resourceVersionDetailSchema,
  roadmapProgramSchema,
  sessionResponseSchema,
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
  type PluginAuthorityScope,
  type PluginInstallation,
  type PluginResourceSpec,
  type ResourceVersion,
  type BuilderDecision,
  type BuilderDecisionAction,
  type BuilderIntake,
  type BuilderIntakeResults,
  type CapabilityProfile,
} from '@agent-builder/contracts';

type Parser<T> = {
  parse(value: unknown): T;
};

type RequestOptions = RequestInit & {
  timeoutMessage?: string;
  timeoutMs?: number;
};

const ATTENTION_REQUEST_TIMEOUT_MS = 8_000;

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
export type RoadmapProgramResponse = ReturnType<typeof roadmapProgramSchema.parse>;
export type PlatformSession = ReturnType<typeof sessionResponseSchema.parse>;
export type CatalogPublicationList = ReturnType<typeof catalogPublicationListResponseSchema.parse>;
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
export type AttentionResponse = ReturnType<typeof attentionResponseSchema.parse>;
export type AttentionItemDetail = ReturnType<typeof attentionItemDetailSchema.parse>;
export type AttentionResolution = ReturnType<typeof attentionResolutionSchema.parse>;
export type PluginCatalog = ReturnType<typeof pluginCatalogResponseSchema.parse>;
export type PluginCatalogItem = ReturnType<typeof pluginCatalogItemSchema.parse>;
export type PluginInstallationList = ReturnType<typeof pluginInstallationListResponseSchema.parse>;
export type PluginHealthCheck = ReturnType<typeof pluginHealthCheckSchema.parse>;
export type PluginUsedBy = ReturnType<typeof pluginUsedByResponseSchema.parse>;
export type CreateBuilderIntakeInput = {
  request: string;
  department: string;
  capabilityProfile: CapabilityProfile;
  confirmed: boolean;
};
export type CreateBuilderDecisionInput = {
  action: BuilderDecisionAction;
  selectedPublicationId: string | null;
  buildNewReason: string | null;
};

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
  entryResourceVersionId: string;
  projectId: string | null;
  inputConstraints: Record<string, unknown>;
  toolScopes: string[];
  pluginScopes: Array<
    Pick<PluginAuthorityScope, 'installationId' | 'pluginVersionId' | 'tool' | 'limits'>
  >;
  validUntil: string;
  maxRuns: number;
  maxEstimatedCostPerRunUsd: number;
  totalCostBudgetUsd: number;
  rationale: string;
};

export type PluginCatalogFilters = {
  transport?: PluginResourceSpec['transport'];
  executionPlacement?: PluginResourceSpec['executionPlacement'];
  classification?: PluginResourceSpec['classification'];
  includeDisabled?: boolean;
  limit?: number;
};

export type PluginSecretBindingInput = { slot: string; reference: string };
export type InstallPluginInput = {
  pluginVersionId: string;
  developmentOnly?: boolean;
  secretBindings: PluginSecretBindingInput[];
};
export type ConfigurePluginInput = {
  secretBindings: PluginSecretBindingInput[];
  rationale: string;
};

export type ReviewImprovementInput = {
  decision: 'incubate' | 'reject';
  rationale: string;
  decisionGroupKey?: string;
  expectedRequestCount?: number;
};

export type ReviewMemoryInput = (
  | { decision: 'accept' | 'reject'; rationale: string }
  | { decision: 'edit_accept'; editedValue: Record<string, unknown>; rationale: string }
) & { decisionGroupKey?: string; expectedRequestCount?: number };

export type DeclineReleaseInput = {
  releaseId: string;
  evaluationId: string;
  rationale: string;
};

export type PromoteReleaseInput = DeclineReleaseInput;
export type RollbackReleaseInput = {
  targetReleaseId: string;
  rationale: string;
};

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

async function request<T>(path: string, schema: Parser<T>, init?: RequestOptions): Promise<T> {
  const {
    timeoutMessage = 'The server took too long to respond.',
    timeoutMs,
    ...fetchOptions
  } = init ?? {};
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (init?.body) headers.set('Content-Type', 'application/json');
  const url = new URL(`${apiBaseUrl}${path}`, window.location.origin);
  // Jest's jsdom AbortSignal belongs to a different realm than undici's fetch implementation.
  // The Promise deadline remains authoritative in tests; real browser requests are also aborted.
  const timeoutController =
    timeoutMs === undefined || import.meta.env.MODE === 'test' ? null : new AbortController();
  const externalSignal = fetchOptions.signal;
  const forwardExternalAbort = () => timeoutController?.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', forwardExternalAbort, { once: true });
  const requestSignal = timeoutController?.signal ?? externalSignal;
  const responsePromise = fetch(url, {
    ...fetchOptions,
    headers,
    ...(requestSignal ? { signal: requestSignal } : {}),
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let response: Response;
  try {
    response = await Promise.race([
      responsePromise,
      ...(timeoutMs === undefined
        ? []
        : [
            new Promise<never>((_resolve, reject) => {
              timeout = setTimeout(() => {
                timeoutController?.abort('attention-request-timeout');
                reject(
                  new ApiError(timeoutMessage, {
                    code: 'REQUEST_TIMEOUT',
                    status: 408,
                  }),
                );
              }, timeoutMs);
            }),
          ]),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', forwardExternalAbort);
  }
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

async function requestEmpty(path: string, init: RequestInit): Promise<void> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(new URL(`${apiBaseUrl}${path}`, window.location.origin), {
    ...init,
    headers,
  });
  if (response.ok) return;
  const payload = await readJson(response);
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

const builderV1Routes = {
  sources: '/v1/builder/sources',
  specs: '/v1/builder/specs',
  spec: (specId: string) => `/v1/builder/specs/${specId}`,
  specSection: (specId: string, section: 'outcomes' | 'knowledge' | 'guardrails' | 'outputs') =>
    `/v1/builder/specs/${specId}/${section}`,
  interpretSpec: '/v1/builder/specs/interpret',
  generate: (specId: string) => `/v1/builder/specs/${specId}/generate`,
  generationJob: (jobId: string) => `/v1/builder/generation-jobs/${jobId}`,
  recover: (agentId: string) => `/v1/builder/agents/${agentId}/recover`,
  shadowDeploy: (agentId: string) => `/v1/builder/agents/${agentId}/shadow-deploy`,
  evaluation: (agentId: string) => `/v1/builder/agents/${agentId}/evaluation`,
} as const;

/**
 * The Build surface uses only the versioned control-plane contract. Legacy `/agents` calls remain
 * isolated to the catalog and certification screens until their scheduled cutover.
 */
export const builderApi = {
  createIntake(value: CreateBuilderIntakeInput): Promise<BuilderIntake> {
    return request(REUSE_V1_ROUTES.builderIntakes, builderIntakeSchema, jsonBody(value));
  },

  getReferredChoices(intakeId: string): Promise<BuilderIntakeResults> {
    return request(
      REUSE_V1_ROUTES.builderIntakeChoices.replace(':intakeId', encodeURIComponent(intakeId)),
      builderIntakeResultsSchema,
    );
  },

  createDecision(
    intakeId: string,
    value: CreateBuilderDecisionInput,
    idempotencyKey: string,
  ): Promise<BuilderDecision> {
    return request(
      REUSE_V1_ROUTES.builderDecisions.replace(':intakeId', encodeURIComponent(intakeId)),
      builderDecisionSchema,
      {
        ...jsonBody(value),
        headers: { 'Idempotency-Key': idempotencyKey },
      },
    );
  },

  listSources(role?: SourceDescriptor['role']) {
    const suffix = role ? `?${new URLSearchParams({ role }).toString()}` : '';
    return request(`${builderV1Routes.sources}${suffix}`, sourceListResponseSchema);
  },

  createSpec(
    outcomes: OutcomesSection,
    baseAgentId: string | null,
    derivationMode: DerivationMode,
    interpretationId: string | null,
  ) {
    return request(
      builderV1Routes.specs,
      agentSpecSchema,
      jsonBody({ outcomes, baseAgentId, derivationMode, interpretationId }),
    );
  },

  getSpec(specId: string) {
    return request(builderV1Routes.spec(specId), agentSpecSchema);
  },

  updateOutcomes(
    specId: string,
    outcomes: OutcomesSection,
    interpretationConfirmation?: InterpretationConfirmation,
  ) {
    return request(builderV1Routes.specSection(specId, 'outcomes'), agentSpecSchema, {
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
    return request(builderV1Routes.specSection(specId, 'knowledge'), agentSpecSchema, {
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
    return request(builderV1Routes.specSection(specId, 'guardrails'), agentSpecSchema, {
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
    return request(builderV1Routes.specSection(specId, 'outputs'), agentSpecSchema, {
      method: 'PUT',
      body: JSON.stringify({
        value: outputs,
        ...(interpretationConfirmation ? { interpretationConfirmation } : {}),
      }),
    });
  },

  interpretSpec(value: InterpretSpecRequest) {
    return request(builderV1Routes.interpretSpec, interpretSpecResponseSchema, jsonBody(value));
  },

  generate(specId: string) {
    return request(builderV1Routes.generate(specId), generationAcceptedSchema, { method: 'POST' });
  },

  getGenerationJob(jobId: string) {
    return request(builderV1Routes.generationJob(jobId), generationJobSchema);
  },

  recover(agentId: string) {
    return request(builderV1Routes.recover(agentId), recoverAgentResponseSchema, {
      method: 'POST',
    });
  },

  shadowDeploy(agentId: string) {
    return request(builderV1Routes.shadowDeploy(agentId), shadowDeployResponseSchema, {
      method: 'POST',
    });
  },

  getEvaluation(agentId: string) {
    return request(builderV1Routes.evaluation(agentId), evaluationResponseSchema);
  },
};

export const platformApi = {
  getSession() {
    return request('/v1/session', sessionResponseSchema);
  },

  listCatalogPublications() {
    return request(
      `${REUSE_V1_ROUTES.catalogPublications}?includeRetired=false&limit=100`,
      catalogPublicationListResponseSchema,
    );
  },

  getAttention() {
    return request(platformApiRoutes.attention, attentionResponseSchema, {
      timeoutMessage: 'The review queue took too long to respond.',
      timeoutMs: ATTENTION_REQUEST_TIMEOUT_MS,
    });
  },

  getAttentionItem(itemId: string) {
    return request(platformApiRoutes.attentionItem(itemId), attentionItemDetailSchema);
  },

  resolveAttentionItem(itemId: string, rationale: string) {
    return request(
      platformApiRoutes.resolveAttentionItem(itemId),
      attentionResolutionSchema,
      jsonBody({ rationale }),
    );
  },

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

  getResource(resourceVersionId: string) {
    return request(platformApiRoutes.resource(resourceVersionId), resourceVersionDetailSchema);
  },

  getRoadmaps() {
    return request(platformApiRoutes.roadmaps, roadmapProgramSchema);
  },

  listPlugins(filters: PluginCatalogFilters = {}) {
    return request(
      appendParams(platformApiRoutes.plugins, {
        transport: filters.transport,
        executionPlacement: filters.executionPlacement,
        classification: filters.classification,
        includeDisabled: filters.includeDisabled,
        limit: filters.limit ?? 50,
      }),
      pluginCatalogResponseSchema,
    );
  },

  getPlugin(pluginVersionId: string) {
    return request(platformApiRoutes.plugin(pluginVersionId), pluginCatalogItemSchema);
  },

  listPluginInstallations(state?: PluginInstallation['state']) {
    return request(
      appendParams(platformApiRoutes.pluginInstallations, { state, limit: 100 }),
      pluginInstallationListResponseSchema,
    );
  },

  getPluginInstallation(installationId: string) {
    return request(platformApiRoutes.pluginInstallation(installationId), pluginInstallationSchema);
  },

  installPlugin(value: InstallPluginInput) {
    return request(
      platformApiRoutes.pluginInstallations,
      pluginInstallationSchema,
      jsonBody(value),
    );
  },

  configurePluginInstallation(installationId: string, value: ConfigurePluginInput) {
    return request(
      platformApiRoutes.configurePluginInstallation(installationId),
      pluginInstallationSchema,
      jsonBody(value),
    );
  },

  checkPluginHealth(installationId: string) {
    return request(platformApiRoutes.checkPluginHealth(installationId), pluginHealthCheckSchema, {
      method: 'POST',
    });
  },

  setPluginInstallationState(
    installationId: string,
    action: 'enable' | 'disable',
    rationale: string,
  ) {
    const path =
      action === 'enable'
        ? platformApiRoutes.enablePluginInstallation(installationId)
        : platformApiRoutes.disablePluginInstallation(installationId);
    return request(path, pluginInstallationSchema, jsonBody({ rationale }));
  },

  getPluginUsedBy(installationId: string) {
    return request(platformApiRoutes.pluginUsedBy(installationId), pluginUsedByResponseSchema);
  },

  uninstallPlugin(installationId: string, rationale: string) {
    return requestEmpty(platformApiRoutes.uninstallPlugin(installationId), {
      method: 'POST',
      body: JSON.stringify({ rationale }),
    });
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

  approveExecutionApprovalGroup(groupKey: string, value: ApproveRunInput) {
    return request(
      platformApiRoutes.approveExecutionApprovalGroup(groupKey),
      approveExecutionRunGroupResponseSchema,
      jsonBody(value),
    );
  },

  rejectExecutionRun(runId: string, rationale: string) {
    return request(
      platformApiRoutes.rejectExecutionRun(runId),
      executionRunSchema,
      jsonBody({ rationale }),
    );
  },

  rejectExecutionApprovalGroup(groupKey: string, rationale: string) {
    return request(
      platformApiRoutes.rejectExecutionApprovalGroup(groupKey),
      rejectExecutionRunGroupResponseSchema,
      jsonBody({ rationale }),
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
    return request(platformApiRoutes.productionChannel(channelKey), productionChannelLookupSchema);
  },

  promoteRelease(channelKey: string, value: PromoteReleaseInput) {
    return request(
      platformApiRoutes.promoteRelease(channelKey),
      productionChannelMutationResponseSchema,
      jsonBody(value),
    );
  },

  declineRelease(channelKey: string, value: DeclineReleaseInput) {
    return request(
      platformApiRoutes.declineRelease(channelKey),
      releaseDeclineResponseSchema,
      jsonBody(value),
    );
  },

  rollbackRelease(channelKey: string, value: RollbackReleaseInput) {
    return request(
      platformApiRoutes.rollbackRelease(channelKey),
      productionChannelMutationResponseSchema,
      jsonBody(value),
    );
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
