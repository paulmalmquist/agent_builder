import {
  evaluationSuiteSpecSchema,
  resourceManifestSchema,
  type ReleaseEvaluation,
} from '@agent-builder/contracts';
import { z } from 'zod';
import type {
  EvaluationResource,
  ReleaseEvaluationHistory,
  ReleaseEvaluator,
  ReleaseEvaluatorOutput,
} from './evaluator.js';

type EvaluationResult = ReleaseEvaluation['results'][number];
type GateResult = ReleaseEvaluation['gateResults'][number];

export const deterministicContractDisclaimer =
  'Deterministic contract evidence validates declared fixtures and release composition; it does not measure semantic model quality.' as const;

const skillDefinitionSchema = resourceManifestSchema.extend({
  kind: z.literal('Skill'),
  spec: z.object({
    inputSchema: z.record(z.unknown()),
    outputSchema: z.record(z.unknown()),
    tools: z.array(z.string()),
    permissions: z.array(z.string()),
    contextRequirements: z.array(z.string()),
    successCriteria: z.array(z.string()),
  }),
});

function resolveDependencyClosure(
  subjectRecord: EvaluationResource | undefined,
  resources: EvaluationResource[],
): { complete: boolean; resourceIds: string[] } {
  if (subjectRecord === undefined) return { complete: false, resourceIds: [] };
  const available = new Map<
    string,
    { resource: EvaluationResource; manifest: z.infer<typeof resourceManifestSchema> }
  >();
  for (const resource of resources) {
    const manifest = resourceManifestSchema.safeParse(resource.definition);
    if (manifest.success) {
      available.set(`${manifest.data.metadata.id}@${manifest.data.metadata.version}`, {
        resource,
        manifest: manifest.data,
      });
    }
  }
  const subjectManifest = resourceManifestSchema.safeParse(subjectRecord.definition);
  if (!subjectManifest.success) return { complete: false, resourceIds: [] };

  const resourceIds = new Set<string>();
  const pending = [{ resource: subjectRecord, manifest: subjectManifest.data }];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || resourceIds.has(current.resource.id)) continue;
    resourceIds.add(current.resource.id);
    for (const dependency of current.manifest.dependencies) {
      const resolved = available.get(`${dependency.familyId}@${dependency.version}`);
      if (resolved === undefined) return { complete: false, resourceIds: [...resourceIds] };
      pending.push(resolved);
    }
  }
  return { complete: true, resourceIds: [...resourceIds] };
}

function assertionResult(
  key: EvaluationResult['assertions'][number]['key'],
  subject: z.infer<typeof skillDefinitionSchema>,
): EvaluationResult['assertions'][number] {
  const outputRequired = z.array(z.string()).catch([]).parse(subject.spec.outputSchema['required']);
  const outputProperties = z
    .record(z.unknown())
    .catch({})
    .parse(subject.spec.outputSchema['properties']);
  const authorityBearing = [...subject.spec.permissions, ...subject.spec.tools].some((value) =>
    /(?:write|delete|mutate|admin|execute)/i.test(value),
  );

  switch (key) {
    case 'output_schema_valid': {
      const passed =
        subject.spec.outputSchema['type'] === 'object' && Object.keys(outputProperties).length > 0;
      return {
        key,
        passed,
        detail: passed
          ? 'The subject declares a bounded object output contract.'
          : 'The subject does not declare a usable object output contract.',
      };
    }
    case 'schedule_risk_present': {
      const passed =
        outputRequired.includes('scheduleRisks') && 'scheduleRisks' in outputProperties;
      return {
        key,
        passed,
        detail: passed
          ? 'The declared output requires schedule risks.'
          : 'The declared output does not require schedule risks.',
      };
    }
    case 'citations_resolve_to_supplied_calendar_items': {
      const inputProperties = z
        .record(z.unknown())
        .catch({})
        .parse(subject.spec.inputSchema['properties']);
      const passed =
        'calendarItems' in inputProperties &&
        outputRequired.includes('citations') &&
        'citations' in outputProperties;
      return {
        key,
        passed,
        detail: passed
          ? 'Calendar inputs and required citation outputs are both declared.'
          : 'The contract cannot structurally connect calendar inputs to citation outputs.',
      };
    }
    case 'no_attempted_actions':
      return {
        key,
        passed: !authorityBearing,
        detail: authorityBearing
          ? 'The subject declares an authority-bearing tool or permission.'
          : 'The subject declares no authority-bearing tools or permissions.',
      };
  }
}

