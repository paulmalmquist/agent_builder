import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SELFTEST_SCHEMA_VERSION,
  selfTestReportSchema,
  summarizeSelfTestResults,
} from '../dist/index.js';

function report() {
  const results = [
    {
      id: 'kpi.count.all',
      width: 390,
      status: 'PASS',
      description: 'All scope renders exactly eight KPI cards.',
      expected: '8 KPI cards',
      actual: '8 KPI cards',
      route: '/',
    },
    {
      id: 'kpi.activate.keyboard',
      width: 390,
      status: 'SKIPPED',
      description: 'Enter and Space produce the same scoped URL.',
      expected: 'Both keys activate the focused card.',
      actual: 'Browser did not expose a script-verifiable keyboard path.',
      route: '/',
    },
  ];
  return {
    schemaVersion: SELFTEST_SCHEMA_VERSION,
    commit: null,
    generatedAt: '2026-08-21T12:00:00.000Z',
    widths: [390],
    summary: summarizeSelfTestResults(results),
    results,
  };
}

test('self-test reports keep honest skipped rows and matching summary counts', () => {
  const parsed = selfTestReportSchema.parse(report());
  assert.deepEqual(parsed.summary, { pass: 1, fail: 0, skipped: 1 });
});

test('self-test reports reject summaries that do not match their result rows', () => {
  const input = report();
  input.summary.pass = 2;
  assert.equal(selfTestReportSchema.safeParse(input).success, false);
});

test('self-test reports reject results outside the declared width matrix', () => {
  const input = report();
  input.results[0].width = 768;
  assert.equal(selfTestReportSchema.safeParse(input).success, false);
});
