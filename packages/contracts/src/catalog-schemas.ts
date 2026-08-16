import { z } from 'zod';
import { agentSchema, agentStatusSchema, sourceProviderSchema, uuidSchema } from './schemas.js';

export const catalogCursorSchema = z.string().min(1).max(500);

export const agentCatalogQueryObjectSchema = z.object({
  query: z.string().trim().max(2000).optional(),
  department: z.string().trim().min(1).max(120).optional(),
  status: agentStatusSchema.optional(),
  provider: sourceProviderSchema.optional(),
  familyId: uuidSchema.optional(),
  includeRetired: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: catalogCursorSchema.optional(),
});
export const agentCatalogQuerySchema = agentCatalogQueryObjectSchema.superRefine(
  (value, context) => {
    if (
      value.familyId !== undefined &&
      (value.query !== undefined ||
        value.department !== undefined ||
        value.status !== undefined ||
        value.provider !== undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'familyId cannot be combined with catalog filters',
        path: ['familyId'],
      });
    }
    if (value.familyId === undefined && value.includeRetired !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'includeRetired is only valid with familyId',
        path: ['includeRetired'],
      });
    }
  },
);
export type AgentCatalogQuery = z.infer<typeof agentCatalogQuerySchema>;

export const agentVersionSummarySchema = agentSchema.extend({
  familySlug: z.string().min(1).max(160),
  isChampion: z.boolean(),
  providers: z.array(sourceProviderSchema),
});
export type AgentVersionSummary = z.infer<typeof agentVersionSummarySchema>;

export const agentCatalogItemSchema = agentVersionSummarySchema.extend({
  score: z.number().int().min(0).max(100),
  reuseRecommended: z.boolean(),
  matchedCapabilities: z.array(z.string()),
  gaps: z.array(z.string()),
});
export type AgentCatalogItem = z.infer<typeof agentCatalogItemSchema>;

// Kept as the catalog-mode schema so existing search consumers can migrate without
// inventing a second wire type.
export const agentSearchItemSchema = agentCatalogItemSchema;
export const agentSearchResponseSchema = z.object({
  mode: z.literal('catalog'),
  query: z.string(),
  nextCursor: catalogCursorSchema.nullable().default(null),
  items: z.array(agentCatalogItemSchema),
});
export type AgentSearchResponse = z.infer<typeof agentSearchResponseSchema>;

export const agentFamilyVersionsResponseSchema = z.object({
  mode: z.literal('family_versions'),
  familyId: uuidSchema,
  nextCursor: catalogCursorSchema.nullable(),
  items: z.array(agentVersionSummarySchema),
});
export type AgentFamilyVersionsResponse = z.infer<typeof agentFamilyVersionsResponseSchema>;

export const agentCatalogResponseSchema = z.discriminatedUnion('mode', [
  agentSearchResponseSchema,
  agentFamilyVersionsResponseSchema,
]);
export type AgentCatalogResponse = z.infer<typeof agentCatalogResponseSchema>;
