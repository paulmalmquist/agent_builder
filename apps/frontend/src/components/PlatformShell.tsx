import { useMemo } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router-dom';
import { Brand } from './Brand';
import { GlobalAgentSearch } from './GlobalAgentSearch';
import { StarfieldCanvas } from './StarfieldCanvas';
import { Icon } from './Icon';
import { AgentDetailDrawer } from '../features/library/AgentDetailDrawer';
import { AgentDrawerContext, type AgentDrawerContextValue } from './agent-drawer-context';

export function PlatformShell() {
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

  return (
    <AgentDrawerContext.Provider value={drawer}>
      <div className="platform-shell">
        <StarfieldCanvas />
        <header className="platform-topbar">
          <Link
            aria-label="Open Agent Builder"
            className="platform-brand"
            to={{ pathname: '/', search: persistentSearch }}
          >
            <Brand compact />
          </Link>
          <GlobalAgentSearch onSelectAgent={drawer.openAgent} />
          <Link className="library-link" to={{ pathname: '/library', search: persistentSearch }}>
            <Icon name="library" size={17} />
            <span>BROWSE AGENT LIBRARY</span>
            <span aria-hidden="true">→</span>
          </Link>
        </header>
        <div className="platform-content">
          <Outlet />
        </div>
        {agentId ? <AgentDetailDrawer agentId={agentId} onClose={closeAgent} /> : null}
      </div>
    </AgentDrawerContext.Provider>
  );
}
