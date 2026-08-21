import type { ResourceVersion } from '@agent-builder/contracts';
import { Link } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import type { PlatformHealth } from '../../api/client';
import { useHealth, usePlatformResources, useSession } from '../../api/hooks';
import { Notice } from '../../components/Notice';
import { consoleBuildCommit } from '../../config/build-identity';
import { SurfaceHeader } from '../platform/SurfaceHeader';
import './settings.css';

const ruleKinds = ['Protocol', 'Project', 'Reference'] as const;

function displayKind(kind: ResourceVersion['kind']) {
  return kind.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function principalLabel(authentication: string) {
  if (authentication === 'local') return 'Local operator';
  if (authentication === 'system') return 'Background service';
  if (authentication === 'fixture_oidc') return 'Fixture-authenticated operator';
  return 'Authenticated operator';
}

function workspaceLabel(authentication: string) {
  return authentication === 'local' || authentication === 'system'
    ? 'Local workspace'
    : 'Authenticated workspace';
}

function departmentLabel(authentication: string, departmentId: string | null) {
  if (departmentId === null) return 'Workspace-wide scope';
  return authentication === 'local' || authentication === 'system'
    ? 'Local department'
    : 'Current department';
}

export function SettingsBuildIdentity({
  build,
  frontendCommit,
  error = null,
  loading = false,
}: {
  build: Pick<PlatformHealth, 'commit' | 'buildTimestamp'> | null;
  frontendCommit: string | null;
  error?: string | null;
  loading?: boolean;
}) {
  const commitsMatch =
    frontendCommit !== null &&
    build !== null &&
    build.commit !== null &&
    frontendCommit === build.commit;
  const verifiedCommit =
    commitsMatch && build !== null && build.buildTimestamp !== null ? build.commit : null;
  const complete = verifiedCommit !== null;
  const mismatch =
    frontendCommit !== null &&
    build !== null &&
    build.commit !== null &&
    frontendCommit !== build.commit;
  return (
    <section aria-busy={loading} aria-labelledby="settings-build-title">
      <header className="settings-section-heading">
        <div>
          <span>04 · CONSOLE BUILD</span>
          <h2 id="settings-build-title">Running build identity</h2>
        </div>
        <small>
          {loading
            ? 'RESOLVING BUILD IDENTITY'
            : complete
              ? 'RUNNING BUILD · DECLARED'
              : mismatch
                ? 'BUILD IDENTITY MISMATCH'
                : 'BUILD IDENTITY UNAVAILABLE'}
        </small>
      </header>
      {error ? <Notice tone="error">Build identity unavailable. {error}</Notice> : null}
      <dl className="settings-build-facts">
        <div>
          <dt>VERIFIED RUNNING COMMIT</dt>
          <dd>{verifiedCommit ? <code>{verifiedCommit}</code> : 'UNAVAILABLE'}</dd>
        </div>
        <div>
          <dt>API BUILD TIMESTAMP</dt>
          <dd>
            {build?.buildTimestamp ? (
              <time dateTime={build.buildTimestamp}>{build.buildTimestamp}</time>
            ) : (
              'UNAVAILABLE'
            )}
          </dd>
        </div>
        <div>
          <dt>FRONTEND ASSET COMMIT</dt>
          <dd>{frontendCommit ? <code>{frontendCommit}</code> : 'UNAVAILABLE'}</dd>
        </div>
        <div>
          <dt>API BUILD COMMIT</dt>
          <dd>{build?.commit ? <code>{build.commit}</code> : 'UNAVAILABLE'}</dd>
        </div>
        <div>
          <dt>INTERPRETATION</dt>
          <dd>
            The running commit is verified only when the frontend asset declaration matches the
            immutable API declaration returned by read-only <code>/v1/health</code>. Missing or
            conflicting values remain unavailable; Paul OS does not infer them from the browser or
            process clock.
          </dd>
        </div>
      </dl>
    </section>
  );
}

export function SettingsPage() {
  const session = useSession();
  const health = useHealth();
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
                <dt>PRINCIPAL</dt>
                <dd>
                  <strong>{principalLabel(principal.authentication)}</strong>
                  <small>Resolved for this request</small>
                </dd>
              </div>
              <div>
                <dt>WORKSPACE</dt>
                <dd>
                  <strong>{workspaceLabel(principal.authentication)}</strong>
                  <small>Exact scope retained below</small>
                </dd>
              </div>
              <div>
                <dt>DEPARTMENT</dt>
                <dd>
                  <strong>
                    {departmentLabel(principal.authentication, principal.departmentId)}
                  </strong>
                  <small>
                    {principal.departmentId === null
                      ? 'No department restriction'
                      : 'Department-bounded request'}
                  </small>
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
            <details className="settings-technical-identifiers">
              <summary>Technical identifiers</summary>
              <dl>
                <div>
                  <dt>PRINCIPAL ID</dt>
                  <dd>
                    <code>{principal.principalId}</code>
                  </dd>
                </div>
                <div>
                  <dt>ACTOR ID</dt>
                  <dd>
                    <code>{principal.actorId}</code>
                  </dd>
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
                    {principal.departmentId ? <code>{principal.departmentId}</code> : 'NOT SET'}
                  </dd>
                </div>
              </dl>
              <p>
                These immutable references support audit and troubleshooting. They are not display
                names or directory records.
              </p>
            </details>
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

      <SettingsBuildIdentity
        build={health.data ?? null}
        error={health.isError ? getErrorMessage(health.error) : null}
        frontendCommit={consoleBuildCommit}
        loading={health.isLoading}
      />

      <section aria-labelledby="settings-selftest-title">
        <header className="settings-section-heading">
          <div>
            <span>05 · SELF-VERIFICATION</span>
            <h2 id="settings-selftest-title">Measure the running console</h2>
          </div>
          <small>READ ONLY · LIVE DOM</small>
        </header>
        <Link className="settings-selftest-link" to="/selftest">
          <span>
            <strong>Open self-verification</strong>
            <small>
              Run the browser acceptance matrix at 390, 768, and 1440 CSS pixels. Assertions that
              cannot run remain skipped, never passed.
            </small>
          </span>
          <b aria-hidden="true">OPEN →</b>
        </Link>
      </section>
    </main>
  );
}
