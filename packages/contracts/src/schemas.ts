import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z
  .lazy(() =>
    z.union([
      z.string(),
      z.number().finite(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(jsonValueSchema),
    ]),
  )
  .openapi({
    type: 'object',
    additionalProperties: true,
    description: 'Arbitrary JSON value.',
  });

export const jsonObjectSchema = z.record(jsonValueSchema).openapi({
  type: 'object',
  additionalProperties: true,
});
export const uuidSchema = z.string().uuid();
export const isoDateTimeSchema = z.string().datetime();

export const agentStatusSchema = z.enum([
  'draft',
  'generating',
  'ready',
  'shadow',
  'certifying',
  'certified',
  'rejected',
  'active',
  'failed',
  'retired',
]);
export const specStatusSchema = z.enum(['draft', 'ready', 'generating', 'generated']);
export const generationJobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed']);
export const sourceRoleSchema = z.enum(['knowledge', 'signal', 'telemetry', 'evaluation']);
export const sourceProviderSchema = z.enum([
  'bigquery',
  'confluence',
  'jira',
  'email',
  'slack',
  'telemetry',
  'fixture',
]);
export const evaluationStatusSchema = z.enum(['not_run', 'passed', 'failed']);

export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type SpecStatus = z.infer<typeof specStatusSchema>;
export type GenerationJobStatus = z.infer<typeof generationJobStatusSchema>;

export const derivationModeSchema = z.enum(['new', 'configure', 'extend']);
export const certificationHealthSchema = z.enum(['not_certified', 'current', 'degraded']);
export const retirementReasonSchema = z.enum(['explicit', 'superseded_by_promotion']);
export const specSectionSchema = z.enum(['outcomes', 'knowledge', 'guardrails', 'outputs']);
export const sectionConfirmationKindSchema = z.enum(['guided', 'interpreted', 'inherited']);

export type DerivationMode = z.infer<typeof derivationModeSchema>;
export type CertificationHealth = z.infer<typeof certificationHealthSchema>;

export const sourceDescriptorSchema = z.object({
  id: z.string().min(1).max(100),
  role: sourceRoleSchema,
  provider: sourceProviderSchema,
  displayName: z.string().min(1).max(160),
  uri: z.string().min(1).max(500),
  authority: z.enum(['system_of_record', 'curated', 'derived', 'transient', 'untrusted']),
  owner: z.string().min(1).max(160),
  region: z.string().min(1).max(80).nullable(),
  lastRefreshed: isoDateTimeSchema.nullable(),
  citationRequired: z.boolean(),
  readOnly: z.boolean(),
  synthetic: z.boolean(),
  metadata: jsonObjectSchema,
});
export type SourceDescriptor = z.infer<typeof sourceDescriptorSchema>;

export const signalEventSchema = z.object({
  eventId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  eventType: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  occurredAt: isoDateTimeSchema,
  publishedAt: isoDateTimeSchema.nullable(),
  correlationId: z.string().nullable(),
  runId: z.string().nullable(),
  businessId: z.string().nullable(),
  environmentId: z.string().nullable(),
  source: z.string().min(1),
  payload: jsonValueSchema,
  ingestedAt: isoDateTimeSchema,
  deadLetter: z.boolean(),
  deadLetterReason: z.string().nullable(),
});

export const outcomesSectionSchema = z.object({
  name: z.string().trim().min(2).max(120),
  department: z.string().trim().min(2).max(120),
  purpose: z.string().trim().min(10).max(3000),
  audience: z.string().trim().min(2).max(500),
  desiredOutcomes: z.array(z.string().trim().min(2).max(500)).min(1).max(20),
  humanBaseline: z.string().trim().max(2000).nullable(),
  exclusions: z.array(z.string().trim().min(2).max(500)).max(20),
});
export type OutcomesSection = z.infer<typeof outcomesSectionSchema>;

export const knowledgeSelectionSchema = z.object({
  descriptorId: z.string().min(1).max(100),
  purpose: z.string().trim().min(2).max(500),
  requiredCitations: z.boolean(),
});
export const knowledgeSectionSchema = z.object({
  sources: z.array(knowledgeSelectionSchema).min(1).max(30),
});
export type KnowledgeSection = z.infer<typeof knowledgeSectionSchema>;

export const responseRequirementsSchema = z.object({
  citations: z.boolean(),
  confidence: z.boolean(),
  unresolvedConflicts: z.boolean(),
});
export const guardrailsSectionSchema = z.object({
  workflowStages: z.array(z.string().trim().min(2).max(300)).min(1).max(30),
  prohibitedActions: z.array(z.string().trim().min(2).max(500)).max(30),
  approvalRequirements: z.array(z.string().trim().min(2).max(500)).max(30),
  failClosedConditions: z.array(z.string().trim().min(2).max(500)).min(1).max(30),
  responseRequirements: responseRequirementsSchema,
});
export type GuardrailsSection = z.infer<typeof guardrailsSectionSchema>;

export const successMetricSchema = z.object({
  name: z.string().trim().min(2).max(120),
  operator: z.enum(['gte', 'lte', 'eq']),
  threshold: z.number().finite(),
  unit: z.string().trim().min(1).max(40).nullable(),
});
export const acceptanceTestInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  input: jsonValueSchema,
  expectedResult: jsonValueSchema,
});
export const outputsSectionSchema = z.object({
  outputType: z.enum([
    'investigation_report',
    'decision_brief',
    'dashboard_update',
    'ticket',
    'email_draft',
    'api_response',
    'structured_record',
  ]),
  outputSchema: jsonObjectSchema,
  successMetrics: z.array(successMetricSchema).min(1).max(30),
  acceptanceTests: z.array(acceptanceTestInputSchema).min(1).max(50),
});
export type OutputsSection = z.infer<typeof outputsSectionSchema>;

