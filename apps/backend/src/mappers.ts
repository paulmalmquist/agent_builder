import {
  AgentStatus as DatabaseAgentStatus,
  EvaluationStatus as DatabaseEvaluationStatus,
  GenerationJobState as DatabaseGenerationJobState,
  SourceAuthority as DatabaseSourceAuthority,
  SourceProvider as DatabaseSourceProvider,
  SourceRole as DatabaseSourceRole,
  SpecStatus as DatabaseSpecStatus,
  type Agent as DatabaseAgent,
  type AgentSpec as DatabaseAgentSpec,
  type EvaluationTest as DatabaseEvaluationTest,
  type GenerationJob as DatabaseGenerationJob,
  type KnowledgeSource as DatabaseKnowledgeSource,
} from '@prisma/client';
import {
  agentManifestSchema,
  agentSchema,
  agentSpecSchema,
  evaluationTestSchema,
  generationErrorSchema,
  generationJobSchema,
  guardrailsSectionSchema,
  jsonObjectSchema,
  jsonValueSchema,
  knowledgeSectionSchema,
  outcomesSectionSchema,
  outputsSectionSchema,
  sourceDescriptorSchema,
  specSnapshotSchema,
  unconfirmedSpecPrefillSchema,
  type Agent,
  type AgentSpec,
  type AgentStatus,
  type GenerationJob,
  type GenerationJobStatus,
  type SourceDescriptor,
  type SpecSnapshot,
  type SpecStatus,
} from '@agent-builder/contracts';
import { z } from 'zod';
import { parseJson } from './json-boundary.js';

const agentStatusMap = {
  [DatabaseAgentStatus.DRAFT]: 'draft',
  [DatabaseAgentStatus.GENERATING]: 'generating',
  [DatabaseAgentStatus.READY]: 'ready',
  [DatabaseAgentStatus.SHADOW]: 'shadow',
  [DatabaseAgentStatus.CERTIFYING]: 'certifying',
  [DatabaseAgentStatus.CERTIFIED]: 'certified',
  [DatabaseAgentStatus.REJECTED]: 'rejected',
  [DatabaseAgentStatus.ACTIVE]: 'active',
  [DatabaseAgentStatus.FAILED]: 'failed',
  [DatabaseAgentStatus.RETIRED]: 'retired',
} as const satisfies Record<DatabaseAgentStatus, AgentStatus>;

const specStatusMap = {
  [DatabaseSpecStatus.DRAFT]: 'draft',
  [DatabaseSpecStatus.READY]: 'ready',
  [DatabaseSpecStatus.GENERATING]: 'generating',
  [DatabaseSpecStatus.GENERATED]: 'generated',
} as const satisfies Record<DatabaseSpecStatus, SpecStatus>;

const generationStatusMap = {
  [DatabaseGenerationJobState.QUEUED]: 'queued',
  [DatabaseGenerationJobState.RUNNING]: 'running',
  [DatabaseGenerationJobState.SUCCEEDED]: 'succeeded',
  [DatabaseGenerationJobState.FAILED]: 'failed',
} as const satisfies Record<DatabaseGenerationJobState, GenerationJobStatus>;

const sourceRoleMap = {
  [DatabaseSourceRole.KNOWLEDGE]: 'knowledge',
  [DatabaseSourceRole.SIGNAL]: 'signal',
  [DatabaseSourceRole.TELEMETRY]: 'telemetry',
  [DatabaseSourceRole.EVALUATION]: 'evaluation',
} as const;

const sourceProviderMap = {
  [DatabaseSourceProvider.BIGQUERY]: 'bigquery',
  [DatabaseSourceProvider.CONFLUENCE]: 'confluence',
  [DatabaseSourceProvider.JIRA]: 'jira',
  [DatabaseSourceProvider.EMAIL]: 'email',
  [DatabaseSourceProvider.SLACK]: 'slack',
  [DatabaseSourceProvider.TELEMETRY]: 'telemetry',
  [DatabaseSourceProvider.FIXTURE]: 'fixture',
} as const;

const sourceAuthorityMap = {
  [DatabaseSourceAuthority.SYSTEM_OF_RECORD]: 'system_of_record',
  [DatabaseSourceAuthority.CURATED]: 'curated',
  [DatabaseSourceAuthority.DERIVED]: 'derived',
  [DatabaseSourceAuthority.TRANSIENT]: 'transient',
  [DatabaseSourceAuthority.UNTRUSTED]: 'untrusted',
} as const;

const evaluationStatusMap = {
  [DatabaseEvaluationStatus.NOT_RUN]: 'not_run',
  [DatabaseEvaluationStatus.PASSED]: 'passed',
  [DatabaseEvaluationStatus.FAILED]: 'failed',
} as const;

const capabilitiesSchema = z.array(z.string());

const iso = (date: Date): string => date.toISOString();

