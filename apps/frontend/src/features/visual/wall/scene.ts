import { signalAnomaly } from './fixtures';
import { SIGNAL_GROUPS } from './types';
import {
  createProgram,
  createVisualLoop,
  createWebGLContext,
  type VisualLoopController,
  type VisualWebGLContext,
} from '../gl';
import type {
  SignalWallInput,
  SignalWallGroupPosition,
  SignalWallScene,
  SignalWallSceneOptions,
  SignalWallSceneSnapshot,
  SignalWallSignal,
  SignalWallSignalSnapshot,
  SignalWallSortMode,
  SignalWallStatus,
  SignalWallSummary,
  SignalWallVisibleRow,
} from './types';

const VERTEX_SHADER = `
attribute vec2 aPosition;
uniform vec4 uBox;
varying vec2 vUv;
void main() {
  vUv = aPosition;
  vec2 point = uBox.xy + aPosition * uBox.zw;
  gl_Position = vec4(point.x * 2.0 - 1.0, 1.0 - point.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTexture;
uniform float uHead;
uniform float uRow;
uniform float uRowCount;
uniform float uSampleCount;
uniform float uExpanded;
uniform float uAnomaly;
uniform float uHeightPx;
void main() {
  float sampleX = fract((uHead + vUv.x * (uSampleCount - 1.0) + 0.5) / uSampleCount);
  float deviation = texture2D(uTexture, vec2(sampleX, (uRow + 0.5) / uRowCount)).r * 2.0 - 1.0;
  vec3 amber = vec3(0.91, 0.70, 0.29);
  vec3 purple = vec3(0.58, 0.47, 1.0);
  vec3 safety = vec3(1.0, 0.44, 0.49);
  vec3 ink = vec3(0.68, 0.71, 0.78);
  float y = 1.0 - vUv.y;
  vec3 color = vec3(0.0);
  float alpha = 0.0;
  if (uExpanded < 0.5) {
    float depth = abs(deviation) * 3.0;
    float layers = depth > y ? min(3.0, floor(depth - y) + 1.0) : 0.0;
    alpha = layers / 3.0 * 0.8;
    color = deviation >= 0.0 ? amber : purple;
    color = mix(color, safety, uAnomaly * 0.30 * step(2.0, depth));
    if (y < 0.14 && uAnomaly > 0.55) {
      alpha = max(alpha, 0.45);
      color = amber;
    }
  } else {
    float value = deviation * 0.5 + 0.5;
    float distanceFromSignal = abs(y - value) * uHeightPx;
    float distanceFromUsual = abs(y - 0.5) * uHeightPx;
    if (distanceFromUsual < 0.7) {
      alpha = max(alpha, 0.16);
      color = ink;
    }
    bool between = (y - 0.5) * (value - 0.5) > 0.0 && abs(y - 0.5) < abs(value - 0.5);
    vec3 direction = deviation >= 0.0 ? amber : purple;
    if (between) {
      alpha = max(alpha, 0.10);
      color = direction;
    }
    if (distanceFromSignal < 1.1) {
      alpha = 0.95;
      color = mix(direction, vec3(1.0), 0.25);
    }
  }
  alpha *= smoothstep(0.0, 0.03, vUv.x);
  gl_FragColor = vec4(color * alpha, 1.0);
}`;

