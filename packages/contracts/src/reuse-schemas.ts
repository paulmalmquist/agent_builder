import { z } from 'zod';
import { isoDateTimeSchema, jsonObjectSchema, uuidSchema } from './schemas.js';

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const semverSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  .max(80);
const oneLineSchema = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !/[\r\n]/u.test(value), 'Must be a single line');
const capabilityValueSchema = oneLineSchema(1, 240);
const capabilityListSchema = z.array(capabilityValueSchema).max(100);

function uniqueListIssues(
  value: Record<string, unknown>,
  fields: readonly string[],
  context: z.RefinementCtx,
): void {
  for (const field of fields) {
    const items = value[field];
    if (!Array.isArray(items)) continue;
    const normalized = (items as unknown[]).map((item) =>
      typeof item === 'string' ? item.normalize('NFKC').trim().toLocaleLowerCase('en-US') : item,
    );
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} must not contain duplicate values`,
        path: [field],
      });
    }
  }
}

export const capabilityRiskLevelSchema = z.enum(['low', 'moderate', 'high', 'critical']);

export const capabilityProfileSchema = z
  .object({
    schemaVersion: z.literal(1),
    intendedUsers: capabilityListSchema.min(1).max(20),
    businessDomain: capabilityValueSchema,
    triggers: capabilityListSchema.min(1).max(30),
    tasks: capabilityListSchema.min(1).max(100),
    inputs: capabilityListSchema.max(100),
    outputs: capabilityListSchema.min(1).max(100),
    knowledgeClasses: capabilityListSchema.max(100),
    tools: capabilityListSchema.max(100),
    potentialActions: capabilityListSchema.max(100),
    successCriteria: capabilityListSchema.min(1).max(50),
    riskLevel: capabilityRiskLevelSchema,
  })
  .strict()
  .superRefine((value, context) =>
    uniqueListIssues(
      value,
      [
        'intendedUsers',
        'triggers',
        'tasks',
        'inputs',
        'outputs',
        'knowledgeClasses',
        'tools',
        'potentialActions',
        'successCriteria',
      ],
      context,
    ),
  );
export type CapabilityProfile = z.infer<typeof capabilityProfileSchema>;

export const catalogVisibilitySchema = z.enum(['private', 'department', 'organization']);
export type CatalogVisibility = z.infer<typeof catalogVisibilitySchema>;

export const trustChipSchema = z
  .object({
    certificationState: z.literal('certified'),
    gatesPassed: z.number().int().positive(),
    gatesTotal: z.number().int().positive(),
    corpusSize: z.number().int().positive(),
    recertifiedAt: isoDateTimeSchema,
    label: oneLineSchema(10, 180),
  })
  .strict()
  .refine((value) => value.gatesPassed === value.gatesTotal, {
    message: 'A certified trust chip must report all gates passing',
    path: ['gatesPassed'],
  });
export type TrustChip = z.infer<typeof trustChipSchema>;

export const catalogPublicationSchema = z
  .object({
    id: uuidSchema,
    revision: z.number().int().positive(),
    subjectKind: z.enum(['agent', 'skill']),
    resourceVersionId: uuidSchema,
    releaseId: uuidSchema,
    releaseDigest: digestSchema,
    name: oneLineSchema(2, 160),
    version: semverSchema,
    owner: oneLineSchema(2, 200),
    department: oneLineSchema(2, 160),
    catalogVisibility: catalogVisibilitySchema,
    capabilityProfile: capabilityProfileSchema,
    trustChip: trustChipSchema,
    publishedAt: isoDateTimeSchema,
    retiredAt: isoDateTimeSchema.nullable(),
  })
  .strict();
export type CatalogPublication = z.infer<typeof catalogPublicationSchema>;

export const embeddingProvenanceSchema = z
  .object({
    providerKind: z.enum(['deterministic', 'direct', 'gateway']),
    providerVersion: oneLineSchema(1, 120),
    model: oneLineSchema(1, 160),
    dimensions: z.number().int().min(8).max(4096),
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export type EmbeddingProvenance = z.infer<typeof embeddingProvenanceSchema>;

export const catalogIndexResourceSchema = z
  .object({
    publicationId: uuidSchema,
    publicationRevision: z.number().int().positive(),
    subjectKind: z.enum(['agent', 'skill']),
    resourceVersionId: uuidSchema,
    releaseDigest: digestSchema,
    catalogVisibility: catalogVisibilitySchema,
    department: oneLineSchema(2, 160),
    featureKeys: z.array(oneLineSchema(3, 320)).min(1).max(500),
    canonicalText: z.string().min(1).max(100_000),
    embedding: z.array(z.number().finite()).min(8).max(4096).nullable(),
    embeddingProvenance: embeddingProvenanceSchema.nullable(),
    retired: z.boolean(),
    indexedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.embedding === null) !== (value.embeddingProvenance === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'embedding and embeddingProvenance must be present or absent together',
        path: ['embedding'],
      });
    }
    if (
      value.embedding !== null &&
      value.embeddingProvenance !== null &&
      value.embedding.length !== value.embeddingProvenance.dimensions
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Embedding dimensions must match its provenance',
        path: ['embedding'],
      });
    }
  });
export type CatalogIndexResource = z.infer<typeof catalogIndexResourceSchema>;

export const catalogIndexOperationSchema = z.enum(['upsert', 'remove']);
export const catalogIndexOutboxStateSchema = z.enum([
  'pending',
  'processing',
  'published',
  'failed',
]);
export const catalogIndexOutboxEventSchema = z
  .object({
    id: uuidSchema,
    idempotencyKey: oneLineSchema(8, 500),
    aggregateType: z.literal('catalog_publication'),
    aggregateId: uuidSchema,
    aggregateRevision: z.number().int().positive(),
    eventType: z.enum(['catalog.index.upsert_requested', 'catalog.index.remove_requested']),
    operation: catalogIndexOperationSchema,
    resource: catalogIndexResourceSchema,
    state: catalogIndexOutboxStateSchema,
    attempts: z.number().int().nonnegative().max(100),
    occurredAt: isoDateTimeSchema,
    availableAt: isoDateTimeSchema,
    claimedAt: isoDateTimeSchema.nullable(),
    publishedAt: isoDateTimeSchema.nullable(),
    lastError: oneLineSchema(1, 2000).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedEventType =
      value.operation === 'upsert'
        ? 'catalog.index.upsert_requested'
        : 'catalog.index.remove_requested';
    if (value.eventType !== expectedEventType) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'eventType must agree with operation',
        path: ['eventType'],
      });
    }
    if (value.operation === 'remove' && !value.resource.retired) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A remove event must carry a retired index-resource tombstone',
        path: ['resource', 'retired'],
      });
    }
    if (value.aggregateId !== value.resource.publicationId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'aggregateId must identify the indexed publication',
        path: ['aggregateId'],
      });
    }
    if (value.aggregateRevision !== value.resource.publicationRevision) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'aggregateRevision must match the index resource',
        path: ['aggregateRevision'],
      });
    }
  });
export type CatalogIndexOutboxEvent = z.infer<typeof catalogIndexOutboxEventSchema>;

// Explicit aliases make the transactional-index vocabulary available without coupling storage.
export const transactionalIndexResourceSchema = catalogIndexResourceSchema;
export const transactionalIndexOutboxEventSchema = catalogIndexOutboxEventSchema;
export type TransactionalIndexResource = CatalogIndexResource;
export type TransactionalIndexOutboxEvent = CatalogIndexOutboxEvent;

export const builderIntakeStateSchema = z.enum(['interpreted', 'confirmed', 'decided']);
export const builderIntakeSchema = z
  .object({
    id: uuidSchema,
    request: z.string().trim().min(10).max(10_000),
    requestedBy: oneLineSchema(1, 200),
    department: oneLineSchema(2, 160),
    state: builderIntakeStateSchema,
    capabilityProfile: capabilityProfileSchema,
    confirmedAt: isoDateTimeSchema.nullable(),
    specificationId: z.null().describe('Discovery precedes specification creation.'),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.state === 'interpreted' && value.confirmedAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'An interpreted intake has not yet been confirmed',
        path: ['confirmedAt'],
      });
    }
    if (value.state !== 'interpreted' && value.confirmedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A confirmed or decided intake requires confirmedAt',
        path: ['confirmedAt'],
      });
    }
  });
export type BuilderIntake = z.infer<typeof builderIntakeSchema>;

export const capabilityDeltaSchema = z
  .object({
    has: z.array(oneLineSchema(1, 320)).max(500),
    lacks: z.array(oneLineSchema(1, 320)).max(500),
    offers: z.array(oneLineSchema(1, 320)).max(500),
  })
  .strict()
  .refine((value) => value.has.length + value.lacks.length + value.offers.length > 0, {
    message: 'A match card requires a has/lacks/offers delta',
  });
export type CapabilityDelta = z.infer<typeof capabilityDeltaSchema>;

export const matchScoreModeSchema = z.enum(['hybrid_70_30', 'structured_only_fallback']);
export const matchScoreSchema = z
  .object({
    score: z.number().finite().min(0).max(100),
    structuredCoverage: z.number().finite().min(0).max(100),
    embeddingCosine: z.number().finite().min(0).max(1).nullable(),
    mode: matchScoreModeSchema,
    label: z.enum(['70% capability coverage + 30% embedding cosine', 'Structured-only fallback']),
  })
  .strict()
  .superRefine((value, context) => {
    const tolerance = 1e-9;
    if (value.mode === 'hybrid_70_30') {
      if (value.embeddingCosine === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Hybrid scoring requires embedding cosine',
          path: ['embeddingCosine'],
        });
        return;
      }
      const expected = 0.7 * value.structuredCoverage + 0.3 * value.embeddingCosine * 100;
      if (Math.abs(value.score - expected) > tolerance) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Hybrid score must be exactly 70% structured coverage and 30% embedding cosine',
          path: ['score'],
        });
      }
      if (value.label !== '70% capability coverage + 30% embedding cosine') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Hybrid score requires the hybrid label',
          path: ['label'],
        });
      }
    } else {
      if (
        value.embeddingCosine !== null ||
        Math.abs(value.score - value.structuredCoverage) > tolerance
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Structured-only fallback must use structured coverage as its score',
          path: ['score'],
        });
      }
      if (value.label !== 'Structured-only fallback') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Fallback scoring must be explicitly labelled',
          path: ['label'],
        });
      }
    }
  });
export type MatchScore = z.infer<typeof matchScoreSchema>;

export const referredChoiceProvenanceSchema = z
  .object({
    owner: oneLineSchema(2, 200),
    department: oneLineSchema(2, 160),
    resourceVersionId: uuidSchema,
    releaseId: uuidSchema,
    releaseDigest: digestSchema,
    publishedAt: isoDateTimeSchema,
  })
  .strict();

export const referredChoiceDeploymentSchema = z
  .object({
    total: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
  })
  .strict()
  .refine((value) => value.active <= value.total, {
    message: 'Active deployments cannot exceed total deployments',
    path: ['active'],
  });

export const referredChoiceSuccessSchema = z
  .object({
    successfulRuns: z.number().int().nonnegative(),
    measuredRuns: z.number().int().nonnegative(),
    rate: z.number().finite().min(0).max(1).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.successfulRuns > value.measuredRuns) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Successful runs cannot exceed measured runs',
        path: ['successfulRuns'],
      });
    }
    const expected = value.measuredRuns === 0 ? null : value.successfulRuns / value.measuredRuns;
    if (
      (expected === null && value.rate !== null) ||
      (expected !== null && (value.rate === null || Math.abs(value.rate - expected) > 1e-9))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Success rate must be null without evidence or equal successful/measured runs',
        path: ['rate'],
      });
    }
  });

export const referredChoiceCostSchema = z
  .object({
    usdPerRun: z.number().finite().nonnegative().nullable(),
    basis: z.enum(['observed', 'estimated', 'unavailable']),
  })
  .strict()
  .refine(
    (value) => (value.basis === 'unavailable') === (value.usdPerRun === null),
    'Unavailable cost must be null; observed or estimated cost must be present',
  );

export const referredChoiceSchema = z
  .object({
    publicationId: uuidSchema,
    subjectKind: z.literal('agent'),
    name: oneLineSchema(2, 160),
    version: semverSchema,
    trustChip: trustChipSchema,
    delta: capabilityDeltaSchema,
    match: matchScoreSchema,
    provenance: referredChoiceProvenanceSchema,
    deployment: referredChoiceDeploymentSchema,
    success: referredChoiceSuccessSchema,
    cost: referredChoiceCostSchema,
    knownLimitations: z.array(oneLineSchema(1, 500)).max(30),
  })
  .strict();
export type ReferredChoice = z.infer<typeof referredChoiceSchema>;

export const compositionSkillSchema = z
  .object({
    publicationId: uuidSchema,
    resourceVersionId: uuidSchema,
    name: oneLineSchema(2, 160),
    version: semverSchema,
    trustChip: trustChipSchema,
  })
  .strict();

export const compositionSuggestionSchema = z
  .object({
    key: oneLineSchema(8, 1000),
    skills: z.array(compositionSkillSchema).min(2).max(5),
    coveragePercent: z.number().finite().min(0).max(100),
    delta: capabilityDeltaSchema,
  })
  .strict();
export type CompositionSuggestion = z.infer<typeof compositionSuggestionSchema>;

export const compositionSuggestionsSchema = z.array(compositionSuggestionSchema).max(5);

export const builderIntakeResultsSchema = z
  .object({
    intakeId: uuidSchema,
    referredChoices: z.array(referredChoiceSchema).max(20),
    compositionSuggestions: compositionSuggestionsSchema,
    generatedAt: isoDateTimeSchema,
  })
  .strict();
export type BuilderIntakeResults = z.infer<typeof builderIntakeResultsSchema>;

export const builderDecisionActionSchema = z.enum([
  'use_as_is',
  'configure',
  'extend',
  'build_new',
]);
export type BuilderDecisionAction = z.infer<typeof builderDecisionActionSchema>;

const decisionCommonShape = {
  id: uuidSchema,
  intakeId: uuidSchema,
  decidedBy: oneLineSchema(1, 200),
  highestReferredMatchScore: z.number().finite().min(0).max(100).nullable(),
  decidedAt: isoDateTimeSchema,
};
const reuseDecisionSchema = (action: 'use_as_is' | 'configure' | 'extend') =>
  z
    .object({
      ...decisionCommonShape,
      action: z.literal(action),
      selectedPublicationId: uuidSchema,
      buildNewReason: z.null(),
      demandObservationId: z.null(),
    })
    .strict();
const buildNewDecisionSchema = z
  .object({
    ...decisionCommonShape,
    action: z.literal('build_new'),
    selectedPublicationId: z.null(),
    buildNewReason: oneLineSchema(3, 500).nullable(),
    demandObservationId: uuidSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const reasonRequired =
      value.highestReferredMatchScore !== null && value.highestReferredMatchScore > 80;
    if (reasonRequired && value.buildNewReason === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Build new requires a one-line reason when the highest match is over 80%',
        path: ['buildNewReason'],
      });
    }
    if (reasonRequired && value.demandObservationId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The required build-new reason must be captured as a demand observation',
        path: ['demandObservationId'],
      });
    }
    if ((value.buildNewReason === null) !== (value.demandObservationId === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A build-new reason and its demand observation must be recorded together',
        path: ['demandObservationId'],
      });
    }
  });

export const builderDecisionSchema = z.union([
  reuseDecisionSchema('use_as_is'),
  reuseDecisionSchema('configure'),
  reuseDecisionSchema('extend'),
  buildNewDecisionSchema,
]);
export type BuilderDecision = z.infer<typeof builderDecisionSchema>;

export const configurationRevisionSchema = z
  .object({
    id: uuidSchema,
    deploymentId: uuidSchema,
    revision: z.number().int().positive(),
    previousRevisionId: uuidSchema.nullable(),
    configuration: jsonObjectSchema,
    digest: digestSchema,
    createdBy: oneLineSchema(1, 200),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .refine(
    (value) => (value.revision === 1) === (value.previousRevisionId === null),
    'Only revision 1 may omit previousRevisionId',
  );
export type ConfigurationRevision = Readonly<z.infer<typeof configurationRevisionSchema>>;

export const builderDraftStateSchema = z.enum(['draft', 'ready', 'materialized', 'discarded']);
export const builderDraftSchema = z
  .object({
    id: uuidSchema,
    intakeId: uuidSchema,
    decisionId: uuidSchema,
    draftKind: z.enum(['configuration', 'extension', 'new']),
    basePublicationId: uuidSchema.nullable(),
    capabilityProfile: capabilityProfileSchema,
    definition: jsonObjectSchema,
    revision: z.number().int().positive(),
    state: builderDraftStateSchema,
    createdBy: oneLineSchema(1, 200),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const requiresBase = value.draftKind === 'configuration' || value.draftKind === 'extension';
    if (requiresBase !== (value.basePublicationId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Configuration and extension drafts require a base publication; new drafts do not',
        path: ['basePublicationId'],
      });
    }
  });
export type BuilderDraft = z.infer<typeof builderDraftSchema>;

export const resourceLineageRelationshipSchema = z.enum(['forked_from', 'composed_of']);
export const resourceLineageSchema = z
  .object({
    id: uuidSchema,
    childResourceVersionId: uuidSchema,
    parentResourceVersionId: uuidSchema,
    relationship: resourceLineageRelationshipSchema,
    ordinal: z.number().int().nonnegative().nullable(),
    decisionId: uuidSchema,
    createdBy: oneLineSchema(1, 200),
    createdAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.childResourceVersionId === value.parentResourceVersionId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A resource cannot be its own ancestor',
        path: ['parentResourceVersionId'],
      });
    }
    if ((value.relationship === 'composed_of') !== (value.ordinal !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only composed_of lineage has an ordinal',
        path: ['ordinal'],
      });
    }
  });
export type ResourceLineage = Readonly<z.infer<typeof resourceLineageSchema>>;

export const deploymentStatusSchema = z.enum(['pending', 'active', 'retired', 'failed']);
export const deploymentSchema = z
  .object({
    id: uuidSchema,
    decisionId: uuidSchema,
    decisionAction: builderDecisionActionSchema,
    deployedResourceVersionId: uuidSchema,
    sourcePublicationId: uuidSchema.nullable(),
    projectId: oneLineSchema(1, 200),
    configurationRevisionId: uuidSchema.nullable(),
    lineageIds: z.array(uuidSchema).max(8),
    status: deploymentStatusSchema,
    sourceRetiredAt: isoDateTimeSchema.nullable(),
    retiredSourceWarning: z.boolean(),
    deployedBy: oneLineSchema(1, 200),
    deployedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decisionAction !== 'build_new' && value.sourcePublicationId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Reuse decisions require their source publication',
        path: ['sourcePublicationId'],
      });
    }
    if (value.decisionAction === 'build_new' && value.sourcePublicationId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A new build has no source publication',
        path: ['sourcePublicationId'],
      });
    }
    if ((value.decisionAction === 'configure') !== (value.configurationRevisionId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only configured deployments require a configuration revision',
        path: ['configurationRevisionId'],
      });
    }
    if ((value.decisionAction === 'extend') !== value.lineageIds.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only extended deployments require fork lineage',
        path: ['lineageIds'],
      });
    }
    if ((value.sourceRetiredAt !== null) !== value.retiredSourceWarning) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A retired source must flag its deployed configuration',
        path: ['retiredSourceWarning'],
      });
    }
  });
export type Deployment = z.infer<typeof deploymentSchema>;

export const catalogPublicationListQuerySchema = z
  .object({
    subjectKind: z.enum(['agent', 'skill']).optional(),
    catalogVisibility: catalogVisibilitySchema.optional(),
    includeRetired: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const catalogPublicationListResponseSchema = z
  .object({ items: z.array(catalogPublicationSchema).max(100) })
  .strict();

export const retireCatalogPublicationRequestSchema = z
  .object({ rationale: oneLineSchema(3, 1000) })
  .strict();

export const createBuilderIntakeRequestSchema = z
  .object({
    request: z.string().trim().min(10).max(10_000),
    department: oneLineSchema(2, 160),
    capabilityProfile: capabilityProfileSchema,
    confirmed: z.boolean(),
  })
  .strict();

export const createBuilderDecisionRequestSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.enum(['use_as_is', 'configure', 'extend']),
      selectedPublicationId: uuidSchema,
      buildNewReason: z.null(),
    })
    .strict(),
  z
    .object({
      action: z.literal('build_new'),
      selectedPublicationId: z.null(),
      buildNewReason: oneLineSchema(3, 500).nullable(),
    })
    .strict(),
]);

export const idempotencyKeySchema = oneLineSchema(8, 200);

export const createDeploymentRequestSchema = z
  .object({
    decisionId: uuidSchema,
    projectId: oneLineSchema(1, 200).default('default'),
  })
  .strict();

export const appendConfigurationRevisionRequestSchema = z
  .object({ configuration: jsonObjectSchema })
  .strict();

export const resourceLineageListResponseSchema = z
  .object({ items: z.array(resourceLineageSchema).max(1000) })
  .strict();
