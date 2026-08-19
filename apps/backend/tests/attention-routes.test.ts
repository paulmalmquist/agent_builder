import request from 'supertest';
import { pino } from 'pino';
import {
  approveExecutionRunGroupResponseSchema,
  attentionItemDetailSchema,
  attentionResolutionSchema,
  attentionResponseSchema,
  executionRunSchema,
  releaseDeclineResponseSchema,
  rejectExecutionRunGroupResponseSchema,
  type PlatformRoleValue,
} from '@agent-builder/contracts';
import { createApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { requireHumanActor } from '../src/services/actors.js';
import type { ServiceBundle } from '../src/services/types.js';

const now = '2026-08-16T12:00:00.000Z';
const runId = '10000000-0000-4000-8000-000000000001';
const releaseId = '20000000-0000-4000-8000-000000000002';
const evaluationId = '30000000-0000-4000-8000-000000000003';
const entryResourceVersionId = '60000000-0000-4000-8000-000000000006';
const groupKey = 'c'.repeat(64);
const grantId = '70000000-0000-4000-8000-000000000007';
const itemId = `execution_approval:${groupKey}`;

const actionBase = {
  consequence: 'This fixture action has a bounded, explicit consequence.',
  undo: 'A later governed action can reverse this fixture effect.',
  resourceId: runId,
  requiresRationale: true,
};
const item = {
  id: itemId,
  kind: 'execution_approval',
  shelf: 'decide',
  headline: 'Daily Briefing wants authority for 1 run.',
  delta: 'One read-only scope · about $0.20 at most',
  status: 'decide',
  primaryAction: {
    ...actionBase,
    resourceId: groupKey,
    kind: 'approve_run',
    label: 'Review and approve',
  },
  secondaryAction: {
    ...actionBase,
    resourceId: groupKey,
    kind: 'reject_run',
    label: 'Reject',
  },
  cost: { period: 'run', usd: 0.2, budgetUsd: 1 },
  reason: 'This run has no matching authority grant.',
  provenance: {
    sourceType: 'ApprovalRequest',
    sourceId: '40000000-0000-4000-8000-000000000004',
    actorId: 'human:route-test',
    requestId: null,
    explanation: 'The execution service recorded a pending authority decision.',
  },
  occurredAt: now,
  payload: {
    sourceType: 'ApprovalRequest',
    sourceId: '40000000-0000-4000-8000-000000000004',
    detailPath: `/runs/${runId}`,
    scopes: ['calendar.read'],
    runId,
    candidateId: null,
    channelKey: null,
    releaseId,
    evaluationId: null,
    expiresAt: null,
    approvalGroupKey: groupKey,
    requestCount: 1,
    subject: { name: 'Daily Briefing', kind: 'agent', version: '1.0.0' },
    reviewFacts: [{ label: 'Subject', value: 'Daily Briefing · agent 1.0.0' }],
    metadata: { state: 'awaiting_approval' },
  },
} as const;

const attention = attentionResponseSchema.parse({
  generatedAt: now,
  decide: [item],
  degraded: [],
  digest: {
    headline: 'No informational activity is waiting for tomorrow’s brief.',
    runCount: 0,
    totalCostUsd: 0,
    promotionCount: 0,
    observationCount: 0,
    windowStartedAt: null,
    windowEndedAt: now,
  },
  decideBadgeCount: 1,
  lastDeliveredBriefingAt: null,
});

const detail = attentionItemDetailSchema.parse({
  item,
  timeline: [],
  details: { releaseDigest: 'a'.repeat(64), requiredScopes: ['calendar.read'] },
});

const rejectedRun = executionRunSchema.parse({
  id: runId,
  releaseId,
  entryResourceVersionId,
  entrySubject: { name: 'Daily Brief', kind: 'skill', version: '1.0.0' },
  legacyEntrypointUnresolved: false,
  releaseDigest: 'a'.repeat(64),
  contextDigest: 'b'.repeat(64),
  contextProvenance: [],
  contextClassification: 'public',
  contextEstimatedTokens: 10,
  projectId: 'daily-brief',
  requiredToolScopes: ['calendar.read'],
  requiredPluginScopes: [],
  requiresPluginApproval: false,
  authorityGrantId: null,
  digestSnapshotId: null,
  state: 'cancelled',
  input: {},
  providerKind: 'deterministic',
  developmentDraft: true,
  providerVersion: '1.0.0',
  model: 'fixture',
  maxInputTokens: 1000,
  maxOutputTokens: 500,
  maxEstimatedCostUsd: 1,
  estimatedUpperCostUsd: 0.2,
  actualCostUsd: null,
  pricingVersion: 'fixture-v1',
  approvalReasons: ['Needs authority'],
  progress: 0,
  message: 'Rejected by a human reviewer',
  attempts: 0,
  maxAttempts: 3,
  retryBackoff: 'exponential',
  error: { code: 'RUN_REJECTED' },
  requestedBy: 'human:route-test',
  startedAt: null,
  finishedAt: now,
  createdAt: now,
  updatedAt: now,
});

const approvedRun = executionRunSchema.parse({
  ...rejectedRun,
  authorityGrantId: grantId,
  state: 'queued',
  approvalReasons: [],
  message: 'Queued',
  finishedAt: null,
});

const approvedGroup = approveExecutionRunGroupResponseSchema.parse({
  groupKey,
  grant: {
    id: grantId,
    releaseId,
    entryResourceVersionId,
    releaseDigest: 'a'.repeat(64),
    contextDigest: 'b'.repeat(64),
    projectId: 'daily-brief',
    inputConstraints: {},
    toolScopes: ['calendar.read'],
    pluginScopes: [],
    validFrom: now,
    validUntil: '2027-08-16T12:00:00.000Z',
    maxRuns: 1,
    usedRuns: 0,
    maxEstimatedCostPerRunUsd: 1,
    totalCostBudgetUsd: 1,
    spentCostUsd: 0,
    reservedCostUsd: 0,
    state: 'active',
    actorId: 'human:route-test',
    rationale: 'Allow this exact Daily Briefing request within its reviewed limits.',
    revokedAt: null,
    createdAt: now,
  },
  runs: [approvedRun],
});

const rejectedGroup = rejectExecutionRunGroupResponseSchema.parse({
  groupKey,
  runs: [rejectedRun],
});

const decline = releaseDeclineResponseSchema.parse({
  channel: null,
  decision: {
    id: '50000000-0000-4000-8000-000000000005',
    channelKey: 'daily-brief',
    action: 'declined',
    releaseId,
    evaluationId,
    rationale: 'Keep the current release while the evidence is reviewed again.',
    decidedBy: 'human:route-test',
    decidedAt: now,
  },
});

function appFor(
  overrides: {
    list?: jest.Mock;
    getItem?: jest.Mock;
    resolveItem?: jest.Mock;
    rejectRun?: jest.Mock;
    approveRun?: jest.Mock;
    approveRunGroup?: jest.Mock;
    rejectRunGroup?: jest.Mock;
    revokeGrant?: jest.Mock;
    decline?: jest.Mock;
    getChannel?: jest.Mock;
  } = {},
  actorId = 'human:route-test',
  roles: PlatformRoleValue[] = ['admin'],
) {
  const services = {
    health: { check: jest.fn() },
    platform: {
      attention: {
        list: overrides.list ?? jest.fn().mockResolvedValue(attention),
        getItem: overrides.getItem ?? jest.fn().mockResolvedValue(detail),
        resolveItem:
          overrides.resolveItem ??
          jest.fn().mockResolvedValue(
            attentionResolutionSchema.parse({
              id: '60000000-0000-4000-8000-000000000006',
              itemId: `stalled_run:${runId}`,
              rationale: 'The terminal fixture failure was reviewed and acknowledged.',
              resolvedBy: actorId,
              resolvedAt: now,
            }),
          ),
      },
      registry: {},
      releaseGovernance: {
        decline: overrides.decline ?? jest.fn().mockResolvedValue(decline),
        getChannel: overrides.getChannel ?? jest.fn().mockResolvedValue(null),
      },
      execution: {
        approveRun:
          overrides.approveRun ??
          jest.fn().mockResolvedValue({ grant: approvedGroup.grant, run: approvedRun }),
        approveRunGroup: overrides.approveRunGroup ?? jest.fn().mockResolvedValue(approvedGroup),
        rejectRunGroup: overrides.rejectRunGroup ?? jest.fn().mockResolvedValue(rejectedGroup),
        rejectRun: overrides.rejectRun ?? jest.fn().mockResolvedValue(rejectedRun),
        revokeGrant: overrides.revokeGrant ?? jest.fn().mockResolvedValue(approvedGroup.grant),
      },
      automationLearning: {},
      executionDispatcher: { enqueue: jest.fn(), recoverAndResume: jest.fn() },
      dispatchMode: 'external',
    },
  } as unknown as ServiceBundle;
  return createApp(services, pino({ level: 'silent' }), {
    auth: { enabled: true, actorId, bearerToken: 'route-secret', roles },
  });
}

const authenticated = (verb: 'get' | 'post', path: string, app = appFor()) =>
  request(app)[verb](path).set('authorization', 'Bearer route-secret');

describe('Quiet Console Attention routes', () => {
  it('returns a total nullable production-channel lookup without fabricating a row', async () => {
    const getChannel = jest.fn().mockResolvedValue(null);
    const app = appFor({ getChannel });
    await authenticated('get', '/v1/production-channels/daily-operations', app).expect(200, null);
    expect(getChannel).toHaveBeenCalledWith('daily-operations');

    await authenticated('get', '/v1/production-channels/NOT-A-KEY', app).expect(400);
    expect(getChannel).toHaveBeenCalledTimes(1);
  });

  it('serves the queue and decision-grade item detail', async () => {
    const list = jest.fn().mockResolvedValue(attention);
    const getItem = jest.fn().mockResolvedValue(detail);
    const app = appFor({ list, getItem });
    await authenticated('get', '/v1/attention', app).expect(200, attention);
    await authenticated('get', `/v1/attention-items/${encodeURIComponent(itemId)}`, app).expect(
      200,
      detail,
    );
    expect(list).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalledWith(itemId);
  });

  it('returns typed validation and not-found errors for malformed or missing items', async () => {
    const missing = jest
      .fn()
      .mockRejectedValue(
        new AppError(404, 'ATTENTION_ITEM_NOT_FOUND', 'Attention item was not found'),
      );
    const app = appFor({ getItem: missing });
    expect(
      (await authenticated('get', '/v1/attention-items/x', app).expect(400)).body,
    ).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
    expect(
      (await authenticated('get', '/v1/attention-items/missing-item', app).expect(404)).body,
    ).toMatchObject({ error: { code: 'ATTENTION_ITEM_NOT_FOUND' } });
  });

  it('validates and forwards run rejection and immutable release decline decisions', async () => {
    const rejectRun = jest.fn().mockResolvedValue(rejectedRun);
    const declineRelease = jest.fn().mockResolvedValue(decline);
    const app = appFor({ rejectRun, decline: declineRelease });
    const rejectionBody = {
      rationale: 'Do not grant this run the requested calendar scope.',
    };
    await authenticated('post', `/v1/execution-runs/${runId}/reject`, app)
      .send(rejectionBody)
      .expect(200, rejectedRun);
    expect(rejectRun).toHaveBeenCalledWith(runId, rejectionBody);

    const declineBody = {
      releaseId,
      evaluationId,
      rationale: 'Keep the current release while the evidence is reviewed again.',
    };
    await authenticated('post', '/v1/production-channels/daily-brief/decline', app)
      .send(declineBody)
      .expect(200, decline);
    expect(declineRelease).toHaveBeenCalledWith('daily-brief', declineBody);

    await authenticated('post', `/v1/execution-runs/${runId}/reject`, app)
      .send({ rationale: 'short' })
      .expect(400);
    await authenticated('post', '/v1/production-channels/daily-brief/decline', app)
      .send({ ...declineBody, evaluationId: 'not-a-uuid' })
      .expect(400);
  });

  it('forwards exact grouped approval and rejection decisions', async () => {
    const approveRunGroup = jest.fn().mockResolvedValue(approvedGroup);
    const rejectRunGroup = jest.fn().mockResolvedValue(rejectedGroup);
    const app = appFor({ approveRunGroup, rejectRunGroup });
    const approvalBody = {
      entryResourceVersionId,
      projectId: 'daily-brief',
      inputConstraints: {},
      toolScopes: ['calendar.read'],
      pluginScopes: [],
      validUntil: '2027-08-16T12:00:00.000Z',
      maxRuns: 1,
      maxEstimatedCostPerRunUsd: 1,
      totalCostBudgetUsd: 1,
      rationale: 'Allow this exact Daily Briefing request within its reviewed limits.',
    };
    await authenticated('post', `/v1/execution-approval-groups/${groupKey}/approve`, app)
      .send(approvalBody)
      .expect(200, approvedGroup);
    expect(approveRunGroup).toHaveBeenCalledWith(groupKey, approvalBody);

    const rejectionBody = {
      rationale: 'Keep every matching Daily Briefing request paused and record this decision.',
    };
    await authenticated('post', `/v1/execution-approval-groups/${groupKey}/reject`, app)
      .send(rejectionBody)
      .expect(200, rejectedGroup);
    expect(rejectRunGroup).toHaveBeenCalledWith(groupKey, rejectionBody);

    await authenticated('post', '/v1/execution-approval-groups/not-a-key/reject', app)
      .send(rejectionBody)
      .expect(400);
  });

  it('rejects system identities for governed decisions', async () => {
    const rejectRun = jest.fn().mockImplementation(() => {
      requireHumanActor();
      return Promise.resolve(rejectedRun);
    });
    const app = appFor({ rejectRun }, 'system:route-test');
    const response = await authenticated('post', `/v1/execution-runs/${runId}/reject`, app)
      .send({ rationale: 'A system identity must not make this human decision.' })
      .expect(403);
    expect(response.body).toMatchObject({ error: { code: 'HUMAN_APPROVAL_REQUIRED' } });
  });

  it('requires owner authority for grouped and per-run decisions while preserving UUID validation order', async () => {
    const approvalBody = {
      entryResourceVersionId,
      projectId: 'daily-brief',
      inputConstraints: {},
      toolScopes: ['calendar.read'],
      pluginScopes: [],
      validUntil: '2027-08-16T12:00:00.000Z',
      maxRuns: 1,
      maxEstimatedCostPerRunUsd: 1,
      totalCostBudgetUsd: 1,
      rationale: 'Allow this exact Daily Briefing request within its reviewed limits.',
    };
    const rejectionBody = {
      rationale: 'Keep this exact Daily Briefing request paused and record the decision.',
    };
    const governedPaths = [
      ['/v1/execution-approval-groups/' + groupKey + '/approve', approvalBody],
      ['/v1/execution-approval-groups/' + groupKey + '/reject', rejectionBody],
      [`/v1/execution-runs/${runId}/approve`, approvalBody],
      [`/v1/execution-runs/${runId}/reject`, rejectionBody],
      [`/v1/authority-grants/${grantId}/revoke`, {}],
    ] as const;

    const consumerApp = appFor({}, 'human:consumer-route-test', ['consumer']);
    for (const [path, body] of governedPaths) {
      const response = await authenticated('post', path, consumerApp).send(body).expect(403);
      expect(response.body).toMatchObject({
        error: { code: 'AUTHORIZATION_REQUIRED', details: { requiredRole: 'owner' } },
      });
    }
    await authenticated('post', '/v1/execution-runs/not-a-uuid/reject', consumerApp)
      .send(rejectionBody)
      .expect(404);
    await authenticated('post', '/v1/authority-grants/not-a-uuid/revoke', consumerApp)
      .send({})
      .expect(404);

    for (const role of ['owner', 'admin'] as const) {
      const app = appFor({}, `human:${role}-route-test`, [role]);
      for (const [path, body] of governedPaths) {
        await authenticated('post', path, app).send(body).expect(200);
      }
    }
  });
});
