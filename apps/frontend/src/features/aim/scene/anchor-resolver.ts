import type { ProxyAnchor, ProxyAnchorResolution } from './scene-types';

const proxyAnchors = [
  {
    id: 's1_engines',
    aliases: ['stage_1_engines', 'booster_engines'],
    region: 'stage_1',
    shape: 'engine_cluster',
    position: [0, -4.25, 0],
    scale: [1.45, 0.55, 1.45],
  },
  {
    id: 's1_thrust',
    aliases: ['stage_1_thrust', 'boattail'],
    region: 'stage_1',
    shape: 'cone',
    position: [0, -3.7, 0],
    scale: [1.18, 0.72, 1.18],
  },
  {
    id: 's1_fuel_tank',
    aliases: ['stage_1_fuel'],
    region: 'stage_1',
    shape: 'cylinder',
    position: [0, -2.55, 0],
    scale: [1, 1.45, 1],
  },
  {
    id: 's1_lox_tank',
    aliases: ['stage_1_lox'],
    region: 'stage_1',
    shape: 'cylinder',
    position: [0, -1.2, 0],
    scale: [1, 1.22, 1],
  },
  {
    id: 's1_intertank',
    aliases: ['stage_1_intertank', 'common_dome'],
    region: 'stage_1',
    shape: 'cylinder',
    position: [0, -0.25, 0],
    scale: [1.02, 0.3, 1.02],
  },
  {
    id: 's1_feedlines',
    aliases: ['feedlines', 'downcomer'],
    region: 'stage_1',
    shape: 'cylinder',
    position: [0.86, -1.9, 0],
    scale: [0.1, 2.25, 0.1],
  },
  {
    id: 'interstage',
    aliases: ['stage_interstage'],
    region: 'interstage',
    shape: 'cylinder',
    position: [0, 0.35, 0],
    scale: [0.9, 0.46, 0.9],
  },
  {
    id: 's2_engine',
    aliases: ['stage_2_engine', 'vacuum_engine'],
    region: 'stage_2',
    shape: 'cone',
    position: [0, 0.92, 0],
    scale: [0.62, 0.66, 0.62],
  },
  {
    id: 's2_fuel_tank',
    aliases: ['stage_2_fuel'],
    region: 'stage_2',
    shape: 'cylinder',
    position: [0, 1.75, 0],
    scale: [0.72, 0.82, 0.72],
  },
  {
    id: 's2_lox_tank',
    aliases: ['stage_2_lox'],
    region: 'stage_2',
    shape: 'cylinder',
    position: [0, 2.55, 0],
    scale: [0.72, 0.78, 0.72],
  },
  {
    id: 'avionics_bay',
    aliases: ['avionics'],
    region: 'stage_2',
    shape: 'cylinder',
    position: [0, 3.12, 0],
    scale: [0.74, 0.26, 0.74],
  },
  {
    id: 'fts',
    aliases: ['flight_termination_system', 'override_policy'],
    region: 'stage_2',
    shape: 'box',
    position: [0.7, 3.12, 0],
    scale: [0.14, 0.2, 0.14],
  },
  {
    id: 'payload_adapter',
    aliases: ['adapter'],
    region: 'payload',
    shape: 'cone',
    position: [0, 3.55, 0],
    scale: [0.7, 0.34, 0.7],
  },
  {
    id: 'payload',
    aliases: ['payload_manifest'],
    region: 'payload',
    shape: 'box',
    position: [0, 4.02, 0],
    scale: [0.48, 0.42, 0.48],
  },
  {
    id: 'fairing',
    aliases: ['payload_fairing'],
    region: 'payload',
    shape: 'cone',
    position: [0, 4.55, 0],
    scale: [0.78, 0.8, 0.78],
  },
  {
    id: 'stargate',
    aliases: ['additive_printer'],
    region: 'factory',
    shape: 'box',
    position: [-3.3, -1.45, -0.2],
    scale: [0.7, 2.9, 0.7],
  },
  {
    id: 'gantries',
    aliases: ['robotic_arms'],
    region: 'factory',
    shape: 'box',
    position: [-2.7, 0.15, 0.25],
    scale: [0.32, 2.3, 0.32],
  },
  {
    id: 'scanner',
    aliases: ['scanner_plane'],
    region: 'factory',
    shape: 'box',
    position: [-1.75, 0.25, 0],
    scale: [0.12, 2.6, 1.25],
  },
  {
    id: 'sensors',
    aliases: ['sensor_nodes'],
    region: 'ground',
    shape: 'box',
    position: [2.75, -3.4, 0],
    scale: [0.38, 0.38, 0.38],
  },
  {
    id: 'test_stand',
    aliases: ['integration_test_stand'],
    region: 'ground',
    shape: 'box',
    position: [3.45, -2.2, 0],
    scale: [0.95, 1.75, 0.95],
  },
  {
    id: 'gse',
    aliases: ['ground_support'],
    region: 'ground',
    shape: 'box',
    position: [2.9, -0.65, 0],
    scale: [0.55, 0.55, 0.55],
  },
  {
    id: 'prop_farm',
    aliases: ['propellant_farm'],
    region: 'ground',
    shape: 'cylinder',
    position: [3.75, 0.65, 0],
    scale: [0.62, 0.82, 0.62],
  },
  {
    id: 'range_safety',
    aliases: ['safety_console'],
    region: 'ground',
    shape: 'box',
    position: [2.85, 2.05, 0],
    scale: [0.62, 0.42, 0.62],
  },
  {
    id: 'fd_console',
    aliases: ['flight_director_console'],
    region: 'ground',
    shape: 'box',
    position: [3.75, 3.15, 0],
    scale: [0.62, 0.42, 0.62],
  },
] as const satisfies readonly ProxyAnchor[];

