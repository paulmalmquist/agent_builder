import {
  HISTORY_TERRAIN_SCHEMA_VERSION,
  type HistoryTerrainInput,
  type HistoryTerrainStream,
} from './history-terrain-types';

const WEEK_COUNT = 26;
const WEEK_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const START_AT = Date.UTC(2026, 2, 2);

interface ProfilePoint {
  readonly week: number;
  readonly value: number;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function segmentedProfile(points: readonly ProfilePoint[]): number[] {
  return Array.from({ length: WEEK_COUNT }, (_, week) => {
    let left = points[0];
    let right = points.at(-1);
    for (let index = 0; index < points.length - 1; index += 1) {
      const candidateLeft = points[index];
      const candidateRight = points[index + 1];
      if (
        candidateLeft !== undefined &&
        candidateRight !== undefined &&
        week >= candidateLeft.week &&
        week <= candidateRight.week
      ) {
        left = candidateLeft;
        right = candidateRight;
        break;
      }
    }
    if (!left || !right) return 0;
    const distance = right.week - left.week;
    const progress = distance === 0 ? 0 : (week - left.week) / distance;
    return left.value + (right.value - left.value) * progress;
  });
}

function noisyProfile(
  random: () => number,
  points: readonly ProfilePoint[],
  amplitude: number,
): number[] {
  return segmentedProfile(points).map((value) =>
    Math.max(0.02, value + (random() - 0.5) * amplitude),
  );
}

function zeroJam(): number[] {
  return Array.from({ length: WEEK_COUNT }, () => 0);
}

export function createHistoryTerrainFixture(): HistoryTerrainInput {
  const random = createSeededRandom(20260302);
  const actualProfiles = [
    noisyProfile(
      random,
      [
        { week: 0, value: 0.12 },
        { week: 25, value: 0.16 },
      ],
      0.05,
    ),
    noisyProfile(
      random,
      [
        { week: 0, value: 0.1 },
        { week: 8, value: 0.1 },
        { week: 9, value: 0.3 },
        { week: 10, value: 0.26 },
        { week: 11, value: 0.1 },
        { week: 25, value: 0.1 },
      ],
      0.04,
    ),
    noisyProfile(
      random,
      [
        { week: 0, value: 0.1 },
        { week: 3, value: 0.12 },
        { week: 4, value: 0.55 },
        { week: 5, value: 0.14 },
        { week: 8, value: 0.12 },
        { week: 9, value: 0.4 },
        { week: 10, value: 0.12 },
        { week: 14, value: 0.12 },
        { week: 15, value: 0.65 },
        { week: 16, value: 0.16 },
        { week: 20, value: 0.12 },
        { week: 21, value: 0.5 },
        { week: 22, value: 0.12 },
        { week: 25, value: 0.12 },
      ],
      0.05,
    ),
    noisyProfile(
      random,
      [
        { week: 0, value: 0.12 },
        { week: 9, value: 0.16 },
        { week: 10, value: 0.55 },
        { week: 11, value: 0.52 },
        { week: 12, value: 0.18 },
        { week: 18, value: 0.18 },
        { week: 19, value: 0.68 },
        { week: 21, value: 0.66 },
        { week: 22, value: 0.3 },
        { week: 23, value: 0.5 },
        { week: 24, value: 0.82 },
        { week: 25, value: 0.88 },
      ],
      0.06,
    ),
    noisyProfile(
      random,
      [
        { week: 0, value: 0.3 },
        { week: 5, value: 0.26 },
        { week: 6, value: 0.06 },
        { week: 13, value: 0.05 },
        { week: 14, value: 0.22 },
        { week: 16, value: 0.38 },
        { week: 20, value: 0.44 },
        { week: 25, value: 0.55 },
      ],
      0.03,
    ),
    noisyProfile(
      random,
      [
        { week: 0, value: 0.22 },
        { week: 6, value: 0.3 },
        { week: 12, value: 0.38 },
        { week: 18, value: 0.45 },
        { week: 25, value: 0.52 },
      ],
      0.06,
    ),
    noisyProfile(
      random,
      [
        { week: 0, value: 0.42 },
        { week: 6, value: 0.52 },
        { week: 7, value: 0.7 },
        { week: 9, value: 0.72 },
        { week: 10, value: 0.55 },
        { week: 16, value: 0.55 },
        { week: 22, value: 0.58 },
        { week: 23, value: 0.66 },
        { week: 25, value: 0.66 },
      ],
      0.06,
    ),
    noisyProfile(
      random,
      [
        { week: 0, value: 0.16 },
        { week: 6, value: 0.3 },
        { week: 10, value: 0.5 },
        { week: 12, value: 0.62 },
        { week: 13, value: 0.85 },
        { week: 14, value: 0.95 },
        { week: 15, value: 0.9 },
        { week: 16, value: 0.72 },
        { week: 18, value: 0.68 },
        { week: 22, value: 0.7 },
        { week: 24, value: 0.8 },
        { week: 25, value: 0.82 },
      ],
      0.05,
    ),
    noisyProfile(
      random,
      [
        { week: 0, value: 0.28 },
        { week: 8, value: 0.36 },
        { week: 12, value: 0.52 },
        { week: 13, value: 0.88 },
        { week: 14, value: 1 },
        { week: 15, value: 0.86 },
        { week: 16, value: 0.6 },
        { week: 18, value: 0.5 },
        { week: 22, value: 0.5 },
        { week: 24, value: 0.55 },
        { week: 25, value: 0.55 },
      ],
      0.05,
    ),
  ];
  const planProfiles = [
    segmentedProfile([
      { week: 0, value: 0.12 },
      { week: 25, value: 0.14 },
    ]),
    segmentedProfile([
      { week: 0, value: 0.1 },
      { week: 25, value: 0.1 },
    ]),
    segmentedProfile([
      { week: 0, value: 0.15 },
      { week: 25, value: 0.15 },
    ]),
    segmentedProfile([
      { week: 0, value: 0.12 },
      { week: 8, value: 0.2 },
      { week: 14, value: 0.35 },
      { week: 25, value: 0.4 },
    ]),
    segmentedProfile([
      { week: 0, value: 0.3 },
      { week: 25, value: 0.3 },
    ]),
    segmentedProfile([
      { week: 0, value: 0.22 },
      { week: 12, value: 0.4 },
      { week: 25, value: 0.48 },
    ]),
    segmentedProfile([
      { week: 0, value: 0.5 },
      { week: 25, value: 0.5 },
    ]),
    segmentedProfile([
      { week: 0, value: 0.16 },
      { week: 5, value: 0.35 },
      { week: 9, value: 0.55 },
      { week: 11, value: 0.55 },
      { week: 14, value: 0.3 },
      { week: 18, value: 0.15 },
      { week: 25, value: 0.12 },
    ]),
    segmentedProfile([
      { week: 0, value: 0.35 },
      { week: 25, value: 0.4 },
    ]),
  ];
  const reviewJam = Array.from({ length: 9 }, zeroJam);
  reviewJam[8]![13] = 0.8;
  reviewJam[8]![14] = 1;
  reviewJam[8]![15] = 0.7;
  reviewJam[7]![13] = 0.6;
  reviewJam[7]![14] = 1;
  reviewJam[7]![15] = 0.8;
  reviewJam[7]![16] = 0.4;

  const streamDefinitions = [
    ['learning-reading', 'Learning and reading', 'PERSONAL'],
    ['hiring-admin', 'Hiring and admin', 'OVERHEAD'],
    ['client-external', 'Client and external', 'OUTSIDE WORK'],
    ['console-design', 'Console and design', 'THE FACE'],
    ['evaluations', 'Evaluations', 'THE CONSCIENCE'],
    ['plugin-registry', 'Plugin registry', 'THE HANDS'],
    ['agent-runtime', 'Agent runtime', 'THE SPINE'],
    ['integration', 'Integration', 'FIRST ARTICLE'],
    ['factory-ops', 'Factory operations', 'THE FLOOR'],
  ] as const;
  const streams: HistoryTerrainStream[] = streamDefinitions.map(([id, label, category], index) => ({
    id,
    label,
    category,
    actual: actualProfiles[index] ?? zeroJam(),
    plan: planProfiles[index] ?? zeroJam(),
    reviewJam: reviewJam[index] ?? zeroJam(),
  }));

  return {
    schemaVersion: HISTORY_TERRAIN_SCHEMA_VERSION,
    title: 'The last six months, as terrain',
    description:
      'Height is how much work landed each week. The hairline is the plan. Past is solid and future work is ghosted.',
    provenance: { kind: 'fixture', label: 'FIXTURE DATA' },
    weeks: Array.from({ length: WEEK_COUNT }, (_, weekIndex) => ({
      id: `week-${String(weekIndex + 1).padStart(2, '0')}`,
      startsAt: new Date(START_AT + weekIndex * WEEK_MILLISECONDS).toISOString(),
    })),
    streams,
    beacons: [
      {
        id: 'integration-review-slip',
        streamId: 'integration',
        weekIndex: 15,
        label: 'Integration review slipped to week 19',
        state: 'slipped',
      },
      {
        id: 'registry-freeze-slip',
        streamId: 'plugin-registry',
        weekIndex: 22,
        label: 'Registry freeze slipped one week',
        state: 'slipped',
      },
    ],
    captions: [
      {
        id: 'march-baseline',
        weekIndex: 0,
        lead: 'March.',
        detail: 'The hairline is the plan. Watch what actually landed.',
      },
      {
        id: 'evaluation-starvation',
        weekIndex: 6,
        lead: 'Evaluations goes quiet.',
        detail: 'Eight weeks of low activity were easy to miss in weekly totals.',
      },
      {
        id: 'review-jam',
        weekIndex: 13,
        lead: 'The review jam.',
        detail: 'Factory operations and Integration rise above a plan that never predicted it.',
      },
      {
        id: 'recovery',
        weekIndex: 16,
        lead: 'The recovery took about four weeks.',
        detail: 'Evaluation activity returned during the same month.',
      },
      {
        id: 'today',
        weekIndex: 24,
        lead: 'Today.',
        detail: 'Integration remains above plan, making the next constraint visible early.',
      },
    ],
  };
}

export const historyTerrainFixture = createHistoryTerrainFixture();
