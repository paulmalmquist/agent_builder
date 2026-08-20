import { z } from 'zod';
import {
  exactPluginReferenceSchema,
  pluginAuthorityScopeSchema,
  pluginToolRequirementSchema,
  requestedPluginAuthorityScopeSchema,
  runPluginRequirementSchema,
} from './plugin-schemas.js';
import { capabilityProfileSchema, catalogVisibilitySchema } from './reuse-schemas.js';
import { plannedPluginCallsRequestSchema } from './plugin-execution-plan.js';
import { isoDateTimeSchema, jsonObjectSchema, jsonValueSchema, uuidSchema } from './schemas.js';

export const resourceKindSchema = z.enum([
  'CorePolicy',
  'ContextPolicy',
  'Skill',
  'Project',
  'Roadmap',
  'Automation',
  'Reference',
  'BusinessDomain',
  'Protocol',
  'KnowledgeSource',
  'EvaluationSuite',
  'MetricDefinition',
  'ImprovementCandidate',
  'Agent',
  'Plugin',
  'PluginPack',
]);
export const resourceLifecycleSchema = z.enum([
  'experimental',
  'candidate',
  'evaluating',
  'evaluated',
  'certified',
  'production',
  'deprecated',
]);

export const resourceDependencySchema = z
  .object({
    familyId: uuidSchema,
    version: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
      .max(80),
  })
  .strict();

const manifestMetadataSchema = z
  .object({
    id: uuidSchema,
    slug: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(160),
    version: z
      .string()
      .trim()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
      .max(80),
    name: z.string().trim().min(2).max(160).optional(),
    owner: z.string().trim().min(2).max(200),
    purpose: z.string().trim().min(10).max(3000),
    lifecycle: resourceLifecycleSchema,
    provenance: z.union([z.string().trim().min(1).max(500), jsonObjectSchema]),
    catalogVisibility: catalogVisibilitySchema.optional(),
    capabilityProfile: capabilityProfileSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.catalogVisibility === undefined) !== (value.capabilityProfile === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['catalogVisibility'],
        message: 'catalogVisibility and capabilityProfile must be declared together',
      });
    }
  });

export const resourceManifestSchema = z
  .object({
    apiVersion: z.literal('paul-os/v1'),
    kind: resourceKindSchema,
    metadata: manifestMetadataSchema,
    dependencies: z.array(resourceDependencySchema).max(100).default([]),
    spec: jsonObjectSchema,
  })
  .strict();

export const jsonSchemaDocumentSchema = jsonObjectSchema.refine(
  (value) => typeof value['type'] === 'string' || typeof value['$ref'] === 'string',
  'A JSON Schema document must declare type or $ref',
);

export const skillSpecSchema = z
  .object({
    inputSchema: jsonSchemaDocumentSchema,
    outputSchema: jsonSchemaDocumentSchema,
    tools: z.array(pluginToolRequirementSchema).max(50),
    permissions: z.array(z.string().trim().min(1).max(160)).max(50),
    contextRequirements: z.array(z.string().trim().min(1).max(300)).max(50),
    successCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  })
  .strict();

const resourceReferenceSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*@\d+\.\d+\.\d+$/);
const boundedStringListSchema = z.array(z.string().trim().min(1).max(300)).max(100);

export const corePolicySpecSchema = z
  .object({
    providerPolicy: z.enum(['direct_allowed', 'gateway_only']),
    productionRequiresReleaseDigest: z.boolean(),
    firstProductionRunRequiresApproval: z.boolean(),
    denyRulesAreMonotonic: z.boolean(),
    stageDurableMemoryWrites: z.boolean(),
    logPolicy: z.object({ allow: boundedStringListSchema, deny: boundedStringListSchema }).strict(),
  })
  .strict();
export const contextPolicySpecSchema = z
  .object({
    precedence: z
      .array(z.enum(['core', 'private_profile', 'business_domain', 'project', 'agent', 'request']))
      .min(1),
    maxInputTokens: z.number().int().positive(),
    lazyLoadResources: z.boolean(),
    mandatoryRulesCannotBeWeakened: z.boolean(),
    provenanceRequired: z.boolean(),
    durableMemoryWrites: z.enum(['staged', 'disabled']),
    onMissingRequiredContext: z.enum(['fail_closed']),
  })
  .strict();
