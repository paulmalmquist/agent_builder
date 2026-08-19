import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { rankedSignals, signalAnomaly, signalWallFixture } from './fixtures';
import { createSignalWallScene, initialSignalWallOrder } from './scene';
import type {
  SignalWallInput,
  SignalWallScene,
  SignalWallSceneOptions,
  SignalWallSceneSnapshot,
  SignalWallSignal,
  SignalWallSignalSnapshot,
  SignalWallSortMode,
  SignalWallStatus,
  SignalWallSummary,
} from './types';
import './signal-wall.css';

type SignalWallSceneFactory = (
  canvas: HTMLCanvasElement,
  options: SignalWallSceneOptions,
) => SignalWallScene | null;

interface SignalWallPageProps {
  /** Injectable so fallback and data-contract tests do not depend on browser WebGL support. */
  input?: SignalWallInput;
  createScene?: SignalWallSceneFactory;
}

function summarize(input: SignalWallInput): SignalWallSummary {
  let needsReview = 0;
  let watch = 0;
  input.signals.forEach((signal) => {
    const anomaly = signalAnomaly(signal);
    if (anomaly > 0.6) needsReview += 1;
    else if (anomaly > 0.45) watch += 1;
  });
  return { needsReview, watch, quiet: input.signals.length - needsReview - watch };
}

function statusFromAnomaly(anomaly: number): SignalWallStatus {
  if (anomaly > 0.6) return 'needs-review';
  if (anomaly > 0.45) return 'watch';
  return 'quiet';
}

function useReducedMotionPreference(): boolean {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = (event: MediaQueryListEvent | MediaQueryList) => {
      setReducedMotion(event.matches);
    };
    updatePreference(query);
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', updatePreference);
      return () => query.removeEventListener('change', updatePreference);
    }
    query.addListener(updatePreference);
    return () => query.removeListener(updatePreference);
  }, []);

  return reducedMotion;
}

