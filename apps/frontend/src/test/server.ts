import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { InterpretationConfirmation } from '@agent-builder/contracts';

const agentId = '11111111-1111-4111-8111-111111111111';
const familyId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const specId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
const deploymentId = '44444444-4444-4444-8444-444444444444';
const testId = '55555555-5555-4555-8555-555555555555';
export const certificationRunId = '66666666-6666-4666-8666-666666666666';
const corpusVersionId = '77777777-7777-4777-8777-777777777777';
const gateConfigId = '88888888-8888-4888-8888-888888888888';
export const interpretationId = '99999999-9999-4999-8999-999999999999';
const now = '2026-07-31T14:00:00.000Z';
type TestInterpretationConfirmation = InterpretationConfirmation;
export let lastOutcomesConfirmation: TestInterpretationConfirmation | null = null;
export let lastKnowledgeConfirmation: TestInterpretationConfirmation | null = null;

const outcomes = {
  name: 'Supplier continuity analyst',
  department: 'Manufacturing Operations',
  purpose:
    'Monitor supplier delays, connect them to affected builds, and draft an evidence-backed escalation brief.',
  audience: 'Supply planners and program managers',
  desiredOutcomes: ['Identify at-risk builds'],
  humanBaseline: 'A planner reconciles reports in 45 minutes.',
  exclusions: ['Changing purchase orders'],
};

const guardrails = {
  workflowStages: ['Retrieve governed evidence', 'Draft the requested output'],
  prohibitedActions: [],
  approvalRequirements: [],
  failClosedConditions: ['Stop when a required source is unavailable'],
  responseRequirements: {
    citations: true,
    confidence: true,
    unresolvedConflicts: true,
  },
};

const outputs = {
  outputType: 'investigation_report' as const,
  outputSchema: {
    type: 'object',
    required: ['summary', 'citations'],
    properties: {
      summary: { type: 'string' },
      citations: { type: 'array' },
    },
  },
  successMetrics: [
    { name: 'Evidence coverage', operator: 'gte' as const, threshold: 0.9, unit: 'ratio' },
  ],
  acceptanceTests: [
    {
      name: 'Produces a governed answer',
      input: { request: 'Summarize the highest-priority case' },
      expectedResult: { includesCitations: true },
    },
  ],
};

const source = {
  id: 'relativity-mes-genealogy',
  role: 'knowledge' as const,
  provider: 'bigquery' as const,
  displayName: 'Build genealogy',
  uri: 'bigquery://agent-builder-demo/relativity_mes/gold_genealogy',
  authority: 'system_of_record' as const,
  owner: 'Manufacturing Data',
  region: 'US',
  lastRefreshed: now,
  citationRequired: true,
  readOnly: true,
  synthetic: true,
  metadata: {},
};

export const catalogAgent = {
  id: agentId,
  familyId,
  familySlug: 'supplier-risk-analyst',
  slug: 'supplier-risk-analyst-v1',
  versionNumber: 1,
  predecessorAgentId: null,
  derivationMode: 'new' as const,
  name: 'Supplier Risk Analyst',
  department: 'Supply Chain',
  purpose: 'Monitors supplier delays, identifies impacted builds, and drafts escalation briefs.',
  owner: 'Supply Operations',
  status: 'ready' as const,
  capabilities: ['supplier risk', 'build impact', 'escalation drafting'],
  manifest: null,
  manifestHash: null,
  certificationHealth: 'not_certified' as const,
  degradedAt: null,
  degradationReason: null,
  isChampion: false,
  providers: ['bigquery'] as const,
  createdAt: now,
  updatedAt: now,
};

export const certificationRun = {
  id: certificationRunId,
  agentVersionId: agentId,
  familyId,
  championVersionId: null,
  kind: 'challenger' as const,
  originStatus: 'shadow' as const,
  state: 'passed' as const,
  corpusVersionId,
  corpusVersion: 3,
  gateConfigId,
  gateConfigVersion: 2,
  subjectManifestHash: 'sha256:challenger-manifest',
  championManifestHash: null,
  specRevision: 4,
  generatorVersion: '0.2.0',
  executorKind: 'manifest_fixture' as const,
  executorVersion: '1.0.0',
  evaluationMode: 'corpus_coverage' as const,
  progress: 100,
  message: 'Coverage certification passed',
  caseCounts: { total: 1, passed: 1, failed: 0 },
  verdict: 'passed' as const,
  error: null,
  requestedBy: 'test-approver',
  startedBy: 'certification-dispatcher',
  requestedAt: now,
  startedAt: now,
  finishedAt: now,
  promotionExpiresAt: '2026-08-01T14:00:00.000Z',
  isPromotionEvidence: false,
  resultsAvailability: 'full' as const,
  caseResultsPrunedAt: null,
};

