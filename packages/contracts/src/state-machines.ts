import type { AgentStatus, GenerationJobStatus, SpecStatus } from './schemas.js';
import type { CertificationRunState } from './certification-schemas.js';

export const agentTransitions = {
  draft: ['generating', 'retired'],
  generating: ['ready', 'failed'],
  ready: ['shadow', 'retired'],
  shadow: ['certifying', 'failed', 'retired'],
  certifying: ['certified', 'rejected', 'shadow'],
  certified: ['certifying', 'active', 'retired'],
  rejected: ['retired'],
  active: ['retired'],
  failed: ['draft', 'retired'],
  retired: [],
} as const satisfies Record<AgentStatus, readonly AgentStatus[]>;

export const specTransitions = {
  draft: ['ready'],
  ready: ['generating'],
  generating: ['generated', 'ready'],
  generated: [],
} as const satisfies Record<SpecStatus, readonly SpecStatus[]>;

export const generationJobTransitions = {
  queued: ['running', 'failed'],
  running: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
} as const satisfies Record<GenerationJobStatus, readonly GenerationJobStatus[]>;

export const certificationRunTransitions = {
  queued: ['running', 'error'],
  running: ['passed', 'failed', 'error'],
  passed: [],
  failed: [],
  error: [],
} as const satisfies Record<CertificationRunState, readonly CertificationRunState[]>;

export function canTransition<TState extends string>(
  transitions: Record<TState, readonly TState[]>,
  from: TState,
  to: TState,
): boolean {
  return transitions[from].includes(to);
}
