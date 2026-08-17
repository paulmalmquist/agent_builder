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
export const platformResourceId = '12121212-1212-4121-8121-121212121212';
const platformFamilyId = '13131313-1313-4131-8131-131313131313';
export const executionRunId = '14141414-1414-4141-8141-141414141414';
export const authorityGrantId = '15151515-1515-4151-8151-151515151515';
const releaseId = '16161616-1616-4161-8161-161616161616';
const outcomeId = '17171717-1717-4171-8171-171717171717';
const metricId = '18181818-1818-4181-8181-181818181818';
export const automationScheduleId = '19191919-1919-4191-8191-191919191919';
export const releaseEvaluationId = '20202020-2020-4202-8202-202020202020';
const evaluationSuiteVersionId = '21212121-2121-4212-8212-212121212121';
const observationId = '23232323-2323-4232-8232-232323232323';
export const improvementCandidateId = '24242424-2424-4242-8242-242424242424';
export const memoryCandidateId = '25252525-2525-4252-8252-252525252525';
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
  id: 'demo-build-genealogy',
  role: 'knowledge' as const,
  provider: 'bigquery' as const,
  displayName: 'Build genealogy',
  uri: 'fixture://paul-os/build-genealogy',
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
let platformRunState:
  | 'awaiting_approval'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'paused_budget' = 'awaiting_approval';
let grantState: 'active' | 'revoked' | 'exhausted' | 'expired' = 'active';
let automationScheduleState: 'active' | 'paused' = 'active';
let improvementCandidateState: 'proposed' | 'incubating' | 'rejected' = 'proposed';
let memoryCandidateState: 'staged' | 'accepted' | 'rejected' = 'staged';
let degradedAttentionResolved = false;

export function resetFixtures() {
  specFixture = null;
  lastOutcomesConfirmation = null;
  lastKnowledgeConfirmation = null;
  platformRunState = 'awaiting_approval';
  grantState = 'active';
  automationScheduleState = 'active';
  improvementCandidateState = 'proposed';
  memoryCandidateState = 'staged';
  degradedAttentionResolved = false;
}

function attentionItem() {
  return {
    id: `execution_approval:${executionRunId}`,
    kind: 'execution_approval' as const,
    shelf: 'decide' as const,
    headline: 'Daily Briefing is ready for its first approved run',
    delta: 'One new immutable release asks to run with read-only calendar access.',
    status: 'decide' as const,
    primaryAction: {
      kind: 'approve_run' as const,
      label: 'Review and approve',
      consequence: 'Approves this exact release, input, scope, context, and budget envelope.',
      undo: 'Revoke the grant at any time to stop later matching runs.',
      resourceId: executionRunId,
      requiresRationale: true,
    },
    secondaryAction: {
      kind: 'reject_run' as const,
      label: 'Reject request',
      consequence: 'Cancels this run and records the reason without granting authority.',
      undo: 'Create a new request if its scope or evidence changes.',
      resourceId: executionRunId,
      requiresRationale: true,
    },
    cost: { period: 'run' as const, usd: 0.4, budgetUsd: 0.5 },
    reason: 'The first run of every newly promoted release requires your approval.',
    provenance: {
      sourceType: 'execution_run',
      sourceId: executionRunId,
      actorId: 'test-operator',
      requestId: 'test-request',
      explanation: 'A human-started production run reached its first-run authority gate.',
    },
    occurredAt: now,
    payload: {
      sourceType: 'execution_run',
      sourceId: executionRunId,
      detailPath: `/runs?run=${executionRunId}`,
      scopes: ['Calendar — read only'],
      runId: executionRunId,
      candidateId: null,
      channelKey: null,
      releaseId,
      evaluationId: null,
      expiresAt: '2026-08-01T14:00:00.000Z',
      reviewFacts: [
        { label: 'Release', value: 'Daily Briefing · immutable production digest' },
        { label: 'Authority', value: 'Calendar — read only' },
        { label: 'Budget', value: 'About $0.40 per run · $0.50 maximum' },
      ],
      metadata: {},
    },
  };
}

