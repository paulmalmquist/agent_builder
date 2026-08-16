import { useEffect, useMemo, useRef, useState } from 'react';

interface Star {
  x: number;
  y: number;
  radius: number;
  opacity: number;
  phase: number;
  period: number;
  velocityX: number;
  velocityY: number;
}

const STAR_LAYERS = [
  { count: 96, minimumSpeed: 0.35, maximumSpeed: 1.25, minimumRadius: 0.35, maximumRadius: 0.9 },
  { count: 44, minimumSpeed: 1.4, maximumSpeed: 3.8, minimumRadius: 0.65, maximumRadius: 1.35 },
] as const;

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function createStars(): Star[] {
  const random = createSeededRandom(0x52454c51);
  return STAR_LAYERS.flatMap((layer) =>
    Array.from({ length: layer.count }, (): Star => {
      const speed = layer.minimumSpeed + random() * (layer.maximumSpeed - layer.minimumSpeed);
      const angle = -0.28 + random() * 0.16;
      return {
        x: random(),
        y: random(),
        radius: layer.minimumRadius + random() * (layer.maximumRadius - layer.minimumRadius),
        opacity: 0.2 + random() * 0.52,
        phase: random() * Math.PI * 2,
        period: 3 + random() * 6,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
      };
    }),
  );
}

function shouldReduceMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function wrap(value: number, limit: number): number {
  return ((value % limit) + limit) % limit;
}

export function StarfieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stars = useMemo(createStars, []);
  const [reducedMotion, setReducedMotion] = useState(shouldReduceMotion);
  const [canvasUnavailable, setCanvasUnavailable] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    setReducedMotion(query.matches);
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (reducedMotion || canvasUnavailable) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // jsdom intentionally has no Canvas implementation; avoid triggering its noisy stub.
    if (navigator.userAgent.toLowerCase().includes('jsdom')) {
      setCanvasUnavailable(true);
      return;
    }

    let context: CanvasRenderingContext2D | null = null;
    try {
      context = canvas.getContext('2d');
    } catch {
      setCanvasUnavailable(true);
      return;
    }
    if (!context) {
      setCanvasUnavailable(true);
      return;
    }

    let cssWidth = 0;
    let cssHeight = 0;
    let frameId: number | null = null;
    let elapsedSeconds = 0;
    let previousTimestamp: number | null = null;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(bounds.width || window.innerWidth));
      const nextHeight = Math.max(1, Math.round(bounds.height || window.innerHeight));
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      if (
        cssWidth === nextWidth &&
        cssHeight === nextHeight &&
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

    const paint = () => {
      context.clearRect(0, 0, cssWidth, cssHeight);
      for (const star of stars) {
        const x = wrap(star.x * cssWidth + elapsedSeconds * star.velocityX, cssWidth);
        const y = wrap(star.y * cssHeight + elapsedSeconds * star.velocityY, cssHeight);
        const twinkle =
          0.72 + Math.sin((elapsedSeconds / star.period) * Math.PI * 2 + star.phase) * 0.28;
        context.beginPath();
        context.fillStyle = `rgba(226, 229, 239, ${star.opacity * twinkle})`;
        context.arc(x, y, star.radius, 0, Math.PI * 2);
        context.fill();
      }
    };

    const frame = (timestamp: number) => {
      frameId = null;
      if (previousTimestamp !== null) {
        elapsedSeconds += Math.min(0.1, Math.max(0, (timestamp - previousTimestamp) / 1_000));
      }
      previousTimestamp = timestamp;
      paint();
      if (!document.hidden) frameId = window.requestAnimationFrame(frame);
    };

    const start = () => {
      if (frameId !== null || document.hidden) return;
      previousTimestamp = null;
      frameId = window.requestAnimationFrame(frame);
    };

    const stop = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      previousTimestamp = null;
    };

    const handleVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    const handleResize = () => {
      resize();
      paint();
    };

    resize();
    paint();
    start();
    window.addEventListener('resize', handleResize, { passive: true });
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stop();
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [canvasUnavailable, reducedMotion, stars]);

  if (reducedMotion || canvasUnavailable) {
    return <div aria-hidden="true" className="noise" data-starfield-fallback="true" />;
  }

  return (
    <canvas
      aria-hidden="true"
      className="starfield-canvas"
      data-star-count={stars.length}
      ref={canvasRef}
    />
  );
}
