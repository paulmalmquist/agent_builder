import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DAILY_BRIEF_FRESHNESS_WINDOW_SECONDS,
  workstationWorkOrderPayloadSchema,
} from '../dist/index.js';
import {
  WorkstationBrokerInvariantError,
  createWorkOrder,
  expireWaitingExecution,
  placeExecution,
  resumeWaitingExecution,
  verifyDualIdentityBinding,
} from '../dist/workstation-broker-domain.js';

const ids = Array.from(
  { length: 20 },
  (_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const digest = 'a'.repeat(64);
const thumbprint = 'A'.repeat(40);
const nonce = 'b'.repeat(43);
const now = '2026-08-17T11:00:00.000Z';

function placement(overrides = {}) {
  return {
    runId: ids[0],
    workspaceId: ids[1],
    departmentId: ids[2],
    actorId: 'local-user',
    requiredUserSid: 'S-1-5-21-100-200-300-1001',
    requiredDeviceCertificateThumbprint: thumbprint,
    scheduleId: ids[3],
    workflowKind: 'daily_brief',
    freshnessWindowSeconds: null,
    requirements: [
      {
        pluginVersionId: ids[4],
        pluginDigest: digest,
        installationId: ids[5],
        tool: 'local-file.read',
        residency: 'workstation',
      },
    ],
    requestedAt: now,
    ...overrides,
  };
}

function order(snapshot) {
  return createWorkOrder(snapshot, {
    entryResourceVersionId: ids[6],
    releaseDigest: digest,
    installationId: ids[5],
    pluginVersionId: ids[4],
    pluginDigest: digest,
    tool: 'local-file.read',
    issuedAt: now,
    notBefore: now,
    leaseExpiresAt: '2026-08-17T11:10:00.000Z',
    invocationKey: `${ids[0]}:plugin:0`,
    input: { relativePath: 'briefing-input.json' },
  });
}

function handshake(workOrder, overrides = {}) {
  return {
    workOrderId: workOrder.workOrderId,
    leaseId: workOrder.leaseId,
    nonce: workOrder.nonce,
    actorId: workOrder.requiredActorId,
    userSid: workOrder.requiredUserSid,
    userProofKind: 'fixture_oidc',
    userAccessToken: 'fixture-token-that-is-long-enough-and-never-logged',
    deviceCertificateThumbprint: workOrder.requiredDeviceCertificateThumbprint,
    deviceChallengeSignatureBase64Url: 'c'.repeat(43),
    ...overrides,
  };
}

const validVerifier = {
  kind: 'fixture',
  verifyUserProof: async () => true,
  verifyDeviceProof: async () => true,
};

test('central-only requirements remain immediately runnable and never create Attention', () => {
  const state = placeExecution(
    placement({
      requirements: [
        {
          pluginVersionId: ids[4],
          pluginDigest: digest,
          installationId: ids[5],
          tool: 'calendar.read',
          residency: 'control_plane',
        },
      ],
    }),
  );
  assert.equal(state.state, 'control_plane_ready');
  assert.equal(state.placement, 'control_plane');
  assert.equal(state.attentionRequired, false);
  assert.equal(state.externalEffectsAllowed, true);
  assert.equal(state.workOrderId, null);
});

test('any workstation requirement holds the whole run with no silent placement fallback', () => {
  const state = placeExecution(
    placement({
      requirements: [
        {
          pluginVersionId: ids[7],
          pluginDigest: digest,
          installationId: ids[8],
          tool: 'calendar.read',
          residency: 'control_plane',
        },
        placement().requirements[0],
      ],
    }),
    { workOrderId: ids[9], leaseId: ids[10], nonce },
  );
  assert.equal(state.state, 'waiting_for_user');
  assert.equal(state.placement, 'workstation');
  assert.equal(state.attentionReason, 'Waiting for you to sign in.');
  assert.equal(state.externalEffectsAllowed, false);
  assert.equal(state.freshnessWindowSeconds, DAILY_BRIEF_FRESHNESS_WINDOW_SECONDS);
  assert.equal(state.expiresAt, '2026-08-17T13:00:00.000Z');
});

test('non-brief workstation schedules must declare freshness explicitly', () => {
  assert.throws(
    () => placeExecution(placement({ workflowKind: 'other' })),
    /requires freshnessWindowSeconds/,
  );
});

test('work orders bind immutable release, plugin, actor, device, nonce, lease, and freshness', () => {
  const state = placeExecution(placement(), {
    workOrderId: ids[9],
    leaseId: ids[10],
    nonce,
  });
  const value = order(state);
  assert.equal(workstationWorkOrderPayloadSchema.safeParse(value).success, true);
  assert.equal(value.requiredActorId, 'local-user');
  assert.equal(value.requiredDeviceCertificateThumbprint, thumbprint);
  assert.equal(
    workstationWorkOrderPayloadSchema.safeParse({
      ...value,
      leaseExpiresAt: '2026-08-17T14:00:00.000Z',
    }).success,
    false,
  );
});

test('resume requires independently verified exact user and device proofs', async () => {
  const state = placeExecution(placement(), {
    workOrderId: ids[9],
    leaseId: ids[10],
    nonce,
  });
  const workOrder = order(state);
  const binding = await verifyDualIdentityBinding(
    workOrder,
    handshake(workOrder),
    validVerifier,
    '2026-08-17T11:05:00.000Z',
  );
  const resumed = resumeWaitingExecution(state, binding, '2026-08-17T11:05:01.000Z', new Set());
  assert.equal(resumed.state, 'leased');
  assert.equal(resumed.externalEffectsAllowed, true);
  assert.equal(resumed.attentionRequired, false);

  await assert.rejects(
    verifyDualIdentityBinding(
      workOrder,
      handshake(workOrder, { actorId: 'different-user' }),
      validVerifier,
      '2026-08-17T11:05:00.000Z',
    ),
    /must match exactly/,
  );
  await assert.rejects(
    verifyDualIdentityBinding(
      workOrder,
      handshake(workOrder),
      { ...validVerifier, verifyDeviceProof: async () => false },
      '2026-08-17T11:05:00.000Z',
    ),
    /Both the current user and enrolled device proofs must verify/,
  );
});

test('replayed nonces and expired leases fail closed', async () => {
  const state = placeExecution(placement(), {
    workOrderId: ids[9],
    leaseId: ids[10],
    nonce,
  });
  const workOrder = order(state);
  const binding = await verifyDualIdentityBinding(
    workOrder,
    handshake(workOrder),
    validVerifier,
    '2026-08-17T11:05:00.000Z',
  );
  assert.throws(
    () => resumeWaitingExecution(state, binding, '2026-08-17T11:05:01.000Z', new Set([nonce])),
    /already been consumed/,
  );
  await assert.rejects(
    verifyDualIdentityBinding(
      workOrder,
      handshake(workOrder),
      validVerifier,
      '2026-08-17T11:10:00.000Z',
    ),
    /lease has expired/,
  );
});

test('expiry performs no late work and contributes exactly one digest item', () => {
  const waiting = placeExecution(placement(), {
    workOrderId: ids[9],
    leaseId: ids[10],
    nonce,
  });
  const first = expireWaitingExecution(waiting, '2026-08-17T13:00:00.000Z');
  assert.equal(first.snapshot.state, 'expired');
  assert.equal(first.snapshot.externalEffectsAllowed, false);
  assert.equal(first.digestItem?.lateEffectsPerformed, false);
  assert.equal(first.digestItem?.idempotencyKey, `workstation-expired:${ids[0]}`);
  const retry = expireWaitingExecution(first.snapshot, '2026-08-17T14:00:00.000Z');
  assert.equal(retry.digestItem, null);
  assert.throws(
    () =>
      resumeWaitingExecution(
        first.snapshot,
        {
          workOrderId: ids[9],
          leaseId: ids[10],
          nonce,
          actorId: 'local-user',
          userSid: 'S-1-5-21-100-200-300-1001',
          deviceCertificateThumbprint: thumbprint,
          userTokenDigest: digest,
          deviceProofDigest: digest,
          verifiedAt: '2026-08-17T12:59:00.000Z',
          verifier: 'fixture',
        },
        '2026-08-17T13:00:00.000Z',
        new Set(),
      ),
    WorkstationBrokerInvariantError,
  );
});
