import { type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { RoadmapFork, RoadmapProgram, RoadmapSourceState } from '@agent-builder/contracts';
import { getErrorMessage } from '../../api/client';
import { useRoadmapProgram } from '../../api/hooks';
import { filteredRoadmapForks, isRoadmapForkFilter, timelinePosition } from './roadmap-model';
import './roadmaps.css';

const sourceLabels: Record<RoadmapSourceState, string> = {
  live: 'LIVE',
  synthetic: 'SYNTHETIC',
  awaiting_transfer: 'AWAITING TRANSFER',
};

const statusLabels: Record<RoadmapFork['status'], string> = {
  on_track: 'ON TRACK',
  watch: 'WATCH',
  at_risk: 'AT RISK',
  unavailable: 'UNAVAILABLE',
};

const stateLabels: Record<RoadmapFork['workstreams'][number]['state'], string> = {
  complete: 'COMPLETE',
  in_work: 'IN WORK',
  planned: 'PLANNED',
  at_risk: 'AT RISK',
};

const relationshipPredicateLabels: Record<
  RoadmapFork['relationships'][number]['predicate'],
  string
> = {
  scoped_to_vertical: 'SCOPED TO VERTICAL',
  maps_to_aim_group: 'MAPS TO AIM GROUP',
  contributed_to_by_agent: 'CONTRIBUTED TO BY AGENT',
  produced_execution_run: 'PRODUCED EXECUTION RUN',
};

const relationshipCoverageLabels = {
  vertical: 'Program vertical',
  aimGroup: 'AIM group',
  contributingAgents: 'Contributing agents',
  executionRuns: 'Execution runs',
} as const;

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const sourceOrder: readonly RoadmapSourceState[] = ['live', 'synthetic', 'awaiting_transfer'];

function programSourceStates(program: RoadmapProgram): readonly RoadmapSourceState[] {
  const states = new Set<RoadmapSourceState>();
  if (program.synthetic) states.add('synthetic');
  for (const fork of program.forks) {
    states.add(fork.source);
    states.add(fork.jira.state === 'live' ? 'live' : 'awaiting_transfer');
    for (const metric of fork.metrics) states.add(metric.source);
    for (const workstream of fork.workstreams) states.add(workstream.source);
    for (const action of fork.actions) states.add(action.source);
  }
  return sourceOrder.filter((source) => states.has(source));
}

function SourceBadge({ source }: { source: RoadmapSourceState }) {
  return (
    <span className="roadmap-source" data-source={source}>
      {sourceLabels[source]}
    </span>
  );
}

function BandHeading({
  number,
  title,
  question,
  id,
}: {
  readonly number: '01' | '02' | '03';
  readonly title: string;
  readonly question: string;
  readonly id: string;
}) {
  return (
    <header className="roadmap-band-heading">
      <span aria-hidden="true">{number}</span>
      <div>
        <h2 id={id}>{title}</h2>
        <p>{question}</p>
      </div>
    </header>
  );
}

function JiraBinding({ fork }: { fork: RoadmapFork }) {
  const binding = [
    fork.jira.projectKey ? `PROJECT ${fork.jira.projectKey}` : null,
    fork.jira.filterId ? `FILTER ${fork.jira.filterId}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(' · ');
  const coverage =
    fork.jira.includedIssueCount !== null && fork.jira.totalIssueCount !== null
      ? `${fork.jira.includedIssueCount} OF ${fork.jira.totalIssueCount} ISSUES MAPPED`
      : 'NO ISSUE POPULATION LOADED';
  return (
    <div className="roadmap-jira-state">
      <strong>JIRA · {fork.jira.state.replaceAll('_', ' ').toUpperCase()}</strong>
      <span>{binding || 'NO PRIVATE BINDING LOADED'}</span>
      <span>{coverage}</span>
      {fork.jira.lastSyncedAt ? (
        <time dateTime={fork.jira.lastSyncedAt}>
          LAST SYNC · {dateTimeFormatter.format(new Date(fork.jira.lastSyncedAt))}
        </time>
      ) : (
        <span>NO SUCCESSFUL SYNC RECORDED</span>
      )}
    </div>
  );
}

function RoadmapBindingNote({ program }: { program: RoadmapProgram }) {
  const awaitingCount = program.forks.filter(
    (fork) => fork.jira.state === 'awaiting_transfer',
  ).length;
  const allLive = program.forks.every((fork) => fork.jira.state === 'live');
  const heading =
    awaitingCount > 0
      ? `${awaitingCount === 2 ? 'PRIVATE ROADMAP IDENTITIES ARE' : 'ONE PRIVATE ROADMAP IDENTITY IS'} NOT PRESENT ON THIS MACHINE`
      : allLive
        ? 'BOTH GOVERNED JIRA BINDINGS ARE LIVE'
        : 'JIRA BINDINGS ARE CONFIGURED · LIVE SYNC IS INCOMPLETE';
  const detail =
    awaitingCount > 0
      ? 'Neutral slots prove the interaction and comparison model. Transfer binds each missing slot to one exact Jira project or filter plus changelog history; names and measurements change without rewriting this page.'
      : allLive
        ? 'Each fork below names its exact Jira binding, mapped issue population, and last successful sync. Partial coverage remains explicit.'
        : 'Exact identifiers are loaded, but at least one fork lacks a current Jira population. It cannot be called on track until a successful governed sync is recorded.';
  return (
    <aside className="roadmaps-transfer-note" role="note">
      <strong>{heading}</strong>
      <p>{detail}</p>
    </aside>
  );
}

function ForkSummary({ fork }: { fork: RoadmapFork }) {
  return (
    <article className="roadmap-fork-summary" data-status={fork.status}>
      <header>
        <div>
          <span>{fork.id.replace('fork_', 'FORK · ').replaceAll('_', ' ').toUpperCase()}</span>
          <h3>{fork.label}</h3>
        </div>
        <div className="roadmap-fork-status">
          <SourceBadge source={fork.source} />
          <strong>{statusLabels[fork.status]}</strong>
        </div>
      </header>
      <p>{fork.purpose}</p>
      <JiraBinding fork={fork} />
    </article>
  );
}

type RoadmapRelationshipTarget = RoadmapFork['relationships'][number]['target'];
type RoadmapDefinitionTarget = RoadmapFork['definitionDependencies'][number]['target'];

function governedDefinitionRoute(target: RoadmapDefinitionTarget): string | null {
  const query = new URLSearchParams({ entity: target.resourceVersionId });
  switch (target.kind) {
    case 'Agent':
      return `/catalog?${new URLSearchParams({ resource: target.resourceVersionId }).toString()}`;
    case 'Project':
      query.set('type', 'projects');
      break;
    case 'Protocol':
      query.set('type', 'decisions');
      break;
    case 'KnowledgeSource':
      query.set('type', 'datasets');
      break;
    case 'Reference':
      query.set('type', 'runbooks');
      break;
    case 'MetricDefinition':
      query.set('type', 'metrics');
      break;
    case 'Plugin':
    case 'PluginPack':
      query.set('type', 'systems');
      break;
    case 'Skill':
      query.set('type', 'agents');
      break;
    default:
      return null;
  }
  return `/knowledge?${query.toString()}`;
}

function DefinitionDependencyTarget({ target }: { target: RoadmapDefinitionTarget }) {
  const route = governedDefinitionRoute(target);
  const label = `${target.name} · ${target.version}`;
  return route ? (
    <Link to={route}>{label} ↗</Link>
  ) : (
    <>
      <strong>{label}</strong>
      <em>NO DETAIL ROUTE</em>
    </>
  );
}

function relationshipTarget(target: RoadmapRelationshipTarget): ReactNode {
  if (target.kind === 'vertical') {
    return (
      <Link to={`/?${new URLSearchParams({ vertical: target.id }).toString()}`}>
        {target.id.replace('group_', '').replaceAll('_', ' ')} ↗
      </Link>
    );
  }
  if (target.kind === 'aim_group') {
    return (
      <Link to={`/aim?${new URLSearchParams({ group: target.id }).toString()}`}>
        {target.id.replace('group_', '').replaceAll('_', ' ')} ↗
      </Link>
    );
  }
  if (target.kind === 'resource_version') {
    return (
      <>
        <Link
          to={`/catalog?${new URLSearchParams({ resource: target.resourceVersionId }).toString()}`}
        >
          {target.name} · {target.version} ↗
        </Link>
        <small>{target.resourceKind}</small>
      </>
    );
  }
  return (
    <Link to={`/operate?${new URLSearchParams({ run: target.id }).toString()}`}>
      Execution run ↗
    </Link>
  );
}

function relationshipTargetIdentity(target: RoadmapRelationshipTarget): string {
  if (target.kind === 'vertical' || target.kind === 'aim_group') {
    return `${target.namespace}/${target.schemaVersion} · ${target.id}`;
  }
  if (target.kind === 'resource_version') {
    return `${target.resourceKind} · ${target.familyId}@${target.version} · ${target.resourceVersionId}`;
  }
  return `execution_run · ${target.id}`;
}

function RoadmapConnections({ fork }: { fork: RoadmapFork }) {
  const coverage = (
    Object.entries(relationshipCoverageLabels) as Array<
      [keyof typeof relationshipCoverageLabels, string]
    >
  ).map(([key, label]) => ({ key, label, ...fork.relationshipCoverage[key] }));

  return (
    <section aria-labelledby={`${fork.id}-connections-title`} className="roadmap-connections">
      <header>
        <div>
          <span>GOVERNED DEFINITION RELATIONSHIPS · {fork.label}</span>
          <h3 id={`${fork.id}-connections-title`}>What this fork is joined to</h3>
        </div>
        <small>{`${fork.resource.slug}@${fork.resource.version}`}</small>
      </header>
      <dl className="roadmap-coverage-list">
        {coverage.map((item) => (
          <div data-state={item.state} key={item.key}>
            <dt>{item.label}</dt>
            <dd>
              <strong>{item.state.replaceAll('_', ' ').toUpperCase()}</strong>
              <span>{item.detail}</span>
            </dd>
          </div>
        ))}
      </dl>
      {fork.relationships.length === 0 ? (
        <p className="roadmap-no-edges">
          No governed relationship edge is declared. Missing links remain unmapped or unavailable.
        </p>
      ) : (
        <ol aria-label={`${fork.label} governed relationships`} className="roadmap-edge-list">
          {fork.relationships.map((relationship) => (
            <li key={relationship.id}>
              <div>
                <span>{relationshipPredicateLabels[relationship.predicate]}</span>
                <strong>{relationshipTarget(relationship.target)}</strong>
              </div>
              <details>
                <summary>EDGE EVIDENCE</summary>
                <dl>
                  <div>
                    <dt>Direction</dt>
                    <dd>{`${relationship.source.slug}@${relationship.source.version} → ${relationship.predicate}`}</dd>
                  </div>
                  <div>
                    <dt>Source identity</dt>
                    <dd>{`${relationship.source.familyId}@${relationship.source.version} · ${relationship.source.resourceVersionId}`}</dd>
                  </div>
                  <div>
                    <dt>Source digest</dt>
                    <dd>{relationship.source.digest}</dd>
                  </div>
                  <div>
                    <dt>Target identity</dt>
                    <dd>{relationshipTargetIdentity(relationship.target)}</dd>
                  </div>
                  {relationship.target.kind === 'resource_version' ? (
                    <div>
                      <dt>Target digest</dt>
                      <dd>{relationship.target.digest}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Provenance</dt>
                    <dd>{relationship.provenance.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt>Source reference</dt>
                    <dd>{`${relationship.sourceRef.definitionDependencyId} · ${relationship.sourceRef.locator}`}</dd>
                  </div>
                </dl>
              </details>
            </li>
          ))}
        </ol>
      )}
      <details className="roadmap-definition-pins">
        <summary>DEFINITION PINS · {fork.definitionDependencies.length}</summary>
        {fork.definitionDependencies.length === 0 ? (
          <p>No exact definition dependency is declared.</p>
        ) : (
          <ol>
            {fork.definitionDependencies.map((dependency) => (
              <li key={dependency.id}>
                <DefinitionDependencyTarget target={dependency.target} />
                <span>{`${dependency.role.replaceAll('_', ' ').toUpperCase()} · ${dependency.provenance.toUpperCase()}`}</span>
                <small>{`${dependency.target.familyId}@${dependency.target.version} · ${dependency.target.resourceVersionId}`}</small>
              </li>
            ))}
          </ol>
        )}
      </details>
    </section>
  );
}

function RoadmapTimeline({
  program,
  forks,
}: {
  program: RoadmapProgram;
  forks: readonly RoadmapFork[];
}) {
  return (
    <div className="roadmap-timeline" role="region" aria-label="Forked roadmap plan">
      <header>
        <span>{dateFormatter.format(new Date(program.timeline.startAt))}</span>
        <span>{dateFormatter.format(new Date(program.timeline.endAt))}</span>
      </header>
      {forks.map((fork) => (
        <section aria-labelledby={`${fork.id}-timeline-title`} key={fork.id}>
          <div className="roadmap-timeline-fork">
            <h3 id={`${fork.id}-timeline-title`}>{fork.label}</h3>
            <div>
              {sourceOrder
                .filter((source) => fork.workstreams.some((item) => item.source === source))
                .map((source) => (
                  <SourceBadge key={source} source={source} />
                ))}
            </div>
          </div>
          <ol>
            {fork.workstreams.map((workstream) => {
              const position = timelinePosition(program, workstream.startAt, workstream.endAt);
              const style = {
                '--roadmap-start': `${position.startPercent}%`,
                '--roadmap-width': `${position.widthPercent}%`,
              } as CSSProperties;
              return (
                <li key={workstream.id}>
                  <div className="roadmap-row-identity">
                    <span className="roadmap-row-label">{workstream.label}</span>
                    <SourceBadge source={workstream.source} />
                    <span className="roadmap-row-state" data-state={workstream.state}>
                      {stateLabels[workstream.state]}
                    </span>
                  </div>
                  <div className="roadmap-row-track">
                    <div
                      aria-hidden="true"
                      className="roadmap-row-bar"
                      data-duration-percent={position.widthPercent.toFixed(4)}
                      data-state={workstream.state}
                      style={style}
                      title={`${workstream.label} · ${stateLabels[workstream.state]} · ${dateFormatter.format(new Date(workstream.startAt))} to ${dateFormatter.format(new Date(workstream.endAt))}`}
                    />
                  </div>
                  <small>
                    {dateFormatter.format(new Date(workstream.startAt))} —{' '}
                    {dateFormatter.format(new Date(workstream.endAt))}
                  </small>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function RoadmapUnavailable({ message }: { message: string }) {
  return (
    <main className="roadmaps-page">
      <header className="roadmaps-header">
        <div>
          <p>PAUL OS · ROADMAPS</p>
          <h1>Roadmap source unavailable</h1>
          <p role="alert">{message} No progress or nominal state is inferred.</p>
        </div>
      </header>
    </main>
  );
}

function RoadmapPending() {
  return (
    <main className="roadmaps-page">
      <header className="roadmaps-header">
        <div>
          <p>PAUL OS · ROADMAPS</p>
          <h1>Roadmaps</h1>
          <p aria-live="polite" role="status">
            Loading governed roadmaps…
          </p>
        </div>
      </header>
    </main>
  );
}

export function RoadmapsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const roadmapProgram = useRoadmapProgram();

  if (roadmapProgram.isPending) {
    return <RoadmapPending />;
  }
  if (roadmapProgram.isError || roadmapProgram.data === undefined) {
    return (
      <RoadmapUnavailable
        message={`The governed roadmap projection could not be loaded. ${getErrorMessage(roadmapProgram.error)}`}
      />
    );
  }

  const program = roadmapProgram.data;

  const requestedFork = searchParams.get('fork');
  const selected = isRoadmapForkFilter(program, requestedFork) ? requestedFork : 'all';
  const visibleForks = filteredRoadmapForks(program, selected);
  const provenanceStates = programSourceStates(program);

  function selectFork(nextFork: string) {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextFork === 'all') next.delete('fork');
      else next.set('fork', nextFork);
      return next;
    });
  }

  return (
    <main className="roadmaps-page">
      <header className="roadmaps-header">
        <div>
          <p>PAUL OS · TWO FORK ROADMAPS</p>
          <h1>{program.title}</h1>
          <p>{program.description}</p>
        </div>
        <div className="roadmaps-provenance">
          {provenanceStates.map((source) => (
            <SourceBadge key={source} source={source} />
          ))}
        </div>
      </header>

      <RoadmapBindingNote program={program} />

      <nav aria-label="Roadmap fork filter" className="roadmap-fork-filter">
        <span>ONE FILTER · THREE BANDS</span>
        <ul>
          <li>
            <button
              aria-pressed={selected === 'all'}
              onClick={() => selectFork('all')}
              type="button"
            >
              Compare both
            </button>
          </li>
          {program.forks.map((fork) => (
            <li key={fork.id}>
              <button
                aria-pressed={selected === fork.id}
                onClick={() => selectFork(fork.id)}
                type="button"
              >
                {fork.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="roadmap-state-title" className="roadmap-band">
        <BandHeading
          id="roadmap-state-title"
          number="01"
          question={
            visibleForks.length === 1
              ? 'Is this fork moving, blocked, or waiting for a decision?'
              : 'Which fork is moving, blocked, or waiting for a decision?'
          }
          title="State now"
        />
        <div className="roadmap-fork-grid">
          {visibleForks.map((fork) => (
            <ForkSummary fork={fork} key={fork.id} />
          ))}
        </div>
        <div className="roadmap-connections-grid">
          {visibleForks.map((fork) => (
            <RoadmapConnections fork={fork} key={fork.id} />
          ))}
        </div>
        <div className="roadmap-metric-grid">
          {visibleForks.flatMap((fork) =>
            fork.metrics.map((metric) => (
              <article data-state={metric.state} key={`${fork.id}:${metric.id}`}>
                <header>
                  <span>{fork.label}</span>
                  <SourceBadge source={metric.source} />
                </header>
                <h3>{metric.label}</h3>
                <strong>{metric.value ?? '—'}</strong>
                <p>{metric.detail}</p>
              </article>
            )),
          )}
        </div>
      </section>

      <section aria-labelledby="roadmap-plan-title" className="roadmap-band">
        <BandHeading
          id="roadmap-plan-title"
          number="02"
          question={
            visibleForks.length === 1
              ? 'Where does this plan carry sequence and risk?'
              : 'Where do the two plans converge, diverge, and carry risk?'
          }
          title="Plan across six months"
        />
        <RoadmapTimeline forks={visibleForks} program={program} />
      </section>

      <section aria-labelledby="roadmap-action-title" className="roadmap-band">
        <BandHeading
          id="roadmap-action-title"
          number="03"
          question="What decision or unblock changes the represented plan next?"
          title="Actions and decisions"
        />
        <ol className="roadmap-action-list">
          {visibleForks.flatMap((fork) =>
            fork.actions.map((action) => (
              <li data-state={action.state} key={`${fork.id}:${action.id}`}>
                <div>
                  <span>{fork.label}</span>
                  <SourceBadge source={action.source} />
                </div>
                <h3>{action.label}</h3>
                <p>{action.consequence}</p>
                <span className="roadmap-action-destination">
                  READ ONLY · NO GOVERNED DESTINATION
                </span>
                <footer>
                  <span>{action.owner}</span>
                  <time dateTime={action.dueAt ?? undefined}>
                    {action.dueAt
                      ? `DUE ${dateFormatter.format(new Date(action.dueAt))}`
                      : 'DATE AWAITING TRANSFER'}
                  </time>
                </footer>
              </li>
            )),
          )}
        </ol>
      </section>

      <footer className="roadmaps-contract">
        <strong>TRANSFER CONTRACT</strong>
        <p>
          Each fork requires an exact Jira project or saved filter, issue changelog, issue links,
          milestone mapping, and a disclosed included-versus-total issue count. Missing coverage
          remains unavailable; it never becomes zero or on track.
        </p>
      </footer>
    </main>
  );
}
