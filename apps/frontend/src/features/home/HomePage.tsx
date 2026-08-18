import { Link } from 'react-router-dom';
import { consoleCriticalCopy } from '@agent-builder/contracts';
import {
  useAttention,
  useAuthorityGrants,
  useAutomationSchedules,
  useExecutionRuns,
  usePlugins,
} from '../../api/hooks';
import './home.css';

const homeCopy = consoleCriticalCopy.home;
const homeAttentionAction = homeCopy.actions[0];

if (!homeAttentionAction) {
  throw new Error('Governed Today copy must define the Attention handoff.');
}

type TimelineSource = 'attention' | 'run' | 'schedule';

interface TimelineEvent {
  id: string;
  detail: string;
  label: string;
  occurredAt: string;
  source: TimelineSource;
}

interface HomePageProps {
  /** Retained while the capability-map route remains behind its existing feature flag. */
  aimEnabled?: boolean;
  /** Injectable only so the date-driven surface can be tested without changing global clocks. */
  now?: Date;
}

const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const sameDayTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

const datedTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function dayPartFor(date: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function isSameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatEventTime(value: string, now: Date): string {
  const eventDate = new Date(value);
  return isSameLocalDay(eventDate, now)
    ? sameDayTimeFormatter.format(eventDate)
    : datedTimeFormatter.format(eventDate);
}

function readableState(value: string): string {
  return value.replaceAll('_', ' ');
}

function collectTimelineEvents(
  attention: ReturnType<typeof useAttention>['data'],
  runs: ReturnType<typeof useExecutionRuns>['data'],
  schedules: ReturnType<typeof useAutomationSchedules>['data'],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const item of [...(attention?.decide ?? []), ...(attention?.degraded ?? [])]) {
    events.push({
      id: `attention:${item.id}:occurred`,
      detail: `${item.shelf === 'decide' ? 'Decision requested' : 'Degraded work surfaced'} · ${item.reason}`,
      label: item.headline,
      occurredAt: item.occurredAt,
      source: 'attention',
    });
    if (item.payload.expiresAt !== null) {
      events.push({
        id: `attention:${item.id}:expires`,
        detail: 'Attention review window closes',
        label: item.headline,
        occurredAt: item.payload.expiresAt,
        source: 'attention',
      });
    }
  }

  for (const run of runs?.items ?? []) {
    events.push({
      id: `run:${run.id}:created`,
      detail: `${readableState(run.state)} · requested by ${run.requestedBy}`,
      label: 'Agent run requested',
      occurredAt: run.createdAt,
      source: 'run',
    });
    if (run.startedAt !== null && run.startedAt !== run.createdAt) {
      events.push({
        id: `run:${run.id}:started`,
        detail: `${readableState(run.state)} · ${run.message}`,
        label: 'Agent run started',
        occurredAt: run.startedAt,
        source: 'run',
      });
    }
    if (run.finishedAt !== null && run.finishedAt !== run.startedAt) {
      events.push({
        id: `run:${run.id}:finished`,
        detail: `${readableState(run.state)} · ${run.message}`,
        label: 'Agent run finished',
        occurredAt: run.finishedAt,
        source: 'run',
      });
    }
  }

  for (const schedule of schedules?.items ?? []) {
    if (schedule.state !== 'active') continue;
    events.push({
      id: `schedule:${schedule.id}:next`,
      detail: `Scheduled automation · ${schedule.channelKey}`,
      label: schedule.name,
      occurredAt: schedule.nextRunAt,
      source: 'schedule',
    });
  }

  return events.sort((left, right) => {
    const timeDelta = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
    return timeDelta === 0 ? left.id.localeCompare(right.id) : timeDelta;
  });
}

function nearestTimelineWindow(events: TimelineEvent[], now: Date): TimelineEvent[] {
  if (events.length <= 12) return events;
  const nowMs = now.getTime();
  const firstFutureIndex = events.findIndex((event) => Date.parse(event.occurredAt) >= nowMs);
  const splitIndex = firstFutureIndex === -1 ? events.length : firstFutureIndex;
  const start = Math.max(0, Math.min(splitIndex - 5, events.length - 12));
  return events.slice(start, start + 12);
}

function TimelineRow({ event, now }: { event: TimelineEvent; now: Date }) {
  return (
    <li className="today-timeline-row" data-source={event.source} data-testid="timeline-event">
      <time dateTime={event.occurredAt}>{formatEventTime(event.occurredAt, now)}</time>
      <span className="today-timeline-node" aria-hidden="true" />
      <div>
        <strong>{event.label}</strong>
        <p>{event.detail}</p>
      </div>
    </li>
  );
}

