import { evaluateReleaseContract } from '../src/release-governance/deterministic-evaluator.js';
import type { ResourceManifest } from '@agent-builder/contracts';

const skill: ResourceManifest = {
  apiVersion: 'paul-os/v1',
  kind: 'Skill',
  metadata: {
    id: '20000000-0000-4000-8000-000000000001',
    slug: 'daily-brief',
    version: '1.0.0',
    owner: 'test-owner',
    purpose: 'Create a deterministic, cited planning brief for a test fixture.',
    lifecycle: 'candidate',
    provenance: 'synthetic',
  },
  dependencies: [],
  spec: {
    inputSchema: { type: 'object', properties: { calendarItems: { type: 'array' } } },
    outputSchema: {
      type: 'object',
      required: ['scheduleRisks', 'citations'],
      properties: { scheduleRisks: { type: 'array' }, citations: { type: 'array' } },
    },
    tools: [],
    permissions: [],
    contextRequirements: [],
    successCriteria: ['Return a schema-valid result.'],
  },
};

const suite = {
  apiVersion: 'paul-os/v1',
  kind: 'EvaluationSuite',
  metadata: {
    id: '90000000-0000-4000-8000-000000000001',
    slug: 'daily-brief-contract',
    version: '1.0.0',
    owner: 'test-owner',
    purpose: 'Verify deterministic contract declarations without semantic quality claims.',
    lifecycle: 'candidate',
    provenance: 'synthetic',
  },
  dependencies: [],
  spec: {
    subject: 'daily-brief@1.0.0',
    executorKind: 'deterministic_contract',
    evaluationMode: 'contract_validation',
    corpusVersion: 1,
    cases: [
      {
        key: 'contract-shape',
        fixture: 'synthetic',
        assertions: [
          'output_schema_valid',
          'schedule_risk_present',
          'citations_resolve_to_supplied_calendar_items',
          'no_attempted_actions',
        ],
      },
    ],
    gates: {
      schemaConformance: 1,
      citationCoverage: 1,
      unauthorizedActions: 0,
      historical: {
        maxMeanCostUsd: 0.1,
        maxP95LatencyMs: 2_000,
        minMeanOutcomeQuality: 0.9,
        minSampleSize: 2,
        historyWindow: 20,
      },
    },
  },
};

