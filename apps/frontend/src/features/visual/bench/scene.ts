import {
  createProgram,
  createVisualLoop,
  createWebGLContext,
  type VisualLoopController,
  type VisualViewport,
  type VisualWebGLContext,
} from '../gl';
import type { BenchSceneController, BenchSceneInput } from './types';

const SEGMENTS = 18;
const SETTLE_DURATION_MS = 2_400;

// Lifted from the tuned assembly-bench mockup. Coordinates remain in CSS pixels.
const LINE_VERTEX_SHADER = `precision highp float;attribute vec2 aP;attribute float aA;
uniform vec2 uVP;varying float vA;
void main(){vA=aA;gl_Position=vec4(aP.x/uVP.x*2.-1.,1.-aP.y/uVP.y*2.,0.,1.);}`;

const LINE_FRAGMENT_SHADER = `precision mediump float;varying float vA;uniform vec3 uCol;
void main(){gl_FragColor=vec4(uCol*vA,1.);}`;

const POINT_VERTEX_SHADER = `precision highp float;attribute vec4 aP;
uniform vec2 uVP;uniform float uDPR;varying float vK;
void main(){vK=aP.w;gl_Position=vec4(aP.x/uVP.x*2.-1.,1.-aP.y/uVP.y*2.,0.,1.);
gl_PointSize=aP.z*uDPR;}`;

const POINT_FRAGMENT_SHADER = `precision mediump float;varying float vK;
void main(){vec2 q=gl_PointCoord-.5;float r=length(q);vec3 col=vec3(.72,.75,.85);
if(vK<.5)col=vec3(.584,.471,1.);else if(vK<1.5)col=vec3(.184,.616,.51);
else if(vK<2.5)col=vec3(.91,.702,.294);else col=vec3(.50,.53,.59);
float a=smoothstep(.5,.13,r);gl_FragColor=vec4(col*a,1.);}`;

const RING_VERTEX_SHADER = `precision highp float;attribute vec2 aP;uniform vec2 uVP,uC;uniform float uR;
varying vec2 vQ;void main(){vQ=aP;vec2 p=uC+aP*uR;
gl_Position=vec4(p.x/uVP.x*2.-1.,1.-p.y/uVP.y*2.,0.,1.);}`;

const RING_FRAGMENT_SHADER = `precision mediump float;varying vec2 vQ;uniform float uGranted;
void main(){float r=length(vQ);float ring=smoothstep(.98,.9,r)-smoothstep(.74,.66,r);
vec3 col=mix(vec3(.91,.702,.294),vec3(.184,.616,.51),uGranted);
gl_FragColor=vec4(col*ring*.82,1.);}`;

type Point = readonly [number, number];

interface ScenePrograms {
  line: WebGLProgram;
  point: WebGLProgram;
  ring: WebGLProgram;
}

interface SceneBuffers {
  line: WebGLBuffer;
  point: WebGLBuffer;
  ring: WebGLBuffer;
}

interface CableGeometry {
  approvalRequired: boolean;
  color: readonly [number, number, number];
  dashed: boolean;
  effectKind: number;
  granted: boolean;
  points: readonly Point[];
  runnable: boolean;
}

function requireBuffer(gl: VisualWebGLContext): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('Assembly bench: WebGL could not allocate a buffer.');
  return buffer;
}

function curve(start: Point, end: Point, sag: number, waypoint?: Point): Point[] {
  return Array.from({ length: SEGMENTS + 1 }, (_, index): Point => {
    const progress = index / SEGMENTS;
    let x = start[0] + (end[0] - start[0]) * progress;
    let y = start[1] + (end[1] - start[1]) * progress + Math.sin(progress * Math.PI) * sag;
    if (waypoint) {
      const pull = Math.max(0, 1 - Math.abs(progress - 0.56) / 0.24);
      x += (waypoint[0] - x) * pull;
      y += (waypoint[1] - y) * pull;
    }
    return [x, y];
  });
}

