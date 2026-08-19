import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { historyTerrainFixture } from './history-terrain-fixture';
import {
  captionAt,
  formatHistoryWeek,
  validateHistoryTerrainInput,
  type HistoryTerrainModel,
} from './history-terrain-model';
import {
  createHistoryTerrainScene,
  type HistoryTerrainSceneController,
  type HistoryTerrainSceneFactory,
} from './history-terrain-scene';
import type {
  HistoryTerrainInput,
  HistoryTerrainPoint,
  HistoryTerrainProjectedLabel,
  HistoryTerrainStream,
} from './history-terrain-types';
import './history-terrain.css';

const REPLAY_DURATION_MILLISECONDS = 8_000;

interface HistoryTerrainProps {
  readonly data?: HistoryTerrainInput;
  readonly autoPlay?: boolean;
  /** Test seam for lifecycle verification; production uses the raw WebGL scene. */
  readonly sceneFactory?: HistoryTerrainSceneFactory;
}

type TerrainRenderMode = 'pending' | 'webgl' | 'flat';

function readsReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function isJsdom(): boolean {
  return (
    typeof navigator !== 'undefined' && navigator.userAgent.toLocaleLowerCase().includes('jsdom')
  );
}

function areaPath(
  values: readonly number[],
  width: number,
  height: number,
  maximum: number,
): string {
  const baseline = height - 4;
  const points = values.map((value, index) => {
    const x = (index / Math.max(1, values.length - 1)) * width;
    const y = baseline - (value / maximum) * (height - 12);
    return `L${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `M0,${baseline} ${points.join(' ')} L${width},${baseline} Z`;
}

function linePath(
  values: readonly number[],
  width: number,
  height: number,
  maximum: number,
): string {
  const baseline = height - 4;
  return values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = baseline - (value / maximum) * (height - 12);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function pointSummary(model: HistoryTerrainModel, stream: HistoryTerrainStream, weekIndex: number) {
  const typical = Math.max(0.04, model.medians.get(stream.id) ?? 0);
  const actualRatio = (stream.actual[weekIndex] ?? 0) / typical;
  const planRatio = (stream.plan[weekIndex] ?? 0) / typical;
  return {
    actualRatio,
    planRatio,
    jam: (stream.reviewJam[weekIndex] ?? 0) > 0,
    starved: actualRatio < 0.35,
  };
}

function TerrainLegend() {
  return (
    <ul aria-label="Terrain legend" className="history-terrain-legend">
      <li data-mark="actual">What happened · terrain height</li>
      <li data-mark="plan">What the plan said · dashed hairline</li>
      <li data-mark="jam">Review-queue jam · amber surface</li>
      <li data-mark="slip">Slipped milestone · red beacon</li>
    </ul>
  );
}

function TerrainStatistics({ model }: { model: HistoryTerrainModel }) {
  const { statistics } = model;
  return (
    <dl aria-label="Six-month history summary" className="history-terrain-statistics">
      <div>
        <dt>Busiest week</dt>
        <dd>
          {formatHistoryWeek(model.input, statistics.busiestWeek.weekIndex)} ·{' '}
          {statistics.busiestWeek.streamLabel}
        </dd>
      </div>
      <div>
        <dt>Longest starvation</dt>
        <dd>
          {statistics.longestStarvation.streamLabel} · {statistics.longestStarvation.weeks} weeks
        </dd>
      </div>
      <div>
        <dt>Weeks above plan</dt>
        <dd>
          {statistics.weeksAbovePlan} of {model.weekCount}
        </dd>
      </div>
    </dl>
  );
}

function TerrainHeader({ model }: { model: HistoryTerrainModel }) {
  return (
    <header className="history-terrain-header">
      <div>
        <p className="history-terrain-kicker">
          PAUL OS · SIX MONTHS · {model.input.streams.length} STREAMS × {model.weekCount} WEEKS
        </p>
        <h1>{model.input.title}</h1>
        <p>{model.input.description}</p>
        <p>
          This view replays weekly work so starvation, review jams, and plan misses become one
          landscape.
        </p>
      </div>
      <span className="history-terrain-provenance" data-provenance={model.input.provenance.kind}>
        {model.input.provenance.label}
      </span>
    </header>
  );
}

function TerrainFlatView({ model, weekIndex }: { model: HistoryTerrainModel; weekIndex: number }) {
  const width = 700;
  const height = 58;
  const cursorX = (weekIndex / Math.max(1, model.weekCount - 1)) * width;
  return (
    <section aria-labelledby="history-flat-title" className="history-terrain-flat">
      <div>
        <p className="history-terrain-kicker">COMPLETE FLAT VIEW · SAME WEEKLY INPUT</p>
        <h2 id="history-flat-title">Six months as accessible ridgelines</h2>
        <p>
          WebGL is unavailable. Every workstream, plan line, review jam, and slipped milestone
          remains below.
        </p>
      </div>
      <div className="history-terrain-flat-rows">
        {[...model.input.streams].reverse().map((stream) => {
          const summary = pointSummary(model, stream, weekIndex);
          const scaleMaximum = Math.max(1, ...stream.actual, ...stream.plan);
          const streamIndex = model.input.streams.findIndex((item) => item.id === stream.id);
          const beacons = model.input.beacons.filter(
            (beacon) => beacon.streamId === stream.id && beacon.weekIndex <= weekIndex,
          );
          return (
            <article data-stream-id={stream.id} key={stream.id}>
              <header>
                <h3>{stream.label}</h3>
                <span>{stream.category}</span>
              </header>
              <div className="history-terrain-flat-chart">
                <svg
                  aria-hidden="true"
                  preserveAspectRatio="none"
                  viewBox={`0 0 ${width} ${height}`}
                >
                  {stream.reviewJam.map((jam, index) =>
                    jam > 0 ? (
                      <rect
                        className="history-terrain-flat-jam"
                        height={height}
                        key={`${stream.id}:jam:${index}`}
                        opacity={jam}
                        width={width / Math.max(1, model.weekCount - 1)}
                        x={((index - 0.5) / Math.max(1, model.weekCount - 1)) * width}
                        y={0}
                      />
                    ) : null,
                  )}
                  <path
                    className="history-terrain-flat-actual"
                    d={areaPath(stream.actual, width, height, scaleMaximum)}
                  />
                  <path
                    className="history-terrain-flat-plan"
                    d={linePath(stream.plan, width, height, scaleMaximum)}
                  />
                  <rect
                    className="history-terrain-flat-future"
                    height={height}
                    width={Math.max(0, width - cursorX)}
                    x={cursorX}
                    y={0}
                  />
                  <line
                    className="history-terrain-flat-cursor"
                    x1={cursorX}
                    x2={cursorX}
                    y1={0}
                    y2={height}
                  />
                  {beacons.map((beacon) => {
                    const x = (beacon.weekIndex / Math.max(1, model.weekCount - 1)) * width;
                    return (
                      <line
                        className="history-terrain-flat-beacon"
                        key={beacon.id}
                        x1={x}
                        x2={x}
                        y1={4}
                        y2={height - 4}
                      />
                    );
                  })}
                </svg>
              </div>
              <p>
                Week of {formatHistoryWeek(model.input, weekIndex)}: work landed at{' '}
                {summary.actualRatio.toFixed(1)}× a typical week; plan expected{' '}
                {summary.planRatio.toFixed(1)}×.
                {summary.jam ? ' Review-queue pressure is recorded.' : ''}
                {summary.starved ? ' This week is below the starvation threshold.' : ''}
              </p>
              {beacons.length > 0 ? (
                <ul>
                  {beacons.map((beacon) => (
                    <li key={beacon.id}>Slipped milestone: {beacon.label}.</li>
                  ))}
                </ul>
              ) : null}
              <span className="sr-only">
                Row {streamIndex + 1} of {model.input.streams.length}.
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function HistoryTerrain({
  data = historyTerrainFixture,
  autoPlay = true,
  sceneFactory = createHistoryTerrainScene,
}: HistoryTerrainProps) {
  const validation = useMemo(() => validateHistoryTerrainInput(data), [data]);
  const model = validation.ok ? validation.model : null;
  const maximumCursor = Math.max(0, (model?.weekCount ?? 1) - 0.5);
  const defaultSceneFactory = sceneFactory === createHistoryTerrainScene;
  const startsFlat = defaultSceneFactory && isJsdom();
  const [reducedMotion, setReducedMotion] = useState(readsReducedMotion);
  const initialCursor = reducedMotion || startsFlat ? maximumCursor : 0;
  const [renderMode, setRenderMode] = useState<TerrainRenderMode>(startsFlat ? 'flat' : 'pending');
  const [fallbackReason, setFallbackReason] = useState(
    startsFlat ? 'WebGL is unavailable in this environment.' : '',
  );
  const [currentWeekIndex, setCurrentWeekIndex] = useState(Math.floor(initialCursor));
  const [playing, setPlaying] = useState(false);
  const [pageVisible, setPageVisible] = useState(
    () => typeof document !== 'undefined' && !document.hidden,
  );
  const [hoveredPoint, setHoveredPoint] = useState<HistoryTerrainPoint | null>(null);
  const [projectedLabels, setProjectedLabels] = useState<readonly HistoryTerrainProjectedLabel[]>(
    [],
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rangeRef = useRef<HTMLInputElement>(null);
  const sceneRef = useRef<HistoryTerrainSceneController | null>(null);
  const cursorRef = useRef(initialCursor);

  const applyCursor = useCallback(
    (nextCursor: number) => {
      const clamped = Math.max(0, Math.min(maximumCursor, nextCursor));
      cursorRef.current = clamped;
      if (rangeRef.current) rangeRef.current.value = String(clamped);
      setCurrentWeekIndex(Math.min(Math.floor(clamped), Math.max(0, (model?.weekCount ?? 1) - 1)));
      sceneRef.current?.setCursor(clamped);
    },
    [maximumCursor, model?.weekCount],
  );

  const activateFallback = useCallback(
    (reason: string) => {
      sceneRef.current?.destroy();
      sceneRef.current = null;
      setFallbackReason(reason);
      setRenderMode('flat');
      setPlaying(false);
      applyCursor(maximumCursor);
    },
    [applyCursor, maximumCursor],
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
      if (event.matches) {
        setPlaying(false);
        applyCursor(maximumCursor);
      }
    };
    setReducedMotion(query.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, [applyCursor, maximumCursor]);

  useEffect(() => {
    const handleVisibility = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  useEffect(() => {
    if (!model || startsFlat) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const sceneCursor = reducedMotion ? maximumCursor : 0;
    try {
      const scene = sceneFactory({
        canvas,
        model,
        initialCursor: sceneCursor,
        onHover: setHoveredPoint,
        onProjectedLabels: setProjectedLabels,
        onUnavailable: activateFallback,
      });
      if (scene === null) {
        activateFallback('WebGL is unavailable. The complete flat history is shown instead.');
        return;
      }
      sceneRef.current = scene;
      cursorRef.current = sceneCursor;
      if (rangeRef.current) rangeRef.current.value = String(sceneCursor);
      setCurrentWeekIndex(Math.floor(sceneCursor));
      setRenderMode('webgl');
      setFallbackReason('');
      setPlaying(autoPlay && !reducedMotion);
      scene.requestRender();
      return () => {
        if (sceneRef.current === scene) sceneRef.current = null;
        scene.destroy();
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'WebGL initialization failed.';
      activateFallback(`${detail} The complete flat history is shown instead.`);
    }
  }, [activateFallback, autoPlay, maximumCursor, model, reducedMotion, sceneFactory, startsFlat]);

  useEffect(() => {
    if (!playing || reducedMotion || !pageVisible) return;
    let frameId: number | null = null;
    let previousTimestamp: number | null = null;
    const weeksPerMillisecond = maximumCursor / REPLAY_DURATION_MILLISECONDS;
    const frame = (timestamp: number) => {
      if (previousTimestamp === null) previousTimestamp = timestamp;
      const elapsed = Math.min(100, Math.max(0, timestamp - previousTimestamp));
      previousTimestamp = timestamp;
      const next = cursorRef.current + elapsed * weeksPerMillisecond;
      if (next >= maximumCursor) {
        applyCursor(maximumCursor);
        setPlaying(false);
        return;
      }
      applyCursor(next);
      frameId = window.requestAnimationFrame(frame);
    };
    frameId = window.requestAnimationFrame(frame);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [applyCursor, maximumCursor, pageVisible, playing, reducedMotion]);

  if (!validation.ok) {
    return (
      <main className="history-terrain-error" role="alert">
        <h1>History terrain cannot render this input safely.</h1>
        <p>No chart or nominal state is shown.</p>
        <ul>
          {validation.issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      </main>
    );
  }

  const renderedModel = validation.model;
  const selectedCaption = captionAt(renderedModel.input.captions, currentWeekIndex);
  const hoveredStream = hoveredPoint
    ? renderedModel.input.streams.find((stream) => stream.id === hoveredPoint.streamId)
    : null;
  const hoveredSummary =
    hoveredPoint && hoveredStream
      ? pointSummary(renderedModel, hoveredStream, hoveredPoint.weekIndex)
      : null;
  const hoveredBeacon = hoveredPoint
    ? renderedModel.input.beacons.find(
        (beacon) =>
          beacon.streamId === hoveredPoint.streamId && beacon.weekIndex === hoveredPoint.weekIndex,
      )
    : null;

  function handleScrub(event: React.FormEvent<HTMLInputElement>) {
    setPlaying(false);
    applyCursor(Number(event.currentTarget.value));
  }

  function toggleReplay() {
    if (reducedMotion) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    applyCursor(0);
    setPlaying(true);
  }

  return (
    <main className="history-terrain" data-renderer={renderMode}>
      <TerrainHeader model={renderedModel} />
      <TerrainStatistics model={renderedModel} />
      <TerrainLegend />

      {renderMode === 'flat' ? (
        <div className="history-terrain-fallback">
          <p className="history-terrain-fallback-reason" role="status">
            {fallbackReason}
          </p>
          <TerrainFlatView model={renderedModel} weekIndex={currentWeekIndex} />
        </div>
      ) : (
        <div className="history-terrain-stage">
          <canvas aria-hidden="true" ref={canvasRef} />
          {projectedLabels.map((label) => {
            const stream = renderedModel.input.streams.find((item) => item.id === label.streamId);
            if (!stream || !label.visible) return null;
            return (
              <span
                className="history-terrain-row-label"
                data-highlighted={hoveredPoint?.streamId === stream.id}
                key={stream.id}
                style={{ left: label.x, top: label.y }}
              >
                {stream.label}
                <small>{stream.category}</small>
              </span>
            );
          })}
          {hoveredPoint && hoveredStream && hoveredSummary ? (
            <aside
              className="history-terrain-tooltip"
              style={{ left: hoveredPoint.x + 16, top: Math.max(12, hoveredPoint.y - 14) }}
            >
              <span>
                WEEK OF {formatHistoryWeek(renderedModel.input, hoveredPoint.weekIndex)} ·{' '}
                {hoveredStream.label.toUpperCase()}
              </span>
              <strong>{hoveredSummary.actualRatio.toFixed(1)}× a typical week</strong>
              <p>Plan expected {hoveredSummary.planRatio.toFixed(1)}×.</p>
              {hoveredSummary.jam ? <b>Review approvals were the recorded constraint.</b> : null}
              {hoveredSummary.starved ? <b>Work landed below the starvation threshold.</b> : null}
              {hoveredBeacon ? <em>Slipped milestone: {hoveredBeacon.label}.</em> : null}
            </aside>
          ) : null}
          <div className="sr-only">
            {renderedModel.input.streams.map((stream) => (
              <p key={stream.id}>
                {stream.label}. {stream.actual.length} actual weekly values and {stream.plan.length}{' '}
                planned weekly values.
              </p>
            ))}
            {renderedModel.input.beacons.map((beacon) => (
              <p key={beacon.id}>Slipped milestone: {beacon.label}.</p>
            ))}
          </div>
        </div>
      )}

      {selectedCaption ? (
        <p aria-live="polite" className="history-terrain-caption">
          <strong>{selectedCaption.lead}</strong> {selectedCaption.detail}
        </p>
      ) : null}

      <div className="history-terrain-scrubber">
        <button disabled={reducedMotion} onClick={toggleReplay} type="button">
          {reducedMotion
            ? 'FINAL STATE · REDUCED MOTION'
            : playing
              ? 'STOP REPLAY'
              : 'REPLAY SIX MONTHS'}
        </button>
        <span>{formatHistoryWeek(renderedModel.input, 0)}</span>
        <input
          aria-label="History week"
          aria-valuetext={`Week of ${formatHistoryWeek(renderedModel.input, currentWeekIndex)}`}
          defaultValue={initialCursor}
          max={maximumCursor}
          min={0}
          onInput={handleScrub}
          ref={rangeRef}
          step={0.01}
          type="range"
        />
        <output>{formatHistoryWeek(renderedModel.input, currentWeekIndex)}</output>
      </div>
      <footer className="history-terrain-footer">
        RAW WEBGL · NO NETWORK · DPR ≤ 2 · RENDER ON DEMAND · COMPLETE FLAT FALLBACK
      </footer>
    </main>
  );
}

export function HistoryTerrainRoute() {
  return <HistoryTerrain />;
}
