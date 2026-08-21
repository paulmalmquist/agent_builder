import type { AimProgramManifest } from '@agent-builder/contracts/aim';
import {
  ageHours,
  isEvidenceFresh,
  loadAimProgram,
  stateAt,
  type AimProgramViewModel,
} from '@paul-os/runtime/aim';

export const HOME_VERTICALS = [
  { id: 'all', label: 'All' },
  { id: 'group_structures', label: 'Structures' },
  { id: 'group_propulsion', label: 'Propulsion' },
  { id: 'group_factory', label: 'Factory operations' },
  { id: 'group_integration', label: 'Integration and test' },
  { id: 'group_quality', label: 'Quality' },
  { id: 'group_avionics', label: 'Avionics and safety' },
] as const;

export type HomeVerticalId = (typeof HOME_VERTICALS)[number]['id'];
export type HomeProgramSource = 'live' | 'synthetic' | 'unavailable';
export type HomeMetricSource = HomeProgramSource | 'awaiting_transfer';
export type HomeMetricState =
  | 'nominal'
  | 'attention'
  | 'gap'
  | 'neutral'
  | 'pending'
  | 'unavailable';

export interface HomeMetric {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly source: HomeMetricSource;
  readonly state: HomeMetricState;
  readonly statusLabel?: string;
  readonly progressPercent?: number;
  readonly scopeLabel?: string;
  readonly inspection: {
    readonly driver: string;
    readonly destinationLabel: string;
    readonly destinationHref: string;
    readonly ownerGroupId: Exclude<HomeVerticalId, 'all'> | null;
  };
}

export interface HomeWorkstream {
  readonly id: string;
  readonly label: string;
  readonly ownerGroupId: Exclude<HomeVerticalId, 'all'>;
  readonly ownerGroupLabel: string;
  readonly affectedPartIds: readonly string[];
  readonly startAt: string;
  readonly endAt: string;
  readonly state: 'complete' | 'in_work' | 'planned' | 'at_risk' | null;
  readonly source: 'synthetic' | 'declared' | 'unavailable';
  readonly sourceDetail: string;
  readonly available: boolean;
  readonly milestoneIds: readonly string[];
}

export interface HomeProgramAction {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly eligibility: 'milestone_blocker' | 'coverage_gap';
  readonly source: HomeProgramSource;
  readonly sourceDetail: string;
  readonly available: boolean;
  readonly groupIds: readonly Exclude<HomeVerticalId, 'all'>[];
  readonly partIds: readonly string[];
  readonly partTargets: readonly {
    readonly groupId: Exclude<HomeVerticalId, 'all'>;
    readonly partId: string;
  }[];
  readonly dueAt: string | null;
}

export interface HomeProgramModel {
  readonly asOf: string;
  readonly isSynthetic: boolean;
  readonly timeline: {
    readonly startAt: string;
    readonly endAt: string;
  };
  readonly planAvailability: {
    readonly available: boolean;
    readonly unavailableCount: number;
    readonly message: string | null;
    readonly provenance: 'synthetic' | 'declared' | 'mixed' | 'unavailable';
  };
  readonly groups: readonly HomeGroup[];
  readonly milestones: readonly HomeMilestone[];
  readonly workstreams: readonly HomeWorkstream[];
  readonly actions: readonly HomeProgramAction[];
}

export interface HomeMilestone {
  readonly id: string;
  readonly label: string;
  readonly date: string;
  readonly state: 'unknown' | 'unsatisfied' | 'satisfied';
}

interface SourceResolution {
  readonly source: HomeProgramSource;
  readonly detail: string;
  readonly maximumEvidenceAgeHours: number | null;
}

interface HomeGroup {
  readonly id: Exclude<HomeVerticalId, 'all'>;
  readonly label: string;
  readonly displayOrder: number;
  readonly partCount: number;
  readonly coveredPartCount: number;
  readonly modeledAgentCount: number;
  readonly certifiedAgentCount: number;
  readonly maximumEvidenceAgeHours: number | null;
  readonly coverageSource: SourceResolution;
  readonly fleetSource: SourceResolution;
  readonly evidenceSource: SourceResolution;
}

export type HomeProgramLoadResult =
  | { readonly ok: true; readonly model: HomeProgramModel }
  | { readonly ok: false; readonly message: string };

