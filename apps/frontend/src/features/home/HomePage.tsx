import { useMemo, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { consoleCriticalCopy, type RoadmapFork } from '@agent-builder/contracts';
import {
  useAttention,
  useAuthorityGrants,
  useAutomationSchedules,
  useExecutionRuns,
  usePlugins,
  useRoadmapProgram,
} from '../../api/hooks';
import { featureFlags } from '../../config/feature-flags';
import seedManifestText from '../../../../../03-projects/aim/program.seed.json?raw';
import {
  HOME_VERTICALS,
  isHomeVerticalId,
  loadHomeProgram,
  metricsForVertical,
  programActionsForVertical,
  verticalLabel,
  workstreamsForVertical,
  type HomeMetric,
  type HomeMetricSource,
  type HomeProgramAction,
  type HomeProgramModel,
  type HomeVerticalId,
  type HomeWorkstream,
} from './home-model';
import './home.css';

const homeCopy = consoleCriticalCopy.home;
const homeAttentionAction = homeCopy.actions[0];
const homeProgram = loadHomeProgram(seedManifestText);

if (!homeAttentionAction) {
  throw new Error('Governed Today copy must define the Attention handoff.');
}

interface HomePageProps {
  /** Injectable so date-driven labels and exception windows remain deterministic in tests. */
  now?: Date;
  /** Injectable for fail-closed manifest projection tests. Production uses the validated seed. */
  manifestText?: string;
}

interface NextMove {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
  readonly eligibility: string;
  readonly source: 'live' | 'synthetic';
  readonly global: boolean;
  readonly to: string;
  readonly destinationLabel: string;
  readonly dueAt: string | null;
  readonly dueLabel: string | null;
}

interface GlobalCoverage {
  readonly authorityIncomplete: boolean;
  readonly pluginsIncomplete: boolean;
  readonly schedulesIncomplete: boolean;
  readonly incomplete: boolean;
}

const fullDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const planDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  timeZone: 'UTC',
});

const costFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat('en-US');

type DisplayedMetricSource = HomeMetricSource | 'pending';
type HomePlanView = 'timeline' | 'list';

const sourceLabels: Record<DisplayedMetricSource, string> = {
  live: 'LIVE',
  synthetic: 'SYNTHETIC',
  unavailable: 'UNAVAILABLE',
  awaiting_transfer: 'AWAITING TRANSFER',
  pending: 'PENDING',
};

const workstreamStateLabels: Record<NonNullable<HomeWorkstream['state']>, string> = {
  complete: 'COMPLETE',
  in_work: 'IN WORK',
  planned: 'PLANNED',
  at_risk: 'AT RISK',
};

const roadmapStatusLabels: Record<RoadmapFork['status'], string> = {
  on_track: 'ON TRACK',
  watch: 'WATCH',
  at_risk: 'AT RISK',
  unavailable: 'UNAVAILABLE',
};

function isHomePlanView(value: string | null): value is HomePlanView {
  return value === 'timeline' || value === 'list';
}

function verticalMetricIdFromRollup(metric: HomeMetric): string | null {
  const ownerGroupId = metric.inspection.ownerGroupId;
  if (ownerGroupId === null || metric.id !== `coverage:${ownerGroupId}`) return null;
  return `vertical-coverage:${ownerGroupId}`;
}

function SourceBadge({ source }: { source: DisplayedMetricSource }) {
  return (
    <span className="today-source-badge" data-source={source} data-testid="kpi-source">
      {sourceLabels[source]}
    </span>
  );
}

function SourceUnavailable({ children }: { children: string }) {
  return (
    <p className="today-unavailable" role="status">
      <strong>{children}</strong> No zero or nominal state is inferred.
    </p>
  );
}

function SourcePending({ children }: { children: string }) {
  return (
    <p className="today-loading" role="status">
      <strong>{children}</strong> Global exception coverage is not complete yet.
    </p>
  );
}

function MetricCard({
  metric,
  selected,
  onSelect,
}: {
  metric: HomeMetric;
  selected: boolean;
  onSelect: (metric: HomeMetric) => void;
}) {
  const displayedSource: DisplayedMetricSource =
    metric.state === 'pending'
      ? 'pending'
      : metric.state === 'unavailable'
        ? 'unavailable'
        : metric.source;

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onSelect(metric);
  }

  return (
    <article
      aria-label={`${metric.label}: ${metric.value}, ${sourceLabels[displayedSource]}`}
      className="today-metric"
      data-source={displayedSource}
      data-state={metric.state}
      data-testid={`home-metric-${metric.id}`}
    >
      <header>
        <span>{metric.label}</span>
        <SourceBadge source={displayedSource} />
      </header>
      <div className="today-metric-value">
        <strong>{metric.value}</strong>
        {metric.scopeLabel ? <small>{metric.scopeLabel}</small> : null}
      </div>
      {metric.progressPercent === undefined ? null : (
        <progress
          aria-label={`${metric.label} ${metric.progressPercent} percent`}
          max={100}
          value={metric.progressPercent}
        />
      )}
      <footer>
        <p>{metric.detail}</p>
        <div className="today-metric-footer-meta">
          {metric.statusLabel ? (
            <span className="today-metric-status">{metric.statusLabel}</span>
          ) : null}
          <span aria-hidden="true" className="today-metric-inspect-label">
            {selected ? 'DETAIL OPEN' : 'INSPECT'} →
          </span>
        </div>
      </footer>
      <button
        aria-controls="today-metric-detail"
        aria-expanded={selected}
        aria-label={`Inspect ${metric.label}: ${metric.value}, ${sourceLabels[displayedSource]}`}
        aria-pressed={selected}
        className="today-metric-select"
        onClick={() => onSelect(metric)}
        onKeyDown={selectFromKeyboard}
        type="button"
      />
    </article>
  );
}

