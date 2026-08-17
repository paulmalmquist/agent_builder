import { describe, expect, it } from 'vitest';
import { readFeatureFlags } from './feature-flags';

describe('readFeatureFlags', () => {
  it('keeps AIM closed unless explicitly enabled', () => {
    expect(readFeatureFlags({}).aimEnabled).toBe(false);
    expect(readFeatureFlags({ VITE_AIM_ENABLED: 'false' }).aimEnabled).toBe(false);
    expect(readFeatureFlags({ VITE_AIM_ENABLED: 'TRUE' }).aimEnabled).toBe(false);
  });

  it('enables AIM only for the exact true value', () => {
    expect(readFeatureFlags({ VITE_AIM_ENABLED: 'true' }).aimEnabled).toBe(true);
  });
});