function requiredUniform(
  gl: VisualWebGLContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Signal wall shader is missing uniform ${name}.`);
  }
  return location;
}

const SNAPSHOT_INTERVAL_MS = 100;
const MAX_VISIBLE_ROW_LABELS = 44;
const REVIEW_THRESHOLD = 0.6;
const WATCH_THRESHOLD = 0.45;

function latestAnomaly(input: SignalWallInput, signalIndex: number, head: number): number {
  const signal = input.signals[signalIndex];
  if (!signal) {
    return 0;
  }
  let peak = 0;
  const firstHistoryIndex = Math.max(0, head - 39);
  for (let historyIndex = firstHistoryIndex; historyIndex <= head; historyIndex += 1) {
    peak = Math.max(peak, Math.abs(signal.history[historyIndex] ?? 0));
  }
  return peak;
}

function statusForAnomaly(anomaly: number): SignalWallStatus {
  if (anomaly > REVIEW_THRESHOLD) return 'needs-review';
  if (anomaly > WATCH_THRESHOLD) return 'watch';
  return 'quiet';
}

function normalizedValueLabel(signal: SignalWallSignal, sampleIndex: number): string {
  if (sampleIndex === signal.history.length - 1) return signal.currentLabel;
  const deviation = signal.history[sampleIndex] ?? 0;
  if (Math.abs(deviation) < 0.015) return 'at usual range';
  return `${Math.abs(deviation).toFixed(2)} ${deviation > 0 ? 'above' : 'below'} usual`;
}

function signalSnapshot(
  input: SignalWallInput,
  signalIndex: number,
  sampleIndex: number,
): SignalWallSignalSnapshot {
  const signal = input.signals[signalIndex];
  if (!signal) {
    return {
      signalId: '',
      deviation: 0,
      anomaly: 0,
      valueLabel: 'unavailable',
      detail: 'No fixture sample is available.',
      status: 'quiet',
    };
  }
  const deviation = signal.history[sampleIndex] ?? 0;
  const anomaly = latestAnomaly(input, signalIndex, sampleIndex);
  const detail =
    signal.reason && anomaly > WATCH_THRESHOLD
      ? signal.reason
      : `Usual range: ${signal.usualLabel}`;
  return {
    signalId: signal.id,
    deviation,
    anomaly,
    valueLabel: normalizedValueLabel(signal, sampleIndex),
    detail,
    status: statusForAnomaly(anomaly),
  };
}

function summarizeSignalSnapshots(signals: readonly SignalWallSignalSnapshot[]): SignalWallSummary {
  let needsReview = 0;
  let watch = 0;
  signals.forEach((signal) => {
    if (signal.status === 'needs-review') needsReview += 1;
    else if (signal.status === 'watch') watch += 1;
  });
  return { needsReview, watch, quiet: signals.length - needsReview - watch };
}

function rankedOrder(input: SignalWallInput, head: number): number[] {
  return input.signals
    .map((_, index) => index)
    .sort((left, right) => latestAnomaly(input, right, head) - latestAnomaly(input, left, head));
}

function groupedOrder(input: SignalWallInput): number[] {
  return input.signals.map((_, index) => index);
}

function textureBytes(input: SignalWallInput): Uint8Array {
  const bytes = new Uint8Array(input.sampleCount * input.signals.length * 4);
  input.signals.forEach((signal, row) => {
    for (let column = 0; column < input.sampleCount; column += 1) {
      const deviation = signal.history[column] ?? 0;
      const byteOffset = (row * input.sampleCount + column) * 4;
      bytes[byteOffset] = Math.round((deviation * 0.5 + 0.5) * 255);
      bytes[byteOffset + 3] = 255;
    }
  });
  return bytes;
}

export function createSignalWallScene(
  canvas: HTMLCanvasElement,
  options: SignalWallSceneOptions,
): SignalWallScene | null {
  const context = createWebGLContext(canvas, { antialias: false, alpha: false });
  if (!context) {
    options.onUnavailable();
    return null;
  }
  const gl: VisualWebGLContext = context;

  let program: WebGLProgram | null = null;
  let buffer: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;

  function releaseGpuResources(): void {
    if (texture) {
      gl.deleteTexture(texture);
      texture = null;
    }
    if (buffer) {
      gl.deleteBuffer(buffer);
      buffer = null;
    }
    if (program) {
      gl.deleteProgram(program);
      program = null;
    }
  }

  let position = -1;
  let uniforms: {
    readonly box: WebGLUniformLocation;
    readonly head: WebGLUniformLocation;
    readonly row: WebGLUniformLocation;
    readonly rowCount: WebGLUniformLocation;
    readonly sampleCount: WebGLUniformLocation;
    readonly expanded: WebGLUniformLocation;
    readonly anomaly: WebGLUniformLocation;
    readonly heightPx: WebGLUniformLocation;
  };
  try {
    program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER, 'Signal wall');
    buffer = gl.createBuffer();
    texture = gl.createTexture();
    if (!buffer || !texture) throw new Error('Signal wall could not allocate its GPU resources.');

    position = gl.getAttribLocation(program, 'aPosition');
    if (position < 0) throw new Error('Signal wall shader is missing attribute aPosition.');
    uniforms = {
      box: requiredUniform(gl, program, 'uBox'),
      head: requiredUniform(gl, program, 'uHead'),
      row: requiredUniform(gl, program, 'uRow'),
      rowCount: requiredUniform(gl, program, 'uRowCount'),
      sampleCount: requiredUniform(gl, program, 'uSampleCount'),
      expanded: requiredUniform(gl, program, 'uExpanded'),
      anomaly: requiredUniform(gl, program, 'uAnomaly'),
      heightPx: requiredUniform(gl, program, 'uHeightPx'),
    };

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      options.input.sampleCount,
      options.input.signals.length,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      textureBytes(options.input),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.clearColor(0.0196, 0.0275, 0.0392, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  } catch {
    releaseGpuResources();
    options.onUnavailable();
    return null;
  }

  const wallProgram = program;
  const wallBuffer = buffer;
  const wallTexture = texture;

  const rowCount = options.input.signals.length;
  const y = new Float32Array(rowCount);
  const height = new Float32Array(rowCount);
  const targetY = new Float32Array(rowCount);
  const targetHeight = new Float32Array(rowCount);
  let mode: SignalWallSortMode = options.mode;
  let replaying = options.replaying && !options.reducedMotion;
  let sampleIndex = options.input.sampleCount - 1;
  let textureHead = 0;
  let order =
    mode === 'attention' ? rankedOrder(options.input, sampleIndex) : groupedOrder(options.input);
  let width = 1;
  let canvasHeight = 1;
  let pointerY = -1;
  let destroyed = false;
  let lastAdvance = 0;
  let lastSort = 0;
  let lastRankingKey = '';
  let lastSnapshotAt = Number.NEGATIVE_INFINITY;
  let lastSnapshotKey = '';
  let cachedSignalSampleIndex = -1;
  let cachedSignalSnapshots: readonly SignalWallSignalSnapshot[] = [];
  let cachedSummary: SignalWallSummary = { needsReview: 0, watch: 0, quiet: rowCount };
  let loop: VisualLoopController | null = null;
  let loopAnimating = replaying;

  function publishRanking(): void {
    const ids = order.slice(0, 3).map((index) => options.input.signals[index]?.id ?? '');
    const key = ids.join('|');
    if (key !== lastRankingKey) {
      lastRankingKey = key;
      options.onRankingChange?.(ids);
    }
  }

  function groupPositions(): readonly SignalWallGroupPosition[] {
    return SIGNAL_GROUPS.map((group) => {
      const rows = options.input.signals
        .map((signal, row) => ({ signal, row }))
        .filter(({ signal }) => signal.group === group)
        .map(({ row }) => row);
      const top = rows.reduce(
        (minimum, row) => Math.min(minimum, y[row] ?? 0),
        Number.POSITIVE_INFINITY,
      );
      const bottom = rows.reduce(
        (maximum, row) => Math.max(maximum, (y[row] ?? 0) + (height[row] ?? 0)),
        0,
      );
      return {
        group,
        top: Number.isFinite(top) ? top : 0,
        height: Number.isFinite(top) ? Math.max(0, bottom - top) : 0,
        signalCount: rows.length,
      };
    });
  }

  function representativeRows(): ReadonlySet<number> {
    if (mode !== 'grouped') return new Set<number>();
    const representatives = new Set<number>();
    SIGNAL_GROUPS.forEach((group) => {
      let representative = -1;
      let highestAnomaly = Number.NEGATIVE_INFINITY;
      options.input.signals.forEach((signal, row) => {
        if (signal.group !== group) return;
        const anomaly = latestAnomaly(options.input, row, sampleIndex);
        if (anomaly > highestAnomaly) {
          representative = row;
          highestAnomaly = anomaly;
        }
      });
      if (representative >= 0) representatives.add(representative);
    });
    return representatives;
  }

  function visibleRows(): readonly SignalWallVisibleRow[] {
    const representatives = representativeRows();
    let expandedCount = 0;
    return order.flatMap((row, orderIndex) => {
      const rowHeight = height[row] ?? 0;
      const representative = representatives.has(row);
      const expanded = rowHeight >= 12 && expandedCount < MAX_VISIBLE_ROW_LABELS;
      if (!representative && !expanded) return [];
      if (expanded) expandedCount += 1;
      const signal = options.input.signals[row];
      if (!signal) return [];
      return [
        {
          signalId: signal.id,
          order: orderIndex,
          top: y[row] ?? 0,
          height: rowHeight,
          representative,
        },
      ];
    });
  }

  function createSnapshot(): SignalWallSceneSnapshot {
    if (cachedSignalSampleIndex !== sampleIndex) {
      cachedSignalSampleIndex = sampleIndex;
      cachedSignalSnapshots = options.input.signals.map((_, row) =>
        signalSnapshot(options.input, row, sampleIndex),
      );
      cachedSummary = summarizeSignalSnapshots(cachedSignalSnapshots);
    }
    const denominator = Math.max(1, options.input.sampleCount - 1);
    return {
      sampleIndex,
      sampleCount: options.input.sampleCount,
      isLatest: sampleIndex === options.input.sampleCount - 1,
      elapsedHours: (sampleIndex / denominator) * options.input.historyHours,
      orderedSignalIds: order.map((row) => options.input.signals[row]?.id ?? ''),
      topSignalIds: order.slice(0, 3).map((row) => options.input.signals[row]?.id ?? ''),
      visibleRows: visibleRows(),
      groups: groupPositions(),
      signals: cachedSignalSnapshots,
      summary: cachedSummary,
    };
  }

  function publishSnapshot(now: number, force = false): void {
    if (!options.onSnapshot) return;
    if (!force && now - lastSnapshotAt < SNAPSHOT_INTERVAL_MS) return;
    const snapshot = createSnapshot();
    const positionKey = snapshot.visibleRows
      .map((row) => `${row.signalId}:${Math.round(row.top)}:${Math.round(row.height)}`)
      .join('|');
    const key = `${snapshot.sampleIndex}:${mode}:${positionKey}`;
    if (!force && key === lastSnapshotKey) return;
    lastSnapshotAt = now;
    lastSnapshotKey = key;
    options.onSnapshot(snapshot);
  }

  function layout(): void {
    const top = 190;
    const bottom = 74;
    const shelfCount = mode === 'attention' ? Math.min(3, rowCount) : 0;
    const shelfHeight = 56;
    const available = Math.max(1, canvasHeight - top - bottom);
    const wallCount = Math.max(1, rowCount - shelfCount);
    const wallAvailable = Math.max(1, available - shelfCount * (shelfHeight + 1));
    const base = wallAvailable / wallCount;
    const weights = new Float32Array(wallCount);
    let weightTotal = 0;
    for (let position = 0; position < wallCount; position += 1) {
      let weight = 1;
      if (pointerY >= 0) {
        const projectedY = top + shelfCount * (shelfHeight + 1) + (position + 0.5) * base;
        const distance = (projectedY - pointerY) / Math.max(1, base * 5.5);
        weight += 8.5 * Math.exp(-distance * distance);
      }
      weights[position] = weight;
      weightTotal += weight;
    }
    let cursor = top;
    for (let position = 0; position < shelfCount; position += 1) {
      const row = order[position];
      if (row === undefined) continue;
      targetY[row] = cursor;
      targetHeight[row] = shelfHeight;
      cursor += shelfHeight + 1;
    }
    for (let position = 0; position < wallCount; position += 1) {
      const row = order[shelfCount + position];
      if (row === undefined) continue;
      const rowHeight = wallAvailable * ((weights[position] ?? 1) / Math.max(1, weightTotal));
      targetY[row] = cursor;
      targetHeight[row] = Math.max(0.5, rowHeight - 1);
      cursor += rowHeight;
    }
  }

  function draw(dpr: number): void {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(wallProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, wallBuffer);
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, wallTexture);
    gl.uniform1f(uniforms.head, textureHead);
    gl.uniform1f(uniforms.rowCount, rowCount);
    gl.uniform1f(uniforms.sampleCount, options.input.sampleCount);

    const left = width < 760 ? 16 : Math.min(250, width * 0.2);
    const right = width < 760 ? 16 : Math.min(170, width * 0.14);
    for (let row = 0; row < rowCount; row += 1) {
      if ((height[row] ?? 0) < 1.2) continue;
      gl.uniform4f(
        uniforms.box,
        left / width,
        (y[row] ?? 0) / canvasHeight,
        (width - left - right) / width,
        (height[row] ?? 0) / canvasHeight,
      );
      gl.uniform1f(uniforms.row, row);
      gl.uniform1f(uniforms.expanded, (height[row] ?? 0) >= 34 ? 1 : 0);
      gl.uniform1f(uniforms.anomaly, latestAnomaly(options.input, row, sampleIndex));
      gl.uniform1f(uniforms.heightPx, (height[row] ?? 0) * dpr);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  function requestRender(): void {
    loop?.requestRender();
  }

  function setLoopAnimating(nextAnimating: boolean): void {
    if (loopAnimating === nextAnimating) return;
    loopAnimating = nextAnimating;
    loop?.setAnimating(nextAnimating);
  }

  function frame(now: number, dpr: number): void {
    if (destroyed) return;
    if (replaying && now - lastAdvance >= 700) {
      lastAdvance = now;
      sampleIndex = (sampleIndex + 1) % options.input.sampleCount;
      textureHead = (textureHead + 1) % options.input.sampleCount;
      if (mode === 'attention' && now - lastSort >= 2_800) {
        lastSort = now;
        order = rankedOrder(options.input, sampleIndex);
        publishRanking();
      }
    }
    layout();
    let moving = false;
    for (let row = 0; row < rowCount; row += 1) {
      y[row] = (y[row] ?? 0) + ((targetY[row] ?? 0) - (y[row] ?? 0)) * 0.14;
      height[row] = (height[row] ?? 0) + ((targetHeight[row] ?? 0) - (height[row] ?? 0)) * 0.2;
      if (
        Math.abs((targetY[row] ?? 0) - (y[row] ?? 0)) > 0.4 ||
        Math.abs((targetHeight[row] ?? 0) - (height[row] ?? 0)) > 0.3
      ) {
        moving = true;
      }
    }
    draw(dpr);
    publishSnapshot(now);
    setLoopAnimating(replaying || moving);
  }

  function onPointerMove(event: PointerEvent): void {
    const bounds = canvas.getBoundingClientRect();
    pointerY = event.clientY - bounds.top;
    requestRender();
  }

  function onPointerLeave(): void {
    pointerY = -1;
    requestRender();
  }

  function onContextLost(event: Event): void {
    event.preventDefault();
    options.onUnavailable();
  }

  let listenersAttached = false;
  try {
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('webglcontextlost', onContextLost);
    listenersAttached = true;
    loop = createVisualLoop({
      canvas,
      initiallyAnimating: replaying,
      onResize(viewport) {
        width = viewport.cssWidth;
        canvasHeight = viewport.cssHeight;
      },
      render(now, viewport) {
        frame(now, viewport.dpr);
      },
    });
  } catch {
    loop?.destroy();
    loop = null;
    if (listenersAttached) {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', onContextLost);
    }
    releaseGpuResources();
    options.onUnavailable();
    return null;
  }
  width = loop.viewport.cssWidth;
  canvasHeight = loop.viewport.cssHeight;
  layout();
  for (let row = 0; row < rowCount; row += 1) {
    y[row] = targetY[row] ?? 0;
    height[row] = targetHeight[row] ?? 0;
  }
  publishRanking();
  publishSnapshot(performance.now(), true);
  requestRender();

  return {
    setMode(nextMode) {
      mode = nextMode;
      order =
        mode === 'attention'
          ? rankedOrder(options.input, sampleIndex)
          : groupedOrder(options.input);
      publishRanking();
      setLoopAnimating(true);
      requestRender();
    },
    setReplaying(nextReplaying) {
      replaying = nextReplaying && !options.reducedMotion;
      if (replaying) lastAdvance = 0;
      setLoopAnimating(replaying);
      requestRender();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      loop?.destroy();
      loop = null;
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      releaseGpuResources();
    },
  };
}

export function initialSignalWallOrder(input: SignalWallInput): readonly string[] {
  return [...input.signals]
    .sort((left, right) => signalAnomaly(right) - signalAnomaly(left))
    .map((signal) => signal.id);
}