function gateStatus(measuredValue: number, operator: GateResult['operator'], threshold: number) {
  const passed =
    operator === 'gte'
      ? measuredValue >= threshold
      : operator === 'lte'
        ? measuredValue <= threshold
        : measuredValue === threshold;
  return passed ? ('passed' as const) : ('failed' as const);
}

function contractGate(input: {
  key: GateResult['key'];
  operator: GateResult['operator'];
  threshold: number;
  measuredValue: number;
  sampleSize: number;
}): GateResult {
  const missingEvidence = input.sampleSize === 0;
  return {
    ...input,
    category: 'contract',
    measuredValue: missingEvidence ? null : input.measuredValue,
    status: missingEvidence
      ? 'failed'
      : gateStatus(input.measuredValue, input.operator, input.threshold),
    evidenceSource: 'manifest_declaration',
    detail: missingEvidence
      ? 'The suite configured this gate but declared no matching deterministic assertion.'
      : 'Measured from the suite assertions against the immutable resource declaration.',
  };
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile95(values: number[]): number {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * 0.95) - 1);
  return ordered[index] ?? 0;
}

function historyGate(input: {
  key: GateResult['key'];
  category: GateResult['category'];
  operator: GateResult['operator'];
  threshold: number;
  values: number[];
  minimumSamples: number;
  aggregate: (values: number[]) => number;
}): GateResult {
  if (input.values.length < input.minimumSamples) {
    return {
      key: input.key,
      category: input.category,
      operator: input.operator,
      threshold: input.threshold,
      measuredValue: null,
      status: 'not_applicable',
      sampleSize: input.values.length,
      evidenceSource: 'execution_history',
      detail: `Requires ${input.minimumSamples} production samples; ${input.values.length} are available.`,
    };
  }
  const measuredValue = input.aggregate(input.values);
  return {
    key: input.key,
    category: input.category,
    operator: input.operator,
    threshold: input.threshold,
    measuredValue,
    status: gateStatus(measuredValue, input.operator, input.threshold),
    sampleSize: input.values.length,
    evidenceSource: 'execution_history',
    detail: 'Measured from completed production runs of this exact immutable release digest.',
  };
}

