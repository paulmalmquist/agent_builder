import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './schemas.js';

export const deterministicEvaluationAssertionSchema = z.enum([
  'output_schema_valid',
  'schedule_risk_present',
  'citations_resolve_to_supplied_calendar_items',
  'no_attempted_actions',
]);

export const releaseEvaluationExecutorKindSchema = z.enum([
  'deterministic_contract',
  'provider_semantic',
]);
export const releaseEvaluationModeSchema = z.enum(['contract_validation', 'semantic_execution']);

export const releaseEvaluationHistoricalGateConfigSchema = z
  .object({
    maxMeanCostUsd: z.number().nonnegative(),
    maxP95LatencyMs: z.number().int().positive(),
    minMeanOutcomeQuality: z.number().min(0).max(1),
    minSampleSize: z.number().int().positive().max(10_000),
    historyWindow: z.number().int().positive().max(10_000),
  })
  .strict();

export const evaluationSuiteSpecSchema = z.object({
  subject: z.string().trim().min(3).max(240),
  executorKind: z.literal('deterministic_contract'),
  evaluationMode: z.literal('contract_validation'),
  corpusVersion: z.number().int().positive(),
  cases: z
    .array(
      z.object({
        key: z
          .string()
          .trim()
          .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
          .max(160),
        fixture: z.literal('synthetic'),
        assertions: z.array(deterministicEvaluationAssertionSchema).min(1).max(20),
      }),
    )
    .min(1)
    .max(200),
  gates: z.object({
    schemaConformance: z.number().min(0).max(1),
    citationCoverage: z.number().min(0).max(1),
    unauthorizedActions: z.number().int().nonnegative(),
    historical: releaseEvaluationHistoricalGateConfigSchema.optional(),
  }),
});

export const releaseEvaluationVerdictSchema = z.enum(['passed', 'failed', 'error']);
export const releaseEvaluationResultSchema = z.object({
  caseKey: z.string(),
  assertions: z.array(
    z.object({
      key: deterministicEvaluationAssertionSchema,
      passed: z.boolean(),
      detail: z.string().max(500),
    }),
  ),
  passed: z.boolean(),
});

export const createReleaseEvaluationRequestSchema = z.object({
  releaseId: uuidSchema,
  suiteVersionId: uuidSchema,
  requestedMode: releaseEvaluationModeSchema.default('contract_validation'),
});

export const releaseEvaluationGateKeySchema = z.enum([
  'dependency_closure',
  'schema_conformance',
  'citation_coverage',
  'unauthorized_actions',
  'mean_cost_usd',
  'p95_latency_ms',
  'mean_outcome_quality',
]);
export const releaseEvaluationGateResultSchema = z.object({
  key: releaseEvaluationGateKeySchema,
  category: z.enum(['contract', 'cost', 'latency', 'outcome_history']),
  operator: z.enum(['gte', 'lte', 'eq']),
  threshold: z.number().finite(),
  measuredValue: z.number().finite().nullable(),
  status: z.enum(['passed', 'failed', 'not_applicable']),
  sampleSize: z.number().int().nonnegative(),
  evidenceSource: z.enum(['manifest_declaration', 'execution_history']),
  detail: z.string().trim().min(1).max(500),
});

export const releaseEvaluationEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  historySnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
  historyRunIds: z.array(uuidSchema).max(10_000),
  suiteCaseCount: z.number().int().nonnegative(),
  assertionCount: z.number().int().nonnegative(),
  subjectPresent: z.boolean(),
  subjectDigest: z.string(),
  dependencyClosureComplete: z.boolean().optional(),
  certifiedResourceIds: z.array(uuidSchema).max(1_000).optional(),
  gateResults: z.array(releaseEvaluationGateResultSchema).min(3).max(7),
});

export const releaseEvaluationGateScoresSchema = z.object({
  schemaConformance: z.number().min(0).max(1),
  citationCoverage: z.number().min(0).max(1),
  unauthorizedActions: z.number().int().nonnegative(),
});

export const releaseEvaluationSchema = z
  .object({
    id: uuidSchema,
    releaseId: uuidSchema,
    releaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
    suiteVersionId: uuidSchema,
    suiteDigest: z.string().regex(/^[a-f0-9]{64}$/),
    executorKind: z.literal('deterministic_contract'),
    executorVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    evaluationMode: z.literal('contract_validation'),
    historySnapshotDigest: z.string().regex(/^[a-f0-9]{64}$/),
    corpusVersion: z.number().int().positive(),
    verdict: releaseEvaluationVerdictSchema,
    results: z.array(releaseEvaluationResultSchema),
    gateScores: releaseEvaluationGateScoresSchema,
    gateResults: z.array(releaseEvaluationGateResultSchema).min(3).max(7),
    disclaimer: z.literal(
      'Deterministic contract evidence validates declared fixtures and release composition; it does not measure semantic model quality.',
    ),
    evidence: releaseEvaluationEvidenceSchema,
    requestedBy: z.string(),
    createdAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
  })
  .superRefine((evaluation, context) => {
    if (evaluation.historySnapshotDigest !== evaluation.evidence.historySnapshotDigest) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidence', 'historySnapshotDigest'],
        message: 'Evidence history digest must match the evaluation history snapshot digest',
      });
    }
  });

export const productionChannelKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/)
  .min(1)
  .max(160);

export const productionChannelSchema = z.object({
  key: productionChannelKeySchema,
  projectId: z.string().nullable(),
  currentReleaseId: uuidSchema.nullable(),
  currentReleaseDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  priorReleaseId: uuidSchema.nullable(),
  promotedBy: z.string().nullable(),
  promotedAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});

const rationaleSchema = z.string().trim().min(10).max(2000);

export const promoteReleaseRequestSchema = z.object({
  releaseId: uuidSchema,
  evaluationId: uuidSchema,
  rationale: rationaleSchema,
});

export const rollbackReleaseRequestSchema = z.object({
  targetReleaseId: uuidSchema,
  rationale: rationaleSchema,
});

export const releasePromotionDecisionSchema = z.object({
  id: uuidSchema,
  channelKey: productionChannelKeySchema,
  action: z.enum(['promoted', 'rolled_back']),
  releaseId: uuidSchema,
  previousReleaseId: uuidSchema.nullable(),
  evaluationId: uuidSchema,
  rationale: z.string(),
  decidedBy: z.string(),
  decidedAt: isoDateTimeSchema,
});

export const productionChannelMutationResponseSchema = z.object({
  channel: productionChannelSchema,
  decision: releasePromotionDecisionSchema,
});

export type ReleaseEvaluation = z.infer<typeof releaseEvaluationSchema>;
export type ReleaseEvaluationExecutorKind = z.infer<typeof releaseEvaluationExecutorKindSchema>;
export type ReleaseEvaluationGateResult = z.infer<typeof releaseEvaluationGateResultSchema>;
export type ReleaseEvaluationMode = z.infer<typeof releaseEvaluationModeSchema>;
export type ProductionChannel = z.infer<typeof productionChannelSchema>;
