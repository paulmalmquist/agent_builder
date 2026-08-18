import { Link } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import { useCatalogPublications, usePlatformResources } from '../../api/hooks';
import { Notice } from '../../components/Notice';
import { SectionTabs } from '../../components/SectionTabs';
import { featureFlags } from '../../config/feature-flags';
import { InstrumentStrip, SurfaceHeader } from './SurfaceHeader';

const catalogTabs = [
  { label: 'AGENTS', path: '/catalog' },
  { label: 'LEGACY LIBRARY', path: '/library' },
  { label: 'DEFINITIONS', path: '/registry' },
] as const;

export function CatalogPage() {
  const agents = usePlatformResources({ kind: 'Agent', limit: 100 });
  const publications = useCatalogPublications();
  const items = agents.isError ? [] : (agents.data?.items ?? []);
  const available = agents.data !== undefined && !agents.isError;
  const productionShown = items.filter((item) => item.lifecycle === 'production').length;
  const certifiedShown = items.filter((item) => item.lifecycle === 'certified').length;

  return (
    <main className="os-surface">
      <SurfaceHeader
        description="Find versioned reusable capability, inspect its provenance, and return to Builder only when no certified fit exists."
        kicker="REUSE BEFORE CREATION"
        stateDetail="CANONICAL DEFINITIONS · LEGACY COMPATIBILITY"
        title="Catalog"
      />
      <SectionTabs label="Catalog views" tabs={catalogTabs} />
      <InstrumentStrip
        readings={[
          { label: 'AGENT VERSIONS SHOWN', value: available ? items.length : '—' },
          {
            label: 'ACTIVE PUBLICATIONS SHOWN',
            value:
              publications.data && !publications.isError ? publications.data.items.length : '—',
          },
          {
            label: 'PRODUCTION SHOWN',
            value: available ? productionShown : '—',
          },
          { label: 'CERTIFIED SHOWN', value: available ? certifiedShown : '—' },
        ]}
      />
      {publications.isError ? (
        <Notice tone="error">
          Publications unavailable. {getErrorMessage(publications.error)}
        </Notice>
      ) : null}
      <section aria-busy={publications.isLoading} className="os-panel catalog-publication-panel">
        <header className="os-panel-heading">
          <div>
            <h2>Published reuse contracts</h2>
            <p>Certified resources indexed for referred choices.</p>
          </div>
          <small>ACTIVE · CURRENT SCOPE</small>
        </header>
        {publications.isLoading ? (
          <div className="os-empty-state" role="status">
            Reading publications…
          </div>
        ) : null}
        {!publications.isLoading &&
        !publications.isError &&
        publications.data?.items.length === 0 ? (
          <div className="os-empty-state">
            <strong>No active publications are visible.</strong>
            <span>
              Promotion creates a publication after certified evidence and index processing.
            </span>
          </div>
        ) : null}
        {publications.data && !publications.isError && publications.data.items.length > 0 ? (
          <div className="resource-grid">
            {publications.data.items.map((publication) => (
              <article className="resource-card" key={publication.id}>
                <header>
                  <span className="resource-kind">{publication.subjectKind}</span>
                  <span className="os-status-chip" data-state="certified">
                    certified
                  </span>
                </header>
                <div>
                  <h2>{publication.name}</h2>
                  <p>
                    {publication.capabilityProfile.businessDomain} · {publication.department}
                  </p>
                </div>
                <div className="resource-metadata">
                  <span>VISIBILITY · {publication.catalogVisibility}</span>
                  <span>
                    GATES · {publication.trustChip.gatesPassed}/{publication.trustChip.gatesTotal}
                  </span>
                  <span>CORPUS · {publication.trustChip.corpusSize}</span>
                  <code title={publication.releaseDigest}>
                    RELEASE · {publication.releaseDigest.slice(0, 16)}…
                  </code>
                </div>
                <Link
                  className="secondary-button"
                  to={`/knowledge?type=agents&entity=${publication.resourceVersionId}`}
                >
                  INSPECT DEFINITION →
                </Link>
              </article>
            ))}
          </div>
        ) : null}
      </section>
      {agents.isError ? (
        <Notice tone="error">Catalog unavailable. {getErrorMessage(agents.error)}</Notice>
      ) : null}
      {agents.isLoading ? (
        <div className="os-empty-state" role="status">
          Reading reusable agents…
        </div>
      ) : null}
      {!agents.isLoading && !agents.isError && items.length === 0 ? (
        <div className="os-empty-state">
          <strong>No canonical Agent resources are imported.</strong>
          <span>Use the legacy library for Phase 1 records, or confirm a Build intake.</span>
        </div>
      ) : null}
      {items.length > 0 ? (
        <section aria-label="Canonical agent resources" className="resource-grid">
          {items.map((agent) => (
            <article className="resource-card" key={agent.id}>
              <header>
                <span className="resource-kind">AGENT · V{agent.version}</span>
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
                <code title={agent.digest}>DIGEST · {agent.digest.slice(0, 16)}…</code>
              </div>
              <Link className="secondary-button" to={`/knowledge?type=agents&entity=${agent.id}`}>
                INSPECT KNOWLEDGE →
              </Link>
            </article>
          ))}
        </section>
      ) : null}
      <section className="catalog-entry-strip" aria-label="Related catalog surfaces">
        <Link to="/build">
          <span>BUILD</span>
          <strong>Find referred choices for a real request.</strong>
        </Link>
        <Link to="/library">
          <span>LEGACY LIBRARY</span>
          <strong>Inspect Phase 1 operational agents.</strong>
        </Link>
        <Link to="/registry">
          <span>DEFINITIONS</span>
          <strong>Audit every immutable resource kind.</strong>
        </Link>
        {featureFlags.aimEnabled ? (
          <Link to="/aim">
            <span>AIM</span>
            <strong>Open the synthetic capability vehicle.</strong>
          </Link>
        ) : null}
      </section>
    </main>
  );
}
