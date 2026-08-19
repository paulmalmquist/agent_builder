import { ExecutionRunState, type Prisma } from '@prisma/client';
import { canonicalJson, sha256 } from '@paul-os/runtime';
import { subjectFromResourceVersion } from './attention-subject.js';

export const executionApprovalInclude = {
  run: {
    include: {
      entryResourceVersion: { include: { family: true } },
    },
  },
} satisfies Prisma.ApprovalRequestInclude;

export type ExecutionApprovalRecord = Prisma.ApprovalRequestGetPayload<{
  include: typeof executionApprovalInclude;
}>;

export interface ExecutionApprovalGroup {
  groupKey: string;
  approvals: ExecutionApprovalRecord[];
  subject: {
    name: string;
    kind: string;
    version: string;
  };
}

function sortedJsonValues(values: Prisma.JsonValue): Prisma.JsonValue {
  if (!Array.isArray(values)) return values;
  return [...values].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
}

/**
 * The semantic key contains only exact, authority-relevant snapshots. The actual input is included
 * because an input-constraint decision that covers one input must not silently cover another.
 * Approval-required Plugin calls add the run id so their human decision remains per-run.
 */
function approvalSemanticKey(approval: ExecutionApprovalRecord): string {
  const { run } = approval;
  return sha256(
    canonicalJson({
      workspaceId: run.workspaceId,
      departmentId: run.departmentId,
      releaseId: run.releaseId,
      releaseDigest: run.releaseDigest,
      entryResourceVersionId: run.entryResourceVersionId,
      contextDigest: run.contextDigest,
      projectId: run.projectId,
      input: run.input,
      requiredToolScopes: sortedJsonValues(run.requiredToolScopes),
      requiredPluginScopes: sortedJsonValues(run.requiredPluginScopes),
      requiresPluginApproval: run.requiresPluginApproval,
      maxEstimatedCostUsd: run.maxEstimatedCostUsd.toString(),
      estimatedUpperCostUsd: run.estimatedUpperCostUsd.toString(),
      maxAttempts: run.maxAttempts,
      retryBackoff: run.retryBackoff,
      approvalReasons: sortedJsonValues(run.approvalReasons),
      requestReasons: sortedJsonValues(approval.reasons),
      // A non-read or explicitly approval-required Plugin capability must always retain an exact
      // run decision even when every other authority property is identical.
      perRunApprovalId: run.requiresPluginApproval ? run.id : null,
    }),
  );
}

/**
 * Produces stable groups for one queue snapshot. Membership (approval id + request generation) is
 * hashed into the opaque key so an action can revalidate exactly what the human reviewed.
 */
export function groupExecutionApprovals(
  approvals: ExecutionApprovalRecord[],
): ExecutionApprovalGroup[] {
  const bySemantics = new Map<string, ExecutionApprovalRecord[]>();
  for (const approval of approvals) {
    if (
      approval.run.state !== ExecutionRunState.AWAITING_APPROVAL ||
      approval.run.entryResourceVersion === null
    ) {
      continue;
    }
    const key = approvalSemanticKey(approval);
    const group = bySemantics.get(key) ?? [];
    group.push(approval);
    bySemantics.set(key, group);
  }

  return [...bySemantics.entries()]
    .map(([semanticKey, members]) => {
      const approvals = [...members].sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id),
      );
      const entry = approvals[0]?.run.entryResourceVersion;
      if (entry === null || entry === undefined) return null;
      const subject = subjectFromResourceVersion(entry);
      if (subject === null) return null;
      const membership = approvals.map(({ id, requestVersion }) => ({ id, requestVersion }));
      return {
        groupKey: sha256(canonicalJson({ semanticKey, membership })),
        approvals,
        subject,
      } satisfies ExecutionApprovalGroup;
    })
    .filter((group): group is ExecutionApprovalGroup => group !== null)
    .sort(
      (left, right) =>
        (left.approvals[0]?.createdAt.getTime() ?? 0) -
          (right.approvals[0]?.createdAt.getTime() ?? 0) ||
        left.groupKey.localeCompare(right.groupKey),
    );
}
