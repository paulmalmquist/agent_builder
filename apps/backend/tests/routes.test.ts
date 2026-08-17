/* eslint-disable @typescript-eslint/unbound-method */
import { Writable } from 'node:stream';
import request from 'supertest';
import { pino } from 'pino';
import {
  agentSearchResponseSchema,
  agentSchema,
  agentSpecSchema,
  certificationGateConfigSchema,
  certificationRunAcceptedSchema,
  certificationRunDetailSchema,
  certificationRunHistoryResponseSchema,
  createOpenApiDocument,
  evalCaseSchema,
  evalCorpusVersionSchema,
  evaluationResponseSchema,
  generationAcceptedSchema,
  generationJobSchema,
  gateConfigListResponseSchema,
  interpretSpecResponseSchema,
  liveResponseSchema,
  promotionResponseSchema,
  retirementResponseSchema,
  shadowDeployResponseSchema,
  similarityResponseSchema,
  sourceDescriptorSchema,
  type GuardrailsSection,
  type KnowledgeSection,
  type OutcomesSection,
  type OutputsSection,
} from '@agent-builder/contracts';
import { createApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { createLogger } from '../src/logger.js';
import type { ServiceBundle } from '../src/services/types.js';
import {
  LOCAL_DEPARTMENT_ID,
  LOCAL_PRINCIPAL_ID,
  LOCAL_WORKSPACE_ID,
} from '../src/scope-constants.js';

const agentId = 'e341457e-e682-4429-898f-a07d31d88a35';
const familyId = 'a341457e-e682-4429-898f-a07d31d88a35';
const specId = 'c00b556d-eab0-4925-b4c1-180a5b413e39';
const jobId = '9ec5bb64-0014-4ed8-adf8-7988c7eca5f2';
const runId = '98b08a8c-d58b-41ba-b92c-18af18f570b8';
const caseId = '707020b1-955f-41c6-859d-b045cdaea54c';
const now = '2026-07-31T04:00:00.000Z';

const outcomes: OutcomesSection = {
  name: 'Supplier Build Impact',
  department: 'Supply Chain',
  purpose: 'Identify builds affected by supplier delays and prepare an escalation brief.',
  audience: 'Supply chain leaders',
  desiredOutcomes: ['Identify every impacted build'],
  humanBaseline: 'An analyst completes this investigation in two hours.',
  exclusions: ['Do not contact suppliers'],
};
const knowledge: KnowledgeSection = {
  sources: [
    {
      descriptorId: 'bq-operations-builds',
      purpose: 'Resolve impacted builds',
      requiredCitations: true,
    },
  ],
};
const guardrails: GuardrailsSection = {
  workflowStages: ['Review delay signal', 'Resolve impacted builds'],
  prohibitedActions: ['Do not contact suppliers'],
  approvalRequirements: ['Require manager approval before escalation'],
  failClosedConditions: ['Stop when build genealogy is unavailable'],
  responseRequirements: {
    citations: true,
    confidence: true,
    unresolvedConflicts: true,
  },
};
const outputs: OutputsSection = {
  outputType: 'decision_brief',
  outputSchema: { impactedBuilds: [] },
  successMetrics: [{ name: 'Build recall', operator: 'gte', threshold: 0.95, unit: null }],
  acceptanceTests: [
    {
      name: 'Known supplier delay',
      input: { supplier: 'Example' },
      expectedResult: { impacted: true },
    },
  ],
};

const agent = agentSchema.parse({
  id: agentId,
  familyId,
  slug: 'supplier-build-impact-v1',
  versionNumber: 1,
  predecessorAgentId: null,
  derivationMode: 'new',
  name: outcomes.name,
  department: outcomes.department,
  purpose: outcomes.purpose,
  owner: 'Supply Chain Agent Owner',
  status: 'draft',
  capabilities: [],
  manifest: null,
  manifestHash: null,
  certificationHealth: 'not_certified',
  degradedAt: null,
  degradationReason: null,
  createdAt: now,
  updatedAt: now,
});
const spec = agentSpecSchema.parse({
  id: specId,
  agentId,
  baseAgentId: null,
  status: 'draft',
  revision: 1,
  outcomes,
  knowledge: null,
  guardrails: null,
  outputs: null,
  completion: {
    outcomes: true,
    knowledge: false,
    guardrails: false,
    outputs: false,
  },
  createdAt: now,
  updatedAt: now,
});
const source = sourceDescriptorSchema.parse({
  id: 'bq-operations-builds',
  role: 'knowledge',
  provider: 'bigquery',
  displayName: 'Operations Builds',
  uri: 'bigquery://project/dataset/table',
  authority: 'system_of_record',
  owner: 'Manufacturing Data',
  region: 'US',
  lastRefreshed: now,
  citationRequired: true,
  readOnly: true,
  synthetic: false,
  metadata: { project: 'project', dataset: 'dataset', table: 'table', location: 'US' },
});
const accepted = generationAcceptedSchema.parse({
  jobId,
  agentId,
  state: 'queued',
  statusUrl: `/agents/generation-jobs/${jobId}`,
});
const job = generationJobSchema.parse({
  id: jobId,
  agentId,
  specId,
  state: 'queued',
  progress: 0,
  message: 'Queued',
  specRevision: 4,
  generatorVersion: '0.2.0',
  manifest: null,
  error: null,
  createdAt: now,
  updatedAt: now,
});
const interpretation = interpretSpecResponseSchema.parse({
  kind: 'prefill',
  interpretationId: '06671d44-e689-4fdc-b0cb-33ad0af0b8fd',
  parentInterpretationId: null,
  expiresAt: now,
  sections: {
    outcomes: { value: outcomes, confidence: 'high', needsReview: false, unresolved: [] },
    knowledge: { value: knowledge, confidence: 'high', needsReview: false, unresolved: [] },
    guardrails: { value: guardrails, confidence: 'medium', needsReview: true, unresolved: [] },
    outputs: { value: outputs, confidence: 'medium', needsReview: true, unresolved: [] },
  },
  authorityWarnings: [],
  reuseQuery: 'supplier delay build impact',
});
const certificationAccepted = certificationRunAcceptedSchema.parse({
  runId,
  agentVersionId: agentId,
  state: 'queued',
  corpusVersion: 1,
  gateConfigVersion: 1,
  executorKind: 'manifest_fixture',
  executorVersion: '1.0.0',
  evaluationMode: 'corpus_coverage',
  statusUrl: `/agents/certification-runs/${runId}`,
});
const certificationRun = {
  id: runId,
  agentVersionId: agentId,
  familyId,
  championVersionId: null,
  kind: 'challenger' as const,
  originStatus: 'shadow' as const,
  state: 'queued' as const,
  corpusVersionId: '5387ce96-31b0-4f8f-8f2c-234975896974',
  corpusVersion: 1,
  gateConfigId: '81a77f93-35be-4f7b-bb09-bc3ecbc5dc38',
  gateConfigVersion: 1,
  subjectManifestHash: 'a'.repeat(64),
  championManifestHash: null,
  specRevision: 4,
  generatorVersion: '0.2.0',
  executorKind: 'manifest_fixture' as const,
  executorVersion: '1.0.0',
  evaluationMode: 'corpus_coverage' as const,
  progress: 0,
  message: 'Queued',
  caseCounts: { total: 0, passed: 0, failed: 0 },
  verdict: null,
  error: null,
  requestedBy: 'test-user',
  startedBy: null,
  requestedAt: now,
  startedAt: null,
  finishedAt: null,
  promotionExpiresAt: null,
  isPromotionEvidence: false,
  resultsAvailability: 'full' as const,
  caseResultsPrunedAt: null,
};
const certificationDetail = certificationRunDetailSchema.parse({
  run: certificationRun,
  subject: {
    agentVersionId: agentId,
    name: agent.name,
    versionNumber: 1,
    lifecycleStatus: 'shadow',
    manifestHash: 'a'.repeat(64),
  },
  champion: null,
  gates: [],
  results: { items: [], nextCursor: null },
  promotionEligibility: {
    eligible: false,
    freshUntil: null,
    blockers: [
      {
        code: 'run_not_passed',
        message: 'Certification has not passed.',
        recommendedAction: 'recertify',
      },
    ],
  },
});
const evalCase = evalCaseSchema.parse({
  id: caseId,
  key: 'supplier-delay-golden',
  name: 'Supplier delay golden case',
  input: { supplier: 'Example' },
  expectedOutput: { impacted: true },
  expectedCitations: ['source:1'],
  tags: ['golden'],
  source: 'override',
  active: true,
  provenance: {},
  createdBy: 'test-user',
  updatedBy: 'test-user',
  deactivatedAt: null,
  deactivatedBy: null,
  deactivationRationale: null,
  createdAt: now,
  updatedAt: now,
});
const gateConfig = certificationGateConfigSchema.parse({
  id: '81a77f93-35be-4f7b-bb09-bc3ecbc5dc38',
  version: 1,
  state: 'active',
  promotionFreshnessHours: 24,
  gates: [
    { key: 'factual_accuracy', operator: 'gte', threshold: 0.98 },
    { key: 'citation_coverage', operator: 'eq', threshold: 1 },
    { key: 'unauthorized_actions', operator: 'eq', threshold: 0 },
    { key: 'champion_regression', operator: 'lte', threshold: 0 },
  ],
  compatibleExecutorKinds: ['manifest_fixture'],
  publishedBy: 'test-user',
  rationale: 'Initial governed certification gates.',
  activatedAt: now,
  supersededAt: null,
  createdAt: now,
});
const corpusVersion = evalCorpusVersionSchema.parse({
  id: '5387ce96-31b0-4f8f-8f2c-234975896974',
  version: 1,
  contentHash: 'b'.repeat(64),
  caseCount: 1,
  publishedBy: 'test-user',
  rationale: 'Initial governed evaluation corpus.',
  publishedAt: now,
});

function createFakeServices(): ServiceBundle {
  return {
    catalog: {
      list: jest.fn((input) =>
        Promise.resolve(
          agentSearchResponseSchema.parse({
            mode: 'catalog',
            query: input.query ?? '',
            nextCursor: null,
            items: [
              {
                ...agent,
                familySlug: 'supplier-build-impact',
                isChampion: false,
                providers: ['bigquery'],
                score: input.query === undefined || input.query === '' ? 0 : 85,
                reuseRecommended: input.query !== undefined && input.query !== '',
                matchedCapabilities:
                  input.query === undefined || input.query === '' ? [] : ['build impact'],
                gaps: [],
              },
            ],
          }),
        ),
      ),
      search: jest.fn((query: string) =>
        Promise.resolve(
          agentSearchResponseSchema.parse({
            mode: 'catalog',
            query,
            nextCursor: null,
            items: [],
          }),
        ),
      ),
      similarity: jest.fn((input) =>
        Promise.resolve(
          similarityResponseSchema.parse({
            query: input.query,
            matches: [
              {
                agentId,
                score: 85,
                reuseRecommended: true,
                reasons: ['Matches build impact'],
                gaps: [],
              },
            ],
          }),
        ),
      ),
      getAgent: jest.fn((id: string) => {
        if (id !== agentId) {
          return Promise.reject(
            new AppError(404, 'AGENT_NOT_FOUND', 'Agent was not found', {
              agentId: id,
            }),
          );
        }
        return Promise.resolve(agent);
      }),
    },
    sources: {
      list: jest.fn(() => Promise.resolve([source])),
    },
    specs: {
      create: jest.fn(() => Promise.resolve(spec)),
      get: jest.fn(() => Promise.resolve(spec)),
      updateOutcomes: jest.fn(() => Promise.resolve(spec)),
      updateKnowledge: jest.fn(() => Promise.resolve(spec)),
      updateGuardrails: jest.fn(() => Promise.resolve(spec)),
      updateOutputs: jest.fn(() => Promise.resolve(spec)),
    },
    interpretations: {
      interpret: jest.fn(() => Promise.resolve(interpretation)),
      deleteExpiredUnattached: jest.fn(() => Promise.resolve(0)),
    },
    generation: {
      accept: jest.fn(() => Promise.resolve(accepted)),
      getJob: jest.fn(() => Promise.resolve(job)),
    },
    deployment: {
      recover: jest.fn(() => Promise.resolve({ agentId, status: 'draft' as const })),
      shadowDeploy: jest.fn(() =>
        Promise.resolve(
          shadowDeployResponseSchema.parse({
            deploymentId: '2f5958c5-cc52-4a7f-8ee0-f4af4af10b88',
            agentId,
            status: 'shadow',
            startedAt: now,
          }),
        ),
      ),
      evaluation: jest.fn(() =>
        Promise.resolve(
          evaluationResponseSchema.parse({
            agentId,
            status: 'not_started',
            summary: { passed: 0, failed: 0, total: 0, score: 0 },
            tests: [],
          }),
        ),
      ),
    },
    certification: {
      createRun: jest.fn(() => Promise.resolve(certificationAccepted)),
      getRun: jest.fn(() => Promise.resolve(certificationDetail)),
      listRuns: jest.fn(() =>
        Promise.resolve(
          certificationRunHistoryResponseSchema.parse({
            items: [certificationRun],
            nextCursor: null,
          }),
        ),
      ),
    },
    promotion: {
      promote: jest.fn(() =>
        Promise.resolve(
          promotionResponseSchema.parse({
            decisionId: '923c3794-a6bd-4935-ae13-41b922380a91',
            familyId,
            agentVersionId: agentId,
            previousChampionVersionId: null,
            status: 'active',
            decidedBy: 'test-user',
            decidedAt: now,
          }),
        ),
      ),
      retire: jest.fn(() =>
        Promise.resolve(
          retirementResponseSchema.parse({
            agentVersionId: agentId,
            familyId,
            status: 'retired',
            championCleared: false,
            retiredAt: now,
          }),
        ),
      ),
    },
    corpus: {
      listCases: jest.fn(() => Promise.resolve({ items: [evalCase], nextCursor: null })),
      createCase: jest.fn(() => Promise.resolve(evalCase)),
      deactivateCase: jest.fn(() =>
        Promise.resolve({
          ...evalCase,
          active: false,
          deactivatedAt: now,
          deactivatedBy: 'test-user',
          deactivationRationale: 'No longer represents approved behavior.',
        }),
      ),
      publish: jest.fn(() => Promise.resolve(corpusVersion)),
    },
    gateConfigs: {
      list: jest.fn(() =>
        Promise.resolve(gateConfigListResponseSchema.parse({ active: gateConfig, history: [] })),
      ),
      publish: jest.fn(() => Promise.resolve(gateConfig)),
    },
    health: {
      check: jest.fn(() =>
        Promise.resolve({
          status: 'ok' as const,
          database: 'connected' as const,
          timestamp: now,
        }),
      ),
    },
    dispatcher: {
      enqueue: jest.fn(),
      recoverAndResume: jest.fn(() => Promise.resolve()),
    },
    certificationDispatcher: {
      enqueue: jest.fn(),
      recoverAndResume: jest.fn(() => Promise.resolve()),
    },
    maintenance: {
      start: jest.fn(() => Promise.resolve()),
      stop: jest.fn(),
    },
    automationScheduler: {
      start: jest.fn(() => Promise.resolve()),
      stop: jest.fn(() => Promise.resolve()),
    },
    pluginHealthScheduler: {
      start: jest.fn(() => Promise.resolve()),
      stop: jest.fn(),
    },
    catalogIndexScheduler: {
      start: jest.fn(() => Promise.resolve()),
      stop: jest.fn(),
    },
  };
}

describe('Agent Builder HTTP API', () => {
  const logger = pino({ level: 'silent' });
  let services: ServiceBundle;

  beforeEach(() => {
    services = createFakeServices();
  });

  it('serves database-backed health and generated OpenAPI', async () => {
    const app = createApp(services, logger);
    const live = await request(app).get('/live').expect(200);
    const liveBody = liveResponseSchema.parse(live.body as unknown);
    expect(liveBody).toMatchObject({ status: 'live' });
    expect(Date.parse(liveBody.timestamp)).not.toBeNaN();
    await request(app)
      .get('/ready')
      .expect(200, {
        status: 'ready',
        dependencies: { postgresql: 'connected' },
        timestamp: now,
      });
    await request(app).get('/health').expect(200, {
      status: 'ok',
      database: 'connected',
      timestamp: now,
    });
    const openapi = await request(app).get('/openapi.json').expect(200);
    expect(openapi.body.openapi).toBe('3.0.3');
    expect(openapi.body.paths['/agents']).toBeDefined();
    expect(openapi.body).toEqual(createOpenApiDocument());
    expect(openapi.body).toMatchSnapshot();
  });

  it('serializes unexpected errors through the Pino err path and redacts response bodies', async () => {
    const chunks: string[] = [];
    const destination = new Writable({
      write(
        chunk: string | Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
      ) {
        chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
        callback();
      },
    });
    const capturedServices = createFakeServices();
    const failure = Object.assign(new Error('Synthetic upstream request failed'), {
      response: {
        status: 503,
        body: { token: 'fixture-response-value', rows: [{ private: 'fixture-row-value' }] },
      },
    });
    jest.spyOn(capturedServices.health, 'check').mockRejectedValueOnce(failure);

    const response = await request(
      createApp(capturedServices, createLogger({ logLevel: 'error' }, destination)),
    )
      .get('/health')
      .expect(500);

    expect(response.body).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    });
    const serialized = chunks.join('');
    expect(serialized).not.toContain('fixture-response-value');
    expect(serialized).not.toContain('fixture-row-value');
    const records = serialized
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const event = records.find((record) => record['msg'] === 'Request failed');
    expect(event).toBeDefined();
    expect(event).not.toHaveProperty('error');
    expect(event).toMatchObject({
      err: {
        type: 'Error',
        message: 'Synthetic upstream request failed',
        response: { status: 503, body: '[REDACTED]' },
      },
    });
    expect((event?.['err'] as { stack?: unknown }).stack).toEqual(expect.any(String));
  });

  it('returns the resolved local session and inherited four-role authorization', async () => {
    const response = await request(createApp(services, logger)).get('/v1/session').expect(200);
    expect(response.body).toMatchObject({
      principal: {
        principalId: LOCAL_PRINCIPAL_ID,
        actorId: 'local-user',
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        authentication: 'local',
        roles: ['admin'],
      },
      effectiveRoles: ['consumer', 'builder', 'owner', 'admin'],
      authorizationModel: 'workspace-role-v1',
    });
    expect(response.body.permissions).toContain('platform:administer');
  });

  it('searches from GET /agents and returns the reuse result', async () => {
    const response = await request(createApp(services, logger))
      .get('/agents')
      .query({ query: 'supplier delay build' })
      .expect(200);
    expect(response.body.items[0]).toMatchObject({ id: agentId, score: 85 });
    expect(services.catalog.list).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'supplier delay build', limit: 30 }),
    );
  });

  it('does not route /agents/search or malformed ids into agent lookup', async () => {
    const app = createApp(services, logger);
    const compatibility = await request(app).get('/agents/search').expect(404);
    expect(compatibility.body.error.code).toBe('ROUTE_NOT_FOUND');
    const malformed = await request(app).get('/agents/not-a-uuid').expect(404);
    expect(malformed.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(services.catalog.getAgent).not.toHaveBeenCalled();
  });

  it('returns a resource error for a valid unknown UUID', async () => {
    const response = await request(createApp(services, logger))
      .get('/agents/11111111-1111-4111-8111-111111111111')
      .expect(404);
    expect(response.body.error.code).toBe('AGENT_NOT_FOUND');
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it('retrieves an agent and computes similarity', async () => {
    const app = createApp(services, logger);
    await request(app).get(`/agents/${agentId}`).expect(200, agent);
    const response = await request(app)
      .post('/agents/similarity')
      .send({ query: 'supplier delay build' })
      .expect(200);
    expect(response.body.matches[0]).toMatchObject({ agentId, score: 85 });
  });

  it('lists governed source descriptors by role', async () => {
    const response = await request(createApp(services, logger))
      .get('/agents/sources')
      .query({ role: 'knowledge' })
      .expect(200);
    expect(response.body).toEqual({ role: 'knowledge', items: [source] });
    expect(services.sources.list).toHaveBeenCalledWith('knowledge');
  });

  it('creates and retrieves a draft specification', async () => {
    const app = createApp(services, logger);
    await request(app)
      .post('/agents/specs')
      .send({ baseAgentId: null, outcomes })
      .expect(201, spec);
    await request(app).get(`/agents/specs/${specId}`).expect(200, spec);
  });

  it.each([
    ['outcomes', outcomes, 'updateOutcomes'],
    ['knowledge', knowledge, 'updateKnowledge'],
    ['guardrails', guardrails, 'updateGuardrails'],
    ['outputs', outputs, 'updateOutputs'],
  ] as const)('replaces the %s section idempotently', async (section, body, method) => {
    await request(createApp(services, logger))
      .put(`/agents/specs/${specId}/${section}`)
      .send({ value: body })
      .expect(200, spec);
    expect(services.specs[method]).toHaveBeenCalledWith(specId, { value: body });
  });

  it('accepts generation, sets Location, enqueues, and returns pollable status', async () => {
    const app = createApp(services, logger);
    const response = await request(app)
      .post(`/agents/specs/${specId}/generate`)
      .expect(202, accepted);
    expect(response.headers.location).toBe(accepted.statusUrl);
    expect(services.dispatcher.enqueue).toHaveBeenCalledWith(jobId);
    await request(app).get(`/agents/generation-jobs/${jobId}`).expect(200, job);
  });

  it('recovers, shadow deploys, and returns evaluation results', async () => {
    const app = createApp(services, logger);
    await request(app).post(`/agents/${agentId}/recover`).expect(200, { agentId, status: 'draft' });
    await request(app).post(`/agents/${agentId}/shadow-deploy`).expect(200);
    const evaluation = await request(app).get(`/agents/${agentId}/evaluation`).expect(200);
    expect(evaluation.body).toMatchObject({
      agentId,
      status: 'not_started',
      summary: { total: 0 },
    });
  });

  it('interprets a single-shot prompt without creating a spec', async () => {
    const body = {
      kind: 'prompt',
      prompt:
        'Identify supplier delays, read governed build records, and prepare an evidence-backed escalation brief.',
    };
    await request(createApp(services, logger))
      .post('/agents/specs/interpret')
      .send(body)
      .expect(200, interpretation);
    expect(services.interpretations.interpret).toHaveBeenCalledWith(body);
    expect(services.specs.create).not.toHaveBeenCalled();
  });

  it('returns a typed dependency failure when the interpreter adapter is unavailable', async () => {
    services.interpretations.interpret = jest.fn(() =>
      Promise.reject(
        new AppError(
          503,
          'DEPENDENCY_UNAVAILABLE',
          'Specification interpretation is temporarily unavailable',
        ),
      ),
    );
    const response = await request(createApp(services, logger))
      .post('/agents/specs/interpret')
      .send({
        kind: 'prompt',
        prompt: 'Describe a governed supplier delay briefing workflow.',
      })
      .expect(503);
    expect(response.body.error).toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      message: 'Specification interpretation is temporarily unavailable',
    });
  });

  it('creates and polls certification runs and exposes version history', async () => {
    const app = createApp(services, logger);
    const acceptedResponse = await request(app)
      .post(`/agents/${agentId}/certification-runs`)
      .send({})
      .expect(202, certificationAccepted);
    expect(acceptedResponse.headers.location).toBe(certificationAccepted.statusUrl);
    expect(services.certificationDispatcher.enqueue).toHaveBeenCalledWith(runId);
    await request(app).get(`/agents/certification-runs/${runId}`).expect(200, certificationDetail);
    const history = await request(app).get(`/agents/${agentId}/certification-runs`).expect(200);
    expect(history.body.items).toHaveLength(1);
  });

  it('routes governed promotion, retirement, case, corpus, and gate-config operations', async () => {
    const app = createApp(services, logger);
    await request(app)
      .post(`/agents/${agentId}/promote`)
      .send({ runId, rationale: 'Promote after reviewed passing evidence.' })
      .expect(200);
    await request(app)
      .post(`/agents/${agentId}/retire`)
      .send({ rationale: 'Retire this superseded governed version.' })
      .expect(200);
    await request(app).get('/agents/eval-cases').expect(200);
    await request(app)
      .post('/agents/eval-cases')
      .send({
        key: evalCase.key,
        name: evalCase.name,
        input: evalCase.input,
        expectedOutput: evalCase.expectedOutput,
        expectedCitations: evalCase.expectedCitations,
        tags: evalCase.tags,
        source: evalCase.source,
        provenance: {},
      })
      .expect(201, evalCase);
    await request(app)
      .post(`/agents/eval-cases/${caseId}/deactivate`)
      .send({ rationale: 'No longer represents approved behavior.' })
      .expect(200);
    await request(app)
      .post('/agents/eval-corpus/publish')
      .send({ baseVersion: null, caseIds: [caseId], rationale: corpusVersion.rationale })
      .expect(201, corpusVersion);
    await request(app).get('/agents/certification-gate-configs').expect(200);
    await request(app)
      .post('/agents/certification-gate-configs/publish')
      .send({
        baseVersion: null,
        promotionFreshnessHours: gateConfig.promotionFreshnessHours,
        gates: gateConfig.gates,
        rationale: gateConfig.rationale,
      })
      .expect(201, gateConfig);
  });

  it('uses the centralized validation error envelope', async () => {
    const response = await request(createApp(services, logger))
      .post('/agents/similarity')
      .send({ query: 'x' })
      .expect(400);
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
    });
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });

  it('maps service dependency failures without route-level try/catch', async () => {
    services.health.check = jest.fn(() =>
      Promise.reject(new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'PostgreSQL unavailable')),
    );
    const response = await request(createApp(services, logger)).get('/health').expect(503);
    expect(response.body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
  });
});
