import { createBrowserRouter } from 'react-router-dom';
import { NotFoundPage } from './components/NotFoundPage';
import { PlatformShell } from './components/PlatformShell';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: PlatformShell,
    children: [
      {
        index: true,
        lazy: async () => {
          const { AttentionPage } = await import('./features/attention/AttentionPage');
          return { Component: AttentionPage };
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
        path: 'runs',
        lazy: async () => {
          const { RunsPage } = await import('./features/platform/RunsPage');
          return { Component: RunsPage };
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
