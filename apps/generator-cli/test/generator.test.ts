import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentManifestSchema, generatorProgressSchema } from '@agent-builder/contracts';
import { executeCli, parseArguments, runCli } from '../src/cli.js';
import { composeManifest, GENERATOR_VERSION } from '../src/generator.js';

const fixedDate = new Date('2026-07-31T12:00:00.000Z');

function validInput() {
  const agentId = randomUUID();
  const specId = randomUUID();
  return {
    agentId,
    spec: {
      id: specId,
      agentId,
      baseAgentId: null,
      status: 'ready' as const,
      revision: 4,
      outcomes: {
        name: 'Supplier Risk Analyst',
        department: 'Supply Chain',
        purpose:
          'Identify builds affected by supplier delays and prepare a cited escalation brief.',
        audience: 'Program managers',
        desiredOutcomes: ['Identify affected builds', 'Prepare a cited escalation brief'],
        humanBaseline: 'A manual two-hour investigation',
        exclusions: ['Never place or cancel purchase orders'],
      },
      knowledge: {
        sources: [
          {
            descriptorId: 'bq-operations-build-overview',
            purpose: 'Authoritative build status',
            requiredCitations: true,
          },
        ],
      },
      guardrails: {
        workflowStages: ['Validate request', 'Gather evidence', 'Draft escalation'],
        prohibitedActions: ['Change supplier commitments'],
        approvalRequirements: ['Program manager approval before notification'],
        failClosedConditions: ['Authoritative sources disagree'],
        responseRequirements: {
          citations: true,
          confidence: true,
          unresolvedConflicts: true,
        },
      },
      outputs: {
        outputType: 'decision_brief' as const,
        outputSchema: { supplier: 'string', affectedBuilds: ['string'] },
        successMetrics: [
          { name: 'Impacted build recall', operator: 'gte' as const, threshold: 0.98, unit: null },
        ],
        acceptanceTests: [
          {
            name: 'Known supplier delay',
            input: { supplier: 'ACME' },
            expectedResult: { affectedBuilds: ['BUILD-1'] },
          },
        ],
      },
    },
  };
}

describe('generator CLI', () => {
  it('composes a contract-valid deterministic manifest', () => {
    const input = validInput();
    const manifest = composeManifest(input, fixedDate);

    expect(agentManifestSchema.parse(manifest)).toEqual(manifest);
    expect(manifest.generatorVersion).toBe(GENERATOR_VERSION);
    expect(manifest.generatedAt).toBe(fixedDate.toISOString());
    expect(manifest.knowledgeSourceIds).toEqual(['bq-operations-build-overview']);
  });

  it('writes the manifest and emits parseable progress', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-builder-cli-'));
    const inputPath = join(directory, 'input.json');
    const outputPath = join(directory, 'output.json');
    await writeFile(inputPath, JSON.stringify(validInput()), 'utf8');
    const lines: string[] = [];

    await executeCli(
      { inputPath, outputPath },
      { stdout: (line) => lines.push(line), stderr: jest.fn() },
      fixedDate,
    );

    const output: unknown = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(agentManifestSchema.parse(output).generatedAt).toBe(fixedDate.toISOString());
    expect(lines.map((line) => generatorProgressSchema.parse(JSON.parse(line)).progress)).toEqual([
      10, 35, 70, 100,
    ]);
  });

  it('rejects missing arguments and matching paths', () => {
    expect(() => parseArguments([])).toThrow('Usage');
    expect(() => parseArguments(['--input', 'same.json', '--output', 'same.json'])).toThrow(
      'must be different',
    );
  });

  it('returns a non-zero exit code for malformed input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-builder-cli-'));
    const inputPath = join(directory, 'input.json');
    const outputPath = join(directory, 'output.json');
    await writeFile(inputPath, '{not json', 'utf8');
    const errors: string[] = [];

    const code = await runCli(['--input', inputPath, '--output', outputPath], {
      stdout: jest.fn(),
      stderr: (line) => errors.push(line),
    });

    expect(code).toBe(1);
    expect(JSON.parse(errors[0] ?? '{}')).toMatchObject({ code: 'GENERATOR_FAILED' });
  });
});