function MetricDetailPanel({
  metric,
  program,
  onClose,
}: {
  metric: HomeMetric;
  program: HomeProgramModel;
  onClose: () => void;
}) {
  const ownerGroupId = metric.inspection.ownerGroupId;
  const displayedSource: DisplayedMetricSource =
    metric.state === 'pending'
      ? 'pending'
      : metric.state === 'unavailable'
        ? 'unavailable'
        : metric.source;
  const relatedWorkstreams = ownerGroupId
    ? program.workstreams.filter((item) => item.ownerGroupId === ownerGroupId)
    : [];
  const relatedActions = ownerGroupId
    ? program.actions.filter((item) => item.groupIds.includes(ownerGroupId))
    : [];
  const availableActionCount = relatedActions.filter((item) => item.available).length;
  const unavailableActionCount = relatedActions.length - availableActionCount;

  return (
    <section
      aria-labelledby="today-metric-detail-title"
      className="today-metric-detail"
      data-source={displayedSource}
      id="today-metric-detail"
    >
      <header>
        <div>
          <span>SELECTED METRIC · READ-ONLY TRACE</span>
          <h3 id="today-metric-detail-title">{metric.label}</h3>
          <p>
            {metric.value} · {sourceLabels[displayedSource]}
            {metric.statusLabel ? ` · ${metric.statusLabel}` : ''}
          </p>
        </div>
        <button aria-label={`Close ${metric.label} detail`} onClick={onClose} type="button">
          CLOSE ×
        </button>
      </header>
      <div className="today-metric-detail-grid">
        <section aria-labelledby="today-metric-driver-title">
          <span>01 · WHAT DRIVES IT</span>
          <h4 id="today-metric-driver-title">Declared inputs</h4>
          <p>{metric.inspection.driver}</p>
          {ownerGroupId ? (
            <small>
              {relatedWorkstreams.length} declared{' '}
              {relatedWorkstreams.length === 1 ? 'workstream' : 'workstreams'} contribute program
              context for {verticalLabel(ownerGroupId)}.
            </small>
          ) : (
            <small>This global reading is not allocated to a program vertical.</small>
          )}
        </section>
        <section aria-labelledby="today-metric-objective-title">
          <span>02 · OBJECTIVE BINDING</span>
          <h4 id="today-metric-objective-title">Not declared</h4>
          <p>
            No governed Objective resource or target is bound to this metric. Paul OS shows the
            current reading without inferring OKR progress.
          </p>
          <small>OBJECTIVE MANIFEST · NOT DECLARED IN THE CURRENT MODEL</small>
        </section>
        <section aria-labelledby="today-metric-action-title">
          <span>03 · WHAT TO INSPECT NEXT</span>
          <h4 id="today-metric-action-title">Exact governed context</h4>
          <p>
            {ownerGroupId
              ? `${availableActionCount} available and ${unavailableActionCount} unavailable Home-eligible ${relatedActions.length === 1 ? 'action is' : 'actions are'} declared for this vertical.`
              : 'No vertical action is inferred from this global reading.'}
          </p>
          <Link to={metric.inspection.destinationHref}>
            {metric.inspection.destinationLabel.toUpperCase()} →
          </Link>
        </section>
      </div>
    </section>
  );
}

