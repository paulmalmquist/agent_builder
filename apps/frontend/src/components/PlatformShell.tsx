import { useMemo } from 'react';
import { Link, NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom';
import { Brand } from './Brand';
import { GlobalAgentSearch } from './GlobalAgentSearch';
import { StarfieldCanvas } from './StarfieldCanvas';
import { Icon } from './Icon';
import { AgentDetailDrawer } from '../features/library/AgentDetailDrawer';
import { AgentDrawerContext, type AgentDrawerContextValue } from './agent-drawer-context';

export function PlatformShell() {
  const location = useLocation();
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
    { label: 'BUILD', path: '/', active: location.pathname === '/' },
    {
      label: 'REGISTRY',
      path: '/registry',
      active: location.pathname === '/registry' || location.pathname === '/library',
    },
    { label: 'RUNS & APPROVALS', path: '/runs', active: location.pathname === '/runs' },
    {
      label: 'EVIDENCE',
      path: '/evidence',
      active: location.pathname === '/evidence' || location.pathname.startsWith('/certification/'),
    },
    { label: 'INCUBATOR', path: '/incubator', active: location.pathname === '/incubator' },
  ] as const;

  return (
    <AgentDrawerContext.Provider value={drawer}>
      <div className="platform-shell">
        <StarfieldCanvas />
        <header className="platform-topbar">
          <Link
            aria-label="Open Paul OS Build"
            className="platform-brand"
            to={{ pathname: '/', search: persistentSearch }}
          >
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
              end={item.path === '/'}
              key={item.path}
              to={item.path === '/' ? { pathname: '/', search: persistentSearch } : item.path}
            >
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              {item.label}
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
