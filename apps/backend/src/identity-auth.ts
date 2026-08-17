import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import {
  productionOidcConfigSchema,
  requestPrincipalSchema,
  type PlatformRoleValue,
  type ProductionOidcConfig,
  type RequestPrincipalContract,
} from '@agent-builder/contracts';
import { z } from 'zod';
import { AppError } from './errors.js';
import {
  ANONYMOUS_PRINCIPAL_ID,
  LOCAL_DEPARTMENT_ID,
  LOCAL_PRINCIPAL_ID,
  LOCAL_WORKSPACE_ID,
} from './scope-constants.js';

export type AuthenticationMode = 'local' | 'static_bearer' | 'fixture_oidc' | 'oidc';

export interface RuntimeAuthConfig {
  enabled: boolean;
  actorId: string;
  bearerToken?: string;
  mode?: AuthenticationMode;
  principalId?: string;
  workspaceId?: string;
  departmentId?: string | null;
  roles?: PlatformRoleValue[];
  fixtureOidcSecret?: string;
  oidc?: ProductionOidcConfig;
  oidcVerifier?: 'fail_closed' | 'jwks';
}

type PrincipalWithoutRequest = Omit<RequestPrincipalContract, 'requestId'>;

/** Token-derived identity facts. groups are observable input, never authorization authority. */
export interface VerifiedExternalIdentity {
  issuer: string;
  subject: string;
  groups: string[];
}

export interface ExternalIdentityResolution {
  workspaceId: string;
  provider: 'fixture_oidc' | 'oidc';
  authentication: 'fixture_oidc' | 'oidc';
  identity: VerifiedExternalIdentity;
}

/** Resolves issuer/subject to active DB-owned Principal, department, and RoleBindings. */
export interface IdentityDirectory {
  resolveExternal(input: ExternalIdentityResolution): Promise<PrincipalWithoutRequest>;
}

export interface ProductionOidcVerifier {
  verify(token: string, config: ProductionOidcConfig): Promise<VerifiedExternalIdentity>;
}

export class FailClosedProductionOidcVerifier implements ProductionOidcVerifier {
  verify(): Promise<VerifiedExternalIdentity> {
    return Promise.reject(
      new AppError(
        503,
        'OIDC_VERIFIER_UNAVAILABLE',
        'Production OIDC is configured but no approved verifier is enabled',
      ),
    );
  }
}

/** Standards-compatible JWT verification. Network/JWKS access occurs only when explicitly enabled. */
export class JoseProductionOidcVerifier implements ProductionOidcVerifier {
  async verify(token: string, config: ProductionOidcConfig): Promise<VerifiedExternalIdentity> {
    try {
      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      const keys = createRemoteJWKSet(new URL(config.jwksUri));
      const { payload } = await jwtVerify(token, keys, {
        issuer: config.issuer,
        audience: config.audiences,
        algorithms: config.algorithms,
        clockTolerance: config.clockToleranceSeconds,
      });
      if (typeof payload.iss !== 'string' || typeof payload.sub !== 'string') {
        throw new Error('OIDC token is missing issuer or subject');
      }
      const groupValue = config.groupClaim === null ? undefined : payload[config.groupClaim];
      const groups = Array.isArray(groupValue)
        ? groupValue.filter((entry): entry is string => typeof entry === 'string')
        : [];
      return { issuer: payload.iss, subject: payload.sub, groups };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'OIDC token verification failed');
    }
  }
}

const fixturePayloadSchema = z
  .object({
    iss: z.literal('urn:paul-os:fixture'),
    aud: z.literal('paul-os-local'),
    sub: z.string().trim().min(1).max(500),
    exp: z.number().int().positive(),
  })
  .strict();

export type FixtureOidcPayload = z.infer<typeof fixturePayloadSchema>;

function bearerToken(request: Request): string | null {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length);
  return token.length > 0 ? token : null;
}

function safeMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}

function localPrincipal(config: RuntimeAuthConfig, authentication: 'local' | 'bearer') {
  return requestPrincipalSchema.omit({ requestId: true }).parse({
    principalId: config.principalId ?? LOCAL_PRINCIPAL_ID,
    actorId: config.actorId,
    workspaceId: config.workspaceId ?? LOCAL_WORKSPACE_ID,
    departmentId: config.departmentId === undefined ? LOCAL_DEPARTMENT_ID : config.departmentId,
    authentication,
    roles: config.roles ?? ['admin'],
  });
}

