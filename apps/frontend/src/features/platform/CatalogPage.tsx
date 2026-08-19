import type { ResourceVersion } from '@agent-builder/contracts';
import { Link, useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import { useCatalogPublications, usePlatformResources } from '../../api/hooks';
import { Notice } from '../../components/Notice';
import { SectionTabs } from '../../components/SectionTabs';
import { featureFlags } from '../../config/feature-flags';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { distinctResourceVersions } from '../../lib/user-facing-index';
import { CatalogAgentDetailDrawer } from './CatalogAgentDetailDrawer';
import { InstrumentStrip, SurfaceHeader } from './SurfaceHeader';

const catalogTabs = [
  { label: 'AGENTS', path: '/catalog' },
  { label: 'LEGACY LIBRARY', path: '/library' },
  { label: 'DEFINITIONS', path: '/registry' },
] as const;

const lifecycles: Array<ResourceVersion['lifecycle']> = [
  'experimental',
  'candidate',
  'evaluating',
  'evaluated',
  'certified',
  'production',
  'deprecated',
];

const resultLimit = 100;

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('query') ?? '';
  const rawLifecycle = searchParams.get('lifecycle');
  const lifecycle = lifecycles.find((value) => value === rawLifecycle);
  const selectedResourceVersionId = searchParams.get('resource');
  const debouncedQuery = useDebouncedValue(query.trim(), 250);
  const agents = usePlatformResources({
    kind: 'Agent',
    ...(debouncedQuery ? { query: debouncedQuery } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    limit: resultLimit,
  });
  const publications = useCatalogPublications();
  const items = agents.isError
    ? []
    : distinctResourceVersions(agents.data?.items ?? []).filter((item) => item.kind === 'Agent');
  const activeAgentPublications =
    publications.data?.items.filter(
      (publication) => publication.subjectKind === 'agent' && publication.retiredAt === null,
    ) ?? [];
  const publicationByResource = new Map(
    activeAgentPublications.map((publication) => [publication.resourceVersionId, publication]),
  );
  const available = agents.data !== undefined && !agents.isError;
  const publicationReadingsAvailable = publications.data !== undefined && !publications.isError;
  const productionShown = items.filter((item) => item.lifecycle === 'production').length;
  const certifiedShown = items.filter((item) => item.lifecycle === 'certified').length;
  const resultCapReached = items.length >= resultLimit;

  function setFilter(key: 'query' | 'lifecycle', value: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      next.delete('resource');
      return next;
    });
  }

  function resourceHref(resourceVersionId: string): string {
    const next = new URLSearchParams(searchParams);
    next.set('resource', resourceVersionId);
    return `/catalog?${next.toString()}`;
  }

  function closeResource() {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('resource');
      return next;
    });
  }

  return (
    <main className="os-surface">
      <SurfaceHeader
        description="Find one exact, versioned agent definition; inspect what it knows, which systems and authority it can use, and the evidence behind reuse certification."
        kicker="REUSE BEFORE CREATION"
        stateDetail="CANONICAL AGENT DEFINITIONS · EXACT VERSION IDENTITY"
        title="Catalog"
      />
      <SectionTabs label="Catalog views" tabs={catalogTabs} />
      <InstrumentStrip
        readings={[
          { label: 'AGENT DEFINITIONS SHOWN', value: available ? items.length : '—' },
          {
            label: 'ACTIVE AGENT CONTRACTS',
            value: publicationReadingsAvailable ? activeAgentPublications.length : '—',
          },
          {
            label: 'PRODUCTION DEFINITIONS SHOWN',
            value: available ? productionShown : '—',
          },
          { label: 'CERTIFIED DEFINITIONS SHOWN', value: available ? certifiedShown : '—' },
        ]}
      />
      <section className="catalog-state-guide">
        <strong>One card = one immutable version</strong>
        <p>
          Definition lifecycle, certified reuse publication, Builder status, and runtime authority
          are different records. Catalog keeps them separate and joins them only by exact governed
          identity. Every count above describes this loaded view, not every agent in Paul OS.
        </p>
      </section>
      <div className="os-toolbar">
        <div className="os-toolbar-group">
          <label className="os-filter">
            <span>SEARCH AGENT DEFINITIONS</span>
            <input
              onChange={(event) => setFilter('query', event.target.value)}
              placeholder="Name, purpose, or slug…"
              value={query}
            />
          </label>
          <label className="os-filter">
            <span>DEFINITION LIFECYCLE</span>
            <select
              onChange={(event) => setFilter('lifecycle', event.target.value)}
              value={lifecycle ?? ''}
            >
              <option value="">All definition states</option>
              {lifecycles.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Link className="secondary-button" to="/build">
          START WITH A REAL REQUEST →
        </Link>
      </div>
      {publications.isError ? (
        <Notice tone="error">
          Reuse certification unavailable. {getErrorMessage(publications.error)} Agent definition
          lifecycle remains visible but is not treated as certification.
        </Notice>
      ) : null}
      {agents.isError ? (
        <Notice tone="error">Catalog unavailable. {getErrorMessage(agents.error)}</Notice>
      ) : null}
      {resultCapReached ? (
        <Notice tone="info">
          This view reached its {resultLimit}-definition cap. Counts and matches describe only the
          loaded portion of the Catalog.
        </Notice>
      ) : null}
      <section
        aria-busy={agents.isLoading}
        aria-label="Canonical agent definitions"
        className="catalog-definition-section"
      >
        <header className="os-panel-heading">
          <div>
            <h2>Governed agent versions</h2>
            <p>Open a card to inspect its exact definition and connected operational records.</p>
          </div>
          <small>RESOURCEVERSION · NO LEGACY STATUS SUBSTITUTION</small>
        </header>
        {agents.isLoading ? (
          <div className="os-empty-state" role="status">
            Reading governed agent definitions…
          </div>
        ) : null}
        {!agents.isLoading && !agents.isError && items.length === 0 ? (
          <div className="os-empty-state">
            <strong>
              {query || lifecycle
                ? 'No governed agent versions match this view.'
                : 'No canonical Agent resources are imported.'}
            </strong>
            <span>
              {query || lifecycle
                ? 'Clear the current search or lifecycle filter.'
                : 'Use Build to check active reuse contracts before starting a new draft.'}
            </span>
          </div>
        ) : null}
        {items.length > 0 ? (
          <div className="resource-grid">
            {items.map((agent) => {
              const publication = publicationByResource.get(agent.id);
              const publicationState = publications.isError
                ? 'REUSE CERTIFICATION · UNAVAILABLE'
                : publications.isLoading
                  ? 'REUSE CERTIFICATION · CHECKING'
                  : publication
                    ? `REUSE CERTIFICATION · ${publication.trustChip.gatesPassed}/${publication.trustChip.gatesTotal} GATES PASSED`
                    : 'REUSE CERTIFICATION · NO ACTIVE CONTRACT';
              return (
                <Link
                  aria-label={`Open governed record for ${agent.name}, version ${agent.version}`}
                  className="resource-card catalog-agent-card"
                  key={agent.id}
                  to={resourceHref(agent.id)}
                >
                  <header>
                    <span className="resource-kind">AGENT DEFINITION · V{agent.version}</span>
                    <span className="os-status-chip" data-state={agent.lifecycle}>
                      {agent.lifecycle}
                    </span>
                  </header>
                  <div>
                    <h2>{agent.name}</h2>
                    <p>{agent.purpose}</p>
                  </div>
                  <div className="resource-metadata">
                    <span>OWNER · {agent.owner}</span>
                    <span>EXACT DEPENDENCIES · {agent.dependencyPins.length}</span>
                    <span>DEFINITION LIFECYCLE · {agent.lifecycle}</span>
                  </div>
                  <span className="catalog-card-contract">{publicationState}</span>
                  <span className="catalog-card-open">
                    OPEN GOVERNED RECORD <span aria-hidden="true">→</span>
                  </span>
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>
      <section className="catalog-entry-strip" aria-label="Related catalog surfaces">
        <Link to="/build">
          <span>BUILD</span>
          <strong>Check certified referred choices for a real request.</strong>
        </Link>
        <Link to="/library">
          <span>LEGACY LIBRARY</span>
          <strong>Audit Builder-era records that have not completed canonical migration.</strong>
        </Link>
        <Link to="/registry">
          <span>DEFINITIONS</span>
          <strong>Audit every immutable resource kind.</strong>
        </Link>
        {featureFlags.aimEnabled ? (
          <Link to="/aim">
            <span>AIM</span>
            <strong>Open the synthetic capability map.</strong>
          </Link>
        ) : null}
      </section>
      {selectedResourceVersionId ? (
        <CatalogAgentDetailDrawer
          onClose={closeResource}
          resourceVersionId={selectedResourceVersionId}
        />
      ) : null}
    </main>
  );
}
