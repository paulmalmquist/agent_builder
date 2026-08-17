import { z } from 'zod';
import { isoDateTimeSchema, jsonObjectSchema, uuidSchema } from './schemas.js';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const base64UrlSchema = z
  .string()
  .min(32)
  .max(32_768)
  .regex(/^[A-Za-z0-9_-]+$/);
const certificateThumbprintSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(?:[A-F0-9]{40}|[A-F0-9]{64})$/);
const windowsSidSchema = z
  .string()
  .trim()
  .regex(/^S-1-(?:\d+-){1,14}\d+$/)
  .max(184);
const identifierSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
  .max(160);

export const DAILY_BRIEF_FRESHNESS_WINDOW_SECONDS = 7_200 as const;
export const DEFAULT_AD_HOC_WORKSTATION_FRESHNESS_SECONDS = 3_600 as const;

export const brokerExecutionResidencySchema = z.enum(['control_plane', 'workstation']);
export const workstationRunStateSchema = z.enum([
  'control_plane_ready',
  'waiting_for_user',
  'leased',
  'executing',
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

export const workstationRequirementSchema = z
  .object({
    pluginVersionId: uuidSchema,
    pluginDigest: sha256Schema,
    installationId: uuidSchema,
    tool: identifierSchema,
    residency: brokerExecutionResidencySchema,
  })
  .strict();

export const workstationPlacementRequestSchema = z
  .object({
    runId: uuidSchema,
    workspaceId: uuidSchema,
    departmentId: uuidSchema.nullable(),
    actorId: z.string().trim().min(2).max(200),
    requiredUserSid: windowsSidSchema,
    requiredDeviceCertificateThumbprint: certificateThumbprintSchema,
    scheduleId: uuidSchema.nullable(),
    workflowKind: z.enum(['daily_brief', 'other']),
    freshnessWindowSeconds: z.number().int().min(60).max(86_400).nullable(),
    requirements: z.array(workstationRequirementSchema).max(100),
    requestedAt: isoDateTimeSchema,
  })
  .strict();

export const workstationRunSnapshotSchema = z
  .object({
    runId: uuidSchema,
    workspaceId: uuidSchema,
    departmentId: uuidSchema.nullable(),
    scheduleId: uuidSchema.nullable(),
    state: workstationRunStateSchema,
    placement: brokerExecutionResidencySchema,
    requiredActorId: z.string().trim().min(2).max(200),
    requiredUserSid: windowsSidSchema,
    requiredDeviceCertificateThumbprint: certificateThumbprintSchema,
    freshnessWindowSeconds: z.number().int().min(60).max(86_400).nullable(),
    waitingSince: isoDateTimeSchema.nullable(),
    expiresAt: isoDateTimeSchema.nullable(),
    workOrderId: uuidSchema.nullable(),
    leaseId: uuidSchema.nullable(),
    nonce: base64UrlSchema.nullable(),
    attentionRequired: z.boolean(),
    attentionReason: z.string().trim().min(1).max(500).nullable(),
    externalEffectsAllowed: z.boolean(),
    digestEventKey: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export const workstationWorkOrderPayloadSchema = z
  .object({
    schemaVersion: z.literal('paul-os.workstation-work-order/v1'),
    workOrderId: uuidSchema,
    leaseId: uuidSchema,
    runId: uuidSchema,
    workspaceId: uuidSchema,
    departmentId: uuidSchema.nullable(),
    entryResourceVersionId: uuidSchema,
    releaseDigest: sha256Schema,
    installationId: uuidSchema,
    pluginVersionId: uuidSchema,
    pluginDigest: sha256Schema,
    tool: identifierSchema,
    requiredActorId: z.string().trim().min(2).max(200),
    requiredUserSid: windowsSidSchema,
    requiredDeviceCertificateThumbprint: certificateThumbprintSchema,
    issuedAt: isoDateTimeSchema,
    notBefore: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
    leaseExpiresAt: isoDateTimeSchema,
    freshnessWindowSeconds: z.number().int().min(60).max(86_400),
    nonce: base64UrlSchema,
    invocationKey: z.string().trim().min(8).max(500),
    input: jsonObjectSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const issuedAt = Date.parse(value.issuedAt);
    const notBefore = Date.parse(value.notBefore);
    const expiresAt = Date.parse(value.expiresAt);
    const leaseExpiresAt = Date.parse(value.leaseExpiresAt);
    if (notBefore < issuedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notBefore'],
        message: 'notBefore cannot precede issuedAt',
      });
    }
    if (expiresAt <= notBefore) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'expiresAt must follow notBefore',
      });
    }
    if (leaseExpiresAt <= notBefore || leaseExpiresAt > expiresAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leaseExpiresAt'],
        message: 'leaseExpiresAt must follow notBefore and cannot exceed expiresAt',
      });
    }
    if (expiresAt - issuedAt > value.freshnessWindowSeconds * 1_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiresAt'],
        message: 'The signed work order cannot outlive its freshness window',
      });
    }
  });

