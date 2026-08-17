import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  DAILY_BRIEF_FRESHNESS_WINDOW_SECONDS,
  DEFAULT_AD_HOC_WORKSTATION_FRESHNESS_SECONDS,
  verifiedDualIdentityBindingSchema,
  workstationDualIdentityHandshakeSchema,
  workstationPlacementRequestSchema,
  workstationRunSnapshotSchema,
  workstationWorkOrderPayloadSchema,
  type VerifiedDualIdentityBinding,
  type WorkstationDualIdentityHandshake,
  type WorkstationExpirationDigestItem,
  type WorkstationPlacementRequest,
  type WorkstationRunSnapshot,
  type WorkstationWorkOrderPayload,
} from './workstation-broker-schemas.js';

export class WorkstationBrokerInvariantError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'WorkstationBrokerInvariantError';
  }
}

export interface WorkstationIdentityVerifier {
  verifyUserProof(input: {
    actorId: string;
    userSid: string;
    proofKind: 'fixture_oidc' | 'entra_wam';
    accessToken: string;
  }): Promise<boolean>;
  verifyDeviceProof(input: {
    certificateThumbprint: string;
    nonce: string;
    signatureBase64Url: string;
  }): Promise<boolean>;
  kind: 'fixture' | 'control_plane';
}

export function placeExecution(
  input: WorkstationPlacementRequest,
  ids: { workOrderId?: string; leaseId?: string; nonce?: string } = {},
): WorkstationRunSnapshot {
  const request = workstationPlacementRequestSchema.parse(input);
  const requiresWorkstation = request.requirements.some(
    ({ residency }) => residency === 'workstation',
  );
  if (!requiresWorkstation) {
    return workstationRunSnapshotSchema.parse({
      runId: request.runId,
      workspaceId: request.workspaceId,
      departmentId: request.departmentId,
      scheduleId: request.scheduleId,
      state: 'control_plane_ready',
      placement: 'control_plane',
      requiredActorId: request.actorId,
      requiredUserSid: request.requiredUserSid,
      requiredDeviceCertificateThumbprint: request.requiredDeviceCertificateThumbprint,
      freshnessWindowSeconds: null,
      waitingSince: null,
      expiresAt: null,
      workOrderId: null,
      leaseId: null,
      nonce: null,
      attentionRequired: false,
      attentionReason: null,
      externalEffectsAllowed: true,
      digestEventKey: null,
    });
  }

  if (
    request.scheduleId !== null &&
    request.workflowKind !== 'daily_brief' &&
    request.freshnessWindowSeconds === null
  ) {
    throw new WorkstationBrokerInvariantError(
      'A workstation-dependent schedule requires freshnessWindowSeconds',
    );
  }
  const freshnessWindowSeconds =
    request.freshnessWindowSeconds ??
    (request.workflowKind === 'daily_brief'
      ? DAILY_BRIEF_FRESHNESS_WINDOW_SECONDS
      : DEFAULT_AD_HOC_WORKSTATION_FRESHNESS_SECONDS);
  const requestedAt = Date.parse(request.requestedAt);
  const expiresAt = new Date(requestedAt + freshnessWindowSeconds * 1_000).toISOString();
  const nonce = ids.nonce ?? randomBytes(32).toString('base64url');

  return workstationRunSnapshotSchema.parse({
    runId: request.runId,
    workspaceId: request.workspaceId,
    departmentId: request.departmentId,
    scheduleId: request.scheduleId,
    state: 'waiting_for_user',
    placement: 'workstation',
    requiredActorId: request.actorId,
    requiredUserSid: request.requiredUserSid,
    requiredDeviceCertificateThumbprint: request.requiredDeviceCertificateThumbprint,
    freshnessWindowSeconds,
    waitingSince: request.requestedAt,
    expiresAt,
    workOrderId: ids.workOrderId ?? randomUUID(),
    leaseId: ids.leaseId ?? randomUUID(),
    nonce,
    attentionRequired: true,
    attentionReason: 'Waiting for you to sign in.',
    externalEffectsAllowed: false,
    digestEventKey: null,
  });
}

export function createWorkOrder(
  snapshot: WorkstationRunSnapshot,
  input: Omit<
    WorkstationWorkOrderPayload,
    | 'schemaVersion'
    | 'workOrderId'
    | 'leaseId'
    | 'runId'
    | 'workspaceId'
    | 'departmentId'
    | 'requiredActorId'
    | 'requiredUserSid'
    | 'requiredDeviceCertificateThumbprint'
    | 'expiresAt'
    | 'freshnessWindowSeconds'
    | 'nonce'
  >,
): WorkstationWorkOrderPayload {
  const state = workstationRunSnapshotSchema.parse(snapshot);
  if (
    state.state !== 'waiting_for_user' ||
    state.workOrderId === null ||
    state.leaseId === null ||
    state.nonce === null ||
    state.expiresAt === null ||
    state.freshnessWindowSeconds === null
  ) {
    throw new WorkstationBrokerInvariantError(
      'Only a complete waiting_for_user state can issue a workstation work order',
    );
  }
  return workstationWorkOrderPayloadSchema.parse({
    ...input,
    schemaVersion: 'paul-os.workstation-work-order/v1',
    workOrderId: state.workOrderId,
    leaseId: state.leaseId,
    runId: state.runId,
    workspaceId: state.workspaceId,
    departmentId: state.departmentId,
    requiredActorId: state.requiredActorId,
    requiredUserSid: state.requiredUserSid,
    requiredDeviceCertificateThumbprint: state.requiredDeviceCertificateThumbprint,
    expiresAt: state.expiresAt,
    freshnessWindowSeconds: state.freshnessWindowSeconds,
    nonce: state.nonce,
  });
}

