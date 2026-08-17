import {
  createAutomationScheduleRequestSchema,
  reviewMemoryCandidateRequestSchema,
} from '@agent-builder/contracts';
import { planDueOccurrences } from '../src/services/automation-learning-service.js';

describe('automation and learning contracts', () => {
  const start = new Date('2026-08-16T08:00:00.000Z');
  const now = new Date('2026-08-16T11:30:00.000Z');

  it('plans deterministic latest-only, bounded-all, and skip catch-up behavior', () => {
    expect(planDueOccurrences(start, now, 3600, 'latest_only', 10)).toEqual({
      occurrences: [new Date('2026-08-16T11:00:00.000Z')],
      nextRunAt: new Date('2026-08-16T12:00:00.000Z'),
    });
    expect(planDueOccurrences(start, now, 3600, 'all', 2)).toEqual({
      occurrences: [new Date('2026-08-16T08:00:00.000Z'), new Date('2026-08-16T09:00:00.000Z')],
      nextRunAt: new Date('2026-08-16T10:00:00.000Z'),
    });
    expect(planDueOccurrences(start, now, 3600, 'none', 10)).toEqual({
      occurrences: [],
      nextRunAt: new Date('2026-08-16T12:00:00.000Z'),
    });
    expect(planDueOccurrences(new Date('2026-08-17T08:00:00.000Z'), now, 3600, 'all', 2)).toEqual({
      occurrences: [],
      nextRunAt: new Date('2026-08-17T08:00:00.000Z'),
    });
  });

  it('requires bounded schedules that target a release and carry cost/retry expectations', () => {
    const parsed = createAutomationScheduleRequestSchema.parse({
      name: 'Daily briefing',
      channelKey: 'daily-brief-production',
      releaseId: '00000000-0000-4000-8000-000000000001',
      entryResourceVersionId: '00000000-0000-4000-8000-000000000002',
      authorityGrantId: null,
      timezone: 'America/New_York',
      intervalSeconds: 86_400,
      nextRunAt: '2026-08-17T11:00:00.000Z',
      inputTemplate: { date: '2026-08-17' },
      inputConstraints: {},
      retry: { maximumAttempts: 3, backoff: 'exponential' },
      cost: { maxInputTokens: 4000, maxOutputTokens: 1000, maxEstimatedCostUsd: 0.25 },
      outcomeExpectations: { citationsRequired: true },
    });
    expect(parsed.catchUpPolicy).toBe('latest_only');
    expect(parsed.maxCatchUpRuns).toBe(10);
    expect(() =>
      createAutomationScheduleRequestSchema.parse({ ...parsed, intervalSeconds: 30 }),
    ).toThrow();
  });

  it('requires an edited value only for edit-and-accept memory decisions', () => {
    expect(
      reviewMemoryCandidateRequestSchema.parse({
        decision: 'edit_accept',
        editedValue: { preference: 'concise' },
        rationale: 'Confirmed after reviewing the source run.',
      }).decision,
    ).toBe('edit_accept');
    expect(() =>
      reviewMemoryCandidateRequestSchema.parse({
        decision: 'edit_accept',
        rationale: 'Confirmed after reviewing the source run.',
      }),
    ).toThrow(/editedValue/);
    expect(() =>
      reviewMemoryCandidateRequestSchema.parse({
        decision: 'reject',
        editedValue: { preference: 'concise' },
        rationale: 'This should not become durable user memory.',
      }),
    ).toThrow(/editedValue/);
  });

  it('ships database-level claim, lineage, and immutable-memory safeguards', async () => {
    const repositoryRoot = process.cwd().endsWith(path.join('apps', 'backend'))
      ? path.resolve(process.cwd(), '..', '..')
      : process.cwd();
    const migration = await readFile(
      path.join(
        repositoryRoot,
        'apps',
        'backend',
        'prisma',
        'migrations',
        '20260818000000_automation_learning',
        'migration.sql',
      ),
      'utf8',
    );
    expect(migration).toContain('AutomationDispatch_scheduleId_scheduledFor_key');
    expect(migration).toContain('MemoryCandidate_accepted_value_check');
    expect(migration).toContain('MemoryCandidate_reviewed_immutable');
    expect(migration).toContain('Observation_append_only');
  });
});
import { readFile } from 'node:fs/promises';
import path from 'node:path';
