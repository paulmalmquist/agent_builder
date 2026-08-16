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
