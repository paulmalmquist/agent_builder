import { canonicalJson, sha256 } from '@paul-os/runtime';

export type LearningDecisionKind = 'improvement' | 'memory';

export function learningDecisionGroupKey(
  kind: LearningDecisionKind,
  semanticDecisionKey: string,
  memberIds: readonly string[],
): string {
  return sha256(
    canonicalJson({
      kind,
      semanticDecisionKey,
      memberIds: [...memberIds].sort(),
    }),
  );
}
