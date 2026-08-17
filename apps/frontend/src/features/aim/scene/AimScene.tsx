import { useEffect, useRef, useState } from 'react';
import { Aim2DFallback } from './Aim2DFallback';
import { AimPartIndex } from './AimPartIndex';
import type { AimSceneModel, AimVehicleRenderer, AimVehicleRendererFactory } from './scene-types';

export type AimVehicleRendererLoader = () => Promise<AimVehicleRendererFactory>;

const loadThreeRenderer: AimVehicleRendererLoader = async () => {
  const { createThreeAimVehicleRenderer } = await import('./three-vehicle-renderer');
  return createThreeAimVehicleRenderer;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

interface AimSceneProps {
  model: AimSceneModel;
  onSelectPart: (partId: string) => void;
  rendererLoader?: AimVehicleRendererLoader;
}

export function AimScene({
  model,
  onSelectPart,
  rendererLoader = loadThreeRenderer,
}: AimSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AimVehicleRenderer | null>(null);
  const modelRef = useRef(model);
  const reducedMotionRef = useRef(prefersReducedMotion());
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [renderMode, setRenderMode] = useState<'loading' | 'webgl' | 'webgl_unavailable'>(
    'loading',
  );
  modelRef.current = model;
  reducedMotionRef.current = reducedMotion;

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(query.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setRenderMode('loading');
      return;
    }
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      rendererRef.current?.resize(
        Math.max(1, Math.round(bounds.width)),
        Math.max(1, Math.round(bounds.height)),
      );
    };

    const handleContextLost = (event: Event) => {
      event.preventDefault();
      rendererRef.current?.dispose();
      rendererRef.current = null;
      setRenderMode('webgl_unavailable');
    };

    canvas.addEventListener('webglcontextlost', handleContextLost);
    void rendererLoader()
      .then((createRenderer) => {
        if (cancelled) return;
        const renderer = createRenderer(canvas, modelRef.current, {
          reducedMotion: reducedMotionRef.current,
        });
        rendererRef.current = renderer;
        setRenderMode('webgl');
        resize();
        if (typeof ResizeObserver === 'function') {
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(container);
        } else {
          window.addEventListener('resize', resize, { passive: true });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.warn('AIM WebGL renderer unavailable; using the 2D program view.', error);
        setRenderMode('webgl_unavailable');
      });

    return () => {
      cancelled = true;
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [reducedMotion, rendererLoader]);

  useEffect(() => {
    rendererRef.current?.setModel(model, { reducedMotion });
  }, [model, reducedMotion]);

  const fallbackReason = reducedMotion
    ? 'reduced_motion'
    : renderMode === 'webgl_unavailable'
      ? 'webgl_unavailable'
      : 'loading';

  return (
    <section className="aim-scene" aria-label="AIM conceptual program vehicle">
      <div className="aim-scene-viewport" ref={containerRef}>
        <canvas
          aria-hidden="true"
          className="aim-scene-canvas"
          data-render-mode={renderMode}
          hidden={renderMode !== 'webgl' || reducedMotion}
          onClick={(event) => {
            const partId = rendererRef.current?.pick(event.clientX, event.clientY);
            if (partId) onSelectPart(partId);
          }}
          ref={canvasRef}
        />
        {renderMode === 'webgl' && !reducedMotion ? (
          <div className="aim-scene-status" role="status">
            <span aria-hidden="true" />
            WEBGL · LOCAL CONCEPTUAL PROXY
          </div>
        ) : (
          <Aim2DFallback model={model} onSelectPart={onSelectPart} reason={fallbackReason} />
        )}
      </div>
      {renderMode === 'webgl' && !reducedMotion ? (
        <AimPartIndex model={model} onSelectPart={onSelectPart} />
      ) : null}
    </section>
  );
}
