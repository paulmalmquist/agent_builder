export const HISTORY_TERRAIN_SCHEMA_VERSION = 'paul-os.history-terrain/v1' as const;

export interface HistoryTerrainWeek {
  readonly id: string;
  readonly startsAt: string;
}

export interface HistoryTerrainStream {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  /** Relative work landed during each week. Values are non-negative. */
  readonly actual: readonly number[];
  /** Relative work promised during each week. Values are non-negative. */
  readonly plan: readonly number[];
  /** Review-queue pressure from 0 (none) through 1 (maximum fixture intensity). */
  readonly reviewJam: readonly number[];
}

export interface HistoryTerrainBeacon {
  readonly id: string;
  readonly streamId: string;
  readonly weekIndex: number;
  readonly label: string;
  readonly state: 'slipped';
}

export interface HistoryTerrainCaption {
  readonly id: string;
  readonly weekIndex: number;
  readonly lead: string;
  readonly detail: string;
}

export interface HistoryTerrainInput {
  readonly schemaVersion: typeof HISTORY_TERRAIN_SCHEMA_VERSION;
  readonly title: string;
  readonly description: string;
  readonly provenance: {
    readonly kind: 'fixture' | 'live';
    readonly label: string;
  };
  readonly weeks: readonly HistoryTerrainWeek[];
  readonly streams: readonly HistoryTerrainStream[];
  readonly beacons: readonly HistoryTerrainBeacon[];
  readonly captions: readonly HistoryTerrainCaption[];
}

export interface HistoryTerrainPoint {
  readonly streamId: string;
  readonly weekIndex: number;
  readonly x: number;
  readonly y: number;
}

export interface HistoryTerrainProjectedLabel {
  readonly streamId: string;
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}
