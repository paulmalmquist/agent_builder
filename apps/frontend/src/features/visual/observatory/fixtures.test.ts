import { describe, expect, it } from 'vitest';
import { getObservatoryStats } from './observatory-data';
import { createObservatoryFixture } from './fixtures';

describe('observatory fixture', () => {
  it('replays the same bounded synthetic population from the fixed seed', () => {
    const first = createObservatoryFixture();
    const second = createObservatoryFixture();

    expect(first.provenance).toBe('fixture');
    expect(first.runs).toHaveLength(2_428);
    expect(first.agentCounts.reduce((total, count) => total + count, 0)).toBe(first.runs.length);
    expect(second).toEqual(first);
  });

  it('keeps queue and outcome summaries consistent with the exact run population', () => {
    const fixture = createObservatoryFixture();
    const midnight = getObservatoryStats(fixture, 24);

    expect(fixture.waitingAtMidnight).toBe(midnight.waiting);
    expect(fixture.peakQueue).toBeGreaterThanOrEqual(fixture.waitingAtMidnight);
    expect(
      midnight.running + midnight.waiting + midnight.shipped + midnight.needsYou + midnight.failed,
    ).toBe(fixture.runs.filter((run) => run.stageTimes[0] <= 24).length);
    expect(fixture.captions.at(-1)?.text).toContain(
      fixture.waitingAtMidnight.toLocaleString('en-US'),
    );
  });
});
