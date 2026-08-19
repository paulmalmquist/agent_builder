import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DeterministicDailyBriefProvider,
  assertAcyclicDependencies,
  certifyConsoleCopyBundle,
  checkGovernedConsoleCopy,
  collectModelStream,
  compileResourceYaml,
  decryptProfile,
  discoverResourceManifestPaths,
  encryptProfile,
  evaluateConsoleCopy,
  evaluateSemanticColdRead,
  type ConsoleCopyArtifact,
  type ModelProvider,
  invalidDailyBriefCitations,
  parseProfileText,
  scoreDailyBriefQuality,
} from '@paul-os/runtime';
import {
  dailyBriefInputSchema,
  dailyBriefOutputSchema,
  consoleCriticalCopyArtifacts,
  repositoryImportRequestSchema,
  type ResourceManifest,
} from '@agent-builder/contracts';

const workspaceRoot = process.cwd().endsWith(path.join('apps', 'backend'))
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();

async function manifestPaths(): Promise<string[]> {
  return discoverResourceManifestPaths(workspaceRoot);
}

describe('Paul OS deterministic runtime', () => {
  it('compiles every tracked resource deterministically and verifies an acyclic graph', async () => {
    const paths = await manifestPaths();
    expect(paths.length).toBeGreaterThanOrEqual(15);
    const manifests: ResourceManifest[] = [];
    for (const manifestPath of paths) {
      const source = await readFile(manifestPath, 'utf8');
      const first = compileResourceYaml(source);
      const second = compileResourceYaml(source);
      expect(first.digest).toBe(second.digest);
      expect(first.digest).toMatch(/^[a-f0-9]{64}$/);
      manifests.push(first.manifest);
    }
    expect(manifests.map((manifest) => manifest.metadata.slug)).toEqual(
      expect.arrayContaining(['console-grammar', 'console-critical-copy']),
    );
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

  it('enforces credential-free cold-read and action-copy rules', async () => {
    const copyPath = path.join(
      workspaceRoot,
      '05-reference',
      'console-critical-copy',
      'fixtures',
      'copy.json',
    );
    const artifacts = JSON.parse(await readFile(copyPath, 'utf8')) as ConsoleCopyArtifact[];
    expect(checkGovernedConsoleCopy(consoleCriticalCopyArtifacts, artifacts)).toMatchObject({
      matches: true,
      reason: null,
    });
    expect(artifacts.length).toBeGreaterThanOrEqual(4);
    for (const artifact of artifacts) {
      expect(evaluateConsoleCopy(artifact)).toMatchObject({ passed: true, issues: [] });
    }

    const result = evaluateConsoleCopy({
      screen: 'unsafe-copy',
      introduction: ['The request was approved by a hidden policy.'],
      actions: [{ label: 'OK', consequence: '', undo: '' }],
    });
    expect(result.passed).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'missing_cold_read_line',
        'passive_voice',
        'unexplained_acronym',
        'missing_action_consequence',
        'missing_action_undo',
      ]),
    );
  });

  it('follows provider policy for semantic cold-read certification', async () => {
    const artifact: ConsoleCopyArtifact = {
      screen: 'approval',
      introduction: ['A run needs your decision.', 'Review its exact authority before acting.'],
      actions: [
        {
          label: 'Approve authority',
          consequence: 'Allows matching work inside these limits.',
          undo: 'Revoke the grant to stop later work.',
        },
      ],
    };
    const provider: ModelProvider = {
      kind: 'anthropic',
      version: 'test',
      model: 'semantic-test',
      async *stream() {
        await Promise.resolve();
        yield {
          type: 'text_delta',
          text: JSON.stringify({
            purpose: 'A run needs your decision.',
            happened: 'Review its exact authority.',
            actions: [{ label: 'Approve authority', consequence: 'Allows matching bounded work.' }],
          }),
        };
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 18 } };
        yield { type: 'complete', stopReason: 'end_turn' };
      },
    };
    await expect(evaluateSemanticColdRead(artifact, provider, 'direct_allowed')).resolves.toEqual(
      expect.objectContaining({ state: 'certified', providerKind: 'anthropic' }),
    );
    await expect(evaluateSemanticColdRead(artifact, provider, 'gateway_only')).resolves.toEqual(
      expect.objectContaining({ state: 'unavailable', reason: expect.stringMatching(/gateway/) }),
    );

    const contextBlindProvider: ModelProvider = {
      ...provider,
      async *stream() {
        await Promise.resolve();
        yield {
          type: 'text_delta',
          text: JSON.stringify({
            purpose: 'Show a generic screen.',
            happened: 'Something happened.',
            actions: [{ label: 'Approve authority', consequence: 'Changes a setting.' }],
          }),
        };
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 12 } };
        yield { type: 'complete', stopReason: 'end_turn' };
      },
    };
    await expect(
      evaluateSemanticColdRead(artifact, contextBlindProvider, 'direct_allowed'),
    ).resolves.toEqual(expect.objectContaining({ state: 'failed' }));

    const oneWordEchoProvider: ModelProvider = {
      ...provider,
      async *stream() {
        await Promise.resolve();
        yield {
          type: 'text_delta',
          text: JSON.stringify({
            purpose: 'Review a generic page.',
            happened: 'Authority appears somewhere.',
            actions: [{ label: 'Approve authority', consequence: 'Allows an unrelated change.' }],
          }),
        };
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 12 } };
        yield { type: 'complete', stopReason: 'end_turn' };
      },
    };
    await expect(
      evaluateSemanticColdRead(artifact, oneWordEchoProvider, 'direct_allowed'),
    ).resolves.toEqual(expect.objectContaining({ state: 'failed' }));

    const literalOneTokenProvider: ModelProvider = {
      ...provider,
      async *stream() {
        await Promise.resolve();
        yield {
          type: 'text_delta',
          text: JSON.stringify({
            purpose: 'run',
            happened: 'authority',
            actions: [{ label: 'Approve authority', consequence: 'allows' }],
          }),
        };
        yield { type: 'usage', usage: { inputTokens: 20, outputTokens: 6 } };
        yield { type: 'complete', stopReason: 'end_turn' };
      },
    };
    await expect(
      evaluateSemanticColdRead(artifact, literalOneTokenProvider, 'direct_allowed'),
    ).resolves.toEqual(expect.objectContaining({ state: 'failed' }));
  });

  it('certifies only the governed rendered copy bundle with a semantic provider', async () => {
    const copyPath = path.join(
      workspaceRoot,
      '05-reference',
      'console-critical-copy',
      'fixtures',
      'copy.json',
    );
    const governed: unknown = JSON.parse(await readFile(copyPath, 'utf8'));
    const provider: ModelProvider = {
      kind: 'anthropic',
      version: 'test-provider-v1',
      model: 'semantic-test',
      async *stream(request) {
        await Promise.resolve();
        const input = request.input as { screen: string };
        const source = consoleCriticalCopyArtifacts.find(({ screen }) => screen === input.screen);
        if (source === undefined) throw new Error('UNKNOWN_SCREEN');
        yield {
          type: 'text_delta',
          text: JSON.stringify({
            purpose: source.introduction[0],
            happened: source.introduction[1],
            actions: source.actions.map(({ label, consequence }) => ({ label, consequence })),
          }),
        };
        yield { type: 'usage', usage: { inputTokens: 40, outputTokens: 30 } };
        yield { type: 'complete', stopReason: 'end_turn' };
      },
    };

    const result = await certifyConsoleCopyBundle({
      artifacts: consoleCriticalCopyArtifacts,
      governedValue: governed,
      provider,
      providerPolicy: 'direct_allowed',
      now: new Date('2026-08-16T12:00:00.000Z'),
    });
    expect(result).toMatchObject({
      state: 'certified',
      governedCopy: { matches: true },
      providerKind: 'anthropic',
      providerVersion: 'test-provider-v1',
      certifiedAt: '2026-08-16T12:00:00.000Z',
    });
    expect(result.artifacts).toHaveLength(consoleCriticalCopyArtifacts.length);
    expect(result.artifacts.every(({ semantic }) => semantic.answerDigest !== null)).toBe(true);

    const drifted = structuredClone(consoleCriticalCopyArtifacts) as ConsoleCopyArtifact[];
    drifted[0] = {
      ...(drifted[0] as ConsoleCopyArtifact),
      introduction: ['This text drifted from the console.', 'It must not receive certification.'],
    };
    await expect(
      certifyConsoleCopyBundle({
        artifacts: consoleCriticalCopyArtifacts,
        governedValue: drifted,
        provider,
        providerPolicy: 'direct_allowed',
      }),
    ).resolves.toMatchObject({ state: 'failed', governedCopy: { matches: false } });

    await expect(
      certifyConsoleCopyBundle({
        artifacts: consoleCriticalCopyArtifacts,
        governedValue: governed,
        provider: new DeterministicDailyBriefProvider(),
        providerPolicy: 'direct_allowed',
      }),
    ).resolves.toMatchObject({ state: 'unavailable' });
  });
});
