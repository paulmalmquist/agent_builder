import {
  ApprovalRequestState,
  DigestDeliveryAttemptState,
  ExecutionRunState,
  ImprovementCandidateState,
  MemoryCandidateState,
  PluginInstallationState,
  ReleaseEvaluationVerdict,
  ResourceKind,
  ResourceLifecycle,
  type DigestDeliveryAttempt,
  type DigestSnapshot as DigestSnapshotRecord,
  type ExecutionRun,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  consoleActionCopy,
  consoleCriticalCopy,
  attentionItemDetailSchema,
  attentionItemSchema,
  attentionMembershipSchema,
  attentionResolutionSchema,
  attentionResponseSchema,
  digestSnapshotSchema,
  digestSnapshotSummarySchema,
  digestSummarySchema,
  executionRunEventSchema,
  jsonObjectSchema,
  resolveAttentionItemRequestSchema,
  runPluginRequirementSchema,
  type AttentionItem,
  type AttentionItemDetail,
  type AttentionMembership,
  type AttentionResponse,
  type DigestSnapshot,
  type ExecutionRunEvent,
  type JsonValue,
} from '@agent-builder/contracts';
import { z } from 'zod';
import { canonicalJson, sha256 } from '@paul-os/runtime';
import { appendAuditEvent } from '../audit.js';
import { hasMinimumRole } from '../authorization.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { currentRequestContext, currentRequestPrincipal } from '../request-context.js';
import { aggregateScope, aggregateScopeWhere } from '../scope.js';
import { requireHumanActor } from './actors.js';
import {
  safeAttentionLabel,
  subjectFromNamedVersion,
  subjectFromRelease,
  subjectFromResourceVersion,
  subjectFromRun,
  type AttentionSubject,
} from './attention-subject.js';
import {
  executionApprovalInclude,
  groupExecutionApprovals,
  type ExecutionApprovalGroup,
  type ExecutionApprovalRecord,
} from './execution-approval-groups.js';
import { learningDecisionGroupKey } from './learning-decision-groups.js';
import {
  isQuarantinedTestIdentity,
  quarantinedActorPredicates,
  userFacingExecutionRunWhere,
  userFacingImprovementCandidateWhere,
  userFacingMemoryCandidateWhere,
  userFacingObservationWhere,
  userFacingPluginInstallationWhere,
  userFacingReleaseBundleWhere,
  userFacingResourceVersionWhere,
} from './user-facing-records.js';

const stringArraySchema = z.array(z.string());
const MAX_DIGEST_EVENTS = 250;
const MAX_PENDING_ATTENTION_DECISIONS = 250;

const attentionRunInclude = {
  entryResourceVersion: { include: { family: true } },
  release: {
    include: {
      resources: { include: { resourceVersion: { include: { family: true } } } },
    },
  },
} satisfies Prisma.ExecutionRunInclude;

const attentionReleaseEvaluationInclude = {
  release: {
    include: {
      resources: { include: { resourceVersion: { include: { family: true } } } },
    },
  },
} satisfies Prisma.ReleaseEvaluationInclude;

const attentionMemoryInclude = {
  sourceRun: { include: attentionRunInclude },
} satisfies Prisma.MemoryCandidateInclude;

const attentionImprovementInclude = {
  observation: {
    include: { sourceRun: { include: attentionRunInclude } },
  },
} satisfies Prisma.ImprovementCandidateInclude;

type AttentionRunRecord = Prisma.ExecutionRunGetPayload<{ include: typeof attentionRunInclude }>;
type AttentionReleaseEvaluationRecord = Prisma.ReleaseEvaluationGetPayload<{
  include: typeof attentionReleaseEvaluationInclude;
}>;
type AttentionMemoryRecord = Prisma.MemoryCandidateGetPayload<{
  include: typeof attentionMemoryInclude;
}>;
type AttentionImprovementRecord = Prisma.ImprovementCandidateGetPayload<{
  include: typeof attentionImprovementInclude;
}>;

interface AttentionDecisionGroup<T> {
  representative: T;
  members: T[];
  requestCount: number;
  decisionGroupKey: string | null;
}

type AttentionMembershipRecord = AttentionMembership['records'][number];

function exactMembership(records: AttentionMembershipRecord[]): AttentionMembership | null {
  if (records.length <= 1) return null;
  return attentionMembershipSchema.parse({ exactCount: records.length, records });
}

function membershipFromItem(item: AttentionItem): AttentionMembership | null {
  const candidate = item.payload.metadata['membership'];
  if (candidate === undefined || candidate === null) return null;
  return attentionMembershipSchema.parse(candidate);
}

function memoryDecisionKey(record: AttentionMemoryRecord): string {
  return sha256(
    canonicalJson({
      workspaceId: record.sourceRun.workspaceId,
      departmentId: record.sourceRun.departmentId,
      projectId: record.sourceRun.projectId,
      namespace: record.namespace,
      proposedValue: record.proposedValue,
    }),
  );
}

function groupedStagedMemoryCandidates(
  records: AttentionMemoryRecord[],
): AttentionDecisionGroup<AttentionMemoryRecord>[] {
  const groups = new Map<string, AttentionMemoryRecord[]>();
  for (const record of [...records].sort(
    (left, right) =>
      right.stagedAt.getTime() - left.stagedAt.getTime() || right.id.localeCompare(left.id),
  )) {
    const key = memoryDecisionKey(record);
    const members = groups.get(key) ?? [];
    members.push(record);
    groups.set(key, members);
  }
  return [...groups.values()].flatMap((members) => {
    const representative = members[0];
    return representative === undefined
      ? []
      : [
          {
            representative,
            members,
            requestCount: members.length,
            decisionGroupKey: learningDecisionGroupKey(
              'memory',
              memoryDecisionKey(representative),
              members.map(({ id }) => id),
            ),
          },
        ];
  });
}

function releaseDecisionKey(record: AttentionReleaseEvaluationRecord): string {
  return canonicalJson({
    releaseId: record.releaseId,
    corpusVersion: record.corpusVersion,
    executorKind: record.executorKind,
    executorVersion: record.executorVersion,
    evaluationMode: record.evaluationMode,
    gateScores: record.gateScores,
  });
}

function groupedCurrentReleaseEvaluations(
  pending: AttentionReleaseEvaluationRecord[],
  latestEvaluationIds: ReadonlySet<string>,
): AttentionDecisionGroup<AttentionReleaseEvaluationRecord>[] {
  const byRelease = new Map<string, AttentionReleaseEvaluationRecord[]>();
  for (const evaluation of pending) {
    const members = byRelease.get(evaluation.releaseId) ?? [];
    members.push(evaluation);
    byRelease.set(evaluation.releaseId, members);
  }
  const groups: AttentionDecisionGroup<AttentionReleaseEvaluationRecord>[] = [];
  for (const members of byRelease.values()) {
    const latest = members.find(({ id }) => latestEvaluationIds.has(id));
    if (latest === undefined) continue;
    const key = releaseDecisionKey(latest);
    groups.push({
      representative: latest,
      members: members.filter((candidate) => releaseDecisionKey(candidate) === key),
      requestCount: members.filter((candidate) => releaseDecisionKey(candidate) === key).length,
      decisionGroupKey: null,
    });
  }
  return groups;
}

function improvementDecisionKey(record: AttentionImprovementRecord): string {
  return sha256(
    canonicalJson({
      workspaceId: record.observation.workspaceId,
      departmentId: record.observation.departmentId,
      projectId: record.observation.sourceRun?.projectId ?? null,
      entryResourceVersionId: record.observation.sourceRun?.entryResourceVersionId ?? null,
      title: record.title,
      proposedTarget: record.proposedTarget,
      proposedChange: record.proposedChange,
    }),
  );
}

function groupedImprovementCandidates(
  records: AttentionImprovementRecord[],
): AttentionDecisionGroup<AttentionImprovementRecord>[] {
  const groups = new Map<string, AttentionImprovementRecord[]>();
  for (const record of [...records].sort(
    (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id),
  )) {
    const key = improvementDecisionKey(record);
    const members = groups.get(key) ?? [];
    members.push(record);
    groups.set(key, members);
  }
  return [...groups.values()].flatMap((members) => {
    const representative = members[0];
    return representative === undefined
      ? []
      : [
          {
            representative,
            members,
            requestCount: members.length,
            decisionGroupKey: learningDecisionGroupKey(
              'improvement',
              improvementDecisionKey(representative),
              members.map(({ id }) => id),
            ),
          },
        ];
  });
}

interface ImprovementTargetReference {
  kind: ResourceKind | null;
  slug: string;
  version: string | null;
  intent: 'current_base' | 'exact' | 'successor';
}

interface GovernedImprovementTarget {
  subject: AttentionSubject;
  intentLabel: string;
}

function normalizedResourceKind(value: string | undefined): ResourceKind | null {
  if (value === undefined) return null;
  const normalized = value.replace(/([a-z])([A-Z])/gu, '$1_$2').toUpperCase();
  return Object.values(ResourceKind).find((kind) => kind === normalized) ?? null;
}

function improvementTargetReference(value: string): ImprovementTargetReference | null {
  const normalized = value.trim();
  const match =
    /^(?:([A-Z][A-Za-z]+):)?([a-z0-9]+(?:-[a-z0-9]+)*)(?:@([A-Za-z0-9][A-Za-z0-9.+_-]{0,79}))?$/u.exec(
      normalized,
    );
  if (match?.[2] === undefined) return null;
  const kind = normalizedResourceKind(match[1]);
  if (match[1] !== undefined && kind === null) return null;
  const requestedVersion = match[3] ?? null;
  return {
    kind,
    slug: match[2],
    version: requestedVersion === null || requestedVersion === 'next' ? null : requestedVersion,
    intent:
      requestedVersion === 'next'
        ? 'successor'
        : requestedVersion === null
          ? 'current_base'
          : 'exact',
  };
}

function improvementTargetKey(reference: ImprovementTargetReference): string {
  return `${reference.kind ?? '*'}:${reference.slug}@${reference.intent}:${reference.version ?? ''}`;
}

type DegradedPluginRecord = Prisma.PluginInstallationGetPayload<{
  include: { pluginVersion: { include: { family: true } } };
}>;

interface PlatformEventInput {
  kind: string;
  entityType: string;
  entityId: string;
  summary: Record<string, JsonValue>;
  occurredAt?: Date;
}

interface RunEventInput {
  phase: string;
  state: string;
  message: string;
  durationMs?: number | null;
  costUsd?: number | null;
  metadata?: Record<string, JsonValue>;
  occurredAt?: Date;
}

