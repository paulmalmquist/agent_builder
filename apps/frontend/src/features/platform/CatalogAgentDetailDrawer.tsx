import {
  agentResourceSpecSchema,
  type AgentGovernanceDetail,
  type AuthorityGrant,
  type CatalogPublication,
  type ResourceVersion,
} from '@agent-builder/contracts';
import { useEffect, useId, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getErrorMessage } from '../../api/client';
import {
  useAuthorityGrants,
  useCatalogPublications,
  useExecutionRuns,
  usePlatformResource,
  usePlatformResources,
  usePlugins,
} from '../../api/hooks';
import { Icon } from '../../components/Icon';
import { Notice } from '../../components/Notice';
import { featureFlags } from '../../config/feature-flags';
import { distinctResourceVersions, isQuarantinedResource } from '../../lib/user-facing-index';
import './catalog-detail.css';

interface CatalogAgentDetailDrawerProps {
  onClose: () => void;
  resourceVersionId: string;
}

const indexLimit = 100;
const opaqueGovernanceCopyPattern =
  /(?:\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|\b[0-9a-f]{32,}\b|\b(?:https?:\/\/|urn:)|\b[^\s@]+@[^\s@]+\b|[A-Za-z]:\\|\\\\)/iu;

const governanceUnavailableCopy: Record<
  Extract<AgentGovernanceDetail, { state: 'unavailable' }>['reason'],
  string
> = {
  governance_not_declared:
    'This exact Agent version does not declare a digest-verified safeguards snapshot. No detailed boundary is inferred from its name or protocol references.',
  snapshot_not_found:
    'The safeguards snapshot linked to this exact Agent version is unavailable. Prohibitions, approvals, stop conditions, and response requirements remain unknown.',
  snapshot_integrity_failed:
    'The linked safeguards snapshot did not match the digest and revision pinned by this exact Agent version. Every detailed safeguard remains unavailable.',
};

const unavailableGovernanceFields = [
  {
    heading: 'Prohibited actions',
    copy: 'Unavailable. Do not infer that no actions are prohibited.',
  },
  {
    heading: 'Approval requirements',
    copy: 'Unavailable. Runtime and tool approval controls still apply.',
  },
  {
    heading: 'Fail-closed conditions',
    copy: 'Unavailable. Treat detailed stop conditions as unknown.',
  },
  {
    heading: 'Response requirements',
    copy: 'Unavailable. Do not infer citation, confidence, or conflict-reporting requirements.',
  },
] as const;

interface VisibleGovernanceStatements {
  hiddenCount: number;
  items: string[];
}

function withoutControlCharacters(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? ' ' : character;
  }).join('');
}

function visibleGovernanceStatements(values: readonly string[]): VisibleGovernanceStatements {
  const items: string[] = [];
  let hiddenCount = 0;
  for (const value of values) {
    const normalized = withoutControlCharacters(value).replaceAll(/\s+/gu, ' ').trim();
    if (!normalized || opaqueGovernanceCopyPattern.test(normalized)) {
      hiddenCount += 1;
      continue;
    }
    if (!items.includes(normalized)) items.push(normalized);
  }
  return { hiddenCount, items };
}

