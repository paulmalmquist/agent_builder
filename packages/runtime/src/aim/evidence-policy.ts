import type {
  AimEvidenceReference,
  AimPartDefinition,
  AimPartStatusEvent,
  AimProgramManifest,
} from '@agent-builder/contracts/aim';
import type { AimEvidenceGate, AimMetricState } from './program-view-model.js';

const HOUR_MS = 3_600_000;

export function ageHours(observedAt: string, selectedAt: string): number {
  return Math.max(0, (Date.parse(selectedAt) - Date.parse(observedAt)) / HOUR_MS);
}

export function isEvidenceFresh(
  evidence: AimEvidenceReference,
  manifest: AimProgramManifest,
  selectedAt: string,
): boolean {
  if (Date.parse(evidence.observedAt) > Date.parse(selectedAt)) return false;
  const source = manifest.sources.find(({ id }) => id === evidence.sourceId);
  const freshnessHours =
    evidence.freshnessSlaHours ??
    source?.freshnessSlaHours ??
    manifest.displayPolicy.defaultEvidenceFreshnessSlaHours;
  return ageHours(evidence.observedAt, selectedAt) <= freshnessHours;
}

function latestAt<T extends { effectiveAt: string }>(
  history: readonly T[],
  selectedAt: string,
): T | null {
  const selectedTime = Date.parse(selectedAt);
  return history.reduce<T | null>(
    (latest, event) =>
      Date.parse(event.effectiveAt) <= selectedTime &&
      (latest === null || Date.parse(event.effectiveAt) > Date.parse(latest.effectiveAt))
        ? event
        : latest,
    null,
  );
}

export function evaluatePartEvidence(
  manifest: AimProgramManifest,
  part: AimPartDefinition,
  status: AimPartStatusEvent | null,
  selectedAt: string,
  metrics: ReadonlyMap<string, AimMetricState>,
): AimEvidenceGate {
  const requiredEvidenceIds = new Set([...part.evidenceRefs, ...(status?.evidenceRefs ?? [])]);
  const requiredMetricIds = new Set<string>();
  const criterionIds: string[] = [];
  let criteriaUnsatisfied = false;

  for (const milestone of manifest.milestones) {
    for (const criterion of milestone.gateCriteria) {
      if (!criterion.required || !criterion.affectedPartIds.includes(part.id)) continue;
      criterionIds.push(criterion.id);
      criterion.evidenceRefs.forEach((id) => requiredEvidenceIds.add(id));
      criterion.requiredMetricIds.forEach((id) => requiredMetricIds.add(id));
      const result = latestAt(criterion.resultHistory, selectedAt);
      if (result === null || result.state !== 'satisfied') criteriaUnsatisfied = true;
      result?.evidenceRefs.forEach((id) => requiredEvidenceIds.add(id));
    }
  }

  const latencyIds = [
    part.baselineLatencyMetricId,
    part.currentLatencyMetricId,
    part.targetLatencyMetricId,
  ];
  if (latencyIds.some((id) => id !== undefined)) {
    latencyIds
      .filter((id): id is string => id !== undefined)
      .forEach((id) => requiredMetricIds.add(id));
    if (latencyIds.some((id) => id === undefined)) criteriaUnsatisfied = true;
  }

  const evidenceById = new Map(manifest.evidence.map((item) => [item.id, item] as const));
  const availableEvidenceIds: string[] = [];
  const staleEvidenceIds: string[] = [];
  const missingEvidenceIds: string[] = [];
  for (const id of requiredEvidenceIds) {
    const item = evidenceById.get(id);
    if (item === undefined || Date.parse(item.observedAt) > Date.parse(selectedAt)) {
      missingEvidenceIds.push(id);
    } else if (!isEvidenceFresh(item, manifest, selectedAt)) {
      staleEvidenceIds.push(id);
    } else {
      availableEvidenceIds.push(id);
    }
  }

  const missingMetricIds = [...requiredMetricIds].filter((id) => !metrics.has(id));
  const statusSource =
    status === null ? null : manifest.sources.find(({ id }) => id === status.sourceRef);
  const sourceConflict = statusSource?.reconciliationStatus === 'conflicting';
  const sourceStale =
    statusSource !== null &&
    statusSource !== undefined &&
    ageHours(statusSource.observedAt, selectedAt) >
      (statusSource.freshnessSlaHours ?? manifest.displayPolicy.defaultEvidenceFreshnessSlaHours);

  const reasons: string[] = [];
  let gateStatus: AimEvidenceGate['status'] = 'satisfied';
  if (sourceConflict) {
    gateStatus = 'source_conflict';
    reasons.push('The source record is in a conflicting reconciliation state.');
  } else if (sourceStale) {
    gateStatus = 'source_stale';
    reasons.push('The status source is older than its freshness policy.');
  } else if (status?.readiness === 'go' && requiredEvidenceIds.size === 0) {
    gateStatus = 'evidence_missing';
    reasons.push('GO requires at least one declared evidence reference.');
  } else if (missingEvidenceIds.length > 0) {
    gateStatus = 'evidence_missing';
    reasons.push(
      `Required evidence is unavailable at the selected time: ${missingEvidenceIds.join(', ')}.`,
    );
  } else if (staleEvidenceIds.length > 0) {
    gateStatus = 'evidence_stale';
    reasons.push(`Required evidence is stale: ${staleEvidenceIds.join(', ')}.`);
  } else if (missingMetricIds.length > 0) {
    gateStatus = 'metrics_missing';
    reasons.push(`Required before/after metrics are unavailable: ${missingMetricIds.join(', ')}.`);
  } else if (criteriaUnsatisfied) {
    gateStatus = 'criteria_unsatisfied';
    reasons.push('One or more required gate criteria are not satisfied at the selected time.');
  } else if (status?.readiness !== 'go') {
    gateStatus = 'not_applicable';
    reasons.push('The source readiness does not assert GO.');
  }

  const mayRenderGo = status?.readiness === 'go' && gateStatus === 'satisfied';
  return {
    status: gateStatus,
    mayRenderGo,
    warning: status?.readiness === 'go' && !mayRenderGo,
    reasons,
    evidenceIds: availableEvidenceIds.sort(),
    staleEvidenceIds: staleEvidenceIds.sort(),
    missingMetricIds: missingMetricIds.sort(),
    criterionIds: criterionIds.sort(),
  };
}
