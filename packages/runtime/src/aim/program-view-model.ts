import type {
  AimCapabilityLayer,
  AimDisplayPolicy,
  AimLifecycle,
  AimProgramDefinition,
  AimReadiness,
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
  capabilityIds: string[];
  capabilityLayers: AimCapabilityLayer[];
  participatingGroupIds: string[];
  primaryGroupId: string | null;
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

export interface AimProgramState {
  schemaVersion: 'aim.program/v1';
  program: AimProgramDefinition;
  displayPolicy: AimDisplayPolicy;
  selectedAt: string;
  outsideTimeline: boolean;
  parts: AimPartState[];
  milestones: AimMilestoneState[];
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
  decisionLatencyChanges: Array<{
    decisionLoopId: string;
    beforeHours: number | null;
    afterHours: number | null;
    reductionHours: number | null;
  }>;
  newlyGovernedInterfaceIds: string[];
}
