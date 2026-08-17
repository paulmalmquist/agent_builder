import type {
  AimMetricSeries,
  AimPartDefinition,
  AimPartStatusEvent,
  AimProgramManifest,
} from '@agent-builder/contracts/aim';
import { ageHours, evaluatePartEvidence, isEvidenceFresh } from './evidence-policy.js';
import type {
  AimDecisionLoopState,
  AimInterfaceState,
  AimMetricState,
  AimMilestoneState,
  AimPartState,
  AimProgramState,
  AimProgramViewModel,
} from './program-view-model.js';
import { deriveVisualState } from './visual-state.js';

function selectedIso(selectedTime: string | Date): string {
  const date =
    selectedTime instanceof Date ? new Date(selectedTime.getTime()) : new Date(selectedTime);
  if (!Number.isFinite(date.getTime()))
    throw new RangeError('selectedTime must be a valid timestamp');
  return date.toISOString();
}

function latestAt<T extends { effectiveAt: string }>(
  history: readonly T[],
  selectedAt: string,
): T | null {
  const selected = Date.parse(selectedAt);
  return history.reduce<T | null>(
    (latest, item) =>
      Date.parse(item.effectiveAt) <= selected &&
      (latest === null || Date.parse(item.effectiveAt) > Date.parse(latest.effectiveAt))
        ? item
        : latest,
    null,
  );
}

function metricAt(
  metric: AimMetricSeries | undefined,
  selectedAt: string,
  manifest: AimProgramManifest,
): AimMetricState | null {
  if (metric === undefined) return null;
  const selected = Date.parse(selectedAt);
  const observation = metric.observations.reduce<(typeof metric.observations)[number] | null>(
    (latest, item) =>
      Date.parse(item.observedAt) <= selected &&
      (latest === null || Date.parse(item.observedAt) > Date.parse(latest.observedAt))
        ? item
        : latest,
    null,
  );
  if (observation === null) return null;
  const age = ageHours(observation.observedAt, selectedAt);
  const source = manifest.sources.find(({ id }) => id === observation.sourceRef);
  const freshnessSlaHours =
    source?.freshnessSlaHours ?? manifest.displayPolicy.defaultEvidenceFreshnessSlaHours;
  return {
    id: metric.id,
    label: metric.label,
    kind: metric.kind,
    unit: metric.unit,
    value: observation.value,
    observedAt: observation.observedAt,
    sourceRef: observation.sourceRef,
    evidenceRefs: [...observation.evidenceRefs],
    confidence: observation.confidence,
    ageHours: age,
    isStale: age > freshnessSlaHours,
  };
}

function metricValue(
  metrics: ReadonlyMap<string, AimMetricState>,
  id: string | undefined,
): number | null {
  return id === undefined ? null : (metrics.get(id)?.value ?? null);
}

function lifecycleProgress(
  part: AimPartDefinition,
  status: AimPartStatusEvent | null,
  selectedAt: string,
): number {
  if (status === null || status.lifecycle === 'planned') return 0;
  if (status.lifecycle === 'production' || status.lifecycle === 'retired') return 1;
  const currentIndex = part.statusHistory.indexOf(status);
  const next = currentIndex < 0 ? undefined : part.statusHistory[currentIndex + 1];
  const fraction =
    next === undefined
      ? status.lifecycle === 'poc'
        ? 0.5
        : 0.85
      : Math.min(
          1,
          Math.max(
            0,
            (Date.parse(selectedAt) - Date.parse(status.effectiveAt)) /
              (Date.parse(next.effectiveAt) - Date.parse(status.effectiveAt)),
          ),
        );
  return status.lifecycle === 'poc' ? fraction * 0.75 : 0.75 + fraction * 0.25;
}

function milestoneStates(manifest: AimProgramManifest, selectedAt: string): AimMilestoneState[] {
  const selected = Date.parse(selectedAt);
  return manifest.milestones.map((milestone) => ({
    id: milestone.id,
    label: milestone.label,
    date: milestone.date,
    timing:
      Date.parse(milestone.date) > selected
        ? 'upcoming'
        : Date.parse(milestone.date) === selected
          ? 'due'
          : 'past',
    ownerGroupIds: [...milestone.ownerGroupIds],
    affectedPartIds: [...milestone.affectedPartIds],
    criteria: milestone.gateCriteria.map((criterion) => {
      const result = latestAt(criterion.resultHistory, selectedAt);
      return {
        id: criterion.id,
        label: criterion.label,
        required: criterion.required,
        state: result?.state ?? 'unknown',
        effectiveAt: result?.effectiveAt ?? null,
        evidenceRefs: [...(result?.evidenceRefs ?? criterion.evidenceRefs)],
      };
    }),
    evidenceRefs: [...milestone.evidenceRefs],
  }));
}

function interfaceStates(manifest: AimProgramManifest, selectedAt: string): AimInterfaceState[] {
  return manifest.interfaces.map((contract) => {
    const status = latestAt(contract.statusHistory, selectedAt);
    const state = status?.state ?? 'planned';
    return {
      id: contract.id,
      label: contract.label,
      partIds: [...contract.partIds],
      state,
      effectiveAt: status?.effectiveAt ?? null,
      evidenceRefs: [...(status?.evidenceRefs ?? contract.evidenceRefs)],
      governed: state === 'governed',
    };
  });
}

