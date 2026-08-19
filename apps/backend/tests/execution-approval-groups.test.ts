import {
  ApprovalRequestState,
  AutomationBackoff,
  ExecutionRunState,
  Prisma,
  ResourceKind,
} from '@prisma/client';
import {
  groupExecutionApprovals,
  type ExecutionApprovalRecord,
} from '../src/services/execution-approval-groups.js';

const digest = (character: string) => character.repeat(64);

function approval(
  id: string,
  overrides: {
    workspaceId?: string;
    contextDigest?: string;
    requestVersion?: number;
    requiresPluginApproval?: boolean;
    state?: ExecutionRunState;
    subjectName?: string;
    subjectVersion?: string;
    familyId?: string;
    resourceKind?: ResourceKind;
    maxAttempts?: number;
    retryBackoff?: AutomationBackoff;
  } = {},
): ExecutionApprovalRecord {
  const runId = `10000000-0000-4000-8000-${id.padStart(12, '0')}`;
  return {
    id: `20000000-0000-4000-8000-${id.padStart(12, '0')}`,
    runId,
    state: ApprovalRequestState.PENDING,
    requestVersion: overrides.requestVersion ?? 1,
    decisionGroupKey: null,
    decisionGroupSize: null,
    reasons: ['No matching authority grant'],
    requestedBy: 'worker-test',
    decidedBy: null,
    rationale: null,
    decidedAt: null,
    createdAt: new Date(`2026-08-17T12:00:${id.padStart(2, '0')}.000Z`),
    run: {
      id: runId,
      workspaceId: overrides.workspaceId ?? '30000000-0000-4000-8000-000000000003',
      departmentId: '40000000-0000-4000-8000-000000000004',
      releaseId: '50000000-0000-4000-8000-000000000005',
      entryResourceVersionId: '60000000-0000-4000-8000-000000000006',
      legacyEntrypointUnresolved: false,
      authorityGrantId: null,
      digestSnapshotId: null,
      releaseDigest: digest('a'),
      contextDigest: overrides.contextDigest ?? digest('b'),
      contextProvenance: [],
      contextClassification: 'PUBLIC',
      contextEstimatedTokens: 10,
      projectId: 'daily-brief',
      requiredToolScopes: ['calendar.read'],
      requiredPluginScopes: [],
      requiresPluginApproval: overrides.requiresPluginApproval ?? false,
      state: overrides.state ?? ExecutionRunState.AWAITING_APPROVAL,
      input: { date: '2026-08-17' },
      providerKind: 'DETERMINISTIC',
      developmentDraft: false,
      providerVersion: '1.0.0',
      model: 'fixture',
      maxInputTokens: 1000,
      maxOutputTokens: 500,
      maxEstimatedCostUsd: new Prisma.Decimal(1),
      estimatedUpperCostUsd: new Prisma.Decimal(0.2),
      actualCostUsd: null,
      pricingVersion: 'fixture-v1',
      approvalReasons: ['No matching authority grant'],
      progress: 0,
      message: 'Awaiting approval',
      idempotencyKey: `approval-group-${id}`,
      requestedBy: 'worker-test',
      attempts: 0,
      maxAttempts: overrides.maxAttempts ?? 3,
      retryBackoff: overrides.retryBackoff ?? AutomationBackoff.EXPONENTIAL,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      cancelRequestedAt: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date(`2026-08-17T12:00:${id.padStart(2, '0')}.000Z`),
      updatedAt: new Date(`2026-08-17T12:00:${id.padStart(2, '0')}.000Z`),
      entryResourceVersion: {
        id: '60000000-0000-4000-8000-000000000006',
        familyId: overrides.familyId ?? '70000000-0000-4000-8000-000000000007',
        legacyAgentId: null,
        version: overrides.subjectVersion ?? '1.0.0',
        lifecycle: 'CERTIFIED',
        owner: 'local-platform-owner',
        purpose: 'Build a synthetic daily briefing.',
        definition: {},
        digest: digest('c'),
        sourceCommit: 'd'.repeat(40),
        provenance: {},
        dependencyPins: [],
        revision: 1,
        frozenAt: new Date('2026-08-17T00:00:00.000Z'),
        createdBy: 'local-platform-owner',
        updatedBy: 'local-platform-owner',
        createdAt: new Date('2026-08-17T00:00:00.000Z'),
        updatedAt: new Date('2026-08-17T00:00:00.000Z'),
        family: {
          id: overrides.familyId ?? '70000000-0000-4000-8000-000000000007',
          workspaceId: overrides.workspaceId ?? '30000000-0000-4000-8000-000000000003',
          departmentId: '40000000-0000-4000-8000-000000000004',
          kind: overrides.resourceKind ?? ResourceKind.AGENT,
          slug: 'daily-brief',
          name: overrides.subjectName ?? 'Daily Briefing',
          createdBy: 'local-platform-owner',
          updatedBy: 'local-platform-owner',
          createdAt: new Date('2026-08-17T00:00:00.000Z'),
          updatedAt: new Date('2026-08-17T00:00:00.000Z'),
        },
      },
    },
  };
}

