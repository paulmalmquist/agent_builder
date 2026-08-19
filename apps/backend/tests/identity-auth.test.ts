import { createHmac } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { productionOidcConfigSchema } from '@agent-builder/contracts';
import type { AppError } from '../src/errors.js';
import {
  createFixtureOidcToken,
  type AuthenticationAdapterOptions,
  type IdentityDirectory,
  type ProductionOidcVerifier,
} from '../src/identity-auth.js';
import { currentRequestPrincipal, requestContextMiddleware } from '../src/request-context.js';

const fixtureSecret = 'fixture-only-oidc-secret-000000000000';
const resolvedPrincipal = {
  principalId: '10000000-0000-4000-8000-000000000001',
  actorId: 'human:directory-owned-identity',
  workspaceId: '20000000-0000-4000-8000-000000000002',
  departmentId: '30000000-0000-4000-8000-000000000003',
  authentication: 'fixture_oidc' as const,
  roles: ['builder' as const],
};

function directory() {
  const resolveExternal = jest.fn().mockResolvedValue(resolvedPrincipal);
  const identityDirectory: IdentityDirectory = {
    resolveExternal,
  };
  return { identityDirectory, resolveExternal };
}

function appFor(
  auth: Parameters<typeof requestContextMiddleware>[0],
  options: AuthenticationAdapterOptions = {},
) {
  const app = express();
  app.use(requestContextMiddleware(auth, options));
  app.get('/v1/session-probe', (_request, response) => response.json(currentRequestPrincipal()));
  const errors: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    void next;
    const appError = error as AppError;
    response.status(appError.status ?? 500).json({ code: appError.code ?? 'INTERNAL_ERROR' });
  };
  app.use(errors);
  return app;
}

function signRawFixturePayload(payload: unknown): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', fixtureSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function nonCanonicalSignatureAlias(token: string): string {
  const [encoded, signature] = token.split('.');
  if (encoded === undefined || signature === undefined) throw new Error('Expected fixture token');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const finalCharacter = signature.at(-1);
  const canonicalIndex = finalCharacter === undefined ? -1 : alphabet.indexOf(finalCharacter);
  if (canonicalIndex < 0 || canonicalIndex % 4 !== 0) {
    throw new Error('Expected a canonical SHA-256 base64url signature');
  }
  const aliasCharacter = alphabet[canonicalIndex + 1];
  if (aliasCharacter === undefined) throw new Error('Expected an equivalent signature alias');
  const alias = `${signature.slice(0, -1)}${aliasCharacter}`;
  if (!Buffer.from(alias, 'base64url').equals(Buffer.from(signature, 'base64url'))) {
    throw new Error('Expected alias to decode to the same signature bytes');
  }
  return `${encoded}.${alias}`;
}

