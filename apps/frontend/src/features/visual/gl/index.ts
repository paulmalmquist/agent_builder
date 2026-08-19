export type VisualWebGLContext = WebGLRenderingContext | WebGL2RenderingContext;

export const MAX_VISUAL_DPR = 2;

export interface VisualViewport {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly dpr: number;
}

export interface VisualLoopOptions {
  readonly canvas: HTMLCanvasElement;
  readonly render: (timestamp: number, viewport: VisualViewport) => void;
  readonly onResize?: ((viewport: VisualViewport) => void) | undefined;
  readonly initiallyAnimating?: boolean | undefined;
}

export interface VisualLoopController {
  readonly viewport: VisualViewport;
  requestRender(): void;
  setAnimating(animating: boolean): void;
  resize(): void;
  destroy(): void;
}

const defaultContextAttributes: WebGLContextAttributes = {
  alpha: false,
  antialias: true,
  depth: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
};

export function createWebGLContext(
  canvas: HTMLCanvasElement,
  attributes: WebGLContextAttributes = defaultContextAttributes,
): VisualWebGLContext | null {
  try {
    return canvas.getContext('webgl2', attributes) ?? canvas.getContext('webgl', attributes);
  } catch {
    return null;
  }
}

function compileShader(
  gl: VisualWebGLContext,
  type: number,
  source: string,
  label: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error(`${label}: WebGL could not allocate a shader.`);

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;

  const detail = gl.getShaderInfoLog(shader)?.trim() || 'No compiler detail was returned.';
  gl.deleteShader(shader);
  throw new Error(`${label}: shader compilation failed. ${detail}`);
}

export function createProgram(
  gl: VisualWebGLContext,
  vertexSource: string,
  fragmentSource: string,
  label = 'Visual surface',
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label} vertex`);
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;

  try {
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label} fragment`);
    program = gl.createProgram();
    if (program === null) throw new Error(`${label}: WebGL could not allocate a program.`);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const detail = gl.getProgramInfoLog(program)?.trim() || 'No linker detail was returned.';
      throw new Error(`${label}: program linking failed. ${detail}`);
    }

    return program;
  } catch (error) {
    if (program !== null) gl.deleteProgram(program);
    throw error;
  } finally {
    gl.deleteShader(vertexShader);
    if (fragmentShader !== null) gl.deleteShader(fragmentShader);
  }
}

function measureViewport(canvas: HTMLCanvasElement): VisualViewport {
  const bounds = canvas.getBoundingClientRect();
  const cssWidth = Math.max(1, Math.round(bounds.width || canvas.clientWidth || window.innerWidth));
  const cssHeight = Math.max(
    1,
    Math.round(bounds.height || canvas.clientHeight || window.innerHeight),
  );
  const dpr = Math.min(MAX_VISUAL_DPR, Math.max(1, window.devicePixelRatio || 1));
  return {
    cssWidth,
    cssHeight,
    pixelWidth: Math.round(cssWidth * dpr),
    pixelHeight: Math.round(cssHeight * dpr),
    dpr,
  };
}

function sameViewport(left: VisualViewport, right: VisualViewport): boolean {
  return (
    left.cssWidth === right.cssWidth &&
    left.cssHeight === right.cssHeight &&
    left.pixelWidth === right.pixelWidth &&
    left.pixelHeight === right.pixelHeight &&
    left.dpr === right.dpr
  );
}

export function createVisualLoop(options: VisualLoopOptions): VisualLoopController {
  let viewport = measureViewport(options.canvas);
  let frameId: number | null = null;
  let dirty = true;
  let animating = options.initiallyAnimating ?? false;
  let destroyed = false;

  const schedule = () => {
    if (destroyed || document.hidden || frameId !== null || (!dirty && !animating)) return;
    frameId = window.requestAnimationFrame(frame);
  };

  const applyViewport = (nextViewport: VisualViewport, force = false) => {
    if (!force && sameViewport(viewport, nextViewport)) return;
    viewport = nextViewport;
    options.canvas.width = viewport.pixelWidth;
    options.canvas.height = viewport.pixelHeight;
    options.onResize?.(viewport);
    dirty = true;
  };

  function frame(timestamp: number) {
    frameId = null;
    if (destroyed || document.hidden) return;
    if (dirty || animating) {
      dirty = false;
      options.render(timestamp, viewport);
    }
    schedule();
  }

  const resize = () => {
    if (destroyed) return;
    applyViewport(measureViewport(options.canvas));
    schedule();
  };

  const handleVisibilityChange = () => {
    if (document.hidden) {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      return;
    }
    resize();
    schedule();
  };

  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => resize());
  resizeObserver?.observe(options.canvas);

  applyViewport(viewport, true);
  schedule();

  return {
    get viewport() {
      return viewport;
    },
    requestRender() {
      dirty = true;
      schedule();
    },
    setAnimating(nextAnimating) {
      if (animating === nextAnimating) return;
      animating = nextAnimating;
      dirty = true;
      schedule();
    },
    resize,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    },
  };
}
