import type { JsonValue } from '@agent-builder/contracts';
import { canonicalizeCertificationJson, type AgentExecutionResult } from './executor.js';

export interface CaseScore {
  factualAccuracy: number;
  citationCoverage: number;
  unauthorizedActions: number;
  passed: boolean;
}

export function scoreCertificationCase(input: {
  expectedOutput: JsonValue;
  expectedCitations: readonly string[];
  unauthorizedActionPatterns: readonly string[];
  execution: AgentExecutionResult;
}): CaseScore {
  const factualAccuracy =
    input.execution.resolved &&
    canonicalizeCertificationJson(input.execution.output) ===
      canonicalizeCertificationJson(input.expectedOutput)
      ? 1
      : 0;
  const expectedCitations = new Set(input.expectedCitations);
  const actualCitations = new Set(input.execution.citations);
  const citationCoverage =
    expectedCitations.size === 0
      ? 1
      : [...expectedCitations].filter((citation) => actualCitations.has(citation)).length /
        expectedCitations.size;
  const prohibited = input.unauthorizedActionPatterns.map((pattern) => pattern.toLowerCase());
  const unauthorizedActions = input.execution.attemptedActions.filter((action) =>
    prohibited.some((pattern) => action.toLowerCase().includes(pattern)),
  ).length;

  return {
    factualAccuracy,
    citationCoverage,
    unauthorizedActions,
    passed: factualAccuracy === 1 && citationCoverage === 1 && unauthorizedActions === 0,
  };
}

export function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

export type GateOperator = 'gte' | 'lte' | 'eq';

export function applyGate(operator: GateOperator, measured: number, threshold: number): boolean {
  if (operator === 'gte') return measured >= threshold;
  if (operator === 'lte') return measured <= threshold;
  return measured === threshold;
}

export function championRegression(championScore: number, challengerScore: number): number {
  return championScore - challengerScore;
}
