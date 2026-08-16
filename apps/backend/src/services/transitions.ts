import {
  agentTransitions,
  canTransition,
  certificationRunTransitions,
  generationJobTransitions,
  specTransitions,
  type AgentStatus,
  type CertificationRunState,
  type GenerationJobStatus,
  type SpecStatus,
} from '@agent-builder/contracts';
import { AppError } from '../errors.js';

function assertAllowed<TState extends string>(
  transitions: Record<TState, readonly TState[]>,
  from: TState,
  to: TState,
  code: string,
  resource: string,
): void {
  if (!canTransition(transitions, from, to)) {
    throw new AppError(409, code, `Cannot transition ${resource} from ${from} to ${to}`, {
      from,
      to,
      resource,
    });
  }
}

export function assertAgentTransition(from: AgentStatus, to: AgentStatus): void {
  assertAllowed(agentTransitions, from, to, 'INVALID_AGENT_TRANSITION', 'agent');
}

export function assertSpecTransition(from: SpecStatus, to: SpecStatus): void {
  assertAllowed(specTransitions, from, to, 'INVALID_SPEC_TRANSITION', 'spec');
}

export function assertJobTransition(from: GenerationJobStatus, to: GenerationJobStatus): void {
  assertAllowed(generationJobTransitions, from, to, 'INVALID_JOB_TRANSITION', 'generation job');
}

export function assertCertificationTransition(
  from: CertificationRunState,
  to: CertificationRunState,
): void {
  assertAllowed(
    certificationRunTransitions,
    from,
    to,
    'INVALID_CERTIFICATION_TRANSITION',
    'certification run',
  );
}