export const certificationDetail = {
  run: certificationRun,
  subject: {
    agentVersionId: agentId,
    name: catalogAgent.name,
    versionNumber: 1,
    lifecycleStatus: 'certified' as const,
    manifestHash: certificationRun.subjectManifestHash,
  },
  champion: null,
  gates: [
    {
      gate: 'factual_accuracy' as const,
      operator: 'gte' as const,
      threshold: 0.98,
      championScore: null,
      challengerScore: 1,
      measuredValue: 1,
      status: 'passed' as const,
      details: {},
    },
    {
      gate: 'citation_coverage' as const,
      operator: 'eq' as const,
      threshold: 1,
      championScore: null,
      challengerScore: 1,
      measuredValue: 1,
      status: 'passed' as const,
      details: {},
    },
    {
      gate: 'unauthorized_actions' as const,
      operator: 'eq' as const,
      threshold: 0,
      championScore: null,
      challengerScore: 0,
      measuredValue: 0,
      status: 'passed' as const,
      details: {},
    },
    {
      gate: 'champion_regression' as const,
      operator: 'lte' as const,
      threshold: 0,
      championScore: null,
      challengerScore: null,
      measuredValue: null,
      status: 'not_applicable' as const,
      details: {},
    },
  ],
  results: {
    items: [
      {
        id: 'abababab-abab-4bab-8bab-abababababab',
        runId: certificationRunId,
        caseId: 'bcbcbcbc-bcbc-4cbc-8cbc-bcbcbcbcbcbc',
        caseKey: 'supplier-delay-golden',
        caseName: 'Supplier delay evidence brief',
        tags: ['golden' as const],
        input: { request: 'Summarize the highest-priority supplier delay' },
        expectedOutput: { includesCitations: true },
        expectedCitations: ['build-genealogy:123'],
        championOutput: null,
        challengerOutput: { includesCitations: true },
        championCitations: [],
        challengerCitations: ['build-genealogy:123'],
        championActions: [],
        challengerActions: [],
        scoreBreakdown: { factual_accuracy: 1, citation_coverage: 1 },
        diff: { changed: true },
        passed: true,
        createdAt: now,
      },
    ],
    nextCursor: null,
  },
  promotionEligibility: {
    eligible: true,
    freshUntil: '2026-08-01T14:00:00.000Z',
    blockers: [],
  },
};

