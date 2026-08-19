import type { DailyBriefInput, DailyBriefOutput } from '@agent-builder/contracts';
import { invalidDailyBriefCitations, scoreDailyBriefQuality } from '@paul-os/runtime';

const input: DailyBriefInput = {
  date: '2026-08-16',
  timezone: 'America/New_York',
  priorities: ['Priority A'],
  calendarItems: [
    {
      title: 'Review',
      startsAt: '2026-08-16T13:00:00.000Z',
      endsAt: '2026-08-16T14:00:00.000Z',
    },
  ],
  tasks: ['Task A'],
  signals: ['Signal A'],
  userConstraints: [],
};

const output: DailyBriefOutput = {
  topPriorities: ['Priority A'],
  scheduleRisks: [],
  decisionsRequired: ['Review signal: Signal A'],
  proposedActions: ['Task A'],
  citations: ['calendar:2026-08-16T13:00:00.000Z'],
  confidence: 0.1,
  unresolvedItems: [],
};

describe('daily brief evidence boundary', () => {
  it('scores objective input/output agreement rather than model confidence', () => {
    expect(invalidDailyBriefCitations(input, output)).toEqual([]);
    expect(scoreDailyBriefQuality(input, output)).toBe(1);
  });

  it('identifies invented citations', () => {
    const invalid = {
      ...output,
      citations: ['calendar:not-supplied'],
    };
    expect(invalidDailyBriefCitations(input, invalid)).toEqual(['calendar:not-supplied']);
    expect(scoreDailyBriefQuality(input, invalid)).toBe(0);
  });

  it('applies an unresolved-item penalty without trusting confidence', () => {
    expect(
      scoreDailyBriefQuality(input, {
        ...output,
        confidence: 1,
        unresolvedItems: ['Needs confirmation'],
      }),
    ).toBeCloseTo(0.9);
  });
});
