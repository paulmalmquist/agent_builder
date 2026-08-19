export const SIGNAL_GROUPS = ['AGENTS', 'CONNECTORS', 'STREAMS', 'PROGRAM', 'YOU'] as const;

export type SignalGroup = (typeof SIGNAL_GROUPS)[number];
export type SignalWallSortMode = 'attention' | 'grouped';

export interface SignalWallSignal {
  readonly id: string;
  readonly label: string;
  readonly group: SignalGroup;
  readonly currentLabel: string;
  readonly usualLabel: string;
  /** Normalized distance from the signal's usual range, clamped to [-1, 1]. */
  readonly history: readonly number[];
  readonly reason: string | null;
}

export interface SignalWallInput {
  readonly generatedAt: string;
  readonly historyHours: number;
  readonly sampleCount: number;
  readonly isFixture: boolean;
  readonly signals: readonly SignalWallSignal[];
}

export interface SignalWallSummary {
  readonly needsReview: number;
  readonly watch: number;
  readonly quiet: number;
}

export type SignalWallStatus = 'needs-review' | 'watch' | 'quiet';

export interface SignalWallSignalSnapshot {
  readonly signalId: string;
  readonly deviation: number;
  readonly anomaly: number;
  readonly valueLabel: string;
  readonly detail: string;
  readonly status: SignalWallStatus;
}

export interface SignalWallVisibleRow {
  readonly signalId: string;
  readonly order: number;
  readonly top: number;
  readonly height: number;
  readonly representative: boolean;
}

export interface SignalWallGroupPosition {
  readonly group: SignalGroup;
  readonly top: number;
  readonly height: number;
  readonly signalCount: number;
}

/** A throttled, DOM-safe projection of the exact replay head painted by WebGL. */
export interface SignalWallSceneSnapshot {
  readonly sampleIndex: number;
  readonly sampleCount: number;
  readonly isLatest: boolean;
  readonly elapsedHours: number;
  readonly orderedSignalIds: readonly string[];
  readonly topSignalIds: readonly string[];
  readonly visibleRows: readonly SignalWallVisibleRow[];
  readonly groups: readonly SignalWallGroupPosition[];
  readonly signals: readonly SignalWallSignalSnapshot[];
  readonly summary: SignalWallSummary;
}

export interface SignalWallScene {
  setMode(mode: SignalWallSortMode): void;
  setReplaying(replaying: boolean): void;
  destroy(): void;
}

export interface SignalWallSceneOptions {
  readonly input: SignalWallInput;
  readonly mode: SignalWallSortMode;
  readonly replaying: boolean;
  readonly reducedMotion: boolean;
  readonly onUnavailable: () => void;
  readonly onRankingChange?: ((signalIds: readonly string[]) => void) | undefined;
  readonly onSnapshot?: ((snapshot: SignalWallSceneSnapshot) => void) | undefined;
}
