import {
  OBSERVATORY_AGENTS,
  OBSERVATORY_GATES,
  OBSERVATORY_OUTCOMES,
  type ObservatoryFixture,
  type ObservatoryOutcomeIndex,
  type ObservatoryRunEvent,
} from './observatory-data';

const TRANSIT_HOURS = 0.3;
const NEVER_COMPLETES = 99;

interface MutableRun {
  id: string;
  triggerIndex: number;
  agentIndex: number;
  toolIndex: number;
  outcomeIndex: ObservatoryOutcomeIndex;
  requiresApproval: boolean;
  failed: boolean;
  stageTimes: [number, number, number, number, number, number, number, number];
  queueIndex: number;
  landingX: number;
  landingY: number;
  entropy: number;
}

interface QueueEvent {
  readonly hour: number;
  readonly delta: -1 | 1;
  readonly run: MutableRun | null;
}

function createSeededRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function weightedPick<T>(random: () => number, weights: ReadonlyArray<readonly [T, number]>): T {
  const fallback = weights.at(-1);
  if (fallback === undefined) throw new Error('Observatory fixture weights cannot be empty.');
  let total = 0;
  for (const [, weight] of weights) total += weight;
  let target = random() * total;
  for (const [value, weight] of weights) {
    target -= weight;
    if (target <= 0) return value;
  }
  return fallback[0];
}

function exponential(random: () => number, mean: number): number {
  return -Math.log(1 - random()) * mean;
}

function createMutableRun(
  id: number,
  startedAt: number,
  triggerIndex: number,
  agentIndex: number,
): MutableRun {
  return {
    id: `fixture-run-${String(id + 1).padStart(4, '0')}`,
    triggerIndex,
    agentIndex,
    toolIndex: 0,
    outcomeIndex: 0,
    requiresApproval: false,
    failed: false,
    stageTimes: [startedAt, 0, 0, 0, 0, 0, 0, 0],
    queueIndex: 0,
    landingX: OBSERVATORY_GATES[1]?.x ?? 68,
    landingY: OBSERVATORY_GATES[1]?.y ?? 35.5,
    entropy: 0,
  };
}

function freezeRun(run: MutableRun): ObservatoryRunEvent {
  return {
    id: run.id,
    triggerIndex: run.triggerIndex,
    agentIndex: run.agentIndex,
    toolIndex: run.toolIndex,
    outcomeIndex: run.outcomeIndex,
    requiresApproval: run.requiresApproval,
    failed: run.failed,
    stageTimes: [...run.stageTimes],
    queueIndex: run.queueIndex,
    landingX: run.landingX,
    landingY: run.landingY,
    entropy: run.entropy,
  };
}

