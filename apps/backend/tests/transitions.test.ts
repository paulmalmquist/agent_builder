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
import { AppError } from '../src/errors.js';
import {
  assertAgentTransition,
  assertCertificationTransition,
  assertJobTransition,
  assertSpecTransition,
} from '../src/services/transitions.js';

describe('shared state machines', () => {
  it('accepts every declared transition and rejects every undeclared agent transition', () => {
    const states = Object.keys(agentTransitions) as AgentStatus[];
    for (const from of states) {
      for (const to of states) {
        if (agentTransitions[from].includes(to as never)) {
          expect(() => assertAgentTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertAgentTransition(from, to)).toThrow(AppError);
        }
      }
    }
  });

  it('enforces the complete specification transition table', () => {
    const states = Object.keys(specTransitions) as SpecStatus[];
    for (const from of states) {
      for (const to of states) {
        const assertion = (): void => assertSpecTransition(from, to);
        if (specTransitions[from].includes(to as never)) {
          expect(assertion).not.toThrow();
        } else {
          expect(assertion).toThrow(AppError);
        }
      }
    }
  });

  it('enforces the complete generation-job transition table', () => {
    const states = Object.keys(generationJobTransitions) as GenerationJobStatus[];
    for (const from of states) {
      for (const to of states) {
        const assertion = (): void => assertJobTransition(from, to);
        if (generationJobTransitions[from].includes(to as never)) {
          expect(assertion).not.toThrow();
        } else {
          expect(assertion).toThrow(AppError);
        }
      }
    }
  });

  it('enumerates every valid and invalid certification-run transition', () => {
    const states = Object.keys(certificationRunTransitions) as CertificationRunState[];
    for (const from of states) {
      for (const to of states) {
        const expected = certificationRunTransitions[from].includes(to as never);
        expect(canTransition(certificationRunTransitions, from, to)).toBe(expected);
        if (expected) {
          expect(() => assertCertificationTransition(from, to)).not.toThrow();
        } else {
          expect(() => assertCertificationTransition(from, to)).toThrow(AppError);
        }
      }
    }
  });
});
