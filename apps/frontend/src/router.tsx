import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { NotFoundPage } from './components/NotFoundPage';
import { PlatformShell } from './components/PlatformShell';
import { featureFlags, type FrontendFeatureFlags } from './config/feature-flags';

function createAimRoutes(flags: FrontendFeatureFlags): RouteObject[] {
  return flags.aimEnabled
    ? [
        {
          path: 'aim',
          lazy: async () => {
            const { AimRoute } = await import('./features/aim/AimRoute');
            return { Component: AimRoute };
          },
        },
      ]
    : [];
}

function createVisualRoutes(flags: FrontendFeatureFlags): RouteObject[] {
  return flags.visualSurfacesEnabled
    ? [
        {
          path: 'observatory',
          lazy: async () => {
            const { ObservatoryPage } = await import(
              './features/visual/observatory/ObservatoryPage'
            );
            return { Component: ObservatoryPage };
          },
        },
        {
          path: 'history',
          lazy: async () => {
            const { HistoryTerrainRoute } = await import(
              './features/visual/terrain/HistoryTerrain'
            );
            return { Component: HistoryTerrainRoute };
          },
        },
        {
          path: 'bench/:agentId',
          lazy: async () => {
            const { AssemblyBenchRoute } = await import('./features/visual/bench/AssemblyBench');
            return { Component: AssemblyBenchRoute };
          },
        },
      ]
    : [];
}

function createFullscreenVisualRoutes(flags: FrontendFeatureFlags): RouteObject[] {
  return flags.visualSurfacesEnabled
    ? [
        {
          path: '/wall',
          hydrateFallbackElement: (
            <main className="platform-hydrate-fallback" tabIndex={-1}>
              <p role="status">Loading signal wall…</p>
            </main>
          ),
          lazy: async () => {
            const { SignalWallPage } = await import('./features/visual/wall/SignalWallPage');
            return { Component: SignalWallPage };
          },
        },
      ]
    : [];
}

export function createPaulOsRouteObjects(
  flags: FrontendFeatureFlags = featureFlags,
): RouteObject[] {
  return [
    {
      path: '/',
      Component: PlatformShell,
      hydrateFallbackElement: (
        <main className="platform-hydrate-fallback" id="platform-main" tabIndex={-1}>
          <p role="status">Loading Paul OS…</p>
        </main>
      ),
      children: [
        {
          index: true,
          lazy: async () => {
            const { HomePage } = await import('./features/home/HomePage');
            return { Component: HomePage };
          },
        },
        {
          path: 'attention',
          lazy: async () => {
            const { AttentionPage } = await import('./features/attention/AttentionPage');
            return { Component: AttentionPage };
          },
        },
        {
          path: 'knowledge',
          lazy: async () => {
            const { KnowledgePage } = await import('./features/knowledge/KnowledgePage');
            return { Component: KnowledgePage };
          },
        },
        {
          path: 'build',
          lazy: async () => {
            const { App } = await import('./App');
            return { Component: App };
          },
        },
        {
          path: 'catalog',
          lazy: async () => {
            const { CatalogPage } = await import('./features/platform/CatalogPage');
            return { Component: CatalogPage };
          },
        },
        {
          path: 'library',
          lazy: async () => {
            const { LibraryPage } = await import('./features/library/LibraryPage');
            return { Component: LibraryPage };
          },
        },
        {
          path: 'registry',
          lazy: async () => {
            const { RegistryPage } = await import('./features/platform/RegistryPage');
            return { Component: RegistryPage };
          },
        },
        {
          path: 'operate',
          lazy: async () => {
            const { RunsPage } = await import('./features/platform/RunsPage');
            return { Component: RunsPage };
          },
        },
        {
          path: 'runs',
          lazy: async () => {
            const { RunsPage } = await import('./features/platform/RunsPage');
            return { Component: RunsPage };
          },
        },
        {
          path: 'connections',
          lazy: async () => {
            const { ConnectionsPage } = await import('./features/platform/ConnectionsPage');
            return { Component: ConnectionsPage };
          },
        },
        {
          path: 'evidence',
          lazy: async () => {
            const { EvidencePage } = await import('./features/platform/EvidencePage');
            return { Component: EvidencePage };
          },
        },
        {
          path: 'incubator',
          lazy: async () => {
            const { IncubatorPage } = await import('./features/platform/IncubatorPage');
            return { Component: IncubatorPage };
          },
        },
        {
          path: 'roadmaps',
          lazy: async () => {
            const { RoadmapsPage } = await import('./features/roadmaps/RoadmapsPage');
            return { Component: RoadmapsPage };
          },
        },
        {
          path: 'settings',
          lazy: async () => {
            const { SettingsPage } = await import('./features/settings/SettingsPage');
            return { Component: SettingsPage };
          },
        },
        {
          path: 'selftest',
          lazy: async () => {
            const { SelfTestPage } = await import('./features/selftest/SelfTestPage');
            return { Component: SelfTestPage };
          },
        },
        ...createAimRoutes(flags),
        ...createVisualRoutes(flags),
        {
          path: 'certification/:agentId',
          lazy: async () => {
            const { CertificationPage } = await import(
              './features/certification/CertificationPage'
            );
            return { Component: CertificationPage };
          },
        },
        { path: '*', Component: NotFoundPage },
      ],
    },
    ...createFullscreenVisualRoutes(flags),
  ];
}

export const router = createBrowserRouter(createPaulOsRouteObjects());
