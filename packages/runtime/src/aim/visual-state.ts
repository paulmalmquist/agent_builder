import type { AimDisplayPolicy } from '@agent-builder/contracts/aim';
import type { AimPartState, AimPartVisualState, AimProgramState } from './program-view-model.js';

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export function deriveVisualState(
  manifestState: AimProgramState,
  part: AimPartState,
  displayPolicy: AimDisplayPolicy,
): AimPartVisualState {
  void displayPolicy;
  const demonstrativeLoopActive =
    manifestState.program.synthetic &&
    part.decisionLoopIds.some((id) =>
      Boolean(manifestState.decisionLoops.find((loop) => loop.id === id)?.activeStepId),
    );
  const material: AimPartVisualState['material'] =
    part.lifecycle === 'planned'
      ? 'wireframe'
      : part.lifecycle === 'poc'
        ? 'additive_reveal'
        : part.lifecycle === 'pilot'
          ? 'scaffold'
          : part.lifecycle === 'production'
            ? 'solid'
            : 'ghost';
  const readinessTreatment: AimPartVisualState['readinessTreatment'] = part.evidenceGate.warning
    ? 'evidence_warning'
    : part.sourceReadiness === 'unknown'
      ? 'neutral_gray'
      : part.sourceReadiness === 'no_go'
        ? 'subdued_amber'
        : part.sourceReadiness === 'conditional'
          ? 'amber_blue'
          : 'green_confirmation';
  return {
    material,
    readinessTreatment,
    evidenceWarning: part.evidenceGate.warning,
    additiveRevealProgress: clamp(part.lifecycleProgress, 0, 1),
    scaffoldVisible: part.lifecycle === 'pilot',
    tankFill:
      part.knowledgeCoveragePercent === null
        ? null
        : clamp(part.knowledgeCoveragePercent / 100, 0, 1),
    heartbeatActive: part.qualifyingAgentActive || demonstrativeLoopActive,
    dimmed: part.lifecycle === 'retired',
  };
}