describe('deterministic release contract evaluation', () => {
  it('passes a structurally complete, read-only subject and labels its evidence honestly', () => {
    const result = evaluateReleaseContract({
      suiteDefinition: suite,
      resources: [
        {
          id: skill.metadata.id,
          slug: skill.metadata.slug,
          version: skill.metadata.version,
          digest: 'a'.repeat(64),
          definition: skill,
        },
      ],
    });

    expect(result.verdict).toBe('passed');
    expect(result.gateScores).toEqual({
      schemaConformance: 1,
      citationCoverage: 1,
      unauthorizedActions: 0,
    });
    expect(result.evidence).toMatchObject({ subjectPresent: true, assertionCount: 4 });
    expect(result.gateResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'schema_conformance', status: 'passed', threshold: 1 }),
        expect.objectContaining({
          key: 'mean_cost_usd',
          status: 'not_applicable',
          measuredValue: null,
          sampleSize: 0,
        }),
        expect.objectContaining({
          key: 'p95_latency_ms',
          status: 'not_applicable',
        }),
        expect.objectContaining({
          key: 'mean_outcome_quality',
          status: 'not_applicable',
        }),
      ]),
    );
    expect(result.certifiedResourceIds).toEqual([skill.metadata.id]);
  });

  it('evaluates configured cost, latency, and outcome-history gates from real samples', () => {
    const result = evaluateReleaseContract({
      suiteDefinition: suite,
      resources: [
        {
          id: skill.metadata.id,
          slug: skill.metadata.slug,
          version: skill.metadata.version,
          digest: 'a'.repeat(64),
          definition: skill,
        },
      ],
      history: {
        costUsd: [0.03, 0.05],
        latencyMs: [1_200, 2_400],
        outcomeQuality: [0.92, 0.96],
      },
    });

    expect(result.verdict).toBe('failed');
    expect(result.gateResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'mean_cost_usd',
          measuredValue: 0.04,
          status: 'passed',
          sampleSize: 2,
        }),
        expect.objectContaining({
          key: 'p95_latency_ms',
          measuredValue: 2_400,
          status: 'failed',
          sampleSize: 2,
        }),
        expect.objectContaining({
          key: 'mean_outcome_quality',
          measuredValue: 0.94,
          status: 'passed',
          sampleSize: 2,
        }),
      ]),
    );
    expect(result.certifiedResourceIds).toEqual([]);
  });

  it('certifies only the declared subject and its complete exact dependency closure', () => {
    const reference: ResourceManifest = {
      apiVersion: 'paul-os/v1',
      kind: 'Reference',
      metadata: {
        id: '50000000-0000-4000-8000-000000000001',
        slug: 'briefing-principles',
        version: '1.0.0',
        owner: 'test-owner',
        purpose: 'Provide immutable fixture guidance for the evaluated skill.',
        lifecycle: 'candidate',
        provenance: 'synthetic',
      },
      dependencies: [],
      spec: {
        artifact: 'REFERENCE.md',
        mediaType: 'text/markdown',
        immutableAfterCandidate: true,
        citationLabel: 'briefing-principles-v1',
      },
    };
    const dependentSkill = structuredClone(skill);
    dependentSkill.dependencies = [
      { familyId: reference.metadata.id, version: reference.metadata.version },
    ];
    const subjectResource = {
      id: dependentSkill.metadata.id,
      slug: dependentSkill.metadata.slug,
      version: dependentSkill.metadata.version,
      digest: 'a'.repeat(64),
      definition: dependentSkill,
    };
    const referenceResource = {
      id: reference.metadata.id,
      slug: reference.metadata.slug,
      version: reference.metadata.version,
      digest: 'b'.repeat(64),
      definition: reference,
    };

    const complete = evaluateReleaseContract({
      suiteDefinition: suite,
      resources: [subjectResource, referenceResource],
    });
    expect(complete.verdict).toBe('passed');
    expect(complete.certifiedResourceIds).toEqual([subjectResource.id, referenceResource.id]);
    expect(complete.gateResults).toContainEqual(
      expect.objectContaining({ key: 'dependency_closure', status: 'passed' }),
    );

    const incomplete = evaluateReleaseContract({
      suiteDefinition: suite,
      resources: [subjectResource],
    });
    expect(incomplete.verdict).toBe('failed');
    expect(incomplete.certifiedResourceIds).toEqual([]);
    expect(incomplete.gateResults).toContainEqual(
      expect.objectContaining({ key: 'dependency_closure', status: 'failed' }),
    );
  });

  it('fails closed when the subject is absent or declares write authority', () => {
    const missing = evaluateReleaseContract({ suiteDefinition: suite, resources: [] });
    expect(missing.verdict).toBe('failed');
    expect(missing.certifiedResourceIds).toEqual([]);
    expect(missing.results[0]?.assertions.every(({ passed }) => !passed)).toBe(true);

    const authorityBearing = structuredClone(skill);
    authorityBearing.spec.permissions = ['records.write'];
    const unsafe = evaluateReleaseContract({
      suiteDefinition: suite,
      resources: [
        {
          id: authorityBearing.metadata.id,
          slug: authorityBearing.metadata.slug,
          version: authorityBearing.metadata.version,
          digest: 'b'.repeat(64),
          definition: authorityBearing,
        },
      ],
    });
    expect(unsafe.verdict).toBe('failed');
    expect(unsafe.gateScores.unauthorizedActions).toBe(1);
  });

  it('does not invent a passing score when a configured contract gate has no assertion evidence', () => {
    const missingCitationAssertion = structuredClone(suite);
    missingCitationAssertion.spec.cases[0]!.assertions = [
      'output_schema_valid',
      'no_attempted_actions',
    ];

    const result = evaluateReleaseContract({
      suiteDefinition: missingCitationAssertion,
      resources: [
        {
          id: skill.metadata.id,
          slug: skill.metadata.slug,
          version: skill.metadata.version,
          digest: 'a'.repeat(64),
          definition: skill,
        },
      ],
    });

    expect(result.verdict).toBe('failed');
    expect(result.gateScores.citationCoverage).toBe(0);
    expect(result.gateResults).toContainEqual(
      expect.objectContaining({
        key: 'citation_coverage',
        measuredValue: null,
        sampleSize: 0,
        status: 'failed',
      }),
    );
  });
});
