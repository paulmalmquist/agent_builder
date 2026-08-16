import { z } from 'zod';
import {
  guardrailsSectionSchema,
  isoDateTimeSchema,
  knowledgeSectionSchema,
  outcomesSectionSchema,
  outputsSectionSchema,
  specSectionSchema,
  uuidSchema,
} from './schemas.js';

export const interpretationConfidenceSchema = z.enum(['high', 'medium', 'low']);
export const interpretationUnresolvedKindSchema = z.enum(['source', 'authority', 'scope', 'field']);
export const authorityDispositionSchema = z.enum(['read_only', 'approval_required', 'prohibited']);

export const interpretationUnresolvedSchema = z.object({
  id: z.string().min(1).max(120),
  section: specSectionSchema,
  kind: interpretationUnresolvedKindSchema,
  input: z.string().min(1).max(1000),
  message: z.string().min(1).max(1000),
  descriptorCandidates: z.array(z.string().min(1).max(100)).max(20),
});

export const authorityWarningSchema = z.object({
  requestedAction: z.string().min(1).max(500),
  disposition: authorityDispositionSchema,
  message: z.string().min(1).max(1000),
});

const interpretedSection = <T extends z.ZodTypeAny>(value: T) =>
  z.object({
    value: value.nullable(),
    confidence: interpretationConfidenceSchema,
    needsReview: z.boolean(),
    unresolved: z.array(interpretationUnresolvedSchema),
  });

export const interpretedOutcomesSchema = interpretedSection(outcomesSectionSchema);
export const interpretedKnowledgeSchema = interpretedSection(knowledgeSectionSchema);
export const interpretedGuardrailsSchema = interpretedSection(guardrailsSectionSchema);
export const interpretedOutputsSchema = interpretedSection(outputsSectionSchema);

export const interpretPromptRequestSchema = z.object({
  kind: z.literal('prompt'),
  prompt: z.string().trim().min(20).max(12000),
  specId: uuidSchema.optional(),
});
export const interpretSplitSelectionRequestSchema = z.object({
  kind: z.literal('split_selection'),
  parentInterpretationId: uuidSchema,
  candidateId: z.string().min(1).max(120),
  specId: uuidSchema.optional(),
});
export const interpretSpecRequestSchema = z.discriminatedUnion('kind', [
  interpretPromptRequestSchema,
  interpretSplitSelectionRequestSchema,
]);
export type InterpretSpecRequest = z.infer<typeof interpretSpecRequestSchema>;

export const interpretationPrefillResponseSchema = z.object({
  kind: z.literal('prefill'),
  interpretationId: uuidSchema,
  parentInterpretationId: uuidSchema.nullable(),
  expiresAt: isoDateTimeSchema,
  sections: z.object({
    outcomes: interpretedOutcomesSchema,
    knowledge: interpretedKnowledgeSchema,
    guardrails: interpretedGuardrailsSchema,
    outputs: interpretedOutputsSchema,
  }),
  authorityWarnings: z.array(authorityWarningSchema),
  reuseQuery: z.string().min(2).max(2000),
});
export type InterpretationPrefillResponse = z.infer<typeof interpretationPrefillResponseSchema>;

export const interpretationSplitCandidateSchema = z.object({
  id: z.string().min(1).max(120),
  name: z.string().min(2).max(120),
  purpose: z.string().min(10).max(3000),
  trigger: z.string().min(2).max(500),
  outcome: z.string().min(2).max(500),
});
export const interpretationSplitRequiredResponseSchema = z.object({
  kind: z.literal('split_required'),
  interpretationId: uuidSchema,
  parentInterpretationId: uuidSchema.nullable(),
  expiresAt: isoDateTimeSchema,
  candidates: z.array(interpretationSplitCandidateSchema).min(2).max(10),
});
export type InterpretationSplitRequiredResponse = z.infer<
  typeof interpretationSplitRequiredResponseSchema
>;

export const interpretSpecResponseSchema = z.discriminatedUnion('kind', [
  interpretationPrefillResponseSchema,
  interpretationSplitRequiredResponseSchema,
]);
export type InterpretSpecResponse = z.infer<typeof interpretSpecResponseSchema>;
