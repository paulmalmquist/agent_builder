import type {
  Agent,
  AgentCatalogQuery,
  AgentCatalogResponse,
  AgentSpec,
  CertificationRunDetail,
  EvalCase,
  GuardrailsSection,
  GenerationJob,
  InterpretSpecRequest,
  InterpretSpecResponse,
  KnowledgeSection,
  OutcomesSection,
  OutputsSection,
  PublishGateConfigRequest,
  SourceDescriptor,
  UpdateGuardrailsRequest,
  UpdateKnowledgeRequest,
  UpdateOutcomesRequest,
  UpdateOutputsRequest,
  agentCatalogResponseSchema,
  certificationGateConfigSchema,
  certificationRunAcceptedSchema,
  certificationRunHistoryQuerySchema,
  certificationRunHistoryResponseSchema,
  createEvalCaseRequestSchema,
  createSpecRequestSchema,
  deactivateEvalCaseRequestSchema,
  evalCaseListQuerySchema,
  evalCaseListResponseSchema,
  evaluationResponseSchema,
  gateConfigListResponseSchema,
  generationAcceptedSchema,
  promotionRequestSchema,
  promotionResponseSchema,
  publishEvalCorpusRequestSchema,
  publishEvalCorpusResponseSchema,
  recoverAgentResponseSchema,
  retirementRequestSchema,
  retirementResponseSchema,
  shadowDeployResponseSchema,
  similarityRequestSchema,
  similarityResponseSchema,
  sourceRoleSchema,
} from '@agent-builder/contracts';
import type { z } from 'zod';
import type { CertificationDispatcherApi } from '../certification/dispatcher.js';
import type { MaintenanceSchedulerApi } from '../maintenance/scheduler.js';

export interface CatalogApi {
  list(query: AgentCatalogQuery): Promise<AgentCatalogResponse>;
  search(query: string): Promise<z.infer<typeof agentCatalogResponseSchema>>;
  similarity(
    input: z.infer<typeof similarityRequestSchema>,
  ): Promise<z.infer<typeof similarityResponseSchema>>;
  getAgent(agentId: string): Promise<Agent>;
}

export interface SourceApi {
  list(role: z.infer<typeof sourceRoleSchema> | null): Promise<SourceDescriptor[]>;
}

export interface SpecApi {
  create(input: z.input<typeof createSpecRequestSchema>): Promise<AgentSpec>;
  get(specId: string): Promise<AgentSpec>;
  updateOutcomes(
    specId: string,
    input: UpdateOutcomesRequest | OutcomesSection,
  ): Promise<AgentSpec>;
  updateKnowledge(
    specId: string,
    input: UpdateKnowledgeRequest | KnowledgeSection,
  ): Promise<AgentSpec>;
  updateGuardrails(
    specId: string,
    input: UpdateGuardrailsRequest | GuardrailsSection,
  ): Promise<AgentSpec>;
  updateOutputs(specId: string, input: UpdateOutputsRequest | OutputsSection): Promise<AgentSpec>;
}

export interface InterpretationApi {
  interpret(input: InterpretSpecRequest): Promise<InterpretSpecResponse>;
  deleteExpiredUnattached(): Promise<number>;
}

export interface GenerationApi {
  accept(specId: string): Promise<z.infer<typeof generationAcceptedSchema>>;
  getJob(jobId: string): Promise<GenerationJob>;
}

export interface DeploymentApi {
  recover(agentId: string): Promise<z.infer<typeof recoverAgentResponseSchema>>;
  shadowDeploy(agentId: string): Promise<z.infer<typeof shadowDeployResponseSchema>>;
  evaluation(agentId: string): Promise<z.infer<typeof evaluationResponseSchema>>;
}

export interface CertificationApi {
  createRun(agentId: string): Promise<z.infer<typeof certificationRunAcceptedSchema>>;
  getRun(runId: string, limit: number, cursor?: string): Promise<CertificationRunDetail>;
  listRuns(
    agentId: string,
    query: z.infer<typeof certificationRunHistoryQuerySchema>,
  ): Promise<z.infer<typeof certificationRunHistoryResponseSchema>>;
}

export interface PromotionApi {
  promote(
    agentId: string,
    input: z.infer<typeof promotionRequestSchema>,
  ): Promise<z.infer<typeof promotionResponseSchema>>;
  retire(
    agentId: string,
    input: z.infer<typeof retirementRequestSchema>,
  ): Promise<z.infer<typeof retirementResponseSchema>>;
}

export interface CorpusApi {
  listCases(
    query: z.infer<typeof evalCaseListQuerySchema>,
  ): Promise<z.infer<typeof evalCaseListResponseSchema>>;
  createCase(input: z.infer<typeof createEvalCaseRequestSchema>): Promise<EvalCase>;
  deactivateCase(
    caseId: string,
    input: z.infer<typeof deactivateEvalCaseRequestSchema>,
  ): Promise<EvalCase>;
  publish(
    input: z.infer<typeof publishEvalCorpusRequestSchema>,
  ): Promise<z.infer<typeof publishEvalCorpusResponseSchema>>;
}

export interface GateConfigApi {
  list(includeSuperseded: boolean): Promise<z.infer<typeof gateConfigListResponseSchema>>;
  publish(input: PublishGateConfigRequest): Promise<z.infer<typeof certificationGateConfigSchema>>;
}

export interface HealthApi {
  check(): Promise<{ status: 'ok'; database: 'connected'; timestamp: string }>;
}

export interface DispatcherApi {
  enqueue(jobId: string): void;
  recoverAndResume(): Promise<void>;
}

export interface ServiceBundle {
  catalog: CatalogApi;
  sources: SourceApi;
  specs: SpecApi;
  interpretations: InterpretationApi;
  generation: GenerationApi;
  deployment: DeploymentApi;
  certification: CertificationApi;
  promotion: PromotionApi;
  corpus: CorpusApi;
  gateConfigs: GateConfigApi;
  health: HealthApi;
  dispatcher: DispatcherApi;
  certificationDispatcher: CertificationDispatcherApi;
  maintenance: MaintenanceSchedulerApi;
}