export const unconfirmedSpecPrefillSchema = z.object({
  sourceAgentId: uuidSchema,
  sourceSpecId: uuidSchema,
  sourceSpecRevision: z.number().int().positive(),
  knowledge: knowledgeSectionSchema,
  guardrails: guardrailsSectionSchema,
  outputs: outputsSectionSchema,
});
export type UnconfirmedSpecPrefill = z.infer<typeof unconfirmedSpecPrefillSchema>;

export const completionSchema = z.object({
  outcomes: z.boolean(),
  knowledge: z.boolean(),
  guardrails: z.boolean(),
  outputs: z.boolean(),
});

export const createSpecRequestSchema = z.object({
  baseAgentId: uuidSchema.nullable(),
  derivationMode: derivationModeSchema.default('new'),
  interpretationId: uuidSchema.nullable().default(null),
  outcomes: outcomesSectionSchema,
});
export type CreateSpecRequest = z.infer<typeof createSpecRequestSchema>;

const interpretationResolutionBaseSchema = z.object({
  unresolvedId: z.string().min(1).max(120),
});
export const interpretationResolutionSchema = z.discriminatedUnion('action', [
  interpretationResolutionBaseSchema.extend({
    action: z.literal('map_source'),
    descriptorId: z.string().trim().min(1).max(100),
  }),
  interpretationResolutionBaseSchema.extend({
    action: z.literal('remove'),
  }),
  interpretationResolutionBaseSchema.extend({
    action: z.literal('acknowledge'),
    rationale: z.string().trim().min(3).max(1000),
  }),
]);
export type InterpretationResolution = z.infer<typeof interpretationResolutionSchema>;
export const interpretationConfirmationSchema = z.object({
  interpretationId: uuidSchema,
  resolutions: z.array(interpretationResolutionSchema).max(50),
});
export type InterpretationConfirmation = z.infer<typeof interpretationConfirmationSchema>;
const sectionUpdateRequest = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value,
    interpretationConfirmation: interpretationConfirmationSchema.optional(),
  });
export const updateOutcomesRequestSchema = sectionUpdateRequest(outcomesSectionSchema);
export const updateKnowledgeRequestSchema = sectionUpdateRequest(knowledgeSectionSchema);
export const updateGuardrailsRequestSchema = sectionUpdateRequest(guardrailsSectionSchema);
export const updateOutputsRequestSchema = sectionUpdateRequest(outputsSectionSchema);

export type UpdateOutcomesRequest = z.infer<typeof updateOutcomesRequestSchema>;
export type UpdateKnowledgeRequest = z.infer<typeof updateKnowledgeRequestSchema>;
export type UpdateGuardrailsRequest = z.infer<typeof updateGuardrailsRequestSchema>;
export type UpdateOutputsRequest = z.infer<typeof updateOutputsRequestSchema>;