export const projectSpecSchema = z
  .object({
    businessDomain: resourceReferenceSchema,
    resourcePins: z.record(z.string(), resourceReferenceSchema),
    overlays: jsonObjectSchema,
    mayWeakenMandatoryRules: z.literal(false),
  })
  .strict();
export const automationSpecSchema = z
  .object({
    schedule: z
      .object({
        cron: z.string().trim().min(5).max(120),
        timezone: z.string().trim().min(1).max(100),
        catchUp: z.enum(['latest_only', 'all', 'none']),
      })
      .strict(),
    releaseSelector: resourceReferenceSchema,
    project: resourceReferenceSchema,
    authorityClass: z.string().trim().min(1).max(160),
    deduplicationWindowMinutes: z.number().int().nonnegative(),
    retry: z
      .object({
        maximumAttempts: z.number().int().min(1).max(20),
        backoff: z.enum(['fixed', 'exponential']),
      })
      .strict(),
    costBudgetUsd: z.number().nonnegative(),
    onMissingAuthority: z.enum(['request_approval', 'skip']),
  })
  .strict();
export const referenceSpecSchema = z
  .object({
    artifact: z.string().trim().min(1).max(500),
    mediaType: z.string().trim().min(1).max(160),
    immutableAfterCandidate: z.boolean(),
    citationLabel: z.string().trim().min(1).max(160),
  })
  .strict();
export const businessDomainSpecSchema = z
  .object({
    mandatoryProtocols: z.array(resourceReferenceSchema).max(100),
    defaultContextPolicy: resourceReferenceSchema,
    vocabulary: z.record(z.string(), z.string().trim().min(1).max(1000)),
    defaults: jsonObjectSchema,
  })
  .strict();
export const protocolSpecSchema = z
  .object({
    mandatory: z.boolean(),
    precedence: z.enum(['deny_overrides_allow']),
    enforcementPoints: boundedStringListSchema,
    rules: boundedStringListSchema,
  })
  .strict();
export const legacyKnowledgeSourceSpecSchema = z
  .object({
    provider: z.string().trim().min(1).max(100),
    capabilities: boundedStringListSchema,
    authority: z.string().trim().min(1).max(100),
    access: z.enum(['read_only']),
    citationRequired: z.boolean(),
    region: z.string().trim().min(1).max(100),
    dataClassification: z.string().trim().min(1).max(100),
    credentialRef: z.string().trim().min(1).max(300).nullable(),
    clientMaySelectIdentifiers: z.literal(false),
  })
  .strict();
export const pluginKnowledgeSourceSpecSchema = z
  .object({
    plugin: exactPluginReferenceSchema,
    capability: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
      .max(160),
    subset: z
      .object({
        descriptor: z
          .string()
          .trim()
          .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
          .max(160),
        constraints: jsonObjectSchema,
      })
      .strict(),
    access: z.literal('read_only'),
    citationRequired: z.boolean(),
    region: z.string().trim().min(1).max(100),
    dataClassification: z.string().trim().min(1).max(100),
    clientMaySelectIdentifiers: z.literal(false),
  })
  .strict();
