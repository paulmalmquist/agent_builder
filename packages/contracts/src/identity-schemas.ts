import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './schemas.js';

export const platformRoleSchema = z.enum(['consumer', 'builder', 'owner', 'admin']);
export type PlatformRoleValue = z.infer<typeof platformRoleSchema>;

export const authenticationKindSchema = z.enum([
  'local',
  'bearer',
  'fixture_oidc',
  'oidc',
  'system',
]);
export type AuthenticationKind = z.infer<typeof authenticationKindSchema>;

const uniqueRoleListSchema = z
  .array(platformRoleSchema)
  .max(4)
  .refine((roles) => new Set(roles).size === roles.length, 'Roles must be unique');

export const requestPrincipalSchema = z
  .object({
    principalId: uuidSchema,
    actorId: z.string().trim().min(2).max(200),
    workspaceId: uuidSchema,
    departmentId: uuidSchema.nullable(),
    authentication: authenticationKindSchema,
    roles: uniqueRoleListSchema,
    requestId: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();
export type RequestPrincipalContract = z.infer<typeof requestPrincipalSchema>;

export const platformPermissionSchema = z.enum([
  'catalog:read',
  'runs:execute',
  'builder:author',
  'evidence:review',
  'release:govern',
  'platform:administer',
]);

export const sessionResponseSchema = z
  .object({
    principal: requestPrincipalSchema,
    effectiveRoles: uniqueRoleListSchema,
    permissions: z.array(platformPermissionSchema).max(6),
    authorizationModel: z.literal('workspace-role-v1'),
  })
  .strict();
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const liveResponseSchema = z
  .object({
    status: z.literal('live'),
    timestamp: isoDateTimeSchema,
  })
  .strict();

export const readyResponseSchema = z
  .object({
    status: z.literal('ready'),
    dependencies: z.object({ postgresql: z.literal('connected') }).strict(),
    timestamp: isoDateTimeSchema,
  })
  .strict();

const httpsUrlSchema = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'OIDC endpoints must use HTTPS');

export const productionOidcConfigSchema = z
  .object({
    issuer: httpsUrlSchema,
    audiences: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
    jwksUri: httpsUrlSchema,
    algorithms: z.tuple([z.literal('RS256')]).default(['RS256']),
    clockToleranceSeconds: z.number().int().min(0).max(300).default(60),
    subjectClaim: z.literal('sub').default('sub'),
    groupClaim: z.string().trim().min(1).max(200).nullable().default(null),
  })
  .strict();
export type ProductionOidcConfig = z.infer<typeof productionOidcConfigSchema>;

const entraGroupRoleMappingSchema = z
  .object({
    groupObjectId: uuidSchema,
    role: platformRoleSchema,
    departmentId: uuidSchema.nullable(),
  })
  .strict()
  .superRefine((mapping, context) => {
    if (mapping.role === 'admin' && mapping.departmentId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['departmentId'],
        message: 'Admin mappings are workspace-scoped and cannot name a department',
      });
    }
    if (mapping.role !== 'admin' && mapping.departmentId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['departmentId'],
        message: 'Consumer, builder, and owner mappings require an exact department',
      });
    }
  });

/**
 * Proposal-only provisioning input. Runtime authorization always comes from persisted
 * ExternalIdentity and RoleBinding rows; token group claims never grant access directly.
 */
export const entraGroupMappingConfigSchema = z
  .object({
    schemaVersion: z.literal('entra-group-mapping/v1'),
    issuer: httpsUrlSchema,
    workspaceId: uuidSchema,
    mode: z.literal('provisioning_only'),
    authoritySource: z.literal('database_role_bindings'),
    mappings: z.array(entraGroupRoleMappingSchema).min(1).max(500),
  })
  .strict()
  .superRefine((config, context) => {
    const identities = config.mappings.map(
      (mapping) =>
        `${mapping.groupObjectId}:${mapping.role}:${mapping.departmentId ?? 'workspace'}`,
    );
    if (new Set(identities).size !== identities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mappings'],
        message: 'Group-to-role mappings must be unique',
      });
    }
  });
export type EntraGroupMappingConfig = z.infer<typeof entraGroupMappingConfigSchema>;

export const IDENTITY_OPENAPI_OPERATION_IDS = {
  live: 'getLiveness',
  ready: 'getReadiness',
  session: 'getCurrentSession',
} as const;