type SpecFixture = {
  id: string;
  agentId: string;
  baseAgentId: string | null;
  derivationMode: 'new' | 'configure' | 'extend';
  interpretationId: string | null;
  unconfirmedPrefill: null;
  status: 'draft' | 'ready';
  revision: number;
  outcomes: typeof outcomes | null;
  knowledge: {
    sources: Array<{ descriptorId: string; purpose: string; requiredCitations: boolean }>;
  } | null;
  guardrails: typeof guardrails | null;
  outputs: typeof outputs | null;
  completion: {
    outcomes: boolean;
    knowledge: boolean;
    guardrails: boolean;
    outputs: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

let specFixture: SpecFixture | null = null;

export function resetFixtures() {
  specFixture = null;
  lastOutcomesConfirmation = null;
  lastKnowledgeConfirmation = null;
}

function requireSpec() {
  if (!specFixture) throw new Error('Test expected a spec fixture.');
  return specFixture;
}

export const handlers = [
  http.get('http://localhost/agents', ({ request }) => {
    const params = new URL(request.url).searchParams;
    const query = params.get('query') ?? '';
    if (params.get('familyId')) {
      return HttpResponse.json({
        mode: 'family_versions',
        familyId,
        nextCursor: null,
        items: [catalogAgent],
      });
    }
    return HttpResponse.json({
      mode: 'catalog',
      query,
      nextCursor: null,
      items: [
        {
          ...catalogAgent,
          score: query ? 87 : 82,
          reuseRecommended: true,
          matchedCapabilities: ['supplier risk', 'build impact'],
          gaps: ['custom approval path'],
        },
      ],
    });
  }),

  http.post('http://localhost/agents/similarity', async ({ request }) => {
    const body = (await request.json()) as { query: string };
    return HttpResponse.json({
      query: body.query,
      matches: [
        {
          agentId,
          score: 87,
          reuseRecommended: true,
          reasons: ['shared supplier and build-impact workflow'],
          gaps: ['custom approval path'],
        },
      ],
    });
  }),

  http.get(`http://localhost/agents/${agentId}`, () => HttpResponse.json(catalogAgent)),

  http.post('http://localhost/agents/specs/interpret', async ({ request }) => {
    const body = (await request.json()) as { kind: string; prompt?: string };
    const asksForWrite = body.prompt?.toLocaleLowerCase().includes('write') ?? false;
    const mentionsUnknownErp = body.prompt?.toLocaleLowerCase().includes('our erp') ?? false;
    return HttpResponse.json({
      kind: 'prefill',
      interpretationId,
      parentInterpretationId: null,
      expiresAt: '2026-08-01T14:00:00.000Z',
      sections: {
        outcomes: { value: outcomes, confidence: 'high', needsReview: true, unresolved: [] },
        knowledge: {
          value: {
            sources: [
              {
                descriptorId: source.id,
                purpose: 'Trace delayed supply to affected builds',
                requiredCitations: true,
              },
            ],
          },
          confidence: 'medium',
          needsReview: true,
          unresolved: mentionsUnknownErp
            ? [
                {
                  id: 'unknown-source-erp',
                  section: 'knowledge',
                  kind: 'source',
                  input: 'our ERP',
                  message: 'Map this reference to a governed descriptor or remove it.',
                  descriptorCandidates: [],
                },
              ]
            : [],
        },
        guardrails: {
          value: asksForWrite
            ? {
                ...guardrails,
                approvalRequirements: ['Human approval required before production writes'],
              }
            : guardrails,
          confidence: asksForWrite ? 'low' : 'medium',
          needsReview: true,
          unresolved: [],
        },
        outputs: { value: outputs, confidence: 'medium', needsReview: true, unresolved: [] },
      },
      authorityWarnings: asksForWrite
        ? [
            {
              requestedAction: 'write to production',
              disposition: 'approval_required',
              message: 'Production writes require explicit human approval.',
            },
          ]
        : [],
      reuseQuery: outcomes.purpose,
    });
  }),

  http.get(`http://localhost/agents/${agentId}/certification-runs`, () =>
    HttpResponse.json({ items: [certificationRun], nextCursor: null }),
  ),

  http.post(`http://localhost/agents/${agentId}/certification-runs`, () =>
    HttpResponse.json(
      {
        runId: certificationRunId,
        agentVersionId: agentId,
        state: 'queued',
        corpusVersion: 3,
        gateConfigVersion: 2,
        executorKind: 'manifest_fixture',
        executorVersion: '1.0.0',
        evaluationMode: 'corpus_coverage',
        statusUrl: `/agents/certification-runs/${certificationRunId}`,
      },
      { status: 202 },
    ),
  ),

  http.get(`http://localhost/agents/certification-runs/${certificationRunId}`, () =>
    HttpResponse.json(certificationDetail),
  ),

  http.post(`http://localhost/agents/${agentId}/promote`, () =>
    HttpResponse.json({
      decisionId: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
      familyId,
      agentVersionId: agentId,
      previousChampionVersionId: null,
      status: 'active',
      decidedBy: 'test-approver',
      decidedAt: now,
    }),
  ),

  http.get('http://localhost/agents/sources', () =>
    HttpResponse.json({ role: 'knowledge', items: [source] }),
  ),

  http.post('http://localhost/agents/specs', async ({ request }) => {
    const body = (await request.json()) as {
      outcomes: typeof outcomes;
      baseAgentId: string | null;
      derivationMode: 'new' | 'configure' | 'extend';
      interpretationId: string | null;
    };
    const requiresInterpretedConfirmation = body.interpretationId !== null;
    specFixture = {
      id: specId,
      agentId,
      baseAgentId: body.baseAgentId,
      derivationMode: body.derivationMode,
      interpretationId: body.interpretationId,
      unconfirmedPrefill: null,
      status: 'draft',
      revision: 1,
      outcomes: requiresInterpretedConfirmation ? null : body.outcomes,
      knowledge: null,
      guardrails: null,
      outputs: null,
      completion: {
        outcomes: !requiresInterpretedConfirmation,
        knowledge: false,
        guardrails: false,
        outputs: false,
      },
      createdAt: now,
      updatedAt: now,
    };
    return HttpResponse.json(specFixture, { status: 201 });
  }),

  http.get(`http://localhost/agents/specs/${specId}`, () => HttpResponse.json(requireSpec())),

  http.put(`http://localhost/agents/specs/${specId}/outcomes`, async ({ request }) => {
    const body = (await request.json()) as {
      value: typeof outcomes;
      interpretationConfirmation?: TestInterpretationConfirmation;
    };
    const spec = requireSpec();
    if (spec.interpretationId && !body.interpretationConfirmation) {
      return HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Interpreted outcomes require an explicit confirmation.',
            requestId: 'test-request',
          },
        },
        { status: 400 },
      );
    }
    lastOutcomesConfirmation = body.interpretationConfirmation ?? null;
    specFixture = {
      ...spec,
      outcomes: body.value,
      revision: spec.revision + 1,
      completion: { ...spec.completion, outcomes: true },
      updatedAt: now,
    };
    return HttpResponse.json(specFixture);
  }),

  http.put(`http://localhost/agents/specs/${specId}/knowledge`, async ({ request }) => {
    const body = (await request.json()) as {
      value: NonNullable<SpecFixture['knowledge']>;
      interpretationConfirmation?: TestInterpretationConfirmation;
    };
    const spec = requireSpec();
    lastKnowledgeConfirmation = body.interpretationConfirmation ?? null;
    specFixture = {
      ...spec,
      knowledge: body.value,
      revision: spec.revision + 1,
      completion: { ...spec.completion, knowledge: true },
    };
    return HttpResponse.json(specFixture);
  }),

  http.put(`http://localhost/agents/specs/${specId}/guardrails`, async ({ request }) => {
    const body = (await request.json()) as { value: typeof guardrails };
    const spec = requireSpec();
    specFixture = {
      ...spec,
      guardrails: body.value,
      revision: spec.revision + 1,
      completion: { ...spec.completion, guardrails: true },
    };
    return HttpResponse.json(specFixture);
  }),

  http.put(`http://localhost/agents/specs/${specId}/outputs`, async ({ request }) => {
    const body = (await request.json()) as { value: typeof outputs };
    const spec = requireSpec();
    specFixture = {
      ...spec,
      outputs: body.value,
      revision: spec.revision + 1,
      status: 'ready',
      completion: { ...spec.completion, outputs: true },
    };
    return HttpResponse.json(specFixture);
  }),

  http.post(`http://localhost/agents/specs/${specId}/generate`, () =>
    HttpResponse.json(
      {
        jobId,
        agentId,
        state: 'queued',
        statusUrl: `/agents/generation-jobs/${jobId}`,
      },
      { status: 202 },
    ),
  ),

  http.get(`http://localhost/agents/generation-jobs/${jobId}`, () =>
    HttpResponse.json({
      id: jobId,
      agentId,
      specId,
      state: 'succeeded',
      progress: 100,
      message: 'Agent manifest generated',
      specRevision: 4,
      generatorVersion: '0.2.0',
      manifest: {
        agentId,
        name: outcomes.name,
        department: outcomes.department,
        purpose: outcomes.purpose,
        version: '0.1.0',
        specRevision: 4,
        generatorVersion: '0.2.0',
        workflow: guardrails.workflowStages,
        knowledgeSourceIds: [source.id],
        guardrails,
        outputType: outputs.outputType,
        outputSchema: outputs.outputSchema,
        evaluations: outputs.acceptanceTests,
        generatedAt: now,
      },
      error: null,
      createdAt: now,
      updatedAt: now,
    }),
  ),

  http.post(`http://localhost/agents/${agentId}/shadow-deploy`, () =>
    HttpResponse.json({
      deploymentId,
      agentId,
      status: 'shadow',
      startedAt: now,
    }),
  ),

  http.get(`http://localhost/agents/${agentId}/evaluation`, () =>
    HttpResponse.json({
      agentId,
      status: 'complete',
      summary: { passed: 1, failed: 0, total: 1, score: 1 },
      tests: [
        {
          id: testId,
          agentId,
          name: 'Produces a governed answer',
          testCase: { request: 'Summarize the highest-priority case' },
          expectedResult: { includesCitations: true },
          actualResult: { includesCitations: true },
          status: 'passed',
          generatorVersion: '0.2.0',
        },
      ],
    }),
  ),
];

export const server = setupServer(...handlers);
