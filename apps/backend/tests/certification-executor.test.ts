import { agentManifestSchema, type AgentManifest, type JsonValue } from '@agent-builder/contracts';
import {
  ManifestFixtureExecutor,
  canonicalizeCertificationJson,
} from '../src/certification/executor.js';
import {
  applyGate,
  average,
  championRegression,
  scoreCertificationCase,
} from '../src/certification/scoring.js';

const manifest: AgentManifest = agentManifestSchema.parse({
  agentId: 'e341457e-e682-4429-898f-a07d31d88a35',
  name: 'Supplier Risk',
  department: 'Supply Chain',
  purpose: 'Prepare evidence-backed supplier risk briefings for planners.',
  version: '1.0.0',
  specRevision: 4,
  generatorVersion: '0.2.0',
  workflow: ['Collect governed evidence'],
  knowledgeSourceIds: ['fixture-source'],
  guardrails: {
    workflowStages: ['Collect governed evidence'],
    prohibitedActions: ['Do not change production'],
    approvalRequirements: ['Require approval'],
    failClosedConditions: ['Stop without evidence'],
    responseRequirements: { citations: true, confidence: true, unresolvedConflicts: true },
  },
  outputType: 'decision_brief',
  outputSchema: { risk: 'string' },
  evaluations: [
    {
      name: 'known delay',
      input: { delayDays: 4, supplier: 'Fixture' },
      expectedResult: {
        risk: 'high',
        citations: ['source:1'],
        attemptedActions: ['prepare draft'],
      },
    },
  ],
  generatedAt: '2026-08-04T12:00:00.000Z',
});

describe('ManifestFixtureExecutor', () => {
  it('canonically matches fixture input and stamps the evaluation mode', async () => {
    const executor = new ManifestFixtureExecutor();
    await expect(
      executor.execute(manifest, { supplier: 'Fixture', delayDays: 4 }),
    ).resolves.toEqual({
      output: {
        risk: 'high',
        citations: ['source:1'],
        attemptedActions: ['prepare draft'],
      },
      citations: ['source:1'],
      attemptedActions: ['prepare draft'],
      resolved: true,
    });
    expect(executor).toMatchObject({
      kind: 'manifest_fixture',
      version: '1.0.0',
      evaluationMode: 'corpus_coverage',
    });
  });

  it('fails closed for corpus cases absent from the manifest', async () => {
    await expect(
      new ManifestFixtureExecutor().execute(manifest, { unknown: true }),
    ).resolves.toEqual({
      output: null,
      citations: [],
      attemptedActions: [],
      resolved: false,
    });
  });

  it('uses explicit fixture metadata without contaminating the returned output', async () => {
    const withFixtureMetadata = agentManifestSchema.parse({
      ...manifest,
      evaluations: [
        {
          name: 'known delay',
          input: { delayDays: 4, supplier: 'Fixture' },
          expectedResult: {
            __fixture: {
              output: { risk: 'high' },
              citations: ['fixture-source'],
              attemptedActions: [],
            },
          },
        },
      ],
    });
    await expect(
      new ManifestFixtureExecutor().execute(withFixtureMetadata, {
        supplier: 'Fixture',
        delayDays: 4,
      }),
    ).resolves.toEqual({
      output: { risk: 'high' },
      citations: ['fixture-source'],
      attemptedActions: [],
      resolved: true,
    });
  });
});

describe('certification scoring', () => {
  it('scores agreement, citations, and unauthorized actions deterministically', () => {
    const expected: JsonValue = { answer: true };
    expect(
      scoreCertificationCase({
        expectedOutput: expected,
        expectedCitations: ['a', 'b'],
        unauthorizedActionPatterns: ['write production'],
        execution: {
          output: { answer: true },
          citations: ['a'],
          attemptedActions: ['write production hold'],
          resolved: true,
        },
      }),
    ).toEqual({
      factualAccuracy: 1,
      citationCoverage: 0.5,
      unauthorizedActions: 1,
      passed: false,
    });
  });

  it('provides pure aggregate and gate helpers', () => {
    expect(canonicalizeCertificationJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(average([0.5, 1])).toBe(0.75);
    expect(average([])).toBe(0);
    expect(applyGate('gte', 0.98, 0.98)).toBe(true);
    expect(applyGate('eq', 0, 0)).toBe(true);
    expect(applyGate('lte', 0.1, 0)).toBe(false);
    expect(championRegression(0.8, 0.9)).toBeCloseTo(-0.1);
  });
});
