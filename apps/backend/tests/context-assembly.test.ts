import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assembleContext, loadPrivateProfileLayer } from '@paul-os/runtime';

describe('context assembly', () => {
  it('uses fixed precedence while preserving monotonic denies and mandatory protocols', () => {
    const envelope = assembleContext([
      {
        source: 'request',
        values: { locale: 'fr', presentation: { density: 'compact' } },
        allow: ['read:calendar', 'write:production'],
        provenance: { origin: 'request:req-1' },
      },
      {
        source: 'core',
        values: { locale: 'en', presentation: { theme: 'instrument', density: 'calm' } },
        allow: ['read:calendar'],
        deny: ['write:production'],
        mandatoryProtocols: ['safe-execution@1.0.0'],
        provenance: { origin: 'resource:platform-safety@1.0.0', digest: 'core-digest' },
      },
      {
        source: 'project',
        values: { project: 'daily-operations', presentation: { density: 'focused' } },
        mandatoryProtocols: ['citation-required@1.0.0'],
        provenance: { origin: 'resource:daily-operations@1.0.0' },
      },
    ]);

    expect(envelope.values).toEqual({
      locale: 'fr',
      project: 'daily-operations',
      presentation: { theme: 'instrument', density: 'compact' },
    });
    expect(envelope.allow).toEqual(['read:calendar']);
    expect(envelope.deny).toEqual(['write:production']);
    expect(envelope.mandatoryProtocols).toEqual([
      'citation-required@1.0.0',
      'safe-execution@1.0.0',
    ]);
    expect(envelope.provenance.map(({ source }) => source)).toEqual(['core', 'project', 'request']);
    expect(envelope.provenance).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'core',
          classification: 'public',
          tokenContribution: expect.any(Number),
        }),
        expect.objectContaining({ source: 'request', classification: 'private' }),
      ]),
    );
    expect(envelope.classification).toBe('private');
    expect(envelope.estimatedTokens).toBeGreaterThan(0);
    expect(envelope.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('never lets a higher-precedence layer broaden an established allow list', () => {
    const envelope = assembleContext([
      {
        source: 'core',
        values: {},
        allow: ['read:calendar', 'read:tasks'],
        provenance: { origin: 'core' },
      },
      {
        source: 'project',
        values: {},
        allow: ['read:calendar', 'write:external'],
        provenance: { origin: 'project' },
      },
      {
        source: 'request',
        values: {},
        allow: ['read:calendar', 'write:production'],
        provenance: { origin: 'request' },
      },
    ]);

    expect(envelope.allow).toEqual(['read:calendar']);
  });

  it('is deterministic across object key and input layer order', () => {
    const first = assembleContext([
      {
        source: 'core',
        values: { alpha: 1, nested: { beta: true, alpha: false } },
        provenance: { origin: 'core' },
      },
      {
        source: 'request',
        values: { omega: 'last' },
        provenance: { origin: 'request' },
      },
    ]);
    const second = assembleContext([
      {
        source: 'request',
        values: { omega: 'last' },
        provenance: { origin: 'request' },
      },
      {
        source: 'core',
        values: { nested: { alpha: false, beta: true }, alpha: 1 },
        provenance: { origin: 'core' },
      },
    ]);

    expect(second.digest).toBe(first.digest);
  });

  it('rejects ambiguous duplicate layers and missing provenance', () => {
    expect(() =>
      assembleContext([
        { source: 'project', values: {}, provenance: { origin: 'one' } },
        { source: 'project', values: {}, provenance: { origin: 'two' } },
      ]),
    ).toThrow(/only once/);
    expect(() =>
      assembleContext([{ source: 'agent', values: {}, provenance: { origin: '  ' } }]),
    ).toThrow(/requires provenance/);
  });

  it('loads a private profile as sanitized provenance without secret references or path leakage', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'paul-os-profile-'));
    const profilePath = path.join(directory, 'profile.yaml');
    try {
      await writeFile(
        profilePath,
        `apiVersion: paul-os/v1
kind: Profile
metadata:
  id: 00000000-0000-4000-8000-000000000002
  displayName: Local User
  timezone: Etc/UTC
context:
  locale: en-US
  briefingPreferences:
    tone: concise
secretReferences:
  provider: env:PRIVATE_PROVIDER_TOKEN
`,
        'utf8',
      );
      const layer = await loadPrivateProfileLayer(profilePath);

      expect(layer).toMatchObject({
        source: 'private_profile',
        values: { locale: 'en-US', briefingPreferences: { tone: 'concise' } },
        provenance: {
          origin: 'private-profile',
          classification: 'private',
          observedAt: expect.any(String),
          digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      });
      expect(JSON.stringify(layer)).not.toContain('PRIVATE_PROVIDER_TOKEN');
      expect(JSON.stringify(layer)).not.toContain(profilePath);
      await expect(
        loadPrivateProfileLayer(path.join(directory, 'missing.yaml')),
      ).resolves.toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed without echoing an unreadable private profile path', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'paul-os-profile-'));
    const profilePath = path.join(directory, 'invalid-private-profile.yaml');
    try {
      await writeFile(profilePath, 'private material that is not a profile', 'utf8');
      await expect(loadPrivateProfileLayer(profilePath)).rejects.toThrow(
        'Private profile could not be loaded or validated',
      );
      await expect(loadPrivateProfileLayer(profilePath)).rejects.not.toThrow(profilePath);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
