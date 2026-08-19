import {
  HISTORY_TERRAIN_SCHEMA_VERSION,
  type HistoryTerrainCaption,
  type HistoryTerrainInput,
  type HistoryTerrainStream,
} from './history-terrain-types';

export interface HistoryTerrainStatistics {
  readonly busiestWeek: {
    readonly streamId: string;
    readonly streamLabel: string;
    readonly weekIndex: number;
    readonly value: number;
  };
  readonly longestStarvation: {
    readonly streamId: string;
    readonly streamLabel: string;
    readonly weeks: number;
  };
  readonly weeksAbovePlan: number;
}

export interface HistoryTerrainModel {
  readonly input: HistoryTerrainInput;
  readonly weekCount: number;
  readonly statistics: HistoryTerrainStatistics;
  readonly medians: ReadonlyMap<string, number>;
  readonly smoothed: readonly {
    readonly streamId: string;
    readonly actual: Float32Array;
    readonly plan: Float32Array;
    readonly reviewJam: Float32Array;
  }[];
  readonly subdivisions: number;
}

export type HistoryTerrainValidation =
  | { readonly ok: true; readonly model: HistoryTerrainModel }
  | { readonly ok: false; readonly issues: readonly string[] };

function isFiniteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function smooth(values: readonly number[], subdivisions: number): Float32Array {
  const outputLength = (values.length - 1) * subdivisions + 1;
  const output = new Float32Array(outputLength);
  const sample = (index: number) => values[Math.max(0, Math.min(values.length - 1, index))] ?? 0;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index / subdivisions;
    const sourceIndex = Math.floor(sourcePosition);
    const progress = sourcePosition - sourceIndex;
    const p0 = sample(sourceIndex - 1);
    const p1 = sample(sourceIndex);
    const p2 = sample(sourceIndex + 1);
    const p3 = sample(sourceIndex + 2);
    output[index] = Math.max(
      0,
      0.5 *
        (2 * p1 +
          (-p0 + p2) * progress +
          (2 * p0 - 5 * p1 + 4 * p2 - p3) * progress * progress +
          (-p0 + 3 * p1 - 3 * p2 + p3) * progress * progress * progress),
    );
  }
  return output;
}

function computeStatistics(
  streams: readonly HistoryTerrainStream[],
  weekCount: number,
): HistoryTerrainStatistics {
  let busiest = {
    streamId: streams[0]?.id ?? 'unavailable',
    streamLabel: streams[0]?.label ?? 'Unavailable',
    weekIndex: 0,
    value: 0,
  };
  let longestStarvation = {
    streamId: streams[0]?.id ?? 'unavailable',
    streamLabel: streams[0]?.label ?? 'Unavailable',
    weeks: 0,
  };

  for (const stream of streams) {
    const typical = Math.max(0.04, median(stream.actual));
    let currentStarvation = 0;
    let longestForStream = 0;
    stream.actual.forEach((value, weekIndex) => {
      if (value > busiest.value) {
        busiest = {
          streamId: stream.id,
          streamLabel: stream.label,
          weekIndex,
          value,
        };
      }
      if (value < typical * 0.35) {
        currentStarvation += 1;
        longestForStream = Math.max(longestForStream, currentStarvation);
      } else {
        currentStarvation = 0;
      }
    });
    if (longestForStream > longestStarvation.weeks) {
      longestStarvation = {
        streamId: stream.id,
        streamLabel: stream.label,
        weeks: longestForStream,
      };
    }
  }

  let weeksAbovePlan = 0;
  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    let actual = 0;
    let plan = 0;
    for (const stream of streams) {
      actual += stream.actual[weekIndex] ?? 0;
      plan += stream.plan[weekIndex] ?? 0;
    }
    if (actual > plan * 1.05) weeksAbovePlan += 1;
  }

  return { busiestWeek: busiest, longestStarvation, weeksAbovePlan };
}

