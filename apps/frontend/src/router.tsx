import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { NotFoundPage } from './components/NotFoundPage';
import { PlatformShell } from './components/PlatformShell';
import { featureFlags } from './config/feature-flags';

const aimRoutes: RouteObject[] = featureFlags.aimEnabled
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

export const router = createBrowserRouter([
  {
    path: '/',
    Component: PlatformShell,
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
        path: 'settings',
        lazy: async () => {
          const { SettingsPage } = await import('./features/settings/SettingsPage');
          return { Component: SettingsPage };
        },
      },
      ...aimRoutes,
      {
        path: 'certification/:agentId',
        lazy: async () => {
          const { CertificationPage } = await import('./features/certification/CertificationPage');
          return { Component: CertificationPage };
        },
      },
      { path: '*', Component: NotFoundPage },
    ],
  },
]);
