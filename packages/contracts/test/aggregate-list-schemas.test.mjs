import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automationScheduleListResponseSchema,
  automationScheduleSchema,
} from '../dist/automation-learning-schemas.js';
import {
  authorityGrantListResponseSchema,
  executionRunEntrySubjectSchema,
  executionRunListResponseSchema,
  resourceListResponseSchema,
} from '../dist/platform-schemas.js';

const countsByState = {
  awaiting_approval: 2,
  queued: 3,
  running: 1,
  succeeded: 8,
  failed: 4,
  cancelled: 1,
  paused_budget: 0,
  paused_plugin: 1,
};
const countsByLifecycle = {
  experimental: 3,
  candidate: 4,
  evaluating: 1,
  evaluated: 2,
  certified: 5,
  production: 6,
  deprecated: 1,
};
const scheduleFixture = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Compose daily brief 20000000-0000-4000-8000-000000000001',
  channelKey: 'daily-operations',
  releaseId: '30000000-0000-4000-8000-000000000001',
  entryResourceVersionId: '40000000-0000-4000-8000-000000000001',
  entrySubject: { name: 'Daily Brief', kind: 'skill', version: '1.0.0' },
  authorityGrantId: null,
  timezone: 'America/New_York',
  intervalSeconds: 3600,
  nextRunAt: '2026-08-18T14:00:00.000Z',
  inputTemplate: {},
  includePlatformDigest: false,
  inputConstraints: {},
  catchUpPolicy: 'latest_only',
  maxCatchUpRuns: 1,
  deduplicationWindowSeconds: 300,
  retry: { maximumAttempts: 3, backoff: 'exponential' },
  cost: { maxInputTokens: 8000, maxOutputTokens: 2000, maxEstimatedCostUsd: 0.25 },
  outcomeExpectations: {},
  releaseDigest: 'a'.repeat(64),
  projectId: 'daily-operations',
  state: 'active',
  lastScheduledAt: null,
  createdBy: 'human:local-operator',
  updatedBy: 'human:local-operator',
  createdAt: '2026-08-18T13:00:00.000Z',
  updatedAt: '2026-08-18T13:00:00.000Z',
};

test('execution runs expose an exact, bounded entry subject projection', () => {
  assert.deepEqual(
    executionRunEntrySubjectSchema.parse({ name: 'Daily Brief', kind: 'skill', version: '1.0.0' }),
    { name: 'Daily Brief', kind: 'skill', version: '1.0.0' },
  );
  assert.equal(
    executionRunEntrySubjectSchema.safeParse({
      name: 'Daily Brief',
      kind: 'skill',
      version: '',
    }).success,
    false,
  );
});

test('automation schedules expose a safe entry subject independently of their authored name', () => {
  const parsed = automationScheduleSchema.parse(scheduleFixture);
  assert.deepEqual(parsed.entrySubject, {
    name: 'Daily Brief',
    kind: 'skill',
    version: '1.0.0',
  });
  assert.equal(
    automationScheduleSchema.safeParse({
      ...scheduleFixture,
      entrySubject: { name: 'Daily Brief', kind: 'skill', version: '' },
    }).success,
    false,
  );
});

test('capped operational lists require server-owned full-scope totals', () => {
  assert.deepEqual(
    authorityGrantListResponseSchema.parse({ items: [], total: 12, activeTotal: 7 }),
    { items: [], total: 12, activeTotal: 7 },
  );
  assert.deepEqual(
    automationScheduleListResponseSchema.parse({ items: [], total: 9, activeTotal: 6 }),
    { items: [], total: 9, activeTotal: 6 },
  );
  assert.deepEqual(executionRunListResponseSchema.parse({ items: [], total: 20, countsByState }), {
    items: [],
    total: 20,
    countsByState,
  });
  assert.deepEqual(resourceListResponseSchema.parse({ items: [], total: 22, countsByLifecycle }), {
    items: [],
    total: 22,
    countsByLifecycle,
  });
});

test('operational list aggregate response shapes reject omissions and unknown fields', () => {
  assert.equal(authorityGrantListResponseSchema.safeParse({ items: [] }).success, false);
  assert.equal(
    automationScheduleListResponseSchema.safeParse({
      items: [],
      total: 9,
      activeTotal: 6,
      cappedItemTotal: 1,
    }).success,
    false,
  );
  assert.equal(
    executionRunListResponseSchema.safeParse({
      items: [],
      total: 20,
      countsByState: { ...countsByState, waiting_for_user: 1 },
    }).success,
    false,
  );
  assert.equal(
    resourceListResponseSchema.safeParse({
      items: [],
      total: 22,
      countsByLifecycle: { ...countsByLifecycle, draft: 1 },
    }).success,
    false,
  );
  assert.equal(
    executionRunListResponseSchema.safeParse({
      items: [],
      total: 19,
      countsByState,
    }).success,
    false,
  );
  assert.equal(
    resourceListResponseSchema.safeParse({
      items: [],
      total: 21,
      countsByLifecycle,
    }).success,
    false,
  );
  assert.equal(
    authorityGrantListResponseSchema.safeParse({ items: [], total: 2, activeTotal: 3 }).success,
    false,
  );
});
