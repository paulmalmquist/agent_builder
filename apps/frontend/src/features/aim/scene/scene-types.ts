export type AimLifecycle = 'planned' | 'poc' | 'pilot' | 'production' | 'retired';

export type AimReadiness = 'unknown' | 'no_go' | 'conditional' | 'go';

export type AimMaterialMode =
  | 'wireframe'
  | 'additive_reveal'
  | 'partial_scaffold'
  | 'solid'
  | 'ghost';

export type ProxyShape = 'box' | 'cylinder' | 'cone' | 'engine_cluster';

export type Vector3Tuple = readonly [x: number, y: number, z: number];

export interface ProxyAnchor {
  readonly id: string;
  readonly aliases: readonly string[];
  readonly region: string;
  readonly shape: ProxyShape;
  readonly position: Vector3Tuple;
  readonly scale: Vector3Tuple;
}

export interface ResolvedProxyAnchor {
  readonly kind: 'mapped';
  readonly resolution: 'exact' | 'alias' | 'region';
  readonly requestedAnchorId: string;
  readonly anchor: ProxyAnchor;
}

export interface UnmappedProxyAnchor {
  readonly kind: 'fallback';
  readonly resolution: 'fallback';
  readonly requestedAnchorId: string;
  readonly fallbackRegion?: string;
}

export type ProxyAnchorResolution = ResolvedProxyAnchor | UnmappedProxyAnchor;

export interface AimEvidenceLine {
  readonly id: string;
  readonly label: string;
  readonly sourceLabel: string;
  readonly observedAt: string;
  readonly freshness: 'current' | 'stale' | 'unknown';
}

export interface AimLatencyReadout {
  readonly baseline?: string;
  readonly current?: string;
  readonly target?: string;
}

export interface AimScenePart {
  readonly id: string;
  readonly label: string;
  readonly anchor: ProxyAnchorResolution;
  readonly lifecycle: AimLifecycle;
  readonly readiness: AimReadiness;
  readonly evidenceState: 'satisfied' | 'missing' | 'stale' | 'not_required';
  readonly evidenceMessage: string;
  readonly material: AimMaterialMode;
  readonly additiveRevealProgress: number;
  readonly problem: string;
  readonly capabilityLabels: readonly string[];
  readonly groupLabels: readonly string[];
  readonly primaryOwner?: string;
  readonly decisionLoopLabels: readonly string[];
  readonly latency: AimLatencyReadout;
  readonly evidence: readonly AimEvidenceLine[];
  readonly sourceLabels: readonly string[];
  readonly lastSynchronizedAt?: string;
  readonly unlockLabels: readonly string[];
  readonly dependencyLabels: readonly string[];
}

export interface AimSceneModel {
  readonly programId: string;
  readonly label: string;
  readonly description?: string;
  readonly asOf: string;
  readonly geometryDisclaimer: string;
  readonly isSynthetic: boolean;
  readonly parts: readonly AimScenePart[];
}

export interface AimVehicleRenderer {
  readonly mode: 'webgl';
  setModel(model: AimSceneModel, options: { reducedMotion: boolean }): void;
  resize(width: number, height: number): void;
  pick(clientX: number, clientY: number): string | null;
  dispose(): void;
}

export type AimVehicleRendererFactory = (
  canvas: HTMLCanvasElement,
  model: AimSceneModel,
  options: { reducedMotion: boolean },
) => AimVehicleRenderer;
