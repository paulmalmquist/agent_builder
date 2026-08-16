import { z } from 'zod';
import {
  agentManifestSchema,
  agentStatusSchema,
  generationErrorSchema,
  isoDateTimeSchema,
  jsonObjectSchema,
  jsonValueSchema,
  uuidSchema,
} from './schemas.js';

export const prunedCertificationManifestSnapshotSchema = z
  .object({ pruned: z.literal(true) })
  .strict();
export const certificationManifestSnapshotSchema = z.union([
  agentManifestSchema,
  prunedCertificationManifestSnapshotSchema,
]);
export type CertificationManifestSnapshot = z.infer<typeof certificationManifestSnapshotSchema>;

export const certificationRunStateSchema = z.enum([
  'queued',
  'running',
  'passed',
  'failed',
  'error',
]);
export const certificationRunKindSchema = z.enum(['challenger', 'champion_recertification']);
export const certificationVerdictSchema = z.enum(['passed', 'failed', 'error']);
export const executorKindSchema = z.enum(['manifest_fixture']);
export const evaluationModeSchema = z.enum(['corpus_coverage', 'semantic_execution']);
export const certificationResultsAvailabilitySchema = z.enum([
  'full',
  'summary_only',
  'promotion_evidence',
]);
export const certificationGateKeySchema = z.enum([
  'factual_accuracy',
  'citation_coverage',
  'unauthorized_actions',
  'champion_regression',
]);
export const certificationGateOperatorSchema = z.enum(['gte', 'lte', 'eq']);
export const certificationGateResultStatusSchema = z.enum(['passed', 'failed', 'not_applicable']);
export const certificationGateConfigStateSchema = z.enum(['active', 'superseded']);

export type CertificationRunState = z.infer<typeof certificationRunStateSchema>;
export type CertificationRunKind = z.infer<typeof certificationRunKindSchema>;
export type CertificationGateKey = z.infer<typeof certificationGateKeySchema>;

export const certificationGateDefinitionSchema = z.object({
  key: certificationGateKeySchema,
  operator: certificationGateOperatorSchema,
  threshold: z.number().finite(),
});
export type CertificationGateDefinition = z.infer<typeof certificationGateDefinitionSchema>;

const allGateKeys = new Set<CertificationGateKey>([
  'factual_accuracy',
  'citation_coverage',
  'unauthorized_actions',
  'champion_regression',
]);

export const certificationGateDefinitionsSchema = z
  .array(certificationGateDefinitionSchema)
  .length(4)
  .superRefine((gates, context) => {
    const seen = new Set(gates.map((gate) => gate.key));
    if (seen.size !== allGateKeys.size || [...allGateKeys].some((key) => !seen.has(key))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'All four certification gates must be supplied exactly once',
      });
    }

    const expectedOperators: Record<
      CertificationGateKey,
      z.infer<typeof certificationGateOperatorSchema>
    > = {
      factual_accuracy: 'gte',
      citation_coverage: 'eq',
      unauthorized_actions: 'eq',
      champion_regression: 'lte',
    };
    gates.forEach((gate, index) => {
      if (gate.operator !== expectedOperators[gate.key]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${gate.key} must use the ${expectedOperators[gate.key]} operator`,
          path: [index, 'operator'],
        });
      }
      const isRatioGate = gate.key === 'factual_accuracy' || gate.key === 'citation_coverage';
      if (isRatioGate && (gate.threshold < 0 || gate.threshold > 1)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${gate.key} threshold must be between 0 and 1`,
          path: [index, 'threshold'],
        });
      }
      if (
        gate.key === 'unauthorized_actions' &&
        (!Number.isInteger(gate.threshold) || gate.threshold < 0)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'unauthorized_actions threshold must be a non-negative integer',
          path: [index, 'threshold'],
        });
      }
      if (gate.key === 'champion_regression' && (gate.threshold < -1 || gate.threshold > 1)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'champion_regression threshold must be between -1 and 1',
          path: [index, 'threshold'],
        });
      }
    });
  });

