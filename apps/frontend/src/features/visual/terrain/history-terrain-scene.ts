import {
  createProgram,
  createVisualLoop,
  createWebGLContext,
  type VisualViewport,
  type VisualWebGLContext,
} from '../gl';
import type { HistoryTerrainModel } from './history-terrain-model';
import type { HistoryTerrainPoint, HistoryTerrainProjectedLabel } from './history-terrain-types';

const FILL_VERTEX_SHADER = `
precision highp float;
attribute vec3 aPosition;
attribute vec3 aMaterial;
uniform mat4 uMvp;
uniform float uCursorX;
uniform float uHighlightedRow;
uniform float uRow;
varying float vShade;
varying float vJam;
varying float vGhost;
varying float vFog;
varying float vHighlight;
void main() {
  vShade = aMaterial.x;
  vJam = aMaterial.y;
  vGhost = smoothstep(uCursorX, uCursorX + 0.4, aPosition.x);
  vFog = clamp((aPosition.z + 12.0) / 23.0, 0.0, 1.0);
  vHighlight = (uHighlightedRow < -0.5 || abs(uRow - uHighlightedRow) < 0.5) ? 1.0 : 0.35;
  gl_Position = uMvp * vec4(aPosition, 1.0);
}`;

const FILL_FRAGMENT_SHADER = `
precision mediump float;
varying float vShade;
varying float vJam;
varying float vGhost;
varying float vFog;
varying float vHighlight;
void main() {
  vec3 background = vec3(0.0196, 0.0275, 0.0392);
  vec3 purple = vec3(0.584, 0.471, 1.0);
  vec3 amber = vec3(0.91, 0.702, 0.294);
  vec3 base = mix(purple, amber, vJam * 0.85);
  vec3 color = base * (0.10 + 0.40 * vShade * vShade + 0.12 * vJam);
  color = mix(background, color, 0.35 + 0.65 * vFog);
  color = mix(color, background, vGhost * 0.82);
  color *= vHighlight;
  gl_FragColor = vec4(color, 1.0);
}`;

const LINE_VERTEX_SHADER = `
precision highp float;
attribute vec3 aPosition;
attribute float aDistance;
uniform mat4 uMvp;
uniform float uCursorX;
uniform float uHighlightedRow;
uniform float uRow;
varying float vDistance;
varying float vGhost;
varying float vFog;
varying float vHighlight;
void main() {
  vDistance = aDistance;
  vGhost = smoothstep(uCursorX, uCursorX + 0.4, aPosition.x);
  vFog = clamp((aPosition.z + 12.0) / 23.0, 0.0, 1.0);
  vHighlight = (uHighlightedRow < -0.5 || abs(uRow - uHighlightedRow) < 0.5) ? 1.0 : 0.30;
  gl_Position = uMvp * vec4(aPosition, 1.0);
}`;

const LINE_FRAGMENT_SHADER = `
precision mediump float;
varying float vDistance;
varying float vGhost;
varying float vFog;
varying float vHighlight;
uniform vec3 uColor;
uniform float uDashed;
uniform float uAlpha;
uniform float uPlanMode;
void main() {
  float alpha = uAlpha;
  if (uDashed > 0.5) alpha *= step(0.45, fract(vDistance * 2.6));
  alpha *= 0.35 + 0.65 * vFog;
  if (uPlanMode < 0.5) alpha *= 1.0 - vGhost * 0.9;
  else alpha *= 0.55 + 0.45 * vGhost;
  gl_FragColor = vec4(uColor * alpha * vHighlight, 1.0);
}`;

interface MatrixCamera {
  readonly mvp: Float32Array;
  readonly eye: readonly [number, number, number];
}

interface TerrainBuffer {
  readonly buffer: WebGLBuffer;
  readonly count: number;
}

export interface HistoryTerrainSceneController {
  setCursor(week: number): void;
  requestRender(): void;
  destroy(): void;
}

