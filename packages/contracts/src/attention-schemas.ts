import { z } from 'zod';
import { isoDateTimeSchema, jsonObjectSchema, uuidSchema } from './schemas.js';

export const surfaceStatusSchema = z.enum(['decide', 'degraded', 'safety_stop', 'nominal']);
export const attentionShelfSchema = z.enum(['decide', 'degraded']);
export const attentionItemKindSchema = z.enum([
  'execution_approval',
  'release_promotion',
  'memory_review',
  'improvement_review',
  'plugin_health',
  'stalled_run',
  'budget_stop',
  'waiting_for_user',
  'safety_stop',
]);
export const attentionActionKindSchema = z.enum([
  'approve_run',
  'reject_run',
  'promote_release',
  'decline_release',
  'accept_memory',
  'reject_memory',
  'incubate_candidate',
  'reject_candidate',
  'open_details',
  'sign_in',
  'cancel_run',
  'resolve_item',
]);

export const surfaceActionSchema = z.object({
  kind: attentionActionKindSchema,
  label: z.string().trim().min(1).max(80),
  consequence: z.string().trim().min(1).max(240),
  undo: z.string().trim().min(1).max(240),
  resourceId: z.string().trim().min(1).max(240),
  requiresRationale: z.boolean(),
});

export const surfaceCostSchema = z.object({
  period: z.enum(['run', 'day', 'week', 'month']),
  usd: z.number().nonnegative().finite(),
  budgetUsd: z.number().nonnegative().finite().nullable(),
});

export const surfaceProvenanceSchema = z.object({
  sourceType: z.string().trim().min(1).max(120),
  sourceId: z.string().trim().min(1).max(240),
  actorId: z.string().trim().min(1).max(200).nullable(),
  requestId: z.string().trim().min(1).max(200).nullable(),
  explanation: z.string().trim().min(1).max(500),
});

export const surfaceEnvelopeBaseSchema = z.object({
  headline: z.string().trim().min(1).max(160),
  delta: z.string().trim().min(1).max(300),
  status: surfaceStatusSchema,
  primaryAction: surfaceActionSchema.nullable(),
  secondaryAction: surfaceActionSchema.nullable(),
  cost: surfaceCostSchema.nullable(),
  reason: z.string().trim().min(1).max(500),
  provenance: surfaceProvenanceSchema,
  occurredAt: isoDateTimeSchema,
});

export function surfaceEnvelopeSchema<TSchema extends z.ZodTypeAny>(payloadSchema: TSchema) {
  return surfaceEnvelopeBaseSchema.extend({ payload: payloadSchema });
}

export const attentionItemPayloadSchema = z.object({
  sourceType: z.string().trim().min(1).max(120),
  sourceId: z.string().trim().min(1).max(240),
  detailPath: z.string().trim().startsWith('/').max(500),
  scopes: z.array(z.string().trim().min(1).max(240)).max(100),
  runId: uuidSchema.nullable(),
  candidateId: uuidSchema.nullable(),
  channelKey: z.string().trim().min(1).max(160).nullable(),
  releaseId: uuidSchema.nullable(),
  evaluationId: uuidSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  reviewFacts: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1).max(500),
      }),
    )
    .max(12),
  metadata: jsonObjectSchema,
});

export const attentionItemSchema = surfaceEnvelopeSchema(attentionItemPayloadSchema)
  .extend({
    id: z.string().trim().min(3).max(320),
    kind: attentionItemKindSchema,
    shelf: attentionShelfSchema,
  })
  .superRefine((item, context) => {
    if (item.shelf === 'decide' && item.status !== 'decide') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'Decide items must use decide status',
      });
    }
    if (item.shelf === 'degraded' && !['degraded', 'safety_stop'].includes(item.status)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['status'],
        message: 'Degraded items must use degraded or safety_stop status',
      });
    }
    const expected =
      item.kind === 'execution_approval'
        ? {
            primary: 'approve_run',
            secondary: 'reject_run',
            ids: ['runId', 'releaseId'] as const,
          }
        : item.kind === 'release_promotion'
          ? {
              primary: 'promote_release',
              secondary: 'decline_release',
              ids: ['channelKey', 'releaseId', 'evaluationId'] as const,
            }
          : item.kind === 'memory_review'
            ? {
                primary: 'accept_memory',
                secondary: 'reject_memory',
                ids: ['runId', 'candidateId'] as const,
              }
            : item.kind === 'improvement_review'
              ? {
                  primary: 'incubate_candidate',
                  secondary: 'reject_candidate',
                  ids: ['candidateId'] as const,
                }
              : null;
    if (expected !== null) {
      if (item.shelf !== 'decide') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['shelf'],
          message: `${item.kind} belongs on the Decide shelf`,
        });
      }
      if (item.primaryAction?.kind !== expected.primary) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['primaryAction'],
          message: `${item.kind} has the wrong primary action`,
        });
      }
      if (item.secondaryAction?.kind !== expected.secondary) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['secondaryAction'],
          message: `${item.kind} has the wrong secondary action`,
        });
      }
      for (const key of expected.ids) {
        if (item.payload[key] === null) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['payload', key],
            message: `${item.kind} requires ${key}`,
          });
        }
      }
    } else if (item.shelf === 'degraded' && item.primaryAction?.kind !== 'open_details') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['primaryAction'],
        message: 'Degraded items must open details before mutation',
      });
    }
  });

