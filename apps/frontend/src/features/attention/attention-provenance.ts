import type { AttentionItem } from '@agent-builder/contracts';

const sourceLabels: Readonly<Record<string, string>> = {
  ApprovalRequest: 'Authority request',
  ApprovalRequestGroup: 'Grouped authority requests',
  ExecutionRun: 'Execution run',
  execution_run: 'Execution run',
  ImprovementCandidate: 'Improvement proposal',
  MemoryCandidate: 'Durable memory proposal',
  PluginInstallation: 'Plugin health record',
  ReleaseEvaluation: 'Release evaluation',
};

export function recordedAttentionSourceLabel(
  sourceType: AttentionItem['provenance']['sourceType'],
): string {
  return sourceLabels[sourceType] ?? 'Governed record';
}