function FlatSignalWall({ input }: { readonly input: SignalWallInput }) {
  const topSignals = rankedSignals(input).slice(0, 15);
  return (
    <section
      className="signal-wall-flat"
      aria-labelledby="signal-wall-flat-heading"
      data-testid="signal-wall-flat"
      tabIndex={0}
    >
      <p className="signal-wall-eyebrow">PAUL OS · SIGNAL WALL · FLAT VIEW</p>
      <h1 id="signal-wall-flat-heading">What needs a look in this fixture replay</h1>
      <p>
        WebGL is unavailable here. This flat view preserves the same triage: the 15 signals furthest
        from their usual range.
      </p>
      <ol className="signal-wall-flat-list">
        {topSignals.map((signal) => (
          <li key={signal.id}>
            <span className="signal-wall-flat-group">{signal.group}</span>
            <span>{signal.label}</span>
            <strong>{signal.currentLabel}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`signal-wall-stat signal-wall-stat--${tone}`}>
      <span aria-hidden="true" />
      {label} <strong>{value}</strong>
    </div>
  );
}

function replayPositionLabel(input: SignalWallInput, snapshot: SignalWallSceneSnapshot | null) {
  if (!snapshot || snapshot.isLatest)
    return `SAMPLE ${input.sampleCount} / ${input.sampleCount} · NOW`;
  const hoursBeforeCurrent = Math.max(0, input.historyHours - snapshot.elapsedHours);
  return `SAMPLE ${snapshot.sampleIndex + 1} / ${snapshot.sampleCount} · ${hoursBeforeCurrent.toFixed(1)} H BEFORE CURRENT`;
}

function fallbackSignalState(signal: SignalWallSignal): SignalWallSignalSnapshot {
  const anomaly = signalAnomaly(signal);
  return {
    signalId: signal.id,
    anomaly,
    deviation: signal.history.at(-1) ?? 0,
    valueLabel: signal.currentLabel,
    detail: signal.reason ?? `Usual range: ${signal.usualLabel}`,
    status: statusFromAnomaly(anomaly),
  };
}

function AccessibleSignalIndex({
  input,
  snapshot,
}: {
  readonly input: SignalWallInput;
  readonly snapshot: SignalWallSceneSnapshot | null;
}) {
  const snapshotById = useMemo(
    () => new Map(snapshot?.signals.map((signal) => [signal.signalId, signal] as const)),
    [snapshot?.signals],
  );
  const inputById = useMemo(
    () => new Map(input.signals.map((signal) => [signal.id, signal] as const)),
    [input],
  );
  const orderedSignals = useMemo(
    () =>
      (snapshot?.orderedSignalIds ?? input.signals.map((signal) => signal.id))
        .map((id) => inputById.get(id))
        .filter((signal) => signal !== undefined),
    [input, inputById, snapshot?.orderedSignalIds],
  );
  return (
    <section className="sr-only" aria-labelledby="signal-wall-index-heading">
      <h2 id="signal-wall-index-heading">All signal wall signals</h2>
      <p>{replayPositionLabel(input, snapshot)}</p>
      <ol>
        {orderedSignals.map((signal) => {
          const state = snapshotById.get(signal.id) ?? fallbackSignalState(signal);
          return (
            <li key={signal.id}>
              {signal.group}: {signal.label}. {state?.valueLabel ?? 'Value unavailable'}.{' '}
              {state?.status ?? 'quiet'}. {state?.detail ?? `Usual range: ${signal.usualLabel}`}.
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function SignalWallPage({
  input = signalWallFixture,
  createScene = createSignalWallScene,
}: SignalWallPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SignalWallScene | null>(null);
  const reducedMotion = useReducedMotionPreference();
  const initialReplay = !reducedMotion;
  const modeRef = useRef<SignalWallSortMode>('attention');
  const replayingRef = useRef(initialReplay);
  const [mode, setMode] = useState<SignalWallSortMode>('attention');
  const [replaying, setReplaying] = useState(initialReplay);
  const [fallback, setFallback] = useState(false);
  const [snapshot, setSnapshot] = useState<SignalWallSceneSnapshot | null>(null);
  const [topSignalIds, setTopSignalIds] = useState<readonly string[]>(() =>
    initialSignalWallOrder(input).slice(0, 3),
  );
  const signalById = useMemo(
    () => new Map(input.signals.map((signal) => [signal.id, signal] as const)),
    [input],
  );
  const displayedTopSignalIds = snapshot?.topSignalIds ?? topSignalIds;
  const topSignals = displayedTopSignalIds.flatMap((id) => {
    const signal = signalById.get(id);
    return signal ? [signal] : [];
  });
  const snapshotStateById = useMemo(
    () => new Map(snapshot?.signals.map((signal) => [signal.signalId, signal] as const)),
    [snapshot],
  );
  const summary = snapshot?.summary ?? summarize(input);

  useEffect(() => {
    if (!reducedMotion) return;
    replayingRef.current = false;
    setReplaying(false);
    sceneRef.current?.setReplaying(false);
  }, [reducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let scene: SignalWallScene | null = null;
    setFallback(false);
    setSnapshot(null);
    try {
      scene = createScene(canvas, {
        input,
        mode: modeRef.current,
        replaying: replayingRef.current,
        reducedMotion,
        onUnavailable: () => {
          sceneRef.current?.destroy();
          sceneRef.current = null;
          setFallback(true);
        },
        onRankingChange: setTopSignalIds,
        onSnapshot: setSnapshot,
      });
    } catch {
      setFallback(true);
      return;
    }
    sceneRef.current = scene;
    if (!scene) setFallback(true);
    return () => {
      scene?.destroy();
      sceneRef.current = null;
    };
  }, [createScene, input, reducedMotion]);

  function selectMode(nextMode: SignalWallSortMode) {
    modeRef.current = nextMode;
    setMode(nextMode);
    sceneRef.current?.setMode(nextMode);
  }

  function toggleReplay() {
    if (reducedMotion) return;
    const nextReplaying = !replayingRef.current;
    replayingRef.current = nextReplaying;
    setReplaying(nextReplaying);
    sceneRef.current?.setReplaying(nextReplaying);
  }

  return (
    <main className="signal-wall" data-testid="signal-wall">
      <canvas ref={canvasRef} className="signal-wall-canvas" aria-hidden="true" hidden={fallback} />
      <div className="signal-wall-hud">
        <header className="signal-wall-header">
          <div>
            <div className="signal-wall-kicker-row">
              <p className="signal-wall-eyebrow">
                PAUL OS · SIGNAL WALL · {input.signals.length} SIGNALS · ONE STRIP EACH
              </p>
              {input.isFixture ? <span className="signal-wall-source">FIXTURE DATA</span> : null}
            </div>
            <h1>The wall triages itself</h1>
            <p>
              Every strip is one signal. Amber folds are worse than usual; purple folds are calmer.
              The largest deviations rise to the top.
            </p>
          </div>
          <Link to="/operate" className="signal-wall-return">
            Return to Operate
          </Link>
        </header>

        <div className="signal-wall-controls" aria-label="Signal wall controls">
          <button
            type="button"
            aria-pressed={mode === 'attention'}
            onClick={() => selectMode('attention')}
          >
            SORT · ATTENTION
          </button>
          <button
            type="button"
            aria-pressed={mode === 'grouped'}
            onClick={() => selectMode('grouped')}
          >
            SORT · GROUPED
          </button>
          <button
            type="button"
            aria-pressed={replaying}
            disabled={reducedMotion}
            onClick={toggleReplay}
          >
            {reducedMotion ? 'MOTION OFF' : replaying ? 'REPLAYING' : 'PAUSED'}
          </button>
        </div>

        <output
          className="signal-wall-replay-position"
          aria-label="Replay position"
          data-sample-index={snapshot?.sampleIndex ?? input.sampleCount - 1}
        >
          {replayPositionLabel(input, snapshot)}
        </output>

        {!fallback && snapshot ? (
          <div className="signal-wall-overlays" aria-hidden="true">
            {snapshot.visibleRows.map((row) => {
              const signal = signalById.get(row.signalId);
              const state = snapshotStateById.get(row.signalId);
              if (!signal || !state) return null;
              return (
                <span
                  key={row.signalId}
                  className={`signal-wall-row-name signal-wall-row-name--${state.status}${row.representative ? ' signal-wall-row-name--representative' : ''}`}
                  data-signal-id={row.signalId}
                  style={{ top: `${row.top + row.height / 2}px` }}
                >
                  {signal.label}
                  <small>{signal.group}</small>
                </span>
              );
            })}

            {mode === 'attention'
              ? topSignals.map((signal) => {
                  const row = snapshot.visibleRows.find(
                    (visibleRow) => visibleRow.signalId === signal.id,
                  );
                  const state = snapshotStateById.get(signal.id);
                  if (!row || !state) return null;
                  return (
                    <span
                      key={signal.id}
                      className="signal-wall-row-value"
                      style={{ top: `${row.top + row.height / 2}px` }}
                    >
                      {state.valueLabel}
                      <small>{state.detail}</small>
                    </span>
                  );
                })
              : snapshot.groups.map((group) => (
                  <span
                    key={group.group}
                    className="signal-wall-group-heading"
                    data-signal-group={group.group}
                    style={{ top: `${group.top + group.height / 2}px` }}
                  >
                    {group.group} · {group.signalCount}
                  </span>
                ))}
          </div>
        ) : null}

        <div className="signal-wall-summary" aria-label="Signal summary">
          <SummaryPill label="needs a look" value={summary.needsReview} tone="warning" />
          <SummaryPill label="watch" value={summary.watch} tone="watch" />
          <SummaryPill label="quiet" value={summary.quiet} tone="quiet" />
        </div>

        <div className="signal-wall-legend" aria-label="Signal wall legend">
          <span>
            <i className="signal-wall-legend-amber" />
            worse than usual
          </span>
          <span>
            <i className="signal-wall-legend-purple" />
            calmer than usual
          </span>
          <span>fold depth = distance from normal · {input.historyHours} hours per strip</span>
        </div>

        <p className="signal-wall-footnote">
          GPU VIEW · {input.signals.length} STRIPS × {input.sampleCount} SAMPLES · DPR CAPPED AT 2 ·
          PAUSES WHEN HIDDEN · COMPLETE FLAT FALLBACK
        </p>
      </div>
      {fallback ? <FlatSignalWall input={input} /> : null}
      <AccessibleSignalIndex input={input} snapshot={snapshot} />
    </main>
  );
}
