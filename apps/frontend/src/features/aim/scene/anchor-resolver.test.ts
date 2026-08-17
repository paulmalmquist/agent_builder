import { describe, expect, it } from 'vitest';
import { resolveProxyAnchor } from './anchor-resolver';

describe('resolveProxyAnchor', () => {
  it('resolves exact, alias, and generic-region anchors in order', () => {
    expect(resolveProxyAnchor('s1_thrust')).toMatchObject({
      kind: 'mapped',
      resolution: 'exact',
      anchor: { id: 's1_thrust' },
    });
    expect(resolveProxyAnchor('boattail')).toMatchObject({
      kind: 'mapped',
      resolution: 'alias',
      anchor: { id: 's1_thrust' },
    });
    expect(resolveProxyAnchor('future_boattail', undefined, ['s1_thrust'])).toMatchObject({
      kind: 'mapped',
      resolution: 'alias',
      anchor: { id: 's1_thrust' },
    });
    expect(resolveProxyAnchor('future_stage_2_part', 'stage_2')).toMatchObject({
      kind: 'mapped',
      resolution: 'region',
      anchor: { id: 'avionics_bay' },
    });
  });

  it('returns a stable fallback instead of throwing for unmapped geometry', () => {
    expect(resolveProxyAnchor('not_mapped', 'future')).toEqual({
      kind: 'fallback',
      resolution: 'fallback',
      requestedAnchorId: 'not_mapped',
      fallbackRegion: 'future',
    });
  });
});
