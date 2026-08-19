import type * as ReactRouterDom from 'react-router-dom';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterDom>();
  return {
    ...actual,
    createBrowserRouter: (routes: unknown) => ({ routes }),
  };
});

import { createPaulOsRouteObjects, router } from './router';

const defaultFlags = { aimEnabled: true, visualSurfacesEnabled: false } as const;

function routePaths(visualSurfacesEnabled: boolean): {
  child: Set<string>;
  topLevel: Set<string>;
} {
  const routes = createPaulOsRouteObjects({ ...defaultFlags, visualSurfacesEnabled });
  const root = routes.find((route) => route.path === '/');
  return {
    child: new Set(
      root?.children?.map((route) => route.path).filter((path): path is string => !!path),
    ),
    topLevel: new Set(routes.map((route) => route.path).filter((path): path is string => !!path)),
  };
}

describe('Paul OS route map', () => {
  it('keeps every numbered section and the Phase 1 compatibility routes reachable', () => {
    const root = router.routes.find((route) => route.path === '/');
    const paths = new Set(root?.children?.map((route) => route.path).filter(Boolean));

    for (const path of [
      'attention',
      'knowledge',
      'aim',
      'build',
      'catalog',
      'operate',
      'connections',
      'evidence',
      'incubator',
      'roadmaps',
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

  it('keeps every optional visual route absent when visual surfaces are disabled', () => {
    const paths = routePaths(false);
    expect(paths.child.has('observatory')).toBe(false);
    expect(paths.child.has('history')).toBe(false);
    expect(paths.child.has('bench/:agentId')).toBe(false);
    expect(paths.topLevel.has('/wall')).toBe(false);
  });

  it('adds console visual routes and keeps the Signal Wall outside the shell when enabled', () => {
    const paths = routePaths(true);
    expect(paths.child.has('observatory')).toBe(true);
    expect(paths.child.has('history')).toBe(true);
    expect(paths.child.has('bench/:agentId')).toBe(true);
    expect(paths.child.has('wall')).toBe(false);
    expect(paths.topLevel.has('/wall')).toBe(true);
  });
});
