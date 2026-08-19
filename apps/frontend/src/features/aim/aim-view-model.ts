import type { AimProgramManifest } from '@agent-builder/contracts/aim';
import type { AimEvidenceGateStatus, AimProgramViewModel } from '@paul-os/runtime/aim';

export interface AimConnectorView {
  readonly id: string;
  readonly label: string;
  readonly monogram: string;
  readonly accent: string;
  readonly assetSrc?: string;
  readonly access: 'read' | 'write';
}

export interface AimAgentView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly rung: 0 | 1 | 2 | 3 | 4;
  readonly status: 'candidate' | 'certified';
  readonly certificationEvidenceFresh: boolean;
  readonly synthetic: boolean;
  readonly groupIds: readonly string[];
  readonly partIds: readonly string[];
  readonly connectors: readonly AimConnectorView[];
}

export interface AimGroupView {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly kind: 'primary' | 'supporting';
  readonly displayOrder: number;
  readonly ownedPartIds: readonly string[];
  readonly agentIds: readonly string[];
  readonly certifiedAgentCount: number;
  readonly hasCertifiedAgent: boolean;
}

export interface AimEvidenceLine {
  readonly id: string;
  readonly label: string;
  readonly sourceLabel: string;
  readonly observedAt: string;
  readonly freshness: 'current' | 'stale';
}

export interface AimPartView {
  readonly id: string;
  readonly label: string;
  readonly lifecycle: 'planned' | 'poc' | 'pilot' | 'production' | 'retired';
  readonly readiness: 'unknown' | 'no_go' | 'conditional' | 'go';
  readonly evidenceState: 'satisfied' | 'missing' | 'stale' | 'not_required';
  readonly evidenceMessage: string;
  readonly makeMethod: 'printed' | 'purchased' | 'facility';
  readonly process: string;
  readonly ownerGroupId: string;
  readonly ownerGroupLabel: string;
  readonly coverage: {
    readonly agentIds: readonly string[];
    readonly certifiedAgentCount: number;
    readonly evidenceFreshnessHours: number | null;
  };
  readonly problem: string;
  readonly capabilityLabels: readonly string[];
  readonly groupLabels: readonly string[];
  readonly primaryOwner?: string;
  readonly decisionLoopLabels: readonly string[];
  readonly latency: {
    readonly baseline?: string;
    readonly current?: string;
    readonly target?: string;
  };
  readonly evidence: readonly AimEvidenceLine[];
  readonly sourceLabels: readonly string[];
  readonly lastSynchronizedAt?: string;
  readonly unlockLabels: readonly string[];
  readonly dependencyLabels: readonly string[];
}

export interface AimViewModel {
  readonly programId: string;
  readonly label: string;
  readonly description?: string;
  readonly asOf: string;
  readonly isSynthetic: boolean;
  readonly groups: readonly AimGroupView[];
  readonly agents: readonly AimAgentView[];
  readonly parts: readonly AimPartView[];
}

function formatLatency(hours: number | null): string | undefined {
  if (hours === null) return undefined;
  if (hours >= 24) {
    const days = hours / 24;
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(days)} days`;
  }
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(hours)} hours`;
}

function evidenceState(status: AimEvidenceGateStatus): AimPartView['evidenceState'] {
  if (status === 'satisfied') return 'satisfied';
  if (status === 'not_applicable') return 'not_required';
  if (status === 'evidence_stale' || status === 'source_stale') return 'stale';
  return 'missing';
}

function evidenceMessage(state: AimPartView['evidenceState']): string {
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

export function createAimViewModel(
  manifest: AimProgramManifest,
  state: AimProgramViewModel,
): AimViewModel {
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

  const parts = state.parts.map<AimPartView>((part) => {
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
        return {
          id: item.id,
          label: item.label,
          sourceLabel: source?.label ?? 'SOURCE NOT AVAILABLE',
          observedAt: item.observedAt,
          freshness: part.evidenceGate.staleEvidenceIds.includes(item.id) ? 'stale' : 'current',
        };
      });
    const ownerGroup = groupById.get(part.ownerGroupId);
    const baselineLatency = formatLatency(part.baselineLatencyHours);
    const currentLatency = formatLatency(part.currentLatencyHours);
    const targetLatency = formatLatency(part.targetLatencyHours);
    const lastSynchronizedAt = latestTimestamp(relevantSources.map((source) => source.observedAt));

    return {
      id: part.id,
      label: part.label,
      lifecycle: part.lifecycle,
      readiness: part.sourceReadiness,
      evidenceState: gateState,
      evidenceMessage: evidenceMessage(gateState),
      makeMethod: part.makeMethod,
      process: part.process,
      ownerGroupId: part.ownerGroupId,
      ownerGroupLabel: ownerGroup?.label ?? 'Owner group unavailable',
      coverage: {
        agentIds: part.coverage.agentIds,
        certifiedAgentCount: part.coverage.certifiedAgentCount,
        evidenceFreshnessHours: part.coverage.evidenceFreshnessHours,
      },
      problem: part.problem,
      capabilityLabels: part.capabilityIds.flatMap((id) => {
        const capability = capabilityById.get(id);
        return capability ? [`${capability.label} · ${capability.layer.toUpperCase()}`] : [];
      }),
      groupLabels: part.participatingGroupIds.flatMap((id) => {
        const group = groupById.get(id);
        return group ? [group.label] : [];
      }),
      ...(state.displayPolicy.showOwnerNames && ownerGroup?.lead
        ? { primaryOwner: ownerGroup.lead }
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
    isSynthetic: state.program.synthetic,
    groups: state.groups.map((group) => ({
      id: group.id,
      label: group.label,
      description: group.description ?? 'No group description is declared.',
      kind: group.kind,
      displayOrder: group.displayOrder,
      ownedPartIds: group.ownedPartIds,
      agentIds: group.agentIds,
      certifiedAgentCount: group.certifiedAgentCount,
      hasCertifiedAgent: group.hasCertifiedAgent,
    })),
    agents: state.agents.map((agent) => ({
      id: agent.id,
      label: agent.label,
      description: agent.description,
      rung: agent.tier,
      status: agent.certificationStatus,
      certificationEvidenceFresh: agent.certificationEvidenceFresh,
      synthetic: agent.synthetic,
      groupIds: agent.groupIds,
      partIds: agent.partIds,
      connectors: agent.connectors.map((connector) => ({
        id: connector.id,
        label: connector.label,
        monogram: connector.monogram,
        accent: connector.accent,
        access: connector.access,
        ...(connector.assetSrc ? { assetSrc: connector.assetSrc } : {}),
      })),
    })),
    parts,
  };
}