export function anonymousPrincipal(): PrincipalWithoutRequest {
  return {
    principalId: ANONYMOUS_PRINCIPAL_ID,
    actorId: 'anonymous',
    workspaceId: LOCAL_WORKSPACE_ID,
    departmentId: null,
    authentication: 'local',
    roles: [],
  };
}

function fixtureSignature(encodedPayload: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(encodedPayload).digest();
}

export function createFixtureOidcToken(
  input: Omit<FixtureOidcPayload, 'iss' | 'aud'>,
  secret: string,
): string {
  if (secret.length < 32)
    throw new Error('Fixture OIDC secret must contain at least 32 characters');
  const payload = fixturePayloadSchema.parse({
    ...input,
    iss: 'urn:paul-os:fixture',
    aud: 'paul-os-local',
  });
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${fixtureSignature(encoded, secret).toString('base64url')}`;
}

function verifyFixtureToken(token: string, secret: string): VerifiedExternalIdentity {
  const [encoded, signature, extra] = token.split('.');
  if (encoded === undefined || signature === undefined || extra !== undefined) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Fixture OIDC token is malformed');
  }
  const providedSignature = Buffer.from(signature, 'base64url');
  const expectedSignature = fixtureSignature(encoded, secret);
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Fixture OIDC token signature is invalid');
  }
  let payload: FixtureOidcPayload;
  try {
    payload = fixturePayloadSchema.parse(
      JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown,
    );
  } catch {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Fixture OIDC token payload is invalid');
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Fixture OIDC token has expired');
  }
  return { issuer: payload.iss, subject: payload.sub, groups: [] };
}

export interface AuthenticationAdapter {
  authenticate(request: Request): Promise<PrincipalWithoutRequest>;
}

export interface AuthenticationAdapterOptions {
  identityDirectory?: IdentityDirectory;
  productionVerifier?: ProductionOidcVerifier;
}

function requiredDirectory(directory: IdentityDirectory | undefined): IdentityDirectory {
  if (directory === undefined) {
    throw new AppError(
      503,
      'IDENTITY_DIRECTORY_UNAVAILABLE',
      'External identity authentication requires the persisted identity directory',
    );
  }
  return directory;
}

export function createAuthenticationAdapter(
  config: RuntimeAuthConfig,
  options: AuthenticationAdapterOptions = {},
): AuthenticationAdapter {
  const mode = config.mode ?? (config.enabled ? 'static_bearer' : 'local');
  if (mode === 'local') {
    return { authenticate: () => Promise.resolve(localPrincipal(config, 'local')) };
  }
  if (mode === 'static_bearer') {
    return {
      authenticate: (request) => {
        const token = bearerToken(request);
        if (
          config.bearerToken === undefined ||
          token === null ||
          !safeMatch(token, config.bearerToken)
        ) {
          return Promise.reject(
            new AppError(
              401,
              'AUTHENTICATION_REQUIRED',
              'A valid bearer token is required for this route',
            ),
          );
        }
        return Promise.resolve(localPrincipal(config, 'bearer'));
      },
    };
  }
  if (mode === 'fixture_oidc') {
    if (config.fixtureOidcSecret === undefined) {
      throw new Error('Fixture OIDC mode requires a signing secret');
    }
    return {
      authenticate: async (request) => {
        const token = bearerToken(request);
        if (token === null) {
          throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'A fixture OIDC token is required');
        }
        const identity = verifyFixtureToken(token, config.fixtureOidcSecret as string);
        return requiredDirectory(options.identityDirectory).resolveExternal({
          workspaceId: config.workspaceId ?? LOCAL_WORKSPACE_ID,
          provider: 'fixture_oidc',
          authentication: 'fixture_oidc',
          identity,
        });
      },
    };
  }

  const oidcConfig = productionOidcConfigSchema.parse(config.oidc);
  const verifier =
    options.productionVerifier ??
    (config.oidcVerifier === 'jwks'
      ? new JoseProductionOidcVerifier()
      : new FailClosedProductionOidcVerifier());
  return {
    authenticate: async (request) => {
      const token = bearerToken(request);
      if (token === null) {
        throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'An OIDC bearer token is required');
      }
      const identity = await verifier.verify(token, oidcConfig);
      return requiredDirectory(options.identityDirectory).resolveExternal({
        workspaceId: config.workspaceId ?? LOCAL_WORKSPACE_ID,
        provider: 'oidc',
        authentication: 'oidc',
        identity,
      });
    },
  };
}
