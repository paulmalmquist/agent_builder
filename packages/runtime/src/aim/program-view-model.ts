import type {
  AimAgentCertificationStatus,
  AimAgentConnector,
  AimAgentTier,
  AimCapabilityLayer,
  AimDisplayPolicy,
  AimLifecycle,
  AimMakeMethod,
  AimProgramDefinition,
  AimReadiness,
  AimWorkstreamDefinition,
} from '@agent-builder/contracts/aim';

export type AimEvidenceGateStatus =
  | 'satisfied'
  | 'not_applicable'
  | 'evidence_missing'
  | 'evidence_stale'
  | 'criteria_unsatisfied'
  | 'metrics_missing'
  | 'source_conflict'
  | 'source_stale';

export interface AimMetricState {
  id: string;
  label: string;
  kind: 'percentage' | 'duration_hours' | 'maturity' | 'count' | 'boolean';
  unit: 'percent' | 'hours' | 'score' | 'count' | 'boolean';
  value: number;
  observedAt: string;
  sourceRef: string;
  evidenceRefs: string[];
  confidence: 'low' | 'medium' | 'high';
  ageHours: number;
  isStale: boolean;
}

export interface AimEvidenceGate {
  status: AimEvidenceGateStatus;
  mayRenderGo: boolean;
  warning: boolean;
  reasons: string[];
  evidenceIds: string[];
  staleEvidenceIds: string[];
  missingMetricIds: string[];
  criterionIds: string[];
}

export interface AimPartState {
  id: string;
  label: string;
  anchorId: string;
  fallbackRegion: string | null;
  makeMethod: AimMakeMethod;
  process: string;
  ownerGroupId: string;
  coverage: {
    agentIds: string[];
    evidenceRefs: string[];
    agentCount: number;
    certifiedAgentCount: number;
    evidenceFreshnessHours: number | null;
  };
  capabilityIds: string[];
  capabilityLayers: AimCapabilityLayer[];
  participatingGroupIds: string[];
  problem: string;
  decisionLoopIds: string[];
  unlocksPartIds: string[];
  dependencyPartIds: string[];
  lifecycle: AimLifecycle;
  sourceReadiness: AimReadiness;
  statusEffectiveAt: string | null;
  statusSourceRef: string | null;
  statusNote: string | null;
  lifecycleProgress: number;
  knowledgeCoveragePercent: number | null;
  qualifyingAgentActive: boolean;
  baselineLatencyHours: number | null;
  currentLatencyHours: number | null;
  targetLatencyHours: number | null;
  evidenceGate: AimEvidenceGate;
  evidenceRefs: string[];
  sourceRefs: string[];
}

export interface AimAgentState {
  id: string;
  label: string;
  description: string;
  tier: AimAgentTier;
  certificationStatus: AimAgentCertificationStatus;
  certificationEvidenceFresh: boolean;
  synthetic: boolean;
  groupIds: string[];
  partIds: string[];
  connectors: AimAgentConnector[];
  certificationEvidenceRefs: string[];
  sourceRefs: string[];
}

export interface AimGroupState {
  id: string;
  label: string;
  description: string | null;
  kind: 'primary' | 'supporting';
  displayOrder: number;
  ownedAnchorIds: string[];
  ownedPartIds: string[];
  agentIds: string[];
  certifiedAgentCount: number;
  hasCertifiedAgent: boolean;
}

export interface AimPartVisualState {
  material: 'wireframe' | 'additive_reveal' | 'scaffold' | 'solid' | 'ghost';
  readinessTreatment:
    | 'neutral_gray'
    | 'subdued_amber'
    | 'amber_blue'
    | 'green_confirmation'
    | 'evidence_warning';
  evidenceWarning: boolean;
  additiveRevealProgress: number;
  scaffoldVisible: boolean;
  tankFill: number | null;
  heartbeatActive: boolean;
  dimmed: boolean;
}

export interface AimMilestoneCriterionState {
  id: string;
  label: string;
  required: boolean;
  state: 'unknown' | 'unsatisfied' | 'satisfied';
  effectiveAt: string | null;
  evidenceRefs: string[];
}

export interface AimMilestoneState {
  id: string;
  label: string;
  date: string;
  timing: 'upcoming' | 'due' | 'past';
  ownerGroupIds: string[];
  affectedPartIds: string[];
  criteria: AimMilestoneCriterionState[];
  evidenceRefs: string[];
}

export interface AimDecisionLoopState {
  id: string;
  label: string;
  partIds: string[];
  ownerGroupIds: string[];
  baselineLatencyHours: number | null;
  currentLatencyHours: number | null;
  targetLatencyHours: number | null;
  manualHandoffCount: number;
  activeStepId: string | null;
  syntheticAnimation: boolean;
}

export interface AimInterfaceState {
  id: string;
  label: string;
  partIds: [string, string];
  state: 'planned' | 'manual' | 'governed' | 'stale' | 'retired';
  effectiveAt: string | null;
  evidenceRefs: string[];
  governed: boolean;
}

export interface AimSourceFreshnessState {
  id: string;
  label: string;
  observedAt: string;
  ageHours: number;
  isStale: boolean;
  synthetic: boolean;
  reconciliationStatus: 'authoritative' | 'corroborated' | 'conflicting' | 'unverified';
}

export type AimWorkstreamState = AimWorkstreamDefinition & {
  /** True when any declared source is synthetic. Resolved only from observable, usable sources. */
  sourceSynthetic: boolean;
};

export interface AimProgramState {
  schemaVersion: 'aim.program/v2';
  program: AimProgramDefinition;
  displayPolicy: AimDisplayPolicy;
  selectedAt: string;
  outsideTimeline: boolean;
  groups: AimGroupState[];
  agents: AimAgentState[];
  groupCoverage: {
    primaryGroupCount: number;
    groupsWithoutCertifiedAgentIds: string[];
  };
  parts: AimPartState[];
  milestones: AimMilestoneState[];
  workstreams: AimWorkstreamState[];
  decisionLoops: AimDecisionLoopState[];
  interfaces: AimInterfaceState[];
  metrics: AimMetricState[];
  availableEvidenceIds: string[];
  sources: AimSourceFreshnessState[];
  factory: {
    printSpeed: number;
    maturityPercent: number | null;
    unsourcedDemoRate: boolean;
  };
}

export type AimPartViewModel = AimPartState & { visual: AimPartVisualState };

export type AimProgramViewModel = Omit<AimProgramState, 'parts'> & {
  parts: AimPartViewModel[];
};

export interface AimProgramDiff {
  from: string;
  to: string;
  newlyPrintedPartIds: string[];
  productionPromotionPartIds: string[];
  retiredPartIds: string[];
  newEvidenceIds: string[];
  knowledgeCoverageChanges: Array<{
    partId: string;
    before: number | null;
    after: number | null;
    delta: number;
  }>;
  activatedAgentPartIds: string[];
  newlyCertifiedAgentIds: string[];
  decisionLatencyChanges: Array<{
    decisionLoopId: string;
    beforeHours: number | null;
    afterHours: number | null;
    reductionHours: number | null;
  }>;
  newlyGovernedInterfaceIds: string[];
}
