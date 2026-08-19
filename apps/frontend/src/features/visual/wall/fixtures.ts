import type { SignalGroup, SignalWallInput, SignalWallSignal } from './types';

const SAMPLE_COUNT = 512;

interface SignalSeed {
  readonly label: string;
  readonly group: SignalGroup;
  readonly currentLabel: string;
  readonly usualLabel: string;
  readonly incident?: {
    readonly start: number;
    readonly direction: 1 | -1;
    readonly peak: number;
    readonly reason: string;
  };
}

function mulberry32(seed: number): () => number {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function signalHistory(seed: SignalSeed, index: number): readonly number[] {
  const random = mulberry32(20260819 + index * 977);
  let current = (random() - 0.5) * 0.12;

  return Array.from({ length: SAMPLE_COUNT }, (_, sampleIndex) => {
    const wave = Math.sin((sampleIndex + index * 9) / 42) * 0.07;
    current = current * 0.9 + (random() - 0.5) * 0.12;
    const incident = seed.incident;
    const incidentProgress = incident
      ? Math.max(0, Math.min(1, (sampleIndex - incident.start) / 88))
      : 0;
    const deviation =
      current + wave + (incident?.direction ?? 1) * (incident?.peak ?? 0) * incidentProgress;
    return Math.max(-1, Math.min(1, deviation));
  });
}

function toSignal(seed: SignalSeed, index: number): SignalWallSignal {
  return {
    id: `${seed.group.toLowerCase()}-${slug(seed.label)}`,
    label: seed.label,
    group: seed.group,
    currentLabel: seed.currentLabel,
    usualLabel: seed.usualLabel,
    history: signalHistory(seed, index),
    reason: seed.incident?.reason ?? null,
  };
}

function agentSeeds(): readonly SignalSeed[] {
  const agents = [
    'cost sentinel',
    'blast-radius analyst',
    'freshness watch',
    'incident responder',
    'metric reconciler',
    'orphan reviewer',
    'burndown reporter',
    'as-built reconciler',
    'genealogy tracer',
    'drift sentinel',
    'hot-fire quicklook',
    'recurrence analyst',
    'evidence packager',
    'intake router',
    'supplier escalator',
    'scrap transaction agent',
  ] as const;

  return agents.flatMap((agent, agentIndex): SignalSeed[] => [
    {
      label: `${agent} · fail rate`,
      group: 'AGENTS',
      currentLabel: `${(1.2 + agentIndex * 0.09).toFixed(1)}%`,
      usualLabel: '1.8%',
      ...(agent === 'evidence packager'
        ? {
            incident: {
              start: 430,
              direction: 1 as const,
              peak: 0.72,
              reason: 'Failures are rising ahead of the next review.',
            },
          }
        : {}),
    },
    {
      label: `${agent} · p95 latency`,
      group: 'AGENTS',
      currentLabel: `${980 + agentIndex * 91} ms`,
      usualLabel: '1,340 ms',
      ...(agent === 'hot-fire quicklook'
        ? {
            incident: {
              start: 372,
              direction: 1 as const,
              peak: 0.86,
              reason: 'Latency stepped up after the fixture schema change.',
            },
          }
        : {}),
    },
    {
      label: `${agent} · runs per hour`,
      group: 'AGENTS',
      currentLabel: `${(3.2 + agentIndex * 0.6).toFixed(1)}/hr`,
      usualLabel: '7.0/hr',
    },
  ]);
}

function connectorSeeds(): readonly SignalSeed[] {
  const connectors = [
    'warehouse',
    'logs',
    'git',
    'schedule',
    'quality',
    'enterprise resource planning',
    'docs',
    'web',
    'collaboration',
    'broker',
    'sandbox',
    'local files',
  ] as const;

  return connectors.flatMap((connector, index): SignalSeed[] => [
    {
      label: `${connector} · error rate`,
      group: 'CONNECTORS',
      currentLabel: connector === 'web' ? '12.5%' : `${(0.5 + index * 0.08).toFixed(1)}%`,
      usualLabel: '0.8%',
      ...(connector === 'web'
        ? {
            incident: {
              start: 420,
              direction: 1 as const,
              peak: 0.93,
              reason: 'One call in eight is failing in the fixture replay.',
            },
          }
        : {}),
    },
    {
      label: `${connector} · calls per hour`,
      group: 'CONNECTORS',
      currentLabel: `${72 + index * 31}/hr`,
      usualLabel: '210/hr',
    },
  ]);
}

function streamSeeds(): readonly SignalSeed[] {
  const streams = [
    '00 core',
    '01 context',
    '02 skills',
    '03 projects',
    '04 automation',
    '05 reference',
    '06 domains',
    '07 protocols',
    '08 knowledge',
    '09 evaluations',
    '10 metrics',
    '11 incubator',
    '12 agents',
  ] as const;

  return [
    ...streams.map((stream, index) => ({
      label: `${stream} · open items`,
      group: 'STREAMS' as const,
      currentLabel: `${4 + index * 2}`,
      usualLabel: '14',
    })),
    {
      label: '09 evaluations · pass rate',
      group: 'STREAMS' as const,
      currentLabel: '94.2%',
      usualLabel: '93.0%',
    },
  ];
}

const programSeeds: readonly SignalSeed[] = [
  {
    label: 'approval queue age',
    group: 'PROGRAM',
    currentLabel: '6.4 h',
    usualLabel: '3.2 h',
    incident: {
      start: 332,
      direction: 1,
      peak: 0.78,
      reason: 'The oldest waiting approval has doubled since the fixture morning.',
    },
  },
  { label: 'approval queue depth', group: 'PROGRAM', currentLabel: '14', usualLabel: '8' },
  { label: 'decisions waiting', group: 'PROGRAM', currentLabel: '6', usualLabel: '4' },
  { label: 'evidence age', group: 'PROGRAM', currentLabel: '20 h', usualLabel: '18 h' },
  { label: 'run cost per hour', group: 'PROGRAM', currentLabel: '11', usualLabel: '9' },
  { label: 'token spend per hour', group: 'PROGRAM', currentLabel: '420', usualLabel: '390' },
  { label: 'active runs', group: 'PROGRAM', currentLabel: '38', usualLabel: '34' },
  { label: 'review latency', group: 'PROGRAM', currentLabel: '2.1 h', usualLabel: '1.8 h' },
  { label: 'error budget burn', group: 'PROGRAM', currentLabel: '4.0%', usualLabel: '2.8%' },
  { label: 'catalog freshness', group: 'PROGRAM', currentLabel: '30 h', usualLabel: '24 h' },
  { label: 'broker heartbeat gap', group: 'PROGRAM', currentLabel: '400 ms', usualLabel: '320 ms' },
  { label: 'evaluation queue depth', group: 'PROGRAM', currentLabel: '3', usualLabel: '2' },
];

const personalSeeds: readonly SignalSeed[] = [
  { label: 'focus hours', group: 'YOU', currentLabel: '3.4 h', usualLabel: '3.0 h' },
  { label: 'meetings', group: 'YOU', currentLabel: '4', usualLabel: '4' },
  { label: 'interruptions', group: 'YOU', currentLabel: '5', usualLabel: '4' },
  { label: 'inbox depth', group: 'YOU', currentLabel: '22', usualLabel: '18' },
  { label: 'decisions cleared', group: 'YOU', currentLabel: '9', usualLabel: '8' },
  { label: 'deep-work streak', group: 'YOU', currentLabel: '1.8 h', usualLabel: '2.0 h' },
  { label: 'context switches', group: 'YOU', currentLabel: '14', usualLabel: '12' },
  { label: 'after-hours pings', group: 'YOU', currentLabel: '2', usualLabel: '1' },
];

const seeds = [
  ...agentSeeds(),
  ...connectorSeeds(),
  ...streamSeeds(),
  ...programSeeds,
  ...personalSeeds,
];

export const signalWallFixture: SignalWallInput = {
  generatedAt: '2026-08-18T13:00:00.000Z',
  historyHours: 8.5,
  sampleCount: SAMPLE_COUNT,
  isFixture: true,
  signals: seeds.map(toSignal),
};

export function signalAnomaly(signal: SignalWallSignal): number {
  return signal.history.slice(-40).reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0);
}

export function rankedSignals(input: SignalWallInput): readonly SignalWallSignal[] {
  return [...input.signals].sort((left, right) => signalAnomaly(right) - signalAnomaly(left));
}
