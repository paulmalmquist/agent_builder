import { z } from 'zod';
import { isoDateTimeSchema, jsonObjectSchema, uuidSchema } from './schemas.js';

export const automationScheduleStateSchema = z.enum(['active', 'paused']);
export const automationCatchUpPolicySchema = z.enum(['latest_only', 'all', 'none']);
export const automationBackoffSchema = z.enum(['fixed', 'exponential']);
export const automationDispatchStateSchema = z.enum(['pending', 'run_created', 'failed']);

const automationScheduleInputSchema = z.object({
  name: z.string().trim().min(2).max(160),
  channelKey: z.string().trim().min(1).max(160),
  releaseId: uuidSchema,
  entryResourceVersionId: uuidSchema,
  authorityGrantId: uuidSchema.nullable().default(null),
  timezone: z.string().trim().min(1).max(100),
  intervalSeconds: z.number().int().min(60).max(31_536_000),
  nextRunAt: isoDateTimeSchema,
  inputTemplate: jsonObjectSchema,
  includePlatformDigest: z.boolean().default(false),
  inputConstraints: jsonObjectSchema.default({}),
  catchUpPolicy: automationCatchUpPolicySchema.default('latest_only'),
  maxCatchUpRuns: z.number().int().min(1).max(100).default(10),
  deduplicationWindowSeconds: z.number().int().min(0).max(31_536_000).default(300),
  retry: z
    .object({
      maximumAttempts: z.number().int().min(1).max(20),
      backoff: automationBackoffSchema,
    })
    .strict(),
  cost: z
    .object({
      maxInputTokens: z.number().int().min(1).max(1_000_000),
      maxOutputTokens: z.number().int().min(1).max(1_000_000),
      maxEstimatedCostUsd: z.number().nonnegative().max(100_000),
    })
    .strict(),
  outcomeExpectations: jsonObjectSchema.default({}),
});

function validateDigestInput(
  value: { includePlatformDigest: boolean; inputTemplate: Record<string, unknown> },
  context: z.RefinementCtx,
): void {
  if (value.includePlatformDigest && !Array.isArray(value.inputTemplate['signals'])) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['inputTemplate', 'signals'],
      message: 'signals must be an array when includePlatformDigest is enabled',
    });
  }
}

export const createAutomationScheduleRequestSchema =
  automationScheduleInputSchema.superRefine(validateDigestInput);