export const signedWorkOrderEnvelopeSchema = z
  .object({
    algorithm: z.literal('RS256'),
    keyId: z.string().trim().min(8).max(200),
    payloadBase64Url: base64UrlSchema,
    signatureBase64Url: base64UrlSchema,
  })
  .strict();

export const workstationDualIdentityHandshakeSchema = z
  .object({
    workOrderId: uuidSchema,
    leaseId: uuidSchema,
    nonce: base64UrlSchema,
    actorId: z.string().trim().min(2).max(200),
    userSid: windowsSidSchema,
    userProofKind: z.enum(['fixture_oidc', 'entra_wam']),
    userAccessToken: z.string().min(32).max(32_768),
    deviceCertificateThumbprint: certificateThumbprintSchema,
    deviceChallengeSignatureBase64Url: base64UrlSchema,
  })
  .strict();

export const workstationUserPresenceHandshakeSchema = workstationDualIdentityHandshakeSchema
  .omit({
    deviceCertificateThumbprint: true,
    deviceChallengeSignatureBase64Url: true,
  })
  .strict();

export const verifiedDualIdentityBindingSchema = z
  .object({
    workOrderId: uuidSchema,
    leaseId: uuidSchema,
    nonce: base64UrlSchema,
    actorId: z.string().trim().min(2).max(200),
    userSid: windowsSidSchema,
    deviceCertificateThumbprint: certificateThumbprintSchema,
    userTokenDigest: sha256Schema,
    deviceProofDigest: sha256Schema,
    verifiedAt: isoDateTimeSchema,
    verifier: z.enum(['fixture', 'control_plane']),
  })
  .strict();

export const workstationExpirationDigestItemSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(500),
    runId: uuidSchema,
    occurredAt: isoDateTimeSchema,
    message: z.literal('A workstation run expired while waiting for you to sign in.'),
    lateEffectsPerformed: z.literal(false),
  })
  .strict();

export type WorkstationRequirement = z.infer<typeof workstationRequirementSchema>;
export type WorkstationPlacementRequest = z.infer<typeof workstationPlacementRequestSchema>;
export type WorkstationRunSnapshot = z.infer<typeof workstationRunSnapshotSchema>;
export type WorkstationWorkOrderPayload = z.infer<typeof workstationWorkOrderPayloadSchema>;
export type SignedWorkOrderEnvelope = z.infer<typeof signedWorkOrderEnvelopeSchema>;
export type WorkstationDualIdentityHandshake = z.infer<
  typeof workstationDualIdentityHandshakeSchema
>;
export type WorkstationUserPresenceHandshake = z.infer<
  typeof workstationUserPresenceHandshakeSchema
>;
export type VerifiedDualIdentityBinding = z.infer<typeof verifiedDualIdentityBindingSchema>;
export type WorkstationExpirationDigestItem = z.infer<typeof workstationExpirationDigestItemSchema>;
