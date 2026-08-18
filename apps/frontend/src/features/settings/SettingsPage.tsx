import type { ResourceVersion } from '@agent-builder/contracts';
import { getErrorMessage } from '../../api/client';
import { usePlatformResources, useSession } from '../../api/hooks';
import { Notice } from '../../components/Notice';
import { SurfaceHeader } from '../platform/SurfaceHeader';
import './settings.css';

const ruleKinds = ['Protocol', 'Project', 'Reference'] as const;

function displayKind(kind: ResourceVersion['kind']) {
  return kind.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function SettingsPage() {
  const session = useSession();
  const protocols = usePlatformResources({ kind: 'Protocol', limit: 100 });
  const projects = usePlatformResources({ kind: 'Project', limit: 100 });
  const references = usePlatformResources({ kind: 'Reference', limit: 100 });
  const principal = session.isError ? undefined : session.data?.principal;
  const governedRules = [
    ...(protocols.isError ? [] : (protocols.data?.items ?? [])),
    ...(projects.isError ? [] : (projects.data?.items ?? [])),
    ...(references.isError ? [] : (references.data?.items ?? [])),
  ].filter((resource) => ruleKinds.includes(resource.kind as (typeof ruleKinds)[number]));
  const rulesLoading = protocols.isLoading || projects.isLoading || references.isLoading;
  const rulesUnavailable = protocols.isError || projects.isError || references.isError;

  return (
    <main className="os-surface settings-surface">
      <SurfaceHeader
        description="Inspect the exact workspace identity and governed rules in effect. This surface is read-only until project, directory, and import-history list contracts exist."
        kicker="WORKSPACE · IDENTITY · GOVERNED CONFIGURATION"
        stateDetail={
          session.data && !session.isError
            ? session.data.authorizationModel.toLocaleUpperCase()
            : session.isLoading
              ? 'SERVER SESSION CONTRACT'
              : 'NO SILENT IDENTITY FALLBACK'
        }
        stateLabel={
          session.isError
            ? 'SESSION UNAVAILABLE'
            : session.isLoading
              ? 'RESOLVING SESSION'
              : 'CURRENT REQUEST SCOPE'
        }
        title="Settings"
      />

      {session.isError ? (
        <Notice tone="error">Current session unavailable. {getErrorMessage(session.error)}</Notice>
      ) : null}

      <section aria-busy={session.isLoading} aria-labelledby="settings-session-title">
        <header className="settings-section-heading">
          <div>
            <span>01 · REQUEST PRINCIPAL</span>
            <h2 id="settings-session-title">Effective identity and authority</h2>
          </div>
          <small>SERVER RESOLVED · READ ONLY</small>
        </header>
        {session.isLoading ? (
          <div className="settings-loading" role="status">
            Resolving the current request principal…
          </div>
        ) : null}
        {principal && session.data ? (
          <div className="settings-principal-layout">
            <dl className="settings-fact-grid">
              <div>
                <dt>PRINCIPAL ID</dt>
                <dd>
                  <code>{principal.principalId}</code>
                </dd>
              </div>
              <div>
                <dt>ACTOR ID</dt>
                <dd>{principal.actorId}</dd>
              </div>
              <div>
                <dt>WORKSPACE ID</dt>
                <dd>
                  <code>{principal.workspaceId}</code>
                </dd>
              </div>
              <div>
                <dt>DEPARTMENT ID</dt>
                <dd>
                  {principal.departmentId ? (
                    <code>{principal.departmentId}</code>
                  ) : (
                    'WORKSPACE SCOPE'
                  )}
                </dd>
              </div>
              <div>
                <dt>AUTHENTICATION</dt>
                <dd>{principal.authentication.replace('_', ' ')}</dd>
              </div>
              <div>
                <dt>AUTHORIZATION MODEL</dt>
                <dd>{session.data.authorizationModel}</dd>
              </div>
            </dl>
            <div className="settings-authority-panel">
              <div>
                <h3>Effective roles</h3>
                <ul aria-label="Effective roles">
                  {session.data.effectiveRoles.length > 0 ? (
                    session.data.effectiveRoles.map((role) => <li key={role}>{role}</li>)
                  ) : (
                    <li>NONE</li>
                  )}
                </ul>
              </div>
              <div>
                <h3>Granted permissions</h3>
                <ul aria-label="Granted permissions">
                  {session.data.permissions.length > 0 ? (
                    session.data.permissions.map((permission) => (
                      <li key={permission}>{permission}</li>
                    ))
                  ) : (
                    <li>NONE</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="settings-boundaries-title">
        <header className="settings-section-heading">
          <div>
            <span>02 · CONTROL-PLANE BOUNDARIES</span>
            <h2 id="settings-boundaries-title">Configured interfaces, unavailable operations</h2>
          </div>
          <small>FAIL CLOSED</small>
        </header>
        <div className="settings-boundary-grid">
          <article>
            <span>NOT EXPOSED</span>
            <h3>Project switching</h3>
            <p>
              Project definitions are visible below, but no ProjectInstance list or selection API is
              exposed. This workstation will not infer an active project from a folder or name.
            </p>
          </article>
          <article>
            <span>NOT CONNECTED</span>
            <h3>Access directory</h3>
            <p>
              The current principal is visible above. Identity and role-binding membership cannot be
              browsed because the control plane exposes no governed directory list contract.
            </p>
          </article>
          <article>
            <span>WRITE ROUTE ONLY</span>
            <h3>Repository import history</h3>
            <p>
              Definitions can be imported through the governed write path, but there is no read API
              for prior imports. The console does not manufacture a last-import status.
            </p>
          </article>
        </div>
      </section>

      <section aria-busy={rulesLoading} aria-labelledby="settings-rules-title">
        <header className="settings-section-heading">
          <div>
            <span>03 · REPOSITORY AUTHORITY</span>
            <h2 id="settings-rules-title">Governed rules visible to this workspace</h2>
          </div>
          <small>PROTOCOL · PROJECT · REFERENCE</small>
        </header>
        {protocols.isError ? (
          <Notice tone="error">Protocols unavailable. {getErrorMessage(protocols.error)}</Notice>
        ) : null}
        {projects.isError ? (
          <Notice tone="error">Projects unavailable. {getErrorMessage(projects.error)}</Notice>
        ) : null}
        {references.isError ? (
          <Notice tone="error">References unavailable. {getErrorMessage(references.error)}</Notice>
        ) : null}
        {rulesLoading ? (
          <div className="settings-loading" role="status">
            Reading governed definitions…
          </div>
        ) : null}
        {!rulesLoading && !rulesUnavailable && governedRules.length === 0 ? (
          <div className="settings-loading">
            No governed Protocol, Project, or Reference definitions are visible in this workspace.
          </div>
        ) : null}
        {governedRules.length > 0 ? (
          <div className="settings-rule-list">
            {governedRules.map((resource) => (
              <article key={resource.id}>
                <header>
                  <span>
                    {displayKind(resource.kind)} · V{resource.version}
                  </span>
                  <small>{resource.lifecycle}</small>
                </header>
                <h3>{resource.name}</h3>
                <p>{resource.purpose}</p>
                <footer>
                  OWNER · {resource.owner} · REVISION {resource.revision}
                </footer>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
