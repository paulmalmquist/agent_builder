import type { AimProgramManifest } from '@agent-builder/contracts/aim';
import type { AimEvidenceGateStatus, AimProgramViewModel } from '@paul-os/runtime/aim';
import { resolveProxyAnchor } from './scene/anchor-resolver';
import type {
  AimEvidenceLine,
  AimMaterialMode,
  AimSceneModel,
  AimScenePart,
} from './scene/scene-types';

function formatLatency(hours: number | null): string | undefined {
  if (hours === null) return undefined;
  if (hours >= 24) {
    const days = hours / 24;
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(days)} days`;
  }
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(hours)} hours`;
}

function materialMode(
  material: AimProgramViewModel['parts'][number]['visual']['material'],
): AimMaterialMode {
  return material === 'scaffold' ? 'partial_scaffold' : material;
}

function evidenceState(status: AimEvidenceGateStatus): AimScenePart['evidenceState'] {
  if (status === 'satisfied') return 'satisfied';
  if (status === 'not_applicable') return 'not_required';
  if (status === 'evidence_stale' || status === 'source_stale') return 'stale';
  return 'missing';
}

function evidenceMessage(state: AimScenePart['evidenceState']): string {
  switch (state) {
    case 'satisfied':
      return 'EVIDENCE CURRENT';
    case 'not_required':
      return 'GO EVIDENCE NOT REQUIRED AT THIS STATE';
    case 'stale':
      return 'EVIDENCE STALE';
    case 'missing':
      return 'EVIDENCE MISSING';
  }
}

function latestTimestamp(values: readonly string[]): string | undefined {
  return values.reduce<string | undefined>((latest, current) => {
    if (latest === undefined || Date.parse(current) > Date.parse(latest)) return current;
    return latest;
  }, undefined);
}

export function createAimSceneModel(
  manifest: AimProgramManifest,
  state: AimProgramViewModel,
): AimSceneModel {
  const anchorById = new Map(manifest.anchors.map((anchor) => [anchor.id, anchor] as const));
  const groupById = new Map(manifest.groups.map((group) => [group.id, group] as const));
  const capabilityById = new Map(
    manifest.capabilities.map((capability) => [capability.id, capability] as const),
  );
  const loopById = new Map(manifest.decisionLoops.map((loop) => [loop.id, loop] as const));
  const partById = new Map(manifest.parts.map((part) => [part.id, part] as const));
  const evidenceById = new Map(
    manifest.evidence.map((evidence) => [evidence.id, evidence] as const),
  );
  const sourceById = new Map(manifest.sources.map((source) => [source.id, source] as const));
  const sourceStateById = new Map(state.sources.map((source) => [source.id, source] as const));
  const selectedTime = Date.parse(state.selectedAt);

  const parts = state.parts.map<AimScenePart>((part) => {
    const manifestAnchor = anchorById.get(part.anchorId);
    const reverseAliasTargets = manifest.anchors
      .filter((anchor) => anchor.aliases.includes(part.anchorId))
      .map((anchor) => anchor.id);
    const fallbackRegion = part.fallbackRegion ?? manifestAnchor?.fallbackRegion;
    const gateState = evidenceState(part.evidenceGate.status);
    const relevantSources = part.sourceRefs
      .map((id) => sourceStateById.get(id))
      .filter((source): source is NonNullable<typeof source> => source !== undefined);
    const evidence = part.evidenceRefs
      .map((id) => evidenceById.get(id))
      .filter(
        (item): item is NonNullable<typeof item> =>
          item !== undefined && Date.parse(item.observedAt) <= selectedTime,
      )
      .map<AimEvidenceLine>((item) => {
        const source = sourceById.get(item.sourceId);
        const stale = part.evidenceGate.staleEvidenceIds.includes(item.id);
        return {
          id: item.id,
          label: item.label,
          sourceLabel: source?.label ?? 'SOURCE NOT AVAILABLE',
          observedAt: item.observedAt,
          freshness: stale ? 'stale' : 'current',
        };
      });
    const primaryGroup =
      part.primaryGroupId === null ? undefined : groupById.get(part.primaryGroupId);
    const baselineLatency = formatLatency(part.baselineLatencyHours);
    const currentLatency = formatLatency(part.currentLatencyHours);
    const targetLatency = formatLatency(part.targetLatencyHours);
    const lastSynchronizedAt = latestTimestamp(relevantSources.map((source) => source.observedAt));

    return {
      id: part.id,
      label: part.label,
      anchor: resolveProxyAnchor(part.anchorId, fallbackRegion ?? undefined, [
        ...(manifestAnchor?.aliases ?? []),
        ...reverseAliasTargets,
      ]),
      lifecycle: part.lifecycle,
      readiness: part.sourceReadiness,
      evidenceState: gateState,
      evidenceMessage: evidenceMessage(gateState),
      material: materialMode(part.visual.material),
      additiveRevealProgress: part.visual.additiveRevealProgress,
      problem: part.problem,
      capabilityLabels: part.capabilityIds.flatMap((id) => {
        const capability = capabilityById.get(id);
        return capability ? [`${capability.label} · ${capability.layer.toUpperCase()}`] : [];
      }),
      groupLabels: part.participatingGroupIds.flatMap((id) => {
        const group = groupById.get(id);
        return group ? [group.label] : [];
      }),
      ...(state.displayPolicy.showOwnerNames && primaryGroup?.lead
        ? { primaryOwner: primaryGroup.lead }
        : {}),
      decisionLoopLabels: part.decisionLoopIds.flatMap((id) => {
        const loop = loopById.get(id);
        return loop ? [loop.label] : [];
      }),
      latency: {
        ...(baselineLatency ? { baseline: baselineLatency } : {}),
        ...(currentLatency ? { current: currentLatency } : {}),
        ...(targetLatency ? { target: targetLatency } : {}),
      },
      evidence,
      sourceLabels: relevantSources.map((source) =>
        state.displayPolicy.showInternalSourceIds ? `${source.label} · ${source.id}` : source.label,
      ),
      ...(lastSynchronizedAt ? { lastSynchronizedAt } : {}),
      unlockLabels: part.unlocksPartIds.flatMap((id) => {
        const unlocked = partById.get(id);
        return unlocked ? [unlocked.label] : [];
      }),
      dependencyLabels: part.dependencyPartIds.flatMap((id) => {
        const dependency = partById.get(id);
        return dependency ? [dependency.label] : [];
      }),
    };
  });

  return {
    programId: state.program.id,
    label: state.program.label,
    ...(state.program.description ? { description: state.program.description } : {}),
    asOf: state.selectedAt,
    geometryDisclaimer: state.program.geometryDisclaimer,
    isSynthetic: state.program.synthetic,
    parts,
  };
}