export function toAgent(record: DatabaseAgent): Agent {
  return agentSchema.parse({
    id: record.id,
    familyId: record.familyId,
    slug: record.slug,
    versionNumber: record.versionNumber,
    predecessorAgentId: record.predecessorAgentId,
    derivationMode: record.derivationMode.toLowerCase(),
    name: record.name,
    department: record.department,
    purpose: record.purpose,
    owner: record.owner,
    status: agentStatusMap[record.status],
    capabilities: parseJson(
      capabilitiesSchema,
      record.capabilities,
      `Agent(${record.id}).capabilities`,
    ),
    manifest:
      record.manifest === null
        ? null
        : parseJson(agentManifestSchema, record.manifest, `Agent(${record.id}).manifest`),
    manifestHash: record.manifestHash,
    certificationHealth: record.certificationHealth.toLowerCase(),
    degradedAt: record.degradedAt?.toISOString() ?? null,
    degradationReason: record.degradationReason,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  });
}

export function toAgentSpec(record: DatabaseAgentSpec): AgentSpec {
  const outcomes =
    record.outcomes === null
      ? null
      : parseJson(outcomesSectionSchema, record.outcomes, `AgentSpec(${record.id}).outcomes`);
  const knowledge =
    record.knowledge === null
      ? null
      : parseJson(knowledgeSectionSchema, record.knowledge, `AgentSpec(${record.id}).knowledge`);
  const guardrails =
    record.guardrails === null
      ? null
      : parseJson(guardrailsSectionSchema, record.guardrails, `AgentSpec(${record.id}).guardrails`);
  const outputs =
    record.outputs === null
      ? null
      : parseJson(outputsSectionSchema, record.outputs, `AgentSpec(${record.id}).outputs`);

  return agentSpecSchema.parse({
    id: record.id,
    agentId: record.agentId,
    baseAgentId: record.baseAgentId,
    derivationMode: record.derivationMode.toLowerCase(),
    interpretationId: record.interpretationId,
    unconfirmedPrefill:
      record.unconfirmedPrefill === null
        ? null
        : parseJson(
            unconfirmedSpecPrefillSchema,
            record.unconfirmedPrefill,
            `AgentSpec(${record.id}).unconfirmedPrefill`,
          ),
    status: specStatusMap[record.status],
    revision: record.revision,
    outcomes,
    knowledge,
    guardrails,
    outputs,
    completion: {
      outcomes: outcomes !== null,
      knowledge: knowledge !== null,
      guardrails: guardrails !== null,
      outputs: outputs !== null,
    },
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  });
}

export function toSpecSnapshot(record: DatabaseAgentSpec): SpecSnapshot {
  const spec = toAgentSpec(record);
  return specSnapshotSchema.parse({
    id: spec.id,
    agentId: spec.agentId,
    baseAgentId: spec.baseAgentId,
    derivationMode: spec.derivationMode,
    interpretationId: spec.interpretationId,
    status: 'ready',
    revision: spec.revision,
    outcomes: spec.outcomes,
    knowledge: spec.knowledge,
    guardrails: spec.guardrails,
    outputs: spec.outputs,
  });
}

export function toGenerationJob(record: DatabaseGenerationJob): GenerationJob {
  return generationJobSchema.parse({
    id: record.id,
    agentId: record.agentId,
    specId: record.specId,
    state: generationStatusMap[record.state],
    progress: record.progress,
    message: record.message,
    specRevision: record.specRevision,
    generatorVersion: record.generatorVersion,
    manifest:
      record.manifest === null
        ? null
        : parseJson(agentManifestSchema, record.manifest, `GenerationJob(${record.id}).manifest`),
    error:
      record.error === null
        ? null
        : parseJson(generationErrorSchema, record.error, `GenerationJob(${record.id}).error`),
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  });
}

export function toSourceDescriptor(record: DatabaseKnowledgeSource): SourceDescriptor {
  return sourceDescriptorSchema.parse({
    id: record.id,
    role: sourceRoleMap[record.role],
    provider: sourceProviderMap[record.provider],
    displayName: record.displayName,
    uri: record.uri,
    authority: sourceAuthorityMap[record.authority],
    owner: record.owner,
    region: record.region,
    lastRefreshed: record.lastRefreshed?.toISOString() ?? null,
    citationRequired: record.citationRequired,
    readOnly: record.readOnly,
    synthetic: record.synthetic,
    metadata: parseJson(
      jsonObjectSchema,
      record.metadata,
      `KnowledgeSource(${record.id}).metadata`,
    ),
  });
}

export function toEvaluationTest(record: DatabaseEvaluationTest) {
  return evaluationTestSchema.parse({
    id: record.id,
    agentId: record.agentId,
    name: record.name,
    testCase: parseJson(jsonValueSchema, record.testCase, `EvaluationTest(${record.id}).testCase`),
    expectedResult: parseJson(
      jsonValueSchema,
      record.expectedResult,
      `EvaluationTest(${record.id}).expectedResult`,
    ),
    actualResult:
      record.actualResult === null
        ? null
        : parseJson(
            jsonValueSchema,
            record.actualResult,
            `EvaluationTest(${record.id}).actualResult`,
          ),
    status: evaluationStatusMap[record.status],
    generatorVersion: record.generatorVersion,
  });
}
