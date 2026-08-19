import { useMemo } from 'react';
import { agentCatalogQuerySchema } from '@agent-builder/contracts';
import { useSearchParams } from 'react-router-dom';
import { useAgentCatalog } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Icon } from '../../components/Icon';
import { SectionTabs } from '../../components/SectionTabs';
import { Notice } from '../../components/Notice';
import { useAgentDrawer } from '../../components/agent-drawer-context';

export function LibraryPage() {
  const { openAgent } = useAgentDrawer();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('query') ?? '';
  const department = searchParams.get('department') ?? '';
  const status = searchParams.get('status') ?? '';
  const provider = searchParams.get('provider') ?? '';
  const parsedFilters = useMemo(
    () =>
      agentCatalogQuerySchema.safeParse({
        ...(query ? { query } : {}),
        ...(department ? { department } : {}),
        ...(status ? { status } : {}),
        ...(provider ? { provider } : {}),
        limit: 60,
      }),
    [department, provider, query, status],
  );
  const catalog = useAgentCatalog(parsedFilters.success ? parsedFilters.data : { limit: 60 });
  const items = useMemo(
    () => (catalog.isError ? [] : (catalog.data?.pages.flatMap((page) => page.items) ?? [])),
    [catalog.data?.pages, catalog.isError],
  );
  const departments = useMemo(
    () => Array.from(new Set(items.map((agent) => agent.department))).sort(),
    [items],
  );

  function setFilter(key: string, value: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }

  return (
    <main className="catalog-page">
      <header className="page-heading">
        <p className="page-kicker">GOVERNED CATALOG</p>
        <h1>Agent Library</h1>
        <p>Find the certified or reusable capability already serving the organization.</p>
      </header>
      <SectionTabs
        label="Catalog views"
        tabs={[
          { label: 'AGENTS', path: '/catalog' },
          { label: 'LEGACY LIBRARY', path: '/library' },
          { label: 'DEFINITIONS', path: '/registry' },
        ]}
      />
      <section aria-label="Agent filters" className="catalog-filters">
        <label className="catalog-query">
          <span className="sr-only">Search the agent library</span>
          <Icon name="search" size={18} />
          <input
            onChange={(event) => setFilter('query', event.target.value)}
            placeholder="Search name, purpose, capability…"
            value={query}
          />
        </label>
        <label>
          <span>DEPARTMENT</span>
          <select
            onChange={(event) => setFilter('department', event.target.value)}
            value={department}
          >
            <option value="">All departments</option>
            {departments.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>STATUS</span>
          <select onChange={(event) => setFilter('status', event.target.value)} value={status}>
            <option value="">All states</option>
            {[
              'draft',
              'generating',
              'ready',
              'shadow',
              'certifying',
              'certified',
              'rejected',
              'active',
              'failed',
              'retired',
            ].map((value) => (
              <option key={value} value={value}>
                {value.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>PROVIDER</span>
          <select onChange={(event) => setFilter('provider', event.target.value)} value={provider}>
            <option value="">All providers</option>
            {['bigquery', 'confluence', 'jira', 'email', 'slack', 'fixture'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </section>
      {!parsedFilters.success ? (
        <Notice tone="error">
          One or more URL filters are not supported. Clear the filters and try again.
        </Notice>
      ) : null}
      {catalog.isError ? <Notice tone="error">{getErrorMessage(catalog.error)}</Notice> : null}
      <section
        aria-busy={catalog.isLoading || catalog.isFetchingNextPage}
        aria-label="Governed agents"
        className="catalog-grid"
      >
        {catalog.isLoading ? <p className="catalog-empty">Loading governed agents…</p> : null}
        {!catalog.isLoading && !catalog.isError && items.length === 0 ? (
          <p className="catalog-empty">No governed agents match these filters.</p>
        ) : null}
        {items.map((agent) => (
          <button
            className="catalog-card"
            key={agent.id}
            onClick={() => openAgent(agent.id)}
            type="button"
          >
            <span className="catalog-card-heading">
              <span className="agent-icon">
                <Icon name="agent" size={24} />
              </span>
              <span className="catalog-card-badges">
                {agent.isChampion ? <span className="champion-chip">CHAMPION</span> : null}
                <span className={`status-chip ${agent.status}`}>{agent.status}</span>
              </span>
            </span>
            <span>
              <strong>{agent.name}</strong>
              <small>
                {agent.department} · V{agent.versionNumber}
              </small>
            </span>
            <span className="catalog-purpose">{agent.purpose}</span>
            <span className="capability-list">
              {agent.capabilities.slice(0, 3).map((capability) => (
                <span key={capability}>{capability}</span>
              ))}
            </span>
            <span className="catalog-governance-meta">
              <small>{agent.certificationHealth.replaceAll('_', ' ')}</small>
              <small>{agent.providers.join(' · ') || 'No bound providers'}</small>
            </span>
            <span className="catalog-open">
              OPEN RECORD <span aria-hidden="true">→</span>
            </span>
          </button>
        ))}
      </section>
      {!catalog.isError && catalog.hasNextPage ? (
        <button
          className="secondary-button catalog-load-more"
          disabled={catalog.isFetchingNextPage}
          onClick={() => void catalog.fetchNextPage()}
          type="button"
        >
          {catalog.isFetchingNextPage ? 'Loading more agents…' : 'Load more agents'}
        </button>
      ) : null}
    </main>
  );
}