export function evaluateReleaseContract(input: {
  suiteDefinition: unknown;
  resources: EvaluationResource[];
  history?: ReleaseEvaluationHistory;
  historySnapshotDigest?: string;
  historyRunIds?: string[];
}): ReleaseEvaluatorOutput {
  const suiteManifest = resourceManifestSchema.parse(input.suiteDefinition);
  const suite = evaluationSuiteSpecSchema.parse(suiteManifest.spec);
  const separator = suite.subject.lastIndexOf('@');
  const subjectSlug = separator < 1 ? suite.subject : suite.subject.slice(0, separator);
  const subjectVersion = separator < 1 ? '' : suite.subject.slice(separator + 1);
  const subjectRecord = input.resources.find(
    ({ slug, version }) => slug === subjectSlug && version === subjectVersion,
  );
  const subject = skillDefinitionSchema.safeParse(subjectRecord?.definition);
  const dependencyClosure = resolveDependencyClosure(subjectRecord, input.resources);

  const results = suite.cases.map((testCase): EvaluationResult => {
    if (!subject.success) {
      return {
        caseKey: testCase.key,
        assertions: testCase.assertions.map((key) => ({
          key,
          passed: false,
          detail: 'The declared evaluation subject is absent or is not a valid Skill resource.',
        })),
        passed: false,
      };
    }
    const assertions = testCase.assertions.map((key) => assertionResult(key, subject.data));
    return { caseKey: testCase.key, assertions, passed: assertions.every(({ passed }) => passed) };
  });
  const assertions = results.flatMap((result) => result.assertions);
  const scoreFor = (key: EvaluationResult['assertions'][number]['key']): number => {
    const selected = assertions.filter((assertion) => assertion.key === key);
    return selected.length === 0
      ? 0
      : selected.filter(({ passed }) => passed).length / selected.length;
  };
  const countFor = (key: EvaluationResult['assertions'][number]['key']): number =>
    assertions.filter((assertion) => assertion.key === key).length;
  const gateScores = {
    schemaConformance: scoreFor('output_schema_valid'),
    citationCoverage: scoreFor('citations_resolve_to_supplied_calendar_items'),
    unauthorizedActions: assertions.filter(
      ({ key, passed }) => key === 'no_attempted_actions' && !passed,
    ).length,
  };
  const gateResults: GateResult[] = [
    {
      key: 'dependency_closure',
      category: 'contract',
      operator: 'eq',
      threshold: 1,
      measuredValue: dependencyClosure.complete ? 1 : 0,
      status: dependencyClosure.complete ? 'passed' : 'failed',
      sampleSize: dependencyClosure.resourceIds.length,
      evidenceSource: 'manifest_declaration',
      detail: dependencyClosure.complete
        ? 'The declared subject and every exact dependency pin are present in the immutable release.'
        : 'The immutable release omits or cannot validate an exact subject dependency pin.',
    },
    contractGate({
      key: 'schema_conformance',
      operator: 'gte',
      threshold: suite.gates.schemaConformance,
      measuredValue: gateScores.schemaConformance,
      sampleSize: countFor('output_schema_valid'),
    }),
    contractGate({
      key: 'citation_coverage',
      operator: 'gte',
      threshold: suite.gates.citationCoverage,
      measuredValue: gateScores.citationCoverage,
      sampleSize: countFor('citations_resolve_to_supplied_calendar_items'),
    }),
    contractGate({
      key: 'unauthorized_actions',
      operator: 'lte',
      threshold: suite.gates.unauthorizedActions,
      measuredValue: gateScores.unauthorizedActions,
      sampleSize: countFor('no_attempted_actions'),
    }),
  ];
  const historyConfig = suite.gates.historical;
  if (historyConfig !== undefined) {
    const history = input.history ?? { costUsd: [], latencyMs: [], outcomeQuality: [] };
    gateResults.push(
      historyGate({
        key: 'mean_cost_usd',
        category: 'cost',
        operator: 'lte',
        threshold: historyConfig.maxMeanCostUsd,
        values: history.costUsd.slice(0, historyConfig.historyWindow),
        minimumSamples: historyConfig.minSampleSize,
        aggregate: mean,
      }),
      historyGate({
        key: 'p95_latency_ms',
        category: 'latency',
        operator: 'lte',
        threshold: historyConfig.maxP95LatencyMs,
        values: history.latencyMs.slice(0, historyConfig.historyWindow),
        minimumSamples: historyConfig.minSampleSize,
        aggregate: percentile95,
      }),
      historyGate({
        key: 'mean_outcome_quality',
        category: 'outcome_history',
        operator: 'gte',
        threshold: historyConfig.minMeanOutcomeQuality,
        values: history.outcomeQuality.slice(0, historyConfig.historyWindow),
        minimumSamples: historyConfig.minSampleSize,
        aggregate: mean,
      }),
    );
  }
  const passed =
    dependencyClosure.complete &&
    results.every((result) => result.passed) &&
    gateResults.every(({ status }) => status !== 'failed');
  return {
    corpusVersion: suite.corpusVersion,
    verdict: passed ? 'passed' : 'failed',
    certifiedResourceIds: passed && subject.success ? dependencyClosure.resourceIds : [],
    results,
    gateScores,
    gateResults,
    evidence: {
      schemaVersion: 1,
      historySnapshotDigest: input.historySnapshotDigest ?? '0'.repeat(64),
      historyRunIds: input.historyRunIds ?? [],
      suiteCaseCount: suite.cases.length,
      assertionCount: assertions.length,
      subjectPresent: subject.success,
      subjectDigest: subjectRecord?.digest ?? 'missing',
      dependencyClosureComplete: dependencyClosure.complete,
      certifiedResourceIds: passed ? dependencyClosure.resourceIds : [],
      gateResults,
    },
  };
}

export class DeterministicContractReleaseEvaluator implements ReleaseEvaluator {
  readonly kind = 'deterministic_contract' as const;
  readonly version = '1.1.0';
  readonly mode = 'contract_validation' as const;
  readonly disclaimer = deterministicContractDisclaimer;

  evaluate(input: Parameters<ReleaseEvaluator['evaluate']>[0]): ReleaseEvaluatorOutput {
    return evaluateReleaseContract(input);
  }
}