export const certificationGateConfigSchema = z.object({
  id: uuidSchema,
  version: z.number().int().positive(),
  state: certificationGateConfigStateSchema,
  promotionFreshnessHours: z.number().int().min(1).max(720),
  gates: certificationGateDefinitionsSchema,
  compatibleExecutorKinds: z.array(executorKindSchema).min(1),
  publishedBy: z.string().min(1).max(200),
  rationale: z.string().min(10).max(2000),
  activatedAt: isoDateTimeSchema,
  supersededAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type CertificationGateConfig = z.infer<typeof certificationGateConfigSchema>;

export const publishGateConfigRequestSchema = z.object({
  baseVersion: z.number().int().positive().nullable(),
  promotionFreshnessHours: z.number().int().min(1).max(720),
  gates: certificationGateDefinitionsSchema,
  rationale: z.string().trim().min(10).max(2000),
});
export type PublishGateConfigRequest = z.infer<typeof publishGateConfigRequestSchema>;

export const gateConfigListQuerySchema = z.object({
  includeSuperseded: z.enum(['true', 'false']).optional(),
});
export const gateConfigListResponseSchema = z.object({
  active: certificationGateConfigSchema,
  history: z.array(certificationGateConfigSchema),
});
export type GateConfigListResponse = z.infer<typeof gateConfigListResponseSchema>;

export const evalCaseTagSchema = z.enum(['golden', 'replay', 'false_alarm', 'regression']);
export const evalCaseSourceSchema = z.enum(['seed', 'override', 'incident']);
export const evalCaseSchema = z.object({
  id: uuidSchema,
  key: z.string().min(1).max(160),
  name: z.string().min(2).max(200),
  input: jsonValueSchema,
  expectedOutput: jsonValueSchema,
  expectedCitations: z.array(z.string().min(1).max(500)).max(100),
  tags: z.array(evalCaseTagSchema).min(1).max(4),
  source: evalCaseSourceSchema,
  active: z.boolean(),
  provenance: jsonObjectSchema,
  createdBy: z.string().min(1).max(200),
  updatedBy: z.string().min(1).max(200),
  deactivatedAt: isoDateTimeSchema.nullable(),
  deactivatedBy: z.string().max(200).nullable(),
  deactivationRationale: z.string().max(2000).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type EvalCase = z.infer<typeof evalCaseSchema>;

export const evalCaseListQuerySchema = z.object({
  tag: evalCaseTagSchema.optional(),
  source: evalCaseSourceSchema.optional(),
  active: z.enum(['true', 'false']).optional(),
  corpusVersion: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(500).optional(),
});
export const evalCaseListResponseSchema = z.object({
  items: z.array(evalCaseSchema),
  nextCursor: z.string().min(1).max(500).nullable(),
});
export type EvalCaseListResponse = z.infer<typeof evalCaseListResponseSchema>;
export const createEvalCaseRequestSchema = z.object({
  key: z.string().trim().min(1).max(160),
  name: z.string().trim().min(2).max(200),
  input: jsonValueSchema,
  expectedOutput: jsonValueSchema,
  expectedCitations: z.array(z.string().min(1).max(500)).max(100),
  tags: z.array(evalCaseTagSchema).min(1).max(4),
  source: z.enum(['override', 'incident']),
  provenance: jsonObjectSchema.default({}),
});
export type CreateEvalCaseRequest = z.infer<typeof createEvalCaseRequestSchema>;
export const deactivateEvalCaseRequestSchema = z.object({
  rationale: z.string().trim().min(10).max(2000),
});
export type DeactivateEvalCaseRequest = z.infer<typeof deactivateEvalCaseRequestSchema>;

export const evalCorpusVersionSchema = z.object({
  id: uuidSchema,
  version: z.number().int().positive(),
  contentHash: z.string().min(1).max(128),
  caseCount: z.number().int().nonnegative(),
  publishedBy: z.string().min(1).max(200),
  rationale: z.string().min(10).max(2000),
  publishedAt: isoDateTimeSchema,
});
export type EvalCorpusVersion = z.infer<typeof evalCorpusVersionSchema>;

export const publishEvalCorpusRequestSchema = z.object({
  baseVersion: z.number().int().positive().nullable(),
  caseIds: z.array(uuidSchema).min(1).max(10000),
  rationale: z.string().trim().min(10).max(2000),
});
export type PublishEvalCorpusRequest = z.infer<typeof publishEvalCorpusRequestSchema>;
export const publishEvalCorpusResponseSchema = evalCorpusVersionSchema;
export type PublishEvalCorpusResponse = z.infer<typeof publishEvalCorpusResponseSchema>;

export const certificationGateResultSchema = z.object({
  gate: certificationGateKeySchema,
  operator: certificationGateOperatorSchema,
  threshold: z.number().finite(),
  championScore: z.number().finite().nullable(),
  challengerScore: z.number().finite().nullable(),
  measuredValue: z.number().finite().nullable(),
  status: certificationGateResultStatusSchema,
  details: jsonObjectSchema,
});
export type CertificationGateResult = z.infer<typeof certificationGateResultSchema>;

export const evalCaseResultSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  caseId: uuidSchema,
  caseKey: z.string().min(1).max(160),
  caseName: z.string().min(1).max(200),
  tags: z.array(evalCaseTagSchema),
  input: jsonValueSchema,
  expectedOutput: jsonValueSchema,
  expectedCitations: z.array(z.string()),
  championOutput: jsonValueSchema.nullable(),
  challengerOutput: jsonValueSchema,
  championCitations: z.array(z.string()),
  challengerCitations: z.array(z.string()),
  championActions: z.array(z.string()),
  challengerActions: z.array(z.string()),
  scoreBreakdown: jsonObjectSchema,
  diff: jsonObjectSchema,
  passed: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type EvalCaseResult = z.infer<typeof evalCaseResultSchema>;

export const promotionBlockerCodeSchema = z.enum([
  'run_stale',
  'corpus_superseded',
  'gate_config_superseded',
  'champion_changed',
  'manifest_changed',
  'results_pruned',
  'run_not_passed',
  'run_kind_not_promotable',
  'already_decided',
  'agent_not_promotable',
]);
export const promotionEligibilitySchema = z.object({
  eligible: z.boolean(),
  freshUntil: isoDateTimeSchema.nullable(),
  blockers: z.array(
    z.object({
      code: promotionBlockerCodeSchema,
      message: z.string().min(1),
      recommendedAction: z.enum(['recertify']).nullable(),
    }),
  ),
});
export type PromotionEligibility = z.infer<typeof promotionEligibilitySchema>;

export const certificationRunSchema = z.object({
  id: uuidSchema,
  agentVersionId: uuidSchema,
  familyId: uuidSchema,
  championVersionId: uuidSchema.nullable(),
  kind: certificationRunKindSchema,
  originStatus: agentStatusSchema,
  state: certificationRunStateSchema,
  corpusVersionId: uuidSchema,
  corpusVersion: z.number().int().positive(),
  gateConfigId: uuidSchema,
  gateConfigVersion: z.number().int().positive(),
  subjectManifestHash: z.string().min(1).max(128),
  championManifestHash: z.string().min(1).max(128).nullable(),
  specRevision: z.number().int().positive(),
  generatorVersion: z.string().min(1).max(80),
  executorKind: executorKindSchema,
  executorVersion: z.string().min(1).max(80),
  evaluationMode: evaluationModeSchema,
  progress: z.number().int().min(0).max(100),
  message: z.string().max(500),
  caseCounts: z
    .object({
      total: z.number().int().nonnegative(),
      passed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
    })
    .refine((counts) => counts.passed + counts.failed === counts.total, {
      message: 'Passed and failed case counts must equal the total',
    }),
  verdict: certificationVerdictSchema.nullable(),
  error: generationErrorSchema.nullable(),
  requestedBy: z.string().min(1).max(200),
  startedBy: z.string().max(200).nullable(),
  requestedAt: isoDateTimeSchema,
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  promotionExpiresAt: isoDateTimeSchema.nullable(),
  isPromotionEvidence: z.boolean(),
  resultsAvailability: certificationResultsAvailabilitySchema,
  caseResultsPrunedAt: isoDateTimeSchema.nullable(),
});
export type CertificationRun = z.infer<typeof certificationRunSchema>;

export const createCertificationRunRequestSchema = z.object({}).strict();
export type CreateCertificationRunRequest = z.infer<typeof createCertificationRunRequestSchema>;
export const certificationRunAcceptedSchema = z.object({
  runId: uuidSchema,
  agentVersionId: uuidSchema,
  state: z.literal('queued'),
  corpusVersion: z.number().int().positive(),
  gateConfigVersion: z.number().int().positive(),
  executorKind: executorKindSchema,
  executorVersion: z.string().min(1),
  evaluationMode: evaluationModeSchema,
  statusUrl: z.string().min(1),
});
export type CertificationRunAccepted = z.infer<typeof certificationRunAcceptedSchema>;

export const certificationResultPageSchema = z.object({
  items: z.array(evalCaseResultSchema),
  nextCursor: z.string().min(1).max(500).nullable(),
});
export const certificationParticipantSnapshotSchema = z.object({
  agentVersionId: uuidSchema,
  name: z.string().min(2).max(120),
  versionNumber: z.number().int().positive(),
  lifecycleStatus: agentStatusSchema,
  manifestHash: z.string().min(1).max(128),
});
export const certificationRunDetailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(500).optional(),
});
export const certificationRunDetailSchema = z.object({
  run: certificationRunSchema,
  subject: certificationParticipantSnapshotSchema,
  champion: certificationParticipantSnapshotSchema.nullable(),
  gates: z.array(certificationGateResultSchema),
  results: certificationResultPageSchema,
  promotionEligibility: promotionEligibilitySchema,
});
export type CertificationRunDetail = z.infer<typeof certificationRunDetailSchema>;

export const certificationRunHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(500).optional(),
});
export const certificationRunHistoryResponseSchema = z.object({
  items: z.array(certificationRunSchema),
  nextCursor: z.string().min(1).max(500).nullable(),
});
export type CertificationRunHistoryResponse = z.infer<typeof certificationRunHistoryResponseSchema>;

export const promotionRequestSchema = z.object({
  runId: uuidSchema,
  rationale: z.string().trim().min(10).max(2000),
});
export type PromotionRequest = z.infer<typeof promotionRequestSchema>;
export const promotionResponseSchema = z.object({
  decisionId: uuidSchema,
  familyId: uuidSchema,
  agentVersionId: uuidSchema,
  previousChampionVersionId: uuidSchema.nullable(),
  status: z.literal('active'),
  decidedBy: z.string().min(1).max(200),
  decidedAt: isoDateTimeSchema,
});
export type PromotionResponse = z.infer<typeof promotionResponseSchema>;

export const retirementRequestSchema = z.object({
  rationale: z.string().trim().min(10).max(2000),
});
export type RetirementRequest = z.infer<typeof retirementRequestSchema>;
export const retirementResponseSchema = z.object({
  agentVersionId: uuidSchema,
  familyId: uuidSchema,
  status: z.literal('retired'),
  championCleared: z.boolean(),
  retiredAt: isoDateTimeSchema,
});
export type RetirementResponse = z.infer<typeof retirementResponseSchema>;
