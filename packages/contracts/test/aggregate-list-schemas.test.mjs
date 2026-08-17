import assert from 'node:assert/strict';
import test from 'node:test';
import { automationScheduleListResponseSchema } from '../dist/automation-learning-schemas.js';
import {
  authorityGrantListResponseSchema,
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
