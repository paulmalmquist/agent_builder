import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  AgentStatus,
  CertificationGateKey,
  CertificationGateResultStatus,
  CertificationResultsAvailability,
  CertificationRunState,
  Prisma,
  PrismaClient,
  ResourceKind,
} from '@prisma/client';
import {
  agentSearchResponseSchema,
  agentSpecSchema,
  apiErrorSchema,
  certificationRunAcceptedSchema,
  certificationRunDetailSchema,
  evalCaseListResponseSchema,
  gateConfigListResponseSchema,
  interpretSpecResponseSchema,
  evaluationResponseSchema,
  generationAcceptedSchema,
  generationJobSchema,
  productionChannelMutationResponseSchema,
  releaseEvaluationSchema,
  sourceListResponseSchema,
  type GuardrailsSection,
  type KnowledgeSection,
  type OutcomesSection,
  type OutputsSection,
} from '@agent-builder/contracts';
import { pino } from 'pino';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { CertificationDispatcher } from '../src/certification/dispatcher.js';
import type { AgentExecutor } from '../src/certification/executor.js';
import { createServices } from '../src/services/create-services.js';
import { CertificationService } from '../src/services/certification-service.js';
import type { GenerationService } from '../src/services/generation-service.js';
import type { InterpretationService } from '../src/services/interpretation-service.js';
import { MaintenanceService } from '../src/services/maintenance-service.js';
import { PromotionService } from '../src/services/promotion-service.js';
import type { ServiceBundle } from '../src/services/types.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';

const runDatabaseIntegration = process.env['RUN_DATABASE_INTEGRATION'] === 'true';
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const logger = pino({ level: process.env['DEBUG_INTEGRATION'] === 'true' ? 'error' : 'silent' });
const passingChallengerId = '84357d19-acf2-435d-a8aa-959d493aa8c2';
const passingRunId = 'a2e8dc44-f48f-44fa-951b-e91a2f710882';
const supplierChampionId = '4a40357e-924f-46db-86ac-b8ed920be486';
const rejectedChallengerId = '7e2ab2cc-52e8-4cb8-92c3-256626cdade7';
const inventoryChampionId = 'fbcbcd95-15be-49c0-a8a7-a2bc361b7521';

const knowledge: KnowledgeSection = {
  sources: [
    {
      descriptorId: 'confluence-supplier-playbook',
      purpose: 'Use the approved escalation workflow',
      requiredCitations: true,
    },
  ],
};

const guardrails: GuardrailsSection = {
  workflowStages: ['Collect governed evidence', 'Prepare an approval-ready recommendation'],
  prohibitedActions: ['Do not contact suppliers or change production schedules'],
  approvalRequirements: ['Require a supply chain lead before escalation'],
  failClosedConditions: ['Stop when an authoritative source is unavailable'],
  responseRequirements: {
    citations: true,
    confidence: true,
    unresolvedConflicts: true,
  },
};

const outputs: OutputsSection = {
  outputType: 'decision_brief',
  outputSchema: {
    riskLevel: 'string',
    evidence: ['citation'],
    recommendation: 'string',
  },
  successMetrics: [
    {
      name: 'Evidence coverage',
      operator: 'gte',
      threshold: 0.95,
      unit: 'ratio',
    },
  ],
  acceptanceTests: [
    {
      name: 'Known delayed supplier',
      input: { supplier: 'Fixture Supplier', delayDays: 4 },
      expectedResult: { riskLevel: 'high', requiresApproval: true },
    },
  ],
};

function outcomes(name: string): OutcomesSection {
  return {
    name,
    department: 'Supply Chain',
    purpose:
      'Produces an evidence-backed supplier risk briefing for production planners and escalation owners.',
    audience: 'Production planners and supply chain leads',
    desiredOutcomes: ['Identify build exposure', 'Recommend a governed escalation path'],
    humanBaseline: 'An analyst currently reconciles source records manually.',
    exclusions: ['Do not contact suppliers'],
  };
}

async function waitForTerminalJob(
  services: ServiceBundle,
  jobId: string,
): Promise<ReturnType<typeof generationJobSchema.parse>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = generationJobSchema.parse(await services.generation.getJob(jobId));
    if (job.state === 'succeeded' || job.state === 'failed') return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Generation job ${jobId} did not reach a terminal state`);
}

async function waitForTerminalCertification(services: ServiceBundle, runId: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const detail = certificationRunDetailSchema.parse(
      await services.certification.getRun(runId, 50),
    );
    if (['passed', 'failed', 'error'].includes(detail.run.state)) return detail;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Certification run ${runId} did not reach a terminal state`);
}