interface DeliveryInput {
  attemptKey: string;
  state: 'delivered' | 'failed';
  briefingRunId?: string | null;
  error?: Record<string, JsonValue> | null;
}

type Transaction = Prisma.TransactionClient;

function departmentScopeKey(departmentId: string | null): string {
  return departmentId ?? 'workspace';
}

function platformEventStreamLockKey(workspaceId: string, departmentId: string | null): string {
  return `${workspaceId}:${departmentScopeKey(departmentId)}:platform-events`;
}

async function lockVisiblePlatformEventStreams(
  transaction: Transaction,
  workspaceId: string,
  departmentId: string | null,
): Promise<void> {
  const keys = [
    platformEventStreamLockKey(workspaceId, null),
    ...(departmentId === null ? [] : [platformEventStreamLockKey(workspaceId, departmentId)]),
  ].sort();
  for (const key of keys) {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }
}

function money(value: Prisma.Decimal | null): number | null {
  return value === null ? null : value.toNumber();
}

function iso(value: Date): string {
  return value.toISOString();
}

function humanizeRecorderValue(value: string): string {
  const normalized = value.replaceAll('_', ' ').replaceAll('-', ' ').trim().toLowerCase();
  return normalized.length === 0
    ? 'Recorded phase'
    : `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function itemId(kind: AttentionItem['kind'], sourceId: string): string {
  return `${kind}:${sourceId}`;
}

function runScopes(run: { requiredToolScopes: Prisma.JsonValue }): string[] {
  return parseJson(stringArraySchema, run.requiredToolScopes, 'ExecutionRun.requiredToolScopes');
}

function humanizeToolScope(scope: string): string {
  const label = scope
    .split(/[.:/_-]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' · ');
  return label.length > 0 ? label : scope;
}

const SENSITIVE_AUTHORITY_LABEL = /secret|token|password|credential|api.?key/iu;
const OPAQUE_AUTHORITY_LABEL =
  /(?:\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b[0-9a-f]{8,}\b|\b[a-z][a-z0-9+.-]*:\/\/|\burn:[^\s]+|\b[^\s@]+@[^\s@]+\.[^\s@]+|(?:^|\s)(?:[a-z]:[\\/]|\.{0,2}[\\/]|\/))/iu;

function safeAuthorityBoundaryLabel(rawValue: string, displayValue = rawValue): string | null {
  if (SENSITIVE_AUTHORITY_LABEL.test(rawValue) || OPAQUE_AUTHORITY_LABEL.test(rawValue)) {
    return null;
  }
  return safeAttentionLabel(displayValue, 220);
}

export function approvalScopePresentation(
  run: Pick<ExecutionRun, 'requiredToolScopes' | 'requiredPluginScopes'>,
): { labels: string[]; total: number } {
  const toolLabels = runScopes(run).map((scope) => ({
    raw: scope,
    safe: safeAuthorityBoundaryLabel(scope, humanizeToolScope(scope)),
  }));
  const pluginLabels = parseJson(
    z.array(runPluginRequirementSchema),
    run.requiredPluginScopes,
    'ExecutionRun.requiredPluginScopes',
  ).map(({ scopeDescription }) => ({
    raw: scopeDescription,
    safe: safeAuthorityBoundaryLabel(scopeDescription),
  }));
  const exactBoundaries = [
    ...new Map(
      [...toolLabels, ...pluginLabels].map((boundary) => [boundary.raw, boundary]),
    ).values(),
  ];
  if (exactBoundaries.length === 0) return { labels: ['Run and spend limit'], total: 1 };
  if (exactBoundaries.some(({ safe }) => safe === null)) {
    return {
      labels: [
        exactBoundaries.length === 1
          ? 'One exact authority boundary'
          : `${exactBoundaries.length} exact authority boundaries`,
      ],
      total: exactBoundaries.length,
    };
  }
  const safeLabels = exactBoundaries.map(({ safe }) => safe as string);
  if (safeLabels.length <= 4) return { labels: safeLabels, total: safeLabels.length };
  return {
    labels: [...safeLabels.slice(0, 3), `${safeLabels.length - 3} more exact boundaries in review`],
    total: safeLabels.length,
  };
}

function boundedHeadline(value: string): string {
  return value.length <= 160 ? value : `${value.slice(0, 159)}…`;
}

function eventDetails(value: Prisma.JsonValue, label: string): Record<string, JsonValue> {
  return parseJson(jsonObjectSchema, value, label);
}

function redactReviewValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactReviewValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        /secret|token|password|credential|api.?key/i.test(key)
          ? '[redacted]'
          : redactReviewValue(nested),
      ]),
    );
  }
  return value;
}

function boundedReviewValue(value: unknown): string {
  const normalized = redactReviewValue(value);
  const text = typeof normalized === 'string' ? normalized : JSON.stringify(normalized);
  return text.length <= 500 ? text : `${text.slice(0, 499)}…`;
}

export async function appendPlatformEvent(
  transaction: Transaction,
  input: PlatformEventInput,
): Promise<string> {
  const context = currentRequestContext();
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${platformEventStreamLockKey(
    context.principal.workspaceId,
    context.principal.departmentId,
  )}))`;
  const created = await transaction.platformEvent.create({
    data: {
      ...aggregateScope(context.principal),
      kind: input.kind,
      entityType: input.entityType,
      entityId: input.entityId,
      summary: toPrismaJson(
        jsonObjectSchema,
        input.summary,
        `PlatformEvent(${input.kind}).summary`,
      ),
      actorId: context.principal.actorId,
      requestId: context.principal.requestId,
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    },
  });
  return created.id;
}