function GovernanceStatementList({
  emptyCopy,
  noun,
  values,
}: {
  emptyCopy: string;
  noun: string;
  values: readonly string[];
}) {
  const visible = visibleGovernanceStatements(values);
  return (
    <>
      {visible.items.length > 0 ? (
        <ul>
          {visible.items.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p>{emptyCopy}</p>
      )}
      {visible.hiddenCount > 0 ? (
        <p className="catalog-governance-withheld">
          {visible.hiddenCount} declared {noun}
          {visible.hiddenCount === 1 ? '' : 's'} withheld because the copy is identifier-shaped.
        </p>
      ) : null}
    </>
  );
}

function UnavailableAgentGovernancePanel({ reason }: { reason: string }) {
  return (
    <div className="catalog-detail-body">
      <Notice tone="error">{reason}</Notice>
      <div className="catalog-governance-grid">
        {unavailableGovernanceFields.map((field) => (
          <article key={field.heading}>
            <h4>{field.heading}</h4>
            <p>{field.copy}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function AgentGovernancePanel({ governance }: { governance: AgentGovernanceDetail | null }) {
  if (governance === null) {
    return (
      <UnavailableAgentGovernancePanel reason="Detailed safeguards are unavailable for this exact Agent version. No prohibited action, approval requirement, stop condition, or response requirement is inferred." />
    );
  }
  if (governance.state === 'unavailable') {
    return (
      <UnavailableAgentGovernancePanel reason={governanceUnavailableCopy[governance.reason]} />
    );
  }

  const { guardrails } = governance;
  return (
    <div className="catalog-detail-body">
      <p className="catalog-governance-source">
        VERIFIED AGAINST THIS EXACT AGENT VERSION ·{' '}
        {governance.source === 'legacy_spec_snapshot'
          ? `BUILDER SPECIFICATION REVISION ${governance.sourceRevision}`
          : 'DIGEST-MATCHED BUILDER MANIFEST'}
      </p>
      <div className="catalog-governance-grid">
        <article>
          <h4>Prohibited actions</h4>
          <GovernanceStatementList
            emptyCopy="No prohibited actions are listed in this verified snapshot. This does not grant authority."
            noun="prohibited action"
            values={guardrails.prohibitedActions}
          />
        </article>
        <article>
          <h4>Approval requirements</h4>
          <GovernanceStatementList
            emptyCopy="No approval requirements are listed in this verified snapshot. Runtime and tool approval controls still apply."
            noun="approval requirement"
            values={guardrails.approvalRequirements}
          />
        </article>
        <article>
          <h4>Fail-closed conditions</h4>
          <GovernanceStatementList
            emptyCopy="No readable stop condition is available. Treat this detailed boundary as unknown."
            noun="fail-closed condition"
            values={guardrails.failClosedConditions}
          />
        </article>
        <article>
          <h4>Response requirements</h4>
          <dl className="catalog-response-requirements">
            <div>
              <dt>Citations</dt>
              <dd>
                {guardrails.responseRequirements.citations
                  ? 'Required'
                  : 'Not declared as required'}
              </dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>
                {guardrails.responseRequirements.confidence
                  ? 'Required'
                  : 'Not declared as required'}
              </dd>
            </div>
            <div>
              <dt>Unresolved conflicts</dt>
              <dd>
                {guardrails.responseRequirements.unresolvedConflicts
                  ? 'Must be reported'
                  : 'Not declared as required'}
              </dd>
            </div>
          </dl>
        </article>
      </div>
    </div>
  );
}

function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…${digest.slice(-8)}`;
}

function readableState(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(new Date(value));
}

function referenceKey(resource: Pick<ResourceVersion, 'slug' | 'version'>): string {
  return `${resource.slug}@${resource.version}`;
}

function buildHref(resourceVersionId: string): string {
  return `/build?${new URLSearchParams({ source: resourceVersionId }).toString()}`;
}

function provenanceLabel(provenance: ResourceVersion['provenance']): string {
  if (typeof provenance === 'string') return provenance;
  if (provenance === null || Array.isArray(provenance) || typeof provenance !== 'object') {
    return 'Structured provenance recorded';
  }
  const source = Object.entries(provenance).find(
    ([key, value]) => key.toLocaleLowerCase() === 'source' && typeof value === 'string',
  )?.[1];
  return typeof source === 'string' ? source : 'Structured provenance recorded';
}

function publicationFor(
  publications: readonly CatalogPublication[] | undefined,
  resourceVersionId: string,
): CatalogPublication | null {
  return (
    publications?.find(
      (publication) =>
        publication.subjectKind === 'agent' &&
        publication.resourceVersionId === resourceVersionId &&
        publication.retiredAt === null,
    ) ?? null
  );
}

function grantSummary(grant: AuthorityGrant): string {
  const budgetAvailable = Math.max(
    0,
    grant.totalCostBudgetUsd - grant.spentCostUsd - grant.reservedCostUsd,
  );
  return `${grant.usedRuns}/${grant.maxRuns} runs · $${budgetAvailable.toFixed(2)} budget available · expires ${formatDate(grant.validUntil)}`;
}

export function CatalogAgentDetailDrawer({
  onClose,
  resourceVersionId,
}: CatalogAgentDetailDrawerProps) {
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [searchParams] = useSearchParams();
  const detail = usePlatformResource(resourceVersionId);
  const resourceIndex = usePlatformResources({ limit: indexLimit });
  const agentVersionIndex = usePlatformResources({ kind: 'Agent', limit: indexLimit });
  const publications = useCatalogPublications();
  const plugins = usePlugins({ includeDisabled: true, limit: indexLimit });
  const grants = useAuthorityGrants({ limit: indexLimit });
  const runs = useExecutionRuns({ limit: indexLimit });
  const resource = detail.data;
  const quarantined = resource !== undefined && isQuarantinedResource(resource);
  const isAgent = resource?.kind === 'Agent' && !quarantined;
  const parsedSpec = useMemo(
    () => (isAgent ? agentResourceSpecSchema.safeParse(resource.definition.spec) : null),
    [isAgent, resource],
  );
  const spec = parsedSpec?.success ? parsedSpec.data : null;
  const activePublication = publicationFor(publications.data?.items, resourceVersionId);
  const allResources = useMemo(
    () => (resourceIndex.isError ? [] : distinctResourceVersions(resourceIndex.data?.items ?? [])),
    [resourceIndex.data?.items, resourceIndex.isError],
  );
  const exactReferences = useMemo(() => {
    const byReference = new Map<string, ResourceVersion[]>();
    for (const item of allResources) {
      const key = referenceKey(item);
      byReference.set(key, [...(byReference.get(key) ?? []), item]);
    }
    return byReference;
  }, [allResources]);
  const resourceIndexPartial =
    resourceIndex.data !== undefined && resourceIndex.data.total > resourceIndex.data.items.length;
  const agentVersionIndexPartial =
    agentVersionIndex.data !== undefined && agentVersionIndex.data.items.length >= indexLimit;
  const familyVersions = useMemo(() => {
    if (!isAgent || !resource || agentVersionIndex.isError) return [];
    const versions = distinctResourceVersions(agentVersionIndex.data?.items ?? []).filter(
      (candidate) => candidate.familyId === resource.familyId,
    );
    if (!versions.some((candidate) => candidate.id === resource.id)) versions.push(resource);
    return versions.sort((left, right) =>
      right.version.localeCompare(left.version, undefined, { numeric: true }),
    );
  }, [agentVersionIndex.data?.items, agentVersionIndex.isError, isAgent, resource]);
  const matchingGrants = useMemo(
    () =>
      grants.isError
        ? []
        : (grants.data?.items ?? []).filter(
            (grant) => grant.entryResourceVersionId === resourceVersionId,
          ),
    [grants.data?.items, grants.isError, resourceVersionId],
  );
  const activeGrants = matchingGrants.filter((grant) => grant.state === 'active');
  const grantIndexPartial =
    grants.data !== undefined && grants.data.total > grants.data.items.length;
  const matchingRuns = useMemo(
    () =>
      runs.isError
        ? []
        : (runs.data?.items ?? []).filter(
            (run) => run.entryResourceVersionId === resourceVersionId,
          ),
    [resourceVersionId, runs.data?.items, runs.isError],
  );
  const runIndexPartial = runs.data !== undefined && runs.data.total > runs.data.items.length;
  const provenance = resource ? provenanceLabel(resource.provenance) : null;
  const syntheticProvenance = provenance?.toLocaleLowerCase().includes('synthetic') ?? false;
  const legacyAgentId = spec?.legacyCompatibility?.agentId ?? null;
  const capabilityProfile =
    activePublication?.capabilityProfile ?? resource?.definition.metadata.capabilityProfile;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const activeElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    returnFocusRef.current =
      activeElement && activeElement !== document.body && activeElement.isConnected
        ? activeElement
        : document.querySelector<HTMLElement>('.global-search-trigger');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current
      ?.querySelector<HTMLElement>('button, [href], input, select, textarea')
      ?.focus();

    function handleKeyDown(event: globalThis.KeyboardEvent) {
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

  function versionHref(nextResourceVersionId: string): string {
    const next = new URLSearchParams(searchParams);
    next.set('resource', nextResourceVersionId);
    return `/catalog?${next.toString()}`;
  }

  function resolveReference(reference: string): ResourceVersion | null {
    const matches = exactReferences.get(reference) ?? [];
    return matches.length === 1 ? matches[0]! : null;
  }

  return (
    <div
      className="drawer-backdrop catalog-detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        aria-labelledby={titleId}
        aria-modal="true"
        className="agent-drawer catalog-agent-drawer"
        ref={drawerRef}
        role="dialog"
      >
        <button
          aria-label="Close governed agent record"
          className="icon-button drawer-close"
          onClick={onClose}
          type="button"
        >
          <Icon name="close" size={20} />
        </button>
        <p className="page-kicker">CATALOG · EXACT GOVERNED AGENT VERSION</p>
        {!isAgent ? (
          <h2 className="sr-only" id={titleId}>
            Governed agent record
          </h2>
        ) : null}
        {detail.isLoading ? (
          <div aria-live="polite" className="catalog-detail-loading" role="status">
            Reading the immutable agent definition…
          </div>
        ) : null}
        {detail.isError ? (
          <Notice tone="error">
            Governed agent record unavailable. {getErrorMessage(detail.error)}
          </Notice>
        ) : null}
        {quarantined ? (
          <Notice tone="info">
            This audit-only fixture is quarantined from the user-facing Catalog.
          </Notice>
        ) : null}
        {resource !== undefined && resource.kind !== 'Agent' ? (
          <Notice tone="error">
            The requested definition is {resource.kind}, not an Agent. Open it from Registry or
            Knowledge instead.
          </Notice>
        ) : null}
        {isAgent && resource ? (
          <>
            <div className="drawer-status-line catalog-detail-statuses">
              <span className="os-status-chip" data-state={resource.lifecycle}>
                DEFINITION LIFECYCLE · {resource.lifecycle}
              </span>
              {publications.isError ? (
                <span className="os-status-chip">REUSE CERTIFICATION · UNAVAILABLE</span>
              ) : activePublication ? (
                <span className="os-status-chip" data-state="active">
                  REUSE CERTIFICATION · CERTIFIED
                </span>
              ) : (
                <span className="os-status-chip">NO ACTIVE REUSE CONTRACT</span>
              )}
              {syntheticProvenance ? (
                <span className="os-status-chip">SYNTHETIC PROVENANCE</span>
              ) : null}
            </div>
            <h2 id={titleId}>{resource.name}</h2>
            <p className="catalog-detail-version">
              Version {resource.version} · revision {resource.revision} ·{' '}
              {resource.frozenAt ? 'immutable snapshot' : 'not frozen'}
            </p>
            <p className="drawer-purpose">{resource.purpose}</p>
            <div className="catalog-state-explainer">
              <strong>Two states, two meanings.</strong>
              <p>
                Definition lifecycle describes this exact manifest. Reuse certification exists only
                when a separately governed, active publication is visible. Builder and runtime
                states are not substituted here.
              </p>
            </div>

            <dl className="drawer-facts catalog-detail-facts">
              <div>
                <dt>Owner</dt>
                <dd>{resource.owner}</dd>
              </div>
              <div>
                <dt>Definition lifecycle</dt>
                <dd>{readableState(resource.lifecycle)}</dd>
              </div>
              <div>
                <dt>Reuse contract</dt>
                <dd>{activePublication ? 'Active certified publication' : 'None visible'}</dd>
              </div>
              <div>
                <dt>Provenance</dt>
                <dd>{provenance}</dd>
              </div>
              {activePublication ? (
                <>
                  <div>
                    <dt>Business domain</dt>
                    <dd>{activePublication.capabilityProfile.businessDomain}</dd>
                  </div>
                  <div>
                    <dt>Catalog visibility</dt>
                    <dd>{activePublication.catalogVisibility}</dd>
                  </div>
                </>
              ) : null}
            </dl>

            {parsedSpec && !parsedSpec.success ? (
              <Notice tone="error">
                The immutable ResourceVersion is visible, but its Agent specification does not pass
                the current typed contract. Knowledge, tools, and workflow fields remain
                unavailable; nothing is inferred from its name.
              </Notice>
            ) : null}

            <section className="drawer-section catalog-detail-section">
              <header>
                <span>01</span>
                <div>
                  <h3>What it does</h3>
                  <p>Declared behavior in this exact Agent manifest.</p>
                </div>
              </header>
              {spec ? (
                <div className="catalog-detail-body">
                  <div className="catalog-detail-callout">
                    <span>OBJECTIVE</span>
                    <strong>{spec.objective}</strong>
                  </div>
                  {capabilityProfile ? (
                    <div className="catalog-detail-columns">
                      <div>
                        <h4>Declared tasks</h4>
                        {capabilityProfile.tasks.length > 0 ? (
                          <ul>
                            {capabilityProfile.tasks.map((task) => (
                              <li key={task}>{task}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No tasks are declared in the capability profile.</p>
                        )}
                      </div>
                      <div>
                        <h4>Declared outputs</h4>
                        {capabilityProfile.outputs.length > 0 ? (
                          <ul>
                            {capabilityProfile.outputs.map((output) => (
                              <li key={output}>{output}</li>
                            ))}
                          </ul>
                        ) : (
                          <p>No outputs are declared in the capability profile.</p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="catalog-detail-empty">
                      No capability profile is attached to this definition or an active publication.
                    </p>
                  )}
                  <dl className="catalog-inline-facts">
                    <div>
                      <dt>Skills</dt>
                      <dd>{spec.skills.join(', ')}</dd>
                    </div>
                    <div>
                      <dt>Protocols</dt>
                      <dd>{spec.protocols.join(', ') || 'None declared'}</dd>
                    </div>
                    <div>
                      <dt>Execution boundary</dt>
                      <dd>
                        {spec.executionLoop.maximumSteps} steps maximum · unresolved work{' '}
                        {readableState(spec.executionLoop.onUnresolved)}
                      </dd>
                    </div>
                    <div>
                      <dt>Memory</dt>
                      <dd>
                        Reads {readableState(spec.memoryPolicy.reads)} · writes{' '}
                        {readableState(spec.memoryPolicy.writes)}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </section>

            <section className="drawer-section catalog-detail-section">
              <header>
                <span>02</span>
                <div>
                  <h3>Safeguards and response</h3>
                  <p>
                    Digest-verified prohibitions, approval requirements, stop conditions, and
                    response obligations for this exact version.
                  </p>
                </div>
              </header>
              <AgentGovernancePanel governance={resource.agentGovernance} />
            </section>

            <section className="drawer-section catalog-detail-section">
              <header>
                <span>03</span>
                <div>
                  <h3>What it knows</h3>
                  <p>Exact knowledge-source references declared by this version.</p>
                </div>
              </header>
              {resourceIndex.isError ? (
                <Notice tone="error">
                  Knowledge definitions unavailable. {getErrorMessage(resourceIndex.error)} No
                  missing source is treated as absent.
                </Notice>
              ) : spec ? (
                spec.knowledgeSources.length > 0 ? (
                  <div className="catalog-reference-list">
                    {spec.knowledgeSources.map((reference) => {
                      const resolved = resolveReference(reference);
                      return (
                        <article key={reference}>
                          <span>KNOWLEDGE SOURCE · {reference}</span>
                          <strong>{resolved?.name ?? 'Exact source detail unavailable'}</strong>
                          <p>
                            {resolved?.purpose ??
                              (resourceIndexPartial
                                ? 'The loaded definition index is partial, so this declaration cannot be resolved here.'
                                : 'No unique source definition is visible for this exact reference.')}
                          </p>
                          {resolved ? (
                            <Link
                              to={`/knowledge?${new URLSearchParams({ type: 'datasets', entity: resolved.id }).toString()}`}
                            >
                              OPEN SOURCE DEFINITION →
                            </Link>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="catalog-detail-empty">
                    This exact version declares no knowledge sources.
                  </p>
                )
              ) : null}
              {resourceIndexPartial ? (
                <p className="catalog-detail-boundary">
                  PARTIAL INDEX · {resourceIndex.data?.items.length} of {resourceIndex.data?.total}{' '}
                  governed definitions are loaded. Unresolved references remain unavailable.
                </p>
              ) : null}
            </section>

            <section className="drawer-section catalog-detail-section">
              <header>
                <span>04</span>
                <div>
                  <h3>Systems and authority</h3>
                  <p>Declared Plugin tools, connector state, and exact matching grants.</p>
                </div>
              </header>
              {plugins.isError ? (
                <Notice tone="error">
                  Connector catalog unavailable. {getErrorMessage(plugins.error)} Tool identities
                  and effects remain unavailable.
                </Notice>
              ) : spec ? (
                spec.tools.length > 0 ? (
                  <div className="catalog-reference-list">
                    {spec.tools.map((tool, index) => {
                      if (typeof tool === 'string') {
                        return (
                          <article key={`${tool}-${index}`}>
                            <span>LEGACY TOOL DECLARATION</span>
                            <strong>{tool}</strong>
                            <p>
                              This legacy name does not identify an exact Plugin version. Connector,
                              effect, and authority remain unavailable.
                            </p>
                          </article>
                        );
                      }
                      const plugin = plugins.data?.items.find(
                        (candidate) =>
                          candidate.familyId === tool.plugin.familyId &&
                          candidate.version === tool.plugin.version,
                      );
                      const capability = plugin?.capabilities.find(
                        (candidate) => candidate.tool === tool.tool,
                      );
                      const matchingActiveGrant =
                        plugin === undefined
                          ? null
                          : (activeGrants.find((grant) =>
                              grant.pluginScopes.some(
                                (scope) =>
                                  scope.pluginVersionId === plugin.pluginVersionId &&
                                  scope.tool === tool.tool,
                              ),
                            ) ?? null);
                      const authorityLabel = matchingActiveGrant
                        ? 'ACTIVE MATCHING GRANT'
                        : grantIndexPartial
                          ? 'AUTHORITY INDEX PARTIAL'
                          : 'DECLARED · NO ACTIVE MATCHING GRANT';
                      return (
                        <article
                          key={`${tool.plugin.familyId}-${tool.plugin.version}-${tool.tool}`}
                        >
                          <span>
                            {plugin
                              ? `${plugin.transport} · ${plugin.executionPlacement} · ${plugin.classification}`
                              : `PLUGIN ${tool.plugin.version} · EXACT RECORD UNAVAILABLE`}
                          </span>
                          <strong>
                            {plugin?.name ?? 'Unresolved Plugin'} · {tool.tool}
                          </strong>
                          <p>
                            {capability?.scopeDescription ??
                              'The exact tool capability is not visible; no effect or scope is inferred.'}
                          </p>
                          <div className="catalog-reference-flags">
                            <em>
                              {capability
                                ? `EFFECT · ${capability.effect}`
                                : 'EFFECT · UNAVAILABLE'}
                            </em>
                            <em>{authorityLabel}</em>
                            <em>
                              {plugin
                                ? `INSTALLATION · ${plugin.installationState ?? 'not installed'} · ${plugin.healthStatus}`
                                : 'INSTALLATION · UNAVAILABLE'}
                            </em>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="catalog-detail-empty">
                    This exact version declares no Plugin tools.
                  </p>
                )
              ) : null}
              <div className="catalog-subsection">
                <h4>Authority held by this exact version</h4>
                {grants.isError ? (
                  <Notice tone="error">
                    Authority ledger unavailable. {getErrorMessage(grants.error)} Do not infer that
                    this agent has no authority.
                  </Notice>
                ) : matchingGrants.length > 0 ? (
                  <ul className="catalog-ledger-list">
                    {matchingGrants.map((grant) => (
                      <li key={grant.id}>
                        <span className="os-status-chip" data-state={grant.state}>
                          {grant.state}
                        </span>
                        <span>{grantSummary(grant)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="catalog-detail-empty">
                    {grantIndexPartial
                      ? 'No matching grant appears in the loaded portion of the authority ledger.'
                      : 'No authority grant is recorded for this exact version.'}
                  </p>
                )}
                {grantIndexPartial ? (
                  <p className="catalog-detail-boundary">
                    PARTIAL AUTHORITY LEDGER · {grants.data?.items.length} of {grants.data?.total}{' '}
                    grants are loaded.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="drawer-section catalog-detail-section">
              <header>
                <span>05</span>
                <div>
                  <h3>Evidence and operational record</h3>
                  <p>Certification summary and runs bound to this exact ResourceVersion.</p>
                </div>
              </header>
              {publications.isError ? (
                <Notice tone="error">
                  Reuse certification unavailable. {getErrorMessage(publications.error)} Definition
                  lifecycle is not used as a substitute.
                </Notice>
              ) : activePublication ? (
                <div className="catalog-evidence-card">
                  <span>CERTIFIED RELEASE EVIDENCE</span>
                  <strong>{activePublication.trustChip.label}</strong>
                  <dl>
                    <div>
                      <dt>Required gates</dt>
                      <dd>
                        {activePublication.trustChip.gatesPassed}/
                        {activePublication.trustChip.gatesTotal} passed
                      </dd>
                    </div>
                    <div>
                      <dt>Evaluation corpus</dt>
                      <dd>{activePublication.trustChip.corpusSize} cases</dd>
                    </div>
                    <div>
                      <dt>Re-certified</dt>
                      <dd>{formatDate(activePublication.trustChip.recertifiedAt)}</dd>
                    </div>
                  </dl>
                  <code title={activePublication.releaseDigest}>
                    RELEASE DIGEST · {shortDigest(activePublication.releaseDigest)}
                  </code>
                  <p>
                    The publication exposes its certified summary. Individual gate and case records
                    are not available through the current Catalog API.
                  </p>
                </div>
              ) : (
                <p className="catalog-detail-empty">
                  No active certified reuse publication is visible for this exact version.
                  Definition lifecycle alone is not certification evidence.
                </p>
              )}
              <div className="catalog-subsection">
                <h4>Governed runs</h4>
                {runs.isError ? (
                  <Notice tone="error">
                    Run ledger unavailable. {getErrorMessage(runs.error)} No run count is shown.
                  </Notice>
                ) : matchingRuns.length > 0 ? (
                  <ul className="catalog-ledger-list">
                    {matchingRuns.slice(0, 5).map((run) => (
                      <li key={run.id}>
                        <span className="os-status-chip" data-state={run.state}>
                          {readableState(run.state)}
                        </span>
                        <Link to={`/runs?${new URLSearchParams({ run: run.id }).toString()}`}>
                          {formatDate(run.createdAt)} · {run.message}
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="catalog-detail-empty">
                    {runIndexPartial
                      ? 'No matching run appears in the loaded portion of the run ledger.'
                      : 'No governed run is recorded for this exact version.'}
                  </p>
                )}
                {matchingRuns.length > 5 ? (
                  <p className="catalog-detail-boundary">
                    Showing 5 of {matchingRuns.length} matching runs returned in this view.
                  </p>
                ) : null}
                {runIndexPartial ? (
                  <p className="catalog-detail-boundary">
                    PARTIAL RUN LEDGER · {runs.data?.items.length} of {runs.data?.total} runs are
                    loaded.
                  </p>
                ) : null}
              </div>
            </section>

            <section className="drawer-section catalog-detail-section">
              <header>
                <span>06</span>
                <div>
                  <h3>Version history</h3>
                  <p>
                    Immutable versions in the same canonical Agent family; the current record is
                    marked in place.
                  </p>
                </div>
              </header>
              {agentVersionIndex.isError ? (
                <Notice tone="error">
                  Agent version index unavailable. {getErrorMessage(agentVersionIndex.error)}
                </Notice>
              ) : (
                <div className="catalog-version-list">
                  {familyVersions.map((version) => {
                    const current = version.id === resource.id;
                    const content = (
                      <>
                        <span>
                          <strong>Version {version.version}</strong>
                          <small>Revision {version.revision}</small>
                        </span>
                        <span className="catalog-version-state">
                          <span className="os-status-chip" data-state={version.lifecycle}>
                            {version.lifecycle} definition
                          </span>
                          {current ? <small>CURRENT VERSION</small> : null}
                        </span>
                      </>
                    );
                    return current ? (
                      <div aria-current="page" className="catalog-version-current" key={version.id}>
                        {content}
                      </div>
                    ) : (
                      <Link key={version.id} to={versionHref(version.id)}>
                        {content}
                      </Link>
                    );
                  })}
                </div>
              )}
              {agentVersionIndexPartial ? (
                <p className="catalog-detail-boundary">
                  PARTIAL VERSION INDEX · The Agent lookup reached its {indexLimit}-record cap, so
                  this family history may be incomplete.
                </p>
              ) : null}
            </section>

            <section className="catalog-detail-actions" aria-label="Governed agent actions">
              <div>
                <span>REUSE, CONFIGURE, OR EXTEND</span>
                <strong>
                  {activePublication
                    ? 'Start with a confirmed Build intake.'
                    : 'Build can search for a certified fit or start a new governed draft.'}
                </strong>
                <p>
                  Build owns these decisions and records source lineage. Opening it does not use,
                  configure, or extend this agent by itself.
                </p>
              </div>
              <div className="drawer-actions">
                <Link className="primary-button" to={buildHref(resource.id)}>
                  {activePublication ? 'CHECK CERTIFIED FIT IN BUILD →' : 'OPEN BUILD →'}
                </Link>
                <Link
                  className="secondary-button"
                  to={`/knowledge?${new URLSearchParams({ type: 'agents', entity: resource.id }).toString()}`}
                >
                  OPEN DEFINITION GRAPH
                </Link>
                {featureFlags.visualSurfacesEnabled && legacyAgentId ? (
                  <Link className="secondary-button" to={`/bench/${legacyAgentId}`}>
                    INSPECT ASSEMBLY
                  </Link>
                ) : (
                  <span className="catalog-disabled-action">
                    <strong>INSPECT ASSEMBLY · UNAVAILABLE</strong>
                    <small>
                      {featureFlags.visualSurfacesEnabled
                        ? 'This exact Agent version has no linked Builder record for the legacy Assembly route.'
                        : 'The Assembly route is disabled for this deployment.'}
                    </small>
                  </span>
                )}
              </div>
            </section>

            <details className="catalog-provenance-detail">
              <summary>Immutable provenance</summary>
              <dl>
                <div>
                  <dt>Definition digest</dt>
                  <dd>
                    <code title={resource.digest}>{shortDigest(resource.digest)}</code>
                  </dd>
                </div>
                <div>
                  <dt>Source commit</dt>
                  <dd>{resource.sourceCommit}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(resource.createdAt)}</dd>
                </div>
                <div>
                  <dt>Last registry update</dt>
                  <dd>{formatDate(resource.updatedAt)}</dd>
                </div>
              </dl>
            </details>
          </>
        ) : null}
      </aside>
    </div>
  );
}