describe('execution authority grouping', () => {
  it('collapses exact authority-equivalent requests under one opaque membership key', () => {
    const groups = groupExecutionApprovals([approval('1'), approval('2')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      groupKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      subject: { name: 'Daily Briefing', kind: 'agent', version: '1.0.0' },
    });
    expect(groups[0]?.approvals).toHaveLength(2);
    expect(groups[0]?.groupKey).not.toContain(groups[0]?.approvals[0]?.id ?? 'impossible');
  });

  it('separates scope, context, generation, and approval-required Plugin decisions', () => {
    expect(
      groupExecutionApprovals([approval('1'), approval('2', { contextDigest: digest('e') })]),
    ).toHaveLength(2);
    expect(
      groupExecutionApprovals([
        approval('1'),
        approval('2', { workspaceId: '80000000-0000-4000-8000-000000000008' }),
      ]),
    ).toHaveLength(2);

    const firstGeneration = groupExecutionApprovals([approval('1')])[0]?.groupKey;
    const reopened = groupExecutionApprovals([approval('1', { requestVersion: 2 })])[0]?.groupKey;
    expect(reopened).not.toBe(firstGeneration);

    const pluginGroups = groupExecutionApprovals([
      approval('1', { requiresPluginApproval: true }),
      approval('2', { requiresPluginApproval: true }),
    ]);
    expect(pluginGroups).toHaveLength(2);
    expect(pluginGroups.every(({ approvals }) => approvals.length === 1)).toBe(true);
  });

  it('separates requests with different retry behavior', () => {
    expect(
      groupExecutionApprovals([
        approval('1'),
        approval('2', { maxAttempts: 4 }),
        approval('3', { retryBackoff: AutomationBackoff.FIXED }),
      ]),
    ).toHaveLength(3);
  });

  it('never groups a stale pending request whose run is no longer awaiting approval', () => {
    expect(
      groupExecutionApprovals([
        approval('1'),
        approval('2', { state: ExecutionRunState.CANCELLED }),
      ]),
    ).toMatchObject([{ approvals: [{ run: { state: ExecutionRunState.AWAITING_APPROVAL } }] }]);
  });

  it('keeps canonical human names actionable and routes identifier-shaped subjects out of groups', () => {
    expect(
      groupExecutionApprovals([
        approval('1', {
          familyId: '20000000-0000-4000-8000-000000000001',
          subjectName: 'daily-brief',
          resourceKind: ResourceKind.SKILL,
        }),
      ]),
    ).toMatchObject([{ subject: { name: 'Daily Brief', kind: 'skill', version: '1.0.0' } }]);
    expect(groupExecutionApprovals([approval('2', { subjectName: 'daily-brief' })])).toEqual([]);
    expect(
      groupExecutionApprovals([
        approval('3', { subjectName: 'Candidate 3f8bdaf6', subjectVersion: '1.0.0' }),
      ]),
    ).toEqual([]);
  });
});