export async function appendExecutionRunEvent(
  transaction: Transaction,
  run: Pick<ExecutionRun, 'id' | 'workspaceId' | 'departmentId'>,
  input: RunEventInput,
): Promise<ExecutionRunEvent> {
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${run.id + ':events'}))`;
  const latest = await transaction.executionRunEvent.aggregate({
    where: { runId: run.id },
    _max: { sequence: true },
  });
  const record = await transaction.executionRunEvent.create({
    data: {
      workspaceId: run.workspaceId,
      departmentId: run.departmentId,
      runId: run.id,
      sequence: (latest._max.sequence ?? 0) + 1,
      phase: input.phase,
      state: input.state,
      message: input.message,
      durationMs: input.durationMs ?? null,
      costUsd: input.costUsd ?? null,
      metadata: toPrismaJson(
        jsonObjectSchema,
        input.metadata ?? {},
        `ExecutionRunEvent(${input.phase}).metadata`,
      ),
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    },
  });
  return executionRunEventSchema.parse({
    ...record,
    costUsd: money(record.costUsd),
    occurredAt: iso(record.occurredAt),
  });
}

export async function recordDigestDeliveryForRun(
  transaction: Transaction,
  run: Pick<ExecutionRun, 'id' | 'workspaceId' | 'departmentId' | 'digestSnapshotId'>,
  input: { state: 'delivered'; costUsd: number } | { state: 'failed'; code: string },
): Promise<void> {
  if (run.digestSnapshotId === null) return;
  const snapshot = await transaction.digestSnapshot.findUnique({
    where: { id: run.digestSnapshotId },
    include: { attempts: true },
  });
  if (
    snapshot === null ||
    snapshot.workspaceId !== run.workspaceId ||
    snapshot.departmentId !== run.departmentId
  ) {
    throw new AppError(
      409,
      'DIGEST_SCOPE_MISMATCH',
      'The run digest snapshot does not match its execution scope',
    );
  }
  const targetState =
    input.state === 'delivered'
      ? DigestDeliveryAttemptState.DELIVERED
      : DigestDeliveryAttemptState.FAILED;
  const attemptKey = `briefing:${run.id}:${input.state}`;
  if (input.state === 'delivered') {
    const lockKey = `${run.workspaceId}:${snapshot.departmentScopeKey}:${snapshot.actorId}:attention-cursor`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const cursor = await transaction.attentionCursor.findUnique({
      where: {
        workspaceId_departmentScopeKey_actorId: {
          workspaceId: run.workspaceId,
          departmentScopeKey: snapshot.departmentScopeKey,
          actorId: snapshot.actorId,
        },
      },
    });
    if (cursor === null) {
      throw new AppError(409, 'DIGEST_CURSOR_MISSING', 'The digest delivery cursor is unavailable');
    }
    if (snapshot.eventSequenceFrom <= cursor.lastDeliveredEventSequence) {
      return;
    }
  }
  const existing = snapshot.attempts.find((attempt) => attempt.attemptKey === attemptKey);
  if (existing === undefined) {
    const delivered = snapshot.attempts.some(
      ({ state }) => state === DigestDeliveryAttemptState.DELIVERED,
    );
    if (!delivered || input.state !== 'delivered') {
      await transaction.digestDeliveryAttempt.create({
        data: {
          workspaceId: run.workspaceId,
          departmentId: run.departmentId,
          snapshotId: snapshot.id,
          attemptKey,
          state: targetState,
          briefingRunId: run.id,
          ...(input.state === 'failed'
            ? {
                error: toPrismaJson(
                  jsonObjectSchema,
                  { code: input.code },
                  'DigestDeliveryAttempt.error',
                ),
              }
            : {}),
          deliveredAt: input.state === 'delivered' ? new Date() : null,
        },
      });
    }
  }
  if (input.state === 'delivered') {
    const lockKey = `${run.workspaceId}:${snapshot.departmentScopeKey}:${snapshot.actorId}:attention-cursor`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    await transaction.attentionCursor.updateMany({
      where: {
        workspaceId: run.workspaceId,
        departmentScopeKey: snapshot.departmentScopeKey,
        actorId: snapshot.actorId,
        lastDeliveredEventSequence: { lt: snapshot.eventSequenceThrough },
      },
      data: {
        lastDeliveredEventSequence: snapshot.eventSequenceThrough,
        lastDeliveredAt: new Date(),
      },
    });
  }
}

function digestEventLine(record: { kind: string; summary: Prisma.JsonValue }): string {
  const summary = eventDetails(record.summary, `PlatformEvent(${record.kind}).summary`);
  const cost = summary['costUsd'];
  const safeCost =
    typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? `$${cost.toFixed(2)}` : null;
  const safeLabel = (value: unknown) =>
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9 .:_/-]{0,79}$/.test(value.trim())
      ? value.trim().replaceAll('_', ' ')
      : null;
  switch (record.kind) {
    case 'execution.succeeded':
      return safeCost === null
        ? 'A run completed successfully.'
        : typeof summary['qualityScore'] === 'number' &&
            Number.isFinite(summary['qualityScore']) &&
            summary['qualityScore'] >= 0 &&
            summary['qualityScore'] <= 1
          ? `A run completed for ${safeCost} with ${Math.round(summary['qualityScore'] * 100)}% recorded quality.`
          : `A run completed for ${safeCost}.`;
    case 'execution.failed':
      return safeCost === null
        ? 'A run failed before producing an outcome.'
        : `A run failed after incurring ${safeCost}.`;
    case 'execution.cancelled':
      return safeCost === null
        ? 'A run was cancelled before producing an outcome.'
        : `A run was cancelled after incurring ${safeCost}.`;
    case 'execution.rejected':
      return 'A human rejected a requested run.';
    case 'release.promoted':
      return safeLabel(summary['channelKey']) === null
        ? 'A certified release moved into production.'
        : `A certified release moved into the ${safeLabel(summary['channelKey'])} channel.`;
    case 'release.rolled_back':
      return 'Production returned to a prior certified release.';
    case 'release.declined':
      return safeLabel(summary['channelKey']) === null
        ? 'A human declined a release promotion.'
        : `A human declined a release for the ${safeLabel(summary['channelKey'])} channel.`;
    case 'observation.created':
      return safeLabel(summary['signalType']) === null
        ? 'A new improvement observation was recorded.'
        : `A ${safeLabel(summary['signalType'])} observation was recorded.`;
    case 'improvement.proposed':
      return safeLabel(summary['proposedTarget']) === null
        ? 'A new improvement candidate awaits review.'
        : `A new improvement candidate for ${safeLabel(summary['proposedTarget'])} awaits review.`;
    case 'attention.resolved':
      return 'A reviewed issue was cleared from Attention.';
    default:
      return 'Platform activity was recorded.';
  }
}

export function summarizePlatformEventsForDigest(
  records: ReadonlyArray<{
    kind: string;
    entityId: string;
    summary: Prisma.JsonValue;
    occurredAt: Date;
  }>,
  windowStartedAt: Date | null,
  windowEndedAt: Date,
  sourceEventCount = records.length,
) {
  if (records.length > MAX_DIGEST_EVENTS) {
    throw new AppError(
      422,
      'DIGEST_EVENT_LIMIT_EXCEEDED',
      `The digest contains more than ${MAX_DIGEST_EVENTS} events and cannot be delivered without omission`,
    );
  }
  const summary = summarizePlatformEventCounts(records, windowStartedAt, windowEndedAt);
  return digestSnapshotSummarySchema.parse({
    ...summary,
    eventCount: records.length,
    eventLines: records.map(digestEventLine),
    omittedEventCount: Math.max(0, sourceEventCount - records.length),
  });
}

function summarizePlatformEventCounts(
  records: ReadonlyArray<{
    kind: string;
    entityId: string;
    summary: Prisma.JsonValue;
  }>,
  windowStartedAt: Date | null,
  windowEndedAt: Date,
) {
  const runIds = new Set<string>();
  let totalCostUsd = 0;
  let promotionCount = 0;
  let observationCount = 0;
  for (const record of records) {
    const summary = eventDetails(record.summary, `PlatformEvent(${record.kind}).summary`);
    if (record.kind.startsWith('execution.')) runIds.add(record.entityId);
    if (record.kind === 'release.promoted') promotionCount += 1;
    if (record.kind === 'observation.created') observationCount += 1;
    const candidateCost = summary['costUsd'];
    if (typeof candidateCost === 'number' && Number.isFinite(candidateCost)) {
      totalCostUsd += candidateCost;
    }
  }
  const headline =
    records.length === 0
      ? 'No new activity is waiting for the next briefing.'
      : `${runIds.size} runs · $${totalCostUsd.toFixed(2)} · ${promotionCount} promotions since the last briefing`;
  return digestSummarySchema.parse({
    headline,
    runCount: runIds.size,
    totalCostUsd,
    promotionCount,
    observationCount,
    windowStartedAt: windowStartedAt?.toISOString() ?? null,
    windowEndedAt: windowEndedAt.toISOString(),
  });
}

type DigestPlatformEvent = {
  kind: string;
  entityType: string;
  entityId: string;
};

const uuidValue = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

async function userFacingDigestEvents<T extends DigestPlatformEvent>(
  prisma: PrismaClient | Prisma.TransactionClient,
  records: readonly T[],
  scope: ReturnType<typeof aggregateScopeWhere>,
): Promise<T[]> {
  const idsFor = (entityType: string) =>
    records
      .filter((record) => record.entityType === entityType && uuidValue.test(record.entityId))
      .map(({ entityId }) => entityId);
  const runIds = idsFor('ExecutionRun');
  const resolutionRunByItemId = new Map<string, string>();
  for (const record of records) {
    if (record.kind !== 'attention.resolved' || record.entityType !== 'AttentionItem') continue;
    const match = /^stalled_run:([0-9a-f-]+)$/iu.exec(record.entityId);
    if (match?.[1] !== undefined && uuidValue.test(match[1])) {
      resolutionRunByItemId.set(record.entityId, match[1]);
    }
  }
  const allRunIds = [...new Set([...runIds, ...resolutionRunByItemId.values()])];
  const observationIds = idsFor('Observation');
  const releaseIds = idsFor('ReleaseBundle');
  const evaluationIds = idsFor('ReleaseEvaluation');
  const pluginIds = idsFor('PluginInstallation');
  const publicationIds = idsFor('CatalogPublication');
  const improvementIds = idsFor('ImprovementCandidate');
  const [runs, observations, releases, evaluations, plugins, publications, improvements] =
    await Promise.all([
      allRunIds.length === 0
        ? []
        : prisma.executionRun.findMany({
            where: { AND: [scope, userFacingExecutionRunWhere, { id: { in: allRunIds } }] },
            select: { id: true, state: true },
          }),
      observationIds.length === 0
        ? []
        : prisma.observation.findMany({
            where: { AND: [scope, userFacingObservationWhere, { id: { in: observationIds } }] },
            select: { id: true },
          }),
      releaseIds.length === 0
        ? []
        : prisma.releaseBundle.findMany({
            where: { AND: [scope, userFacingReleaseBundleWhere, { id: { in: releaseIds } }] },
            select: { id: true },
          }),
      evaluationIds.length === 0
        ? []
        : prisma.releaseEvaluation.findMany({
            where: {
              AND: [
                { id: { in: evaluationIds } },
                { release: { is: { AND: [scope, userFacingReleaseBundleWhere] } } },
              ],
            },
            select: { id: true },
          }),
      pluginIds.length === 0
        ? []
        : prisma.pluginInstallation.findMany({
            where: { AND: [scope, userFacingPluginInstallationWhere, { id: { in: pluginIds } }] },
            select: { id: true },
          }),
      publicationIds.length === 0
        ? []
        : prisma.catalogPublication.findMany({
            where: {
              AND: [
                scope,
                { resourceVersion: { is: userFacingResourceVersionWhere } },
                { id: { in: publicationIds } },
              ],
            },
            select: { id: true },
          }),
      improvementIds.length === 0
        ? []
        : prisma.improvementCandidate.findMany({
            where: {
              AND: [
                userFacingImprovementCandidateWhere,
                { observation: scope },
                { id: { in: improvementIds } },
              ],
            },
            select: { id: true },
          }),
    ]);
  const visible = new Set<string>([
    ...runs.map(({ id }) => `ExecutionRun:${id}`),
    ...observations.map(({ id }) => `Observation:${id}`),
    ...releases.map(({ id }) => `ReleaseBundle:${id}`),
    ...evaluations.map(({ id }) => `ReleaseEvaluation:${id}`),
    ...plugins.map(({ id }) => `PluginInstallation:${id}`),
    ...publications.map(({ id }) => `CatalogPublication:${id}`),
    ...improvements.map(({ id }) => `ImprovementCandidate:${id}`),
  ]);
  const runStateById = new Map(runs.map(({ id, state }) => [id, state]));
  for (const [attentionItemId, runId] of resolutionRunByItemId) {
    if (runStateById.get(runId) === ExecutionRunState.FAILED) {
      visible.add(`AttentionItem:${attentionItemId}`);
    }
  }
  return records.filter(({ entityType, entityId }) => visible.has(`${entityType}:${entityId}`));
}

function digestState(attempts: readonly DigestDeliveryAttempt[]) {
  const delivered = attempts.find(
    (attempt) => attempt.state === DigestDeliveryAttemptState.DELIVERED,
  );
  if (delivered !== undefined) return { state: 'delivered' as const, attempt: delivered };
  const failed = attempts.find((attempt) => attempt.state === DigestDeliveryAttemptState.FAILED);
  return failed === undefined
    ? { state: 'pending' as const, attempt: null }
    : { state: 'failed' as const, attempt: failed };
}

function toDigestSnapshot(
  record: DigestSnapshotRecord & { attempts: DigestDeliveryAttempt[] },
): DigestSnapshot {
  const delivery = digestState(record.attempts);
  return digestSnapshotSchema.parse({
    id: record.id,
    windowStartedAt: iso(record.windowStartedAt),
    windowEndedAt: iso(record.windowEndedAt),
    eventSequenceThrough: record.eventSequenceThrough.toString(),
    summary: eventDetails(record.summary, 'DigestSnapshot.summary'),
    state: delivery.state,
    briefingRunId: delivery.attempt?.briefingRunId ?? null,
    deliveredAt: delivery.attempt?.deliveredAt?.toISOString() ?? null,
    createdAt: iso(record.createdAt),
  });
}

export class AttentionService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<AttentionResponse> {
    const now = new Date();
    const scope = aggregateScopeWhere();
    const principal = currentRequestPrincipal();
    const canGovernRelease =
      hasMinimumRole(principal, 'owner') &&
      (principal.departmentId !== null || hasMinimumRole(principal, 'admin'));
    const governedReleaseScope = {
      workspaceId: principal.workspaceId,
      departmentId: principal.departmentId,
      ...(canGovernRelease ? {} : { id: { in: [] as string[] } }),
    };
    const cursor = await this.prisma.attentionCursor.findFirst({
      where: {
        workspaceId: principal.workspaceId,
        departmentScopeKey: departmentScopeKey(principal.departmentId),
        actorId: principal.actorId,
      },
    });
    const [
      approvals,
      evaluations,
      memory,
      improvements,
      degradedRuns,
      degradedPlugins,
      resolutions,
      events,
    ] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where: {
          state: ApprovalRequestState.PENDING,
          NOT: quarantinedActorPredicates('requestedBy'),
          run: {
            AND: [
              scope,
              userFacingExecutionRunWhere,
              { state: ExecutionRunState.AWAITING_APPROVAL },
            ],
          },
        },
        include: executionApprovalInclude,
        orderBy: { createdAt: 'asc' },
        take: MAX_PENDING_ATTENTION_DECISIONS + 1,
      }),
      this.prisma.releaseEvaluation.findMany({
        where: {
          verdict: ReleaseEvaluationVerdict.PASSED,
          release: {
            AND: [
              governedReleaseScope,
              userFacingReleaseBundleWhere,
              { activeChannels: { none: {} } },
            ],
          },
          promotionDecisions: { none: {} },
          declineDecisions: { none: {} },
        },
        include: attentionReleaseEvaluationInclude,
        orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
        take: MAX_PENDING_ATTENTION_DECISIONS + 1,
      }),
      this.prisma.memoryCandidate.findMany({
        where: {
          AND: [
            userFacingMemoryCandidateWhere,
            { state: MemoryCandidateState.STAGED, sourceRun: scope },
          ],
        },
        include: attentionMemoryInclude,
        orderBy: [{ stagedAt: 'desc' }, { id: 'desc' }],
        take: MAX_PENDING_ATTENTION_DECISIONS + 1,
      }),
      this.prisma.improvementCandidate.findMany({
        where: {
          AND: [
            userFacingImprovementCandidateWhere,
            { state: ImprovementCandidateState.PROPOSED, observation: scope },
          ],
        },
        include: attentionImprovementInclude,
        orderBy: { createdAt: 'asc' },
        take: MAX_PENDING_ATTENTION_DECISIONS + 1,
      }),
      this.prisma.executionRun.findMany({
        where: {
          AND: [
            scope,
            userFacingExecutionRunWhere,
            {
              OR: [
                { state: ExecutionRunState.FAILED },
                { state: ExecutionRunState.PAUSED_BUDGET },
                { state: ExecutionRunState.PAUSED_PLUGIN },
                {
                  state: ExecutionRunState.RUNNING,
                  leaseExpiresAt: { lt: now },
                },
              ],
            },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        include: attentionRunInclude,
      }),
      this.prisma.pluginInstallation.findMany({
        where: {
          AND: [
            scope,
            userFacingPluginInstallationWhere,
            {
              state: {
                in: [PluginInstallationState.DEGRADED, PluginInstallationState.DISABLED],
              },
            },
          ],
        },
        include: { pluginVersion: { include: { family: true } } },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      this.prisma.attentionResolution.findMany({
        where: {
          workspaceId: principal.workspaceId,
          departmentScopeKey: departmentScopeKey(principal.departmentId),
        },
        select: { itemId: true },
      }),
      this.prisma.platformEvent.findMany({
        where: {
          ...scope,
          sequence: { gt: cursor?.lastDeliveredEventSequence ?? 0n },
          occurredAt: { lte: now },
        },
        orderBy: { sequence: 'asc' },
      }),
    ]);

    if (
      approvals.length > MAX_PENDING_ATTENTION_DECISIONS ||
      evaluations.length > MAX_PENDING_ATTENTION_DECISIONS ||
      memory.length > MAX_PENDING_ATTENTION_DECISIONS ||
      improvements.length > MAX_PENDING_ATTENTION_DECISIONS
    ) {
      throw new AppError(
        503,
        'ATTENTION_QUEUE_LIMIT_EXCEEDED',
        'The governed decision queue exceeds its safe review limit',
      );
    }
    const latestReleaseEvaluationIds = new Set(
      (
        await Promise.all(
          [...new Set(evaluations.map(({ releaseId }) => releaseId))].map((releaseId) =>
            this.prisma.releaseEvaluation.findFirst({
              where: { releaseId },
              select: { id: true },
              orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
            }),
          ),
        )
      )
        .filter((record): record is { id: string } => record !== null)
        .map(({ id }) => id),
    );
    const eligibleEvaluations = evaluations.filter(
      ({ release }) =>
        release.resources.length > 0 &&
        release.resources.every(
          ({ resourceVersion }) =>
            resourceVersion.lifecycle === 'CERTIFIED' &&
            /^[a-f0-9]{7,64}$/i.test(resourceVersion.sourceCommit) &&
            ![
              resourceVersion.sourceCommit,
              resourceVersion.createdBy,
              resourceVersion.updatedBy,
              resourceVersion.family.createdBy,
              resourceVersion.family.updatedBy,
            ].some(isQuarantinedTestIdentity),
        ),
    );
    const releaseGroups = groupedCurrentReleaseEvaluations(
      eligibleEvaluations,
      latestReleaseEvaluationIds,
    );
    const improvementGroups = groupedImprovementCandidates(improvements);
    const targetReferences = [
      ...new Map(
        improvementGroups.flatMap(({ representative }) => {
          const reference = improvementTargetReference(representative.proposedTarget);
          return reference === null ? [] : [[improvementTargetKey(reference), reference] as const];
        }),
      ).values(),
    ];
    const governedTargetVersions =
      targetReferences.length === 0
        ? []
        : await this.prisma.resourceVersion.findMany({
            where: {
              AND: [
                userFacingResourceVersionWhere,
                {
                  lifecycle: ResourceLifecycle.CERTIFIED,
                  OR: targetReferences.map((reference) => ({
                    ...(reference.version === null ? {} : { version: reference.version }),
                    family: {
                      ...scope,
                      slug: reference.slug,
                      ...(reference.kind === null ? {} : { kind: reference.kind }),
                    },
                  })),
                },
              ],
            },
            include: { family: true },
            orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
            take: MAX_PENDING_ATTENTION_DECISIONS + 1,
          });
    const governedTargetByKey = new Map<string, GovernedImprovementTarget | null>();
    for (const reference of targetReferences) {
      const matches = governedTargetVersions.filter(
        ({ family, version }) =>
          family.slug === reference.slug &&
          (reference.kind === null || family.kind === reference.kind) &&
          (reference.version === null || version === reference.version),
      );
      const familyIds = new Set(matches.map(({ familyId }) => familyId));
      const baseSubject =
        familyIds.size === 1 ? subjectFromResourceVersion(matches[0] ?? null) : null;
      governedTargetByKey.set(
        improvementTargetKey(reference),
        baseSubject === null
          ? null
          : {
              subject: baseSubject,
              intentLabel:
                reference.intent === 'exact'
                  ? `Exact governed version ${baseSubject.version}`
                  : reference.intent === 'successor'
                    ? `Successor to governed version ${baseSubject.version}`
                    : `Current governed base ${baseSubject.version}`,
            },
      );
    }

    const approvalGroups = groupExecutionApprovals(approvals);
    const adminRequiredApprovalGroups = approvalGroups.filter(({ approvals: members }) => {
      const groupDepartmentId = members[0]?.run.departmentId;
      return (
        groupDepartmentId === null &&
        (principal.departmentId !== null || !hasMinimumRole(principal, 'admin'))
      );
    });
    const actionableApprovalGroups = approvalGroups.filter(
      (group) => !adminRequiredApprovalGroups.includes(group),
    );
    const unresolvedApprovals = approvals.filter(
      ({ run }) => subjectFromResourceVersion(run.entryResourceVersion) === null,
    );
    const projectedDecisions: AttentionItem[] = [
      ...actionableApprovalGroups.map((group) => this.executionApprovalItem(group)),
      ...releaseGroups.map((group) => this.releasePromotionItem(group)),
      ...groupedStagedMemoryCandidates(memory).map((group) => this.memoryItem(group)),
      ...improvementGroups.map((group) => {
        const reference = improvementTargetReference(group.representative.proposedTarget);
        return this.improvementItem(
          group,
          reference === null
            ? null
            : (governedTargetByKey.get(improvementTargetKey(reference)) ?? null),
        );
      }),
    ];
    const decide = projectedDecisions.filter(({ shelf }) => shelf === 'decide');
    const decisionSafetyStops = projectedDecisions.filter(({ shelf }) => shelf === 'degraded');
    const resolvedIds = new Set(resolutions.map(({ itemId: resolvedItemId }) => resolvedItemId));
    const degraded = [
      ...decisionSafetyStops,
      ...adminRequiredApprovalGroups.map((group) => this.adminRequiredExecutionApprovalItem(group)),
      ...unresolvedApprovals.map((approval) => this.unresolvedExecutionApprovalItem(approval)),
      ...degradedPlugins.map((installation) => this.degradedPluginItem(installation)),
      ...degradedRuns
        .map((run) => this.degradedRunItem(run, now))
        .filter(
          ({ id: degradedItemId, payload }) =>
            payload.metadata['state'] !== 'failed' || !resolvedIds.has(degradedItemId),
        ),
    ];
    const digestEvents = await userFacingDigestEvents(this.prisma, events, scope);
    const digest = summarizePlatformEventCounts(digestEvents, cursor?.lastDeliveredAt ?? null, now);
    return attentionResponseSchema.parse({
      generatedAt: now.toISOString(),
      decide,
      degraded,
      digest,
      decideBadgeCount: decide.length,
      lastDeliveredBriefingAt: cursor?.lastDeliveredAt?.toISOString() ?? null,
    });
  }

  async getItem(id: string): Promise<AttentionItemDetail> {
    const response = await this.list();
    const item = [...response.decide, ...response.degraded].find(
      (candidate) => candidate.id === id,
    );
    if (item === undefined) {
      throw new AppError(404, 'ATTENTION_ITEM_NOT_FOUND', 'Attention item was not found');
    }
    const membership = membershipFromItem(item);
    if (item.payload.runId !== null) {
      const run = await this.prisma.executionRun.findFirst({
        where: { id: item.payload.runId, ...aggregateScopeWhere() },
        include: {
          events: { orderBy: { sequence: 'asc' } },
          steps: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (run === null) {
        throw new AppError(404, 'EXECUTION_RUN_NOT_FOUND', 'Execution run was not found');
      }
      const recordedEventStates = new Set(
        run.events.map(({ phase, state }) => `${phase}\u0000${state.toLowerCase()}`),
      );
      const timeline = [
        ...run.events.map((event) => ({
          id: event.id,
          phase: event.phase,
          state: event.state,
          message: event.message,
          durationMs: event.durationMs,
          costUsd: money(event.costUsd),
          occurredAt: iso(event.occurredAt),
        })),
        ...run.steps
          .filter(
            ({ stepKey, state }) =>
              !recordedEventStates.has(`${stepKey}\u0000${state.toLowerCase()}`),
          )
          .map((step) => ({
            id: step.id,
            phase: step.stepKey,
            state: step.state,
            message: `${humanizeRecorderValue(step.stepKey)} ${humanizeRecorderValue(step.state).toLowerCase()}.`,
            durationMs: null,
            costUsd: null,
            occurredAt: iso(step.createdAt),
          })),
      ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
      return attentionItemDetailSchema.parse({
        item,
        timeline,
        membership,
        details: {
          runId: run.id,
          state: run.state.toLowerCase(),
          releaseId: run.releaseId,
          releaseDigest: run.releaseDigest,
          progress: run.progress,
          message: run.message,
          requiredScopes: runScopes(run),
          estimatedUpperCostUsd: run.estimatedUpperCostUsd.toNumber(),
          actualCostUsd: money(run.actualCostUsd),
        },
      });
    }
    return attentionItemDetailSchema.parse({
      item,
      timeline: [],
      membership,
      details: item.payload.metadata,
    });
  }

  async createDigestSnapshot(): Promise<DigestSnapshot> {
    const principal = currentRequestPrincipal();
    return this.createDigestSnapshotForActor(principal.actorId);
  }

  async createDigestSnapshotForActor(actorId: string): Promise<DigestSnapshot> {
    const principal = currentRequestPrincipal();
    if (principal.authentication !== 'system' && principal.actorId !== actorId) {
      throw new AppError(
        403,
        'ACTOR_SCOPE_MISMATCH',
        'A human actor can create only their own digest snapshot',
      );
    }
    const scope = aggregateScope();
    const scopeKey = departmentScopeKey(scope.departmentId);
    const record = await this.prisma.$transaction(
      async (transaction) => {
        const lockKey = `${scope.workspaceId}:${scopeKey}:${actorId}:attention-digest`;
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        await lockVisiblePlatformEventStreams(transaction, scope.workspaceId, scope.departmentId);
        const cursor = await transaction.attentionCursor.upsert({
          where: {
            workspaceId_departmentScopeKey_actorId: {
              workspaceId: scope.workspaceId,
              departmentScopeKey: scopeKey,
              actorId,
            },
          },
          update: {},
          create: { ...scope, departmentScopeKey: scopeKey, actorId },
        });
        const pending = await transaction.digestSnapshot.findFirst({
          where: {
            workspaceId: scope.workspaceId,
            departmentScopeKey: scopeKey,
            actorId,
            eventSequenceFrom: { gt: cursor.lastDeliveredEventSequence },
            attempts: { none: { state: DigestDeliveryAttemptState.DELIVERED } },
          },
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
          orderBy: { createdAt: 'asc' },
        });
        if (pending !== null) return pending;
        // The cursor is a sequence high-water mark, so every snapshot must cover a
        // contiguous visible prefix. Filtering by occurredAt could skip a lower
        // sequence forever when event timestamps arrive out of order.
        const events = await transaction.platformEvent.findMany({
          where: {
            ...aggregateScopeWhere(),
            sequence: { gt: cursor.lastDeliveredEventSequence },
          },
          orderBy: { sequence: 'asc' },
          take: MAX_DIGEST_EVENTS,
        });
        if (events.length === 0) {
          throw new AppError(409, 'DIGEST_WINDOW_EMPTY', 'No new platform events need delivery');
        }
        const first = events[0];
        const last = events.at(-1);
        if (first === undefined || last === undefined) {
          throw new AppError(500, 'INTERNAL_ERROR', 'Digest sequence window is unavailable');
        }
        const eventTimes = events.map(({ occurredAt }) => occurredAt.getTime());
        const windowStartedAt = new Date(Math.min(...eventTimes));
        const windowEndedAt = new Date(Math.max(...eventTimes));
        const visibleEvents = await userFacingDigestEvents(
          transaction,
          events,
          aggregateScopeWhere(),
        );
        const summary = summarizePlatformEventsForDigest(
          visibleEvents,
          windowStartedAt,
          windowEndedAt,
          events.length,
        );
        return transaction.digestSnapshot.upsert({
          where: {
            workspaceId_departmentScopeKey_actorId_eventSequenceFrom_eventSequenceThrough: {
              workspaceId: scope.workspaceId,
              departmentScopeKey: scopeKey,
              actorId,
              eventSequenceFrom: first.sequence,
              eventSequenceThrough: last.sequence,
            },
          },
          update: {},
          create: {
            ...scope,
            departmentScopeKey: scopeKey,
            actorId,
            windowStartedAt,
            windowEndedAt,
            eventSequenceFrom: first.sequence,
            eventSequenceThrough: last.sequence,
            summary: toPrismaJson(jsonObjectSchema, summary, 'DigestSnapshot.summary'),
          },
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );
    return toDigestSnapshot(record);
  }

  async recordDigestDelivery(snapshotId: string, input: DeliveryInput): Promise<DigestSnapshot> {
    const principal = currentRequestPrincipal();
    const record = await this.prisma.$transaction(
      async (transaction) => {
        const snapshot = await transaction.digestSnapshot.findFirst({
          where: { id: snapshotId, ...aggregateScopeWhere() },
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
        });
        if (snapshot === null) {
          throw new AppError(404, 'DIGEST_SNAPSHOT_NOT_FOUND', 'Digest snapshot was not found');
        }
        if (snapshot.actorId !== principal.actorId && principal.authentication !== 'system') {
          throw new AppError(404, 'DIGEST_SNAPSHOT_NOT_FOUND', 'Digest snapshot was not found');
        }
        const existingAttempt = snapshot.attempts.find(
          (attempt) => attempt.attemptKey === input.attemptKey,
        );
        if (existingAttempt !== undefined) {
          if (
            existingAttempt.state !==
              (input.state === 'delivered'
                ? DigestDeliveryAttemptState.DELIVERED
                : DigestDeliveryAttemptState.FAILED) ||
            existingAttempt.briefingRunId !== (input.briefingRunId ?? null)
          ) {
            throw new AppError(
              409,
              'IDEMPOTENCY_KEY_REUSED',
              'Digest attempt key is bound to a different delivery result',
            );
          }
          return snapshot;
        }
        const alreadyDelivered = snapshot.attempts.find(
          ({ state }) => state === DigestDeliveryAttemptState.DELIVERED,
        );
        if (alreadyDelivered !== undefined && input.state === 'delivered') return snapshot;

        if (input.state === 'delivered') {
          const lockKey = `${snapshot.workspaceId}:${snapshot.departmentScopeKey}:${snapshot.actorId}:attention-cursor`;
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
          const cursor = await transaction.attentionCursor.findUnique({
            where: {
              workspaceId_departmentScopeKey_actorId: {
                workspaceId: snapshot.workspaceId,
                departmentScopeKey: snapshot.departmentScopeKey,
                actorId: snapshot.actorId,
              },
            },
          });
          if (cursor === null) {
            throw new AppError(
              409,
              'DIGEST_CURSOR_MISSING',
              'The digest delivery cursor is unavailable',
            );
          }
          if (snapshot.eventSequenceFrom <= cursor.lastDeliveredEventSequence) {
            throw new AppError(
              409,
              'DIGEST_SNAPSHOT_SUPERSEDED',
              'A later digest delivery already covers this snapshot window',
            );
          }
        }

        await transaction.digestDeliveryAttempt.create({
          data: {
            workspaceId: snapshot.workspaceId,
            departmentId: snapshot.departmentId,
            snapshotId,
            attemptKey: input.attemptKey,
            state:
              input.state === 'delivered'
                ? DigestDeliveryAttemptState.DELIVERED
                : DigestDeliveryAttemptState.FAILED,
            briefingRunId: input.briefingRunId ?? null,
            ...(input.error === null || input.error === undefined
              ? {}
              : {
                  error: toPrismaJson(jsonObjectSchema, input.error, 'DigestDeliveryAttempt.error'),
                }),
            deliveredAt: input.state === 'delivered' ? new Date() : null,
          },
        });

        if (input.state === 'delivered') {
          const lockKey = `${snapshot.workspaceId}:${snapshot.departmentScopeKey}:${snapshot.actorId}:attention-cursor`;
          await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
          await transaction.attentionCursor.updateMany({
            where: {
              workspaceId: snapshot.workspaceId,
              departmentScopeKey: snapshot.departmentScopeKey,
              actorId: snapshot.actorId,
              lastDeliveredEventSequence: { lt: snapshot.eventSequenceThrough },
            },
            data: {
              lastDeliveredEventSequence: snapshot.eventSequenceThrough,
              lastDeliveredAt: new Date(),
            },
          });
        }
        return transaction.digestSnapshot.findUniqueOrThrow({
          where: { id: snapshot.id },
          include: { attempts: { orderBy: { createdAt: 'desc' } } },
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return toDigestSnapshot(record);
  }

  async resolveItem(
    itemIdToResolve: string,
    input: z.input<typeof resolveAttentionItemRequestSchema>,
  ) {
    const actor = requireHumanActor();
    const { rationale } = resolveAttentionItemRequestSchema.parse(input);
    const resolutionScope = aggregateScope();
    const resolutionScopeKey = departmentScopeKey(resolutionScope.departmentId);
    const queue = await this.list();
    const item = queue.degraded.find(({ id }) => id === itemIdToResolve);
    if (item === undefined) {
      const existing = await this.prisma.attentionResolution.findUnique({
        where: {
          workspaceId_departmentScopeKey_itemId: {
            workspaceId: resolutionScope.workspaceId,
            departmentScopeKey: resolutionScopeKey,
            itemId: itemIdToResolve,
          },
        },
      });
      if (existing !== null) {
        if (existing.rationale !== rationale) {
          throw new AppError(
            409,
            'ATTENTION_ITEM_ALREADY_RESOLVED',
            'This Attention resolution is immutable',
          );
        }
        return attentionResolutionSchema.parse({
          ...existing,
          resolvedAt: existing.resolvedAt.toISOString(),
        });
      }
      throw new AppError(404, 'ATTENTION_ITEM_NOT_FOUND', 'Attention item was not found');
    }
    if (item.payload.metadata['state'] !== 'failed') {
      throw new AppError(
        409,
        'ATTENTION_ITEM_NOT_TERMINAL',
        'Only a terminal failed run can be acknowledged',
      );
    }
    const created = await this.prisma.$transaction(async (transaction) => {
      const resolution = await transaction.attentionResolution.create({
        data: {
          ...resolutionScope,
          departmentScopeKey: resolutionScopeKey,
          itemId: item.id,
          rationale,
          resolvedBy: actor,
        },
      });
      await appendPlatformEvent(transaction, {
        kind: 'attention.resolved',
        entityType: 'AttentionItem',
        entityId: item.id,
        summary: { kind: item.kind },
      });
      await appendAuditEvent(transaction, {
        action: 'attention.resolved',
        entityType: 'AttentionItem',
        entityId: item.id,
        details: { kind: item.kind, rationale },
      });
      return resolution;
    });
    return attentionResolutionSchema.parse({
      ...created,
      resolvedAt: created.resolvedAt.toISOString(),
    });
  }

  private executionApprovalItem(group: ExecutionApprovalGroup): AttentionItem {
    const approval = group.approvals[0];
    if (approval === undefined) {
      throw new AppError(500, 'ATTENTION_GROUP_EMPTY', 'An authority group has no requests');
    }
    const { run } = approval;
    const scopePresentation = approvalScopePresentation(run);
    const scopes = scopePresentation.labels;
    const estimated = run.estimatedUpperCostUsd.toNumber();
    const requestCount = group.approvals.length;
    const runNoun = requestCount === 1 ? 'run' : 'runs';
    const requestLabel = requestCount === 1 ? 'one run' : `${requestCount} runs`;
    const decisionTarget = requestCount === 1 ? 'this run' : `these ${requestCount} runs`;
    const pendingTarget =
      requestCount === 1 ? 'this pending run' : `these ${requestCount} pending runs`;
    const scopeSummary =
      scopePresentation.total === 0
        ? 'No external tool access'
        : scopePresentation.total === 1
          ? scopes[0]
          : `${scopePresentation.total} exact authority boundaries`;
    const retrySummary =
      run.maxAttempts === 1
        ? 'One attempt · no automatic retry'
        : `Up to ${run.maxAttempts} total attempts · ${run.retryBackoff} backoff`;
    const membership = exactMembership(
      group.approvals.map((member, index) => ({
        label: `Authority request ${String(index + 1).padStart(2, '0')}`,
        subject: group.subject,
        occurredAt: iso(member.createdAt),
        evidence: [
          {
            label: 'Decision match',
            value: 'Exact authority, input, retry, and cost requirements match this group.',
          },
          { label: 'Current state', value: 'Pending human decision; the run remains paused.' },
        ],
        technicalReferences: [
          { label: 'Approval request', value: member.id },
          { label: 'Execution run', value: member.run.id },
        ],
      })),
    );
    return attentionItemSchema.parse({
      id: itemId('execution_approval', group.groupKey),
      kind: 'execution_approval',
      shelf: 'decide',
      headline: boundedHeadline(`${group.subject.name} wants authority for ${requestLabel}.`),
      delta: `${scopeSummary} · up to $${estimated.toFixed(2)} per run`,
      status: 'decide',
      primaryAction: {
        kind: 'approve_run',
        label: consoleActionCopy.approveRun.label,
        consequence: `Queues ${decisionTarget} under one bounded grant. Matching future runs may use it until its limits or expiry.`,
        undo: consoleActionCopy.approveRun.undo,
        resourceId: group.groupKey,
        requiresRationale: true,
      },
      secondaryAction: {
        kind: 'reject_run',
        label: consoleActionCopy.rejectRun.label,
        consequence: `Cancels ${pendingTarget} and records your reason.`,
        undo: consoleActionCopy.rejectRun.undo,
        resourceId: group.groupKey,
        requiresRationale: true,
      },
      cost: { period: 'run', usd: estimated, budgetUsd: run.maxEstimatedCostUsd.toNumber() },
      reason: `Without approval, ${group.subject.name} remains paused and performs no work for ${requestCount === 1 ? 'this request' : 'these requests'}.`,
      provenance: {
        sourceType: 'ApprovalRequestGroup',
        sourceId: group.groupKey,
        actorId: null,
        requestId: null,
        explanation: `The execution service grouped ${requestCount} exact pending ${runNoun} with the same authority requirements.`,
      },
      occurredAt: iso(approval.createdAt),
      payload: {
        sourceType: 'ApprovalRequestGroup',
        sourceId: group.groupKey,
        detailPath: `/v1/execution-runs/${run.id}`,
        scopes,
        runId: run.id,
        candidateId: null,
        channelKey: null,
        releaseId: run.releaseId,
        evaluationId: null,
        expiresAt: null,
        approvalGroupKey: group.groupKey,
        requestCount,
        subject: group.subject,
        reviewFacts: [
          {
            label: 'Subject',
            value: `${group.subject.name} · ${group.subject.kind} ${group.subject.version}`,
          },
          { label: 'Requests', value: `${requestLabel} with matching authority requirements` },
          { label: 'Authority', value: scopes.join(', ') },
          { label: 'Retry policy', value: retrySummary },
          {
            label: 'Approval changes',
            value: `Queues ${decisionTarget} under one revocable, expiring grant.`,
          },
          { label: 'Without approval', value: 'The matching runs stay paused and do no work.' },
        ],
        metadata: {
          membership,
          runIds: group.approvals.map(({ run }) => run.id),
          approvalRequestIds: group.approvals.map(({ id }) => id),
          releaseId: run.releaseId,
          releaseDigest: run.releaseDigest,
          entryResourceVersionId: run.entryResourceVersionId,
          requestedBy: group.approvals.map(({ requestedBy }) => requestedBy),
          requiredToolScopes: runScopes(run),
          requiredPluginScopes: run.requiredPluginScopes as JsonValue,
          reasons: parseJson(
            stringArraySchema,
            run.approvalReasons,
            'ExecutionRun.approvalReasons',
          ),
        },
      },
    });
  }

  private adminRequiredExecutionApprovalItem(group: ExecutionApprovalGroup): AttentionItem {
    const approval = group.approvals[0];
    if (approval === undefined) {
      throw new AppError(500, 'ATTENTION_GROUP_EMPTY', 'An authority group has no requests');
    }
    const { run } = approval;
    const scopePresentation = approvalScopePresentation(run);
    const requestCount = group.approvals.length;
    const requestLabel = requestCount === 1 ? 'One pending run' : `${requestCount} pending runs`;
    const membership = exactMembership(
      group.approvals.map((member, index) => ({
        label: `Authority request ${String(index + 1).padStart(2, '0')}`,
        subject: group.subject,
        occurredAt: iso(member.createdAt),
        evidence: [
          {
            label: 'Decision match',
            value: 'Exact authority, input, retry, and cost requirements match this group.',
          },
          { label: 'Decision owner', value: 'Workspace admin required.' },
        ],
        technicalReferences: [
          { label: 'Approval request', value: member.id },
          { label: 'Execution run', value: member.run.id },
        ],
      })),
    );
    return attentionItemSchema.parse({
      id: itemId('safety_stop', `workspace-admin:${group.groupKey}`),
      kind: 'safety_stop',
      shelf: 'degraded',
      headline: boundedHeadline(`${group.subject.name} needs workspace-admin review.`),
      delta: `${requestLabel} · workspace-global authority`,
      status: 'safety_stop',
      primaryAction: {
        kind: 'open_details',
        ...consoleActionCopy.reviewFlightRecorder,
        resourceId: run.id,
        requiresRationale: false,
      },
      secondaryAction: null,
      cost: {
        period: 'run',
        usd: run.estimatedUpperCostUsd.toNumber(),
        budgetUsd: run.maxEstimatedCostUsd.toNumber(),
      },
      reason:
        'This request is workspace-global. Only a workspace admin can grant or reject it; opening details changes nothing.',
      provenance: {
        sourceType: 'ApprovalRequestGroup',
        sourceId: group.groupKey,
        actorId: null,
        requestId: null,
        explanation:
          'The request is visible in this department but remains outside its exact mutation scope.',
      },
      occurredAt: iso(approval.createdAt),
      payload: {
        sourceType: 'ApprovalRequestGroup',
        sourceId: group.groupKey,
        detailPath: `/v1/execution-runs/${run.id}`,
        scopes: scopePresentation.labels,
        runId: run.id,
        candidateId: null,
        channelKey: null,
        releaseId: run.releaseId,
        evaluationId: null,
        expiresAt: null,
        approvalGroupKey: null,
        requestCount,
        subject: group.subject,
        reviewFacts: [
          {
            label: 'Subject',
            value: `${group.subject.name} · ${group.subject.kind} ${group.subject.version}`,
          },
          { label: 'Authority', value: scopePresentation.labels.join(', ') },
          { label: 'Decision owner', value: 'Workspace admin required' },
          { label: 'Current effect', value: 'The pending runs remain paused and do no work.' },
        ],
        metadata: {
          membership,
          adminRequired: true,
          approvalGroupKey: group.groupKey,
          runIds: group.approvals.map(({ run: memberRun }) => memberRun.id),
          approvalRequestIds: group.approvals.map(({ id }) => id),
          requiredToolScopes: runScopes(run),
          requiredPluginScopes: run.requiredPluginScopes as JsonValue,
        },
      },
    });
  }

  private unresolvedExecutionApprovalItem(approval: ExecutionApprovalRecord): AttentionItem {
    const { run } = approval;
    const estimated = run.estimatedUpperCostUsd.toNumber();
    return attentionItemSchema.parse({
      id: itemId('safety_stop', approval.id),
      kind: 'safety_stop',
      shelf: 'degraded',
      headline: 'Approval stopped: the governed subject is unavailable.',
      delta: 'Exact entrypoint missing · no work can begin',
      status: 'safety_stop',
      primaryAction: {
        kind: 'open_details',
        ...consoleActionCopy.reviewFlightRecorder,
        resourceId: run.id,
        requiresRationale: false,
      },
      secondaryAction: null,
      cost: { period: 'run', usd: estimated, budgetUsd: run.maxEstimatedCostUsd.toNumber() },
      reason:
        'Paul OS cannot name or verify the exact Agent or Skill, so it offers no approval action.',
      provenance: {
        sourceType: 'ApprovalRequest',
        sourceId: approval.id,
        actorId: null,
        requestId: null,
        explanation: 'The pending run has no exact governed entry resource.',
      },
      occurredAt: iso(approval.createdAt),
      payload: {
        sourceType: 'ApprovalRequest',
        sourceId: approval.id,
        detailPath: `/v1/execution-runs/${run.id}`,
        scopes: [],
        runId: run.id,
        candidateId: null,
        channelKey: null,
        releaseId: run.releaseId,
        evaluationId: null,
        expiresAt: null,
        approvalGroupKey: null,
        requestCount: 1,
        subject: null,
        reviewFacts: [
          { label: 'Subject', value: 'Exact governed entrypoint unavailable' },
          { label: 'Effect', value: 'The run remains paused and performs no work.' },
        ],
        metadata: {
          state: 'awaiting_approval',
          legacyEntrypointUnresolved: run.legacyEntrypointUnresolved,
        },
      },
    });
  }

  private unresolvedSubjectItem(input: {
    sourceType: string;
    sourceId: string;
    sourceLabel: string;
    originalKind: AttentionItem['kind'];
    occurredAt: Date;
    detailPath: string;
    runId?: string | null;
    candidateId?: string | null;
    releaseId?: string | null;
    evaluationId?: string | null;
    requestCount?: number;
    decisionGroupKey?: string | null;
    metadata?: Record<string, JsonValue>;
  }): AttentionItem {
    const detailAction = consoleCriticalCopy.attention.actions[0];
    if (detailAction === undefined) {
      throw new AppError(500, 'ATTENTION_COPY_MISSING', 'Attention detail copy is unavailable');
    }
    return attentionItemSchema.parse({
      // Presentation may fail closed to a safety stop, but the durable item identity
      // must remain stable so an existing acknowledgement cannot reappear.
      id: itemId(input.originalKind, input.sourceId),
      kind: 'safety_stop',
      shelf: 'degraded',
      headline: 'Review stopped: the governed subject is unavailable.',
      delta: 'Subject identity missing · details are read-only',
      status: 'safety_stop',
      primaryAction: {
        kind: 'open_details',
        ...detailAction,
        resourceId: input.sourceId,
        requiresRationale: false,
      },
      secondaryAction: null,
      cost: null,
      reason: `Paul OS cannot name a trustworthy subject for this ${input.sourceLabel}, so it offers no decision until the source record is repaired.`,
      provenance: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        actorId: null,
        requestId: null,
        explanation: `The ${input.sourceLabel} has no safe, human-recognizable governed subject.`,
      },
      occurredAt: iso(input.occurredAt),
      payload: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        detailPath: input.detailPath,
        scopes: [],
        runId: input.runId ?? null,
        candidateId: input.candidateId ?? null,
        channelKey: null,
        releaseId: input.releaseId ?? null,
        evaluationId: input.evaluationId ?? null,
        expiresAt: null,
        approvalGroupKey: null,
        decisionGroupKey: input.decisionGroupKey ?? null,
        requestCount: input.requestCount ?? 1,
        subject: null,
        reviewFacts: [
          { label: 'Subject', value: 'Safe governed name unavailable' },
          { label: 'Effect', value: 'No decision is available; opening details changes nothing.' },
        ],
        metadata: {
          originalKind: input.originalKind,
          ...(input.metadata ?? {}),
        },
      },
    });
  }

  private releasePromotionItem(
    group: AttentionDecisionGroup<AttentionReleaseEvaluationRecord>,
  ): AttentionItem {
    const { representative: evaluation, members, requestCount } = group;
    const channelKey = evaluation.release.projectId ?? 'default';
    const subject = subjectFromRelease(evaluation.release.resources, evaluation.release.projectId);
    const membership = exactMembership(
      members.map((member, index) => ({
        label: `Release evaluation ${String(index + 1).padStart(2, '0')}`,
        subject,
        occurredAt: iso(member.finishedAt),
        evidence: [
          { label: 'Corpus', value: `Version ${member.corpusVersion}` },
          {
            label: 'Decision match',
            value: 'Release, corpus, executor, mode, and gate scores match this group.',
          },
        ],
        technicalReferences: [
          { label: 'Release evaluation', value: member.id },
          { label: 'Release', value: member.releaseId },
        ],
      })),
    );
    if (subject === null) {
      return this.unresolvedSubjectItem({
        sourceType: 'ReleaseEvaluation',
        sourceId: evaluation.id,
        sourceLabel: 'release promotion',
        originalKind: 'release_promotion',
        occurredAt: evaluation.finishedAt,
        detailPath: `/evidence/releases/${evaluation.id}`,
        releaseId: evaluation.releaseId,
        evaluationId: evaluation.id,
        requestCount,
        metadata: {
          membership,
          corpusVersion: evaluation.corpusVersion,
          evaluationMode: evaluation.evaluationMode,
        },
      });
    }
    return attentionItemSchema.parse({
      id: itemId('release_promotion', evaluation.id),
      kind: 'release_promotion',
      shelf: 'decide',
      headline: boundedHeadline(`${subject.name} is ready for a production decision.`),
      delta: `Corpus ${evaluation.corpusVersion} passed · production has not changed`,
      status: 'decide',
      primaryAction: {
        kind: 'promote_release',
        ...consoleActionCopy.promoteRelease,
        ...(requestCount === 1
          ? {}
          : {
              consequence: `Promotes the governed release once and resolves all ${requestCount} byte-equivalent evaluation requests together.`,
              undo: 'Use the governed rollback action to restore the prior production release.',
            }),
        resourceId: evaluation.id,
        requiresRationale: true,
      },
      secondaryAction: {
        kind: 'decline_release',
        ...consoleActionCopy.declineRelease,
        ...(requestCount === 1
          ? {}
          : {
              consequence: `Declines the release once and closes all ${requestCount} byte-equivalent evaluation requests together.`,
              undo: 'Run a new governed evaluation before proposing this release again.',
            }),
        resourceId: evaluation.id,
        requiresRationale: true,
      },
      cost: null,
      reason: `Production remains unchanged until a human promotes or declines ${subject.name}.`,
      provenance: {
        sourceType: 'ReleaseEvaluation',
        sourceId: evaluation.id,
        actorId: evaluation.requestedBy,
        requestId: null,
        explanation: 'The governed evaluation finished with a passing verdict.',
      },
      occurredAt: iso(evaluation.finishedAt),
      payload: {
        sourceType: 'ReleaseEvaluation',
        sourceId: evaluation.id,
        detailPath: `/evidence/releases/${evaluation.id}`,
        scopes: [],
        runId: null,
        candidateId: null,
        channelKey,
        releaseId: evaluation.releaseId,
        evaluationId: evaluation.id,
        expiresAt: null,
        approvalGroupKey: null,
        requestCount,
        subject,
        reviewFacts: [
          { label: 'Subject', value: `${subject.name} · ${subject.kind} ${subject.version}` },
          { label: 'Corpus', value: `Version ${evaluation.corpusVersion}` },
          {
            label: 'Executor',
            value: `${evaluation.executorKind} · ${evaluation.evaluationMode}`,
          },
          { label: 'Gate scores', value: boundedReviewValue(evaluation.gateScores) },
          {
            label: 'Evidence meaning',
            value:
              'Deterministic contract coverage only. It does not prove semantic answer quality.',
          },
        ],
        metadata: {
          membership,
          releaseDigest: evaluation.release.digest,
          corpusVersion: evaluation.corpusVersion,
          executorKind: evaluation.executorKind,
          executorVersion: evaluation.executorVersion,
          evaluationMode: evaluation.evaluationMode,
          gateScores: evaluation.gateScores as JsonValue,
          evidence: evaluation.evidence as JsonValue,
          disclaimer:
            'Deterministic contract coverage only. It does not prove semantic answer quality.',
        },
      },
    });
  }

  private memoryItem(group: AttentionDecisionGroup<AttentionMemoryRecord>): AttentionItem {
    const { representative: candidate, members, requestCount, decisionGroupKey } = group;
    const subject = subjectFromRun(candidate.sourceRun);
    const membership = exactMembership(
      members.map((member, index) => ({
        label: `Memory proposal ${String(index + 1).padStart(2, '0')}`,
        subject: subjectFromRun(member.sourceRun),
        occurredAt: iso(member.stagedAt),
        evidence: [
          {
            label: 'Decision match',
            value:
              'Workspace, department, project, namespace, and proposed value match this group.',
          },
          { label: 'Current state', value: 'Staged; durable memory has not changed.' },
        ],
        technicalReferences: [
          { label: 'Memory proposal', value: member.id },
          { label: 'Source run', value: member.sourceRunId },
        ],
      })),
    );
    if (subject === null) {
      return this.unresolvedSubjectItem({
        sourceType: 'MemoryCandidate',
        sourceId: candidate.id,
        sourceLabel: 'durable memory proposal',
        originalKind: 'memory_review',
        occurredAt: candidate.stagedAt,
        detailPath: `/v1/memory-candidates?sourceRunId=${candidate.sourceRunId}`,
        runId: candidate.sourceRunId,
        candidateId: candidate.id,
        releaseId: candidate.sourceRun.releaseId,
        requestCount,
        decisionGroupKey,
        metadata: { membership, namespace: candidate.namespace },
      });
    }
    return attentionItemSchema.parse({
      id: itemId('memory_review', candidate.id),
      kind: 'memory_review',
      shelf: 'decide',
      headline: boundedHeadline(`${subject.name} proposed a durable memory.`),
      delta: 'Nothing is stored yet · review before this value persists',
      status: 'decide',
      primaryAction: {
        kind: 'accept_memory',
        ...consoleActionCopy.acceptMemory,
        ...(requestCount === 1
          ? {}
          : {
              consequence: `Accepts all ${requestCount} exact matching proposals as one governed decision; every source record remains preserved for audit.`,
              undo: `Submit a new governed memory proposal to supersede the ${requestCount} accepted records.`,
            }),
        resourceId: candidate.id,
        requiresRationale: true,
      },
      secondaryAction: {
        kind: 'reject_memory',
        ...consoleActionCopy.rejectMemory,
        ...(requestCount === 1
          ? {}
          : {
              consequence: `Rejects all ${requestCount} exact matching proposals while preserving every source record as evidence.`,
              undo: 'Stage a new proposal from retained evidence.',
            }),
        resourceId: candidate.id,
        requiresRationale: true,
      },
      cost: null,
      reason: `Without approval, ${subject.name}'s proposed value remains staged and does not change durable memory.`,
      provenance: {
        sourceType: 'MemoryCandidate',
        sourceId: candidate.id,
        actorId: candidate.stagedBy,
        requestId: null,
        explanation: 'The execution produced a staged memory candidate.',
      },
      occurredAt: iso(candidate.stagedAt),
      payload: {
        sourceType: 'MemoryCandidate',
        sourceId: candidate.id,
        detailPath: `/v1/memory-candidates?sourceRunId=${candidate.sourceRunId}`,
        scopes: [],
        runId: candidate.sourceRunId,
        candidateId: candidate.id,
        channelKey: null,
        releaseId: null,
        evaluationId: null,
        expiresAt: null,
        approvalGroupKey: null,
        decisionGroupKey,
        requestCount,
        subject,
        reviewFacts: [
          { label: 'Subject', value: `${subject.name} · ${subject.kind} ${subject.version}` },
          { label: 'Namespace', value: candidate.namespace },
          { label: 'Proposed value', value: boundedReviewValue(candidate.proposedValue) },
        ],
        metadata: {
          membership,
          namespace: candidate.namespace,
          proposedValue: redactReviewValue(candidate.proposedValue) as JsonValue,
          provenance: redactReviewValue(candidate.provenance) as JsonValue,
        },
      },
    });
  }

  private improvementItem(
    group: AttentionDecisionGroup<AttentionImprovementRecord>,
    governedTarget: GovernedImprovementTarget | null,
  ): AttentionItem {
    const { representative: candidate, members, requestCount, decisionGroupKey } = group;
    const membership = exactMembership(
      members.map((member, index) => ({
        label: `Improvement proposal ${String(index + 1).padStart(2, '0')}`,
        subject: governedTarget?.subject ?? null,
        occurredAt: iso(member.createdAt),
        evidence: [
          {
            label: 'Decision match',
            value: 'Scope, governed target, title, and proposed change match this group.',
          },
          { label: 'Current state', value: 'Proposed; no repository change exists.' },
        ],
        technicalReferences: [
          { label: 'Improvement proposal', value: member.id },
          { label: 'Observation', value: member.observationId },
          ...(member.observation.sourceRunId === null
            ? []
            : [{ label: 'Source run', value: member.observation.sourceRunId }]),
        ],
      })),
    );
    if (governedTarget === null) {
      return this.unresolvedSubjectItem({
        sourceType: 'ImprovementCandidate',
        sourceId: candidate.id,
        sourceLabel: 'improvement proposal',
        originalKind: 'improvement_review',
        occurredAt: candidate.createdAt,
        detailPath: `/incubator?candidateId=${candidate.id}`,
        candidateId: candidate.id,
        runId: candidate.observation.sourceRunId,
        releaseId: candidate.observation.sourceRun?.releaseId ?? null,
        requestCount,
        decisionGroupKey,
        metadata: { membership, observationId: candidate.observationId },
      });
    }
    const { subject } = governedTarget;
    return attentionItemSchema.parse({
      id: itemId('improvement_review', candidate.id),
      kind: 'improvement_review',
      shelf: 'decide',
      headline: boundedHeadline(`${subject.name} has an improvement proposal.`),
      delta: 'No repository change exists · review before exploration begins',
      status: 'decide',
      primaryAction: {
        kind: 'incubate_candidate',
        ...consoleActionCopy.incubateCandidate,
        ...(requestCount === 1
          ? {}
          : {
              consequence: `Moves all ${requestCount} exact matching proposals into governed exploration without applying or committing a patch.`,
              undo: `Reject the ${requestCount} grouped proposals before any repository import.`,
            }),
        resourceId: candidate.id,
        requiresRationale: true,
      },
      secondaryAction: {
        kind: 'reject_candidate',
        ...consoleActionCopy.rejectCandidate,
        ...(requestCount === 1
          ? {}
          : {
              consequence: `Closes all ${requestCount} exact matching proposals while retaining every observation as evidence.`,
              undo: 'Create a new candidate from the retained evidence.',
            }),
        resourceId: candidate.id,
        requiresRationale: true,
      },
      cost: null,
      reason: `A repeated signal suggests a change to ${subject.name}; no change exists until a human moves it to the Incubator.`,
      provenance: {
        sourceType: 'ImprovementCandidate',
        sourceId: candidate.id,
        actorId: candidate.createdBy,
        requestId: null,
        explanation: `Observation ${candidate.observationId} supports this proposal.`,
      },
      occurredAt: iso(candidate.createdAt),
      payload: {
        sourceType: 'ImprovementCandidate',
        sourceId: candidate.id,
        detailPath: `/incubator?candidateId=${candidate.id}`,
        scopes: [],
        runId: null,
        candidateId: candidate.id,
        channelKey: null,
        releaseId: null,
        evaluationId: null,
        expiresAt: null,
        approvalGroupKey: null,
        decisionGroupKey,
        requestCount,
        subject,
        reviewFacts: [
          { label: 'Subject', value: `${subject.name} · ${subject.kind} ${subject.version}` },
          { label: 'Target intent', value: governedTarget.intentLabel },
          { label: 'Target', value: candidate.proposedTarget },
          { label: 'Proposed change', value: boundedReviewValue(candidate.proposedChange) },
          { label: 'Evidence', value: boundedReviewValue(candidate.evidenceRefs) },
        ],
        metadata: {
          membership,
          observationId: candidate.observationId,
          proposedTarget: candidate.proposedTarget,
          proposedChange: candidate.proposedChange,
          evidenceRefs: candidate.evidenceRefs as JsonValue,
        },
      },
    });
  }

  private degradedRunItem(run: AttentionRunRecord, now: Date): AttentionItem {
    const budgetStop = run.state === ExecutionRunState.PAUSED_BUDGET;
    const pluginPaused = run.state === ExecutionRunState.PAUSED_PLUGIN;
    const stalled =
      run.state === ExecutionRunState.RUNNING &&
      (run.leaseExpiresAt?.getTime() ?? 0) < now.getTime();
    const kind: AttentionItem['kind'] = budgetStop
      ? 'budget_stop'
      : pluginPaused
        ? 'plugin_health'
        : 'stalled_run';
    const subject = subjectFromRun(run);
    if (subject === null) {
      return this.unresolvedSubjectItem({
        sourceType: 'ExecutionRun',
        sourceId: run.id,
        sourceLabel: 'degraded run',
        originalKind: kind,
        occurredAt: run.updatedAt,
        detailPath: `/v1/execution-runs/${run.id}`,
        runId: run.id,
        releaseId: run.releaseId,
        metadata: { state: run.state.toLowerCase() },
      });
    }
    return attentionItemSchema.parse({
      id: itemId(kind, run.id),
      kind,
      shelf: 'degraded',
      headline: budgetStop
        ? boundedHeadline(`Safety stop: ${subject.name} reached its cost limit.`)
        : pluginPaused
          ? boundedHeadline(`${subject.name} is waiting for a required Plugin.`)
          : stalled
            ? boundedHeadline(`${subject.name} stopped sending heartbeats.`)
            : boundedHeadline(`${subject.name} failed before producing an outcome.`),
      delta: `${run.progress}% complete · no new work can proceed`,
      status: budgetStop ? 'safety_stop' : 'degraded',
      primaryAction: {
        kind: 'open_details',
        ...consoleActionCopy.reviewFlightRecorder,
        resourceId: run.id,
        requiresRationale: false,
      },
      secondaryAction:
        run.state === ExecutionRunState.FAILED
          ? {
              kind: 'resolve_item',
              ...consoleActionCopy.acknowledgeFailure,
              resourceId: itemId(kind, run.id),
              requiresRationale: true,
            }
          : null,
      cost: {
        period: 'run',
        usd: money(run.actualCostUsd) ?? run.estimatedUpperCostUsd.toNumber(),
        budgetUsd: run.maxEstimatedCostUsd.toNumber(),
      },
      reason: budgetStop
        ? `The configured cost ceiling stopped ${subject.name} before more could be spent.`
        : pluginPaused
          ? `${subject.name} is held and will not perform late work while its required Plugin is unavailable.`
          : stalled
            ? `${subject.name}'s worker lease expired; recovery must decide whether to retry.`
            : `${subject.name} produced no outcome, and acknowledgement is available only after reviewing its recorder.`,
      provenance: {
        sourceType: 'ExecutionRun',
        sourceId: run.id,
        actorId: run.requestedBy,
        requestId: null,
        explanation: 'Execution ledger state placed this item on the Degraded shelf.',
      },
      occurredAt: iso(run.updatedAt),
      payload: {
        sourceType: 'ExecutionRun',
        sourceId: run.id,
        detailPath: `/v1/execution-runs/${run.id}`,
        scopes: runScopes(run),
        runId: run.id,
        candidateId: null,
        channelKey: null,
        releaseId: run.releaseId,
        evaluationId: null,
        expiresAt: run.leaseExpiresAt?.toISOString() ?? null,
        approvalGroupKey: null,
        requestCount: 1,
        subject,
        reviewFacts: [
          { label: 'Subject', value: `${subject.name} · ${subject.kind} ${subject.version}` },
          { label: 'Recorded state', value: run.state.toLowerCase() },
          { label: 'Cost limit', value: `$${run.maxEstimatedCostUsd.toNumber().toFixed(2)}` },
          { label: 'Last message', value: run.message },
        ],
        metadata: { state: run.state.toLowerCase(), message: run.message },
      },
    });
  }

  private degradedPluginItem(installation: DegradedPluginRecord): AttentionItem {
    const state = installation.state.toLowerCase();
    const subject = subjectFromNamedVersion(
      installation.pluginVersion.family.name,
      'plugin',
      installation.pluginVersion.version,
    );
    if (subject === null) {
      return this.unresolvedSubjectItem({
        sourceType: 'PluginInstallation',
        sourceId: installation.id,
        sourceLabel: 'Plugin health record',
        originalKind: 'plugin_health',
        occurredAt: installation.updatedAt,
        detailPath: `/v1/plugin-installations/${installation.id}`,
        metadata: { state },
      });
    }
    return attentionItemSchema.parse({
      id: itemId('plugin_health', installation.id),
      kind: 'plugin_health',
      shelf: 'degraded',
      headline:
        installation.state === PluginInstallationState.DISABLED
          ? `${subject.name} is disabled.`
          : `${subject.name} is degraded.`,
      delta: 'Required calls are held · no silent fallback is allowed',
      status: 'degraded',
      primaryAction: {
        kind: 'open_details',
        ...consoleActionCopy.reviewFlightRecorder,
        resourceId: installation.id,
        requiresRationale: false,
      },
      secondaryAction: null,
      cost: null,
      reason:
        installation.state === PluginInstallationState.DISABLED
          ? `${subject.name}'s kill switch is active; new calls fail closed until a human enables this Plugin.`
          : `${subject.name}'s latest governed health evidence did not pass, so new calls fail closed.`,
      provenance: {
        sourceType: 'PluginInstallation',
        sourceId: installation.id,
        actorId: installation.updatedBy,
        requestId: null,
        explanation: 'Plugin installation state placed this item on the Degraded shelf.',
      },
      occurredAt: iso(installation.updatedAt),
      payload: {
        sourceType: 'PluginInstallation',
        sourceId: installation.id,
        detailPath: `/v1/plugin-installations/${installation.id}`,
        scopes: [],
        runId: null,
        candidateId: null,
        channelKey: null,
        releaseId: null,
        evaluationId: null,
        expiresAt: null,
        approvalGroupKey: null,
        requestCount: 1,
        subject,
        reviewFacts: [
          { label: 'Plugin', value: subject.name },
          { label: 'Version', value: subject.version },
          { label: 'Recorded state', value: state },
        ],
        metadata: {
          state,
          pluginVersionId: installation.pluginVersionId,
          pluginDigest: installation.pluginDigest,
        },
      },
    });
  }
}