describeDatabase('real PostgreSQL and generator CLI flow', () => {
  jest.setTimeout(30_000);

  const prisma = new PrismaClient();
  const createdAgentIds = new Set<string>();
  const workspaceRoot = process.cwd().endsWith(path.join('apps', 'backend'))
    ? path.resolve(process.cwd(), '..', '..')
    : process.cwd();
  const generatorCliPath = path.resolve(workspaceRoot, 'apps', 'generator-cli', 'dist', 'index.js');
  const config = {
    environment: 'test',
    host: '127.0.0.1',
    port: 3000,
    logLevel: 'silent',
    generatorCliPath,
    repositoryRoot: workspaceRoot,
    generatorVersion: '0.2.0',
    generatorConcurrency: 2,
    certificationConcurrency: 2,
    certificationRunTimeoutMs: 120_000,
    certificationExecutorVersion: '1.0.0',
    certificationFullRunRetention: 20,
    interpretationTtlHours: 24,
    maintenance: { enabled: false, hourUtc: 2 },
    automationScheduler: { enabled: false, intervalMs: 30_000, batchSize: 25 },
    profilePath: '.local/profile/profile.yaml',
    generatorTimeoutMs: 30_000,
    generatorMaxOutputBytes: 1_000_000,
    shutdownTimeoutMs: 15_000,
    auth: { enabled: false, actorId: 'integration-test' },
    providers: {
      bigquery: false,
      confluence: false,
      jira: false,
      email: false,
      slack: false,
      telemetry: false,
    },
    model: {
      provider: 'deterministic',
      providerPolicy: 'direct_allowed',
      name: 'daily-brief-fixture',
      timeoutMs: 30_000,
      inputUsdPerMillionTokens: 3,
      outputUsdPerMillionTokens: 15,
      pricingVersion: 'integration-test',
    },
    execution: { concurrency: 2, leaseMs: 60_000, dispatchMode: 'in_process' },
    repositorySourceCommit: 'a'.repeat(40),
    repositorySourceVerified: true,
    bigQuery: {
      enabled: false,
      projectId: null,
      maximumBytesBilled: 10_000_000,
      previewRowLimit: 25,
    },
  } as const;
  const services = createServices(prisma, config, logger);
  const app = createApp(services, logger, config);
  let generatedShadowAgentId: string | null = null;
  let staleCertificationRunId: string | null = null;

  beforeAll(async () => {
    if (!process.env['DATABASE_URL']) {
      throw new Error('RUN_DATABASE_INTEGRATION requires DATABASE_URL');
    }
    await prisma.$connect();
    const descriptor = await prisma.knowledgeSource.findUnique({
      where: {
        workspaceId_id: {
          workspaceId: LOCAL_WORKSPACE_ID,
          id: 'confluence-supplier-playbook',
        },
      },
    });
    if (!descriptor) {
      throw new Error('Integration database must be migrated and seeded before tests');
    }
  });

  afterAll(async () => {
    // CI provisions a disposable database. Governed lineage and audit records are
    // append-only by design, so integration cleanup must not weaken those guards.
    await prisma.$disconnect();
  });

  async function createReadySpec(name: string) {
    const initialOutcomes = outcomes(name);
    const created = await services.specs.create({
      baseAgentId: null,
      outcomes: initialOutcomes,
    });
    createdAgentIds.add(created.agentId);
    await services.specs.updateOutcomes(created.id, initialOutcomes);
    await services.specs.updateKnowledge(created.id, knowledge);
    await services.specs.updateGuardrails(created.id, guardrails);
    return services.specs.updateOutputs(created.id, outputs);
  }

  async function clonePassingRunAsStale(): Promise<string> {
    const source = await prisma.certificationRun.findUniqueOrThrow({
      where: { id: passingRunId },
    });
    const id = randomUUID();
    await prisma.certificationRun.create({
      data: {
        id,
        agentVersionId: source.agentVersionId,
        familyId: source.familyId,
        championVersionId: source.championVersionId,
        kind: source.kind,
        originStatus: source.originStatus,
        state: CertificationRunState.PASSED,
        corpusVersionId: source.corpusVersionId,
        corpusVersion: source.corpusVersion,
        gateConfigId: source.gateConfigId,
        gateConfigVersion: source.gateConfigVersion,
        corpusSnapshot: source.corpusSnapshot as Prisma.InputJsonValue,
        gateConfigSnapshot: source.gateConfigSnapshot as Prisma.InputJsonValue,
        subjectSnapshot: source.subjectSnapshot as Prisma.InputJsonValue,
        championSnapshot:
          source.championSnapshot === null
            ? Prisma.DbNull
            : (source.championSnapshot as Prisma.InputJsonValue),
        subjectManifestSnapshot: source.subjectManifestSnapshot as Prisma.InputJsonValue,
        championManifestSnapshot:
          source.championManifestSnapshot === null
            ? Prisma.DbNull
            : (source.championManifestSnapshot as Prisma.InputJsonValue),
        subjectManifestHash: source.subjectManifestHash,
        championManifestHash: source.championManifestHash,
        specRevision: source.specRevision,
        generatorVersion: source.generatorVersion,
        executorKind: source.executorKind,
        executorVersion: source.executorVersion,
        evaluationMode: source.evaluationMode,
        progress: 100,
        message: 'Passing evidence outside the freshness window',
        totalCaseCount: 0,
        passedCaseCount: 0,
        failedCaseCount: 0,
        verdict: source.verdict,
        requestedBy: 'integration-test',
        startedBy: 'system:background',
        requestedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        startedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        finishedAt: new Date(Date.now() - 47 * 60 * 60 * 1000),
        promotionExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    return id;
  }

  it('runs the daily brief from manifest import through authority, outcome, and metrics', async () => {
    const referencePath = path.resolve(
      workspaceRoot,
      '05-reference',
      'briefing-principles',
      'manifest.yaml',
    );
    const skillPath = path.resolve(workspaceRoot, '02-skills', 'daily-brief', 'manifest.yaml');
    const referenceImport = await request(app)
      .post('/v1/repository-imports')
      .send({
        manifestYaml: await readFile(referencePath, 'utf8'),
        sourcePath: '05-reference/briefing-principles/manifest.yaml',
      })
      .expect(201);
    expect(referenceImport.body.import.sourceCommit).toBe(
      process.env['REPOSITORY_SOURCE_COMMIT'] ?? 'synthetic-baseline',
    );
    const skillImport = await request(app)
      .post('/v1/repository-imports')
      .send({
        manifestYaml: await readFile(skillPath, 'utf8'),
        sourcePath: '02-skills/daily-brief/manifest.yaml',
      })
      .expect(201);
    const repeated = await request(app)
      .post('/v1/repository-imports')
      .send({
        manifestYaml: await readFile(skillPath, 'utf8'),
        sourcePath: '02-skills/daily-brief/manifest.yaml',
      })
      .expect(201);
    expect(repeated.body.idempotent).toBe(true);

    const release = await request(app)
      .post('/v1/releases')
      .send({
        resourceVersionIds: [
          referenceImport.body.resource.id as string,
          skillImport.body.resource.id as string,
        ],
        projectId: null,
      })
      .expect(201);
    const runInput = {
      date: '2026-08-16',
      timezone: 'America/New_York',
      priorities: ['Complete the governed vertical slice'],
      calendarItems: [],
      tasks: ['Verify the execution outcome'],
      signals: ['A platform integration test is pending'],
      userConstraints: [],
    };
    const implicitDraft = await request(app)
      .post('/v1/execution-runs')
      .send({
        releaseId: release.body.id,
        entryResourceVersionId: skillImport.body.resource.id,
        authorityGrantId: null,
        input: runInput,
        maxInputTokens: 2000,
        maxOutputTokens: 1000,
        maxEstimatedCostUsd: 1,
        idempotencyKey: `daily-brief-implicit-${randomUUID()}`,
      })
      .expect(422);
    expect(implicitDraft.body.error.code).toBe('EXPLICIT_DEVELOPMENT_RUN_REQUIRED');
    const awaiting = await request(app)
      .post('/v1/execution-runs')
      .send({
        releaseId: release.body.id,
        entryResourceVersionId: skillImport.body.resource.id,
        authorityGrantId: null,
        input: runInput,
        maxInputTokens: 2000,
        maxOutputTokens: 1000,
        maxEstimatedCostUsd: 1,
        idempotencyKey: `daily-brief-awaiting-${randomUUID()}`,
        developmentDraft: true,
      })
      .expect(202);
    expect(awaiting.body.state).toBe('awaiting_approval');
    const approved = await request(app)
      .post(`/v1/execution-runs/${awaiting.body.id as string}/approve`)
      .send({
        entryResourceVersionId: skillImport.body.resource.id,
        projectId: null,
        inputConstraints: { timezone: 'America/New_York' },
        toolScopes: [],
        validUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        maxRuns: 2,
        maxEstimatedCostPerRunUsd: 1,
        totalCostBudgetUsd: 2,
        rationale: 'Approve this bounded synthetic daily briefing execution.',
      })
      .expect(200);
    expect(approved.body.run.state).toBe('queued');

    let terminal: { state: string } | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      terminal = (
        await request(app)
          .get(`/v1/execution-runs/${awaiting.body.id as string}`)
          .expect(200)
      ).body as { state: string };
      if (terminal.state === 'succeeded' || terminal.state === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(terminal?.state).toBe('succeeded');
    const outcomesResponse = await request(app)
      .get('/v1/outcomes')
      .query({ runId: awaiting.body.id })
      .expect(200);
    expect(outcomesResponse.body.items).toHaveLength(1);
    expect(outcomesResponse.body.items[0].output.topPriorities).toEqual([
      'Complete the governed vertical slice',
    ]);
    const metricsResponse = await request(app)
      .get('/v1/metrics')
      .query({ runId: awaiting.body.id })
      .expect(200);
    expect(metricsResponse.body.items).toHaveLength(5);

    const automatic = await request(app)
      .post('/v1/execution-runs')
      .send({
        releaseId: release.body.id,
        entryResourceVersionId: skillImport.body.resource.id,
        authorityGrantId: approved.body.grant.id,
        input: runInput,
        maxInputTokens: 2000,
        maxOutputTokens: 1000,
        maxEstimatedCostUsd: 1,
        idempotencyKey: `daily-brief-authorized-${randomUUID()}`,
        developmentDraft: true,
      })
      .expect(202);
    expect(automatic.body.state).toBe('queued');
    await request(app)
      .post(`/v1/authority-grants/${approved.body.grant.id as string}/revoke`)
      .expect(200);

    const paused = await request(app)
      .post('/v1/execution-runs')
      .send({
        releaseId: release.body.id,
        entryResourceVersionId: skillImport.body.resource.id,
        authorityGrantId: null,
        input: runInput,
        maxInputTokens: 2000,
        maxOutputTokens: 1000,
        maxEstimatedCostUsd: 0,
        idempotencyKey: `daily-brief-budget-${randomUUID()}`,
        developmentDraft: true,
      })
      .expect(202);
    expect(paused.body.state).toBe('paused_budget');
    await request(app).get('/v1/resources').query({ kind: 'Skill' }).expect(200);
    await request(app).get('/v1/execution-runs').expect(200);
    await request(app).get('/v1/authority-grants').expect(200);
  });

  it('certifies immutable releases and atomically promotes and rolls back production', async () => {
    const skillFamilyId = randomUUID();
    const suiteFamilyId = randomUUID();
    const skillYaml = (version: string, lifecycle = 'candidate') => `apiVersion: paul-os/v1
kind: Skill
metadata:
  id: ${skillFamilyId}
  slug: governance-brief-${skillFamilyId.slice(0, 8)}
  version: ${version}
  owner: integration-test
  purpose: Produce a deterministic and cited governance briefing for integration testing.
  lifecycle: ${lifecycle}
  provenance: synthetic
dependencies: []
spec:
  inputSchema:
    type: object
    properties:
      calendarItems: { type: array }
  outputSchema:
    type: object
    required: [scheduleRisks, citations]
    properties:
      scheduleRisks: { type: array }
      citations: { type: array }
  tools: []
  permissions: []
  contextRequirements: []
  successCriteria: [Return a schema-valid result.]
`;
    const suiteYaml = (version: string, subjectVersion: string) => `apiVersion: paul-os/v1
kind: EvaluationSuite
metadata:
  id: ${suiteFamilyId}
  slug: governance-suite-${suiteFamilyId.slice(0, 8)}
  version: ${version}
  owner: integration-test
  purpose: Verify deterministic release contract evidence without semantic quality claims.
  lifecycle: candidate
  provenance: synthetic
dependencies:
  - familyId: ${skillFamilyId}
    version: ${subjectVersion}
spec:
  subject: governance-brief-${skillFamilyId.slice(0, 8)}@${subjectVersion}
  executorKind: deterministic_contract
  evaluationMode: contract_validation
  corpusVersion: 1
  cases:
    - key: contract-shape
      fixture: synthetic
      assertions:
        - output_schema_valid
        - schedule_risk_present
        - citations_resolve_to_supplied_calendar_items
        - no_attempted_actions
  gates:
    schemaConformance: 1
    citationCoverage: 1
    unauthorizedActions: 0
`;
    const importManifest = async (manifestYaml: string) =>
      request(app)
        .post('/v1/repository-imports')
        .send({ manifestYaml, sourcePath: null })
        .expect(201);
    const buildRelease = async (version: string) => {
      const skillImport = await importManifest(skillYaml(version));
      const suiteImport = await importManifest(suiteYaml(version, version));
      return request(app)
        .post('/v1/releases')
        .send({
          resourceVersionIds: [
            skillImport.body.resource.id as string,
            suiteImport.body.resource.id as string,
          ],
          projectId: null,
        })
        .expect(201);
    };

    await request(app)
      .post('/v1/repository-imports')
      .send({
        manifestYaml: skillYaml('9.9.9', 'certified'),
        sourcePath: null,
      })
      .expect(422);

    const firstRelease = await buildRelease('1.0.0');
    const firstSuite = await prisma.resourceVersion.findUniqueOrThrow({
      where: { familyId_version: { familyId: suiteFamilyId, version: '1.0.0' } },
    });
    await expect(
      prisma.$executeRaw`UPDATE "ResourceVersion" SET "lifecycle" = 'certified' WHERE "id" = ${firstSuite.id}::uuid`,
    ).rejects.toThrow(/Certification requires immutable passing release evidence/);

    const firstEvidenceResponse = await request(app)
      .post('/v1/release-evaluations')
      .send({ releaseId: firstRelease.body.id, suiteVersionId: firstSuite.id })
      .expect(201);
    const firstEvidence = releaseEvaluationSchema.parse(firstEvidenceResponse.body);
    expect(firstEvidence.verdict).toBe('passed');
    expect(firstEvidence.disclaimer).toContain('does not measure semantic model quality');

    await request(app)
      .post('/v1/production-channels/default/promote')
      .send({ releaseId: firstRelease.body.id, evaluationId: firstEvidence.id, rationale: 'short' })
      .expect(400);
    const firstPromotionResponse = await request(app)
      .post('/v1/production-channels/default/promote')
      .send({
        releaseId: firstRelease.body.id,
        evaluationId: firstEvidence.id,
        rationale: 'Promote the first fully certified integration release.',
      });
    if (firstPromotionResponse.status !== 200) {
      throw new Error(`Promotion failed: ${JSON.stringify(firstPromotionResponse.body)}`);
    }
    const firstPromotion = productionChannelMutationResponseSchema.parse(
      firstPromotionResponse.body,
    );
    expect(firstPromotion.channel.currentReleaseId).toBe(firstRelease.body.id);

    const secondRelease = await buildRelease('1.1.0');
    await request(app)
      .post('/v1/production-channels/default/promote')
      .send({
        releaseId: secondRelease.body.id,
        evaluationId: firstEvidence.id,
        rationale: 'Attempt to bypass exact release certification evidence.',
      })
      .expect(422);
    const unchanged = await request(app).get('/v1/production-channels/default').expect(200);
    expect(unchanged.body.currentReleaseId).toBe(firstRelease.body.id);

    const secondSuite = await prisma.resourceVersion.findUniqueOrThrow({
      where: { familyId_version: { familyId: suiteFamilyId, version: '1.1.0' } },
    });
    const secondEvidenceResponse = await request(app)
      .post('/v1/release-evaluations')
      .send({ releaseId: secondRelease.body.id, suiteVersionId: secondSuite.id })
      .expect(201);
    const secondEvidence = releaseEvaluationSchema.parse(secondEvidenceResponse.body);
    await request(app)
      .post('/v1/production-channels/default/promote')
      .send({
        releaseId: secondRelease.body.id,
        evaluationId: secondEvidence.id,
        rationale: 'Promote the certified successor for rollback testing.',
      })
      .expect(200);

    await request(app)
      .post('/v1/production-channels/default/rollback')
      .send({
        targetReleaseId: randomUUID(),
        rationale: 'This target has no immutable prior production evidence.',
      })
      .expect(422);
    const afterRejectedRollback = await request(app)
      .get('/v1/production-channels/default')
      .expect(200);
    expect(afterRejectedRollback.body.currentReleaseId).toBe(secondRelease.body.id);

    const rollbackResponse = await request(app)
      .post('/v1/production-channels/default/rollback')
      .send({
        targetReleaseId: firstRelease.body.id,
        rationale: 'Restore the prior certified release after a synthetic regression.',
      })
      .expect(200);
    const rollback = productionChannelMutationResponseSchema.parse(rollbackResponse.body);
    expect(rollback.channel.currentReleaseId).toBe(firstRelease.body.id);
    expect(rollback.channel.priorReleaseId).toBe(secondRelease.body.id);

    await expect(
      prisma.$executeRaw`UPDATE "ReleaseEvaluation" SET "requestedBy" = 'tampered' WHERE "id" = ${firstEvidence.id}::uuid`,
    ).rejects.toThrow(/immutable/);
  });

  it('enforces frozen resource immutability below the service layer', async () => {
    const frozen = await prisma.resourceVersion.findFirstOrThrow({
      where: { family: { slug: 'daily-brief' }, version: '1.1.0' },
    });
    await expect(
      prisma.$executeRaw`
        UPDATE "ResourceVersion"
        SET "lifecycle" = 'experimental'
        WHERE "id" = ${frozen.id}::uuid
      `,
    ).rejects.toThrow(/cannot move backwards|freeze_check/i);
    await expect(
      prisma.$executeRaw`
        UPDATE "ResourceVersion"
        SET "owner" = 'tampered-owner',
            "purpose" = 'Tampered purpose that bypasses the registry service.',
            "provenance" = '{"source":"tampered"}'::jsonb,
            "dependencyPins" = '[]'::jsonb,
            "definition" = jsonb_set("definition", '{metadata,owner}', '"tampered"'),
            "digest" = ${'f'.repeat(64)}
        WHERE "id" = ${frozen.id}::uuid
      `,
    ).rejects.toThrow(/immutable/i);

    const familyId = randomUUID();
    await prisma.resourceFamily.create({
      data: {
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        id: familyId,
        kind: ResourceKind.SKILL,
        slug: `frozen-insert-${familyId.slice(0, 8)}`,
        name: 'Frozen insert invariant fixture',
        createdBy: 'integration-test',
        updatedBy: 'integration-test',
      },
    });
    await expect(
      prisma.$executeRaw`
        INSERT INTO "ResourceVersion" (
          "id", "familyId", "version", "lifecycle", "owner", "purpose", "definition",
          "digest", "sourceCommit", "provenance", "dependencyPins", "revision", "frozenAt",
          "createdBy", "updatedBy", "createdAt", "updatedAt"
        ) VALUES (
          ${randomUUID()}::uuid, ${familyId}::uuid, '1.0.0', 'candidate', 'integration-test',
          'A direct SQL insert without freeze evidence must fail.', '{}'::jsonb, ${'e'.repeat(64)},
          'integration-test', '{}'::jsonb, '[]'::jsonb, 1, NULL,
          'integration-test', 'integration-test', NOW(), NOW()
        )
      `,
    ).rejects.toThrow(/frozenAt|freeze_check/i);
  });

  it('runs search through evaluation and atomically rejects a duplicate generation claim', async () => {
    const search = await request(app)
      .get('/agents')
      .query({ query: 'supplier delay build' })
      .expect(200);
    expect(agentSearchResponseSchema.parse(search.body).items.length).toBeGreaterThan(0);

    await request(app)
      .post('/agents/similarity')
      .send({ query: 'supplier delay build escalation' })
      .expect(200);

    const createdResponse = await request(app)
      .post('/agents/specs')
      .send({ baseAgentId: null, outcomes: outcomes('Integration Supplier Risk Brief') })
      .expect(201);
    let spec = agentSpecSchema.parse(createdResponse.body);
    createdAgentIds.add(spec.agentId);

    spec = agentSpecSchema.parse(
      (
        await request(app)
          .put(`/agents/specs/${spec.id}/outcomes`)
          .send({ value: outcomes('Integration Supplier Risk Brief') })
          .expect(200)
      ).body,
    );
    spec = agentSpecSchema.parse(
      (
        await request(app)
          .put(`/agents/specs/${spec.id}/knowledge`)
          .send({ value: knowledge })
          .expect(200)
      ).body,
    );
    spec = agentSpecSchema.parse(
      (
        await request(app)
          .put(`/agents/specs/${spec.id}/guardrails`)
          .send({ value: guardrails })
          .expect(200)
      ).body,
    );
    spec = agentSpecSchema.parse(
      (
        await request(app)
          .put(`/agents/specs/${spec.id}/outputs`)
          .send({ value: outputs })
          .expect(200)
      ).body,
    );
    expect(spec.status).toBe('ready');
    expect(Object.values(spec.completion)).toEqual([true, true, true, true]);

    const attempts = await Promise.all([
      request(app).post(`/agents/specs/${spec.id}/generate`).send({}),
      request(app).post(`/agents/specs/${spec.id}/generate`).send({}),
    ]);
    expect(
      attempts.map((response) => ({
        status: response.status,
        code: response.body?.error?.code ?? null,
      })),
    ).toEqual(
      expect.arrayContaining([
        { status: 202, code: null },
        { status: 409, code: 'GENERATION_IN_PROGRESS' },
      ]),
    );
    const acceptedResponse = attempts.find((response) => response.status === 202);
    const conflictResponse = attempts.find((response) => response.status === 409);
    expect(acceptedResponse).toBeDefined();
    expect(conflictResponse).toBeDefined();

    const accepted = generationAcceptedSchema.parse(acceptedResponse?.body);
    const conflict = apiErrorSchema.parse(conflictResponse?.body);
    expect(conflict.error.code).toBe('GENERATION_IN_PROGRESS');
    expect(conflict.error.details).toMatchObject({
      jobId: accepted.jobId,
      statusUrl: accepted.statusUrl,
    });

    const completed = await waitForTerminalJob(services, accepted.jobId);
    expect(completed.state).toBe('succeeded');
    expect(completed.manifest).toMatchObject({
      agentId: accepted.agentId,
      specRevision: spec.revision,
      generatorVersion: '0.2.0',
    });

    await request(app).post(`/agents/${accepted.agentId}/shadow-deploy`).send({}).expect(200);
    generatedShadowAgentId = accepted.agentId;
    const evaluationResponse = await request(app)
      .get(`/agents/${accepted.agentId}/evaluation`)
      .expect(200);
    const evaluation = evaluationResponseSchema.parse(evaluationResponse.body);
    expect(evaluation.status).toBe('complete');
    expect(evaluation.summary).toMatchObject({ passed: 1, failed: 0, total: 1, score: 1 });
    const storedAgent = await prisma.agent.findUniqueOrThrow({ where: { id: accepted.agentId } });
    const storedSpec = await prisma.agentSpec.findUniqueOrThrow({ where: { id: spec.id } });
    expect(storedAgent.createdBy).toBe('integration-test');
    expect(storedSpec.createdBy).toBe('integration-test');
    const auditWhere = {
      entityId: { in: [accepted.agentId, spec.id, accepted.jobId] },
    };
    expect(await prisma.auditEvent.count({ where: auditWhere })).toBeGreaterThanOrEqual(7);
    const immutableEvent = await prisma.auditEvent.findFirstOrThrow({ where: auditWhere });
    await expect(
      prisma.auditEvent.update({
        where: { id: immutableEvent.id },
        data: { action: 'tampered' },
      }),
    ).rejects.toBeDefined();
  });

  it('runs governed interpretation, family listing, certification, and atomic promotion', async () => {
    expect(generatedShadowAgentId).not.toBeNull();
    const interpretation = interpretSpecResponseSchema.parse(
      (
        await request(app)
          .post('/agents/specs/interpret')
          .send({
            kind: 'prompt',
            prompt:
              'Identify supplier delays, read governed build records, and prepare a cited escalation brief for production planners.',
          })
          .expect(200)
      ).body,
    );
    expect(interpretation.kind).toBe('prefill');
    const elevatedAuthority = interpretSpecResponseSchema.parse(
      (
        await request(app)
          .post('/agents/specs/interpret')
          .send({
            kind: 'prompt',
            prompt:
              'Read our ERP and give it write access to production holds so it can update records after supplier delays.',
          })
          .expect(200)
      ).body,
    );
    expect(elevatedAuthority).toMatchObject({ kind: 'prefill' });
    if (elevatedAuthority.kind !== 'prefill') throw new Error('Expected authority prefill');
    expect(
      elevatedAuthority.sections.knowledge.unresolved.some(
        (item) => item.message === 'Map “our ERP” to a governed descriptor.',
      ),
    ).toBe(true);
    expect(elevatedAuthority.sections.guardrails.needsReview).toBe(true);
    const interpretedDescriptorIds =
      elevatedAuthority.sections.knowledge.value?.sources.map(({ descriptorId }) => descriptorId) ??
      [];
    expect(
      await prisma.knowledgeSource.count({
        where: { id: { in: interpretedDescriptorIds } },
      }),
    ).toBe(interpretedDescriptorIds.length);
    if (
      elevatedAuthority.sections.outcomes.value === null ||
      elevatedAuthority.sections.knowledge.value === null
    ) {
      throw new Error('Expected interpreted outcomes and registry-backed knowledge');
    }
    const interpretedSpec = agentSpecSchema.parse(
      (
        await request(app)
          .post('/agents/specs')
          .send({
            baseAgentId: null,
            interpretationId: elevatedAuthority.interpretationId,
            outcomes: elevatedAuthority.sections.outcomes.value,
          })
          .expect(201)
      ).body,
    );
    expect(interpretedSpec).toMatchObject({ outcomes: null, status: 'draft' });
    expect(
      apiErrorSchema.parse(
        (
          await request(app)
            .put(`/agents/specs/${interpretedSpec.id}/outcomes`)
            .send({ value: elevatedAuthority.sections.outcomes.value })
            .expect(422)
        ).body,
      ).error.code,
    ).toBe('INTERPRETATION_CONFIRMATION_REQUIRED');
    await request(app)
      .put(`/agents/specs/${interpretedSpec.id}/outcomes`)
      .send({
        value: elevatedAuthority.sections.outcomes.value,
        interpretationConfirmation: {
          interpretationId: elevatedAuthority.interpretationId,
          resolutions: elevatedAuthority.sections.outcomes.unresolved.map((item) => ({
            unresolvedId: item.id,
            action: 'acknowledge',
            rationale: 'Reviewed and narrowed by the integration actor',
          })),
        },
      })
      .expect(200);
    const invalidKnowledgeMapping = await request(app)
      .put(`/agents/specs/${interpretedSpec.id}/knowledge`)
      .send({
        value: elevatedAuthority.sections.knowledge.value,
        interpretationConfirmation: {
          interpretationId: elevatedAuthority.interpretationId,
          resolutions: elevatedAuthority.sections.knowledge.unresolved.map((item) => ({
            unresolvedId: item.id,
            action: 'map_source',
            descriptorId: 'client-injected-table-name',
          })),
        },
      })
      .expect(422);
    expect(apiErrorSchema.parse(invalidKnowledgeMapping.body).error.code).toBe(
      'INTERPRETATION_UNRESOLVED',
    );
    await request(app)
      .put(`/agents/specs/${interpretedSpec.id}/knowledge`)
      .send({
        value: elevatedAuthority.sections.knowledge.value,
        interpretationConfirmation: {
          interpretationId: elevatedAuthority.interpretationId,
          resolutions: elevatedAuthority.sections.knowledge.unresolved.map((item) => ({
            unresolvedId: item.id,
            action: 'remove',
          })),
        },
      })
      .expect(200);
    const split = interpretSpecResponseSchema.parse(
      (
        await request(app)
          .post('/agents/specs/interpret')
          .send({
            kind: 'prompt',
            prompt:
              'When a supplier is late then create a risk brief and also when a defect is found then prepare a quality report.',
          })
          .expect(200)
      ).body,
    );
    expect(split.kind).toBe('split_required');
    if (split.kind !== 'split_required') throw new Error('Expected split interpretation');
    const selectedBranch = interpretSpecResponseSchema.parse(
      (
        await request(app)
          .post('/agents/specs/interpret')
          .send({
            kind: 'split_selection',
            parentInterpretationId: split.interpretationId,
            candidateId: split.candidates[0]?.id,
          })
          .expect(200)
      ).body,
    );
    const siblingBranch = interpretSpecResponseSchema.parse(
      (
        await request(app)
          .post('/agents/specs/interpret')
          .send({
            kind: 'split_selection',
            parentInterpretationId: split.interpretationId,
            candidateId: split.candidates[1]?.id,
          })
          .expect(200)
      ).body,
    );
    if (
      selectedBranch.kind !== 'prefill' ||
      siblingBranch.kind !== 'prefill' ||
      selectedBranch.sections.outcomes.value === null ||
      siblingBranch.sections.outcomes.value === null
    ) {
      throw new Error('Expected both split selections to produce prefilled branches');
    }
    const branchSpec = agentSpecSchema.parse(
      (
        await request(app)
          .post('/agents/specs')
          .send({
            baseAgentId: null,
            interpretationId: selectedBranch.interpretationId,
            outcomes: selectedBranch.sections.outcomes.value,
          })
          .expect(201)
      ).body,
    );
    expect(
      apiErrorSchema.parse(
        (
          await request(app)
            .put(`/agents/specs/${branchSpec.id}/outcomes`)
            .send({
              value: siblingBranch.sections.outcomes.value,
              interpretationConfirmation: {
                interpretationId: siblingBranch.interpretationId,
                resolutions: [],
              },
            })
            .expect(409)
        ).body,
      ).error.code,
    ).toBe('INTERPRETATION_LINEAGE_MISMATCH');

    const familyVersions = await request(app)
      .get('/agents')
      .query({ familyId: '4a40357e-924f-46db-86ac-b8ed920be486', includeRetired: 'true' })
      .expect(200);
    expect(familyVersions.body).toMatchObject({ mode: 'family_versions' });
    expect(familyVersions.body.items).toHaveLength(3);

    const certification = services.certification as CertificationService;
    const orphaned = await certification.createRun(generatedShadowAgentId as string);
    await expect(certification.createRun(generatedShadowAgentId as string)).rejects.toMatchObject({
      status: 409,
      code: 'CERTIFICATION_IN_PROGRESS',
    });
    await prisma.certificationRun.update({
      where: { id: orphaned.runId },
      data: {
        state: CertificationRunState.RUNNING,
        startedAt: new Date(),
        startedBy: 'system:background',
      },
    });
    expect(await certification.reapRunningRuns()).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.certificationRun.findUniqueOrThrow({ where: { id: orphaned.runId } }),
    ).toMatchObject({
      state: CertificationRunState.ERROR,
      totalCaseCount: 0,
      passedCaseCount: 0,
      failedCaseCount: 0,
    });
    expect((await services.catalog.getAgent(generatedShadowAgentId as string)).status).toBe(
      'shadow',
    );

    let releaseTimedOutExecution: (() => void) | undefined;
    const slowExecutor: AgentExecutor = {
      kind: 'manifest_fixture',
      version: '1.0.0-timeout-test',
      evaluationMode: 'corpus_coverage',
      execute: () =>
        new Promise((resolve) => {
          releaseTimedOutExecution = () =>
            resolve({ output: null, citations: [], attemptedActions: [], resolved: false });
        }),
    };
    const slowCertification = new CertificationService(prisma, slowExecutor);
    const timeoutDispatcher = new CertificationDispatcher(1, slowCertification, logger, 10);
    const timedOut = await slowCertification.createRun(generatedShadowAgentId as string);
    timeoutDispatcher.enqueue(timedOut.runId);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const run = await prisma.certificationRun.findUniqueOrThrow({
        where: { id: timedOut.runId },
      });
      if (run.state === CertificationRunState.ERROR) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(
      await prisma.certificationRun.findUniqueOrThrow({ where: { id: timedOut.runId } }),
    ).toMatchObject({
      state: CertificationRunState.ERROR,
      error: { code: 'CERTIFICATION_TIMEOUT' },
      totalCaseCount: 0,
    });
    releaseTimedOutExecution?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      await prisma.certificationRun.findUniqueOrThrow({ where: { id: timedOut.runId } }),
    ).toMatchObject({ state: CertificationRunState.ERROR, totalCaseCount: 0 });
    expect(await prisma.evalCaseResult.count({ where: { runId: timedOut.runId } })).toBe(0);

    const certificationAccepted = certificationRunAcceptedSchema.parse(
      (
        await request(app)
          .post(`/agents/${generatedShadowAgentId as string}/certification-runs`)
          .send({})
          .expect(202)
      ).body,
    );
    const completed = await waitForTerminalCertification(services, certificationAccepted.runId);
    expect(['failed', 'passed']).toContain(completed.run.state);
    expect(completed.run).toMatchObject({
      executorKind: 'manifest_fixture',
      executorVersion: '1.0.0',
      evaluationMode: 'corpus_coverage',
      caseCounts: {
        total: expect.any(Number),
        passed: expect.any(Number),
        failed: expect.any(Number),
      },
    });
    expect(
      await prisma.auditEvent.findFirstOrThrow({
        where: { action: 'certification.started', entityId: certificationAccepted.runId },
      }),
    ).toMatchObject({ actorId: 'system:background' });

    await request(app)
      .post(`/agents/${passingChallengerId}/promote`)
      .send({ runId: passingRunId, rationale: '' })
      .expect(400);
    const rejectedRun = await prisma.certificationRun.findFirstOrThrow({
      where: { agentVersionId: rejectedChallengerId, state: CertificationRunState.FAILED },
    });
    expect(
      apiErrorSchema.parse(
        (
          await request(app)
            .post(`/agents/${rejectedChallengerId}/promote`)
            .send({
              runId: rejectedRun.id,
              rationale: 'Attempting to bypass a deliberately failed certification run.',
            })
            .expect(409)
        ).body,
      ).error.code,
    ).toBe('INVALID_AGENT_TRANSITION');

    const staleRunId = await clonePassingRunAsStale();
    staleCertificationRunId = staleRunId;
    expect(
      apiErrorSchema.parse(
        (
          await request(app)
            .post(`/agents/${passingChallengerId}/promote`)
            .send({
              runId: staleRunId,
              rationale: 'Attempting to use certification evidence outside its freshness window.',
            })
            .expect(409)
        ).body,
      ).error,
    ).toMatchObject({
      code: 'PROMOTION_INELIGIBLE',
      details: { blockers: [{ code: 'run_stale' }] },
    });
    const wrongKindRunId = await clonePassingRunAsStale();
    await prisma.certificationRun.update({
      where: { id: wrongKindRunId },
      data: {
        kind: 'CHAMPION_RECERTIFICATION',
        promotionExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    expect(
      apiErrorSchema.parse(
        (
          await request(app)
            .post(`/agents/${passingChallengerId}/promote`)
            .send({
              runId: wrongKindRunId,
              rationale: 'Attempting to misuse a champion health run as promotion evidence.',
            })
            .expect(409)
        ).body,
      ).error,
    ).toMatchObject({
      code: 'PROMOTION_INELIGIBLE',
      details: { blockers: [{ code: 'run_kind_not_promotable' }] },
    });
    for (const gate of [
      CertificationGateKey.FACTUAL_ACCURACY,
      CertificationGateKey.CHAMPION_REGRESSION,
    ]) {
      await prisma.certificationGateResult.update({
        where: { runId_gate: { runId: passingRunId, gate } },
        data: { status: CertificationGateResultStatus.NOT_APPLICABLE },
      });
      expect(
        apiErrorSchema.parse(
          (
            await request(app)
              .post(`/agents/${passingChallengerId}/promote`)
              .send({
                runId: passingRunId,
                rationale:
                  'Attempting to promote with an inapplicable required certification gate.',
              })
              .expect(409)
          ).body,
        ).error,
      ).toMatchObject({
        code: 'PROMOTION_INELIGIBLE',
        details: { blockers: [{ code: 'run_not_passed' }] },
      });
      await prisma.certificationGateResult.update({
        where: { runId_gate: { runId: passingRunId, gate } },
        data: { status: CertificationGateResultStatus.PASSED },
      });
    }
    await expect(
      prisma.agent.update({
        where: { id: passingChallengerId },
        data: { status: AgentStatus.ACTIVE },
      }),
    ).rejects.toBeDefined();

    const crashApp = createApp(
      {
        ...services,
        promotion: new PromotionService(prisma, () => {
          throw new Error('injected promotion checkpoint crash');
        }),
      },
      logger,
      config,
    );
    await request(crashApp)
      .post(`/agents/${passingChallengerId}/promote`)
      .send({
        runId: passingRunId,
        rationale: 'Inject a crash to prove the champion swap transaction rolls back.',
      })
      .expect(500);
    expect(
      await prisma.agentFamily.findUniqueOrThrow({ where: { id: supplierChampionId } }),
    ).toMatchObject({ championAgentId: supplierChampionId });
    expect(
      await prisma.agent.findUniqueOrThrow({ where: { id: supplierChampionId } }),
    ).toMatchObject({ status: AgentStatus.ACTIVE });
    expect(
      await prisma.agent.findUniqueOrThrow({ where: { id: passingChallengerId } }),
    ).toMatchObject({ status: AgentStatus.CERTIFIED });
    expect(
      await prisma.certificationRun.findUniqueOrThrow({ where: { id: passingRunId } }),
    ).toMatchObject({ isPromotionEvidence: false, resultsAvailability: 'FULL' });
    expect(
      await prisma.promotionDecision.findUnique({ where: { runId: passingRunId } }),
    ).toBeNull();

    const attempts = await Promise.all([
      request(app).post(`/agents/${passingChallengerId}/promote`).send({
        runId: passingRunId,
        rationale: 'Promote after reviewing the complete passing evidence.',
      }),
      request(app).post(`/agents/${passingChallengerId}/promote`).send({
        runId: passingRunId,
        rationale: 'Promote after reviewing the complete passing evidence.',
      }),
    ]);
    expect(attempts.map(({ status }) => status)).toEqual(expect.arrayContaining([200, 409]));
    expect(attempts.find(({ status }) => status === 409)?.body.error.code).toMatch(
      /PROMOTION_(?:CONFLICT|INELIGIBLE)/,
    );
    const promoted = await prisma.agent.findUniqueOrThrow({ where: { id: passingChallengerId } });
    const family = await prisma.agentFamily.findUniqueOrThrow({ where: { id: promoted.familyId } });
    expect(promoted.status).toBe('ACTIVE');
    expect(family.championAgentId).toBe(passingChallengerId);
    expect(
      await prisma.certificationRun.findUniqueOrThrow({ where: { id: passingRunId } }),
    ).toMatchObject({ isPromotionEvidence: true, resultsAvailability: 'PROMOTION_EVIDENCE' });
    expect(
      await prisma.agent.findFirst({
        where: { familyId: promoted.familyId, status: AgentStatus.ACTIVE },
      }),
    ).toMatchObject({ id: passingChallengerId });

    const nightlyActive = await certification.createScheduledRun(
      passingChallengerId,
      `integration-retirement-lock:${randomUUID()}`,
    );
    expect(
      apiErrorSchema.parse(
        (
          await request(app)
            .post(`/agents/${passingChallengerId}/retire`)
            .send({ rationale: 'Try to retire while nightly certification is queued.' })
            .expect(409)
        ).body,
      ).error.code,
    ).toBe('AGENT_WORK_IN_PROGRESS');
    await certification.failRun(
      nightlyActive.runId,
      'INTEGRATION_CANCELLED',
      'Integration test released queued nightly work',
    );
  });

  it('exposes governed corpus and gate configuration resources', async () => {
    const cases = evalCaseListResponseSchema.parse(
      (await request(app).get('/agents/eval-cases').query({ active: 'true' }).expect(200)).body,
    );
    expect(cases.items.length).toBeGreaterThanOrEqual(12);
    const configs = gateConfigListResponseSchema.parse(
      (await request(app).get('/agents/certification-gate-configs').expect(200)).body,
    );
    expect(configs.active.version).toBe(1);
  });

  it('keeps nightly certification non-comparative and compacts only non-evidence detail', async () => {
    expect(staleCertificationRunId).not.toBeNull();
    const certification = services.certification as CertificationService;
    const passingNightly = await certification.createScheduledRun(
      passingChallengerId,
      `integration-nightly-pass:${randomUUID()}`,
    );
    await certification.executeRun(passingNightly.runId);
    const passingDetail = await certification.getRun(passingNightly.runId, 50);
    expect(passingDetail.run).toMatchObject({
      kind: 'champion_recertification',
      state: 'passed',
      caseCounts: { total: 12, passed: 12, failed: 0 },
    });
    expect(passingDetail.gates.find((gate) => gate.gate === 'champion_regression')).toMatchObject({
      status: 'not_applicable',
      measuredValue: null,
    });
    expect(
      await prisma.agent.findUniqueOrThrow({ where: { id: passingChallengerId } }),
    ).toMatchObject({ status: AgentStatus.ACTIVE, certificationHealth: 'CURRENT' });

    const nightly = await certification.createScheduledRun(
      inventoryChampionId,
      `integration-nightly:${randomUUID()}`,
    );
    services.certificationDispatcher.enqueue(nightly.runId);
    const detail = await waitForTerminalCertification(services, nightly.runId);
    expect(detail.run).toMatchObject({
      kind: 'champion_recertification',
      state: 'failed',
      caseCounts: { total: 12, passed: 0, failed: 12 },
    });
    expect(detail.gates.find((gate) => gate.gate === 'champion_regression')).toMatchObject({
      status: 'not_applicable',
      measuredValue: null,
    });
    expect(
      await prisma.agent.findUniqueOrThrow({ where: { id: inventoryChampionId } }),
    ).toMatchObject({ status: AgentStatus.ACTIVE, certificationHealth: 'DEGRADED' });

    const expiredInterpretationId = randomUUID();
    await prisma.specInterpretation.create({
      data: {
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        id: expiredInterpretationId,
        prompt: 'Expired unattached integration interpretation prompt.',
        promptHash: 'f'.repeat(64),
        result: { kind: 'expired_fixture' },
        createdBy: 'integration-test',
        expiresAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      },
    });
    const evidenceResultCount = await prisma.evalCaseResult.count({
      where: { runId: passingRunId },
    });
    expect(evidenceResultCount).toBeGreaterThan(0);
    const maintenance = new MaintenanceService(
      prisma,
      certification,
      services.interpretations as InterpretationService,
      () => undefined,
      0,
      logger,
    );
    await maintenance.run('boot');
    expect(
      await prisma.specInterpretation.findUnique({ where: { id: expiredInterpretationId } }),
    ).toBeNull();
    expect(
      await prisma.certificationRun.findUniqueOrThrow({
        where: { id: staleCertificationRunId as string },
      }),
    ).toMatchObject({
      resultsAvailability: CertificationResultsAvailability.SUMMARY_ONLY,
      isPromotionEvidence: false,
      totalCaseCount: 0,
      passedCaseCount: 0,
      failedCaseCount: 0,
    });
    expect(
      await prisma.certificationRun.findUniqueOrThrow({ where: { id: passingRunId } }),
    ).toMatchObject({
      resultsAvailability: CertificationResultsAvailability.PROMOTION_EVIDENCE,
      isPromotionEvidence: true,
      totalCaseCount: 12,
      passedCaseCount: 12,
      failedCaseCount: 0,
    });
    expect(await prisma.evalCaseResult.count({ where: { runId: passingRunId } })).toBe(
      evidenceResultCount,
    );
    await expect(
      prisma.evalCaseResult.deleteMany({ where: { runId: passingRunId } }),
    ).rejects.toBeDefined();
    await request(app)
      .post(`/agents/${passingChallengerId}/retire`)
      .send({
        rationale: 'Explicitly retire the promoted integration champion after verification.',
      })
      .expect(200);
    expect(
      await prisma.agent.findUniqueOrThrow({ where: { id: passingChallengerId } }),
    ).toMatchObject({ status: AgentStatus.RETIRED, activationDecisionId: null });
    expect(
      await prisma.agentFamily.findUniqueOrThrow({ where: { id: supplierChampionId } }),
    ).toMatchObject({ championAgentId: null });
    await expect(
      prisma.agent.update({
        where: { id: passingChallengerId },
        data: { status: AgentStatus.ACTIVE },
      }),
    ).rejects.toBeDefined();
    await expect(
      prisma.agent.update({
        where: { id: passingChallengerId },
        data: { legacyActivation: true },
      }),
    ).rejects.toBeDefined();
    const prohibitedLegacyFamilyId = randomUUID();
    await prisma.agentFamily.create({
      data: {
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        id: prohibitedLegacyFamilyId,
        slug: `legacy-insert-${prohibitedLegacyFamilyId.slice(0, 8)}`,
        name: 'Legacy Insert Guard Fixture',
        department: 'Platform Governance',
        owner: 'Integration Test',
        createdBy: 'integration-test',
        updatedBy: 'integration-test',
      },
    });
    await expect(
      prisma.agent.create({
        data: {
          familyId: prohibitedLegacyFamilyId,
          slug: `legacy-insert-${prohibitedLegacyFamilyId.slice(0, 8)}-v1`,
          versionNumber: 1,
          derivationMode: 'NEW',
          name: 'Prohibited Legacy Insert',
          department: 'Platform Governance',
          purpose: 'Prove new versions cannot claim the migration-only activation escape hatch.',
          owner: 'Integration Test',
          status: AgentStatus.DRAFT,
          capabilities: [],
          legacyActivation: true,
          createdBy: 'integration-test',
          updatedBy: 'integration-test',
        },
      }),
    ).rejects.toBeDefined();
  });

  it('reaps running jobs, restores recoverable state, and resumes persisted queued jobs', async () => {
    const orphanSpec = await createReadySpec('Integration Orphan Recovery Probe');
    const queuedSpec = await createReadySpec('Integration Queued Resume Probe');
    const generation = services.generation as GenerationService;

    const orphan = await generation.accept(orphanSpec.id);
    const queued = await generation.accept(queuedSpec.id);
    expect(await generation.claim(orphan.jobId)).not.toBeNull();

    await services.dispatcher.recoverAndResume();

    const orphanedJob = await waitForTerminalJob(services, orphan.jobId);
    expect(orphanedJob).toMatchObject({
      state: 'failed',
      error: { code: 'ORPHANED_ON_RESTART' },
    });
    const recoveredSpec = await services.specs.get(orphanSpec.id);
    expect(recoveredSpec.status).toBe('ready');
    const failedAgent = await services.catalog.getAgent(orphan.agentId);
    expect(failedAgent.status).toBe('failed');

    await request(app).post(`/agents/${orphan.agentId}/recover`).send({}).expect(200);
    expect((await services.catalog.getAgent(orphan.agentId)).status).toBe('draft');

    const resumedJob = await waitForTerminalJob(services, queued.jobId);
    expect(resumedJob.state).toBe('succeeded');
    expect((await services.catalog.getAgent(queued.agentId)).status).toBe('ready');
  });

  it('returns typed resource, validation, readiness, locking, and recovery failures', async () => {
    const unknownId = '11111111-1111-4111-8111-111111111111';

    await request(app).get('/health').expect(200);
    const allSources = sourceListResponseSchema.parse(
      (await request(app).get('/agents/sources').expect(200)).body,
    );
    expect(allSources.items.length).toBeGreaterThan(1);
    const knowledgeSources = await request(app)
      .get('/agents/sources')
      .query({ role: 'knowledge' })
      .expect(200);
    const parsedKnowledgeSources = sourceListResponseSchema.parse(knowledgeSources.body);
    expect(parsedKnowledgeSources.items.every((source) => source.role === 'knowledge')).toBe(true);
    expect(
      apiErrorSchema.parse(
        (await request(app).get('/agents/sources').query({ role: 'invalid' }).expect(400)).body,
      ).error.code,
    ).toBe('VALIDATION_ERROR');

    await request(app).get('/agents').expect(200);
    await request(app)
      .post('/agents/similarity')
      .send({
        query: 'supplier delay',
        candidateIds: ['4a40357e-924f-46db-86ac-b8ed920be486'],
      })
      .expect(200);

    expect(
      apiErrorSchema.parse((await request(app).get(`/agents/specs/${unknownId}`).expect(404)).body)
        .error.code,
    ).toBe('SPEC_NOT_FOUND');
    expect(
      apiErrorSchema.parse(
        (await request(app).get(`/agents/generation-jobs/${unknownId}`).expect(404)).body,
      ).error.code,
    ).toBe('GENERATION_JOB_NOT_FOUND');
    expect(
      apiErrorSchema.parse(
        (await request(app).get(`/agents/${unknownId}/evaluation`).expect(404)).body,
      ).error.code,
    ).toBe('AGENT_NOT_FOUND');
    expect(
      apiErrorSchema.parse(
        (await request(app).post(`/agents/${unknownId}/shadow-deploy`).send({}).expect(404)).body,
      ).error.code,
    ).toBe('AGENT_NOT_FOUND');

    const missingBase = await request(app)
      .post('/agents/specs')
      .send({
        baseAgentId: unknownId,
        derivationMode: 'configure',
        outcomes: outcomes('Missing Base Agent Probe'),
      })
      .expect(404);
    expect(apiErrorSchema.parse(missingBase.body).error.code).toBe('BASE_AGENT_NOT_FOUND');

    const draft = await services.specs.create({
      baseAgentId: null,
      outcomes: outcomes('Integration Readiness Probe'),
    });
    createdAgentIds.add(draft.agentId);
    const notReady = await request(app)
      .post(`/agents/specs/${draft.id}/generate`)
      .send({})
      .expect(422);
    expect(apiErrorSchema.parse(notReady.body).error).toMatchObject({
      code: 'SPEC_NOT_READY',
      details: { missingSections: ['knowledge', 'guardrails', 'outputs'] },
    });

    const duplicateDescriptor = await request(app)
      .put(`/agents/specs/${draft.id}/knowledge`)
      .send({
        value: { sources: [knowledge.sources[0], knowledge.sources[0]] },
      })
      .expect(400);
    expect(apiErrorSchema.parse(duplicateDescriptor.body).error.code).toBe('VALIDATION_ERROR');
    const unknownDescriptor = await request(app)
      .put(`/agents/specs/${draft.id}/knowledge`)
      .send({
        value: {
          sources: [
            {
              descriptorId: 'unknown-source',
              purpose: 'Exercise descriptor validation',
              requiredCitations: true,
            },
          ],
        },
      })
      .expect(400);
    expect(apiErrorSchema.parse(unknownDescriptor.body).error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { descriptorIds: ['unknown-source'] },
    });

    const ready = await createReadySpec('Integration Conflict Probe');
    const emptyEvaluation = evaluationResponseSchema.parse(
      (await request(app).get(`/agents/${ready.agentId}/evaluation`).expect(200)).body,
    );
    expect(emptyEvaluation).toMatchObject({
      status: 'not_started',
      summary: { total: 0, score: 0 },
    });
    expect(
      apiErrorSchema.parse(
        (await request(app).post(`/agents/${ready.agentId}/shadow-deploy`).send({}).expect(409))
          .body,
      ).error.code,
    ).toBe('INVALID_AGENT_TRANSITION');
    expect(
      apiErrorSchema.parse(
        (await request(app).post(`/agents/${ready.agentId}/recover`).send({}).expect(409)).body,
      ).error.code,
    ).toBe('INVALID_AGENT_TRANSITION');

    const generation = services.generation as GenerationService;
    const accepted = await generation.accept(ready.id);
    const duplicateClaim = await request(app)
      .post(`/agents/specs/${ready.id}/generate`)
      .send({})
      .expect(409);
    expect(apiErrorSchema.parse(duplicateClaim.body).error).toMatchObject({
      code: 'GENERATION_IN_PROGRESS',
      details: { jobId: accepted.jobId, statusUrl: accepted.statusUrl },
    });
    expect(
      apiErrorSchema.parse(
        (
          await request(app)
            .put(`/agents/specs/${ready.id}/outcomes`)
            .send({ value: outcomes(ready.outcomes!.name) })
            .expect(409)
        ).body,
      ).error.code,
    ).toBe('SPEC_LOCKED');
    expect(
      apiErrorSchema.parse(
        (await request(app).post(`/agents/${ready.agentId}/recover`).send({}).expect(409)).body,
      ).error.code,
    ).toBe('GENERATION_IN_PROGRESS');
    expect(await generation.claim(unknownId)).toBeNull();

    await generation.fail(accepted.jobId, 'FIXTURE_FAILURE', 'Deliberate integration failure');
    const failedPolling = generationJobSchema.parse(
      (await request(app).get(accepted.statusUrl).expect(200)).body,
    );
    expect(failedPolling).toMatchObject({
      state: 'failed',
      error: { code: 'FIXTURE_FAILURE' },
    });
    await request(app).post(`/agents/${ready.agentId}/recover`).send({}).expect(200);
    expect((await services.catalog.getAgent(ready.agentId)).status).toBe('draft');
  });

  it('publishes governed corpus and gate revisions and runs idempotent scheduled maintenance', async () => {
    const override = (
      await request(app)
        .post('/agents/eval-cases')
        .send({
          key: `integration-override-${randomUUID()}`,
          name: 'Integration human override candidate',
          input: { incident: 'override-fixture' },
          expectedOutput: { status: 'held_for_review' },
          expectedCitations: [],
          tags: ['replay'],
          source: 'override',
          provenance: { test: true },
        })
        .expect(201)
    ).body as { id: string };
    await request(app)
      .post(`/agents/eval-cases/${override.id}/deactivate`)
      .send({ rationale: 'The integration override has been curated out of the next corpus.' })
      .expect(200);
    const incident = (
      await request(app)
        .post('/agents/eval-cases')
        .send({
          key: `integration-incident-${randomUUID()}`,
          name: 'Integration incident regression candidate',
          input: { incident: 'regression-fixture' },
          expectedOutput: { status: 'blocked' },
          expectedCitations: [],
          tags: ['regression'],
          source: 'incident',
          provenance: { test: true },
        })
        .expect(201)
    ).body as { id: string };
    await request(app)
      .get('/agents/eval-cases')
      .query({ tag: 'regression', source: 'incident', active: 'true' })
      .expect(200);

    const currentCorpus = await prisma.evalCorpusVersion.findFirstOrThrow({
      orderBy: { version: 'desc' },
      include: { memberships: { select: { caseId: true } } },
    });
    const publishedCorpus = await request(app)
      .post('/agents/eval-corpus/publish')
      .send({
        baseVersion: currentCorpus.version,
        caseIds: [...currentCorpus.memberships.map(({ caseId }) => caseId), incident.id],
        rationale: 'Publish the curated integration incident into an immutable corpus revision.',
      })
      .expect(201);
    expect(publishedCorpus.body.version).toBe(currentCorpus.version + 1);
    await request(app)
      .post('/agents/eval-corpus/publish')
      .send({
        baseVersion: currentCorpus.version,
        caseIds: [incident.id],
        rationale: 'Exercise optimistic corpus publication conflict handling.',
      })
      .expect(409);

    const currentConfig = gateConfigListResponseSchema.parse(
      (await request(app).get('/agents/certification-gate-configs').expect(200)).body,
    ).active;
    const publishedConfig = await request(app)
      .post('/agents/certification-gate-configs/publish')
      .send({
        baseVersion: currentConfig.version,
        promotionFreshnessHours: currentConfig.promotionFreshnessHours,
        gates: currentConfig.gates,
        rationale: 'Publish an actor-attributed integration gate configuration revision.',
      })
      .expect(201);
    expect(publishedConfig.body.version).toBe(currentConfig.version + 1);
    await request(app)
      .post('/agents/certification-gate-configs/publish')
      .send({
        baseVersion: currentConfig.version,
        promotionFreshnessHours: currentConfig.promotionFreshnessHours,
        gates: currentConfig.gates,
        rationale: 'Exercise optimistic gate configuration publication conflict handling.',
      })
      .expect(409);
    const history = gateConfigListResponseSchema.parse(
      (
        await request(app)
          .get('/agents/certification-gate-configs')
          .query({ includeSuperseded: 'true' })
          .expect(200)
      ).body,
    );
    expect(history.history.some(({ version }) => version === currentConfig.version)).toBe(true);

    const queuedRuns: string[] = [];
    const maintenance = new MaintenanceService(
      prisma,
      services.certification as CertificationService,
      services.interpretations as InterpretationService,
      (runId) => queuedRuns.push(runId),
      20,
      logger,
    );
    await maintenance.run('scheduled');
    expect(queuedRuns.length).toBeGreaterThan(0);
    for (const runId of queuedRuns) {
      await (services.certification as CertificationService).failRun(
        runId,
        'INTEGRATION_CANCELLED',
        'Integration cleanup cancelled scheduled certification',
      );
    }
  });
});