function cableGeometry(input: BenchSceneInput, viewport: VisualViewport): CableGeometry[] {
  const count = Math.max(1, input.capabilities.length);
  return input.capabilities.map((capability, index) => {
    const y = viewport.cssHeight * (0.31 + ((index + 0.5) / count) * 0.5);
    const start: Point = [viewport.cssWidth * 0.39, y];
    const plantSide = capability.executionPlacement === 'workstation';
    const end: Point = [viewport.cssWidth * (plantSide ? 0.83 : 0.68), y - 22 + (index % 2) * 36];
    const waypoint = capability.approvalRequired
      ? ([viewport.cssWidth * 0.56, viewport.cssHeight * 0.66] as const)
      : plantSide
        ? ([viewport.cssWidth * 0.75, viewport.cssHeight * 0.52] as const)
        : undefined;
    const healthy = capability.connectorState === 'healthy';
    const granted = capability.authority === 'granted';
    return {
      approvalRequired: capability.approvalRequired,
      color:
        capability.connectorState === 'degraded'
          ? ([0.91, 0.7, 0.29] as const)
          : capability.effect === 'read'
            ? ([0.584, 0.471, 1] as const)
            : ([0.91, 0.702, 0.294] as const),
      dashed: !granted,
      effectKind: capability.effect === 'read' ? 1 : capability.effect === 'write' ? 2 : 3,
      granted,
      points: curve(start, end, granted && healthy ? 12 : 36, waypoint),
      runnable: granted && healthy,
    };
  });
}

function drawRibbon(
  gl: VisualWebGLContext,
  viewport: VisualViewport,
  programs: ScenePrograms,
  buffers: SceneBuffers,
  cable: CableGeometry,
): void {
  const vertices: number[] = [];
  for (let index = 0; index < cable.points.length; index += 1) {
    const point = cable.points[index]!;
    const before = cable.points[Math.max(0, index - 1)]!;
    const after = cable.points[Math.min(cable.points.length - 1, index + 1)]!;
    let normalX = -(after[1] - before[1]);
    let normalY = after[0] - before[0];
    const length = Math.hypot(normalX, normalY) || 1;
    normalX = (normalX / length) * 1.2;
    normalY = (normalY / length) * 1.2;
    const alpha = cable.dashed && (index >> 1) % 2 ? 0 : cable.granted ? 0.68 : 0.28;
    vertices.push(
      point[0] + normalX,
      point[1] + normalY,
      alpha,
      point[0] - normalX,
      point[1] - normalY,
      alpha,
    );
  }
  gl.useProgram(programs.line);
  gl.uniform2f(gl.getUniformLocation(programs.line, 'uVP'), viewport.cssWidth, viewport.cssHeight);
  gl.uniform3fv(gl.getUniformLocation(programs.line, 'uCol'), cable.color);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.line);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
  const position = gl.getAttribLocation(programs.line, 'aP');
  const alpha = gl.getAttribLocation(programs.line, 'aA');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 12, 0);
  gl.enableVertexAttribArray(alpha);
  gl.vertexAttribPointer(alpha, 1, gl.FLOAT, false, 12, 8);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, vertices.length / 3);
}

function drawPoints(
  gl: VisualWebGLContext,
  viewport: VisualViewport,
  programs: ScenePrograms,
  buffers: SceneBuffers,
  cables: readonly CableGeometry[],
  progress: number,
): void {
  const vertices: number[] = [];
  for (let x = 20; x < viewport.cssWidth; x += 28) {
    for (let y = 20; y < viewport.cssHeight; y += 28) vertices.push(x, y, 1.25, 3);
  }
  for (const cable of cables) {
    if (!cable.runnable) continue;
    const cursor = Math.min(cable.points.length - 1, Math.floor(progress * cable.points.length));
    const point = cable.points[cursor]!;
    vertices.push(point[0], point[1], 7, cable.effectKind);
  }
  gl.useProgram(programs.point);
  gl.uniform2f(gl.getUniformLocation(programs.point, 'uVP'), viewport.cssWidth, viewport.cssHeight);
  gl.uniform1f(gl.getUniformLocation(programs.point, 'uDPR'), viewport.dpr);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.point);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
  const position = gl.getAttribLocation(programs.point, 'aP');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 4, gl.FLOAT, false, 16, 0);
  gl.drawArrays(gl.POINTS, 0, vertices.length / 4);
}

