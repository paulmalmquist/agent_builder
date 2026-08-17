import request from 'supertest';
import { pino } from 'pino';
import {
  attentionItemDetailSchema,
  attentionResolutionSchema,
  attentionResponseSchema,
  executionRunSchema,
  releaseDeclineResponseSchema,
} from '@agent-builder/contracts';
import { createApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { requireHumanActor } from '../src/services/actors.js';
import type { ServiceBundle } from '../src/services/types.js';

const now = '2026-08-16T12:00:00.000Z';
const runId = '10000000-0000-4000-8000-000000000001';
const releaseId = '20000000-0000-4000-8000-000000000002';
const evaluationId = '30000000-0000-4000-8000-000000000003';
const itemId = `execution_approval:${runId}`;

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
  headline: 'A run is asking for permission.',
  delta: 'One read-only scope · about $0.20 at most',
  status: 'decide',
  primaryAction: { ...actionBase, kind: 'approve_run', label: 'Review and approve' },
  secondaryAction: { ...actionBase, kind: 'reject_run', label: 'Reject' },
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
    reviewFacts: [{ label: 'Release', value: releaseId }],
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
  releaseDigest: 'a'.repeat(64),
  contextDigest: 'b'.repeat(64),
  contextProvenance: [],
  contextClassification: 'public',
  contextEstimatedTokens: 10,
  projectId: 'daily-brief',
  requiredToolScopes: ['calendar.read'],
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
  error: { code: 'RUN_REJECTED' },
  requestedBy: 'human:route-test',
  startedAt: null,
  finishedAt: now,
  createdAt: now,
  updatedAt: now,
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
    decline?: jest.Mock;
  } = {},
  actorId = 'human:route-test',
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
      releaseGovernance: { decline: overrides.decline ?? jest.fn().mockResolvedValue(decline) },
      execution: { rejectRun: overrides.rejectRun ?? jest.fn().mockResolvedValue(rejectedRun) },
      automationLearning: {},
      executionDispatcher: { enqueue: jest.fn(), recoverAndResume: jest.fn() },
      dispatchMode: 'external',
    },
  } as unknown as ServiceBundle;
  return createApp(services, pino({ level: 'silent' }), {
    auth: { enabled: true, actorId, bearerToken: 'route-secret' },
  });
}

const authenticated = (verb: 'get' | 'post', path: string, app = appFor()) =>
  request(app)[verb](path).set('authorization', 'Bearer route-secret');

describe('Quiet Console Attention routes', () => {
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
});
