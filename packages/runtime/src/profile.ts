import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';
import { parseDocument } from 'yaml';
import { jsonObjectSchema } from '@agent-builder/contracts';
import { canonicalJson, sha256 } from './compiler.js';
import type { ContextLayer } from './context-assembly.js';

export const profileSchema = z.object({
  apiVersion: z.literal('paul-os/v1'),
  kind: z.literal('Profile'),
  metadata: z.object({
    id: z.string().uuid(),
    displayName: z.string().trim().min(1).max(160),
    timezone: z.string().trim().min(1).max(100),
  }),
  context: jsonObjectSchema.default({}),
  secretReferences: z.record(z.string().trim().min(1)).default({}),
});

const encryptedProfileSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal('aes-256-gcm+scrypt'),
  salt: z.string(),
  iv: z.string(),
  tag: z.string(),
  ciphertext: z.string(),
});

export function parseProfileText(source: string): z.infer<typeof profileSchema> {
  const document = parseDocument(source, { schema: 'core', uniqueKeys: true, strict: true });
  if (document.errors.length > 0) {
    throw new Error(`Invalid profile: ${document.errors.map((error) => error.message).join('; ')}`);
  }
  return profileSchema.parse(document.toJS({ maxAliasCount: 20 }));
}

/**
 * Loads only the profile's validated context values. Secret references and the filesystem path are
 * deliberately excluded from the returned layer so callers cannot accidentally send or log them.
 * A missing profile is an allowed single-user bootstrap state; unreadable or invalid profiles fail
 * closed with a sanitized error.
 */
export async function loadPrivateProfileLayer(profilePath: string): Promise<ContextLayer | null> {
  try {
    const [source, metadata] = await Promise.all([
      readFile(profilePath, 'utf8'),
      stat(profilePath),
    ]);
    const profile = parseProfileText(source);
    return {
      source: 'private_profile',
      values: profile.context,
      provenance: {
        origin: 'private-profile',
        resourceVersionId: profile.metadata.id,
        digest: sha256(canonicalJson(profile.context)),
        observedAt: metadata.mtime.toISOString(),
        classification: 'private',
      },
    };
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw new Error('Private profile could not be loaded or validated');
  }
}

async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  if (passphrase.length < 12)
    throw new Error('Profile backup passphrase must be at least 12 characters');
  return new Promise((resolve, reject) => {
    scryptCallback(
      passphrase,
      salt,
      32,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

export async function encryptProfile(profile: unknown, passphrase: string): Promise<string> {
  const parsed = profileSchema.parse(profile);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(passphrase, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(parsed), 'utf8'), cipher.final()]);
  return JSON.stringify({
    version: 1,
    algorithm: 'aes-256-gcm+scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  });
}

export async function decryptProfile(archive: string, passphrase: string): Promise<unknown> {
  const payload = encryptedProfileSchema.parse(JSON.parse(archive) as unknown);
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const key = await deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return profileSchema.parse(JSON.parse(plaintext) as unknown);
}