export const automationScheduleSchema = automationScheduleInputSchema
  .extend({
    id: uuidSchema,
    releaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
    projectId: z.string().nullable(),
    state: automationScheduleStateSchema,
    lastScheduledAt: isoDateTimeSchema.nullable(),
    createdBy: z.string(),
    updatedBy: z.string(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .superRefine(validateDigestInput);
export const automationScheduleListQuerySchema = z.object({
  state: automationScheduleStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const automationScheduleListResponseSchema = z
  .object({
    items: z.array(automationScheduleSchema),
    total: z
      .number()
      .int()
      .nonnegative()
      .describe('All schedules in principal scope before the state filter and item cap'),
    activeTotal: z
      .number()
      .int()
      .nonnegative()
      .describe('Active schedules in the full principal scope'),
  })
  .strict()
  .refine((value) => value.activeTotal <= value.total, {
    path: ['activeTotal'],
    message: 'Active schedules cannot exceed the total',
  });
export const updateAutomationScheduleStateRequestSchema = z.object({
  state: automationScheduleStateSchema,
  rationale: z.string().trim().min(10).max(2000),
});
export const scheduleDueAutomationsRequestSchema = z.object({
  now: isoDateTimeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(25),
});
export const scheduleDueAutomationsResponseSchema = z.object({
  lockAcquired: z.boolean(),
  claimedSchedules: z.number().int().nonnegative(),
  dispatchesCreated: z.number().int().nonnegative(),
  runsCreated: z.number().int().nonnegative(),
  awaitingApproval: z.number().int().nonnegative(),
  failedDispatches: z.number().int().nonnegative(),
  runIds: z.array(uuidSchema),
});

export const observationSchema = z.object({
  id: uuidSchema,
  signalKey: z.string().trim().min(1).max(200),
  signalType: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(10).max(5000),
  evidence: jsonObjectSchema,
  provenance: jsonObjectSchema,
  sourceRunId: uuidSchema.nullable(),
  sourceOutcomeId: uuidSchema.nullable(),
  observedBy: z.string(),
  observedAt: isoDateTimeSchema,
});
export const createObservationRequestSchema = observationSchema.omit({
  id: true,
  observedBy: true,
  observedAt: true,
});
export const observationListQuerySchema = z.object({
  sourceRunId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const observationListResponseSchema = z.object({ items: z.array(observationSchema) });

export const improvementCandidateStateSchema = z.enum(['proposed', 'incubating', 'rejected']);
export const improvementCandidateSchema = z.object({
  id: uuidSchema,
  observationId: uuidSchema,
  title: z.string().trim().min(2).max(200),
  proposedTarget: z.string().trim().min(1).max(200),
  proposedChange: z.string().trim().min(10).max(5000),
  evidenceRefs: z.array(z.string().trim().min(1).max(500)).max(100),
  state: improvementCandidateStateSchema,
  createdBy: z.string(),
  reviewedBy: z.string().nullable(),
  reviewRationale: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  reviewedAt: isoDateTimeSchema.nullable(),
});
export const createImprovementCandidateRequestSchema = improvementCandidateSchema.omit({
  id: true,
  state: true,
  createdBy: true,
  reviewedBy: true,
  reviewRationale: true,
  createdAt: true,
  reviewedAt: true,
});
export const improvementCandidateListQuerySchema = z.object({
  state: improvementCandidateStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const improvementCandidateListResponseSchema = z.object({
  items: z.array(improvementCandidateSchema),
});
export const reviewImprovementCandidateRequestSchema = z.object({
  decision: z.enum(['incubate', 'reject']),
  rationale: z.string().trim().min(10).max(2000),
});

export const memoryCandidateStateSchema = z.enum(['staged', 'accepted', 'rejected']);
export const memoryCandidateSchema = z.object({
  id: uuidSchema,
  sourceRunId: uuidSchema,
  namespace: z.string().trim().min(1).max(160),
  proposedValue: jsonObjectSchema,
  acceptedValue: jsonObjectSchema.nullable(),
  provenance: jsonObjectSchema,
  state: memoryCandidateStateSchema,
  stagedBy: z.string(),
  reviewedBy: z.string().nullable(),
  reviewRationale: z.string().nullable(),
  stagedAt: isoDateTimeSchema,
  reviewedAt: isoDateTimeSchema.nullable(),
});
export const createMemoryCandidateRequestSchema = memoryCandidateSchema.omit({
  id: true,
  acceptedValue: true,
  state: true,
  stagedBy: true,
  reviewedBy: true,
  reviewRationale: true,
  stagedAt: true,
  reviewedAt: true,
});
export const memoryCandidateListQuerySchema = z.object({
  state: memoryCandidateStateSchema.optional(),
  sourceRunId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const memoryCandidateListResponseSchema = z.object({
  items: z.array(memoryCandidateSchema),
});
export const reviewMemoryCandidateRequestSchema = z
  .object({
    decision: z.enum(['accept', 'edit_accept', 'reject']),
    editedValue: jsonObjectSchema.optional(),
    rationale: z.string().trim().min(10).max(2000),
  })
  .superRefine((value, context) => {
    if (value.decision === 'edit_accept' && value.editedValue === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['editedValue'],
        message: 'editedValue is required when decision is edit_accept',
      });
    }
    if (value.decision !== 'edit_accept' && value.editedValue !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['editedValue'],
        message: 'editedValue is only allowed when decision is edit_accept',
      });
    }
  });

export type AutomationSchedule = z.infer<typeof automationScheduleSchema>;
export type Observation = z.infer<typeof observationSchema>;
export type ImprovementCandidate = z.infer<typeof improvementCandidateSchema>;
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;