describe('identity authentication adapters', () => {
  it('uses a fixture token only to prove issuer/subject and resolves authority from the directory', async () => {
    const { identityDirectory, resolveExternal } = directory();
    const token = createFixtureOidcToken(
      { exp: Math.floor(Date.now() / 1000) + 60, sub: 'opaque-fixture-subject' },
      fixtureSecret,
    );
    const response = await request(
      appFor(
        {
          enabled: true,
          mode: 'fixture_oidc',
          actorId: 'unused-fixture-actor',
          workspaceId: resolvedPrincipal.workspaceId,
          fixtureOidcSecret: fixtureSecret,
        },
        { identityDirectory },
      ),
    )
      .get('/v1/session-probe')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toMatchObject(resolvedPrincipal);
    expect(resolveExternal).toHaveBeenCalledWith({
      workspaceId: resolvedPrincipal.workspaceId,
      provider: 'fixture_oidc',
      authentication: 'fixture_oidc',
      identity: {
        issuer: 'urn:paul-os:fixture',
        subject: 'opaque-fixture-subject',
        groups: [],
      },
    });
  });

  it('rejects signed fixture attempts to forge workspace, department, or roles', async () => {
    const { identityDirectory, resolveExternal } = directory();
    const forged = signRawFixturePayload({
      iss: 'urn:paul-os:fixture',
      aud: 'paul-os-local',
      sub: 'opaque-fixture-subject',
      exp: Math.floor(Date.now() / 1000) + 60,
      workspaceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      departmentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      roles: ['admin'],
    });
    await request(
      appFor(
        {
          enabled: true,
          mode: 'fixture_oidc',
          actorId: 'unused-fixture-actor',
          fixtureOidcSecret: fixtureSecret,
        },
        { identityDirectory },
      ),
    )
      .get('/v1/session-probe')
      .set('authorization', `Bearer ${forged}`)
      .expect(401, { code: 'AUTHENTICATION_REQUIRED' });
    expect(resolveExternal).not.toHaveBeenCalled();
  });

  it('rejects tampering and expired fixture tokens', async () => {
    const { identityDirectory } = directory();
    const app = appFor(
      {
        enabled: true,
        mode: 'fixture_oidc',
        actorId: 'unused-fixture-actor',
        fixtureOidcSecret: fixtureSecret,
      },
      { identityDirectory },
    );
    const valid = createFixtureOidcToken(
      { exp: Math.floor(Date.now() / 1000) + 60, sub: 'opaque-fixture-subject' },
      fixtureSecret,
    );
    const tampered = `${valid[0] === 'A' ? 'B' : 'A'}${valid.slice(1)}`;
    await request(app)
      .get('/v1/session-probe')
      .set('authorization', `Bearer ${tampered}`)
      .expect(401, { code: 'AUTHENTICATION_REQUIRED' });
    const expired = createFixtureOidcToken(
      { exp: Math.floor(Date.now() / 1000) - 1, sub: 'opaque-fixture-subject' },
      fixtureSecret,
    );
    await request(app)
      .get('/v1/session-probe')
      .set('authorization', `Bearer ${expired}`)
      .expect(401, { code: 'AUTHENTICATION_REQUIRED' });
  });

  it('rejects a non-canonical signature encoding that decodes to valid HMAC bytes', async () => {
    const { identityDirectory, resolveExternal } = directory();
    const token = createFixtureOidcToken(
      { exp: Math.floor(Date.now() / 1000) + 60, sub: 'opaque-fixture-subject' },
      fixtureSecret,
    );
    await request(
      appFor(
        {
          enabled: true,
          mode: 'fixture_oidc',
          actorId: 'unused-fixture-actor',
          fixtureOidcSecret: fixtureSecret,
        },
        { identityDirectory },
      ),
    )
      .get('/v1/session-probe')
      .set('authorization', `Bearer ${nonCanonicalSignatureAlias(token)}`)
      .expect(401, { code: 'AUTHENTICATION_REQUIRED' });
    expect(resolveExternal).not.toHaveBeenCalled();
  });

  it('fails closed by default and resolves injected verifier output through DB authority', async () => {
    const oidc = productionOidcConfigSchema.parse({
      issuer: 'https://identity.example.test/tenant',
      audiences: ['paul-os-control-plane'],
      jwksUri: 'https://identity.example.test/tenant/keys',
    });
    const auth = {
      enabled: true,
      mode: 'oidc' as const,
      actorId: 'unused-oidc-actor',
      workspaceId: resolvedPrincipal.workspaceId,
      oidc,
    };
    await request(appFor(auth, { identityDirectory: directory().identityDirectory }))
      .get('/v1/session-probe')
      .set('authorization', 'Bearer structurally-opaque-token')
      .expect(503, { code: 'OIDC_VERIFIER_UNAVAILABLE' });

    const verifier: ProductionOidcVerifier = {
      verify: jest.fn().mockResolvedValue({
        issuer: oidc.issuer,
        subject: 'opaque-subject',
        groups: ['forged-admin-group'],
      }),
    };
    const { identityDirectory, resolveExternal } = directory();
    const accepted = await request(
      appFor(auth, { identityDirectory, productionVerifier: verifier }),
    )
      .get('/v1/session-probe')
      .set('authorization', 'Bearer verified-by-injected-adapter')
      .expect(200);
    expect(accepted.body.roles).toEqual(['builder']);
    expect(resolveExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({ groups: ['forged-admin-group'] }),
      }),
    );
  });
});
