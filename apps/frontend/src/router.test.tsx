import type * as ReactRouterDom from 'react-router-dom';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterDom>();
  return {
    ...actual,
    createBrowserRouter: (routes: unknown) => ({ routes }),
  };
});

import { router } from './router';

describe('Paul OS route map', () => {
  it('keeps every numbered section and the Phase 1 compatibility routes reachable', () => {
    const root = router.routes.find((route) => route.path === '/');
    const paths = new Set(root?.children?.map((route) => route.path).filter(Boolean));

    for (const path of [
      'attention',
      'knowledge',
      'build',
      'catalog',
      'operate',
      'connections',
      'evidence',
      'incubator',
      'settings',
      'library',
      'registry',
      'runs',
      'certification/:agentId',
      '*',
    ]) {
      expect(paths.has(path), `Expected /${path} to remain routable`).toBe(true);
    }
  });

  it('retains the Today index route at the platform root', () => {
    const root = router.routes.find((route) => route.path === '/');
    expect(root?.children?.some((route) => route.index === true)).toBe(true);
  });
});
