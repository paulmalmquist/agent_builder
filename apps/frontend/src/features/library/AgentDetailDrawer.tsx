import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAgentDetail, useFamilyVersions } from '../../api/hooks';
import { getErrorMessage } from '../../api/client';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/Notice';
import { featureFlags } from '../../config/feature-flags';

interface AgentDetailDrawerProps {
  agentId: string;
  onClose: () => void;
}

export function AgentDetailDrawer({ agentId, onClose }: AgentDetailDrawerProps) {
  const navigate = useNavigate();
  const [drawerSearchParams, setSearchParams] = useSearchParams();
  const detail = useAgentDetail(agentId);
  const agent = detail.data;
  const versions = useFamilyVersions(agent?.familyId ?? null);
  const selectedVersion = versions.data?.items.find((version) => version.id === agentId) ?? null;
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeElementIsStable =
      activeElement &&
      activeElement !== document.body &&
      activeElement.isConnected &&
      !activeElement.closest('.global-search');
    returnFocusRef.current = activeElementIsStable
      ? activeElement
      : document.querySelector<HTMLElement>('.global-search-trigger');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current
      ?.querySelector<HTMLElement>('button, [href], input, select, textarea')
      ?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, []);

  function openBuilder(intent: 'use' | 'configure' | 'extend') {
    const params = new URLSearchParams({ candidate: agentId, intent });
    const mode = drawerSearchParams.get('mode');
    if (mode) params.set('mode', mode);
    onClose();
    void navigate(`/build?${params.toString()}`);
  }

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        aria-label="Agent details"
        aria-modal="true"
        className="agent-drawer"
        ref={drawerRef}
        role="dialog"
      >
        <button
          aria-label="Close agent details"
          className="icon-button drawer-close"
          onClick={onClose}
          type="button"
        >
          <Icon name="close" size={20} />
        </button>
        <p className="page-kicker">GOVERNED AGENT RECORD</p>
        {detail.isLoading ? <p>Loading agent record…</p> : null}
        {detail.isError ? <Notice tone="error">{getErrorMessage(detail.error)}</Notice> : null}
        {agent ? (
          <>
            <div className="drawer-status-line">
              {selectedVersion?.isChampion ? <span className="champion-chip">CHAMPION</span> : null}
              <span className={`status-chip ${agent.status}`}>{agent.status}</span>
            </div>
            <h2>{agent.name}</h2>
            <p className="drawer-purpose">{agent.purpose}</p>
            <dl className="drawer-facts">
              <div>
                <dt>Department</dt>
                <dd>{agent.department}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{agent.owner}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>V{agent.versionNumber}</dd>
              </div>
              <div>
                <dt>Certification</dt>
                <dd>{agent.certificationHealth.replaceAll('_', ' ')}</dd>
              </div>
              <div>
                <dt>Providers</dt>
                <dd>{selectedVersion?.providers.join(', ') || 'None bound'}</dd>
              </div>
              <div>
                <dt>Identifier</dt>
                <dd>{agent.slug}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{new Date(agent.updatedAt).toLocaleDateString()}</dd>
              </div>
            </dl>
            <section className="drawer-section">
              <h3>Capabilities</h3>
              <div className="capability-list">
                {agent.capabilities.map((capability) => (
                  <span key={capability}>{capability}</span>
                ))}
              </div>
            </section>
            <section className="drawer-section">
              <h3>Family versions</h3>
              {versions.isLoading ? <p className="drawer-muted">Loading version lineage…</p> : null}
              {versions.isError ? (
                <Notice tone="error">{getErrorMessage(versions.error)}</Notice>
              ) : null}
              <div className="version-list">
                {versions.data?.items.map((version) => (
                  <button
                    aria-current={version.id === agent.id ? 'true' : undefined}
                    key={version.id}
                    onClick={() => {
                      setSearchParams((current) => {
                        const next = new URLSearchParams(current);
                        next.set('agent', version.id);
                        return next;
                      });
                    }}
                    type="button"
                  >
                    <span>
                      <strong>V{version.versionNumber}</strong>
                      {version.isChampion ? <em>CHAMPION</em> : null}
                    </span>
                    <span className={`status-chip ${version.status}`}>{version.status}</span>
                  </button>
                ))}
              </div>
              {versions.hasNextPage ? (
                <button
                  className="secondary-button drawer-load-more"
                  disabled={versions.isFetchingNextPage}
                  onClick={() => void versions.fetchNextPage()}
                  type="button"
                >
                  {versions.isFetchingNextPage ? 'Loading versions…' : 'Load more versions'}
                </button>
              ) : null}
            </section>
            <div className="drawer-actions">
              {featureFlags.visualSurfacesEnabled ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    void navigate(`/bench/${agent.id}`);
                  }}
                  type="button"
                >
                  Inspect assembly
                </button>
              ) : null}
              <button className="primary-button" onClick={() => openBuilder('use')} type="button">
                Use as-is
              </button>
              <button
                className="secondary-button"
                onClick={() => openBuilder('configure')}
                type="button"
              >
                Configure
              </button>
              <button
                className="secondary-button"
                onClick={() => openBuilder('extend')}
                type="button"
              >
                Extend
              </button>
              {['shadow', 'certifying', 'certified', 'rejected', 'active'].includes(
                agent.status,
              ) ? (
                <button
                  className="secondary-button"
                  onClick={() => {
                    onClose();
                    const persistent = new URLSearchParams();
                    (['spec', 'job', 'shadow', 'mode'] as const).forEach((key) => {
                      const value = drawerSearchParams.get(key);
                      if (value) persistent.set(key, value);
                    });
                    const suffix = persistent.size > 0 ? `?${persistent.toString()}` : '';
                    void navigate(`/certification/${agent.id}${suffix}`);
                  }}
                  type="button"
                >
                  Certification
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}
