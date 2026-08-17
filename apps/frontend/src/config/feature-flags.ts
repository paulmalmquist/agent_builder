export interface FrontendFeatureFlags {
  readonly aimEnabled: boolean;
}

interface FeatureFlagEnvironment {
  readonly VITE_AIM_ENABLED?: string | undefined;
}

export function readFeatureFlags(environment: FeatureFlagEnvironment): FrontendFeatureFlags {
  return {
    aimEnabled: environment.VITE_AIM_ENABLED === 'true',
  };
}

export const featureFlags = readFeatureFlags({
  VITE_AIM_ENABLED: import.meta.env.VITE_AIM_ENABLED,
});
