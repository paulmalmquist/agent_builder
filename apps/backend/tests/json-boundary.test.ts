import {
  AgentStatus,
  AgentDerivationMode,
  CertificationHealth,
  EvaluationStatus,
  GenerationJobState,
  SpecStatus,
  type Agent as DatabaseAgent,
  type AgentSpec as DatabaseAgentSpec,
  type EvaluationTest as DatabaseEvaluationTest,
  type GenerationJob as DatabaseGenerationJob,
} from '@prisma/client';
import { jsonObjectSchema } from '@agent-builder/contracts';
import { toPrismaJson } from '../src/json-boundary.js';
import { toAgent, toAgentSpec, toEvaluationTest, toGenerationJob } from '../src/mappers.js';

const agentId = '1278447b-3f71-40bc-a5ea-1d680c1a66d0';
const specId = '35f4c5c2-9129-46c5-87a5-a89ed7af62bd';
const jobId = '128f7d4a-e2a1-4117-9c34-9b522626afc8';
const evaluationId = '0b6fd4e3-4c4e-4321-94aa-f84a2f07eeab';
const timestamp = new Date('2026-07-31T12:00:00.000Z');

const databaseAgent: DatabaseAgent = {
  id: agentId,
  familyId: 'cf78ff7f-1b5b-4597-a5f7-c114bc6d4fc6',
  slug: 'json-boundary-probe',
  versionNumber: 1,
  predecessorAgentId: null,
  derivationMode: AgentDerivationMode.NEW,
  name: 'JSON Boundary Probe',
  department: 'Platform Engineering',
  purpose: 'Exercises validation of JSON-backed persistence fields at mapping boundaries.',
  owner: 'Platform Engineering Agent Owner',
  status: AgentStatus.READY,
  capabilities: [],
  manifest: null,
  manifestHash: null,
  certificationHealth: CertificationHealth.NOT_CERTIFIED,
  degradedAt: null,
  degradationReason: null,
  activationDecisionId: null,
  legacyActivation: false,
  retirementReason: null,
  retiredAt: null,
  retiredBy: null,
  retirementRationale: null,
  successorAgentId: null,
  createdBy: 'test-user',
  updatedBy: 'test-user',
  createdAt: timestamp,
  updatedAt: timestamp,
};

const databaseSpec: DatabaseAgentSpec = {
  id: specId,
  agentId,
  baseAgentId: null,
  derivationMode: AgentDerivationMode.NEW,
  interpretationId: null,
  unconfirmedPrefill: null,
  status: SpecStatus.DRAFT,
  revision: 1,
  outcomes: null,
  knowledge: null,
  guardrails: null,
  outputs: null,
  createdBy: 'test-user',
  updatedBy: 'test-user',
  createdAt: timestamp,
  updatedAt: timestamp,
};

const databaseJob: DatabaseGenerationJob = {
  id: jobId,
  agentId,
  specId,
  state: GenerationJobState.SUCCEEDED,
  progress: 100,
  message: 'Generation complete',
  specRevision: 4,
  generatorVersion: '0.2.0',
  specSnapshot: {},
  manifest: null,
  error: null,
  startedAt: timestamp,
  finishedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
};

const databaseEvaluation: DatabaseEvaluationTest = {
  id: evaluationId,
  agentId,
  name: 'Evidence-backed answer',
  testCase: { prompt: 'Summarize supplier risk' },
  expectedResult: { cited: true },
  actualResult: { cited: true },
  status: EvaluationStatus.PASSED,
  generatorVersion: '0.2.0',
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe('Prisma JSON validation boundaries', () => {
  it('rejects a corrupt persisted agent manifest', () => {
    expect(() => toAgent({ ...databaseAgent, manifest: { invalid: true } })).toThrow(
      /Agent\(.*\)\.manifest failed contract validation/,
    );
  });

  it('rejects malformed persisted guardrail policy JSON', () => {
    expect(() =>
      toAgentSpec({
        ...databaseSpec,
        guardrails: {
          workflowStages: 'not-an-array',
          prohibitedActions: [],
        },
      }),
    ).toThrow(/AgentSpec\(.*\)\.guardrails failed contract validation/);
    expect(() =>
      toPrismaJson(jsonObjectSchema, ['not-policy-parameters'], 'Guardrail.parameters'),
    ).toThrow(/Guardrail\.parameters failed contract validation/);
  });

  it('rejects an invalid persisted generation manifest', () => {
    expect(() => toGenerationJob({ ...databaseJob, manifest: { version: 1 } })).toThrow(
      /GenerationJob\(.*\)\.manifest failed contract validation/,
    );
  });

  it('rejects non-JSON evaluation values while mapping database records', () => {
    expect(() =>
      toEvaluationTest({
        ...databaseEvaluation,
        actualResult: BigInt(1) as never,
      }),
    ).toThrow(/EvaluationTest\(.*\)\.actualResult failed contract validation/);
  });
});