function degradedAttentionItem() {
  return {
    id: `stalled_run:${executionRunId}`,
    kind: 'stalled_run' as const,
    shelf: 'degraded' as const,
    headline: 'One run exhausted its retry limit',
    delta: 'Three attempts failed · no outcome was published.',
    status: 'degraded' as const,
    primaryAction: {
      kind: 'open_details' as const,
      label: 'Review failure',
      consequence: 'Opens the exact failure history without changing the run.',
      undo: 'Close the detail to leave the immutable failure unchanged.',
      resourceId: executionRunId,
      requiresRationale: false,
    },
    secondaryAction: {
      kind: 'resolve_item' as const,
      label: 'Acknowledge failure',
      consequence: 'Removes this resolved stop from your active review queue.',
      undo: 'The immutable run history remains available in Runs and Evidence.',
      resourceId: `stalled_run:${executionRunId}`,
      requiresRationale: true,
    },
    cost: { period: 'run' as const, usd: 0.12, budgetUsd: 0.5 },
    reason: 'The worker exhausted the configured retry policy without producing an outcome.',
    provenance: {
      sourceType: 'execution_run',
      sourceId: executionRunId,
      actorId: 'system:worker',
      requestId: null,
      explanation: 'The worker recorded a terminal failure after its final bounded retry.',
    },
    occurredAt: now,
    payload: {
      sourceType: 'execution_run',
      sourceId: executionRunId,
      detailPath: `/runs?run=${executionRunId}`,
      scopes: [],
      runId: executionRunId,
      candidateId: null,
      channelKey: null,
      releaseId,
      evaluationId: null,
      expiresAt: null,
      reviewFacts: [
        { label: 'Run state', value: 'Failed after the final retry' },
        { label: 'Cost', value: '$0.12 incurred' },
      ],
      metadata: {},
    },
  };
}

const platformResource = {
  id: platformResourceId,
  familyId: platformFamilyId,
  kind: 'Skill' as const,
  slug: 'daily-brief',
  name: 'Daily Brief',
  version: '1.0.0',
  owner: 'Personal Operations',
  purpose: 'Create a bounded daily briefing from synthetic priorities, tasks, and calendar items.',
  lifecycle: 'candidate' as const,
  digest: 'a'.repeat(64),
  sourceCommit: 'test-commit',
  provenance: { source: 'synthetic-test' },
  dependencyPins: [],
  definition: {
    apiVersion: 'paul-os/v1' as const,
    kind: 'Skill' as const,
    metadata: {
      id: platformFamilyId,
      slug: 'daily-brief',
      version: '1.0.0',
      name: 'Daily Brief',
      owner: 'Personal Operations',
      purpose:
        'Create a bounded daily briefing from synthetic priorities, tasks, and calendar items.',
      lifecycle: 'candidate' as const,
      provenance: { source: 'synthetic-test' },
    },
    dependencies: [],
    spec: {},
  },
  revision: 1,
  frozenAt: now,
  createdAt: now,
  updatedAt: now,
};