export async function verifyDualIdentityBinding(
  orderInput: WorkstationWorkOrderPayload,
  handshakeInput: WorkstationDualIdentityHandshake,
  verifier: WorkstationIdentityVerifier,
  now: string,
): Promise<VerifiedDualIdentityBinding> {
  const order = workstationWorkOrderPayloadSchema.parse(orderInput);
  const handshake = workstationDualIdentityHandshakeSchema.parse(handshakeInput);
  const nowMs = Date.parse(now);
  if (nowMs < Date.parse(order.notBefore) || nowMs >= Date.parse(order.expiresAt)) {
    throw new WorkstationBrokerInvariantError('The workstation work order is not currently valid');
  }
  if (nowMs >= Date.parse(order.leaseExpiresAt)) {
    throw new WorkstationBrokerInvariantError('The workstation work-order lease has expired');
  }
  const exactMatches =
    handshake.workOrderId === order.workOrderId &&
    handshake.leaseId === order.leaseId &&
    handshake.nonce === order.nonce &&
    handshake.actorId === order.requiredActorId &&
    handshake.userSid === order.requiredUserSid &&
    handshake.deviceCertificateThumbprint === order.requiredDeviceCertificateThumbprint;
  if (!exactMatches) {
    throw new WorkstationBrokerInvariantError(
      'The actor, user, device, work order, lease, and nonce must match exactly',
    );
  }
  const [userVerified, deviceVerified] = await Promise.all([
    verifier.verifyUserProof({
      actorId: handshake.actorId,
      userSid: handshake.userSid,
      proofKind: handshake.userProofKind,
      accessToken: handshake.userAccessToken,
    }),
    verifier.verifyDeviceProof({
      certificateThumbprint: handshake.deviceCertificateThumbprint,
      nonce: handshake.nonce,
      signatureBase64Url: handshake.deviceChallengeSignatureBase64Url,
    }),
  ]);
  if (!userVerified || !deviceVerified) {
    throw new WorkstationBrokerInvariantError(
      'Both the current user and enrolled device proofs must verify',
    );
  }
  return verifiedDualIdentityBindingSchema.parse({
    workOrderId: order.workOrderId,
    leaseId: order.leaseId,
    nonce: order.nonce,
    actorId: order.requiredActorId,
    userSid: order.requiredUserSid,
    deviceCertificateThumbprint: order.requiredDeviceCertificateThumbprint,
    userTokenDigest: createHash('sha256').update(handshake.userAccessToken).digest('hex'),
    deviceProofDigest: createHash('sha256')
      .update(handshake.deviceChallengeSignatureBase64Url)
      .digest('hex'),
    verifiedAt: now,
    verifier: verifier.kind,
  });
}

export function resumeWaitingExecution(
  snapshotInput: WorkstationRunSnapshot,
  bindingInput: VerifiedDualIdentityBinding,
  now: string,
  consumedNonces: ReadonlySet<string>,
): WorkstationRunSnapshot {
  const snapshot = workstationRunSnapshotSchema.parse(snapshotInput);
  const binding = verifiedDualIdentityBindingSchema.parse(bindingInput);
  if (snapshot.state !== 'waiting_for_user') {
    throw new WorkstationBrokerInvariantError('Only waiting_for_user runs can resume');
  }
  if (snapshot.expiresAt === null || Date.parse(now) >= Date.parse(snapshot.expiresAt)) {
    throw new WorkstationBrokerInvariantError('The waiting run expired and cannot perform work');
  }
  if (consumedNonces.has(binding.nonce)) {
    throw new WorkstationBrokerInvariantError('The work-order nonce has already been consumed');
  }
  if (
    binding.workOrderId !== snapshot.workOrderId ||
    binding.leaseId !== snapshot.leaseId ||
    binding.nonce !== snapshot.nonce ||
    binding.actorId !== snapshot.requiredActorId ||
    binding.userSid !== snapshot.requiredUserSid ||
    binding.deviceCertificateThumbprint !== snapshot.requiredDeviceCertificateThumbprint
  ) {
    throw new WorkstationBrokerInvariantError(
      'Verified identity does not match the waiting actor and device binding',
    );
  }
  if (Date.parse(binding.verifiedAt) > Date.parse(now)) {
    throw new WorkstationBrokerInvariantError('Identity verification cannot come from the future');
  }
  return workstationRunSnapshotSchema.parse({
    ...snapshot,
    state: 'leased',
    attentionRequired: false,
    attentionReason: null,
    externalEffectsAllowed: true,
  });
}

export function expireWaitingExecution(
  snapshotInput: WorkstationRunSnapshot,
  now: string,
): { snapshot: WorkstationRunSnapshot; digestItem: WorkstationExpirationDigestItem | null } {
  const snapshot = workstationRunSnapshotSchema.parse(snapshotInput);
  if (snapshot.state === 'expired') {
    return { snapshot, digestItem: null };
  }
  if (snapshot.state !== 'waiting_for_user') {
    throw new WorkstationBrokerInvariantError('Only waiting_for_user runs may expire');
  }
  if (snapshot.expiresAt === null || Date.parse(now) < Date.parse(snapshot.expiresAt)) {
    throw new WorkstationBrokerInvariantError('The waiting run has not reached its expiry');
  }
  const digestEventKey = `workstation-expired:${snapshot.runId}`;
  const expired = workstationRunSnapshotSchema.parse({
    ...snapshot,
    state: 'expired',
    attentionRequired: false,
    attentionReason: null,
    externalEffectsAllowed: false,
    digestEventKey,
  });
  return {
    snapshot: expired,
    digestItem: {
      idempotencyKey: digestEventKey,
      runId: snapshot.runId,
      occurredAt: now,
      message: 'A workstation run expired while waiting for you to sign in.',
      lateEffectsPerformed: false,
    },
  };
}
