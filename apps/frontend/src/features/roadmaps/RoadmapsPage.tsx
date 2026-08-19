import { useMemo, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { RoadmapFork, RoadmapProgram, RoadmapSourceState } from '@agent-builder/contracts';
import seedManifestText from '../../../../../03-projects/roadmaps/roadmaps.seed.json?raw';
import {
  filteredRoadmapForks,
  isRoadmapForkFilter,
  loadRoadmapProgram,
  timelinePosition,
} from './roadmap-model';
import './roadmaps.css';

interface RoadmapsPageProps {
  readonly manifestText?: string;
}

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

function ForkSummary({ fork, programSynthetic }: { fork: RoadmapFork; programSynthetic: boolean }) {
  const source: RoadmapSourceState = programSynthetic
    ? 'synthetic'
    : fork.jira.state === 'live'
      ? 'live'
      : 'awaiting_transfer';
  return (
    <article className="roadmap-fork-summary" data-status={fork.status}>
      <header>
        <div>
          <span>{fork.id.replace('fork_', 'FORK · ').replaceAll('_', ' ').toUpperCase()}</span>
          <h3>{fork.label}</h3>
        </div>
        <div className="roadmap-fork-status">
          <SourceBadge source={source} />
          <strong>{statusLabels[fork.status]}</strong>
        </div>
      </header>
      <p>{fork.purpose}</p>
      <JiraBinding fork={fork} />
    </article>
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

export function RoadmapsPage({ manifestText = seedManifestText }: RoadmapsPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const loaded = useMemo(() => loadRoadmapProgram(manifestText), [manifestText]);

  if (!loaded.ok) {
    return (
      <main className="roadmaps-page">
        <header className="roadmaps-header">
          <p>PAUL OS · ROADMAPS</p>
          <h1>Roadmap source unavailable</h1>
          <p role="alert">{loaded.message} No progress or nominal state is inferred.</p>
        </header>
      </main>
    );
  }

  const requestedFork = searchParams.get('fork');
  const selected = isRoadmapForkFilter(loaded.program, requestedFork) ? requestedFork : 'all';
  const visibleForks = filteredRoadmapForks(loaded.program, selected);
  const provenanceStates = programSourceStates(loaded.program);

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
          <h1>{loaded.program.title}</h1>
          <p>{loaded.program.description}</p>
        </div>
        <div className="roadmaps-provenance">
          {provenanceStates.map((source) => (
            <SourceBadge key={source} source={source} />
          ))}
        </div>
      </header>

      <RoadmapBindingNote program={loaded.program} />

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
          {loaded.program.forks.map((fork) => (
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
          question="Which fork is moving, blocked, or waiting for a decision?"
          title="State now"
        />
        <div className="roadmap-fork-grid">
          {visibleForks.map((fork) => (
            <ForkSummary fork={fork} key={fork.id} programSynthetic={loaded.program.synthetic} />
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
          question="Where do the two plans converge, diverge, and carry risk?"
          title="Plan across six months"
        />
        <RoadmapTimeline forks={visibleForks} program={loaded.program} />
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
