import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { JoseProductionOidcVerifier } from '../dist/identity-auth.js';

const issuer = 'https://identity.example.test/tenant';
const audience = 'paul-os-control-plane';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: 'jwk' });
const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture-key' })).toString(
  'base64url',
);
const payload = Buffer.from(
  JSON.stringify({
    iss: issuer,
    aud: audience,
    sub: 'opaque-jwks-subject',
    iat: Math.floor(Date.now() / 1000) - 1,
    exp: Math.floor(Date.now() / 1000) + 60,
    groups: ['observed-only-group'],
  }),
).toString('base64url');
const signingInput = `${header}.${payload}`;
const token = `${signingInput}.${sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url')}`;

const originalFetch = globalThis.fetch;
globalThis.fetch = async () =>
  new Response(
    JSON.stringify({ keys: [{ ...publicJwk, kid: 'fixture-key', alg: 'RS256', use: 'sig' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
try {
  const verified = await new JoseProductionOidcVerifier().verify(token, {
    issuer,
    audiences: [audience],
    jwksUri: `${issuer}/keys`,
    algorithms: ['RS256'],
    clockToleranceSeconds: 60,
    subjectClaim: 'sub',
    groupClaim: 'groups',
  });
  assert.deepEqual(verified, {
    issuer,
    subject: 'opaque-jwks-subject',
    groups: ['observed-only-group'],
  });
} finally {
  globalThis.fetch = originalFetch;
}