const validVerticalIds = new Set<string>(HOME_VERTICALS.map(({ id }) => id));
const usableReconciliationStates = new Set(['authoritative', 'corroborated']);

const outcomeByVertical: Record<Exclude<HomeVerticalId, 'all'>, string> = {
  group_structures: 'As-built reconciled',
  group_propulsion: 'Hot-fire triage time',
  group_factory: 'Print first-pass yield',
  group_integration: 'Critical-path open items',
  group_quality: 'MRB package build time',
  group_avionics: 'Sensor channel coverage',
};

export function isHomeVerticalId(value: string | null): value is HomeVerticalId {
  return value !== null && validVerticalIds.has(value);
}

function isPrimaryVerticalId(value: string): value is Exclude<HomeVerticalId, 'all'> {
  return value !== 'all' && validVerticalIds.has(value);
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 100);
}

function unavailableResolution(detail: string): SourceResolution {
  return { source: 'unavailable', detail, maximumEvidenceAgeHours: null };
}

function resolveSources(
  manifest: AimProgramManifest,
  selectedAt: string,
  sourceRefs: readonly string[],
  hasSyntheticDeclaration = false,
): SourceResolution {
  const ids = [...new Set(sourceRefs)];
  if (ids.length === 0) {
    return unavailableResolution('No contributing source is declared.');
  }
  const sourceById = new Map(manifest.sources.map((source) => [source.id, source] as const));
  const sources = ids.flatMap((id) => {
    const source = sourceById.get(id);
    return source ? [source] : [];
  });
  if (sources.length !== ids.length) {
    return unavailableResolution('One or more contributing sources are missing.');
  }
  const selectedTime = Date.parse(selectedAt);
  if (sources.some((source) => Date.parse(source.observedAt) > selectedTime)) {
    return unavailableResolution('One or more contributing sources are future-dated.');
  }
  if (sources.some((source) => !usableReconciliationStates.has(source.reconciliationStatus))) {
    return unavailableResolution(
      'One or more contributing sources are conflicting or not reconciled.',
    );
  }
  if (
    sources.some(
      (source) =>
        ageHours(source.observedAt, selectedAt) >
        (source.freshnessSlaHours ?? manifest.displayPolicy.defaultEvidenceFreshnessSlaHours),
    )
  ) {
    return unavailableResolution('One or more contributing sources are stale.');
  }
  const synthetic =
    manifest.program.synthetic ||
    hasSyntheticDeclaration ||
    sources.some((source) => source.synthetic);
  return {
    source: synthetic ? 'synthetic' : 'live',
    detail: synthetic
      ? 'Computed from current synthetic contributing sources.'
      : 'Computed from current reconciled non-synthetic contributing sources.',
    maximumEvidenceAgeHours: null,
  };
}

function resolveContributions(
  manifest: AimProgramManifest,
  selectedAt: string,
  input: {
    readonly sourceRefs: readonly string[];
    readonly evidenceRefs?: readonly string[];
    readonly requireEvidence?: boolean;
    readonly hasSyntheticDeclaration?: boolean;
  },
): SourceResolution {
  const evidenceIds = [...new Set(input.evidenceRefs ?? [])];
  if (input.requireEvidence && evidenceIds.length === 0) {
    return unavailableResolution('No contributing coverage evidence is declared.');
  }
  const evidenceById = new Map(
    manifest.evidence.map((evidence) => [evidence.id, evidence] as const),
  );
  const evidence = evidenceIds.flatMap((id) => {
    const item = evidenceById.get(id);
    return item ? [item] : [];
  });
  if (evidence.length !== evidenceIds.length) {
    return unavailableResolution('One or more contributing evidence records are missing.');
  }
  if (evidence.some((item) => Date.parse(item.observedAt) > Date.parse(selectedAt))) {
    return unavailableResolution('One or more contributing evidence records are future-dated.');
  }
  if (evidence.some((item) => !isEvidenceFresh(item, manifest, selectedAt))) {
    return unavailableResolution('One or more contributing evidence records are stale.');
  }
  const sources = resolveSources(
    manifest,
    selectedAt,
    [...input.sourceRefs, ...evidence.map((item) => item.sourceId)],
    input.hasSyntheticDeclaration,
  );
  if (sources.source === 'unavailable') return sources;
  return {
    ...sources,
    maximumEvidenceAgeHours:
      evidence.length === 0
        ? null
        : Math.max(...evidence.map((item) => ageHours(item.observedAt, selectedAt))),
  };
}