export interface HistoryTerrainSceneOptions {
  readonly canvas: HTMLCanvasElement;
  readonly model: HistoryTerrainModel;
  readonly initialCursor: number;
  readonly onHover: (point: HistoryTerrainPoint | null) => void;
  readonly onProjectedLabels: (labels: readonly HistoryTerrainProjectedLabel[]) => void;
  readonly onUnavailable: (reason: string) => void;
}

export type HistoryTerrainSceneFactory = (
  options: HistoryTerrainSceneOptions,
) => HistoryTerrainSceneController | null;

function perspective(fieldOfView: number, aspect: number, near: number, far: number): Float32Array {
  const scale = 1 / Math.tan(fieldOfView / 2);
  return new Float32Array([
    scale / aspect,
    0,
    0,
    0,
    0,
    scale,
    0,
    0,
    0,
    0,
    (far + near) / (near - far),
    -1,
    0,
    0,
    (2 * far * near) / (near - far),
    0,
  ]);
}

function lookAt(
  eye: readonly [number, number, number],
  center: readonly [number, number, number],
): Float32Array {
  let zX = eye[0] - center[0];
  let zY = eye[1] - center[1];
  let zZ = eye[2] - center[2];
  let length = Math.hypot(zX, zY, zZ) || 1;
  zX /= length;
  zY /= length;
  zZ /= length;
  let xX = zZ;
  let xY = 0;
  let xZ = -zX;
  length = Math.hypot(xX, xY, xZ) || 1;
  xX /= length;
  xY /= length;
  xZ /= length;
  const yX = zY * xZ - zZ * xY;
  const yY = zZ * xX - zX * xZ;
  const yZ = zX * xY - zY * xX;
  return new Float32Array([
    xX,
    yX,
    zX,
    0,
    xY,
    yY,
    zY,
    0,
    xZ,
    yZ,
    zZ,
    0,
    -(xX * eye[0] + xY * eye[1] + xZ * eye[2]),
    -(yX * eye[0] + yY * eye[1] + yZ * eye[2]),
    -(zX * eye[0] + zY * eye[1] + zZ * eye[2]),
    1,
  ]);
}

function multiply(left: Float32Array, right: Float32Array): Float32Array {
  const output = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += (left[index * 4 + row] ?? 0) * (right[column * 4 + index] ?? 0);
      }
      output[column * 4 + row] = value;
    }
  }
  return output;
}

function attribute(gl: VisualWebGLContext, program: WebGLProgram, name: string): number {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error(`History terrain shader attribute ${name} is unavailable.`);
  return location;
}

function createBuffer(
  gl: VisualWebGLContext,
  resources: WebGLBuffer[],
  values: Float32Array,
  usage: number = gl.STATIC_DRAW,
): TerrainBuffer {
  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error('History terrain could not allocate a geometry buffer.');
  resources.push(buffer);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, values, usage);
  return { buffer, count: values.length / 4 };
}

function rowZ(row: number, streamCount: number): number {
  return (row - (streamCount - 1) / 2) * 2.6;
}

