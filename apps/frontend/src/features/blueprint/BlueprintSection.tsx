import { useEffect, useMemo, useRef, useState } from 'react';
import type { AgentSpec, GenerationJob } from '@agent-builder/contracts';
import {
  completionKeyForStation,
  layoutBlueprint,
  type BlueprintConnector,
  type BlueprintLayout,
  type BlueprintRect,
} from './blueprint-layout';

const CONNECTOR_ANIMATION_FALLBACK_MS = 600;
const READY_FLASH_FALLBACK_MS = 900;

const EMPTY_COMPLETION = {
  outcomes: false,
  knowledge: false,
  guardrails: false,
  outputs: false,
} as const;

interface BlueprintAnimation {
  startedAt: number;
  connectorIds: ReadonlySet<string>;
  readyFlash: boolean;
  duration: number;
}

export interface BlueprintSectionProps {
  spec: AgentSpec | null | undefined;
  job?: GenerationJob | null | undefined;
  shadowDeployed?: boolean | undefined;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function cssDurationMilliseconds(property: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(property).trim();
  const match = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(raw);
  const valueText = match?.[1];
  const unit = match?.[2];
  if (!valueText || (unit !== 'ms' && unit !== 's')) return fallback;
  const value = Number(valueText);
  return unit === 's' ? value * 1_000 : value;
}

function specForDrawing(
  spec: AgentSpec | null | undefined,
  jobState: GenerationJob['state'] | null | undefined,
): AgentSpec | null | undefined {
  if (!spec) return spec;
  const status =
    jobState === 'queued' || jobState === 'running'
      ? 'generating'
      : jobState === 'succeeded'
        ? 'generated'
        : spec.status;
  return status === spec.status ? spec : { ...spec, status };
}

function strokeRect(context: CanvasRenderingContext2D, rect: BlueprintRect): void {
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
}

function drawRegistrationMark(
  context: CanvasRenderingContext2D,
  point: { x: number; y: number },
): void {
  const arm = 10;
  context.beginPath();
  context.moveTo(point.x - arm, point.y);
  context.lineTo(point.x + arm, point.y);
  context.moveTo(point.x, point.y - arm);
  context.lineTo(point.x, point.y + arm);
  context.stroke();
  context.beginPath();
  context.arc(point.x, point.y, 3, 0, Math.PI * 2);
  context.stroke();
}

function drawConnector(
  context: CanvasRenderingContext2D,
  connector: BlueprintConnector,
  progress: number,
): void {
  const dx = connector.to.x - connector.from.x;
  const dy = connector.to.y - connector.from.y;

  context.save();
  context.lineWidth = 1;
  context.setLineDash([4, 6]);
  context.strokeStyle = 'rgba(218, 221, 230, 0.2)';
  context.beginPath();
  context.moveTo(connector.from.x, connector.from.y);
  context.lineTo(connector.to.x, connector.to.y);
  context.stroke();

  if (connector.complete && progress > 0) {
    context.setLineDash([7, 5]);
    context.lineDashOffset = -12 * progress;
    context.strokeStyle = 'rgba(149, 120, 255, 0.9)';
    context.shadowBlur = 8;
    context.shadowColor = 'rgba(149, 120, 255, 0.35)';
    context.beginPath();
    context.moveTo(connector.from.x, connector.from.y);
    context.lineTo(connector.from.x + dx * progress, connector.from.y + dy * progress);
    context.stroke();
  }
  context.restore();
}

function drawStations(context: CanvasRenderingContext2D, layout: BlueprintLayout): void {
  const narrow = layout.width < 720;
  for (const station of layout.stations) {
    const { rect } = station;
    context.save();
    context.fillStyle = 'rgba(5, 7, 10, 0.86)';
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.lineWidth = station.complete ? 1.35 : 1;
    context.strokeStyle = station.complete
      ? 'rgba(149, 120, 255, 0.9)'
      : 'rgba(218, 221, 230, 0.3)';
    context.setLineDash(station.complete ? [] : [6, 5]);
    strokeRect(context, rect);
    context.setLineDash([]);

    const padding = narrow ? 7 : 12;
    context.fillStyle = station.complete ? '#b7a6ff' : 'rgba(218, 221, 230, 0.58)';
    context.font = `600 ${narrow ? 8 : 11}px "Arial Narrow", Arial, sans-serif`;
    context.textBaseline = 'top';
    context.fillText(
      `0${station.index + 1} / ${station.label}`,
      rect.x + padding,
      rect.y + padding,
    );

    context.strokeStyle = station.complete
      ? 'rgba(149, 120, 255, 0.45)'
      : 'rgba(218, 221, 230, 0.16)';
    context.beginPath();
    context.moveTo(rect.x + padding, rect.y + 32);
    context.lineTo(rect.x + rect.width - padding, rect.y + 32);
    context.stroke();

    context.font = `500 ${narrow ? 7 : 10}px ui-monospace, SFMono-Regular, Consolas, monospace`;
    context.fillStyle = station.complete
      ? 'rgba(248, 249, 252, 0.84)'
      : 'rgba(218, 221, 230, 0.48)';
    const lineHeight = narrow ? 15 : 20;
    station.lines.forEach((line, index) => {
      context.fillText(line.toUpperCase(), rect.x + padding, rect.y + 50 + index * lineHeight);
    });

    if (station.complete) {
      context.fillStyle = '#9578ff';
      context.beginPath();
      context.arc(rect.x + rect.width - padding, rect.y + rect.height - padding, 3, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  }
}

function drawTitleBlock(context: CanvasRenderingContext2D, layout: BlueprintLayout): void {
  const block = layout.titleBlock;
  const { rect } = block;
  const compact = rect.width < 300;
  const padding = compact ? 7 : 10;
  const splitX = rect.x + rect.width * 0.58;
  const middleY = rect.y + rect.height * 0.5;

  context.save();
  context.fillStyle = 'rgba(5, 7, 10, 0.94)';
  context.fillRect(rect.x, rect.y, rect.width, rect.height);
  context.strokeStyle = 'rgba(218, 221, 230, 0.58)';
  context.lineWidth = 1;
  strokeRect(context, rect);
  context.beginPath();
  context.moveTo(splitX, rect.y);
  context.lineTo(splitX, rect.y + rect.height);
  context.moveTo(splitX, middleY);
  context.lineTo(rect.x + rect.width, middleY);
  context.stroke();

  context.textBaseline = 'top';
  context.fillStyle = 'rgba(218, 221, 230, 0.5)';
  context.font = `500 ${compact ? 7 : 8}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.fillText('AGENT / PURPOSE', rect.x + padding, rect.y + padding);
  context.fillStyle = '#f8f9fc';
  context.font = `600 ${compact ? 9 : 12}px "Arial Narrow", Arial, sans-serif`;
  context.fillText(block.title.toUpperCase(), rect.x + padding, rect.y + padding + 16);

  context.fillStyle = 'rgba(218, 221, 230, 0.58)';
  context.font = `500 ${compact ? 7 : 9}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.fillText(
    block.department.toUpperCase(),
    rect.x + padding,
    rect.y + rect.height - padding - 22,
  );
  context.fillText(
    block.audience.toUpperCase(),
    rect.x + padding,
    rect.y + rect.height - padding - 10,
  );

  context.fillStyle = 'rgba(218, 221, 230, 0.5)';
  context.font = `500 ${compact ? 7 : 8}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.fillText('REV / DATE', splitX + padding, rect.y + padding);
  context.fillStyle = '#f8f9fc';
  context.font = `600 ${compact ? 8 : 10}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.fillText(`${block.revision} / ${block.date}`, splitX + padding, rect.y + padding + 15);
  context.fillStyle = 'rgba(218, 221, 230, 0.5)';
  context.font = `500 ${compact ? 7 : 8}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.fillText('STATUS', splitX + padding, middleY + padding);
  context.fillStyle = '#b7a6ff';
  context.font = `600 ${compact ? 8 : 10}px ui-monospace, SFMono-Regular, Consolas, monospace`;
  context.fillText(block.status, splitX + padding, middleY + padding + 15);
  context.restore();
}

function paintBlueprint(
  context: CanvasRenderingContext2D,
  layout: BlueprintLayout,
  connectorProgress: ReadonlyMap<string, number>,
  readyFlashProgress: number | null,
): void {
  context.clearRect(0, 0, layout.width, layout.height);
  context.fillStyle = '#05070a';
  context.fillRect(0, 0, layout.width, layout.height);

  context.save();
  context.strokeStyle = 'rgba(218, 221, 230, 0.045)';
  context.lineWidth = 1;
  for (let x = layout.frame.x; x <= layout.frame.x + layout.frame.width; x += layout.gridSize) {
    context.beginPath();
    context.moveTo(x, layout.frame.y);
    context.lineTo(x, layout.frame.y + layout.frame.height);
    context.stroke();
  }
  for (let y = layout.frame.y; y <= layout.frame.y + layout.frame.height; y += layout.gridSize) {
    context.beginPath();
    context.moveTo(layout.frame.x, y);
    context.lineTo(layout.frame.x + layout.frame.width, y);
    context.stroke();
  }
  context.restore();

  context.save();
  context.strokeStyle = 'rgba(218, 221, 230, 0.42)';
  context.lineWidth = 1;
  strokeRect(context, layout.frame);
  layout.registrationMarks.forEach((mark) => drawRegistrationMark(context, mark));
  context.restore();

  context.save();
  context.fillStyle = 'rgba(218, 221, 230, 0.5)';
  context.font = '500 9px ui-monospace, SFMono-Regular, Consolas, monospace';
  context.textBaseline = 'top';
  context.fillText('AGENT SYSTEM / FUNCTIONAL SCHEMATIC', layout.frame.x + 14, layout.frame.y + 14);
  context.fillText('NOT TO SCALE', layout.frame.x + 14, layout.frame.y + 30);
  context.restore();

  layout.connectors.forEach((connector) => {
    drawConnector(context, connector, connectorProgress.get(connector.id) ?? 0);
  });
  drawStations(context, layout);
  drawTitleBlock(context, layout);

  context.save();
  if (layout.watermark.ready) {
    const flash = readyFlashProgress === null ? 0 : Math.sin(readyFlashProgress * Math.PI);
    const stampWidth = Math.min(330, layout.frame.width * 0.54);
    const stampX = layout.frame.x + Math.max(18, layout.frame.width * 0.07);
    const stampY = layout.titleBlock.rect.y + 18;
    context.strokeStyle = `rgba(149, 120, 255, ${0.7 + flash * 0.3})`;
    context.fillStyle = `rgba(149, 120, 255, ${0.72 + flash * 0.28})`;
    context.shadowColor = `rgba(149, 120, 255, ${flash * 0.5})`;
    context.shadowBlur = flash * 18;
    context.lineWidth = 1.5;
    context.strokeRect(stampX, stampY, stampWidth, 42);
    context.font = `600 ${layout.width < 720 ? 10 : 15}px "Arial Narrow", Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(layout.watermark.text, stampX + stampWidth / 2, stampY + 21);
  } else {
    context.translate(
      layout.frame.x + layout.frame.width / 2,
      layout.frame.y + layout.frame.height / 2,
    );
    context.rotate(-0.34);
    context.fillStyle = 'rgba(218, 221, 230, 0.065)';
    context.font = `600 ${Math.min(92, layout.width * 0.1)}px "Arial Narrow", Arial, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(layout.watermark.text, 0, 0);
  }
  context.restore();
}

export function BlueprintSection({
  spec,
  job = null,
  shadowDeployed = false,
}: BlueprintSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const canvasShellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const specRef = useRef(spec);
  const animationRef = useRef<BlueprintAnimation | null>(null);
  const requestPaintRef = useRef<(() => void) | null>(null);
  const startAnimationRef = useRef<
    ((connectorIds: ReadonlySet<string>, readyFlash: boolean) => void) | null
  >(null);
  const previousCompletionRef = useRef(spec?.completion ?? EMPTY_COMPLETION);
  const hasObservedSpecRef = useRef(false);
  const [sectionInView, setSectionInView] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const drawingSpec = useMemo(() => specForDrawing(spec, job?.state), [job?.state, spec]);
  specRef.current = drawingSpec;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(query.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (reducedMotion) animationRef.current = null;
    const canvas = canvasRef.current;
    const shell = canvasShellRef.current;
    const section = sectionRef.current;
    if (!canvas || !shell || !section) return;
    // jsdom intentionally has no Canvas implementation and emits an error before returning null.
    if (navigator.userAgent.toLowerCase().includes('jsdom')) return;
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext('2d');
    } catch {
      return;
    }
    if (!context) return;

    const connectorAnimationMs = cssDurationMilliseconds(
      '--dur-connector',
      CONNECTOR_ANIMATION_FALLBACK_MS,
    );
    const readyFlashMs = cssDurationMilliseconds('--dur-ready-flash', READY_FLASH_FALLBACK_MS);

    let cssWidth = 0;
    let cssHeight = 0;
    let frameId: number | null = null;
    let sectionVisible = typeof IntersectionObserver === 'undefined';
    let documentVisible = !document.hidden;

    const resizeCanvas = () => {
      const bounds = shell.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(bounds.width || canvas.clientWidth || 1200));
      const nextHeight = Math.max(1, Math.round(bounds.height || canvas.clientHeight || 640));
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      if (
        nextWidth === cssWidth &&
        nextHeight === cssHeight &&
        canvas.width === Math.round(nextWidth * ratio) &&
        canvas.height === Math.round(nextHeight * ratio)
      ) {
        return;
      }
      cssWidth = nextWidth;
      cssHeight = nextHeight;
      canvas.width = Math.round(cssWidth * ratio);
      canvas.height = Math.round(cssHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const paint = (timestamp: number) => {
      resizeCanvas();
      const layout = layoutBlueprint(specRef.current, cssWidth, cssHeight);
      const animation = animationRef.current;
      const connectorProgress = new Map<string, number>();
      let readyFlashProgress: number | null = null;

      for (const connector of layout.connectors) {
        if (!connector.complete) {
          connectorProgress.set(connector.id, 0);
        } else if (animation?.connectorIds.has(connector.id)) {
          connectorProgress.set(
            connector.id,
            clampProgress((timestamp - animation.startedAt) / connectorAnimationMs),
          );
        } else {
          connectorProgress.set(connector.id, 1);
        }
      }

      if (animation?.readyFlash) {
        readyFlashProgress = clampProgress((timestamp - animation.startedAt) / readyFlashMs);
      }

      paintBlueprint(context, layout, connectorProgress, readyFlashProgress);
    };

    const cancelFrame = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
    };

    const frame = (timestamp: number) => {
      frameId = null;
      paint(timestamp);
      const animation = animationRef.current;
      if (!animation) return;
      if (timestamp - animation.startedAt >= animation.duration) {
        animationRef.current = null;
        paint(timestamp);
        return;
      }
      if (sectionVisible && documentVisible) frameId = window.requestAnimationFrame(frame);
    };

    const requestPaint = () => paint(performance.now());
    requestPaintRef.current = requestPaint;
    startAnimationRef.current = (connectorIds, readyFlash) => {
      if (reducedMotion || (!connectorIds.size && !readyFlash)) {
        animationRef.current = null;
        requestPaint();
        return;
      }
      animationRef.current = {
        startedAt: performance.now(),
        connectorIds,
        readyFlash,
        duration: readyFlash ? readyFlashMs : connectorAnimationMs,
      };
      cancelFrame();
      if (sectionVisible && documentVisible) frameId = window.requestAnimationFrame(frame);
      else requestPaint();
    };

    const handleVisibility = () => {
      documentVisible = !document.hidden;
      if (!documentVisible) {
        cancelFrame();
      } else if (sectionVisible && animationRef.current) {
        frameId = window.requestAnimationFrame(frame);
      } else if (sectionVisible) {
        requestPaint();
      }
    };

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            resizeCanvas();
            requestPaint();
          });
    resizeObserver?.observe(shell);

    const handleWindowResize = () => {
      resizeCanvas();
      requestPaint();
    };
    if (!resizeObserver) window.addEventListener('resize', handleWindowResize, { passive: true });

    const intersectionObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              sectionVisible = entry?.isIntersecting ?? false;
              setSectionInView(sectionVisible);
              if (!sectionVisible) {
                cancelFrame();
              } else if (animationRef.current && documentVisible) {
                frameId = window.requestAnimationFrame(frame);
              } else {
                requestPaint();
              }
            },
            { threshold: 0.08 },
          );
    intersectionObserver?.observe(section);
    if (!intersectionObserver) setSectionInView(false);

    document.addEventListener('visibilitychange', handleVisibility);
    resizeCanvas();
    requestPaint();

    return () => {
      cancelFrame();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener('resize', handleWindowResize);
      document.removeEventListener('visibilitychange', handleVisibility);
      requestPaintRef.current = null;
      startAnimationRef.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    const current = spec?.completion ?? EMPTY_COMPLETION;
    const previous = previousCompletionRef.current;
    previousCompletionRef.current = current;

    if (!hasObservedSpecRef.current) {
      hasObservedSpecRef.current = true;
      requestPaintRef.current?.();
      return;
    }

    const currentLayout = layoutBlueprint(drawingSpec, 1200, 640);
    const newlyCompleted = new Set(
      currentLayout.connectors
        .filter((connector) => {
          const key = completionKeyForStation(connector.completedBy);
          return current[key] && !previous[key];
        })
        .map((connector) => connector.id),
    );
    const wasReady =
      previous.outcomes && previous.knowledge && previous.guardrails && previous.outputs;
    const isReady = current.outcomes && current.knowledge && current.guardrails && current.outputs;

    if (newlyCompleted.size || (isReady && !wasReady)) {
      startAnimationRef.current?.(newlyCompleted, isReady && !wasReady);
    } else {
      requestPaintRef.current?.();
    }
  }, [drawingSpec, spec]);

  const showScrollCue = Boolean(spec?.completion.outcomes) && !sectionInView;
  const liveStatus = shadowDeployed
    ? 'SHADOW'
    : job?.state === 'queued' || job?.state === 'running'
      ? 'GENERATING'
      : (spec?.status.toUpperCase() ?? 'DRAFT');

  return (
    <section
      className="blueprint-section"
      data-blueprint-status={liveStatus.toLowerCase()}
      data-shadow-deployed={shadowDeployed ? 'true' : 'false'}
      id="blueprint"
      ref={sectionRef}
    >
      {showScrollCue ? (
        <button
          aria-controls="blueprint"
          className="blueprint-scroll-cue"
          onClick={() =>
            sectionRef.current?.scrollIntoView({
              behavior: reducedMotion ? 'auto' : 'smooth',
              block: 'start',
            })
          }
          type="button"
        >
          VIEW BLUEPRINT <span aria-hidden="true">↓</span>
        </button>
      ) : null}

      <header className="blueprint-header">
        <p className="blueprint-kicker">AGENT SPECIFICATION — LIVE BLUEPRINT</p>
        <div className="blueprint-heading-row">
          <h2 className="blueprint-title">System definition</h2>
          <span aria-label={`Blueprint status: ${liveStatus}`} className="blueprint-status">
            {liveStatus}
          </span>
        </div>
      </header>

      <div className="blueprint-canvas-shell" ref={canvasShellRef}>
        <canvas
          aria-label="Engineering blueprint of the agent scope, knowledge, workflow, and success criteria"
          className="blueprint-canvas"
          ref={canvasRef}
          role="img"
        />
      </div>
    </section>
  );
}
