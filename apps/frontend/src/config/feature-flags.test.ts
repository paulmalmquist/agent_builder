import { describe, expect, it } from 'vitest';
import { readFeatureFlags } from './feature-flags';

describe('readFeatureFlags', () => {
  it('keeps AIM available unless explicitly disabled', () => {
    expect(readFeatureFlags({}).aimEnabled).toBe(true);
    expect(readFeatureFlags({ VITE_AIM_ENABLED: 'false' }).aimEnabled).toBe(false);
    expect(readFeatureFlags({ VITE_AIM_ENABLED: 'TRUE' }).aimEnabled).toBe(true);
  });

  it('accepts the documented true value', () => {
    expect(readFeatureFlags({ VITE_AIM_ENABLED: 'true' }).aimEnabled).toBe(true);
  });

  it('keeps optional visual surfaces off unless the value is exactly true', () => {
    expect(readFeatureFlags({}).visualSurfacesEnabled).toBe(false);
    expect(readFeatureFlags({ VITE_VISUAL_SURFACES_ENABLED: 'false' }).visualSurfacesEnabled).toBe(
      false,
    );
    expect(readFeatureFlags({ VITE_VISUAL_SURFACES_ENABLED: 'TRUE' }).visualSurfacesEnabled).toBe(
      false,
    );
    expect(readFeatureFlags({ VITE_VISUAL_SURFACES_ENABLED: '1' }).visualSurfacesEnabled).toBe(
      false,
    );
    expect(readFeatureFlags({ VITE_VISUAL_SURFACES_ENABLED: 'true' }).visualSurfacesEnabled).toBe(
      true,
    );
  });
});