function createGroups(manifest: AimProgramManifest, state: AimProgramViewModel): HomeGroup[] {
  const groupDefinitionById = new Map(manifest.groups.map((group) => [group.id, group] as const));
  const partDefinitionById = new Map(manifest.parts.map((part) => [part.id, part] as const));
  const agentDefinitionById = new Map(manifest.agents.map((agent) => [agent.id, agent] as const));

  return state.groups
    .filter(
      (group): group is typeof group & { id: Exclude<HomeVerticalId, 'all'> } =>
        group.kind === 'primary' && isPrimaryVerticalId(group.id),
    )
    .sort((left, right) => left.displayOrder - right.displayOrder)
    .map((group) => {
      const groupDefinition = groupDefinitionById.get(group.id);
      const parts = state.parts.filter((part) => part.ownerGroupId === group.id);
      const partDefinitions = parts.flatMap((part) => {
        const definition = partDefinitionById.get(part.id);
        return definition ? [definition] : [];
      });
      const coverageAgentIds = [
        ...new Set(partDefinitions.flatMap((part) => part.coverage.agentIds)),
      ];
      const coverageAgents = coverageAgentIds.flatMap((id) => {
        const agent = agentDefinitionById.get(id);
        return agent ? [agent] : [];
      });
      const groupAgents = group.agentIds.flatMap((id) => {
        const agent = agentDefinitionById.get(id);
        return agent ? [agent] : [];
      });
      const coverageEvidenceRefs = partDefinitions.flatMap((part) => part.coverage.evidenceRefs);
      const certificationEvidenceRefs = coverageAgents.flatMap((agent) =>
        agent.certificationStatus === 'certified' ? agent.certificationEvidenceRefs : [],
      );
      const fleetCertificationEvidenceRefs = groupAgents.flatMap((agent) =>
        agent.certificationStatus === 'certified' ? agent.certificationEvidenceRefs : [],
      );
      const coverageSource = resolveContributions(manifest, state.selectedAt, {
        sourceRefs: [
          ...(groupDefinition?.sourceRefs ?? []),
          ...partDefinitions.flatMap((part) => part.sourceRefs),
          ...coverageAgents.flatMap((agent) => agent.sourceRefs),
        ],
        evidenceRefs: [...coverageEvidenceRefs, ...certificationEvidenceRefs],
        requireEvidence: parts.length > 0,
        hasSyntheticDeclaration: coverageAgents.some((agent) => agent.synthetic),
      });
      const fleetSource = resolveContributions(manifest, state.selectedAt, {
        sourceRefs: [
          ...(groupDefinition?.sourceRefs ?? []),
          ...groupAgents.flatMap((agent) => agent.sourceRefs),
        ],
        evidenceRefs: fleetCertificationEvidenceRefs,
        hasSyntheticDeclaration: groupAgents.some((agent) => agent.synthetic),
      });
      const evidenceSource = resolveContributions(manifest, state.selectedAt, {
        sourceRefs: [],
        evidenceRefs: coverageEvidenceRefs,
        requireEvidence: parts.length > 0,
      });
      return {
        id: group.id,
        label: group.label,
        displayOrder: group.displayOrder,
        partCount: parts.length,
        coveredPartCount: parts.filter((part) => part.coverage.certifiedAgentCount > 0).length,
        modeledAgentCount: group.agentIds.length,
        certifiedAgentCount: group.certifiedAgentCount,
        maximumEvidenceAgeHours: evidenceSource.maximumEvidenceAgeHours,
        coverageSource,
        fleetSource,
        evidenceSource,
      };
    });
}

function latestAt<T extends { effectiveAt: string }>(
  history: readonly T[],
  selectedAt: string,
): T | null {
  const selectedTime = Date.parse(selectedAt);
  return history.reduce<T | null>(
    (latest, item) =>
      Date.parse(item.effectiveAt) <= selectedTime &&
      (latest === null || Date.parse(item.effectiveAt) > Date.parse(latest.effectiveAt))
        ? item
        : latest,
    null,
  );
}

