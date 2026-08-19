import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { ExecutionRun } from '@agent-builder/contracts';
import { Link } from 'react-router-dom';
import { useExecutionRuns } from '../../../api/hooks';
import {
  OBSERVATORY_AGENTS,
  OBSERVATORY_GATES,
  OBSERVATORY_OUTCOMES,
  OBSERVATORY_TOOLS,
  OBSERVATORY_TRIGGERS,
  formatObservatoryHour,
  getObservatoryStats,
  type ObservatoryFixture,
  type ObservatoryTopologyNode,
} from './observatory-data';
import { observatoryFixture } from './fixtures';
import { createObservatoryScene, type ObservatorySceneController } from './observatory-scene';
import './observatory.css';

const REPLAY_START_HOUR = 5.2;
const REDUCED_MOTION_HOUR = 23.5;
const LEDGER_PAGE_LIMIT = 50;
const numberFormat = new Intl.NumberFormat('en-US');

type SceneStatus = 'checking' | 'ready' | 'fallback';

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function positionFor(node: ObservatoryTopologyNode): { left: string; top: string } {
  return {
    left: `${50 + ((node.x - 51) / 118) * 100}%`,
    top: `${50 + ((node.y - 26.5) / 62) * 100}%`,
  };
}

function captionAt(fixture: ObservatoryFixture, hour: number) {
  let active: ObservatoryFixture['captions'][number] | undefined;
  for (const caption of fixture.captions) {
    if (hour < caption.hour) break;
    active = caption;
  }
  return active;
}

