import type { ResourceVersion } from '@agent-builder/contracts';
import { Link, useSearchParams } from 'react-router-dom';
import { usePlatformResources } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Notice } from '../../components/Notice';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { InstrumentStrip, SurfaceHeader } from './SurfaceHeader';

const resourceKinds: Array<ResourceVersion['kind']> = [
  'Skill',
  'Agent',
  'Project',
  'Automation',
  'Protocol',
  'KnowledgeSource',
  'Reference',
  'EvaluationSuite',
  'MetricDefinition',
  'ImprovementCandidate',
  'BusinessDomain',
  'ContextPolicy',
  'CorePolicy',
];

const lifecycles: Array<ResourceVersion['lifecycle']> = [
  'experimental',
  'candidate',
  'evaluating',
  'evaluated',
  'certified',
  'production',
  'deprecated',
];

function shortenDigest(digest: string) {
  return `${digest.slice(0, 10)}…${digest.slice(-6)}`;
}

export function RegistryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('query') ?? '';
  const rawKind = searchParams.get('kind');
  const rawLifecycle = searchParams.get('lifecycle');
  const kind = resourceKinds.find((value) => value === rawKind);
  const lifecycle = lifecycles.find((value) => value === rawLifecycle);
  const debouncedQuery = useDebouncedValue(query, 250);
  const resources = usePlatformResources({
    ...(kind ? { kind } : {}),
    ...(lifecycle ? { lifecycle } : {}),
    ...(debouncedQuery.trim() ? { query: debouncedQuery.trim() } : {}),
    limit: 100,
  });
  const items = resources.data?.items ?? [];
  const production = items.filter((resource) => resource.lifecycle === 'production').length;
  const candidates = items.filter((resource) => resource.lifecycle === 'candidate').length;
  const readings = [
    { label: 'VERSIONED RESOURCES', value: items.length },
    { label: 'PRODUCTION', value: production },
    { label: 'CANDIDATES', value: candidates },
    { label: 'DEFINITION SOURCE', value: 'GIT' },
  ];

  function setFilter(key: 'query' | 'kind' | 'lifecycle', value: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }

  return (
    <main className="os-surface">
      <SurfaceHeader
        description="Inspect immutable imported definitions across skills, agents, policies, sources, projects, and automation. Git defines intent; PostgreSQL records operational truth."
        kicker="VERSIONED DEFINITION REGISTRY"
        title="Registry"
      />
      <InstrumentStrip readings={readings} />
      <div className="os-toolbar">
        <div className="os-toolbar-group">
          <label className="os-filter">
            <span>SEARCH DEFINITIONS</span>
            <input
              onChange={(event) => setFilter('query', event.target.value)}
              placeholder="Name, purpose, owner…"
              value={query}
            />
          </label>
          <label className="os-filter">
            <span>RESOURCE KIND</span>
            <select onChange={(event) => setFilter('kind', event.target.value)} value={kind ?? ''}>
              <option value="">All kinds</option>
              {resourceKinds.map((value) => (
                <option key={value} value={value}>
                  {value.replace(/([a-z])([A-Z])/g, '$1 $2')}
                </option>
              ))}
            </select>
          </label>
          <label className="os-filter">
            <span>LIFECYCLE</span>
            <select
              onChange={(event) => setFilter('lifecycle', event.target.value)}
              value={lifecycle ?? ''}
            >
              <option value="">All states</option>
              {lifecycles.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Link className="secondary-button" to="/library">
          OPEN LEGACY AGENT LIBRARY →
        </Link>
      </div>
      {resources.isError ? <Notice tone="error">{getErrorMessage(resources.error)}</Notice> : null}
      <section aria-busy={resources.isLoading} aria-label="Versioned resources">
        {resources.isLoading ? (
          <div className="os-empty-state" role="status">
            Reading the definition registry…
          </div>
        ) : null}
        {!resources.isLoading && items.length === 0 ? (
          <div className="os-empty-state">
            <strong>No imported definitions match.</strong>
            <span>Compile and import a manifest, or clear the current filters.</span>
          </div>
        ) : null}
        {items.length > 0 ? (
          <div className="resource-grid">
            {items.map((resource) => (
              <article className="resource-card" key={resource.id}>
                <header>
                  <span className="resource-kind">{resource.kind}</span>
                  <span className="os-status-chip" data-state={resource.lifecycle}>
                    {resource.lifecycle}
                  </span>
                </header>
                <div>
                  <h2>{resource.name}</h2>
                  <p>{resource.purpose}</p>
                </div>
                <div className="resource-metadata">
                  <span>
                    {resource.slug} · V{resource.version} · REV {resource.revision}
                  </span>
                  <span>OWNER · {resource.owner}</span>
                  <code title={resource.digest}>DIGEST · {shortenDigest(resource.digest)}</code>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
