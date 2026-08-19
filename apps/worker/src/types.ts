import type { DailyBriefOutput, JsonValue } from '@agent-builder/contracts';
import type { ModelUsage } from '@paul-os/runtime';

export type ProviderKind = 'deterministic' | 'anthropic' | 'gateway';

export interface ClaimedRun {
  id: string;
  releaseId: string;
  releaseDigest: string;
  entryResourceVersionId: string;
  contextDigest: string;
  authorityGrantId: string;
  developmentDraft: boolean;
  productionEpoch: string | null;
  input: Record<string, JsonValue>;
  providerKind: ProviderKind;
  providerVersion: string;
  model: string;
  pricingVersion: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxEstimatedCostUsd: number;
  estimatedUpperCostUsd: number;
  attempts: number;
  maxAttempts: number;
  retryBackoff: 'fixed' | 'exponential';
}

export type RetrySuppressionReason = 'plugin_invocation_started';

export interface ProviderUsageSettlement {
  usage: ModelUsage;
  actualCostUsd: number;
  pluginCostUsd?: number;
  latencyMs: number;
  pricingVersion: string;
  providerKind: ProviderKind;
  providerVersion: string;
  model: string;
}

export interface HeartbeatResult {
  owned: boolean;
  cancellationRequested: boolean;
}

export interface CompletedRun extends ProviderUsageSettlement {
  output: DailyBriefOutput;
  qualityScore: number;
}

export interface FailureDisposition {
  state: 'queued' | 'failed' | 'cancelled' | 'lease_lost';
  retryAfterMs: number | null;
}

export interface RecoverySummary {
  requeued: number;
  failed: number;
}

export interface WorkerStore {
  recoverExpiredLeases(): Promise<RecoverySummary>;
  claimNext(workerId: string, leaseMs: number): Promise<ClaimedRun | null>;
  heartbeat(
    runId: string,
    workerId: string,
    leaseMs: number,
    productionEpoch?: string | null,
  ): Promise<HeartbeatResult>;
  complete(run: ClaimedRun, workerId: string, result: CompletedRun): Promise<boolean>;
  cancelClaimed(
    runId: string,
    workerId: string,
    incurred?: ProviderUsageSettlement,
  ): Promise<boolean>;
  pauseForPlugin(
    runId: string,
    workerId: string,
    code: string,
    incurred?: ProviderUsageSettlement,
  ): Promise<boolean>;
  failOrRetry(
    run: ClaimedRun,
    workerId: string,
    code: string,
    retryable: boolean,
    incurred?: ProviderUsageSettlement,
    retrySuppressedBy?: RetrySuppressionReason,
  ): Promise<FailureDisposition>;
}