export const createHistoryTerrainScene: HistoryTerrainSceneFactory = (options) => {
  const gl = createWebGLContext(options.canvas, {
    alpha: false,
    antialias: true,
    depth: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (gl === null) return null;

  const buffers: WebGLBuffer[] = [];
  let fillProgram: WebGLProgram | null = null;
  let lineProgram: WebGLProgram | null = null;

  try {
    fillProgram = createProgram(
      gl,
      FILL_VERTEX_SHADER,
      FILL_FRAGMENT_SHADER,
      'History terrain fill',
    );
    lineProgram = createProgram(
      gl,
      LINE_VERTEX_SHADER,
      LINE_FRAGMENT_SHADER,
      'History terrain line',
    );

    const streamCount = options.model.input.streams.length;
    const weekCount = options.model.weekCount;
    const sampleCount = options.model.smoothed[0]?.actual.length ?? 0;
    const xStart = -13;
    const xWidth = 26;
    const height = 4.4;
    const worldX = (sampleIndex: number) =>
      xStart + (sampleIndex / Math.max(1, sampleCount - 1)) * xWidth;
    const weekX = (weekIndex: number) => xStart + (weekIndex / Math.max(1, weekCount - 1)) * xWidth;

    const fillBuffers: TerrainBuffer[] = [];
    const edgeBuffers: TerrainBuffer[] = [];
    const planBuffers: TerrainBuffer[] = [];
    options.model.smoothed.forEach((stream, row) => {
      const z = rowZ(row, streamCount);
      const fills = new Float32Array(sampleCount * 2 * 6);
      const edges = new Float32Array(sampleCount * 4);
      const plans = new Float32Array(sampleCount * 4);
      for (let index = 0; index < sampleCount; index += 1) {
        const x = worldX(index);
        const actualHeight = (stream.actual[index] ?? 0) * height;
        const jam = stream.reviewJam[index] ?? 0;
        fills.set(
          [x, actualHeight, z, actualHeight / height, jam, 0, x, 0, z, 0, jam, 0],
          index * 12,
        );
        edges.set([x, actualHeight + 0.02, z, x], index * 4);
        plans.set([x, (stream.plan[index] ?? 0) * height + 0.03, z, x], index * 4);
      }
      const fill = createBuffer(gl, buffers, fills);
      fillBuffers.push({ buffer: fill.buffer, count: sampleCount * 2 });
      edgeBuffers.push(createBuffer(gl, buffers, edges));
      planBuffers.push(createBuffer(gl, buffers, plans));
    });

    const gridValues: number[] = [];
    for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
      const x = weekX(weekIndex);
      gridValues.push(
        x,
        0,
        rowZ(0, streamCount) - 1.4,
        x,
        x,
        0,
        rowZ(streamCount - 1, streamCount) + 1.4,
        x,
      );
    }
    const gridBuffer = createBuffer(gl, buffers, new Float32Array(gridValues));
    const beaconBuffers = options.model.input.beacons.flatMap((beacon) => {
      const row = options.model.input.streams.findIndex((stream) => stream.id === beacon.streamId);
      const stream = options.model.input.streams[row];
      const actual = stream?.actual[beacon.weekIndex];
      if (row < 0 || actual === undefined) return [];
      const x = weekX(beacon.weekIndex);
      return [
        {
          ...createBuffer(
            gl,
            buffers,
            new Float32Array([
              x,
              actual * height + 0.05,
              rowZ(row, streamCount),
              0,
              x,
              actual * height + 1.15,
              rowZ(row, streamCount),
              0,
            ]),
          ),
          weekIndex: beacon.weekIndex,
        },
      ];
    });
    const cursorBuffer = createBuffer(gl, buffers, new Float32Array(24), gl.DYNAMIC_DRAW);

    const fillLocations = {
      position: attribute(gl, fillProgram, 'aPosition'),
      material: attribute(gl, fillProgram, 'aMaterial'),
      mvp: gl.getUniformLocation(fillProgram, 'uMvp'),
      cursorX: gl.getUniformLocation(fillProgram, 'uCursorX'),
      highlightedRow: gl.getUniformLocation(fillProgram, 'uHighlightedRow'),
      row: gl.getUniformLocation(fillProgram, 'uRow'),
    };
    const lineLocations = {
      position: attribute(gl, lineProgram, 'aPosition'),
      distance: attribute(gl, lineProgram, 'aDistance'),
      mvp: gl.getUniformLocation(lineProgram, 'uMvp'),
      cursorX: gl.getUniformLocation(lineProgram, 'uCursorX'),
      highlightedRow: gl.getUniformLocation(lineProgram, 'uHighlightedRow'),
      row: gl.getUniformLocation(lineProgram, 'uRow'),
      color: gl.getUniformLocation(lineProgram, 'uColor'),
      dashed: gl.getUniformLocation(lineProgram, 'uDashed'),
      alpha: gl.getUniformLocation(lineProgram, 'uAlpha'),
      planMode: gl.getUniformLocation(lineProgram, 'uPlanMode'),
    };

    let cursor = Math.max(0, Math.min(weekCount - 0.5, options.initialCursor));
    let highlightedRow = -1;
    let azimuth = 0.09;
    let elevation = 0.55;
    let distance = 35.5;
    let camera: MatrixCamera | null = null;
    let viewport: VisualViewport | null = null;
    let labelsDirty = true;
    let destroyed = false;
    let dragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let hoveredKey: string | null = null;
    const target: readonly [number, number, number] = [-2.2, 0.9, -0.4];

    const createCamera = (nextViewport: VisualViewport): MatrixCamera => {
      const eye: readonly [number, number, number] = [
        target[0] + distance * Math.sin(azimuth) * Math.cos(elevation),
        target[1] + distance * Math.sin(elevation),
        target[2] + distance * Math.cos(azimuth) * Math.cos(elevation),
      ];
      const projection = perspective(
        (33 * Math.PI) / 180,
        nextViewport.cssWidth / Math.max(1, nextViewport.cssHeight),
        0.5,
        120,
      );
      return { eye, mvp: multiply(projection, lookAt(eye, target)) };
    };

    const project = (
      point: readonly [number, number, number],
    ): readonly [number, number, number] => {
      if (!camera || !viewport) return [0, 0, -1];
      const matrix = camera.mvp;
      const w =
        (matrix[3] ?? 0) * point[0] +
        (matrix[7] ?? 0) * point[1] +
        (matrix[11] ?? 0) * point[2] +
        (matrix[15] ?? 0);
      const x =
        ((matrix[0] ?? 0) * point[0] +
          (matrix[4] ?? 0) * point[1] +
          (matrix[8] ?? 0) * point[2] +
          (matrix[12] ?? 0)) /
        w;
      const y =
        ((matrix[1] ?? 0) * point[0] +
          (matrix[5] ?? 0) * point[1] +
          (matrix[9] ?? 0) * point[2] +
          (matrix[13] ?? 0)) /
        w;
      return [(x * 0.5 + 0.5) * viewport.cssWidth, (1 - (y * 0.5 + 0.5)) * viewport.cssHeight, w];
    };

    const publishLabels = () => {
      if (!labelsDirty) return;
      labelsDirty = false;
      options.onProjectedLabels(
        options.model.input.streams.map((stream, row) => {
          const firstHeight = options.model.smoothed[row]?.actual[0] ?? 0;
          const [x, y, depth] = project([
            xStart - 0.4,
            firstHeight * height + 0.35,
            rowZ(row, streamCount),
          ]);
          return { streamId: stream.id, x, y, visible: depth > 0 };
        }),
      );
    };

    const drawLine = (
      resource: TerrainBuffer,
      mode: number,
      color: readonly [number, number, number],
      dashed: boolean,
      alpha: number,
      planMode: boolean,
      row: number,
    ) => {
      gl.uniform1f(lineLocations.row, row);
      gl.uniform3fv(lineLocations.color, color);
      gl.uniform1f(lineLocations.dashed, dashed ? 1 : 0);
      gl.uniform1f(lineLocations.alpha, alpha);
      gl.uniform1f(lineLocations.planMode, planMode ? 1 : 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, resource.buffer);
      gl.enableVertexAttribArray(lineLocations.position);
      gl.vertexAttribPointer(lineLocations.position, 3, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(lineLocations.distance);
      gl.vertexAttribPointer(lineLocations.distance, 1, gl.FLOAT, false, 16, 12);
      gl.drawArrays(mode, 0, resource.count);
    };

    const render = (_timestamp: number, nextViewport: VisualViewport) => {
      viewport = nextViewport;
      camera = createCamera(nextViewport);
      gl.viewport(0, 0, nextViewport.pixelWidth, nextViewport.pixelHeight);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const cursorX = weekX(cursor);

      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.useProgram(fillProgram);
      gl.uniformMatrix4fv(fillLocations.mvp, false, camera.mvp);
      gl.uniform1f(fillLocations.cursorX, cursorX);
      gl.uniform1f(fillLocations.highlightedRow, highlightedRow);
      fillBuffers.forEach((resource, row) => {
        gl.uniform1f(fillLocations.row, row);
        gl.bindBuffer(gl.ARRAY_BUFFER, resource.buffer);
        gl.enableVertexAttribArray(fillLocations.position);
        gl.vertexAttribPointer(fillLocations.position, 3, gl.FLOAT, false, 24, 0);
        gl.enableVertexAttribArray(fillLocations.material);
        gl.vertexAttribPointer(fillLocations.material, 3, gl.FLOAT, false, 24, 12);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, resource.count);
      });

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      gl.useProgram(lineProgram);
      gl.uniformMatrix4fv(lineLocations.mvp, false, camera.mvp);
      gl.uniform1f(lineLocations.cursorX, cursorX);
      gl.uniform1f(lineLocations.highlightedRow, highlightedRow);
      drawLine(gridBuffer, gl.LINES, [0.29, 0.31, 0.38], false, 0.1, true, -1);
      edgeBuffers.forEach((resource, row) => {
        const jamRow = options.model.input.streams[row]?.reviewJam.some((value) => value > 0);
        drawLine(
          resource,
          gl.LINE_STRIP,
          jamRow ? [0.86, 0.68, 0.42] : [0.73, 0.67, 1],
          false,
          0.5,
          false,
          row,
        );
        const plan = planBuffers[row];
        if (plan) drawLine(plan, gl.LINE_STRIP, [0.56, 0.6, 0.72], true, 0.38, true, row);
      });
      beaconBuffers.forEach((resource) => {
        drawLine(
          resource,
          gl.LINES,
          [0.88, 0.39, 0.37],
          false,
          cursor >= resource.weekIndex ? 0.9 : 0,
          true,
          -1,
        );
      });

      const zStart = rowZ(0, streamCount) - 1.4;
      const zEnd = rowZ(streamCount - 1, streamCount) + 1.4;
      const cursorValues = new Float32Array([
        cursorX,
        0,
        zStart,
        0,
        cursorX,
        height + 0.5,
        zStart,
        0,
        cursorX,
        0,
        zEnd,
        0,
        cursorX,
        height + 0.5,
        zStart,
        0,
        cursorX,
        height + 0.5,
        zEnd,
        0,
        cursorX,
        0,
        zEnd,
        0,
      ]);
      gl.bindBuffer(gl.ARRAY_BUFFER, cursorBuffer.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, cursorValues, gl.DYNAMIC_DRAW);
      drawLine(
        { buffer: cursorBuffer.buffer, count: 6 },
        gl.TRIANGLES,
        [0.584, 0.471, 1],
        false,
        0.085,
        true,
        -1,
      );
      gl.depthMask(true);
      publishLabels();
    };

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.0196, 0.0275, 0.0392, 1);
    const loop = createVisualLoop({
      canvas: options.canvas,
      render,
      onResize: () => {
        labelsDirty = true;
      },
    });

    const pickAt = (clientX: number, clientY: number) => {
      if (!camera || !viewport) return;
      const bounds = options.canvas.getBoundingClientRect();
      const pointerX = clientX - bounds.left;
      const pointerY = clientY - bounds.top;
      let best: HistoryTerrainPoint | null = null;
      let bestDistance = 26 * 26;
      for (let row = 0; row < options.model.input.streams.length; row += 1) {
        const stream = options.model.input.streams[row];
        if (!stream) continue;
        for (let weekIndex = 0; weekIndex < stream.actual.length; weekIndex += 1) {
          const value = stream.actual[weekIndex] ?? 0;
          const [x, y, depth] = project([weekX(weekIndex), value * height, rowZ(row, streamCount)]);
          if (depth < 0) continue;
          const candidateDistance = (x - pointerX) ** 2 + (y - pointerY) ** 2;
          if (candidateDistance < bestDistance) {
            bestDistance = candidateDistance;
            best = { streamId: stream.id, weekIndex, x, y };
          }
        }
      }
      const nextKey = best ? `${best.streamId}:${best.weekIndex}` : null;
      if (nextKey === hoveredKey) return;
      hoveredKey = nextKey;
      const nextRow = best
        ? options.model.input.streams.findIndex((stream) => stream.id === best?.streamId)
        : -1;
      highlightedRow = nextRow;
      options.onHover(best);
      loop.requestRender();
    };

    const handlePointerDown = (event: PointerEvent) => {
      dragging = true;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      options.canvas.classList.add('is-dragging');
      options.canvas.setPointerCapture(event.pointerId);
    };
    const finishPointer = (event: PointerEvent) => {
      dragging = false;
      options.canvas.classList.remove('is-dragging');
      if (options.canvas.hasPointerCapture(event.pointerId)) {
        options.canvas.releasePointerCapture(event.pointerId);
      }
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!dragging) {
        pickAt(event.clientX, event.clientY);
        return;
      }
      const deltaX = event.clientX - lastPointerX;
      const deltaY = event.clientY - lastPointerY;
      lastPointerX = event.clientX;
      lastPointerY = event.clientY;
      azimuth = Math.max(-0.55, Math.min(0.55, azimuth - deltaX * 0.004));
      elevation = Math.max(0.22, Math.min(0.72, elevation + deltaY * 0.004));
      labelsDirty = true;
      loop.requestRender();
    };
    const handlePointerLeave = () => {
      if (dragging) return;
      hoveredKey = null;
      highlightedRow = -1;
      options.onHover(null);
      loop.requestRender();
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      distance = Math.max(22, Math.min(44, distance * (1 + Math.sign(event.deltaY) * 0.07)));
      labelsDirty = true;
      loop.requestRender();
    };
    const handleContextLost = (event: Event) => {
      event.preventDefault();
      options.onUnavailable('WebGL context was lost. The complete flat history is shown instead.');
    };

    options.canvas.addEventListener('pointerdown', handlePointerDown);
    options.canvas.addEventListener('pointerup', finishPointer);
    options.canvas.addEventListener('pointercancel', finishPointer);
    options.canvas.addEventListener('pointermove', handlePointerMove);
    options.canvas.addEventListener('pointerleave', handlePointerLeave);
    options.canvas.addEventListener('wheel', handleWheel, { passive: false });
    options.canvas.addEventListener('webglcontextlost', handleContextLost);

    return {
      setCursor(week) {
        cursor = Math.max(0, Math.min(weekCount - 0.5, week));
        loop.requestRender();
      },
      requestRender() {
        loop.requestRender();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        loop.destroy();
        options.canvas.removeEventListener('pointerdown', handlePointerDown);
        options.canvas.removeEventListener('pointerup', finishPointer);
        options.canvas.removeEventListener('pointercancel', finishPointer);
        options.canvas.removeEventListener('pointermove', handlePointerMove);
        options.canvas.removeEventListener('pointerleave', handlePointerLeave);
        options.canvas.removeEventListener('wheel', handleWheel);
        options.canvas.removeEventListener('webglcontextlost', handleContextLost);
        options.canvas.classList.remove('is-dragging');
        buffers.forEach((buffer) => gl.deleteBuffer(buffer));
        gl.deleteProgram(fillProgram);
        gl.deleteProgram(lineProgram);
      },
    };
  } catch (error) {
    buffers.forEach((buffer) => gl.deleteBuffer(buffer));
    if (fillProgram) gl.deleteProgram(fillProgram);
    if (lineProgram) gl.deleteProgram(lineProgram);
    throw error;
  }
};
