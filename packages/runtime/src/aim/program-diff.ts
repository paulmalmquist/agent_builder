import type { AimProgramDiff, AimProgramViewModel } from './program-view-model.js';

function byId<T extends { id: string }>(values: readonly T[]): Map<string, T> {
  return new Map(values.map((value) => [value.id, value] as const));
}

/** Pure QBR comparison over two already-derived program states. */
export function diffProgramState(
  before: AimProgramViewModel,
  after: AimProgramViewModel,
): AimProgramDiff {
  const beforeParts = byId(before.parts);
  const beforeLoops = byId(before.decisionLoops);
  const beforeInterfaces = byId(before.interfaces);
  const beforeAgents = byId(before.agents);
  const newlyPrintedPartIds: string[] = [];
  const productionPromotionPartIds: string[] = [];
  const retiredPartIds: string[] = [];
  const knowledgeCoverageChanges: AimProgramDiff['knowledgeCoverageChanges'] = [];
  const activatedAgentPartIds: string[] = [];

  for (const part of after.parts) {
    const previous = beforeParts.get(part.id);
    if (previous === undefined) continue;
    if (previous.lifecycle === 'planned' && part.lifecycle !== 'planned')
      newlyPrintedPartIds.push(part.id);
    if (previous.lifecycle !== 'production' && part.lifecycle === 'production')
      productionPromotionPartIds.push(part.id);
    if (previous.lifecycle !== 'retired' && part.lifecycle === 'retired')
      retiredPartIds.push(part.id);
    if (previous.knowledgeCoveragePercent !== part.knowledgeCoveragePercent) {
      knowledgeCoverageChanges.push({
        partId: part.id,
        before: previous.knowledgeCoveragePercent,
        after: part.knowledgeCoveragePercent,
        delta: (part.knowledgeCoveragePercent ?? 0) - (previous.knowledgeCoveragePercent ?? 0),
      });
    }
    if (!previous.qualifyingAgentActive && part.qualifyingAgentActive)
      activatedAgentPartIds.push(part.id);
  }

  const decisionLatencyChanges = after.decisionLoops.flatMap((loop) => {
    const previous = beforeLoops.get(loop.id);
    if (previous === undefined || previous.currentLatencyHours === loop.currentLatencyHours)
      return [];
    return [
      {
        decisionLoopId: loop.id,
        beforeHours: previous.currentLatencyHours,
        afterHours: loop.currentLatencyHours,
        reductionHours:
          previous.currentLatencyHours === null || loop.currentLatencyHours === null
            ? null
            : previous.currentLatencyHours - loop.currentLatencyHours,
      },
    ];
  });
  const newlyGovernedInterfaceIds = after.interfaces
    .filter((contract) => !beforeInterfaces.get(contract.id)?.governed && contract.governed)
    .map(({ id }) => id);
  const beforeEvidence = new Set(before.availableEvidenceIds);
  const newlyCertifiedAgentIds = after.agents
    .filter((agent) => {
      const previous = beforeAgents.get(agent.id);
      return (
        agent.certificationStatus === 'certified' &&
        agent.certificationEvidenceFresh &&
        (previous?.certificationStatus !== 'certified' || !previous.certificationEvidenceFresh)
      );
    })
    .map(({ id }) => id)
    .sort();
  return {
    from: before.selectedAt,
    to: after.selectedAt,
    newlyPrintedPartIds: newlyPrintedPartIds.sort(),
    productionPromotionPartIds: productionPromotionPartIds.sort(),
    retiredPartIds: retiredPartIds.sort(),
    newEvidenceIds: after.availableEvidenceIds.filter((id) => !beforeEvidence.has(id)).sort(),
    knowledgeCoverageChanges: knowledgeCoverageChanges.sort((a, b) =>
      a.partId.localeCompare(b.partId),
    ),
    activatedAgentPartIds: activatedAgentPartIds.sort(),
    newlyCertifiedAgentIds,
    decisionLatencyChanges: decisionLatencyChanges.sort((a, b) =>
      a.decisionLoopId.localeCompare(b.decisionLoopId),
    ),
    newlyGovernedInterfaceIds: newlyGovernedInterfaceIds.sort(),
  };
}