function SourceUnavailable({ children }: { children: string }) {
  return (
    <p className="today-unavailable" role="status">
      <strong>{children}</strong> No nominal state is inferred.
    </p>
  );
}

export function HomePage({ aimEnabled = false, now = new Date() }: HomePageProps) {
  const attention = useAttention();
  const runs = useExecutionRuns();
  const grants = useAuthorityGrants();
  const schedules = useAutomationSchedules();
  const plugins = usePlugins({ includeDisabled: true, limit: 100 });

  const attentionData = attention.isError ? undefined : attention.data;
  const runData = runs.isError ? undefined : runs.data;
  const grantData = grants.isError ? undefined : grants.data;
  const scheduleData = schedules.isError ? undefined : schedules.data;
  const pluginData = plugins.isError ? undefined : plugins.data;
  const timelineEvents = collectTimelineEvents(attentionData, runData, scheduleData);
  const visibleTimelineEvents = nearestTimelineWindow(timelineEvents, now);
  const reviewItems = [...(attentionData?.decide ?? []), ...(attentionData?.degraded ?? [])].slice(
    0,
    3,
  );

  const nowMs = now.getTime();
  const sevenDaysFromNow = nowMs + 7 * 24 * 60 * 60 * 1_000;
  const expiringGrants = (grantData?.items ?? []).filter((grant) => {
    const expiry = Date.parse(grant.validUntil);
    return grant.state === 'active' && expiry >= nowMs && expiry <= sevenDaysFromNow;
  });
  const activeGrantsPastExpiry = (grantData?.items ?? []).filter(
    (grant) => grant.state === 'active' && Date.parse(grant.validUntil) < nowMs,
  );
  const degradedPlugins = (pluginData?.items ?? []).filter(
    (plugin) =>
      plugin.installationId !== null &&
      (plugin.installationState === 'degraded' ||
        plugin.healthStatus === 'degraded' ||
        plugin.healthStatus === 'unavailable'),
  );
  const heldRunCount = runData
    ? runData.countsByState.awaiting_approval +
      runData.countsByState.paused_budget +
      runData.countsByState.paused_plugin
    : 0;
  const hasOperatingExceptions =
    expiringGrants.length > 0 ||
    activeGrantsPastExpiry.length > 0 ||
    degradedPlugins.length > 0 ||
    heldRunCount > 0 ||
    grants.isError ||
    plugins.isError ||
    runs.isError;

  return (
    <main className="today-home" data-capability-map={aimEnabled ? 'available' : 'hidden'}>
      <header className="today-heading">
        <div>
          <span className="today-eyebrow">TODAY · {greetingFor(now).toUpperCase()}</span>
          <h1>{fullDateFormatter.format(now)}</h1>
        </div>
        <p>{homeCopy.introduction.join(' ')}</p>
      </header>

      <div className="today-layout">
        <section
          className="today-panel today-timeline-panel"
          aria-labelledby="today-timeline-title"
        >
          <header className="today-panel-heading">
            <div>
              <span>TIME AXIS</span>
              <h2 id="today-timeline-title">Work around now</h2>
            </div>
            {timelineEvents.length > visibleTimelineEvents.length ? (
              <small>
                Nearest {visibleTimelineEvents.length} of {timelineEvents.length} ledger events
              </small>
            ) : null}
          </header>

          <div className="today-source-gaps" aria-label="Timeline source coverage">
            <p>
              <strong>Meetings</strong> Not connected on this machine.
            </p>
            <p>
              <strong>Project deadlines</strong> Not connected on this machine.
            </p>
          </div>
          <p className="sr-only">{homeCopy.body?.[0]}</p>

          {runs.isError ? <SourceUnavailable>Run timeline unavailable.</SourceUnavailable> : null}
          {schedules.isError ? (
            <SourceUnavailable>Schedule timeline unavailable.</SourceUnavailable>
          ) : null}
          {attention.isError ? (
            <SourceUnavailable>Attention timeline unavailable.</SourceUnavailable>
          ) : null}

          <ol className="today-timeline" aria-label="Merged work timeline">
            {visibleTimelineEvents
              .filter((event) => Date.parse(event.occurredAt) < nowMs)
              .map((event) => (
                <TimelineRow event={event} key={event.id} now={now} />
              ))}
            <li className="today-now-marker" data-testid="timeline-now">
              <time dateTime={now.toISOString()}>{sameDayTimeFormatter.format(now)}</time>
              <span aria-hidden="true" />
              <strong>NOW</strong>
            </li>
            {visibleTimelineEvents
              .filter((event) => Date.parse(event.occurredAt) >= nowMs)
              .map((event) => (
                <TimelineRow event={event} key={event.id} now={now} />
              ))}
          </ol>

          {timelineEvents.length === 0 &&
          !runs.isPending &&
          !schedules.isPending &&
          !attention.isPending &&
          !runs.isError &&
          !schedules.isError &&
          !attention.isError ? (
            <p className="today-empty">No events are recorded in the connected ledger sources.</p>
          ) : null}
        </section>

        <div className="today-side-column" data-day-part={dayPartFor(now)}>
          <section className="today-panel today-needs-you" aria-labelledby="today-needs-title">
            <header className="today-panel-heading">
              <div>
                <span>READ-ONLY PREVIEW</span>
                <h2 id="today-needs-title">Needs you</h2>
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
              <SourceUnavailable>Needs You unavailable.</SourceUnavailable>
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
                    <span>
                      {item.shelf === 'degraded' ? <i aria-hidden="true" /> : null}
                      {item.status.replaceAll('_', ' ').toUpperCase()}
                    </span>
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

          <section className="today-panel today-briefing" aria-labelledby="today-briefing-title">
            <header className="today-panel-heading">
              <div>
                <span>BRIEFING WINDOW</span>
                <h2 id="today-briefing-title">Since the last delivered briefing</h2>
              </div>
            </header>
            {attention.isPending ? <p className="today-muted">Reading the digest cursor…</p> : null}
            {attention.isError ? (
              <SourceUnavailable>Briefing digest unavailable.</SourceUnavailable>
            ) : null}
            {attentionData ? (
              <>
                <strong className="today-digest-headline">{attentionData.digest.headline}</strong>
                <p>
                  {attentionData.lastDeliveredBriefingAt
                    ? `Last delivered ${datedTimeFormatter.format(new Date(attentionData.lastDeliveredBriefingAt))}.`
                    : 'No briefing has been delivered yet; the ledger cursor remains the source boundary.'}
                </p>
                <small className="today-contract-note">
                  Briefing history is not exposed by the current read API; this is the active cursor
                  window only.
                </small>
              </>
            ) : null}
          </section>

          <section className="today-panel today-history-gap" aria-labelledby="today-history-title">
            <header className="today-panel-heading">
              <div>
                <span>14-DAY DECISION FLOW</span>
                <h2 id="today-history-title">History contract needed</h2>
              </div>
            </header>
            <p>{homeCopy.body?.[1]}</p>
          </section>
        </div>
      </div>

      {hasOperatingExceptions ? (
        <section className="today-panel today-operating" aria-labelledby="today-operating-title">
          <header className="today-panel-heading">
            <div>
              <span>NONNOMINAL ONLY</span>
              <h2 id="today-operating-title">Operating exceptions</h2>
            </div>
          </header>
          <div className="today-exception-grid">
            {grants.isError ? (
              <SourceUnavailable>Authority status unavailable.</SourceUnavailable>
            ) : null}
            {plugins.isError ? (
              <SourceUnavailable>Connections status unavailable.</SourceUnavailable>
            ) : null}
            {runs.isError ? (
              <SourceUnavailable>Held-run status unavailable.</SourceUnavailable>
            ) : null}
            {activeGrantsPastExpiry.length > 0 ? (
              <p className="today-exception">
                <strong>AUTHORITY · OVERDUE</strong>
                At least {activeGrantsPastExpiry.length} active{' '}
                {activeGrantsPastExpiry.length === 1 ? 'grant has' : 'grants have'} passed the
                recorded expiry time.
              </p>
            ) : null}
            {expiringGrants.length > 0 ? (
              <p className="today-exception">
                <strong>AUTHORITY · EXPIRING</strong>
                At least {expiringGrants.length} active{' '}
                {expiringGrants.length === 1 ? 'grant expires' : 'grants expire'} within seven days.
              </p>
            ) : null}
            {degradedPlugins.length > 0 ? (
              <p className="today-exception">
                <strong>CONNECTIONS · DEGRADED</strong>
                At least {degradedPlugins.length} installed{' '}
                {degradedPlugins.length === 1 ? 'connection needs' : 'connections need'} review.
              </p>
            ) : null}
            {heldRunCount > 0 ? (
              <p className="today-exception">
                <strong>RUNS · HELD</strong>
                {heldRunCount} {heldRunCount === 1 ? 'run is' : 'runs are'} held:{' '}
                {runData?.countsByState.awaiting_approval ?? 0} awaiting approval,{' '}
                {runData?.countsByState.paused_budget ?? 0} budget-paused, and{' '}
                {runData?.countsByState.paused_plugin ?? 0} connection-paused.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
