export type ObservatoryOutcomeIndex = 0 | 1 | 2;

export interface ObservatoryTopologyNode {
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly detail?: string | undefined;
}

export interface ObservatoryAgentNode extends ObservatoryTopologyNode {
  readonly id: string;
  readonly tier: string;
  readonly toolWeights: ReadonlyArray<readonly [number, number]>;
  readonly approvalRate: number;
}

export interface ObservatoryRunEvent {
  readonly id: string;
  readonly triggerIndex: number;
  readonly agentIndex: number;
  readonly toolIndex: number;
  readonly outcomeIndex: ObservatoryOutcomeIndex;
  readonly requiresApproval: boolean;
  readonly failed: boolean;
  readonly stageTimes: readonly [number, number, number, number, number, number, number, number];
  readonly queueIndex: number;
  readonly landingX: number;
  readonly landingY: number;
  readonly entropy: number;
}

export interface ObservatoryQueueSample {
  readonly hour: number;
  readonly depth: number;
}

export interface ObservatoryCaption {
  readonly hour: number;
  readonly text: string;
}

export interface ObservatoryFixture {
  readonly provenance: 'fixture';
  readonly runs: readonly ObservatoryRunEvent[];
  readonly agentCounts: readonly number[];
  readonly queueCurve: readonly ObservatoryQueueSample[];
  readonly peakQueue: number;
  readonly peakHour: number;
  readonly waitingAtMidnight: number;
  readonly captions: readonly ObservatoryCaption[];
}

export interface ObservatoryStats {
  readonly running: number;
  readonly waiting: number;
  readonly shipped: number;
  readonly needsYou: number;
  readonly failed: number;
}

export const OBSERVATORY_TRIGGERS: readonly ObservatoryTopologyNode[] = [
  { x: 18, y: 11, name: 'Schedule', detail: 'CRON · DIGESTS' },
  { x: 18, y: 26.5, name: 'Event', detail: 'ALERTS · WEBHOOKS' },
  { x: 18, y: 42, name: 'You ask', detail: 'MANUAL REQUESTS' },
];

export const OBSERVATORY_AGENTS: readonly ObservatoryAgentNode[] = [
  {
    id: 'cost-sentinel',
    x: 34,
    y: 10,
    name: 'Cost sentinel',
    detail: 'T0 · READ-ONLY',
    tier: '00',
    toolWeights: [
      [0, 0.6],
      [1, 0.25],
      [7, 0.15],
    ],
    approvalRate: 0.04,
  },
  {
    id: 'incident-responder',
    x: 34,
    y: 18.5,
    name: 'Incident responder',
    detail: 'T1 · MULTI-SOURCE',
    tier: '01',
    toolWeights: [
      [1, 0.5],
      [2, 0.25],
      [0, 0.25],
    ],
    approvalRate: 0.1,
  },
  {
    id: 'burndown-reporter',
    x: 34,
    y: 27,
    name: 'Burndown reporter',
    detail: 'T2 · DECISION-GRADE',
    tier: '02',
    toolWeights: [
      [4, 0.35],
      [5, 0.35],
      [3, 0.3],
    ],
    approvalRate: 0.12,
  },
  {
    id: 'reconciliation-analyst',
    x: 34,
    y: 35.5,
    name: 'Reconciliation analyst',
    detail: 'T1 · MULTI-SOURCE',
    tier: '03',
    toolWeights: [
      [0, 0.5],
      [6, 0.2],
      [2, 0.15],
      [7, 0.15],
    ],
    approvalRate: 0.15,
  },
  {
    id: 'evidence-packager',
    x: 34,
    y: 44,
    name: 'Evidence packager',
    detail: 'T3 · DRAFTS · GATED',
    tier: '04',
    toolWeights: [
      [4, 0.4],
      [5, 0.3],
      [6, 0.3],
    ],
    approvalRate: 1,
  },
];

export const OBSERVATORY_TOOLS: readonly ObservatoryTopologyNode[] = [
  { x: 52, y: 8, name: 'Warehouse' },
  { x: 52, y: 13.1, name: 'Logs' },
  { x: 52, y: 18.2, name: 'Git' },
  { x: 52, y: 23.3, name: 'Schedule' },
  { x: 52, y: 28.4, name: 'Quality' },
  { x: 52, y: 33.5, name: 'ERP' },
  { x: 52, y: 38.6, name: 'Docs' },
  { x: 52, y: 43.7, name: 'Web' },
];

export const OBSERVATORY_GATES: readonly ObservatoryTopologyNode[] = [
  { x: 68, y: 17.5, name: 'Auto checks' },
  { x: 68, y: 35.5, name: 'Your approval' },
];

export const OBSERVATORY_OUTCOMES: readonly ObservatoryTopologyNode[] = [
  { x: 84, y: 17, name: 'Shipped' },
  { x: 84, y: 30.5, name: 'Needs you' },
  { x: 84, y: 42.5, name: 'Failed' },
];

export function formatObservatoryHour(hour: number): string {
  const bounded = Math.min(23.999, Math.max(0, hour));
  const wholeHours = Math.floor(bounded);
  const minutes = Math.floor((bounded % 1) * 60);
  return `${String(wholeHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function getObservatoryStats(fixture: ObservatoryFixture, hour: number): ObservatoryStats {
  let running = 0;
  let waiting = 0;
  let shipped = 0;
  let needsYou = 0;
  let failed = 0;

  for (const run of fixture.runs) {
    const [startedAt, , , , , arrivedAtGate, leftGate, finishedAt] = run.stageTimes;
    if (hour < startedAt) continue;
    if (finishedAt < 90 && hour >= finishedAt) {
      if (run.outcomeIndex === 0) shipped += 1;
      else if (run.outcomeIndex === 1) needsYou += 1;
      else failed += 1;
      continue;
    }
    if (run.requiresApproval && hour >= arrivedAtGate && hour < Math.min(leftGate, 90)) {
      waiting += 1;
    } else {
      running += 1;
    }
  }

  return { running, waiting, shipped, needsYou, failed };
}

export function queueDepthAt(fixture: ObservatoryFixture, hour: number): number {
  let depth = 0;
  for (const sample of fixture.queueCurve) {
    if (sample.hour > hour) break;
    depth = sample.depth;
  }
  return depth;
}
