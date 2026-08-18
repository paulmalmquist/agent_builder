import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { GlobalAgentSearch } from './GlobalAgentSearch';
import { StarfieldCanvas } from './StarfieldCanvas';
import { AgentDetailDrawer } from '../features/library/AgentDetailDrawer';
import { AgentDrawerContext, type AgentDrawerContextValue } from './agent-drawer-context';
import { useAttention } from '../api/hooks';
import { PlatformRail, type PlatformRailItem } from './PlatformRail';

const railStorageKey = 'paul-os:rail-collapsed:v1';
const resumeStorageKey = 'paul-os:resume-route:v1';

function initialRailState(): boolean {
  return window.localStorage.getItem(railStorageKey) === 'true';
}

function initialResumeRoute(): string | null {
  const stored = window.localStorage.getItem(resumeStorageKey);
  if (!stored?.startsWith('/') || stored.startsWith('//')) return null;
  try {
    const parsed = new URL(stored, window.location.origin);
    if (parsed.origin !== window.location.origin || parsed.pathname === '/') return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

function currentResumableRoute(pathname: string, search: string): string | null {
  if (pathname === '/build') return `${pathname}${search}`;
  if (pathname === '/attention') return pathname;
  if (pathname === '/knowledge' && new URLSearchParams(search).has('entity')) {
    return `${pathname}${search}`;
  }
  if (pathname.startsWith('/certification/')) return `${pathname}${search}`;
  return null;
}

export function PlatformShell() {
  const location = useLocation();
  const attention = useAttention();
  const [searchParams, setSearchParams] = useSearchParams();
  const [railCollapsed, setRailCollapsed] = useState(initialRailState);
  const [resumeRoute, setResumeRoute] = useState(initialResumeRoute);
  const agentId = searchParams.get('agent');

  useEffect(() => {
    window.scrollTo({ behavior: 'auto', left: 0, top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    const nextResumeRoute = currentResumableRoute(location.pathname, location.search);
    if (nextResumeRoute === null) return;
    window.localStorage.setItem(resumeStorageKey, nextResumeRoute);
    setResumeRoute(nextResumeRoute);
  }, [location.pathname, location.search]);

  const toggleRail = useCallback(() => {
    setRailCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(railStorageKey, String(next));
      return next;
    });
  }, []);
  const drawer = useMemo<AgentDrawerContextValue>(
    () => ({
      openAgent: (nextAgentId) => {
        setSearchParams((current) => {
          const next = new URLSearchParams(current);
          next.set('agent', nextAgentId);
          return next;
        });
      },
    }),
    [setSearchParams],
  );
  const persistentSearch = useMemo(() => {
    const persistent = new URLSearchParams();
    (['intake', 'spec', 'job', 'shadow', 'mode'] as const).forEach((key) => {
      const value = searchParams.get(key);
      if (value) persistent.set(key, value);
    });
    const value = persistent.toString();
    return value ? `?${value}` : '';
  }, [searchParams]);
  const buildPath =
    location.pathname === '/build'
      ? `/build${persistentSearch}`
      : resumeRoute?.startsWith('/build')
        ? resumeRoute
        : '/build';

  function closeAgent() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('agent');
      return next;
    });
  }

  function focusMainContent(event: MouseEvent<HTMLAnchorElement>) {
    const target = document.getElementById('platform-main');
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.scrollIntoView({ block: 'start' });
  }

  const navigation: readonly PlatformRailItem[] = [
    {
      label: 'TODAY',
      number: '00',
      path: '/',
      active: location.pathname === '/',
    },
    {
      label: 'ATTENTION',
      number: '01',
      path: '/attention',
      active: location.pathname === '/attention',
      badge: attention.isError ? 0 : (attention.data?.decideBadgeCount ?? 0),
      unavailable: attention.isError,
    },
    {
      label: 'KNOWLEDGE',
      number: '02',
      path: '/knowledge',
      active: location.pathname === '/knowledge',
    },
    {
      label: 'BUILD',
      number: '03',
      path: buildPath,
      active: location.pathname === '/build',
      badge: 0,
      unavailable: false,
    },
    {
      label: 'CATALOG',
      number: '04',
      path: '/catalog',
      active: ['/catalog', '/registry', '/library', '/aim'].includes(location.pathname),
      badge: 0,
      unavailable: false,
    },
    {
      label: 'OPERATE',
      number: '05',
      path: '/operate',
      active: location.pathname === '/operate' || location.pathname === '/runs',
      badge: 0,
      unavailable: false,
    },
    {
      label: 'CONNECTIONS',
      number: '06',
      path: '/connections',
      active: location.pathname === '/connections',
    },
    {
      label: 'EVIDENCE',
      number: '07',
      path: '/evidence',
      active: location.pathname === '/evidence' || location.pathname.startsWith('/certification/'),
      badge: 0,
      unavailable: false,
    },
    {
      label: 'INCUBATOR',
      number: '08',
      path: '/incubator',
      active: location.pathname === '/incubator',
      badge: 0,
      unavailable: false,
    },
    {
      label: 'SETTINGS',
      number: '—',
      path: '/settings',
      active: location.pathname === '/settings',
    },
  ] as const;

  return (
    <AgentDrawerContext.Provider value={drawer}>
      <div className="platform-shell" data-rail-collapsed={railCollapsed}>
        <a className="skip-link" href="#platform-main" onClick={focusMainContent}>
          Skip to main content
        </a>
        <StarfieldCanvas />
        <PlatformRail collapsed={railCollapsed} items={navigation} onToggle={toggleRail} />
        <div className="platform-workspace">
          <header className="platform-workspace-header">
            <GlobalAgentSearch onSelectAgent={drawer.openAgent} />
            <div className="platform-workspace-actions">
              {resumeRoute ? (
                <Link className="platform-resume-link" to={resumeRoute}>
                  RESUME <span aria-hidden="true">→</span>
                </Link>
              ) : null}
              <span className="platform-workspace-scope">PAUL OS · GOVERNED</span>
            </div>
          </header>
          <div className="platform-content" id="platform-main" tabIndex={-1}>
            <Outlet context={{ resumeRoute }} />
          </div>
        </div>
        {agentId ? <AgentDetailDrawer agentId={agentId} onClose={closeAgent} /> : null}
      </div>
    </AgentDrawerContext.Provider>
  );
}