function createActions(
  manifest: AimProgramManifest,
  state: AimProgramViewModel,
  groups: readonly HomeGroup[],
): HomeProgramAction[] {
  const groupIds = new Set(groups.map(({ id }) => id));
  const partOwnerById = new Map(state.parts.map((part) => [part.id, part.ownerGroupId] as const));
  const milestoneDefinitionById = new Map(
    manifest.milestones.map((milestone) => [milestone.id, milestone] as const),
  );
  const milestoneActions = state.milestones.flatMap<HomeProgramAction>((milestone) =>
    milestone.criteria.flatMap((criterion) => {
      if (!criterion.required || criterion.state !== 'unsatisfied') return [];
      const definition = milestoneDefinitionById.get(milestone.id);
      const criterionDefinition = definition?.gateCriteria.find(({ id }) => id === criterion.id);
      const affectedPartIds = criterionDefinition?.affectedPartIds ?? [];
      const result = criterionDefinition
        ? latestAt(criterionDefinition.resultHistory, state.selectedAt)
        : null;
      const resolution = resolveContributions(manifest, state.selectedAt, {
        sourceRefs: [...(definition?.sourceRefs ?? []), ...(result ? [result.sourceRef] : [])],
        evidenceRefs: result?.evidenceRefs ?? criterionDefinition?.evidenceRefs ?? [],
        requireEvidence: true,
      });
      const affectedGroupIds = [
        ...new Set(
          affectedPartIds.flatMap((partId) => {
            const ownerGroupId = partOwnerById.get(partId);
            return ownerGroupId && isPrimaryVerticalId(ownerGroupId) && groupIds.has(ownerGroupId)
              ? [ownerGroupId]
              : [];
          }),
        ),
      ];
      if (affectedGroupIds.length === 0) return [];
      const partTargets = affectedGroupIds.flatMap((groupId) => {
        const partId = affectedPartIds.find(
          (candidateId) => partOwnerById.get(candidateId) === groupId,
        );
        return partId ? [{ groupId, partId }] : [];
      });
      return [
        {
          id: `${milestone.id}:${criterion.id}`,
          label: criterion.label,
          reason: `Required evidence is unsatisfied for ${milestone.label}.`,
          eligibility: 'milestone_blocker' as const,
          source: resolution.source,
          sourceDetail: resolution.detail,
          available: resolution.source !== 'unavailable',
          groupIds: affectedGroupIds,
          partIds: affectedPartIds,
          partTargets,
          dueAt: milestone.date,
        },
      ];
    }),
  );
  const coverageActions = groups.flatMap<HomeProgramAction>((group) =>
    group.certifiedAgentCount > 0
      ? []
      : [
          {
            id: `coverage:${group.id}`,
            label: `Certify the first current agent for ${group.label}`,
            reason: 'No current certified agent covers this declared AIM group.',
            eligibility: 'coverage_gap' as const,
            source: group.fleetSource.source,
            sourceDetail: group.fleetSource.detail,
            available: group.fleetSource.source !== 'unavailable',
            groupIds: [group.id],
            partIds: [],
            partTargets: [],
            dueAt: null,
          },
        ],
  );
  return [...milestoneActions, ...coverageActions];
}

function createWorkstreams(
  manifest: AimProgramManifest,
  state: AimProgramViewModel,
  groups: readonly HomeGroup[],
): HomeWorkstream[] {
  const groupById = new Map(groups.map((group) => [group.id, group] as const));
  const projectedById = new Map(state.workstreams.map((item) => [item.id, item] as const));
  return manifest.workstreams.flatMap((declared) => {
    if (!isPrimaryVerticalId(declared.ownerGroupId)) return [];
    const ownerGroup = groupById.get(declared.ownerGroupId);
    if (!ownerGroup) return [];
    const projected = projectedById.get(declared.id);
    const resolution = resolveSources(manifest, state.selectedAt, declared.sourceRefs);
    const available = projected !== undefined && resolution.source !== 'unavailable';
    return [
      {
        id: declared.id,
        label: declared.label,
        ownerGroupId: declared.ownerGroupId,
        ownerGroupLabel: ownerGroup.label,
        affectedPartIds: declared.affectedPartIds,
        startAt: declared.startAt,
        endAt: declared.endAt,
        state: available ? projected.state : null,
        source: available
          ? resolution.source === 'synthetic'
            ? 'synthetic'
            : 'declared'
          : 'unavailable',
        sourceDetail: available
          ? resolution.detail
          : resolution.source === 'unavailable'
            ? resolution.detail
            : 'The declared workstream has no observable projection at this date.',
        available,
        milestoneIds: declared.milestoneIds,
      },
    ];
  });
}