function platformRun() {
  return {
    id: executionRunId,
    releaseId,
    releaseDigest: 'b'.repeat(64),
    contextDigest: 'd'.repeat(64),
    contextProvenance: [
      { source: 'core' as const, classification: 'public' as const, tokenContribution: 24 },
    ],
    contextClassification: 'public' as const,
    contextEstimatedTokens: 24,
    projectId: 'daily-operations',
    authorityGrantId: platformRunState === 'awaiting_approval' ? null : authorityGrantId,
    state: platformRunState,
    input: { date: '2026-07-31' },
    requiredToolScopes: ['read:calendar'],
    providerKind: 'deterministic' as const,
    developmentDraft: false,
    providerVersion: '1.0.0',
    model: 'daily-brief-fixture',
    maxInputTokens: 8_000,
    maxOutputTokens: 2_000,
    maxEstimatedCostUsd: 0.25,
    estimatedUpperCostUsd: 0.12,
    actualCostUsd: null,
    pricingVersion: 'test-pricing-v1',
    approvalReasons:
      platformRunState === 'awaiting_approval'
        ? ['First run of this immutable release requires human approval.']
        : [],
    progress: platformRunState === 'awaiting_approval' ? 0 : 10,
    message:
      platformRunState === 'awaiting_approval'
        ? 'Awaiting a bounded authority envelope'
        : 'Execution queued',
    attempts: 0,
    error: null,
    requestedBy: 'test-operator',
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function authorityGrant() {
  return {
    id: authorityGrantId,
    releaseId,
    releaseDigest: 'b'.repeat(64),
    contextDigest: 'd'.repeat(64),
    projectId: 'daily-operations',
    inputConstraints: {},
    toolScopes: ['read:calendar'],
    validFrom: now,
    validUntil: '2027-08-01T14:00:00.000Z',
    maxRuns: 10,
    usedRuns: 1,
    maxEstimatedCostPerRunUsd: 0.25,
    totalCostBudgetUsd: 2.5,
    spentCostUsd: 0.1,
    reservedCostUsd: 0,
    state: grantState,
    actorId: 'test-operator',
    rationale: 'Permit bounded synthetic daily briefing executions.',
    revokedAt: grantState === 'revoked' ? now : null,
    createdAt: now,
  };
}

function automationSchedule() {
  return {
    id: automationScheduleId,
    name: 'Daily operations briefing',
    channelKey: 'daily-operations',
    releaseId,
    releaseDigest: 'b'.repeat(64),
    projectId: 'daily-operations',
    authorityGrantId,
    timezone: 'America/New_York',
    intervalSeconds: 86_400,
    nextRunAt: '2026-08-01T11:00:00.000Z',
    inputTemplate: { date: '{{date}}', priorities: [] },
    inputConstraints: { date: { format: 'date' } },
    catchUpPolicy: 'latest_only' as const,
    maxCatchUpRuns: 1,
    deduplicationWindowSeconds: 3_600,
    retry: { maximumAttempts: 3, backoff: 'exponential' as const },
    cost: {
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      maxEstimatedCostUsd: 0.25,
    },
    outcomeExpectations: { unresolvedItems: 0 },
    state: automationScheduleState,
    lastScheduledAt: null,
    createdBy: 'test-operator',
    updatedBy: 'test-operator',
    createdAt: now,
    updatedAt: now,
  };
}

function productionChannel() {
  return {
    key: 'daily-operations',
    projectId: 'daily-operations',
    currentReleaseId: releaseId,
    currentReleaseDigest: 'b'.repeat(64),
    priorReleaseId: null,
    promotedBy: 'test-approver',
    promotedAt: now,
    updatedAt: now,
  };
}

function releaseEvaluation() {
  const gateResults = [
    {
      key: 'schema_conformance' as const,
      category: 'contract' as const,
      operator: 'gte' as const,
      threshold: 1,
      measuredValue: 1,
      status: 'passed' as const,
      sampleSize: 1,
      evidenceSource: 'manifest_declaration' as const,
      detail: 'Measured from deterministic assertions.',
    },
    {
      key: 'citation_coverage' as const,
      category: 'contract' as const,
      operator: 'gte' as const,
      threshold: 1,
      measuredValue: 1,
      status: 'passed' as const,
      sampleSize: 1,
      evidenceSource: 'manifest_declaration' as const,
      detail: 'Measured from deterministic assertions.',
    },
    {
      key: 'unauthorized_actions' as const,
      category: 'contract' as const,
      operator: 'lte' as const,
      threshold: 0,
      measuredValue: 0,
      status: 'passed' as const,
      sampleSize: 1,
      evidenceSource: 'manifest_declaration' as const,
      detail: 'Measured from deterministic assertions.',
    },
    ...(['mean_cost_usd', 'p95_latency_ms', 'mean_outcome_quality'] as const).map((key) => ({
      key,
      category:
        key === 'mean_cost_usd'
          ? ('cost' as const)
          : key === 'p95_latency_ms'
            ? ('latency' as const)
            : ('outcome_history' as const),
      operator: key === 'mean_outcome_quality' ? ('gte' as const) : ('lte' as const),
      threshold: key === 'mean_cost_usd' ? 0.25 : key === 'p95_latency_ms' ? 5_000 : 0.85,
      measuredValue: null,
      status: 'not_applicable' as const,
      sampleSize: 0,
      evidenceSource: 'execution_history' as const,
      detail: 'Requires 3 production samples; 0 are available.',
    })),
  ];
  return {
    id: releaseEvaluationId,
    releaseId,
    releaseDigest: 'b'.repeat(64),
    suiteVersionId: evaluationSuiteVersionId,
    suiteDigest: 'c'.repeat(64),
    executorKind: 'deterministic_contract' as const,
    executorVersion: '1.0.0' as const,
    evaluationMode: 'contract_validation' as const,
    historySnapshotDigest: '0'.repeat(64),
    corpusVersion: 1,
    verdict: 'passed' as const,
    results: [
      {
        caseKey: 'synthetic-daily-brief',
        assertions: [
          {
            key: 'output_schema_valid' as const,
            passed: true,
            detail: 'The deterministic fixture satisfied the declared output contract.',
          },
          {
            key: 'citations_resolve_to_supplied_calendar_items' as const,
            passed: true,
            detail: 'Every fixture citation resolved to a supplied synthetic calendar item.',
          },
        ],
        passed: true,
      },
    ],
    gateScores: {
      schemaConformance: 1,
      citationCoverage: 1,
      unauthorizedActions: 0,
    },
    gateResults,
    disclaimer:
      'Deterministic contract evidence validates declared fixtures and release composition; it does not measure semantic model quality.' as const,
    evidence: {
      schemaVersion: 1 as const,
      historySnapshotDigest: '0'.repeat(64),
      historyRunIds: [],
      suiteCaseCount: 1,
      assertionCount: 2,
      subjectPresent: true,
      subjectDigest: 'a'.repeat(64),
      gateResults,
    },
    requestedBy: 'test-operator',
    createdAt: now,
    finishedAt: now,
  };
}

function observation() {
  return {
    id: observationId,
    signalKey: 'briefing-unresolved-priority',
    signalType: 'outcome_review',
    summary: 'A synthetic briefing left one priority without a supporting schedule reference.',
    evidence: { controlledReference: 'fixture://observation/priority' },
    provenance: { source: 'synthetic-test' },
    sourceRunId: executionRunId,
    sourceOutcomeId: outcomeId,
    observedBy: 'test-operator',
    observedAt: now,
  };
}

function improvementCandidate() {
  return {
    id: improvementCandidateId,
    observationId,
    title: 'Require a schedule reference for time-bound priorities',
    proposedTarget: 'daily-brief@next',
    proposedChange: 'Add a bounded validation rule before a time-bound priority is emitted.',
    evidenceRefs: [`observation:${observationId}`],
    state: improvementCandidateState,
    createdBy: 'test-operator',
    reviewedBy: improvementCandidateState === 'proposed' ? null : 'test-operator',
    reviewRationale:
      improvementCandidateState === 'proposed'
        ? null
        : 'Human review confirmed the candidate disposition and retained its lineage.',
    createdAt: now,
    reviewedAt: improvementCandidateState === 'proposed' ? null : now,
  };
}

function memoryCandidate() {
  return {
    id: memoryCandidateId,
    sourceRunId: executionRunId,
    namespace: 'preferences.briefing',
    proposedValue: { ordering: 'schedule-risk-first' },
    acceptedValue: memoryCandidateState === 'accepted' ? { ordering: 'schedule-risk-first' } : null,
    provenance: { source: 'synthetic-test' },
    state: memoryCandidateState,
    stagedBy: 'test-operator',
    reviewedBy: memoryCandidateState === 'staged' ? null : 'test-operator',
    reviewRationale:
      memoryCandidateState === 'staged'
        ? null
        : 'Human review recorded a bounded durable-memory decision.',
    stagedAt: now,
    reviewedAt: memoryCandidateState === 'staged' ? null : now,
  };
}

function requireSpec() {
  if (!specFixture) throw new Error('Test expected a spec fixture.');
  return specFixture;
}

export const handlers = [
  http.get('http://localhost/v1/attention', () => {
    const decide = platformRunState === 'awaiting_approval' ? [attentionItem()] : [];
    return HttpResponse.json({
      generatedAt: now,
      decide,
      degraded: degradedAttentionResolved ? [] : [degradedAttentionItem()],
      digest: {
        headline: '34 runs · $2.10 · 2 promotions this week',
        runCount: 34,
        totalCostUsd: 2.1,
        promotionCount: 2,
        observationCount: 1,
        windowStartedAt: '2026-07-30T14:00:00.000Z',
        windowEndedAt: now,
      },
      decideBadgeCount: decide.length,
      lastDeliveredBriefingAt: '2026-07-30T11:00:00.000Z',
    });
  }),

  http.get('http://localhost/v1/attention-items/:itemId', ({ params }) =>
    HttpResponse.json({
      item: String(params.itemId).startsWith('stalled_run')
        ? degradedAttentionItem()
        : attentionItem(),
      timeline: [
        {
          id: '26262626-2626-4262-8262-262626262626',
          phase: 'authority-check',
          state: 'awaiting_approval',
          message: 'The immutable release is waiting for its first human authority decision.',
          durationMs: 18,
          costUsd: 0,
          occurredAt: now,
        },
      ],
      details: { releaseDigest: 'a'.repeat(64), toolScopeCount: 1 },
    }),
  ),

  http.post('http://localhost/v1/attention-items/:itemId/resolve', async ({ params, request }) => {
    const body = (await request.json()) as { rationale?: unknown };
    if (typeof body.rationale !== 'string' || body.rationale.trim().length < 10) {
      return HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A rationale of at least 10 characters is required.',
            requestId: 'test-request',
          },
        },
        { status: 400 },
      );
    }
    degradedAttentionResolved = true;
    return HttpResponse.json({
      id: '29292929-2929-4292-8292-292929292929',
      itemId: String(params.itemId),
      rationale: body.rationale.trim(),
      resolvedBy: 'test-operator',
      resolvedAt: now,
    });
  }),

  http.get('http://localhost/v1/resources', () => HttpResponse.json({ items: [platformResource] })),

  http.get('http://localhost/v1/execution-runs', () =>
    HttpResponse.json({ items: [platformRun()] }),
  ),

  http.post(`http://localhost/v1/execution-runs/${executionRunId}/approve`, async ({ request }) => {
    const body = (await request.json()) as {
      projectId?: unknown;
      inputConstraints?: unknown;
      toolScopes?: unknown;
    };
    if (
      body.projectId !== 'daily-operations' ||
      JSON.stringify(body.inputConstraints) !== JSON.stringify(platformRun().input) ||
      JSON.stringify(body.toolScopes) !== JSON.stringify(['read:calendar'])
    ) {
      return HttpResponse.json(
        {
          error: {
            code: 'AUTHORITY_ENVELOPE_INSUFFICIENT',
            message: 'Approval did not bind the server-derived project, input, and tool scopes.',
            requestId: 'test-request',
          },
        },
        { status: 422 },
      );
    }
    platformRunState = 'queued';
    return HttpResponse.json({ grant: authorityGrant(), run: platformRun() });
  }),

  http.post(`http://localhost/v1/execution-runs/${executionRunId}/cancel`, () => {
    platformRunState = 'cancelled';
    return HttpResponse.json(platformRun());
  }),

  http.post(`http://localhost/v1/execution-runs/${executionRunId}/reject`, () => {
    platformRunState = 'cancelled';
    return HttpResponse.json(platformRun());
  }),

  http.get('http://localhost/v1/authority-grants', () =>
    HttpResponse.json({ items: [authorityGrant()] }),
  ),

  http.post(`http://localhost/v1/authority-grants/${authorityGrantId}/revoke`, () => {
    grantState = 'revoked';
    return HttpResponse.json(authorityGrant());
  }),

  http.get('http://localhost/v1/automation-schedules', () =>
    HttpResponse.json({ items: [automationSchedule()] }),
  ),

  http.post(
    `http://localhost/v1/automation-schedules/${automationScheduleId}/state`,
    async ({ request }) => {
      const body = (await request.json()) as { state: 'active' | 'paused' };
      automationScheduleState = body.state;
      return HttpResponse.json(automationSchedule());
    },
  ),

  http.get('http://localhost/v1/production-channels/daily-operations', () =>
    HttpResponse.json(productionChannel()),
  ),

  http.get(`http://localhost/v1/release-evaluations/${releaseEvaluationId}`, () =>
    HttpResponse.json(releaseEvaluation()),
  ),

  http.get('http://localhost/v1/observations', () => HttpResponse.json({ items: [observation()] })),

  http.get('http://localhost/v1/improvement-candidates', () =>
    HttpResponse.json({ items: [improvementCandidate()] }),
  ),

  http.post(
    `http://localhost/v1/improvement-candidates/${improvementCandidateId}/review`,
    async ({ request }) => {
      const body = (await request.json()) as { decision: 'incubate' | 'reject' };
      improvementCandidateState = body.decision === 'incubate' ? 'incubating' : 'rejected';
      return HttpResponse.json(improvementCandidate());
    },
  ),

  http.get('http://localhost/v1/memory-candidates', () =>
    HttpResponse.json({ items: [memoryCandidate()] }),
  ),

  http.post(
    `http://localhost/v1/memory-candidates/${memoryCandidateId}/review`,
    async ({ request }) => {
      const body = (await request.json()) as {
        decision: 'accept' | 'edit_accept' | 'reject';
        editedValue?: Record<string, unknown>;
      };
      memoryCandidateState = body.decision === 'reject' ? 'rejected' : 'accepted';
      return HttpResponse.json({
        ...memoryCandidate(),
        acceptedValue:
          body.decision === 'edit_accept'
            ? (body.editedValue ?? null)
            : memoryCandidate().acceptedValue,
      });
    },
  ),

  http.get('http://localhost/v1/outcomes', () =>
    HttpResponse.json({
      items: [
        {
          id: outcomeId,
          runId: executionRunId,
          output: { topPriorities: ['Protect the focus block'] },
          confidence: 0.92,
          citations: ['calendar:item-1'],
          unresolvedItems: [],
          qualityScore: 1,
          createdAt: now,
        },
      ],
    }),
  ),

  http.get('http://localhost/v1/metrics', () =>
    HttpResponse.json({
      items: [
        {
          id: metricId,
          runId: executionRunId,
          name: 'provider_cost_usd',
          value: 0.0032,
          unit: 'usd',
          metadata: { provider: 'deterministic' },
          observedAt: now,
        },
      ],
    }),
  ),

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