function decisionLoopStates(
  manifest: AimProgramManifest,
  selectedAt: string,
  metrics: ReadonlyMap<string, AimMetricState>,
): AimDecisionLoopState[] {
  return manifest.decisionLoops.map((loop) => {
    const manualHandoffCount = loop.manualHandoffs.filter(
      (handoff) => latestAt(handoff.statusHistory, selectedAt)?.state === 'manual',
    ).length;
    const current = metricValue(metrics, loop.currentLatencyMetricId);
    const activeStep =
      !manifest.program.synthetic || loop.steps.length === 0
        ? null
        : loop.steps[Math.floor(Date.parse(selectedAt) / 1000) % loop.steps.length];
    return {
      id: loop.id,
      label: loop.label,
      partIds: [...loop.partIds],
      ownerGroupIds: [...loop.ownerGroupIds],
      baselineLatencyHours: metricValue(metrics, loop.baselineLatencyMetricId),
      currentLatencyHours: current,
      targetLatencyHours: metricValue(metrics, loop.targetLatencyMetricId),
      manualHandoffCount,
      activeStepId: current === null ? null : (activeStep?.id ?? null),
      syntheticAnimation: manifest.program.synthetic,
    };
  });
}

/** Pure historical/forecast projection. The manifest is never mutated. */
export function stateAt(
  manifest: AimProgramManifest,
  selectedTime: string | Date,
): AimProgramViewModel {
  const selectedAt = selectedIso(selectedTime);
  const metricStates = manifest.metrics
    .map((metric) => metricAt(metric, selectedAt, manifest))
    .filter((metric): metric is AimMetricState => metric !== null);
  const metrics = new Map(metricStates.map((metric) => [metric.id, metric] as const));
  const capabilityById = new Map(manifest.capabilities.map((item) => [item.id, item] as const));

  const parts: AimPartState[] = manifest.parts.map((part) => {
    const status = latestAt(part.statusHistory, selectedAt);
    const lifecycle = status?.lifecycle ?? 'planned';
    const sourceReadiness = status?.readiness ?? 'unknown';
    return {
      id: part.id,
      label: part.label,
      anchorId: part.anchorId,
      fallbackRegion: part.fallbackRegion ?? null,
      capabilityIds: [...part.capabilityIds],
      capabilityLayers: [
        ...new Set(
          part.capabilityIds.flatMap((id) => {
            const capability = capabilityById.get(id);
            return capability === undefined ? [] : [capability.layer];
          }),
        ),
      ],
      participatingGroupIds: [...part.participatingGroupIds],
      primaryGroupId: part.primaryGroupId ?? null,
      problem: part.problem,
      decisionLoopIds: [...part.decisionLoopIds],
      unlocksPartIds: [...part.unlocksPartIds],
      dependencyPartIds: [...part.dependencyPartIds],
      lifecycle,
      sourceReadiness,
      statusEffectiveAt: status?.effectiveAt ?? null,
      statusSourceRef: status?.sourceRef ?? null,
      statusNote: status?.note ?? null,
      lifecycleProgress: lifecycleProgress(part, status, selectedAt),
      knowledgeCoveragePercent: metricValue(metrics, part.knowledgeCoverageMetricId),
      qualifyingAgentActive: (metricValue(metrics, part.agentStatusMetricId) ?? 0) > 0,
      baselineLatencyHours: metricValue(metrics, part.baselineLatencyMetricId),
      currentLatencyHours: metricValue(metrics, part.currentLatencyMetricId),
      targetLatencyHours: metricValue(metrics, part.targetLatencyMetricId),
      evidenceGate: evaluatePartEvidence(manifest, part, status, selectedAt, metrics),
      evidenceRefs: [...new Set([...part.evidenceRefs, ...(status?.evidenceRefs ?? [])])].sort(),
      sourceRefs: [...part.sourceRefs],
    };
  });

  const factoryMaturity = metricValue(metrics, manifest.displayPolicy.factoryMaturityMetricId);
  const semanticState: AimProgramState = {
    schemaVersion: manifest.schemaVersion,
    program: { ...manifest.program },
    displayPolicy: { ...manifest.displayPolicy },
    selectedAt,
    outsideTimeline:
      Date.parse(selectedAt) < Date.parse(manifest.timeline.startAt) ||
      Date.parse(selectedAt) > Date.parse(manifest.timeline.endAt),
    parts,
    milestones: milestoneStates(manifest, selectedAt),
    decisionLoops: decisionLoopStates(manifest, selectedAt, metrics),
    interfaces: interfaceStates(manifest, selectedAt),
    metrics: metricStates,
    availableEvidenceIds: manifest.evidence
      .filter((item) => isEvidenceFresh(item, manifest, selectedAt))
      .map(({ id }) => id)
      .sort(),
    sources: manifest.sources.map((source) => {
      const age = ageHours(source.observedAt, selectedAt);
      return {
        id: source.id,
        label: source.label,
        observedAt: source.observedAt,
        ageHours: age,
        isStale:
          age >
          (source.freshnessSlaHours ?? manifest.displayPolicy.defaultEvidenceFreshnessSlaHours),
        synthetic: source.synthetic,
        reconciliationStatus: source.reconciliationStatus,
      };
    }),
    factory: {
      printSpeed: factoryMaturity === null ? 1 : Math.min(2, Math.max(0.25, factoryMaturity / 50)),
      maturityPercent: factoryMaturity,
      unsourcedDemoRate: factoryMaturity === null,
    },
  };
  return {
    ...semanticState,
    parts: parts.map((part) => ({
      ...part,
      visual: deriveVisualState(semanticState, part, manifest.displayPolicy),
    })),
  };
}
