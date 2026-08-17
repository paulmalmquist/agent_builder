import { z } from 'zod';
import { uuidSchema } from './schemas.js';

const forbiddenPathSegments = new Set(['__proto__', 'prototype', 'constructor']);

export const pluginCallInputPathSegmentSchema = z.union([
  z.string().trim().min(1).max(120),
  z.number().int().nonnegative().max(10_000),
]);

/**
 * A bounded path into the immutable ExecutionRun input. An empty path selects the complete input.
 * String segments address object properties and integer segments address array elements.
 */
export const pluginCallInputPathSchema = z
  .array(pluginCallInputPathSegmentSchema)
  .max(16)
  .superRefine((segments, context) => {
    segments.forEach((segment, index) => {
      if (typeof segment === 'string' && forbiddenPathSegments.has(segment.toLowerCase())) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: 'Prototype path segments are forbidden',
        });
      }
    });
  });

/**
 * Requests one deterministic pre-model Plugin call. The server resolves this reference to the
 * exact immutable RunPluginRequirement and owns the invocation key, effect, digest, and ordering.
 */
export const plannedPluginCallRequestSchema = z
  .object({
    installationId: uuidSchema,
    pluginVersionId: uuidSchema,
    tool: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_-]{0,119}$/),
    inputPath: pluginCallInputPathSchema.default([]),
    outputContextKey: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,79}$/),
  })
  .strict();

export const plannedPluginCallsRequestSchema = z
  .array(plannedPluginCallRequestSchema)
  .max(20)
  .superRefine((calls, context) => {
    const contextKeys = new Set<string>();
    calls.forEach((call, index) => {
      if (contextKeys.has(call.outputContextKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'outputContextKey'],
          message: 'Plugin output context keys must be unique within a run',
        });
      }
      contextKeys.add(call.outputContextKey);
    });
  });

export type PluginCallInputPath = z.infer<typeof pluginCallInputPathSchema>;
export type PlannedPluginCallRequest = z.infer<typeof plannedPluginCallRequestSchema>;