export function createObservatoryFixture(): ObservatoryFixture {
  const random = createSeededRandom(20_260_818);
  const randomExponential = (mean: number) => exponential(random, mean);
  const runs: MutableRun[] = [];
  const scheduleMix: ReadonlyArray<readonly [number, number]> = [
    [0, 0.45],
    [2, 0.55],
  ];
  const eventMix: ReadonlyArray<readonly [number, number]> = [
    [0, 0.18],
    [1, 0.4],
    [2, 0.02],
    [3, 0.32],
    [4, 0.08],
  ];
  const manualMix: ReadonlyArray<readonly [number, number]> = [
    [0, 0.02],
    [1, 0.12],
    [2, 0.22],
    [3, 0.34],
    [4, 0.3],
  ];

  const spawn = (
    startedAt: number,
    triggerIndex: number,
    mix: ReadonlyArray<readonly [number, number]>,
  ) => {
    runs.push(createMutableRun(runs.length, startedAt, triggerIndex, weightedPick(random, mix)));
  };

  for (let index = 0; index < 210; index += 1) {
    spawn(6 + Math.min(2.4, randomExponential(0.55)), 0, scheduleMix);
  }
  for (let index = 0; index < 70; index += 1) {
    spawn(12 + Math.min(1.5, randomExponential(0.4)), 0, scheduleMix);
  }
  for (let hour = 5; hour < 24; hour += 1) {
    for (let index = 0; index < 12; index += 1) spawn(hour + random(), 0, scheduleMix);
  }

  const eventHourWeights: number[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    let weight = 0.22;
    if (hour >= 8 && hour < 19) weight = 1;
    if (hour >= 10 && hour < 17) weight = 1.5;
    if (hour < 5) weight = 0.1;
    eventHourWeights.push(weight);
  }
  const totalEventHourWeight = eventHourWeights.reduce((total, weight) => total + weight, 0);
  for (let index = 0; index < 1_500; index += 1) {
    let target = random() * totalEventHourWeight;
    let selectedHour = 0;
    for (; selectedHour < eventHourWeights.length; selectedHour += 1) {
      target -= eventHourWeights[selectedHour] ?? 0;
      if (target <= 0) break;
    }
    spawn(Math.min(23.9, selectedHour + random()), 1, eventMix);
  }

  const manualWindows: ReadonlyArray<readonly [number, number, number]> = [
    [8.7, 11.5, 0.42],
    [13.5, 17.2, 0.5],
    [19.4, 20.4, 0.08],
  ];
  for (let index = 0; index < 420; index += 1) {
    let target = random();
    let selectedWindow = manualWindows[0];
    for (const window of manualWindows) {
      if (target < window[2]) {
        selectedWindow = window;
        break;
      }
      target -= window[2];
    }
    if (selectedWindow === undefined) throw new Error('Observatory manual window is unavailable.');
    spawn(selectedWindow[0] + random() * (selectedWindow[1] - selectedWindow[0]), 2, manualMix);
  }

  runs.sort((left, right) => left.stageTimes[0] - right.stageTimes[0]);
  for (const run of runs) {
    const agent = OBSERVATORY_AGENTS[run.agentIndex];
    if (agent === undefined) throw new Error('Observatory fixture selected an unknown agent.');
    run.toolIndex = weightedPick(random, agent.toolWeights);
    run.stageTimes[1] = run.stageTimes[0] + TRANSIT_HOURS;
    run.stageTimes[2] = run.stageTimes[1] + 0.25 + randomExponential(0.3);
    run.stageTimes[3] = run.stageTimes[2] + TRANSIT_HOURS;
    const workDuration = (0.2 + randomExponential(0.28)) * (run.toolIndex === 7 ? 1.6 : 1);
    run.stageTimes[4] = run.stageTimes[3] + workDuration;
    let failureProbability = run.toolIndex === 7 ? 0.1 : 0.035;
    if (run.toolIndex === 7 && run.stageTimes[4] > 13 && run.stageTimes[4] < 14.5) {
      failureProbability *= 3.2;
    }
    run.failed = random() < failureProbability;
    run.requiresApproval = !run.failed && random() < agent.approvalRate;
  }

  const approvalSlots: number[] = [];
  for (let hour = 8.5; hour < 8.85; hour += 0.005) approvalSlots.push(hour);
  for (let hour = 11.5; hour < 11.95; hour += 0.005) approvalSlots.push(hour);
  for (let hour = 16.5; hour < 17.05; hour += 0.005) approvalSlots.push(hour);
  for (let hour = 9.3; hour < 19; hour += 0.55) approvalSlots.push(hour, hour + 0.02);
  approvalSlots.sort((left, right) => left - right);

  const approvalRuns = [...runs.filter((run) => run.requiresApproval)].sort(
    (left, right) => left.stageTimes[4] - right.stageTimes[4],
  );
  let approvalSlotIndex = 0;
  let secondSittingCount = 0;
  for (const run of approvalRuns) {
    run.stageTimes[5] = run.stageTimes[4] + TRANSIT_HOURS;
    while (
      approvalSlotIndex < approvalSlots.length &&
      (approvalSlots[approvalSlotIndex] ?? 0) < run.stageTimes[5]
    ) {
      approvalSlotIndex += 1;
    }
    const slot = approvalSlots[approvalSlotIndex];
    if (slot === undefined) {
      run.stageTimes[6] = NEVER_COMPLETES;
    } else {
      run.stageTimes[6] = slot;
      approvalSlotIndex += 1;
      if (slot >= 11.5 && slot < 11.95) secondSittingCount += 1;
    }
  }

  for (const run of runs) {
    if (run.failed) {
      run.stageTimes[5] = run.stageTimes[4] + TRANSIT_HOURS;
      run.stageTimes[6] = run.stageTimes[5];
      run.stageTimes[7] = run.stageTimes[5];
      run.outcomeIndex = 2;
      continue;
    }
    if (!run.requiresApproval) {
      run.stageTimes[5] = run.stageTimes[4] + TRANSIT_HOURS;
      run.stageTimes[6] = run.stageTimes[5] + 0.05 + random() * 0.1;
      run.outcomeIndex = random() < 0.9 ? 0 : 1;
      run.stageTimes[7] = run.stageTimes[6] + TRANSIT_HOURS;
      continue;
    }
    run.outcomeIndex = random() < 0.72 ? 0 : 1;
    run.stageTimes[7] =
      run.stageTimes[6] >= 90 ? NEVER_COMPLETES : run.stageTimes[6] + TRANSIT_HOURS;
  }

  const queueEvents: QueueEvent[] = [];
  for (const run of approvalRuns) {
    queueEvents.push({ hour: run.stageTimes[5], delta: 1, run });
    if (run.stageTimes[6] < 90) {
      queueEvents.push({ hour: run.stageTimes[6], delta: -1, run: null });
    }
  }
  queueEvents.sort((left, right) => left.hour - right.hour || left.delta - right.delta);

  let queueDepth = 0;
  let peakQueue = 0;
  let peakHour = 0;
  const queueCurve = [{ hour: 0, depth: 0 }];
  for (const event of queueEvents) {
    if (event.delta > 0 && event.run !== null) event.run.queueIndex = queueDepth;
    queueDepth += event.delta;
    queueCurve.push({ hour: event.hour, depth: queueDepth });
    if (event.hour <= 24 && queueDepth > peakQueue) {
      peakQueue = queueDepth;
      peakHour = event.hour;
    }
  }
  let waitingAtMidnight = 0;
  for (const sample of queueCurve) {
    if (sample.hour > 24) break;
    waitingAtMidnight = sample.depth;
  }

  for (const outcomeIndex of [0, 1, 2] as const) {
    const landed = [
      ...runs.filter((run) => run.outcomeIndex === outcomeIndex && run.stageTimes[7] < 90),
    ].sort((left, right) => left.stageTimes[7] - right.stageTimes[7]);
    const cap = [5.1, 3.6, 2.4][outcomeIndex] ?? 2.4;
    const outcome = OBSERVATORY_OUTCOMES[outcomeIndex];
    if (outcome === undefined) throw new Error('Observatory fixture outcome is unavailable.');
    landed.forEach((run, index) => {
      const radius = Math.min(cap, 0.16 * Math.sqrt(index + 1));
      const angle = index * 2.399_963;
      run.landingX = outcome.x + radius * Math.cos(angle);
      run.landingY = outcome.y + radius * Math.sin(angle) * 0.8;
    });
  }

  const agentCounts = OBSERVATORY_AGENTS.map(() => 0);
  for (const run of runs) {
    agentCounts[run.agentIndex] = (agentCounts[run.agentIndex] ?? 0) + 1;
    run.entropy = random();
  }

  let depthAtSecondSitting = 0;
  for (const sample of queueCurve) {
    if (sample.hour > 16.4) break;
    depthAtSecondSitting = sample.depth;
  }
  const numberFormat = new Intl.NumberFormat('en-US');
  const captions = [
    { hour: 5.95, text: '06:00 — the schedulers wake. Morning digests spawn as one river.' },
    { hour: 8.2, text: 'Runs finish into two gates: auto checks and your approval.' },
    {
      hour: 10.1,
      text: 'Runs are finishing faster than you are approving. The waiting pool is growing.',
    },
    {
      hour: 11.5,
      text: `11:30 — you sit down. Twenty minutes of attention clears ${numberFormat.format(secondSittingCount)} runs.`,
    },
    {
      hour: 13.2,
      text: 'The Web connector is having a bad hour. Every falling ember is a failed run.',
    },
    {
      hour: 15.9,
      text: `${numberFormat.format(depthAtSecondSitting)} runs are parked at your approval. The factory was never the bottleneck.`,
    },
    { hour: 16.55, text: 'Second sitting. The waiting pool drains in minutes.' },
    {
      hour: 17.6,
      text: 'After five, nobody approves. The evening queue stacks up unattended.',
    },
    {
      hour: 22.6,
      text: `${numberFormat.format(waitingAtMidnight)} runs remain at the gate for tomorrow’s first decision.`,
    },
  ];

  return {
    provenance: 'fixture',
    runs: runs.map(freezeRun),
    agentCounts,
    queueCurve,
    peakQueue,
    peakHour,
    waitingAtMidnight,
    captions,
  };
}

export const observatoryFixture = createObservatoryFixture();
