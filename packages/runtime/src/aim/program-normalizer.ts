import { aimProgramManifestSchema, type AimProgramManifest } from '@agent-builder/contracts/aim';

const byId = <T extends { id: string }>(left: T, right: T) => left.id.localeCompare(right.id);
const sortedIds = (values: readonly string[]) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b));

/** Returns a deterministic clone after strict contract and relationship validation. */
export function normalizeAimProgram(input: AimProgramManifest): AimProgramManifest {
  const manifest = aimProgramManifestSchema.parse(input);
  return aimProgramManifestSchema.parse({
    ...manifest,
    timeline: {
      ...manifest.timeline,
      markers: [...manifest.timeline.markers].sort(
        (left, right) => Date.parse(left.at) - Date.parse(right.at) || byId(left, right),
      ),
    },
    anchors: [...manifest.anchors]
      .sort(byId)
      .map((anchor) => ({ ...anchor, aliases: sortedIds(anchor.aliases) })),
    groups: [...manifest.groups]
      .sort((left, right) => left.displayOrder - right.displayOrder || byId(left, right))
      .map((group) => ({
        ...group,
        ownedAnchorIds: sortedIds(group.ownedAnchorIds),
        participatingCapabilityIds: sortedIds(group.participatingCapabilityIds),
        decisionLoopIds: sortedIds(group.decisionLoopIds),
        sourceRefs: sortedIds(group.sourceRefs),
      })),
    agents: [...manifest.agents].sort(byId).map((agent) => ({
      ...agent,
      groupIds: sortedIds(agent.groupIds),
      partIds: sortedIds(agent.partIds),
      connectors: [...agent.connectors].sort(byId),
      certificationEvidenceRefs: sortedIds(agent.certificationEvidenceRefs),
      sourceRefs: sortedIds(agent.sourceRefs),
    })),
    capabilities: [...manifest.capabilities].sort(byId).map((capability) => ({
      ...capability,
      dependencyIds: sortedIds(capability.dependencyIds),
    })),
    parts: [...manifest.parts].sort(byId).map((part) => ({
      ...part,
      capabilityIds: sortedIds(part.capabilityIds),
      participatingGroupIds: sortedIds(part.participatingGroupIds),
      decisionLoopIds: sortedIds(part.decisionLoopIds),
      unlocksPartIds: sortedIds(part.unlocksPartIds),
      dependencyPartIds: sortedIds(part.dependencyPartIds),
      coverage: {
        agentIds: sortedIds(part.coverage.agentIds),
        evidenceRefs: sortedIds(part.coverage.evidenceRefs),
      },
      evidenceRefs: sortedIds(part.evidenceRefs),
      sourceRefs: sortedIds(part.sourceRefs),
      statusHistory: part.statusHistory.map((event) => ({
        ...event,
        evidenceRefs: sortedIds(event.evidenceRefs),
      })),
    })),
    milestones: [...manifest.milestones].sort(byId).map((milestone) => ({
      ...milestone,
      ownerGroupIds: sortedIds(milestone.ownerGroupIds),
      affectedPartIds: sortedIds(milestone.affectedPartIds),
      evidenceRefs: sortedIds(milestone.evidenceRefs),
      sourceRefs: sortedIds(milestone.sourceRefs),
      gateCriteria: [...milestone.gateCriteria].sort(byId).map((criterion) => ({
        ...criterion,
        affectedPartIds: sortedIds(criterion.affectedPartIds),
        requiredMetricIds: sortedIds(criterion.requiredMetricIds),
        evidenceRefs: sortedIds(criterion.evidenceRefs),
        resultHistory: criterion.resultHistory.map((result) => ({
          ...result,
          evidenceRefs: sortedIds(result.evidenceRefs),
        })),
      })),
    })),
    workstreams: [...manifest.workstreams].sort(byId).map((workstream) => ({
      ...workstream,
      affectedPartIds: sortedIds(workstream.affectedPartIds),
      sourceRefs: sortedIds(workstream.sourceRefs),
      milestoneIds: sortedIds(workstream.milestoneIds),
    })),
    decisionLoops: [...manifest.decisionLoops].sort(byId).map((loop) => ({
      ...loop,
      ownerGroupIds: sortedIds(loop.ownerGroupIds),
      sourceSystemIds: sortedIds(loop.sourceSystemIds),
      partIds: sortedIds(loop.partIds),
      sourceRefs: sortedIds(loop.sourceRefs),
      steps: [...loop.steps].sort(
        (left, right) => left.sequence - right.sequence || byId(left, right),
      ),
      manualHandoffs: [...loop.manualHandoffs].sort(byId),
    })),
    interfaces: [...manifest.interfaces].sort(byId).map((contract) => ({
      ...contract,
      evidenceRefs: sortedIds(contract.evidenceRefs),
      sourceRefs: sortedIds(contract.sourceRefs),
      statusHistory: contract.statusHistory.map((status) => ({
        ...status,
        evidenceRefs: sortedIds(status.evidenceRefs),
      })),
    })),
    evidence: [...manifest.evidence].sort(byId),
    sources: [...manifest.sources].sort(byId),
    metrics: [...manifest.metrics].sort(byId).map((metric) => ({
      ...metric,
      sourceRefs: sortedIds(metric.sourceRefs),
      observations: metric.observations.map((observation) => ({
        ...observation,
        evidenceRefs: sortedIds(observation.evidenceRefs),
      })),
    })),
  });
}
