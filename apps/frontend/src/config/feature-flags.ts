export interface FrontendFeatureFlags {
  readonly aimEnabled: boolean;
  readonly visualSurfacesEnabled: boolean;
}

interface FeatureFlagEnvironment {
  readonly VITE_AIM_ENABLED?: string | undefined;
  readonly VITE_VISUAL_SURFACES_ENABLED?: string | undefined;
}

export function readFeatureFlags(environment: FeatureFlagEnvironment): FrontendFeatureFlags {
  return {
    aimEnabled: environment.VITE_AIM_ENABLED !== 'false',
    visualSurfacesEnabled: environment.VITE_VISUAL_SURFACES_ENABLED === 'true',
  };
}

export const featureFlags = readFeatureFlags({
  VITE_AIM_ENABLED: import.meta.env.VITE_AIM_ENABLED,
  VITE_VISUAL_SURFACES_ENABLED: import.meta.env.VITE_VISUAL_SURFACES_ENABLED,
});