export function validateHistoryTerrainInput(input: HistoryTerrainInput): HistoryTerrainValidation {
  const issues: string[] = [];
  if (input.schemaVersion !== HISTORY_TERRAIN_SCHEMA_VERSION) {
    issues.push(`Unsupported history terrain schema: ${String(input.schemaVersion)}.`);
  }
  if (input.weeks.length < 2) issues.push('History terrain requires at least two weeks.');
  if (input.streams.length < 1) issues.push('History terrain requires at least one workstream.');

  const weekIds = new Set<string>();
  input.weeks.forEach((week, index) => {
    if (weekIds.has(week.id)) issues.push(`Week ${week.id} is duplicated.`);
    weekIds.add(week.id);
    if (!Number.isFinite(Date.parse(week.startsAt))) {
      issues.push(`Week ${index + 1} has an invalid start date.`);
    }
    if (index > 0) {
      const previous = input.weeks[index - 1];
      if (previous && Date.parse(previous.startsAt) >= Date.parse(week.startsAt)) {
        issues.push('History terrain weeks must be strictly chronological.');
      }
    }
  });

  const streamIds = new Set<string>();
  input.streams.forEach((stream) => {
    if (streamIds.has(stream.id)) issues.push(`Workstream ${stream.id} is duplicated.`);
    streamIds.add(stream.id);
    for (const [field, values] of [
      ['actual', stream.actual],
      ['plan', stream.plan],
      ['reviewJam', stream.reviewJam],
    ] as const) {
      if (values.length !== input.weeks.length) {
        issues.push(`${stream.label} ${field} must contain one value per week.`);
      }
      if (values.some((value) => !isFiniteNonNegative(value))) {
        issues.push(`${stream.label} ${field} contains an invalid value.`);
      }
    }
    if (stream.reviewJam.some((value) => value > 1)) {
      issues.push(`${stream.label} reviewJam cannot exceed 1.`);
    }
  });

  input.beacons.forEach((beacon) => {
    if (!streamIds.has(beacon.streamId)) {
      issues.push(`Beacon ${beacon.id} references an unavailable workstream.`);
    }
    if (!Number.isInteger(beacon.weekIndex) || !input.weeks[beacon.weekIndex]) {
      issues.push(`Beacon ${beacon.id} references an unavailable week.`);
    }
  });
  input.captions.forEach((caption) => {
    if (!Number.isInteger(caption.weekIndex) || !input.weeks[caption.weekIndex]) {
      issues.push(`Caption ${caption.id} references an unavailable week.`);
    }
  });

  if (issues.length > 0) return { ok: false, issues };

  const subdivisions = 8;
  const medians = new Map(input.streams.map((stream) => [stream.id, median(stream.actual)]));
  return {
    ok: true,
    model: {
      input,
      weekCount: input.weeks.length,
      statistics: computeStatistics(input.streams, input.weeks.length),
      medians,
      smoothed: input.streams.map((stream) => ({
        streamId: stream.id,
        actual: smooth(stream.actual, subdivisions),
        plan: smooth(stream.plan, subdivisions),
        reviewJam: smooth(stream.reviewJam, subdivisions),
      })),
      subdivisions,
    },
  };
}

export function formatHistoryWeek(input: HistoryTerrainInput, weekIndex: number): string {
  const safeIndex = Math.max(0, Math.min(input.weeks.length - 1, Math.floor(weekIndex)));
  const startsAt = input.weeks[safeIndex]?.startsAt;
  if (!startsAt) return 'DATE UNAVAILABLE';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(new Date(startsAt))
    .toUpperCase();
}

export function captionAt(
  captions: readonly HistoryTerrainCaption[],
  weekIndex: number,
): HistoryTerrainCaption | null {
  return captions.reduce<HistoryTerrainCaption | null>(
    (selected, caption) =>
      caption.weekIndex <= weekIndex &&
      (selected === null || caption.weekIndex >= selected.weekIndex)
        ? caption
        : selected,
    null,
  );
}