export const knowledgeSourceSpecSchema = z.union([
  pluginKnowledgeSourceSpecSchema,
  legacyKnowledgeSourceSpecSchema.describe(
    'Deprecated provider-shaped KnowledgeSource. New definitions must pin an exact Plugin tool.',
  ),
]);
export const platformEvaluationSuiteSpecSchema = z
  .object({
    subject: resourceReferenceSchema,
    executorKind: z.string().trim().min(1).max(100),
    evaluationMode: z.string().trim().min(1).max(100),
    corpusVersion: z.number().int().positive(),
    cases: z
      .array(
        z
          .object({
            key: z.string().trim().min(1).max(160),
            fixture: z.string().trim().min(1).max(160),
            assertions: boundedStringListSchema,
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    gates: z
      .object({
        schemaConformance: z.number().min(0).max(1),
        citationCoverage: z.number().min(0).max(1),
        unauthorizedActions: z.number().int().nonnegative(),
        historical: z
          .object({
            maxMeanCostUsd: z.number().nonnegative(),
            maxP95LatencyMs: z.number().int().positive(),
            minMeanOutcomeQuality: z.number().min(0).max(1),
            minSampleSize: z.number().int().positive().max(10_000),
            historyWindow: z.number().int().positive().max(10_000),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();
export const metricDefinitionSpecSchema = z
  .object({
    dimensions: boundedStringListSchema,
    measures: boundedStringListSchema,
    payloadLoggingAllowed: z.literal(false),
  })
  .strict();
export const improvementCandidateSpecSchema = z
  .object({
    signalType: z.string().trim().min(1).max(160),
    observation: z.string().trim().min(1).max(3000),
    proposedTarget: z.string().trim().min(1).max(160),
    proposedChange: z.string().trim().min(1).max(3000),
    evidenceRefs: boundedStringListSchema,
    humanCurationRequired: z.literal(true),
    automaticPatchApplication: z.literal(false),
    automaticPromotion: z.literal(false),
  })
  .strict();
export const agentResourceSpecSchema = z
  .object({
    objective: z.string().trim().min(10).max(3000),
    skills: z.array(resourceReferenceSchema).min(1).max(100),
    protocols: z.array(resourceReferenceSchema).max(100),
    contextPolicy: resourceReferenceSchema,
    knowledgeSources: z.array(resourceReferenceSchema).max(100),
    tools: z.array(pluginToolRequirementSchema).max(100),
    triggers: z
      .array(
        z
          .object({ kind: z.string().trim().min(1).max(80), automation: resourceReferenceSchema })
          .strict(),
      )
      .max(100),
    executionLoop: z
      .object({
        maximumSteps: z.number().int().min(1).max(1000),
        onUnresolved: z.enum(['return_to_user', 'fail_closed']),
        outputContract: resourceReferenceSchema,
      })
      .strict(),
    memoryPolicy: z
      .object({
        reads: z.enum(['accepted_only', 'none']),
        writes: z.enum(['staged_for_human_acceptance', 'disabled']),
      })
      .strict(),
    production: z
      .object({
        requiresImmutableRelease: z.literal(true),
        authorityClass: z.string().trim().min(1).max(160),
      })
      .strict(),
    legacyCompatibility: z
      .object({
        agentId: uuidSchema,
        department: z.string().trim().min(1).max(160),
        specificationRevision: z.number().int().positive().nullable(),
        sectionDigests: z
          .object({
            outcomes: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
            knowledge: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
            guardrails: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
            outputs: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .nullable(),
          })
          .strict(),
        capabilitiesDigest: z.string().regex(/^[a-f0-9]{64}$/),
        manifestDigest: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const compiledResourceSchema = z.object({
  manifest: resourceManifestSchema,
  canonicalDefinition: z.string().min(2),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const repositoryImportRequestSchema = z
  .object({
    manifestYaml: z.string().min(1).max(1_000_000),
    sourcePath: z.string().trim().min(1).max(500).nullable().default(null),
    improvementCandidateId: uuidSchema
      .nullable()
      .default(null)
      .describe(
        'Optional incubating candidate whose proposed target exactly matches Kind:slug@version; the resulting lineage is set once and audited',
      ),
  })
  .strict();

export const resourceVersionSchema = z.object({
  id: uuidSchema,
  familyId: uuidSchema,
  kind: resourceKindSchema,
  slug: z.string(),
  name: z.string(),
  version: z.string(),
  owner: z.string(),
  purpose: z.string(),
  lifecycle: resourceLifecycleSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCommit: z.string(),
  provenance: jsonValueSchema,
  dependencyPins: z.array(resourceDependencySchema),
  definition: resourceManifestSchema,
  revision: z.number().int().positive(),
  frozenAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const repositoryImportSchema = z.object({
  id: uuidSchema,
  resourceVersionId: uuidSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  sourceCommit: z.string(),
  sourcePath: z.string().nullable(),
  improvementCandidateId: uuidSchema
    .nullable()
    .describe('Immutable reviewed improvement-candidate lineage, when supplied'),
  importedBy: z.string(),
  importedAt: isoDateTimeSchema,
});

export const repositoryImportResponseSchema = z.object({
  import: repositoryImportSchema,
  resource: resourceVersionSchema,
  idempotent: z.boolean(),
});

export const resourceListQuerySchema = z.object({
  kind: resourceKindSchema.optional(),
  query: z.string().trim().max(200).optional(),
  lifecycle: resourceLifecycleSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const resourceLifecycleCountsSchema = z
  .object({
    experimental: z.number().int().nonnegative(),
    candidate: z.number().int().nonnegative(),
    evaluating: z.number().int().nonnegative(),
    evaluated: z.number().int().nonnegative(),
    certified: z.number().int().nonnegative(),
    production: z.number().int().nonnegative(),
    deprecated: z.number().int().nonnegative(),
  })
  .strict();
export const resourceListResponseSchema = z
  .object({
    items: z.array(resourceVersionSchema),
    total: z
      .number()
      .int()
      .nonnegative()
      .describe('All resource versions in principal scope before item filters and the item cap'),
    countsByLifecycle: resourceLifecycleCountsSchema.describe(
      'Lifecycle totals for all resource versions in principal scope before item filters',
    ),
  })
  .strict()
  .refine(
    (value) =>
      value.total === Object.values(value.countsByLifecycle).reduce((sum, count) => sum + count, 0),
    { path: ['total'], message: 'Resource total must equal the lifecycle counts' },
  );

export const createReleaseRequestSchema = z.object({
  resourceVersionIds: z.array(uuidSchema).min(1).max(100),
  projectId: z.string().trim().min(1).max(160).nullable().default(null),
});
export const releaseResourceSchema = z.object({
  resourceVersionId: uuidSchema,
  kind: resourceKindSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  ordinal: z.number().int().nonnegative(),
});
export const releaseBundleSchema = z.object({
  id: uuidSchema,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: z.string().nullable(),
  resources: z.array(releaseResourceSchema),
  createdBy: z.string(),
  createdAt: isoDateTimeSchema,
});

export const authorityGrantStateSchema = z.enum(['active', 'revoked', 'exhausted', 'expired']);
export const contextClassificationSchema = z.enum(['public', 'internal', 'private', 'restricted']);
export const contextProvenanceSummarySchema = z.array(
  z.object({
    source: z.enum(['core', 'private_profile', 'business_domain', 'project', 'agent', 'request']),
    classification: contextClassificationSchema,
    tokenContribution: z.number().int().nonnegative(),
  }),
);
const authorityGrantRequestObjectSchema = z.object({
  releaseId: uuidSchema,
  entryResourceVersionId: uuidSchema,
  contextDigest: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: z.string().trim().min(1).max(160).nullable().default(null),
  inputConstraints: jsonObjectSchema.default({}),
  toolScopes: z.array(z.string().trim().min(1).max(160)).max(100).default([]),
  pluginScopes: z.array(requestedPluginAuthorityScopeSchema).max(100).default([]),
  validUntil: isoDateTimeSchema,
  maxRuns: z.number().int().min(1).max(1_000_000),
  maxEstimatedCostPerRunUsd: z.number().nonnegative().max(100_000),
  totalCostBudgetUsd: z.number().nonnegative().max(1_000_000),
  rationale: z.string().trim().min(10).max(2000),
});
const validGrantBudget = (value: {
  maxEstimatedCostPerRunUsd: number;
  totalCostBudgetUsd: number;
}) => value.totalCostBudgetUsd >= value.maxEstimatedCostPerRunUsd;
export const createAuthorityGrantRequestSchema = authorityGrantRequestObjectSchema.refine(
  validGrantBudget,
  'Total cost budget must cover at least one maximum-cost run',
);
const governedEntrySubjectSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    kind: z.string().trim().min(1).max(80),
    version: z.string().trim().min(1).max(80),
  })
  .strict();
export const authorityGrantSchema = z.object({
  id: uuidSchema,
  releaseId: uuidSchema,
  entryResourceVersionId: uuidSchema,
  entrySubject: governedEntrySubjectSchema.nullable().default(null),
  releaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
  contextDigest: z.string().regex(/^[a-f0-9]{64}$/),
  projectId: z.string().nullable(),
  inputConstraints: jsonObjectSchema,
  toolScopes: z.array(z.string()),
  pluginScopes: z.array(pluginAuthorityScopeSchema),
  validFrom: isoDateTimeSchema,
  validUntil: isoDateTimeSchema,
  maxRuns: z.number().int().positive(),
  usedRuns: z.number().int().nonnegative(),
  maxEstimatedCostPerRunUsd: z.number().nonnegative(),
  totalCostBudgetUsd: z.number().nonnegative(),
  spentCostUsd: z.number().nonnegative(),
  reservedCostUsd: z.number().nonnegative(),
  state: authorityGrantStateSchema,
  actorId: z.string(),
  rationale: z.string(),
  revokedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export const authorityGrantListQuerySchema = z.object({
  state: authorityGrantStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const authorityGrantListResponseSchema = z
  .object({
    items: z.array(authorityGrantSchema),
    total: z
      .number()
      .int()
      .nonnegative()
      .describe('All authority grants in principal scope before the state filter and item cap'),
    activeTotal: z
      .number()
      .int()
      .nonnegative()
      .describe('Active authority grants in the full principal scope'),
  })
  .strict()
  .refine((value) => value.activeTotal <= value.total, {
    path: ['activeTotal'],
    message: 'Active authority grants cannot exceed the total',
  });

export const executionRunStateSchema = z.enum([
  'awaiting_approval',
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'paused_budget',
  'paused_plugin',
]);
export const modelProviderKindSchema = z.enum(['deterministic', 'anthropic', 'gateway']);
export const createExecutionRunRequestSchema = z.object({
  releaseId: uuidSchema,
  entryResourceVersionId: uuidSchema,
  authorityGrantId: uuidSchema.nullable().default(null),
  input: jsonObjectSchema,
  pluginCalls: plannedPluginCallsRequestSchema.default([]),
  maxInputTokens: z.number().int().min(1).max(1_000_000).default(8_000),
  maxOutputTokens: z.number().int().min(1).max(1_000_000).default(2_000),
  maxEstimatedCostUsd: z.number().nonnegative().max(100_000),
  maxAttempts: z.number().int().min(1).max(100).default(3),
  retryBackoff: z.enum(['fixed', 'exponential']).default('exponential'),
  idempotencyKey: z.string().trim().min(8).max(200),
  developmentDraft: z.boolean().default(false),
});
export const approveExecutionRunRequestSchema = authorityGrantRequestObjectSchema
  .omit({ releaseId: true, contextDigest: true })
  .refine(validGrantBudget, 'Total cost budget must cover at least one maximum-cost run');
export const executionRunEntrySubjectSchema = governedEntrySubjectSchema;
const currentExecutionRunSchema = z.object({
  id: uuidSchema,
  releaseId: uuidSchema,
  entryResourceVersionId: uuidSchema,
  entrySubject: executionRunEntrySubjectSchema.nullable(),
  legacyEntrypointUnresolved: z.literal(false),
  releaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
  contextDigest: z.string().regex(/^[a-f0-9]{64}$/),
  contextProvenance: contextProvenanceSummarySchema,
  contextClassification: contextClassificationSchema,
  contextEstimatedTokens: z.number().int().nonnegative(),
  projectId: z.string().nullable(),
  requiredToolScopes: z.array(z.string()),
  requiredPluginScopes: z.array(runPluginRequirementSchema),
  requiresPluginApproval: z.boolean().default(false),
  authorityGrantId: uuidSchema.nullable(),
  digestSnapshotId: uuidSchema.nullable().default(null),
  state: executionRunStateSchema,
  input: jsonObjectSchema,
  providerKind: modelProviderKindSchema,
  developmentDraft: z.boolean(),
  providerVersion: z.string(),
  model: z.string(),
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxEstimatedCostUsd: z.number().nonnegative(),
  estimatedUpperCostUsd: z.number().nonnegative(),
  actualCostUsd: z.number().nonnegative().nullable(),
  pricingVersion: z.string(),
  approvalReasons: z.array(z.string()),
  progress: z.number().int().min(0).max(100),
  message: z.string(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  retryBackoff: z.enum(['fixed', 'exponential']),
  error: jsonObjectSchema.nullable(),
  requestedBy: z.string(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
const legacyExecutionRunSchema = currentExecutionRunSchema.extend({
  entryResourceVersionId: z.null(),
  entrySubject: z.null(),
  legacyEntrypointUnresolved: z.literal(true),
});
export const executionRunSchema = z.discriminatedUnion('legacyEntrypointUnresolved', [
  currentExecutionRunSchema,
  legacyExecutionRunSchema,
]);
export const executionRunListQuerySchema = z.object({
  state: executionRunStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const executionRunStateCountsSchema = z
  .object({
    awaiting_approval: z.number().int().nonnegative(),
    queued: z.number().int().nonnegative(),
    running: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    paused_budget: z.number().int().nonnegative(),
    paused_plugin: z.number().int().nonnegative(),
  })
  .strict();
export const executionRunListResponseSchema = z
  .object({
    items: z.array(executionRunSchema),
    total: z
      .number()
      .int()
      .nonnegative()
      .describe('All execution runs in principal scope before the state filter and item cap'),
    countsByState: executionRunStateCountsSchema.describe(
      'State totals for all execution runs in the full principal scope',
    ),
  })
  .strict()
  .refine(
    (value) =>
      value.total === Object.values(value.countsByState).reduce((sum, count) => sum + count, 0),
    { path: ['total'], message: 'Execution total must equal the state counts' },
  );
export const approveExecutionRunResponseSchema = z.object({
  grant: authorityGrantSchema,
  run: executionRunSchema,
});
export const approveExecutionRunGroupResponseSchema = z
  .object({
    groupKey: z.string().regex(/^[a-f0-9]{64}$/),
    grant: authorityGrantSchema,
    runs: z.array(executionRunSchema).min(1),
  })
  .strict();
export const rejectExecutionRunGroupResponseSchema = z
  .object({
    groupKey: z.string().regex(/^[a-f0-9]{64}$/),
    runs: z.array(executionRunSchema).min(1),
  })
  .strict();

export const dailyBriefInputSchema = z.object({
  date: z.string().date(),
  timezone: z.string().trim().min(1).max(100),
  priorities: z.array(z.string().trim().min(1).max(500)).max(20),
  calendarItems: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(300),
        startsAt: isoDateTimeSchema,
        endsAt: isoDateTimeSchema,
      }),
    )
    .max(100),
  tasks: z.array(z.string().trim().min(1).max(500)).max(100),
  signals: z.array(z.string().trim().min(1).max(1000)).max(100),
  userConstraints: z.array(z.string().trim().min(1).max(500)).max(20),
});
export const dailyBriefOutputSchema = z.object({
  topPriorities: z.array(z.string().trim().min(1).max(500)).max(5),
  scheduleRisks: z.array(z.string().trim().min(1).max(500)).max(10),
  decisionsRequired: z.array(z.string().trim().min(1).max(500)).max(10),
  proposedActions: z.array(z.string().trim().min(1).max(500)).max(10),
  citations: z.array(z.string().trim().min(1).max(500)).max(100),
  confidence: z.number().min(0).max(1),
  unresolvedItems: z.array(z.string().trim().min(1).max(500)).max(20),
});

export const outcomeRecordSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  output: jsonObjectSchema,
  confidence: z.number().min(0).max(1).nullable(),
  citations: z.array(z.string()),
  unresolvedItems: z.array(z.string()),
  qualityScore: z.number().min(0).max(1).nullable(),
  createdAt: isoDateTimeSchema,
});
export const outcomeListQuerySchema = z.object({ runId: uuidSchema.optional() });
export const outcomeListResponseSchema = z.object({ items: z.array(outcomeRecordSchema) });

export const metricSampleSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema.nullable(),
  name: z.string(),
  value: z.number().finite(),
  unit: z.string(),
  metadata: jsonObjectSchema,
  observedAt: isoDateTimeSchema,
});
export const metricListQuerySchema = z.object({ runId: uuidSchema.optional() });
export const metricListResponseSchema = z.object({ items: z.array(metricSampleSchema) });

export type ResourceManifest = z.infer<typeof resourceManifestSchema>;
export type ResourceVersion = z.infer<typeof resourceVersionSchema>;
export type ReleaseBundle = z.infer<typeof releaseBundleSchema>;
export type AuthorityGrant = z.infer<typeof authorityGrantSchema>;
export type ExecutionRun = z.infer<typeof executionRunSchema>;
export type DailyBriefInput = z.infer<typeof dailyBriefInputSchema>;
export type DailyBriefOutput = z.infer<typeof dailyBriefOutputSchema>;