function utcDay(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function utcHour(value: string): number {
  const date = new Date(value);
  return date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3_600;
}

function LedgerTimingOverlay({
  isError,
  isLoading,
  runs,
  total,
}: {
  isError: boolean;
  isLoading: boolean;
  runs: readonly ExecutionRun[];
  total: number | undefined;
}) {
  if (isLoading) {
    return <p className="observatory-ledger-state">LEDGER TIMING OVERLAY · LOADING</p>;
  }
  if (isError) {
    return (
      <p className="observatory-ledger-state" data-unavailable="true">
        LEDGER TIMING OVERLAY · UNAVAILABLE
      </p>
    );
  }
  const mostRecent = [...runs].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )[0];
  if (mostRecent === undefined) {
    return (
      <p className="observatory-ledger-state">
        LEDGER TIMING OVERLAY · LATEST PAGE · NO RUNS RETURNED
      </p>
    );
  }
  const disclosedTotal = total ?? runs.length;
  const capped = disclosedTotal > runs.length;
  const day = utcDay(mostRecent.createdAt);
  const dayRuns = runs.filter((run) => utcDay(run.createdAt) === day);
  const stateCounts = new Map<ExecutionRun['state'], number>();
  for (const run of dayRuns) stateCounts.set(run.state, (stateCounts.get(run.state) ?? 0) + 1);
  return (
    <div className="observatory-ledger-overlay">
      <p>
        LEDGER TIMING ONLY · LATEST PAGE · SHOWING {runs.length} OF {disclosedTotal} LEDGER{' '}
        {disclosedTotal === 1 ? 'RUN' : 'RUNS'}
        {capped ? ` · CAPPED AT ${LEDGER_PAGE_LIMIT}` : null}
      </p>
      <p className="observatory-ledger-states">
        {day} UTC · {dayRuns.length} {dayRuns.length === 1 ? 'MARKER' : 'MARKERS'} FROM THIS PAGE ·{' '}
        {[...stateCounts.entries()]
          .map(([state, count]) => `${state.replaceAll('_', ' ').toUpperCase()} ${count}`)
          .join(' · ')}
      </p>
      <ol aria-label={`Ledger markers from the latest page on ${day} UTC`}>
        {dayRuns.map((run) => (
          <li
            data-state={run.state}
            key={run.id}
            style={{ left: `${(utcHour(run.createdAt) / 24) * 100}%` }}
            title={`${run.entrySubject?.name ?? 'Execution subject unavailable'} · ${run.state.replaceAll('_', ' ')} · ${formatObservatoryHour(utcHour(run.createdAt))} UTC`}
          >
            <span className="sr-only">
              {run.entrySubject?.name ?? 'Execution subject unavailable'} ·{' '}
              {run.state.replaceAll('_', ' ')} · {formatObservatoryHour(utcHour(run.createdAt))} UTC
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function QueueChart({ fixture }: { fixture: ObservatoryFixture }) {
  const maximum = Math.max(1, fixture.peakQueue);
  const path = fixture.queueCurve
    .filter((sample) => sample.hour <= 24)
    .reduce(
      (value, sample) =>
        `${value} L${((sample.hour / 24) * 680).toFixed(1)},${(168 - (sample.depth / maximum) * 150).toFixed(1)}`,
      'M0,168',
    );

  return (
    <svg
      aria-label="Queue depth in front of your approval over the fixture day"
      className="observatory-flat-chart"
      preserveAspectRatio="none"
      role="img"
      viewBox="0 0 680 170"
    >
      <path d={`${path} L680,168 Z`} />
      <text x="8" y="14">
        QUEUE IN FRONT OF YOUR APPROVAL
      </text>
      <text
        className="observatory-chart-peak"
        textAnchor="end"
        x={(Math.min(24, fixture.peakHour) / 24) * 680 - 4}
        y={168 - (fixture.peakQueue / maximum) * 150 - 6}
      >
        {fixture.peakQueue} at {formatObservatoryHour(fixture.peakHour)}
      </text>
    </svg>
  );
}

function ObservatoryFlatView({ fixture }: { fixture: ObservatoryFixture }) {
  const finalStats = getObservatoryStats(fixture, 24);
  return (
    <section className="observatory-flat" data-testid="observatory-flat-fallback">
      <header>
        <span>COMPLETE FLAT VIEW</span>
        <h2>The same fixture, without WebGL</h2>
        <p>
          WebGL is unavailable here. Exact totals, approval-queue depth, and the narrated day remain
          available below. Drag the time control to inspect another moment.
        </p>
      </header>
      <dl className="observatory-flat-totals">
        <div>
          <dt>RUNS TODAY</dt>
          <dd>{numberFormat.format(fixture.runs.length)}</dd>
        </div>
        <div>
          <dt>SHIPPED</dt>
          <dd>{numberFormat.format(finalStats.shipped)}</dd>
        </div>
        <div>
          <dt>NEEDS YOU</dt>
          <dd>{numberFormat.format(finalStats.needsYou)}</dd>
        </div>
        <div>
          <dt>FAILED</dt>
          <dd>{numberFormat.format(finalStats.failed)}</dd>
        </div>
        <div>
          <dt>WAITING AT MIDNIGHT</dt>
          <dd>{numberFormat.format(fixture.waitingAtMidnight)}</dd>
        </div>
        <div>
          <dt>DEEPEST APPROVAL QUEUE</dt>
          <dd>
            {numberFormat.format(fixture.peakQueue)} · {formatObservatoryHour(fixture.peakHour)}
          </dd>
        </div>
      </dl>
      <QueueChart fixture={fixture} />
      <ol className="observatory-flat-timeline">
        {fixture.captions.map((caption) => (
          <li key={caption.hour}>
            <time>{formatObservatoryHour(caption.hour)}</time>
            <span>{caption.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TopologyLabels({ stats }: { stats: ReturnType<typeof getObservatoryStats> }) {
  return (
    <div aria-hidden="true" className="observatory-labels">
      {OBSERVATORY_TRIGGERS.map((node) => (
        <div
          className="observatory-node-label observatory-node-label--center"
          key={node.name}
          style={positionFor(node)}
        >
          <strong>{node.name}</strong>
          <small>{node.detail}</small>
        </div>
      ))}
      {OBSERVATORY_AGENTS.map((node) => (
        <div
          className="observatory-node-label observatory-node-label--left"
          key={node.id}
          style={positionFor(node)}
        >
          <strong>{node.name}</strong>
          <small>{node.detail}</small>
        </div>
      ))}
      {OBSERVATORY_TOOLS.map((node) => (
        <div
          className="observatory-node-label observatory-node-label--right"
          key={node.name}
          style={positionFor(node)}
        >
          <strong>{node.name}</strong>
        </div>
      ))}
      {OBSERVATORY_GATES.map((node, index) => (
        <div
          className={`observatory-node-label observatory-node-label--center${index === 1 ? ' observatory-node-label--approval' : ''}`}
          key={node.name}
          style={positionFor(node)}
        >
          <strong>{node.name}</strong>
          {index === 1 && stats.waiting > 0 ? (
            <small>{numberFormat.format(stats.waiting)} WAITING</small>
          ) : null}
        </div>
      ))}
      {OBSERVATORY_OUTCOMES.map((node, index) => {
        const count = index === 0 ? stats.shipped : index === 1 ? stats.needsYou : stats.failed;
        return (
          <div
            className="observatory-node-label observatory-node-label--right"
            key={node.name}
            style={positionFor(node)}
          >
            <strong>
              {node.name} <b>{numberFormat.format(count)}</b>
            </strong>
          </div>
        );
      })}
    </div>
  );
}

export function ObservatoryPage() {
  const ledgerRuns = useExecutionRuns({ limit: LEDGER_PAGE_LIMIT });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ObservatorySceneController | null>(null);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const currentHourRef = useRef(reducedMotion ? REDUCED_MOTION_HOUR : REPLAY_START_HOUR);
  const [sceneStatus, setSceneStatus] = useState<SceneStatus>('checking');
  const [currentHour, setCurrentHour] = useState(currentHourRef.current);
  const [playing, setPlaying] = useState(!reducedMotion);
  const stats = getObservatoryStats(observatoryFixture, currentHour);
  const activeCaption = captionAt(observatoryFixture, currentHour);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    if (navigator.userAgent.toLowerCase().includes('jsdom')) {
      setSceneStatus('fallback');
      setPlaying(false);
      return;
    }

    let scene: ObservatorySceneController | null = null;
    let sceneDestroyed = false;
    const destroyScene = () => {
      if (scene === null || sceneDestroyed) return;
      sceneDestroyed = true;
      scene.destroy();
      if (sceneRef.current === scene) sceneRef.current = null;
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      destroyScene();
      setPlaying(false);
      setSceneStatus('fallback');
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    try {
      const initialHour = reducedMotion ? REDUCED_MOTION_HOUR : currentHourRef.current;
      scene = createObservatoryScene(canvas, {
        fixture: observatoryFixture,
        initialHour,
        reducedMotion,
        onFrame: (frame) => {
          currentHourRef.current = frame.hour;
          setCurrentHour(frame.hour);
          setPlaying(frame.playing);
        },
      });
      if (scene === null) {
        setSceneStatus('fallback');
        setPlaying(false);
      } else {
        sceneRef.current = scene;
        setSceneStatus('ready');
        if (reducedMotion) {
          currentHourRef.current = REDUCED_MOTION_HOUR;
          setCurrentHour(REDUCED_MOTION_HOUR);
          setPlaying(false);
        }
      }
    } catch {
      setSceneStatus('fallback');
      setPlaying(false);
    }

    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      destroyScene();
    };
  }, [reducedMotion]);

  function handleTimeChange(event: ChangeEvent<HTMLInputElement>) {
    const nextHour = Number(event.target.value);
    currentHourRef.current = nextHour;
    setCurrentHour(nextHour);
    setPlaying(false);
    sceneRef.current?.setPlaying(false);
    sceneRef.current?.seek(nextHour);
  }

  function togglePlayback() {
    if (sceneStatus !== 'ready' || reducedMotion) return;
    const nextPlaying = !playing;
    if (nextPlaying && currentHourRef.current >= 24) {
      currentHourRef.current = REPLAY_START_HOUR;
      setCurrentHour(REPLAY_START_HOUR);
      sceneRef.current?.seek(REPLAY_START_HOUR);
    }
    setPlaying(nextPlaying);
    sceneRef.current?.setPlaying(nextPlaying);
  }

  return (
    <main className="observatory-page">
      <header className="observatory-header">
        <div>
          <div className="observatory-kicker-row">
            <span>PAUL OS · RUN CURRENT</span>
            <strong>FIXTURE DATA</strong>
          </div>
          <h1>One day through the factory</h1>
          <p>
            Every point is one simulated agent run moving from trigger to agent, tool, gate, and
            outcome. Scrub the day to see where work accumulates before your approval.
          </p>
        </div>
        <Link className="observatory-return-link" to="/operate#operate-runs">
          RETURN TO RUNS <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <section
        aria-label="Simulated run flow through the agent factory"
        className="observatory-stage"
        data-scene-status={sceneStatus}
      >
        {sceneStatus === 'fallback' ? (
          <ObservatoryFlatView fixture={observatoryFixture} />
        ) : (
          <>
            <canvas aria-hidden="true" className="observatory-canvas" ref={canvasRef} />
            <TopologyLabels stats={stats} />
          </>
        )}
        <div className="observatory-agent-list" aria-label="Highlight fixture runs by agent">
          {OBSERVATORY_AGENTS.map((agent, index) => (
            <button
              key={agent.id}
              onBlur={() => sceneRef.current?.setHoveredAgent(null)}
              onFocus={() => sceneRef.current?.setHoveredAgent(index)}
              onPointerEnter={() => sceneRef.current?.setHoveredAgent(index)}
              onPointerLeave={() => sceneRef.current?.setHoveredAgent(null)}
              type="button"
            >
              <span>{agent.tier}</span>
              <strong>{agent.name}</strong>
              <b>{numberFormat.format(observatoryFixture.agentCounts[index] ?? 0)}</b>
            </button>
          ))}
        </div>

        <dl className="observatory-stats">
          <div>
            <dt data-tone="working">WORKING NOW</dt>
            <dd>{numberFormat.format(stats.running)}</dd>
          </div>
          <div data-warning={stats.waiting > 25}>
            <dt data-tone="waiting">WAITING ON YOUR APPROVAL</dt>
            <dd>{numberFormat.format(stats.waiting)}</dd>
          </div>
          <div>
            <dt data-tone="shipped">SHIPPED</dt>
            <dd>{numberFormat.format(stats.shipped)}</dd>
          </div>
          <div>
            <dt data-tone="waiting">NEEDS YOU · DECISIONS</dt>
            <dd>{numberFormat.format(stats.needsYou)}</dd>
          </div>
          <div>
            <dt data-tone="failed">FAILED</dt>
            <dd>{numberFormat.format(stats.failed)}</dd>
          </div>
        </dl>

        <div className="observatory-legend" aria-label="Run state legend">
          <span data-tone="working">WORKING</span>
          <span data-tone="waiting">WAITING ON YOU</span>
          <span data-tone="shipped">SHIPPED</span>
          <span data-tone="failed">FAILED</span>
        </div>

        <p className="observatory-caption" data-visible={activeCaption !== undefined}>
          {activeCaption?.text ?? 'No fixture runs have started yet.'}
        </p>
      </section>

      <div className="observatory-scrubber">
        <button
          disabled={sceneStatus !== 'ready' || reducedMotion}
          onClick={togglePlayback}
          title={
            reducedMotion
              ? 'Playback is disabled by your reduced-motion preference.'
              : sceneStatus !== 'ready'
                ? 'Playback needs WebGL. Drag the time control instead.'
                : undefined
          }
          type="button"
        >
          {playing ? 'PAUSE' : currentHour >= 24 ? 'REPLAY' : 'RESUME'}
        </button>
        <output htmlFor="observatory-time">{formatObservatoryHour(currentHour)}</output>
        <input
          aria-label="Time in the fixture day"
          id="observatory-time"
          max="24"
          min="0"
          onChange={handleTimeChange}
          step="0.005"
          type="range"
          value={currentHour}
        />
        <span>24:00</span>
      </div>

      <LedgerTimingOverlay
        isError={ledgerRuns.isError}
        isLoading={ledgerRuns.isLoading}
        runs={ledgerRuns.isError ? [] : (ledgerRuns.data?.items ?? [])}
        total={ledgerRuns.isError ? undefined : ledgerRuns.data?.total}
      />

      <footer className="observatory-footer">
        <span>
          {numberFormat.format(observatoryFixture.runs.length)} FIXTURE RUNS · ONE POINT EACH ·
          COMPLETE FLAT FALLBACK
        </span>
        <span>GPU PURPOSE · POPULATION SCALE + SCRUBBABLE TIME</span>
      </footer>
    </main>
  );
}
