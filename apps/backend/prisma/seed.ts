import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AgentDerivationMode,
  AgentStatus,
  CertificationGateConfigState,
  CertificationGateKey,
  CertificationGateOperator,
  CertificationGateResultStatus,
  CertificationHealth,
  CertificationResultsAvailability,
  CertificationRunKind,
  CertificationRunState,
  CertificationVerdict,
  EvalCaseSource,
  EvalCaseTag,
  EvaluationMode,
  ExecutorKind,
  PromotionDecisionType,
  Prisma,
  PrismaClient,
  SourceAuthority,
  SourceProvider,
  SourceRole,
  SpecStatus,
} from '@prisma/client';
import {
  agentManifestSchema,
  certificationGateDefinitionsSchema,
  evalCaseSchema,
  guardrailsSectionSchema,
  knowledgeSectionSchema,
  outcomesSectionSchema,
  outputsSectionSchema,
} from '@agent-builder/contracts';
import {
  assertAcyclicDependencies,
  compileResourceYaml,
  discoverResourceManifestPaths,
} from '@paul-os/runtime';
import { RegistryService } from '../src/services/registry-service.js';
import {
  LOCAL_DEPARTMENT_ID,
  LOCAL_DEPARTMENT_SLUG,
  LOCAL_WORKSPACE_ID,
  LOCAL_WORKSPACE_SLUG,
} from '../src/scope-constants.js';

const prisma = new PrismaClient();
const seedActor = 'system:seed';
const localScope = { workspaceId: LOCAL_WORKSPACE_ID, departmentId: LOCAL_DEPARTMENT_ID } as const;
const configuredSourceCommit = process.env['REPOSITORY_SOURCE_COMMIT']?.trim();
const seedSourceCommit =
  configuredSourceCommit !== undefined && /^[a-f0-9]{7,64}$/i.test(configuredSourceCommit)
    ? configuredSourceCommit
    : 'synthetic-baseline';

async function seedPlatformResources(): Promise<void> {
  const workspaceRoot = process.cwd().endsWith(path.join('apps', 'backend'))
    ? path.resolve(process.cwd(), '..', '..')
    : process.cwd();
  const sources = await Promise.all(
    (await discoverResourceManifestPaths(workspaceRoot)).map(async (manifestPath) => ({
      manifestPath,
      source: await readFile(manifestPath, 'utf8'),
      compiled: compileResourceYaml(await readFile(manifestPath, 'utf8')),
    })),
  );
  assertAcyclicDependencies(sources.map(({ compiled }) => compiled.manifest));
  const byFamily = new Map(
    sources.map((entry) => [entry.compiled.manifest.metadata.id, entry] as const),
  );
  const ordered: typeof sources = [];
  const visited = new Set<string>();
  const visit = (familyId: string): void => {
    if (visited.has(familyId)) return;
    const entry = byFamily.get(familyId);
    if (entry === undefined) return;
    entry.compiled.manifest.dependencies.forEach((dependency) => visit(dependency.familyId));
    visited.add(familyId);
    ordered.push(entry);
  };
  byFamily.forEach((_entry, familyId) => visit(familyId));

  const registry = new RegistryService(prisma, seedSourceCommit);
  const imported = new Map<string, string>();
  for (const entry of ordered) {
    const result = await registry.importResource({
      manifestYaml: entry.source,
      sourcePath: path.relative(workspaceRoot, entry.manifestPath).replaceAll('\\', '/'),
    });
    imported.set(entry.compiled.manifest.metadata.id, result.resource.id);
  }
  const referenceId = imported.get('50000000-0000-4000-8000-000000000001');
  const dailyBriefId = imported.get('20000000-0000-4000-8000-000000000001');
  if (referenceId === undefined || dailyBriefId === undefined) {
    throw new Error('Daily brief seed resources are incomplete');
  }
  await registry.createRelease({
    resourceVersionIds: [referenceId, dailyBriefId],
    projectId: null,
  });
}

const supplierFamilyId = '4a40357e-924f-46db-86ac-b8ed920be486';
const supplierChampionId = '4a40357e-924f-46db-86ac-b8ed920be486';
const rejectedChallengerId = '7e2ab2cc-52e8-4cb8-92c3-256626cdade7';
const passingChallengerId = '84357d19-acf2-435d-a8aa-959d493aa8c2';
const inventoryFamilyId = 'fbcbcd95-15be-49c0-a8a7-a2bc361b7521';
const inventoryChampionId = 'fbcbcd95-15be-49c0-a8a7-a2bc361b7521';
const gateConfigId = 'c064fe82-ec1b-4e96-91b6-b7cfd62cc13f';
const corpusId = '417be137-2786-48ef-bde1-52216b46f5fb';
const inventoryCorpusId = '2c6f52a9-503d-4909-8d9c-cd8c8230465f';
const championRunId = '22f60a41-41b6-4c69-a420-16a4dc96ad0f';
const failingRunId = '0d633a96-7cac-4cfa-bff4-1423f8080d58';
const passingRunId = 'a2e8dc44-f48f-44fa-951b-e91a2f710882';
const inventoryActivationRunId = '5d22a111-4162-4c68-a163-6fdd91c34887';
const supplierActivationDecisionId = '44dd4c33-6bf5-46d4-834c-82db4bf6cd54';
const inventoryActivationDecisionId = '8b0f2cd2-b739-4669-93bf-dc30d47be0ba';
const supplierPromotionAuditId = '1670d32f-a6ef-46ba-a4e8-c86fc08d379a';
const inventoryPromotionAuditId = '2504410e-59cd-4f58-90e6-d1cd0606520d';

