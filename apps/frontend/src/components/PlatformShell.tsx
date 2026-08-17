import { useMemo } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Brand } from './Brand';
import { GlobalAgentSearch } from './GlobalAgentSearch';
import { StarfieldCanvas } from './StarfieldCanvas';
import { Icon } from './Icon';
import { AgentDetailDrawer } from '../features/library/AgentDetailDrawer';
import { AgentDrawerContext, type AgentDrawerContextValue } from './agent-drawer-context';
import { useAttention } from '../api/hooks';

export function PlatformShell() {
  const location = useLocation();
  const attention = useAttention();
  const [searchParams, setSearchParams] = useSearchParams();
  const agentId = searchParams.get('agent');
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
    (['spec', 'job', 'shadow', 'mode'] as const).forEach((key) => {
      const value = searchParams.get(key);
      if (value) persistent.set(key, value);
    });
    const value = persistent.toString();
    return value ? `?${value}` : '';
  }, [searchParams]);

  function closeAgent() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('agent');
      return next;
    });
  }

  const navigation = [
    {
      label: 'ATTENTION',
      path: '/',
      active: location.pathname === '/',
      badge: attention.data?.decideBadgeCount ?? 0,
      unavailable: attention.isError,
    },
    {
      label: 'BUILD',
      path: '/build',
      active: location.pathname === '/build',
      badge: 0,
      unavailable: false,
    },
    {
      label: 'REGISTRY',
      path: '/registry',
      active: location.pathname === '/registry' || location.pathname === '/library',
      badge: 0,
      unavailable: false,
    },
    {
      label: 'RUNS & APPROVALS',
      path: '/runs',
      active: location.pathname === '/runs',
      badge: 0,
      unavailable: false,
    },
    {
      label: 'EVIDENCE',
      path: '/evidence',
      active: location.pathname === '/evidence' || location.pathname.startsWith('/certification/'),
      badge: 0,
      unavailable: false,
    },
    {
      label: 'INCUBATOR',
      path: '/incubator',
      active: location.pathname === '/incubator',
      badge: 0,
      unavailable: false,
    },
  ] as const;

  return (
    <AgentDrawerContext.Provider value={drawer}>
      <div className="platform-shell">
        <StarfieldCanvas />
        <header className="platform-topbar">
          <Link aria-label="Open Paul OS Attention" className="platform-brand" to="/">
            <Brand compact />
          </Link>
          <GlobalAgentSearch onSelectAgent={drawer.openAgent} />
          <Link className="library-link" to={{ pathname: '/library', search: persistentSearch }}>
            <Icon name="library" size={17} />
            <span>OPEN AGENT LIBRARY</span>
            <span aria-hidden="true">→</span>
          </Link>
        </header>
        <nav aria-label="Paul OS" className="platform-nav">
          {navigation.map((item, index) => (
            <NavLink
              aria-current={item.active ? 'page' : undefined}
              className={item.active ? 'platform-nav-link active' : 'platform-nav-link'}
              end={item.path === '/' || item.path === '/build'}
              key={item.path}
              to={
                item.path === '/build'
                  ? { pathname: '/build', search: persistentSearch }
                  : item.path
              }
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              {item.label}
              {item.badge > 0 ? (
                <span
                  aria-label={`${item.badge} decisions need review`}
                  className="attention-badge"
                >
                  {item.badge}
                </span>
              ) : null}
              {item.unavailable ? (
                <span className="attention-availability">UNAVAILABLE</span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="platform-content">
          <Outlet />
        </div>
        {agentId ? <AgentDetailDrawer agentId={agentId} onClose={closeAgent} /> : null}
      </div>
    </AgentDrawerContext.Provider>
  );
}