function drawApprovalRings(
  gl: VisualWebGLContext,
  viewport: VisualViewport,
  programs: ScenePrograms,
  buffers: SceneBuffers,
  cables: readonly CableGeometry[],
): void {
  gl.useProgram(programs.ring);
  gl.uniform2f(gl.getUniformLocation(programs.ring, 'uVP'), viewport.cssWidth, viewport.cssHeight);
  gl.uniform1f(gl.getUniformLocation(programs.ring, 'uR'), 17);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.ring);
  const position = gl.getAttribLocation(programs.ring, 'aP');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  for (const cable of cables) {
    if (!cable.approvalRequired) continue;
    const point = cable.points[Math.floor(cable.points.length * 0.56)]!;
    gl.uniform2f(gl.getUniformLocation(programs.ring, 'uC'), point[0], point[1]);
    gl.uniform1f(gl.getUniformLocation(programs.ring, 'uGranted'), cable.granted ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

export function createBenchScene(
  canvas: HTMLCanvasElement,
  input: BenchSceneInput,
): BenchSceneController | null {
  const gl = createWebGLContext(canvas);
  if (!gl) return null;
  const allocatedPrograms: WebGLProgram[] = [];
  const allocatedBuffers: WebGLBuffer[] = [];
  let programs: ScenePrograms;
  let buffers: SceneBuffers;
  try {
    const line = createProgram(
      gl,
      LINE_VERTEX_SHADER,
      LINE_FRAGMENT_SHADER,
      'Assembly bench cables',
    );
    allocatedPrograms.push(line);
    const point = createProgram(
      gl,
      POINT_VERTEX_SHADER,
      POINT_FRAGMENT_SHADER,
      'Assembly bench packets',
    );
    allocatedPrograms.push(point);
    const ring = createProgram(
      gl,
      RING_VERTEX_SHADER,
      RING_FRAGMENT_SHADER,
      'Assembly bench approval ring',
    );
    allocatedPrograms.push(ring);
    programs = { line, point, ring };

    const lineBuffer = requireBuffer(gl);
    allocatedBuffers.push(lineBuffer);
    const pointBuffer = requireBuffer(gl);
    allocatedBuffers.push(pointBuffer);
    const ringBuffer = requireBuffer(gl);
    allocatedBuffers.push(ringBuffer);
    buffers = { line: lineBuffer, point: pointBuffer, ring: ringBuffer };
  } catch (error) {
    allocatedBuffers.forEach((buffer) => gl.deleteBuffer(buffer));
    allocatedPrograms.forEach((program) => gl.deleteProgram(program));
    throw error;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.ring);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]),
    gl.STATIC_DRAW,
  );
  gl.clearColor(0.0196, 0.0275, 0.0392, 1);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let startedAt: number | null = null;
  let loop: VisualLoopController | null = null;
  loop = createVisualLoop({
    canvas,
    initiallyAnimating: !input.reducedMotion,
    render(timestamp, viewport) {
      startedAt ??= timestamp;
      const elapsed = input.reducedMotion ? SETTLE_DURATION_MS : timestamp - startedAt;
      const packetProgress = input.reducedMotion
        ? 1
        : Math.min(1, Math.max(0, elapsed / SETTLE_DURATION_MS));
      gl.viewport(0, 0, viewport.pixelWidth, viewport.pixelHeight);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const cables = cableGeometry(input, viewport);
      for (const cable of cables) drawRibbon(gl, viewport, programs, buffers, cable);
      drawPoints(gl, viewport, programs, buffers, cables, packetProgress);
      drawApprovalRings(gl, viewport, programs, buffers, cables);
      if (!input.reducedMotion && elapsed >= SETTLE_DURATION_MS) loop?.setAnimating(false);
    },
  });

  return {
    wake: () => loop?.requestRender(),
    destroy() {
      loop?.destroy();
      loop = null;
      [buffers.line, buffers.point, buffers.ring].forEach((buffer) => gl.deleteBuffer(buffer));
      [programs.line, programs.point, programs.ring].forEach((program) =>
        gl.deleteProgram(program),
      );
    },
  };
}