function planProvenance(
  workstreams: readonly HomeWorkstream[],
): HomeProgramModel['planAvailability']['provenance'] {
  const available = workstreams.filter((item) => item.available);
  if (available.length === 0) return 'unavailable';
  if (available.every((item) => item.source === 'synthetic')) return 'synthetic';
  if (available.every((item) => item.source === 'declared')) return 'declared';
  return 'mixed';
}

export function loadHomeProgram(manifestText: string): HomeProgramLoadResult {
  const loaded = loadAimProgram(manifestText);
  if (!loaded.ok) {
    return { ok: false, message: 'The local AIM program did not pass validation.' };
  }

  try {
    const state = stateAt(loaded.manifest, loaded.manifest.program.asOf);
    const groups = createGroups(loaded.manifest, state);
    const workstreams = createWorkstreams(loaded.manifest, state, groups);
    const unavailableCount = workstreams.filter((item) => !item.available).length;

    return {
      ok: true,
      model: {
        asOf: state.selectedAt,
        isSynthetic: state.program.synthetic,
        timeline: {
          startAt: loaded.manifest.timeline.startAt,
          endAt: loaded.manifest.timeline.endAt,
        },
        planAvailability: {
          available: workstreams.some((item) => item.available),
          unavailableCount,
          message:
            unavailableCount > 0
              ? `${unavailableCount} declared ${unavailableCount === 1 ? 'workstream has' : 'workstreams have'} unavailable, future, stale, or conflicting sources.`
              : null,
          provenance: planProvenance(workstreams),
        },
        groups,
        milestones: state.milestones.map((milestone) => ({
          id: milestone.id,
          label: milestone.label,
          date: milestone.date,
          state: milestone.criteria.some(
            (criterion) => criterion.required && criterion.state === 'unsatisfied',
          )
            ? 'unsatisfied'
            : milestone.criteria.every(
                  (criterion) => !criterion.required || criterion.state === 'satisfied',
                )
              ? 'satisfied'
              : 'unknown',
        })),
        workstreams,
        actions: createActions(loaded.manifest, state, groups),
      },
    };
  } catch {
    return {
      ok: false,
      message: 'The validated AIM program could not be projected at its declared date.',
    };
  }
}

function aimGroupHref(groupId: Exclude<HomeVerticalId, 'all'>): string {
  return `/aim?${new URLSearchParams({ group: groupId }).toString()}`;
}

function unavailableMetric(
  id: string,
  label: string,
  detail: string,
  group: HomeGroup,
): HomeMetric {
  return {
    id,
    label,
    value: '—',
    detail,
    source: 'unavailable',
    state: 'unavailable',
    statusLabel: 'UNAVAILABLE',
    inspection: {
      driver: `${detail} Paul OS cannot compute this reading until every declared contribution is available and current.`,
      destinationLabel: `Inspect ${group.label} in AIM`,
      destinationHref: aimGroupHref(group.id),
      ownerGroupId: group.id,
    },
  };
}

function coverageMetric(group: HomeGroup, id: string, label: string): HomeMetric {
  const coverage = percent(group.coveredPartCount, group.partCount);
  if (group.coverageSource.source === 'unavailable' || coverage === null) {
    return unavailableMetric(id, label, group.coverageSource.detail, group);
  }
  return {
    id,
    label,
    value: `${coverage}%`,
    detail: `${group.coveredPartCount} of ${group.partCount} declared parts have current certified coverage.`,
    source: group.coverageSource.source,
    state: coverage === 0 ? 'gap' : coverage < 100 ? 'attention' : 'nominal',
    statusLabel: coverage === 0 ? 'NO COVERAGE' : coverage < 100 ? 'PARTIAL COVERAGE' : 'COVERED',
    progressPercent: coverage,
    inspection: {
      driver: `${group.coveredPartCount} of ${group.partCount} declared AIM parts have certified agent coverage. Coverage changes only when the exact part-to-agent declarations and their evidence pass the current-source checks.`,
      destinationLabel: `Inspect ${group.label} coverage in AIM`,
      destinationHref: aimGroupHref(group.id),
      ownerGroupId: group.id,
    },
  };
}