function RoadmapForkStrip({ roadmaps }: { roadmaps: ReturnType<typeof useRoadmapProgram> }) {
  const forks = roadmaps.data?.forks ?? [];
  const complete = forks.length === 2 && new Set(forks.map(({ id }) => id)).size === 2;

  return (
    <aside
      aria-labelledby="today-roadmap-forks-title"
      className="today-roadmap-strip"
      data-testid="home-roadmap-strip"
    >
      <header>
        <div>
          <span>PROGRAM-WIDE STATE · NOT VERTICAL-SCOPED</span>
          <strong id="today-roadmap-forks-title">Roadmap forks</strong>
        </div>
        <Link to="/roadmaps">COMPARE BOTH →</Link>
      </header>
      {roadmaps.isPending ? (
        <p className="today-loading" role="status">
          <strong>Roadmap fork status is still loading.</strong> No fork status is shown until both
          governed resources resolve.
        </p>
      ) : roadmaps.isError ? (
        <SourceUnavailable>Roadmap fork status unavailable.</SourceUnavailable>
      ) : !complete ? (
        <SourceUnavailable>
          The complete two-fork roadmap projection is unavailable.
        </SourceUnavailable>
      ) : (
        <ul>
          {forks.map((fork) => {
            const query = new URLSearchParams({ fork: fork.id });
            const status = roadmapStatusLabels[fork.status];
            return (
              <li data-status={fork.status} key={fork.id}>
                <Link
                  aria-label={`Open ${fork.label}: ${status}, ${sourceLabels[fork.source]}`}
                  to={`/roadmaps?${query.toString()}`}
                >
                  <span>
                    <strong>{fork.label}</strong>
                    <small>{status}</small>
                  </span>
                  <SourceBadge source={fork.source} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

function BandHeading({
  number,
  title,
  detail,
  id,
  trailing,
}: {
  number: '01' | '02' | '03';
  title: string;
  detail: string;
  id: string;
  trailing?: string;
}) {
  return (
    <header className="today-band-heading">
      <span className="today-band-number" aria-hidden="true">
        {number}
      </span>
      <div>
        <h2 id={id}>{title}</h2>
        <p>{detail}</p>
      </div>
      {trailing ? <small>{trailing}</small> : null}
    </header>
  );
}

function formatPlanDate(value: string): string {
  return planDateFormatter.format(new Date(value));
}

function scheduleTiming(
  nextRunAt: string,
  now: Date,
  timeZone: string,
): { readonly timeLabel: string; readonly dueLabel: string } | null {
  try {
    const next = new Date(nextRunAt);
    const dayFormatter = new Intl.DateTimeFormat('en-US', {
      day: '2-digit',
      month: '2-digit',
      timeZone,
      year: 'numeric',
    });
    if (dayFormatter.format(next) !== dayFormatter.format(now)) return null;
    const timeLabel = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    }).format(next);
    const dueLabel = new Intl.DateTimeFormat('en-US', {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
      timeZone,
      timeZoneName: 'short',
      year: 'numeric',
    }).format(next);
    return { dueLabel, timeLabel };
  } catch {
    return null;
  }
}

function timelinePercent(value: string | Date, startAt: string, endAt: string): number {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  const current = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.min(100, Math.max(0, ((current - start) / (end - start)) * 100));
}

function timelineMonths(startAt: string, endAt: string): string[] {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const values: string[] = [];
  while (cursor.getTime() <= end.getTime() && values.length < 24) {
    const includeYear = values.length === 0 || cursor.getUTCMonth() === 0;
    values.push(
      `${monthFormatter.format(cursor).toUpperCase()}${includeYear ? ` ${String(cursor.getUTCFullYear()).slice(-2)}` : ''}`,
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return values;
}

function workstreamHref(workstream: HomeWorkstream): string {
  const query = new URLSearchParams({ group: workstream.ownerGroupId });
  const partId = workstream.affectedPartIds[0];
  if (partId) query.set('part', partId);
  return `/aim?${query.toString()}`;
}

function actionHref(action: HomeProgramAction, selectedVertical: HomeVerticalId): string {
  const groupId =
    selectedVertical !== 'all' && action.groupIds.includes(selectedVertical)
      ? selectedVertical
      : action.groupIds[0];
  if (!groupId) return '/aim';
  const query = new URLSearchParams({ group: groupId });
  const partId = action.partTargets.find((target) => target.groupId === groupId)?.partId;
  if (partId) query.set('part', partId);
  return `/aim?${query.toString()}`;
}

function Gantt({
  program,
  workstreams,
  now,
  selectedVertical,
}: {
  program: HomeProgramModel;
  workstreams: readonly HomeWorkstream[];
  now: Date;
  selectedVertical: HomeVerticalId;
}) {
  const months = timelineMonths(program.timeline.startAt, program.timeline.endAt);
  const todayPosition = timelinePercent(now, program.timeline.startAt, program.timeline.endAt);
  const showToday =
    now.getTime() >= Date.parse(program.timeline.startAt) &&
    now.getTime() <= Date.parse(program.timeline.endAt);
  const milestoneById = new Map(program.milestones.map((item) => [item.id, item] as const));

  if (workstreams.length === 0) {
    return (
      <p className="today-empty">
        No declared workstreams match {verticalLabel(selectedVertical)}.
      </p>
    );
  }

  return (
    <div
      aria-label={`${verticalLabel(selectedVertical)} manufacturing plan. Scroll horizontally for later months.`}
      className="today-gantt-viewport"
      data-testid="home-gantt-viewport"
      role="region"
      tabIndex={0}
    >
      <div className="today-gantt" style={{ '--month-count': months.length } as CSSProperties}>
        {showToday ? (
          <span className="sr-only">Today marker: {formatPlanDate(now.toISOString())}.</span>
        ) : null}
        <div className="today-gantt-months" aria-hidden="true">
          <span />
          {months.map((month) => (
            <span key={month}>{month}</span>
          ))}
        </div>
        <ol aria-label="AIM manufacturing workstreams" className="today-gantt-rows">
          {workstreams.map((workstream) => {
            const start = timelinePercent(
              workstream.startAt,
              program.timeline.startAt,
              program.timeline.endAt,
            );
            const end = timelinePercent(
              workstream.endAt,
              program.timeline.startAt,
              program.timeline.endAt,
            );
            const milestones = workstream.milestoneIds.flatMap((id) => {
              const milestone = milestoneById.get(id);
              return milestone ? [milestone] : [];
            });
            const stateLabel = workstream.state
              ? workstreamStateLabels[workstream.state]
              : 'SOURCE UNAVAILABLE';
            const destinationLabel =
              workstream.affectedPartIds.length > 1 ? 'RELATED AIM PART' : 'AIM PART';
            const rowLabel = `${workstream.label}, ${workstream.ownerGroupLabel}, ${formatPlanDate(workstream.startAt)} through ${formatPlanDate(workstream.endAt)}, ${stateLabel}, ${workstream.source} plan. Open ${destinationLabel.toLowerCase()}.`;
            const rowContent = (
              <>
                <div className="today-gantt-label">
                  <strong>{workstream.label}</strong>
                  <span>{workstream.ownerGroupLabel}</span>
                  <small>
                    {formatPlanDate(workstream.startAt)} – {formatPlanDate(workstream.endAt)} ·{' '}
                    {stateLabel} · {workstream.source.toUpperCase()}
                    {workstream.available ? ` · OPENS ${destinationLabel}` : ''}
                  </small>
                </div>
                <div className="today-gantt-track">
                  {showToday ? (
                    <span
                      aria-hidden="true"
                      className="today-gantt-now"
                      style={{ left: `${todayPosition}%` }}
                    />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className="today-gantt-bar"
                    data-state={workstream.state ?? 'unavailable'}
                    style={
                      {
                        '--bar-start': `${start}%`,
                        '--bar-width': `${Math.max(1.5, end - start)}%`,
                      } as CSSProperties
                    }
                  >
                    <span>{workstream.available ? stateLabel : 'UNAVAILABLE'}</span>
                  </span>
                  {milestones.map((milestone) => (
                    <span
                      aria-label={`${milestone.label}, ${formatPlanDate(milestone.date)}, ${milestone.state}`}
                      className="today-gantt-milestone"
                      data-state={milestone.state}
                      key={milestone.id}
                      role="img"
                      style={{
                        left: `${timelinePercent(milestone.date, program.timeline.startAt, program.timeline.endAt)}%`,
                      }}
                      title={`${milestone.label} · ${formatPlanDate(milestone.date)} · ${milestone.state}`}
                    />
                  ))}
                </div>
              </>
            );
            return (
              <li
                aria-label={`${workstream.label}, ${workstream.ownerGroupLabel}, ${stateLabel}, ${workstream.source}`}
                data-testid="home-gantt-row"
                key={workstream.id}
              >
                {workstream.available && workstream.state ? (
                  <Link
                    aria-label={rowLabel}
                    className="today-gantt-row-link"
                    data-testid={`home-workstream-${workstream.id}`}
                    to={workstreamHref(workstream)}
                  >
                    {rowContent}
                  </Link>
                ) : (
                  <div
                    aria-label={`${workstream.label} source unavailable. ${workstream.sourceDetail}`}
                    className="today-gantt-row-static"
                    data-testid={`home-workstream-${workstream.id}`}
                    role="status"
                  >
                    {rowContent}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {showToday ? (
          <div aria-hidden="true" className="today-gantt-now-label-track">
            <p className="today-gantt-now-label" style={{ left: `${todayPosition}%` }}>
              TODAY
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WorkstreamList({
  workstreams,
  selectedVertical,
}: {
  workstreams: readonly HomeWorkstream[];
  selectedVertical: HomeVerticalId;
}) {
  if (workstreams.length === 0) {
    return (
      <p className="today-empty">
        No declared workstreams match {verticalLabel(selectedVertical)}.
      </p>
    );
  }

  return (
    <ol
      aria-label={`${verticalLabel(selectedVertical)} manufacturing workstreams as a dated list`}
      className="today-workstream-list"
      data-testid="home-workstream-list"
    >
      {workstreams.map((workstream) => {
        const stateLabel = workstream.state
          ? workstreamStateLabels[workstream.state]
          : 'SOURCE UNAVAILABLE';
        const destinationLabel =
          workstream.affectedPartIds.length > 1 ? 'RELATED AIM PART' : 'AIM PART';
        const content = (
          <>
            <span>
              {workstream.ownerGroupLabel} · {workstream.source.toUpperCase()}
            </span>
            <strong>{workstream.label}</strong>
            <p>
              {formatPlanDate(workstream.startAt)} – {formatPlanDate(workstream.endAt)} ·{' '}
              {stateLabel}
            </p>
            <small>
              {workstream.available
                ? `OPEN ${destinationLabel} →`
                : workstream.sourceDetail.toUpperCase()}
            </small>
          </>
        );
        return (
          <li data-state={workstream.state ?? 'unavailable'} key={workstream.id}>
            {workstream.available && workstream.state ? (
              <Link
                aria-label={`Open ${workstream.label}, ${workstream.ownerGroupLabel}, ${formatPlanDate(workstream.startAt)} through ${formatPlanDate(workstream.endAt)}, ${stateLabel}, ${workstream.source} plan.`}
                data-testid={`home-workstream-${workstream.id}`}
                to={workstreamHref(workstream)}
              >
                {content}
              </Link>
            ) : (
              <div
                aria-label={`${workstream.label} source unavailable. ${workstream.sourceDetail}`}
                data-testid={`home-workstream-${workstream.id}`}
                role="status"
              >
                {content}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function createDigestMetrics(attention: ReturnType<typeof useAttention>): readonly HomeMetric[] {
  const state = attention.isError ? 'unavailable' : attention.data ? 'neutral' : 'pending';
  const stateLabel = attention.isError ? 'UNAVAILABLE' : attention.data ? undefined : 'READING';
  const availableData = attention.isError ? undefined : attention.data;
  const runCount = availableData?.digest.runCount;
  const totalCostUsd = availableData?.digest.totalCostUsd;
  return [
    {
      id: 'digest-runs',
      label: 'Runs since briefing',
      value: runCount === undefined ? '—' : integerFormatter.format(runCount),
      detail:
        runCount === undefined
          ? 'The live briefing ledger is not available yet.'
          : 'Runs recorded in the current briefing ledger window.',
      source: 'live',
      state,
      ...(stateLabel ? { statusLabel: stateLabel } : {}),
      scopeLabel: 'ALL VERTICALS',
      inspection: {
        driver:
          runCount === undefined
            ? 'The current briefing ledger window is not available, so no run count is inferred.'
            : `${integerFormatter.format(runCount)} governed runs are recorded in the current briefing ledger window. The reading changes only when that ledger records another run.`,
        destinationLabel: 'Inspect governed runs',
        destinationHref: '/operate',
        ownerGroupId: null,
      },
    },
    {
      id: 'digest-cost',
      label: 'Recorded cost',
      value: totalCostUsd === undefined ? '—' : costFormatter.format(totalCostUsd),
      detail:
        totalCostUsd === undefined
          ? 'The live briefing ledger is not available yet.'
          : 'Recorded agent cost in the current briefing ledger window.',
      source: 'live',
      state,
      ...(stateLabel ? { statusLabel: stateLabel } : {}),
      scopeLabel: 'ALL VERTICALS',
      inspection: {
        driver:
          totalCostUsd === undefined
            ? 'The current briefing ledger window is not available, so no recorded cost is inferred.'
            : `${costFormatter.format(totalCostUsd)} is recorded by governed runs in the current briefing ledger window. Unrecorded or external spend does not contribute.`,
        destinationLabel: 'Inspect run cost records',
        destinationHref: '/operate',
        ownerGroupId: null,
      },
    },
  ];
}

function buildScheduledMoves(
  schedules: ReturnType<typeof useAutomationSchedules>['data'],
  now: Date,
): NextMove[] {
  const moves: NextMove[] = [];
  const seenScheduleIds = new Set<string>();
  for (const schedule of [...(schedules?.items ?? [])]
    .filter((item) => item.state === 'active')
    .sort((left, right) => Date.parse(left.nextRunAt) - Date.parse(right.nextRunAt))) {
    if (seenScheduleIds.has(schedule.id)) continue;
    seenScheduleIds.add(schedule.id);
    const timing = scheduleTiming(schedule.nextRunAt, now, schedule.timezone);
    if (!timing) continue;
    const subject = schedule.entrySubject;
    moves.push({
      id: `global:schedule:${schedule.id}`,
      label: subject ? `${subject.name} is scheduled today` : 'Automation subject unavailable',
      reason: subject
        ? `${subject.kind.replaceAll('_', ' ')} version ${subject.version} is scheduled for ${timing.timeLabel}.`
        : `The exact schedule subject is unavailable. Its next run is recorded for ${timing.timeLabel}.`,
      eligibility: 'SCHEDULE DUE TODAY',
      source: 'live',
      global: true,
      to: '/operate#operate-schedules',
      destinationLabel: 'OPEN SCHEDULES',
      dueAt: schedule.nextRunAt,
      dueLabel: timing.dueLabel,
    });
  }
  return moves;
}

function ScheduleTodayStatus({
  scheduledMoves,
  coverageIncomplete,
  pausedScheduleCount,
  pausedCoverageIncomplete,
}: {
  scheduledMoves: readonly NextMove[];
  coverageIncomplete: boolean;
  pausedScheduleCount: number;
  pausedCoverageIncomplete: boolean;
}) {
  const pausedCopy =
    pausedScheduleCount === 0
      ? pausedCoverageIncomplete
        ? ' Additional paused schedules may remain in Operate.'
        : ''
      : ` ${pausedCoverageIncomplete ? 'At least ' : ''}${pausedScheduleCount} returned paused ${pausedScheduleCount === 1 ? 'schedule remains' : 'schedules remain'} in Operate.`;
  if (scheduledMoves.length === 0) {
    return (
      <p className="today-schedule-status" data-state={coverageIncomplete ? 'incomplete' : 'quiet'}>
        <strong>
          {coverageIncomplete
            ? 'No returned automation is scheduled today.'
            : 'No active automation is scheduled today.'}
        </strong>{' '}
        {coverageIncomplete
          ? 'The returned schedule set is bounded, so absence cannot be confirmed.'
          : 'The complete active-schedule count contains no work due today.'}
        {pausedCopy}
      </p>
    );
  }

  return (
    <p className="today-schedule-status" data-state="scheduled">
      <strong>
        {coverageIncomplete ? 'At least ' : ''}
        {scheduledMoves.length} scheduled{' '}
        {scheduledMoves.length === 1 ? 'automation is' : 'automations are'} due today.
      </strong>{' '}
      Each matching schedule is counted once in the eligible work below.
      {pausedCopy}
    </p>
  );
}

function buildGlobalMoves(
  grants: ReturnType<typeof useAuthorityGrants>['data'],
  plugins: ReturnType<typeof usePlugins>['data'],
  runs: ReturnType<typeof useExecutionRuns>['data'],
  coverage: GlobalCoverage,
  now: Date,
): NextMove[] {
  const moves: NextMove[] = [];
  const nowMs = now.getTime();
  const sevenDaysFromNow = nowMs + 7 * 24 * 60 * 60 * 1_000;
  const activeGrantsPastExpiry = (grants?.items ?? []).filter(
    (grant) => grant.state === 'active' && Date.parse(grant.validUntil) < nowMs,
  );
  const expiringGrants = (grants?.items ?? []).filter((grant) => {
    const expiry = Date.parse(grant.validUntil);
    return grant.state === 'active' && expiry >= nowMs && expiry <= sevenDaysFromNow;
  });
  const degradedPlugins = (plugins?.items ?? []).filter(
    (plugin) =>
      plugin.installationId !== null &&
      (plugin.installationState === 'degraded' ||
        plugin.healthStatus === 'degraded' ||
        plugin.healthStatus === 'unavailable'),
  );
  const heldRunCount = runs
    ? runs.countsByState.awaiting_approval +
      runs.countsByState.paused_budget +
      runs.countsByState.paused_plugin
    : 0;

  if (activeGrantsPastExpiry.length > 0) {
    moves.push({
      id: 'global:authority-overdue',
      label: 'Review authority past its recorded expiry',
      reason: `${coverage.authorityIncomplete ? 'At least ' : ''}${activeGrantsPastExpiry.length} active ${activeGrantsPastExpiry.length === 1 ? 'grant is' : 'grants are'} past expiry.`,
      eligibility: 'AUTHORITY EXCEPTION',
      source: 'live',
      global: true,
      to: '/operate#operate-authority',
      destinationLabel: 'OPEN AUTHORITY',
      dueAt: null,
      dueLabel: null,
    });
  }
  if (expiringGrants.length > 0) {
    moves.push({
      id: 'global:authority-expiring',
      label: 'Review authority expiring this week',
      reason: `${coverage.authorityIncomplete ? 'At least ' : ''}${expiringGrants.length} active ${expiringGrants.length === 1 ? 'grant expires' : 'grants expire'} within seven days.`,
      eligibility: 'AUTHORITY EXCEPTION',
      source: 'live',
      global: true,
      to: '/operate#operate-authority',
      destinationLabel: 'OPEN AUTHORITY',
      dueAt: null,
      dueLabel: null,
    });
  }
  if (degradedPlugins.length > 0) {
    moves.push({
      id: 'global:connections-degraded',
      label: 'Restore degraded connections',
      reason: `${coverage.pluginsIncomplete ? 'At least ' : ''}${degradedPlugins.length} installed ${degradedPlugins.length === 1 ? 'connection needs' : 'connections need'} review.`,
      eligibility: 'CONNECTION EXCEPTION',
      source: 'live',
      global: true,
      to: '/connections',
      destinationLabel: 'OPEN CONNECTIONS',
      dueAt: null,
      dueLabel: null,
    });
  }
  if (heldRunCount > 0) {
    moves.push({
      id: 'global:runs-held',
      label: 'Clear held governed runs',
      reason: `${heldRunCount} ${heldRunCount === 1 ? 'run is' : 'runs are'} awaiting approval, budget, or a connection.`,
      eligibility: 'RUN EXCEPTION',
      source: 'live',
      global: true,
      to: '/operate',
      destinationLabel: 'OPEN RUNS',
      dueAt: null,
      dueLabel: null,
    });
  }
  return moves;
}

export function HomePage({ now = new Date(), manifestText }: HomePageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const verticalButtonRefs = useRef<Partial<Record<HomeVerticalId, HTMLButtonElement | null>>>({});
  const rawVertical = searchParams.get('vertical');
  const selectedVertical: HomeVerticalId = isHomeVerticalId(rawVertical) ? rawVertical : 'all';
  const rawPlanView = searchParams.get('plan');
  const planView: HomePlanView = isHomePlanView(rawPlanView) ? rawPlanView : 'timeline';
  const attention = useAttention();
  const runs = useExecutionRuns();
  const grants = useAuthorityGrants({ limit: 100 });
  const schedules = useAutomationSchedules();
  const plugins = usePlugins({ includeDisabled: true, limit: 100 });
  const roadmaps = useRoadmapProgram();

  const program = useMemo(
    () => (manifestText === undefined ? homeProgram : loadHomeProgram(manifestText)),
    [manifestText],
  );

  const attentionData = attention.isError ? undefined : attention.data;
  const runData = runs.isError ? undefined : runs.data;
  const grantData = grants.isError ? undefined : grants.data;
  const scheduleData = schedules.isError ? undefined : schedules.data;
  const pluginData = plugins.isError ? undefined : plugins.data;
  const returnedActiveGrantCount = (grantData?.items ?? []).filter(
    ({ state }) => state === 'active',
  ).length;
  const returnedActiveScheduleCount = (scheduleData?.items ?? []).filter(
    ({ state }) => state === 'active',
  ).length;
  const returnedPausedScheduleCount = (scheduleData?.items ?? []).filter(
    ({ state }) => state === 'paused',
  ).length;
  const pausedScheduleCoverageIncomplete =
    scheduleData !== undefined &&
    scheduleData.total - scheduleData.activeTotal > returnedPausedScheduleCount;
  const globalCoverage: GlobalCoverage = {
    authorityIncomplete:
      grantData !== undefined && grantData.activeTotal > returnedActiveGrantCount,
    pluginsIncomplete: pluginData?.items.length === 100,
    schedulesIncomplete:
      scheduleData !== undefined && scheduleData.activeTotal > returnedActiveScheduleCount,
    incomplete:
      grants.isPending ||
      grants.isError ||
      runs.isPending ||
      runs.isError ||
      plugins.isPending ||
      plugins.isError ||
      schedules.isPending ||
      schedules.isError ||
      (grantData !== undefined && grantData.activeTotal > returnedActiveGrantCount) ||
      pluginData?.items.length === 100 ||
      (scheduleData !== undefined && scheduleData.activeTotal > returnedActiveScheduleCount),
  };
  const programMetrics = program.ok ? metricsForVertical(program.model, selectedVertical) : [];
  const metrics =
    selectedVertical === 'all'
      ? [...programMetrics, ...createDigestMetrics(attention)]
      : programMetrics;
  const selectedMetric = metrics.find(({ id }) => id === searchParams.get('metric'));
  const workstreams = program.ok ? workstreamsForVertical(program.model, selectedVertical) : [];
  const selectedProgramActions = program.ok
    ? programActionsForVertical(program.model, selectedVertical)
    : [];
  const unavailableProgramActions = selectedProgramActions.filter((action) => !action.available);
  const programMoves: NextMove[] = selectedProgramActions
    .filter(
      (action): action is HomeProgramAction & { source: 'live' | 'synthetic' } =>
        action.available && action.source !== 'unavailable',
    )
    .map((action) => ({
      id: action.id,
      label: action.label,
      reason: action.reason,
      eligibility:
        action.eligibility === 'milestone_blocker' ? 'MILESTONE BLOCKER' : 'COVERAGE GAP',
      source: action.source,
      global: false,
      to: actionHref(action, selectedVertical),
      destinationLabel:
        action.partIds.length > 1
          ? 'OPEN RELATED AIM PART'
          : action.partIds.length === 1
            ? 'OPEN AIM PART'
            : 'OPEN AIM GROUP',
      dueAt: action.dueAt,
      dueLabel: null,
    }));
  const globalMoves = buildGlobalMoves(grantData, pluginData, runData, globalCoverage, now);
  const scheduledMoves = buildScheduledMoves(scheduleData, now);
  const eligibleMoves = [...globalMoves, ...scheduledMoves, ...programMoves];
  const visibleMoves = eligibleMoves.slice(0, 5);
  const reviewItems = [...(attentionData?.decide ?? []), ...(attentionData?.degraded ?? [])].slice(
    0,
    3,
  );
  const selectedLabel = verticalLabel(selectedVertical);
  const moveCoverageIncomplete = globalCoverage.incomplete || unavailableProgramActions.length > 0;
  const countDisclosure = moveCoverageIncomplete
    ? `${visibleMoves.length} shown · at least ${eligibleMoves.length} eligible · source coverage incomplete`
    : `${visibleMoves.length} shown of ${eligibleMoves.length} eligible`;
  const liveSummary = `${selectedLabel} · ${metrics.length} metrics · ${workstreams.length} workstreams · ${moveCoverageIncomplete ? 'at least ' : ''}${visibleMoves.length} ${visibleMoves.length === 1 ? 'next move' : 'next moves'}${moveCoverageIncomplete ? ' · source coverage incomplete' : ''}`;
  const unavailableWorkstreamCount = workstreams.filter((item) => !item.available).length;
  const availableWorkstreams = workstreams.filter((item) => item.available);
  const planLabel =
    unavailableWorkstreamCount > 0
      ? `${unavailableWorkstreamCount} ${unavailableWorkstreamCount === 1 ? 'SOURCE' : 'SOURCES'} UNAVAILABLE`
      : availableWorkstreams.length === 0
        ? 'PLAN UNAVAILABLE'
        : availableWorkstreams.every((item) => item.source === 'synthetic')
          ? 'SYNTHETIC PLAN'
          : availableWorkstreams.every((item) => item.source === 'declared')
            ? 'DECLARED PLAN'
            : 'MIXED PLAN';

  function selectVertical(verticalId: HomeVerticalId) {
    const next = new URLSearchParams(searchParams);
    next.set('vertical', verticalId);
    next.delete('metric');
    setSearchParams(next);
  }

  function selectMetric(metric: HomeMetric) {
    const next = new URLSearchParams(searchParams);
    const verticalMetricId = selectedVertical === 'all' ? verticalMetricIdFromRollup(metric) : null;
    const ownerGroupId = metric.inspection.ownerGroupId;
    if (verticalMetricId !== null && ownerGroupId !== null) {
      verticalButtonRefs.current[ownerGroupId]?.focus();
      next.set('vertical', ownerGroupId);
      next.set('metric', verticalMetricId);
    } else if (selectedMetric?.id === metric.id) {
      next.delete('metric');
    } else {
      next.set('metric', metric.id);
    }
    setSearchParams(next);
  }

  function selectPlanView(nextView: HomePlanView) {
    const next = new URLSearchParams(searchParams);
    if (nextView === 'timeline') {
      next.delete('plan');
    } else {
      next.set('plan', nextView);
    }
    setSearchParams(next);
  }

  return (
    <main className="today-home">
      <header className="today-heading">
        <div>
          <span className="today-eyebrow">PROGRAM CONTROL · {selectedLabel.toUpperCase()}</span>
          <h1>Today</h1>
          <time dateTime={now.toISOString()}>{fullDateFormatter.format(now)}</time>
        </div>
        <p>{homeCopy.introduction.join(' ')}</p>
      </header>

      <nav aria-label="Program vertical" className="today-vertical-filter">
        <span>VERTICAL</span>
        <ul>
          {HOME_VERTICALS.map((vertical) => (
            <li key={vertical.id}>
              <button
                aria-pressed={selectedVertical === vertical.id}
                data-testid={`home-vertical-${vertical.id}`}
                onClick={() => selectVertical(vertical.id)}
                ref={(element) => {
                  verticalButtonRefs.current[vertical.id] = element;
                }}
                type="button"
              >
                {vertical.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <p aria-atomic="true" aria-live="polite" className="sr-only" data-testid="home-scope-summary">
        {liveSummary}
      </p>

      <section
        aria-labelledby="today-health-title"
        className="today-band"
        data-testid="home-band-health"
      >
        <BandHeading
          detail="Current platform coverage and program outcomes, with provenance on every metric."
          id="today-health-title"
          number="01"
          title="Are we on track"
          trailing={`${metrics.length} METRICS`}
        />
        {program.ok ? null : <SourceUnavailable>{program.message}</SourceUnavailable>}
        <p className="today-source-note">
          {homeCopy.body?.[0]} {homeCopy.body?.[2]} {homeCopy.body?.[3]}
        </p>
        <RoadmapForkStrip roadmaps={roadmaps} />
        <div aria-label={`${selectedLabel} health metrics`} className="today-metric-grid">
          {metrics.map((metric) => (
            <MetricCard
              key={metric.id}
              metric={metric}
              onSelect={selectMetric}
              selected={selectedMetric?.id === metric.id}
            />
          ))}
        </div>
        {program.ok && selectedMetric ? (
          <MetricDetailPanel
            metric={selectedMetric}
            onClose={() => selectMetric(selectedMetric)}
            program={program.model}
          />
        ) : null}
      </section>

      <section
        aria-labelledby="today-plan-title"
        className="today-band"
        data-testid="home-band-plan"
      >
        <BandHeading
          detail="Declared manufacturing workstreams, dates, milestones, and current plan state."
          id="today-plan-title"
          number="02"
          title="AIM manufacturing build"
          trailing={planLabel}
        />
        <div className="today-plan-tools">
          <div aria-label="Manufacturing plan view" className="today-plan-view" role="group">
            <span>VIEW</span>
            <button
              aria-pressed={planView === 'timeline'}
              onClick={() => selectPlanView('timeline')}
              type="button"
            >
              TIMELINE
            </button>
            <button
              aria-pressed={planView === 'list'}
              onClick={() => selectPlanView('list')}
              type="button"
            >
              DATED LIST
            </button>
          </div>
          <div className="today-plan-links">
            {featureFlags.visualSurfacesEnabled ? (
              <Link to="/history">SIX MONTHS AS TERRAIN ↗</Link>
            ) : null}
            <Link to="/roadmaps">COMPARE ROADMAP FORKS ↗</Link>
          </div>
        </div>
        {program.ok ? (
          <>
            {unavailableWorkstreamCount > 0 ? (
              <SourceUnavailable>
                {`${unavailableWorkstreamCount} visible ${unavailableWorkstreamCount === 1 ? 'workstream has' : 'workstreams have'} an unavailable plan source.`}
              </SourceUnavailable>
            ) : null}
            {planView === 'timeline' ? (
              <Gantt
                now={now}
                program={program.model}
                selectedVertical={selectedVertical}
                workstreams={workstreams}
              />
            ) : (
              <WorkstreamList selectedVertical={selectedVertical} workstreams={workstreams} />
            )}
          </>
        ) : (
          <SourceUnavailable>{program.message}</SourceUnavailable>
        )}
      </section>

      <section
        aria-labelledby="today-action-title"
        className="today-band"
        data-testid="home-band-action"
      >
        <BandHeading
          detail="Only milestone blockers, coverage gaps, and global operating exceptions appear here."
          id="today-action-title"
          number="03"
          title="What moves it"
          trailing={countDisclosure.toUpperCase()}
        />
        <div className="today-action-layout">
          <section aria-labelledby="today-next-moves-title" className="today-next-moves">
            <header>
              <div>
                <span>ACTION · TODAY</span>
                <h3 id="today-next-moves-title">Next moves</h3>
              </div>
              <small>{countDisclosure}</small>
            </header>
            {grants.isPending ? (
              <SourcePending>Authority status is still loading.</SourcePending>
            ) : null}
            {grants.isError ? (
              <SourceUnavailable>Authority status unavailable.</SourceUnavailable>
            ) : null}
            {globalCoverage.authorityIncomplete ? (
              <SourceUnavailable>
                Authority coverage is incomplete. Counts from returned grants are at least.
              </SourceUnavailable>
            ) : null}
            {plugins.isPending ? (
              <SourcePending>Connections status is still loading.</SourcePending>
            ) : null}
            {plugins.isError ? (
              <SourceUnavailable>Connections status unavailable.</SourceUnavailable>
            ) : null}
            {globalCoverage.pluginsIncomplete ? (
              <SourceUnavailable>
                Connection coverage is bounded at 100 returned plugins. Counts are at least.
              </SourceUnavailable>
            ) : null}
            {runs.isPending ? (
              <SourcePending>Held-run status is still loading.</SourcePending>
            ) : null}
            {runs.isError ? (
              <SourceUnavailable>Held-run status unavailable.</SourceUnavailable>
            ) : null}
            {schedules.isPending ? (
              <SourcePending>Schedule status is still loading.</SourcePending>
            ) : null}
            {schedules.isError ? (
              <SourceUnavailable>Schedule status unavailable.</SourceUnavailable>
            ) : null}
            {!schedules.isPending && !schedules.isError ? (
              <ScheduleTodayStatus
                coverageIncomplete={globalCoverage.schedulesIncomplete}
                pausedCoverageIncomplete={pausedScheduleCoverageIncomplete}
                pausedScheduleCount={returnedPausedScheduleCount}
                scheduledMoves={scheduledMoves}
              />
            ) : null}
            {globalCoverage.schedulesIncomplete ? (
              <SourceUnavailable>
                Schedule coverage is incomplete. More active schedules exist than were returned.
              </SourceUnavailable>
            ) : null}
            {unavailableProgramActions.length > 0 ? (
              <SourceUnavailable>
                {`${unavailableProgramActions.length} program ${unavailableProgramActions.length === 1 ? 'action has' : 'actions have'} unavailable contributing sources.`}
              </SourceUnavailable>
            ) : null}
            {visibleMoves.length === 0 ? (
              <p className="today-empty">No available item meets the Home eligibility rule.</p>
            ) : (
              <ol
                aria-label="Eligible next moves"
                className="today-task-list"
                data-testid="home-task-list"
              >
                {visibleMoves.map((move) => (
                  <li data-source={move.source} key={move.id}>
                    <Link to={move.to}>
                      <span>
                        {move.global ? 'GLOBAL · ' : ''}
                        {move.eligibility}
                      </span>
                      <strong>{move.label}</strong>
                      <p>{move.reason}</p>
                      <small>
                        {move.dueLabel
                          ? `DUE ${move.dueLabel.toUpperCase()} · `
                          : move.dueAt
                            ? `DUE ${formatPlanDate(move.dueAt).toUpperCase()} · `
                            : ''}
                        {move.source.toUpperCase()} · {move.destinationLabel} →
                      </small>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="today-needs-title" className="today-needs-you">
            <header>
              <div>
                <span>GLOBAL · READ-ONLY PREVIEW</span>
                <h3 id="today-needs-title">Needs you</h3>
              </div>
              {attentionData ? (
                <b aria-label={`${attentionData.decideBadgeCount} decisions`}>
                  {attentionData.decideBadgeCount}
                </b>
              ) : null}
            </header>
            {attention.isPending ? (
              <p className="today-muted">Reading the governed queue…</p>
            ) : null}
            {attention.isError ? (
              <SourceUnavailable>Attention preview unavailable.</SourceUnavailable>
            ) : null}
            {attentionData && reviewItems.length === 0 ? (
              <p className="today-empty">
                No current review items in the available Attention data.
              </p>
            ) : null}
            {reviewItems.length > 0 ? (
              <ol className="today-review-list">
                {reviewItems.map((item) => (
                  <li data-status={item.status} key={item.id}>
                    <span>{item.status.replaceAll('_', ' ').toUpperCase()}</span>
                    <strong>{item.headline}</strong>
                    <p>{item.delta}</p>
                  </li>
                ))}
              </ol>
            ) : null}
            <Link className="primary-button today-attention-link" to="/attention">
              {homeAttentionAction.label} <span aria-hidden="true">→</span>
            </Link>
            <small className="today-action-note">
              {homeAttentionAction.consequence} {homeAttentionAction.undo}
            </small>
          </section>
        </div>
      </section>
    </main>
  );
}