export const agentSpecSchema = z.object({
  id: uuidSchema,
  agentId: uuidSchema,
  baseAgentId: uuidSchema.nullable(),
  derivationMode: derivationModeSchema.default('new'),
  interpretationId: uuidSchema.nullable().default(null),
  unconfirmedPrefill: unconfirmedSpecPrefillSchema.nullable().default(null),
  status: specStatusSchema,
  revision: z.number().int().positive(),
  outcomes: outcomesSectionSchema.nullable(),
  knowledge: knowledgeSectionSchema.nullable(),
  guardrails: guardrailsSectionSchema.nullable(),
  outputs: outputsSectionSchema.nullable(),
  completion: completionSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AgentSpec = z.infer<typeof agentSpecSchema>;

export const specSnapshotSchema = agentSpecSchema
  .extend({
    status: z.literal('ready'),
    outcomes: outcomesSectionSchema,
    knowledge: knowledgeSectionSchema,
    guardrails: guardrailsSectionSchema,
    outputs: outputsSectionSchema,
  })
  .omit({ completion: true, unconfirmedPrefill: true, createdAt: true, updatedAt: true });
export type SpecSnapshot = z.infer<typeof specSnapshotSchema>;

export const manifestEvaluationSchema = z.object({
  name: z.string().min(1),
  input: jsonValueSchema,
  expectedResult: jsonValueSchema,
});
export const agentManifestSchema = z.object({
  agentId: uuidSchema,
  name: z.string().min(2),
  department: z.string().min(2),
  purpose: z.string().min(10),
  version: z.string().min(1),
  specRevision: z.number().int().positive(),
  generatorVersion: z.string().min(1),
  workflow: z.array(z.string().min(2)).min(1),
  knowledgeSourceIds: z.array(z.string().min(1)),
  guardrails: guardrailsSectionSchema,
  outputType: outputsSectionSchema.shape.outputType,
  outputSchema: jsonObjectSchema,
  evaluations: z.array(manifestEvaluationSchema),
  generatedAt: isoDateTimeSchema,
});
export type AgentManifest = z.infer<typeof agentManifestSchema>;

export const agentSchema = z.object({
  id: uuidSchema,
  familyId: uuidSchema,
  slug: z.string().min(1),
  versionNumber: z.number().int().positive(),
  predecessorAgentId: uuidSchema.nullable(),
  derivationMode: derivationModeSchema,
  name: z.string().min(2),
  department: z.string().min(2),
  purpose: z.string().min(10),
  owner: z.string().min(2),
  status: agentStatusSchema,
  capabilities: z.array(z.string()),
  manifest: agentManifestSchema.nullable(),
  manifestHash: z.string().min(1).nullable(),
  certificationHealth: certificationHealthSchema,
  degradedAt: isoDateTimeSchema.nullable(),
  degradationReason: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Agent = z.infer<typeof agentSchema>;

export const similarityRequestSchema = z.object({
  query: z.string().trim().min(2).max(2000),
  candidateIds: z.array(uuidSchema).max(100).optional(),
});
export const similarityResponseSchema = z.object({
  query: z.string(),
  matches: z.array(
    z.object({
      agentId: uuidSchema,
      score: z.number().int().min(0).max(100),
      reuseRecommended: z.boolean(),
      reasons: z.array(z.string()),
      gaps: z.array(z.string()),
    }),
  ),
});

export const sourceListResponseSchema = z.object({
  role: sourceRoleSchema.nullable(),
  items: z.array(sourceDescriptorSchema),
});

export const generationErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: jsonValueSchema.optional(),
});
export const generationJobSchema = z.object({
  id: uuidSchema,
  agentId: uuidSchema,
  specId: uuidSchema,
  state: generationJobStatusSchema,
  progress: z.number().int().min(0).max(100),
  message: z.string(),
  specRevision: z.number().int().positive(),
  generatorVersion: z.string().min(1),
  manifest: agentManifestSchema.nullable(),
  error: generationErrorSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type GenerationJob = z.infer<typeof generationJobSchema>;

export const generationAcceptedSchema = z.object({
  jobId: uuidSchema,
  agentId: uuidSchema,
  state: z.literal('queued'),
  statusUrl: z.string().min(1),
});

export const evaluationTestSchema = z.object({
  id: uuidSchema,
  agentId: uuidSchema,
  name: z.string().min(1),
  testCase: jsonValueSchema,
  expectedResult: jsonValueSchema,
  actualResult: jsonValueSchema.nullable(),
  status: evaluationStatusSchema,
  generatorVersion: z.string().min(1),
});
export const evaluationResponseSchema = z.object({
  agentId: uuidSchema,
  status: z.enum(['not_started', 'complete']),
  summary: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    score: z.number().min(0).max(1),
  }),
  tests: z.array(evaluationTestSchema),
});

export const shadowDeployResponseSchema = z.object({
  deploymentId: uuidSchema,
  agentId: uuidSchema,
  status: z.literal('shadow'),
  startedAt: isoDateTimeSchema,
});
export const recoverAgentResponseSchema = z.object({
  agentId: uuidSchema,
  status: z.literal('draft'),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: jsonValueSchema.optional(),
    requestId: z.string().min(1),
  }),
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('connected'),
  timestamp: isoDateTimeSchema,
  commit: z
    .string()
    .regex(/^[a-f0-9]{7,64}$/i)
    .nullable(),
  buildTimestamp: isoDateTimeSchema.nullable(),
});

export const generatorInputSchema = z.object({
  agentId: uuidSchema,
  spec: specSnapshotSchema,
});
export type GeneratorInput = z.infer<typeof generatorInputSchema>;

export const generatorProgressSchema = z.object({
  type: z.literal('progress'),
  progress: z.number().int().min(0).max(100),
  message: z.string().min(1),
});
export type GeneratorProgress = z.infer<typeof generatorProgressSchema>;

export function parseOrThrow<TOutput>(
  schema: z.ZodType<TOutput>,
  value: unknown,
  label = 'value',
): TOutput {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`${label} failed contract validation: ${result.error.message}`);
  }
  return result.data;
}