export function metricsForVertical(
  program: HomeProgramModel,
  verticalId: HomeVerticalId,
): HomeMetric[] {
  if (verticalId === 'all') {
    return program.groups.map((group) =>
      coverageMetric(group, `coverage:${group.id}`, group.label),
    );
  }

  const group = program.groups.find(({ id }) => id === verticalId);
  if (!group) return [];
  const fleetRatio = percent(group.certifiedAgentCount, group.modeledAgentCount);
  const fleetMetric =
    group.fleetSource.source === 'unavailable' || fleetRatio === null
      ? unavailableMetric(
          `fleet:${group.id}`,
          'Certified fleet ratio',
          group.fleetSource.detail,
          group,
        )
      : {
          id: `fleet:${group.id}`,
          label: 'Certified fleet ratio',
          value: `${group.certifiedAgentCount} / ${group.modeledAgentCount}`,
          detail: `${group.certifiedAgentCount} of ${group.modeledAgentCount} modeled agents are currently certified.`,
          source: group.fleetSource.source,
          state: group.certifiedAgentCount === 0 ? ('gap' as const) : ('nominal' as const),
          statusLabel:
            group.certifiedAgentCount === 0 ? 'NO CERTIFIED AGENT' : 'CURRENTLY CERTIFIED',
          progressPercent: fleetRatio,
          inspection: {
            driver: `${group.certifiedAgentCount} of ${group.modeledAgentCount} modeled agents owned by ${group.label} are certified. Candidate or missing agents do not contribute to this reading.`,
            destinationLabel: `Inspect ${group.label} agents in AIM`,
            destinationHref: aimGroupHref(group.id),
            ownerGroupId: group.id,
          },
        };
  const evidenceMetric =
    group.evidenceSource.source === 'unavailable' || group.maximumEvidenceAgeHours === null
      ? unavailableMetric(
          `evidence:${group.id}`,
          'Evidence freshness',
          group.evidenceSource.detail,
          group,
        )
      : {
          id: `evidence:${group.id}`,
          label: 'Evidence freshness',
          value: `${Math.ceil(group.maximumEvidenceAgeHours)}h`,
          detail: `Oldest current coverage evidence across ${group.partCount} parts.`,
          source: group.evidenceSource.source,
          state: 'nominal' as const,
          statusLabel: 'WITHIN POLICY',
          inspection: {
            driver: `The oldest current coverage evidence across ${group.partCount} declared parts is ${Math.ceil(group.maximumEvidenceAgeHours)} hours old. Stale, future-dated, or unreconciled evidence makes the reading unavailable instead of nominal.`,
            destinationLabel: `Inspect ${group.label} evidence in AIM`,
            destinationHref: aimGroupHref(group.id),
            ownerGroupId: group.id,
          },
        };

  return [
    coverageMetric(group, `vertical-coverage:${group.id}`, 'Agent coverage'),
    fleetMetric,
    evidenceMetric,
    {
      id: `outcome:${group.id}`,
      label: outcomeByVertical[group.id],
      value: '—',
      detail: 'This outcome is specified, but its production measurement is not connected.',
      source: 'awaiting_transfer',
      state: 'neutral',
      statusLabel: 'NOT MEASURED',
      scopeLabel: 'NOT CONNECTED',
      inspection: {
        driver:
          'A production outcome binding is specified for transfer, but this machine has no current samples. No value, trend, target progress, or operational verdict is inferred.',
        destinationLabel: 'Inspect connection boundaries',
        destinationHref: '/connections',
        ownerGroupId: group.id,
      },
    },
  ];
}

export function workstreamsForVertical(
  program: HomeProgramModel,
  verticalId: HomeVerticalId,
): HomeWorkstream[] {
  return program.workstreams
    .filter((workstream) => verticalId === 'all' || workstream.ownerGroupId === verticalId)
    .sort((left, right) => {
      const leftGroup =
        program.groups.find(({ id }) => id === left.ownerGroupId)?.displayOrder ?? 0;
      const rightGroup =
        program.groups.find(({ id }) => id === right.ownerGroupId)?.displayOrder ?? 0;
      return leftGroup - rightGroup || Date.parse(left.startAt) - Date.parse(right.startAt);
    });
}

export function programActionsForVertical(
  program: HomeProgramModel,
  verticalId: HomeVerticalId,
): HomeProgramAction[] {
  return program.actions.filter(
    (action) => verticalId === 'all' || action.groupIds.includes(verticalId),
  );
}

export function verticalLabel(verticalId: HomeVerticalId): string {
  return HOME_VERTICALS.find(({ id }) => id === verticalId)?.label ?? 'All';
}
