import type {
  ReleaseEvaluation,
  ReleaseEvaluationExecutorKind,
  ReleaseEvaluationMode,
} from '@agent-builder/contracts';

export interface EvaluationResource {
  id: string;
  slug: string;
  version: string;
  digest: string;
  definition: unknown;
}

/**
 * Versioned boundary for immutable release evidence.
 *
 * An implementation must report its real execution mode. Contract-only
 * implementations must never be registered for semantic_execution.
 */
export interface ReleaseEvaluator {
  readonly kind: ReleaseEvaluationExecutorKind;
  readonly version: string;
  readonly mode: ReleaseEvaluationMode;
  readonly disclaimer: string;
  evaluate(input: ReleaseEvaluatorInput): ReleaseEvaluatorOutput;
}

export interface ReleaseEvaluationHistory {
  costUsd: number[];
  latencyMs: number[];
  outcomeQuality: number[];
}

export interface ReleaseEvaluatorInput {
  suiteDefinition: unknown;
  resources: EvaluationResource[];
  history: ReleaseEvaluationHistory;
  historySnapshotDigest: string;
  historyRunIds: string[];
}

export interface ReleaseEvaluatorOutput {
  corpusVersion: number;
  verdict: 'passed' | 'failed';
  certifiedResourceIds: string[];
  results: ReleaseEvaluation['results'];
  gateScores: ReleaseEvaluation['gateScores'];
  gateResults: ReleaseEvaluation['gateResults'];
  evidence: ReleaseEvaluation['evidence'];
}