export const digestSummarySchema = z.object({
  headline: z.string().trim().min(1).max(240),
  runCount: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative().finite(),
  promotionCount: z.number().int().nonnegative(),
  observationCount: z.number().int().nonnegative(),
  windowStartedAt: isoDateTimeSchema.nullable(),
  windowEndedAt: isoDateTimeSchema,
});

export const digestSnapshotSummarySchema = digestSummarySchema.extend({
  eventCount: z.number().int().nonnegative().default(0),
  eventLines: z.array(z.string().trim().min(1).max(240)).max(250).default([]),
  omittedEventCount: z.number().int().nonnegative().default(0),
});

export const attentionResponseSchema = z.object({
  generatedAt: isoDateTimeSchema,
  decide: z.array(attentionItemSchema),
  degraded: z.array(attentionItemSchema),
  digest: digestSummarySchema,
  decideBadgeCount: z.number().int().nonnegative(),
  lastDeliveredBriefingAt: isoDateTimeSchema.nullable(),
});

export const attentionItemDetailSchema = z.object({
  item: attentionItemSchema,
  timeline: z.array(
    z.object({
      id: uuidSchema,
      phase: z.string().trim().min(1).max(160),
      state: z.string().trim().min(1).max(80),
      message: z.string().trim().min(1).max(500),
      durationMs: z.number().int().nonnegative().nullable(),
      costUsd: z.number().nonnegative().finite().nullable(),
      occurredAt: isoDateTimeSchema,
    }),
  ),
  details: jsonObjectSchema,
});

export const attentionItemParamsSchema = z.object({
  itemId: z.string().trim().min(3).max(320),
});

export const resolveAttentionItemRequestSchema = z.object({
  rationale: z.string().trim().min(10).max(2000),
});

export const attentionResolutionSchema = z.object({
  id: uuidSchema,
  itemId: z.string().trim().min(3).max(320),
  rationale: z.string().trim().min(10).max(2000),
  resolvedBy: z.string().trim().min(1).max(200),
  resolvedAt: isoDateTimeSchema,
});

export const rejectExecutionRunRequestSchema = z.object({
  rationale: z.string().trim().min(10).max(2000),
});

export const declineReleaseRequestSchema = z.object({
  releaseId: uuidSchema,
  evaluationId: uuidSchema,
  rationale: z.string().trim().min(10).max(2000),
});

export const digestDeliveryStateSchema = z.enum(['pending', 'delivered', 'failed']);
export const digestSnapshotSchema = z.object({
  id: uuidSchema,
  windowStartedAt: isoDateTimeSchema,
  windowEndedAt: isoDateTimeSchema,
  eventSequenceThrough: z.string().regex(/^\d+$/),
  summary: digestSnapshotSummarySchema,
  state: digestDeliveryStateSchema,
  briefingRunId: uuidSchema.nullable(),
  deliveredAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});

export const executionRunEventSchema = z.object({
  id: uuidSchema,
  runId: uuidSchema,
  sequence: z.number().int().positive(),
  phase: z.string().trim().min(1).max(160),
  state: z.string().trim().min(1).max(80),
  message: z.string().trim().min(1).max(500),
  durationMs: z.number().int().nonnegative().nullable(),
  costUsd: z.number().nonnegative().finite().nullable(),
  occurredAt: isoDateTimeSchema,
});

export type SurfaceStatus = z.infer<typeof surfaceStatusSchema>;
export type SurfaceAction = z.infer<typeof surfaceActionSchema>;
export type AttentionItem = z.infer<typeof attentionItemSchema>;
export type AttentionResponse = z.infer<typeof attentionResponseSchema>;
export type AttentionItemDetail = z.infer<typeof attentionItemDetailSchema>;
export type DigestSnapshot = z.infer<typeof digestSnapshotSchema>;
export type ExecutionRunEvent = z.infer<typeof executionRunEventSchema>;
export type SurfaceEnvelope<TPayload> = z.infer<typeof surfaceEnvelopeBaseSchema> & {
  payload: TPayload;
};