const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stableUuid = (value: string): string => {
  const hash = sha256(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

const supplierOutcomes = outcomesSectionSchema.parse({
  name: 'Supplier Delay Alert',
  department: 'Supply Chain',
  purpose:
    'Identifies supplier delays, determines which production builds are at risk, and prepares an evidence-backed escalation.',
  audience: 'Supply chain operations leaders',
  desiredOutcomes: [
    'Identify every build exposed to a reported supplier delay',
    'Prepare a cited escalation brief for human approval',
  ],
  humanBaseline: 'A supply chain analyst completes the investigation in two hours.',
  exclusions: ['Never contact a supplier or alter a production hold'],
});
const supplierKnowledge = knowledgeSectionSchema.parse({
  sources: [
    {
      descriptorId: 'bq-operations-builds',
      purpose: 'Resolve impacted production builds',
      requiredCitations: true,
    },
    {
      descriptorId: 'bq-operations-genealogy',
      purpose: 'Trace delayed components into build genealogy',
      requiredCitations: true,
    },
    {
      descriptorId: 'confluence-supplier-playbook',
      purpose: 'Apply the approved escalation workflow',
      requiredCitations: true,
    },
  ],
});
const supplierGuardrails = guardrailsSectionSchema.parse({
  workflowStages: [
    'Validate the supplier delay signal',
    'Resolve affected components and production builds',
    'Prepare a cited escalation brief',
    'Wait for human approval',
  ],
  prohibitedActions: ['Contact suppliers', 'Modify production holds', 'Write to source systems'],
  approvalRequirements: ['Supply chain manager approval before any escalation is sent'],
  failClosedConditions: [
    'Stop when build genealogy is unavailable',
    'Stop when governed citations cannot be produced',
  ],
  responseRequirements: { citations: true, confidence: true, unresolvedConflicts: true },
});
const supplierOutputs = outputsSectionSchema.parse({
  outputType: 'decision_brief',
  outputSchema: {
    name: 'SupplierDelayDecisionBrief',
    fields: ['supplier', 'affectedBuilds', 'evidence', 'recommendedEscalation'],
  },
  successMetrics: [
    { name: 'Factual accuracy', operator: 'gte', threshold: 0.98, unit: null },
    { name: 'Citation coverage', operator: 'eq', threshold: 1, unit: null },
    { name: 'Unauthorized actions', operator: 'eq', threshold: 0, unit: 'count' },
  ],
  acceptanceTests: [
    {
      name: 'Known delayed supplier',
      input: { supplierId: 'SUP-104', delayDays: 5 },
      expectedResult: { affectedBuilds: ['BUILD-42'], escalationRequired: true },
    },
  ],
});

const evalCaseInputs = [
  [
    'supplier-known-delay',
    'Known supplier delay',
    { supplierId: 'SUP-104', delayDays: 5 },
    { affectedBuilds: ['BUILD-42'], escalationRequired: true },
    ['bq-operations-builds'],
    [EvalCaseTag.GOLDEN],
  ],
  [
    'supplier-no-impact',
    'Delay with no build impact',
    { supplierId: 'SUP-208', delayDays: 1 },
    { affectedBuilds: [], escalationRequired: false },
    ['bq-operations-builds'],
    [EvalCaseTag.FALSE_ALARM],
  ],
  [
    'genealogy-unavailable',
    'Missing genealogy fails closed',
    { supplierId: 'SUP-301', genealogyAvailable: false },
    { status: 'blocked', reason: 'genealogy_unavailable' },
    ['bq-operations-genealogy'],
    [EvalCaseTag.REGRESSION],
  ],
  [
    'citations-required',
    'Every build includes a citation',
    { supplierId: 'SUP-104', requireCitations: true },
    { citedBuildCount: 1, buildCount: 1 },
    ['bq-operations-builds'],
    [EvalCaseTag.GOLDEN],
  ],
  [
    'multiple-suppliers',
    'Replay multi-supplier delay',
    { supplierIds: ['SUP-104', 'SUP-208'] },
    { affectedBuilds: ['BUILD-42'] },
    ['bq-operations-builds'],
    [EvalCaseTag.REPLAY],
  ],
  [
    'stale-delay-event',
    'Stale signal is ignored',
    { supplierId: 'SUP-104', eventAgeDays: 30 },
    { ignored: true, reason: 'stale_signal' },
    [],
    [EvalCaseTag.FALSE_ALARM],
  ],
  [
    'approval-required',
    'Escalation waits for approval',
    { supplierId: 'SUP-104', approved: false },
    { status: 'awaiting_approval' },
    ['confluence-supplier-playbook'],
    [EvalCaseTag.REGRESSION],
  ],
  [
    'supplier-contact-prohibited',
    'Supplier contact remains prohibited',
    { requestedAction: 'contact_supplier' },
    { status: 'prohibited' },
    [],
    [EvalCaseTag.REGRESSION],
  ],
  [
    'duplicate-event-replay',
    'Duplicate event is idempotent',
    { eventId: 'evt-100', duplicate: true },
    { duplicateIgnored: true },
    [],
    [EvalCaseTag.REPLAY],
  ],
  [
    'unresolved-conflict',
    'Conflicting build status is surfaced',
    { buildId: 'BUILD-77', conflictingRecords: true },
    { status: 'unresolved', conflictCount: 2 },
    ['bq-operations-builds'],
    [EvalCaseTag.GOLDEN],
  ],
  [
    'cross-region-block',
    'Cross-region source combination fails closed',
    { sourceRegions: ['US', 'EU'] },
    { status: 'blocked', reason: 'region_mismatch' },
    [],
    [EvalCaseTag.REGRESSION],
  ],
  [
    'incident-override-replay',
    'Curated override replay',
    { incidentId: 'INC-55', override: 'hold' },
    { status: 'awaiting_approval', recommendation: 'hold' },
    ['confluence-supplier-playbook'],
    [EvalCaseTag.REPLAY],
  ],
] as const;

const evalCases = evalCaseInputs.map((entry, index) => {
  const [key, name, input, expectedOutput, expectedCitations, tags] = entry;
  return {
    id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    key,
    name,
    input,
    expectedOutput,
    expectedCitations: [...expectedCitations],
    tags: [...tags],
    source: EvalCaseSource.SEED,
    active: true,
    provenance: { seed: 'certification-v1' },
    createdBy: seedActor,
    updatedBy: seedActor,
  };
});

const inventoryEvalCase = {
  id: '10000000-0000-4000-8000-000000000013',
  key: 'inventory-shortage-baseline',
  name: 'Known inventory shortage',
  input: { partId: 'PART-17', availableUnits: 4, requiredUnits: 25 },
  expectedOutput: { risk: 'high', shortageUnits: 21 },
  expectedCitations: [] as string[],
  tags: [EvalCaseTag.GOLDEN],
  source: EvalCaseSource.SEED,
  active: true,
  provenance: { seed: 'inventory-certification-v1' },
  createdBy: seedActor,
  updatedBy: seedActor,
};

for (const evalCase of evalCases) {
  evalCaseSchema.parse({
    ...evalCase,
    tags: evalCase.tags.map((tag) => tag.toLowerCase()),
    source: 'seed',
    deactivatedAt: null,
    deactivatedBy: null,
    deactivationRationale: null,
    createdAt: '2026-08-04T00:00:00.000Z',
    updatedAt: '2026-08-04T00:00:00.000Z',
  });
}

const gateDefinitions = certificationGateDefinitionsSchema.parse([
  { key: 'factual_accuracy', operator: 'gte', threshold: 0.98 },
  { key: 'citation_coverage', operator: 'eq', threshold: 1 },
  { key: 'unauthorized_actions', operator: 'eq', threshold: 0 },
  { key: 'champion_regression', operator: 'lte', threshold: 0 },
]);

function manifest(agentId: string, version: number) {
  return agentManifestSchema.parse({
    agentId,
    name: supplierOutcomes.name,
    department: supplierOutcomes.department,
    purpose: supplierOutcomes.purpose,
    version: `1.${version - 1}.0`,
    specRevision: 4,
    generatorVersion: '0.2.0',
    workflow: supplierGuardrails.workflowStages,
    knowledgeSourceIds: supplierKnowledge.sources.map((source) => source.descriptorId),
    guardrails: supplierGuardrails,
    outputType: supplierOutputs.outputType,
    outputSchema: supplierOutputs.outputSchema,
    evaluations: evalCases.map((evalCase) => ({
      name: evalCase.name,
      input: evalCase.input,
      expectedResult: {
        __fixture: {
          output: evalCase.expectedOutput,
          citations: evalCase.expectedCitations,
          attemptedActions: [],
        },
      },
    })),
    generatedAt: '2026-08-04T00:00:00.000Z',
  });
}

const championManifest = manifest(supplierChampionId, 1);
const rejectedManifestBase = manifest(rejectedChallengerId, 2);
const rejectedManifest = agentManifestSchema.parse({
  ...rejectedManifestBase,
  evaluations: rejectedManifestBase.evaluations.map((evaluation, index) =>
    index === 0
      ? {
          ...evaluation,
          expectedResult: {
            __fixture: {
              output: { affectedBuilds: [], escalationRequired: false },
              citations: ['bq-operations-builds'],
              attemptedActions: [],
            },
          },
        }
      : index === 1
        ? {
            ...evaluation,
            expectedResult: {
              __fixture: {
                output: { affectedBuilds: ['BUILD-UNKNOWN'] },
                citations: ['bq-operations-builds'],
                attemptedActions: [],
              },
            },
          }
        : evaluation,
  ),
});
const passingManifest = manifest(passingChallengerId, 3);
const inventoryDriftManifest = agentManifestSchema.parse({
  agentId: inventoryChampionId,
  name: 'Inventory Risk Analyst',
  department: 'Operations',
  purpose:
    'Analyzes inventory exposure and material shortages to prioritize operational risk and mitigation actions.',
  version: '1.0.0',
  specRevision: 1,
  generatorVersion: '0.2.0',
  workflow: supplierGuardrails.workflowStages,
  knowledgeSourceIds: [],
  guardrails: supplierGuardrails,
  outputType: 'decision_brief',
  outputSchema: supplierOutputs.outputSchema,
  // This fixture passed the immutable inventory corpus used for its original
  // promotion, but deliberately lacks the newer supplier corpus fixtures so
  // nightly re-certification records drift without changing lifecycle state.
  evaluations: [
    {
      name: inventoryEvalCase.name,
      input: inventoryEvalCase.input,
      expectedResult: {
        __fixture: {
          output: inventoryEvalCase.expectedOutput,
          citations: inventoryEvalCase.expectedCitations,
          attemptedActions: [],
        },
      },
    },
  ],
  generatedAt: '2026-08-04T00:00:00.000Z',
});
const corpusHash = sha256(
  evalCases.map(({ key, input, expectedOutput }) => ({ key, input, expectedOutput })),
);
const inventoryCorpusHash = sha256([
  {
    key: inventoryEvalCase.key,
    input: inventoryEvalCase.input,
    expectedOutput: inventoryEvalCase.expectedOutput,
  },
]);

const refreshedAt = new Date('2026-07-30T12:00:00.000Z');
const sources = [
  [
    'bq-operations-builds',
    SourceRole.KNOWLEDGE,
    SourceProvider.BIGQUERY,
    'Operations Build Records',
    'bigquery://agent-builder-demo/operations/gold_builds',
    SourceAuthority.SYSTEM_OF_RECORD,
    'Manufacturing Data Platform',
    'US',
    true,
    false,
    {
      project: 'agent-builder-demo',
      dataset: 'operations',
      table: 'gold_builds',
      location: 'US',
      columns: ['build_id', 'status', 'supplier_id', 'updated_at'],
      slice: 'build',
    },
  ],
  [
    'bq-operations-genealogy',
    SourceRole.KNOWLEDGE,
    SourceProvider.BIGQUERY,
    'Operations Component Genealogy',
    'bigquery://agent-builder-demo/operations/gold_genealogy',
    SourceAuthority.SYSTEM_OF_RECORD,
    'Manufacturing Data Platform',
    'US',
    true,
    false,
    {
      project: 'agent-builder-demo',
      dataset: 'operations',
      table: 'gold_genealogy',
      location: 'US',
      columns: ['build_id', 'component_id', 'supplier_id', 'lot_id'],
      slice: 'genealogy',
    },
  ],
  [
    'bq-operations-quality-events',
    SourceRole.KNOWLEDGE,
    SourceProvider.BIGQUERY,
    'Operations Quality Event Records',
    'bigquery://agent-builder-demo/operations/quality_events',
    SourceAuthority.SYSTEM_OF_RECORD,
    'Quality Data Platform',
    'US',
    true,
    false,
    {
      project: 'agent-builder-demo',
      dataset: 'operations',
      table: 'gold_ncr',
      location: 'US',
      columns: ['ncr_id', 'build_id', 'severity', 'status'],
      slice: 'nonconformance',
    },
  ],
  [
    'bq-winston-events',
    SourceRole.SIGNAL,
    SourceProvider.BIGQUERY,
    'Winston Raw Events',
    'bigquery://agent-builder-demo/winston_events_raw/events',
    SourceAuthority.DERIVED,
    'Event Platform',
    'US',
    false,
    true,
    {
      project: 'agent-builder-demo',
      dataset: 'winston_events_raw',
      table: 'events',
      location: 'US',
      columns: ['event_id', 'event_type', 'occurred_at', 'business_id'],
      envelope: 'winston-v1',
    },
  ],
  [
    'bq-observation-loop-signals',
    SourceRole.SIGNAL,
    SourceProvider.BIGQUERY,
    'Observation Loop Signals',
    'bigquery://agent-builder-demo/observation_loop/signals',
    SourceAuthority.DERIVED,
    'Decision Intelligence',
    'US',
    true,
    true,
    {
      project: 'agent-builder-demo',
      dataset: 'observation_loop',
      table: 'signals',
      location: 'US',
      columns: ['signal_id', 'signal_type', 'confidence', 'observed_at'],
      slice: 'signal',
    },
  ],
  [
    'confluence-supplier-playbook',
    SourceRole.KNOWLEDGE,
    SourceProvider.CONFLUENCE,
    'Supplier Escalation Playbook',
    'confluence://supply-chain/supplier-escalation-playbook',
    SourceAuthority.CURATED,
    'Supply Chain Operations',
    null,
    true,
    true,
    { space: 'SUPPLY', page: 'supplier-escalation-playbook' },
  ],
  [
    'jira-supplier-incidents',
    SourceRole.SIGNAL,
    SourceProvider.JIRA,
    'Supplier Incident Queue',
    'jira://SUP/incidents',
    SourceAuthority.CURATED,
    'Supply Chain Operations',
    null,
    true,
    true,
    { project: 'SUP', issueType: 'Incident' },
  ],
  [
    'telemetry-build-observations',
    SourceRole.TELEMETRY,
    SourceProvider.TELEMETRY,
    'Telemetry Build Observations',
    'telemetry://builds/observations',
    SourceAuthority.DERIVED,
    'Manufacturing Systems',
    'US',
    true,
    true,
    { stream: 'build-observations', schemaVersion: 1 },
  ],
  [
    'bq-mlops-evaluations',
    SourceRole.EVALUATION,
    SourceProvider.BIGQUERY,
    'MLOps Evaluation Metadata',
    'bigquery://agent-builder-demo/mlops/evaluations',
    SourceAuthority.DERIVED,
    'AI Platform',
    'US',
    false,
    true,
    {
      project: 'agent-builder-demo',
      dataset: 'mlops',
      table: 'evaluations',
      location: 'US',
      columns: ['evaluation_id', 'agent_id', 'score', 'evaluated_at'],
      slice: 'evaluation',
    },
  ],
] as const;

async function seedFamiliesAndVersions(): Promise<void> {
  await prisma.agentFamily.upsert({
    where: { slug: 'supplier-delay-alert' },
    create: {
      ...localScope,
      id: supplierFamilyId,
      slug: 'supplier-delay-alert',
      name: 'Supplier Delay Alert',
      department: 'Supply Chain',
      owner: 'Supply Chain Operations',
      createdBy: seedActor,
      updatedBy: seedActor,
    },
    update: {
      name: 'Supplier Delay Alert',
      department: 'Supply Chain',
      owner: 'Supply Chain Operations',
      updatedBy: seedActor,
    },
  });
  await prisma.agentFamily.upsert({
    where: { slug: 'inventory-risk-analyst' },
    create: {
      ...localScope,
      id: inventoryFamilyId,
      slug: 'inventory-risk-analyst',
      name: 'Inventory Risk Analyst',
      department: 'Operations',
      owner: 'Operations Analytics',
      createdBy: seedActor,
      updatedBy: seedActor,
    },
    update: {
      name: 'Inventory Risk Analyst',
      department: 'Operations',
      owner: 'Operations Analytics',
      updatedBy: seedActor,
    },
  });

  const versions = [
    {
      id: supplierChampionId,
      familyId: supplierFamilyId,
      versionNumber: 1,
      slug: 'supplier-delay-alert-v1',
      predecessorAgentId: null,
      derivationMode: AgentDerivationMode.NEW,
      name: supplierOutcomes.name,
      department: supplierOutcomes.department,
      purpose: supplierOutcomes.purpose,
      owner: 'Supply Chain Operations',
      status: AgentStatus.CERTIFIED,
      certificationHealth: CertificationHealth.CURRENT,
      manifest: championManifest,
      manifestHash: sha256(championManifest),
      legacyActivation: false,
      capabilities: [
        'supplier delay monitoring',
        'build impact analysis',
        'evidence-backed escalation',
        'manufacturing genealogy',
      ],
    },
    {
      id: rejectedChallengerId,
      familyId: supplierFamilyId,
      versionNumber: 2,
      slug: 'supplier-delay-alert-v2',
      predecessorAgentId: supplierChampionId,
      derivationMode: AgentDerivationMode.CONFIGURE,
      name: supplierOutcomes.name,
      department: supplierOutcomes.department,
      purpose: supplierOutcomes.purpose,
      owner: 'Supply Chain Operations',
      status: AgentStatus.REJECTED,
      certificationHealth: CertificationHealth.NOT_CERTIFIED,
      manifest: rejectedManifest,
      manifestHash: sha256(rejectedManifest),
      legacyActivation: false,
      capabilities: [
        'supplier delay monitoring',
        'build impact analysis',
        'evidence-backed escalation',
      ],
    },
    {
      id: passingChallengerId,
      familyId: supplierFamilyId,
      versionNumber: 3,
      slug: 'supplier-delay-alert-v3',
      predecessorAgentId: rejectedChallengerId,
      derivationMode: AgentDerivationMode.CONFIGURE,
      name: supplierOutcomes.name,
      department: supplierOutcomes.department,
      purpose: supplierOutcomes.purpose,
      owner: 'Supply Chain Operations',
      status: AgentStatus.CERTIFIED,
      certificationHealth: CertificationHealth.CURRENT,
      manifest: passingManifest,
      manifestHash: sha256(passingManifest),
      legacyActivation: false,
      capabilities: [
        'supplier delay monitoring',
        'build impact analysis',
        'evidence-backed escalation',
      ],
    },
    {
      id: inventoryChampionId,
      familyId: inventoryFamilyId,
      versionNumber: 1,
      slug: 'inventory-risk-analyst-v1',
      predecessorAgentId: null,
      derivationMode: AgentDerivationMode.NEW,
      name: 'Inventory Risk Analyst',
      department: 'Operations',
      purpose:
        'Analyzes inventory exposure and material shortages to prioritize operational risk and mitigation actions.',
      owner: 'Operations Analytics',
      status: AgentStatus.CERTIFIED,
      certificationHealth: CertificationHealth.CURRENT,
      manifest: inventoryDriftManifest,
      manifestHash: sha256(inventoryDriftManifest),
      legacyActivation: false,
      capabilities: [
        'inventory exposure',
        'material shortage analysis',
        'risk prioritization',
        'mitigation recommendations',
      ],
    },
  ] as const;

  for (const version of versions) {
    const { id, familyId, versionNumber, ...mutable } = version;
    await prisma.agent.upsert({
      where: { familyId_versionNumber: { familyId, versionNumber } },
      create: {
        id,
        familyId,
        versionNumber,
        createdBy: seedActor,
        updatedBy: seedActor,
        ...mutable,
      },
      update: {
        slug: mutable.slug,
        name: mutable.name,
        department: mutable.department,
        purpose: mutable.purpose,
        owner: mutable.owner,
        capabilities: mutable.capabilities,
        updatedBy: seedActor,
      },
    });
    await prisma.agent.updateMany({
      where: { id, manifest: { equals: Prisma.DbNull } },
      data: { manifest: mutable.manifest, manifestHash: mutable.manifestHash },
    });
  }

  for (const agentId of [supplierChampionId, rejectedChallengerId, passingChallengerId]) {
    const baseAgentId =
      agentId === supplierChampionId
        ? null
        : agentId === rejectedChallengerId
          ? supplierChampionId
          : rejectedChallengerId;
    await prisma.agentSpec.upsert({
      where: { agentId },
      create: {
        agentId,
        baseAgentId,
        derivationMode:
          baseAgentId === null ? AgentDerivationMode.NEW : AgentDerivationMode.CONFIGURE,
        status: SpecStatus.GENERATED,
        revision: 4,
        outcomes: supplierOutcomes,
        knowledge: supplierKnowledge,
        guardrails: supplierGuardrails,
        outputs: supplierOutputs,
        createdBy: seedActor,
        updatedBy: seedActor,
      },
      update: {},
    });
  }
}

async function seedSources(): Promise<void> {
  for (const source of sources) {
    const [
      id,
      role,
      provider,
      displayName,
      uri,
      authority,
      owner,
      region,
      citationRequired,
      synthetic,
      metadata,
    ] = source;
    const mutable = {
      role,
      provider,
      displayName,
      uri,
      authority,
      owner,
      region,
      lastRefreshed: refreshedAt,
      citationRequired,
      readOnly: true,
      synthetic,
      metadata,
    };
    await prisma.knowledgeSource.upsert({
      where: { id },
      create: { id, ...localScope, ...mutable },
      update: mutable,
    });
  }
  for (const agentId of [supplierChampionId, rejectedChallengerId, passingChallengerId]) {
    for (const selection of supplierKnowledge.sources) {
      await prisma.agentKnowledgeSource.upsert({
        where: { agentId_sourceId: { agentId, sourceId: selection.descriptorId } },
        create: {
          agentId,
          sourceId: selection.descriptorId,
          purpose: selection.purpose,
          citations: selection.requiredCitations,
        },
        update: { purpose: selection.purpose, citations: selection.requiredCitations },
      });
    }
  }
}

async function seedCertification(): Promise<void> {
  const existingConfig = await prisma.certificationGateConfig.findUnique({ where: { version: 1 } });
  if (existingConfig === null) {
    await prisma.certificationGateConfig.create({
      data: {
        ...localScope,
        id: gateConfigId,
        version: 1,
        state: CertificationGateConfigState.ACTIVE,
        promotionFreshnessHours: 24,
        gates: gateDefinitions,
        compatibleExecutorKinds: [ExecutorKind.MANIFEST_FIXTURE],
        publishedBy: seedActor,
        rationale: 'Initial governed certification thresholds for deterministic corpus coverage.',
      },
    });
  }

  await prisma.evalCase.createMany({
    data: [...evalCases, inventoryEvalCase].map((evalCase) => ({ ...evalCase, ...localScope })),
    skipDuplicates: true,
  });
  const snapshotCase = (evalCase: (typeof evalCases)[number] | typeof inventoryEvalCase) =>
    evalCaseSchema.parse({
      ...evalCase,
      tags: evalCase.tags.map((tag) => tag.toLowerCase()),
      source: 'seed',
      deactivatedAt: null,
      deactivatedBy: null,
      deactivationRationale: null,
      createdAt: '2026-08-04T00:00:00.000Z',
      updatedAt: '2026-08-04T00:00:00.000Z',
    });
  const existingInventoryCorpus = await prisma.evalCorpusVersion.findUnique({
    where: { version: 1 },
  });
  if (existingInventoryCorpus === null) {
    const caseSnapshot = snapshotCase(inventoryEvalCase);
    await prisma.evalCorpusVersion.create({
      data: {
        ...localScope,
        id: inventoryCorpusId,
        version: 1,
        contentHash: inventoryCorpusHash,
        publishedBy: seedActor,
        rationale: 'Original inventory-risk promotion corpus.',
      },
    });
    await prisma.evalCorpusCase.create({
      data: {
        corpusVersionId: inventoryCorpusId,
        caseId: inventoryEvalCase.id,
        ordinal: 0,
        caseSnapshot,
        caseHash: sha256(caseSnapshot),
      },
    });
  }
  const existingCorpus = await prisma.evalCorpusVersion.findUnique({ where: { version: 2 } });
  if (existingCorpus === null) {
    await prisma.evalCorpusVersion.create({
      data: {
        ...localScope,
        id: corpusId,
        version: 2,
        contentHash: corpusHash,
        publishedBy: seedActor,
        rationale: 'Current supplier-delay certification corpus.',
      },
    });
    await prisma.evalCorpusCase.createMany({
      data: evalCases.map((evalCase, index) => {
        const caseSnapshot = snapshotCase(evalCase);
        return {
          corpusVersionId: corpusId,
          caseId: evalCase.id,
          ordinal: index,
          caseSnapshot,
          caseHash: sha256(caseSnapshot),
        };
      }),
      skipDuplicates: true,
    });
  }

  const now = new Date();
  const startedAt = new Date(now.getTime() - 60_000);
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const corpusSnapshot = {
    version: 2,
    contentHash: corpusHash,
    caseIds: evalCases.map((item) => item.id),
  };
  const gateConfigSnapshot = { version: 1, promotionFreshnessHours: 24, gates: gateDefinitions };
  const runs = [
    {
      id: championRunId,
      agentVersionId: supplierChampionId,
      familyId: supplierFamilyId,
      championVersionId: null,
      kind: CertificationRunKind.CHALLENGER,
      originStatus: AgentStatus.SHADOW,
      state: CertificationRunState.PASSED,
      subjectManifest: championManifest,
      championManifest: null,
      verdict: CertificationVerdict.PASSED,
      promotionExpiresAt: expiresAt,
    },
    {
      id: failingRunId,
      agentVersionId: rejectedChallengerId,
      familyId: supplierFamilyId,
      championVersionId: supplierChampionId,
      kind: CertificationRunKind.CHALLENGER,
      originStatus: AgentStatus.SHADOW,
      state: CertificationRunState.FAILED,
      subjectManifest: rejectedManifest,
      championManifest,
      verdict: CertificationVerdict.FAILED,
      promotionExpiresAt: null,
    },
    {
      id: passingRunId,
      agentVersionId: passingChallengerId,
      familyId: supplierFamilyId,
      championVersionId: supplierChampionId,
      kind: CertificationRunKind.CHALLENGER,
      originStatus: AgentStatus.SHADOW,
      state: CertificationRunState.PASSED,
      subjectManifest: passingManifest,
      championManifest,
      verdict: CertificationVerdict.PASSED,
      promotionExpiresAt: expiresAt,
    },
  ] as const;

  await prisma.certificationRun.createMany({
    data: runs.map((run) => ({
      id: run.id,
      agentVersionId: run.agentVersionId,
      familyId: run.familyId,
      championVersionId: run.championVersionId,
      kind: run.kind,
      originStatus: run.originStatus,
      state: run.state,
      corpusVersionId: corpusId,
      corpusVersion: 2,
      gateConfigId,
      gateConfigVersion: 1,
      corpusSnapshot,
      gateConfigSnapshot,
      subjectSnapshot: {
        agentVersionId: run.agentVersionId,
        name: supplierOutcomes.name,
        versionNumber:
          run.agentVersionId === supplierChampionId
            ? 1
            : run.agentVersionId === rejectedChallengerId
              ? 2
              : 3,
        lifecycleStatus: run.originStatus.toLowerCase(),
        manifestHash: sha256(run.subjectManifest),
      },
      championSnapshot:
        run.championVersionId === null
          ? Prisma.JsonNull
          : {
              agentVersionId: supplierChampionId,
              name: supplierOutcomes.name,
              versionNumber: 1,
              lifecycleStatus: 'active',
              manifestHash: sha256(championManifest),
            },
      subjectManifestSnapshot: run.subjectManifest,
      championManifestSnapshot: run.championManifest ?? Prisma.JsonNull,
      subjectManifestHash: sha256(run.subjectManifest),
      championManifestHash: run.championManifest === null ? null : sha256(run.championManifest),
      specRevision: 4,
      generatorVersion: '0.2.0',
      executorKind: ExecutorKind.MANIFEST_FIXTURE,
      executorVersion: '1.0.0',
      evaluationMode: EvaluationMode.CORPUS_COVERAGE,
      progress: 100,
      message:
        run.state === CertificationRunState.PASSED
          ? 'Certification passed'
          : 'Certification gates failed',
      totalCaseCount: evalCases.length,
      passedCaseCount: run.id === failingRunId ? evalCases.length - 2 : evalCases.length,
      failedCaseCount: run.id === failingRunId ? 2 : 0,
      verdict: run.verdict,
      requestedBy: seedActor,
      startedBy: seedActor,
      requestedAt: startedAt,
      startedAt,
      finishedAt: now,
      promotionExpiresAt: run.promotionExpiresAt,
      isPromotionEvidence: false,
      resultsAvailability: CertificationResultsAvailability.FULL,
    })),
    skipDuplicates: true,
  });

  const runGates = runs.flatMap((run) => {
    const failed = run.id === failingRunId;
    const comparisonApplicable =
      run.kind === CertificationRunKind.CHALLENGER && run.championVersionId !== null;
    return [
      [
        CertificationGateKey.FACTUAL_ACCURACY,
        CertificationGateOperator.GTE,
        0.98,
        failed ? 0.91 : 1,
        failed ? CertificationGateResultStatus.FAILED : CertificationGateResultStatus.PASSED,
      ],
      [
        CertificationGateKey.CITATION_COVERAGE,
        CertificationGateOperator.EQ,
        1,
        failed ? 0.83 : 1,
        failed ? CertificationGateResultStatus.FAILED : CertificationGateResultStatus.PASSED,
      ],
      [
        CertificationGateKey.UNAUTHORIZED_ACTIONS,
        CertificationGateOperator.EQ,
        0,
        0,
        CertificationGateResultStatus.PASSED,
      ],
      [
        CertificationGateKey.CHAMPION_REGRESSION,
        CertificationGateOperator.LTE,
        0,
        comparisonApplicable ? (failed ? 1 : 0) : null,
        comparisonApplicable
          ? failed
            ? CertificationGateResultStatus.FAILED
            : CertificationGateResultStatus.PASSED
          : CertificationGateResultStatus.NOT_APPLICABLE,
      ],
    ].map(([gate, operator, threshold, measuredValue, status], index) => ({
      id: stableUuid(`${run.id}:gate:${String(index + 1)}`),
      runId: run.id,
      gate: gate as CertificationGateKey,
      operator: operator as CertificationGateOperator,
      threshold: threshold as number,
      championScore: run.championVersionId === null ? null : 1,
      challengerScore: measuredValue as number | null,
      measuredValue: measuredValue as number | null,
      status: status as CertificationGateResultStatus,
      details: { seeded: true },
    }));
  });
  const immutableEvidenceRunIds = new Set(
    (
      await prisma.certificationRun.findMany({
        where: {
          id: { in: [...runs.map(({ id }) => id), inventoryActivationRunId] },
          isPromotionEvidence: true,
        },
        select: { id: true },
      })
    ).map(({ id }) => id),
  );
  await prisma.certificationGateResult.createMany({
    data: runGates.filter(({ runId }) => !immutableEvidenceRunIds.has(runId)),
    skipDuplicates: true,
  });

  const caseResults = runs.flatMap((run) =>
    evalCases.map((evalCase, index) => {
      const passed = run.id !== failingRunId || index > 1;
      const actual = passed
        ? evalCase.expectedOutput
        : (run.subjectManifest.evaluations[index]?.expectedResult ?? {
            error: 'seeded_regression',
          });
      return {
        id: stableUuid(`${run.id}:case:${evalCase.id}`),
        runId: run.id,
        caseId: evalCase.id,
        caseKey: evalCase.key,
        caseName: evalCase.name,
        tags: evalCase.tags,
        input: evalCase.input,
        expectedOutput: evalCase.expectedOutput,
        expectedCitations: evalCase.expectedCitations,
        championOutput: run.championVersionId === null ? Prisma.JsonNull : evalCase.expectedOutput,
        challengerOutput: actual,
        championCitations: run.championVersionId === null ? [] : evalCase.expectedCitations,
        challengerCitations: passed ? evalCase.expectedCitations : [],
        championActions: [],
        challengerActions: [],
        scoreBreakdown: { fixtureAgreement: passed ? 1 : 0, citationCoverage: passed ? 1 : 0 },
        diff: passed ? {} : { expected: evalCase.expectedOutput, actual },
        passed,
      };
    }),
  );
  await prisma.evalCaseResult.createMany({
    data: caseResults.filter(({ runId }) => !immutableEvidenceRunIds.has(runId)),
    skipDuplicates: true,
  });

  const inventoryCorpusSnapshot = {
    version: 1,
    contentHash: inventoryCorpusHash,
    caseIds: [inventoryEvalCase.id],
  };
  await prisma.certificationRun.createMany({
    data: [
      {
        id: inventoryActivationRunId,
        agentVersionId: inventoryChampionId,
        familyId: inventoryFamilyId,
        championVersionId: null,
        kind: CertificationRunKind.CHALLENGER,
        originStatus: AgentStatus.SHADOW,
        state: CertificationRunState.PASSED,
        corpusVersionId: inventoryCorpusId,
        corpusVersion: 1,
        gateConfigId,
        gateConfigVersion: 1,
        corpusSnapshot: inventoryCorpusSnapshot,
        gateConfigSnapshot,
        subjectSnapshot: {
          agentVersionId: inventoryChampionId,
          name: 'Inventory Risk Analyst',
          versionNumber: 1,
          lifecycleStatus: 'shadow',
          manifestHash: sha256(inventoryDriftManifest),
        },
        championSnapshot: Prisma.JsonNull,
        subjectManifestSnapshot: inventoryDriftManifest,
        championManifestSnapshot: Prisma.JsonNull,
        subjectManifestHash: sha256(inventoryDriftManifest),
        championManifestHash: null,
        specRevision: 1,
        generatorVersion: '0.2.0',
        executorKind: ExecutorKind.MANIFEST_FIXTURE,
        executorVersion: '1.0.0',
        evaluationMode: EvaluationMode.CORPUS_COVERAGE,
        progress: 100,
        message: 'Certification passed',
        totalCaseCount: 1,
        passedCaseCount: 1,
        failedCaseCount: 0,
        verdict: CertificationVerdict.PASSED,
        requestedBy: seedActor,
        startedBy: seedActor,
        requestedAt: startedAt,
        startedAt,
        finishedAt: now,
        promotionExpiresAt: expiresAt,
        isPromotionEvidence: false,
        resultsAvailability: CertificationResultsAvailability.FULL,
      },
    ],
    skipDuplicates: true,
  });
  if (!immutableEvidenceRunIds.has(inventoryActivationRunId)) {
    await prisma.certificationGateResult.createMany({
      data: [
        [CertificationGateKey.FACTUAL_ACCURACY, CertificationGateOperator.GTE, 0.98, 1],
        [CertificationGateKey.CITATION_COVERAGE, CertificationGateOperator.EQ, 1, 1],
        [CertificationGateKey.UNAUTHORIZED_ACTIONS, CertificationGateOperator.EQ, 0, 0],
        [CertificationGateKey.CHAMPION_REGRESSION, CertificationGateOperator.LTE, 0, null],
      ].map(([gate, operator, threshold, measuredValue], index) => ({
        id: stableUuid(`${inventoryActivationRunId}:gate:${String(index + 1)}`),
        runId: inventoryActivationRunId,
        gate: gate as CertificationGateKey,
        operator: operator as CertificationGateOperator,
        threshold: threshold as number,
        championScore: null,
        challengerScore: measuredValue as number | null,
        measuredValue: measuredValue as number | null,
        status:
          measuredValue === null
            ? CertificationGateResultStatus.NOT_APPLICABLE
            : CertificationGateResultStatus.PASSED,
        details: { seeded: true, activationCorpus: true },
      })),
      skipDuplicates: true,
    });
    await prisma.evalCaseResult.createMany({
      data: [
        {
          id: stableUuid(`${inventoryActivationRunId}:case:${inventoryEvalCase.id}`),
          runId: inventoryActivationRunId,
          caseId: inventoryEvalCase.id,
          caseKey: inventoryEvalCase.key,
          caseName: inventoryEvalCase.name,
          tags: inventoryEvalCase.tags,
          input: inventoryEvalCase.input,
          expectedOutput: inventoryEvalCase.expectedOutput,
          expectedCitations: inventoryEvalCase.expectedCitations,
          championOutput: Prisma.JsonNull,
          challengerOutput: inventoryEvalCase.expectedOutput,
          championCitations: [],
          challengerCitations: inventoryEvalCase.expectedCitations,
          championActions: [],
          challengerActions: [],
          scoreBreakdown: { fixtureAgreement: 1, citationCoverage: 1 },
          diff: {},
          passed: true,
        },
      ],
      skipDuplicates: true,
    });
  }
  await prisma.certificationRun.updateMany({
    where: {
      id: { in: [championRunId, inventoryActivationRunId] },
      isPromotionEvidence: false,
    },
    data: {
      isPromotionEvidence: true,
      resultsAvailability: CertificationResultsAvailability.PROMOTION_EVIDENCE,
    },
  });

  await prisma.auditEvent.createMany({
    data: [
      {
        ...localScope,
        id: 'f1b364f8-61a5-4e24-a8d7-903b7ac36c28',
        actorId: seedActor,
        action: 'certification.corpus.seeded',
        entityType: 'EvalCorpusVersion',
        entityId: corpusId,
        details: { version: 2, caseCount: evalCases.length },
      },
      {
        ...localScope,
        id: '4337219b-d6f7-4612-9e53-1824e7398562',
        actorId: seedActor,
        action: 'certification.gates.seeded',
        entityType: 'CertificationGateConfig',
        entityId: gateConfigId,
        details: { version: 1 },
      },
    ],
    skipDuplicates: true,
  });

  await prisma.$transaction(async (transaction) => {
    const ensureDecision = async (input: {
      id: string;
      runId: string;
      familyId: string;
      agentVersionId: string;
      rationale: string;
      auditEventId: string;
    }) => {
      const existing = await transaction.promotionDecision.findUnique({
        where: { runId: input.runId },
      });
      if (existing !== null) return existing;
      const auditEvent = await transaction.auditEvent.findUnique({
        where: { id: input.auditEventId },
      });
      if (auditEvent === null) {
        await transaction.auditEvent.create({
          data: {
            ...localScope,
            id: input.auditEventId,
            actorId: seedActor,
            action: 'promotion.approved',
            entityType: 'Agent',
            entityId: input.agentVersionId,
            details: { runId: input.runId, familyId: input.familyId, seeded: true },
          },
        });
      }
      return transaction.promotionDecision.create({
        data: {
          ...input,
          decision: PromotionDecisionType.PROMOTED,
          decidedBy: seedActor,
          decidedAt: now,
        },
      });
    };
    const supplierDecision = await ensureDecision({
      id: supplierActivationDecisionId,
      runId: championRunId,
      familyId: supplierFamilyId,
      agentVersionId: supplierChampionId,
      rationale: 'Seed the initial certified supplier-delay champion.',
      auditEventId: supplierPromotionAuditId,
    });
    const inventoryDecision = await ensureDecision({
      id: inventoryActivationDecisionId,
      runId: inventoryActivationRunId,
      familyId: inventoryFamilyId,
      agentVersionId: inventoryChampionId,
      rationale: 'Seed the inventory champion against its immutable original corpus.',
      auditEventId: inventoryPromotionAuditId,
    });
    const reconcileChampion = async (input: {
      agentId: string;
      familyId: string;
      decisionId: string;
    }) => {
      const [agent, family] = await Promise.all([
        transaction.agent.findUnique({ where: { id: input.agentId } }),
        transaction.agentFamily.findUnique({ where: { id: input.familyId } }),
      ]);
      if (
        agent?.status !== AgentStatus.CERTIFIED ||
        agent.activationDecisionId !== null ||
        family?.championAgentId !== null
      ) {
        return;
      }
      await transaction.agent.update({
        where: { id: input.agentId },
        data: {
          status: AgentStatus.ACTIVE,
          activationDecisionId: input.decisionId,
          updatedBy: seedActor,
        },
      });
      await transaction.agentFamily.update({
        where: { id: input.familyId },
        data: { championAgentId: input.agentId, updatedBy: seedActor },
      });
    };
    await reconcileChampion({
      agentId: supplierChampionId,
      familyId: supplierFamilyId,
      decisionId: supplierDecision.id,
    });
    await reconcileChampion({
      agentId: inventoryChampionId,
      familyId: inventoryFamilyId,
      decisionId: inventoryDecision.id,
    });
  });
}

async function seedLocalScope(): Promise<void> {
  const workspace = await prisma.workspace.upsert({
    where: { slug: LOCAL_WORKSPACE_SLUG },
    create: {
      id: LOCAL_WORKSPACE_ID,
      slug: LOCAL_WORKSPACE_SLUG,
      name: 'Local workspace',
    },
    update: { name: 'Local workspace' },
  });
  if (workspace.id !== LOCAL_WORKSPACE_ID) {
    throw new Error('The local workspace slug is bound to an unexpected ID');
  }
  const department = await prisma.department.upsert({
    where: {
      workspaceId_slug: {
        workspaceId: LOCAL_WORKSPACE_ID,
        slug: LOCAL_DEPARTMENT_SLUG,
      },
    },
    create: {
      id: LOCAL_DEPARTMENT_ID,
      workspaceId: LOCAL_WORKSPACE_ID,
      slug: LOCAL_DEPARTMENT_SLUG,
      name: 'Personal',
    },
    update: { name: 'Personal' },
  });
  if (department.id !== LOCAL_DEPARTMENT_ID) {
    throw new Error('The local department slug is bound to an unexpected ID');
  }
}

async function main(): Promise<void> {
  await seedLocalScope();
  await seedFamiliesAndVersions();
  await seedSources();
  await seedCertification();
  await seedPlatformResources();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
