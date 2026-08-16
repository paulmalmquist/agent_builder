import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DeterministicDailyBriefProvider,
  assertAcyclicDependencies,
  collectModelStream,
  compileResourceYaml,
  decryptProfile,
  encryptProfile,
  invalidDailyBriefCitations,
  parseProfileText,
  scoreDailyBriefQuality,
} from '@paul-os/runtime';
import {
  dailyBriefInputSchema,
  dailyBriefOutputSchema,
  repositoryImportRequestSchema,
  type ResourceManifest,
} from '@agent-builder/contracts';

const workspaceRoot = process.cwd().endsWith(path.join('apps', 'backend'))
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();

async function manifestPaths(): Promise<string[]> {
  const paths: string[] = [];
  for (let domain = 0; domain <= 12; domain += 1) {
    const prefix = domain.toString().padStart(2, '0');
    const directory = (await readdir(workspaceRoot, { withFileTypes: true })).find(
      (entry) => entry.isDirectory() && entry.name.startsWith(`${prefix}-`),
    );
    if (directory === undefined) continue;
    const domainPath = path.join(workspaceRoot, directory.name);
    for (const child of await readdir(domainPath, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const candidate = path.join(domainPath, child.name, 'manifest.yaml');
      try {
        await readFile(candidate, 'utf8');
        paths.push(candidate);
      } catch {
        // A content directory without a manifest is intentionally ignored.
      }
    }
  }
  return paths;
}

describe('Paul OS deterministic runtime', () => {
  it('compiles every tracked resource deterministically and verifies an acyclic graph', async () => {
    const paths = await manifestPaths();
    expect(paths).toHaveLength(13);
    const manifests: ResourceManifest[] = [];
    for (const manifestPath of paths) {
      const source = await readFile(manifestPath, 'utf8');
      const first = compileResourceYaml(source);
      const second = compileResourceYaml(source);
      expect(first.digest).toBe(second.digest);
      expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
      manifests.push(first.manifest);
    }
    expect(() => assertAcyclicDependencies(manifests)).not.toThrow();
  });

  it('rejects duplicate YAML keys and invalid skill contracts', () => {
    expect(() => compileResourceYaml('apiVersion: paul-os/v1\napiVersion: duplicate\n')).toThrow(
      /Invalid resource YAML/,
    );
    expect(() =>
      compileResourceYaml(`
apiVersion: paul-os/v1
kind: Skill
metadata:
  id: 00000000-0000-4000-8000-000000000001
  slug: invalid-skill
  version: 1.0.0
  owner: local-user
  purpose: This purpose is long enough to validate.
  lifecycle: candidate
  provenance: synthetic
dependencies: []
spec: {}
`),
    ).toThrow();
  });

  it('does not accept caller-asserted repository provenance', () => {
    expect(
      repositoryImportRequestSchema.safeParse({
        manifestYaml: 'apiVersion: paul-os/v1',
        sourcePath: null,
        sourceCommit: 'caller-asserted',
      }).success,
    ).toBe(false);
  });

  it('accepts only UUID improvement-candidate lineage and defaults it to no linkage', () => {
    expect(
      repositoryImportRequestSchema.parse({
        manifestYaml: 'apiVersion: paul-os/v1',
        sourcePath: null,
      }).improvementCandidateId,
    ).toBeNull();
    expect(
      repositoryImportRequestSchema.safeParse({
        manifestYaml: 'apiVersion: paul-os/v1',
        sourcePath: null,
        improvementCandidateId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });

  it('produces a schema-valid deterministic daily brief with usage', async () => {
    const provider = new DeterministicDailyBriefProvider();
    const result = await collectModelStream(provider, {
      system: 'fixture',
      input: {
        date: '2026-08-16',
        timezone: 'America/New_York',
        priorities: ['Finish the vertical slice'],
        calendarItems: [],
        tasks: ['Run verification'],
        signals: ['A test needs review'],
        userConstraints: [],
      },
      context: {},
      maxOutputTokens: 2000,
      timeoutMs: 5000,
    });
    expect(dailyBriefOutputSchema.parse(JSON.parse(result.text) as unknown).topPriorities).toEqual([
      'Finish the vertical slice',
    ]);
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it('keeps the runtime daily-brief limits aligned with the tracked manifest', () => {
    const input = {
      date: '2026-08-16',
      timezone: 'America/New_York',
      priorities: Array.from({ length: 20 }, (_, index) => `Priority ${index}`),
      calendarItems: [],
      tasks: [],
      signals: [],
      userConstraints: Array.from({ length: 20 }, (_, index) => `Constraint ${index}`),
    };
    expect(dailyBriefInputSchema.safeParse(input).success).toBe(true);
    expect(
      dailyBriefInputSchema.safeParse({
        ...input,
        priorities: [...input.priorities, 'One too many'],
      }).success,
    ).toBe(false);

    const output = {
      topPriorities: Array.from({ length: 5 }, (_, index) => `Priority ${index}`),
      scheduleRisks: [],
      decisionsRequired: [],
      proposedActions: Array.from({ length: 10 }, (_, index) => `Action ${index}`),
      citations: [],
      confidence: 1,
      unresolvedItems: [],
    };
    expect(dailyBriefOutputSchema.safeParse(output).success).toBe(true);
    expect(
      dailyBriefOutputSchema.safeParse({
        ...output,
        topPriorities: [...output.topPriorities, 'One too many'],
      }).success,
    ).toBe(false);
  });

  it('rejects invented daily-brief citations and scores objective coverage, not self-confidence', () => {
    const input = {
      date: '2026-08-16',
      timezone: 'America/New_York',
      priorities: ['Finish the vertical slice'],
      calendarItems: [
        {
          title: 'Architecture review',
          startsAt: '2026-08-16T14:00:00.000Z',
          endsAt: '2026-08-16T15:00:00.000Z',
        },
      ],
      tasks: ['Run verification'],
      signals: ['A test needs review'],
      userConstraints: [],
    };
    const output = {
      topPriorities: ['Finish the vertical slice'],
      scheduleRisks: [],
      decisionsRequired: ['Review the pending test'],
      proposedActions: ['Run verification'],
      citations: ['calendar:2026-08-16T14:00:00.000Z'],
      confidence: 0.01,
      unresolvedItems: [],
    };
    expect(invalidDailyBriefCitations(input, output)).toEqual([]);
    expect(scoreDailyBriefQuality(input, output)).toBe(1);
    expect(
      invalidDailyBriefCitations(input, {
        ...output,
        citations: ['calendar:invented-source'],
      }),
    ).toEqual(['calendar:invented-source']);
  });

  it('validates YAML profiles and encrypts backups with authenticated encryption', async () => {
    const profile = parseProfileText(`
apiVersion: paul-os/v1
kind: Profile
metadata:
  id: 00000000-0000-4000-8000-000000000002
  displayName: Example User
  timezone: America/New_York
context: {}
secretReferences: {}
`);
    const archive = await encryptProfile(profile, 'a-long-test-passphrase');
    await expect(decryptProfile(archive, 'a-long-test-passphrase')).resolves.toEqual(profile);
    await expect(decryptProfile(archive, 'the-wrong-passphrase')).rejects.toThrow();
    expect(archive).not.toContain('Example User');
  });
});