const anchorsById: ReadonlyMap<string, ProxyAnchor> = new Map(
  proxyAnchors.map((anchor) => [anchor.id, anchor]),
);
const anchorsByAlias: ReadonlyMap<string, ProxyAnchor> = new Map(
  proxyAnchors.flatMap((anchor) => anchor.aliases.map((alias) => [alias, anchor] as const)),
);

const genericRegionAnchors = new Map<string, ProxyAnchor>([
  ['stage_1', anchorsById.get('s1_intertank')!],
  ['stage_one_region', anchorsById.get('s1_intertank')!],
  ['interstage', anchorsById.get('interstage')!],
  ['stage_2', anchorsById.get('avionics_bay')!],
  ['stage_two_region', anchorsById.get('avionics_bay')!],
  ['payload', anchorsById.get('payload')!],
  ['payload_region', anchorsById.get('payload')!],
  ['factory', anchorsById.get('stargate')!],
  ['ground', anchorsById.get('test_stand')!],
]);

export function resolveProxyAnchor(
  requestedAnchorId: string,
  fallbackRegion?: string,
  configuredAliases: readonly string[] = [],
): ProxyAnchorResolution {
  const exact = anchorsById.get(requestedAnchorId);
  if (exact) {
    return { kind: 'mapped', resolution: 'exact', requestedAnchorId, anchor: exact };
  }

  const alias = anchorsByAlias.get(requestedAnchorId);
  if (alias) {
    return { kind: 'mapped', resolution: 'alias', requestedAnchorId, anchor: alias };
  }

  for (const configuredAlias of configuredAliases) {
    const configured = anchorsById.get(configuredAlias) ?? anchorsByAlias.get(configuredAlias);
    if (configured) {
      return {
        kind: 'mapped',
        resolution: 'alias',
        requestedAnchorId,
        anchor: configured,
      };
    }
  }

  const region = fallbackRegion
    ? (genericRegionAnchors.get(fallbackRegion) ??
      genericRegionAnchors.get(fallbackRegion.replace(/^region_/, '')))
    : undefined;
  if (region) {
    return { kind: 'mapped', resolution: 'region', requestedAnchorId, anchor: region };
  }

  return {
    kind: 'fallback',
    resolution: 'fallback',
    requestedAnchorId,
    ...(fallbackRegion ? { fallbackRegion } : {}),
  };
}

export function listProxyAnchors(): readonly ProxyAnchor[] {
  return proxyAnchors;
}
