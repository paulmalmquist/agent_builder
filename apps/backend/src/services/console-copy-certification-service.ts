import type { ConsoleCopyArtifact, JsonValue } from '@agent-builder/contracts';
import {
  certifyConsoleCopyBundle,
  type ConsoleCopyBundleCertification,
  type ModelProvider,
} from '@paul-os/runtime';
import type { PrismaClient } from '@prisma/client';
import { appendAuditEvent } from '../audit.js';

export interface PersistedConsoleCopyCertification extends ConsoleCopyBundleCertification {
  evidenceId: string;
  sourceCommit: string | null;
}

function auditDetails(
  result: ConsoleCopyBundleCertification,
  sourceCommit: string | null,
): Record<string, JsonValue> {
  return {
    state: result.state,
    copyDigest: result.copyDigest,
    governedCopy: {
      matches: result.governedCopy.matches,
      canonicalDigest: result.governedCopy.canonicalDigest,
      governedDigest: result.governedCopy.governedDigest,
      reason: result.governedCopy.reason,
    },
    evaluatorKind: result.evaluatorKind,
    evaluatorVersion: result.evaluatorVersion,
    providerPolicy: result.providerPolicy,
    providerKind: result.providerKind,
    providerVersion: result.providerVersion,
    model: result.model,
    certifiedAt: result.certifiedAt,
    sourceCommit,
    artifacts: result.artifacts.map((artifact) => ({
      screen: artifact.screen,
      deterministic: {
        passed: artifact.deterministic.passed,
        evaluatorKind: artifact.deterministic.evaluatorKind,
        evaluatorVersion: artifact.deterministic.evaluatorVersion,
        issues: artifact.deterministic.issues.map((issue) => ({ ...issue })),
      },
      semantic: {
        state: artifact.semantic.state,
        evaluatorKind: artifact.semantic.evaluatorKind,
        evaluatorVersion: artifact.semantic.evaluatorVersion,
        providerKind: artifact.semantic.providerKind,
        model: artifact.semantic.model,
        usage:
          artifact.semantic.usage === null
            ? null
            : {
                inputTokens: artifact.semantic.usage.inputTokens,
                outputTokens: artifact.semantic.usage.outputTokens,
              },
        reason: artifact.semantic.reason,
        answerDigest: artifact.semantic.answerDigest,
      },
    })),
  };
}

/**
 * Runs the UI release gate and persists its sanitized result in the append-only governance ledger.
 *
 * This deliberately does not create a ReleaseEvaluation. A passing ReleaseEvaluation can certify
 * resource versions and authorize a production-pointer decision; screen-copy evidence must never
 * acquire that authority accidentally.
 */
export class ConsoleCopyCertificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: ModelProvider,
    private readonly providerPolicy: 'direct_allowed' | 'gateway_only',
  ) {}

  async certify(input: {
    artifacts: readonly ConsoleCopyArtifact[];
    governedValue: unknown;
    now?: Date;
    signal?: AbortSignal;
    sourceCommit?: string;
  }): Promise<PersistedConsoleCopyCertification> {
    const sourceCommit = input.sourceCommit?.trim() || null;
    const result = await certifyConsoleCopyBundle({
      artifacts: input.artifacts,
      governedValue: input.governedValue,
      provider: this.provider,
      providerPolicy: this.providerPolicy,
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const evidenceId = await this.prisma.$transaction((transaction) =>
      appendAuditEvent(transaction, {
        action: `console_copy.${result.state}`,
        entityType: 'ConsoleCopyBundle',
        entityId: result.copyDigest,
        details: auditDetails(result, sourceCommit),
      }),
    );
    return { ...result, evidenceId, sourceCommit };
  }
}
