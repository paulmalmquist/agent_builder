import {
  createProgram,
  createVisualLoop,
  createWebGLContext,
  type VisualLoopController,
  type VisualViewport,
  type VisualWebGLContext,
} from '../gl';
import {
  OBSERVATORY_AGENTS,
  OBSERVATORY_GATES,
  OBSERVATORY_OUTCOMES,
  OBSERVATORY_TOOLS,
  OBSERVATORY_TRIGGERS,
  getObservatoryStats,
  type ObservatoryFixture,
} from './observatory-data';

const VERTEX_SHADER = `
precision highp float;
attribute vec4 aA,aB,aC,aT0,aT1,aM;
uniform float uT,uOff,uU,uMotion,uHov,uDPR;
uniform vec2 uVP,uC;
varying vec4 vCol;varying float vCore;
vec2 bez(vec2 P,vec2 Q,float s){
  float e=s*s*(3.0-2.0*s);
  vec2 c1=P+vec2((Q.x-P.x)*.45,0.),c2=Q-vec2((Q.x-P.x)*.45,0.);
  float u=1.0-e;
  return u*u*u*P+3.*u*u*e*c1+3.*u*e*e*c2+e*e*e*Q;}
void main(){
  float t=uT-uOff;
  vec2 P=aA.xy;float sz=2.2,al=1.,core=0.;
  vec3 pur=vec3(.584,.471,1.),teal=vec3(.184,.616,.51),amb=vec3(.91,.702,.294),red=vec3(.878,.392,.373);
  vec3 col=pur;
  float T0=aT0.x,T1=aT0.y,T2=aT0.z,T3=aT0.w,T4=aT1.x,T5=aT1.y,T6=aT1.z,T7=aT1.w;
  bool appr=aB.w>28.0&&aM.y<1.5;
  bool fail=aM.y>1.5;
  float trans=0.;
  if(t<T0){al=0.;}
  else if(t<T1){P=bez(aA.xy,aA.zw,(t-T0)/(T1-T0));trans=1.;core=.5;}
  else if(t<T2){float a=aM.w*6.283+t*(1.2+aM.w)*uMotion;P=aA.zw+(0.55+aM.w*1.1)*vec2(cos(a),sin(a)*.8);core=.35;}
  else if(t<T3){P=bez(aA.zw,aB.xy,(t-T2)/(T3-T2));trans=1.;core=.5;}
  else if(t<T4){float a=aM.w*6.283-t*(1.4+aM.w*.7)*uMotion;P=aB.xy+(0.45+aM.w*.9)*vec2(cos(a),sin(a)*.8);core=.35;}
  else if(t<T5){float s=(t-T4)/(T5-T4);P=bez(aB.xy,aB.zw,s);trans=1.;core=.5;
    if(fail){P.y+=2.6*s*s;col=mix(pur,red,s);} }
  else if(t<T6){
    if(appr){float w=clamp((t-T5)/1.1,0.,1.);col=mix(pur,amb,w);
      float rr=1.2+min(aM.z,170.)*.031;
      float a=aM.w*6.283+t*(.5+aM.w*.25)*uMotion;
      P=aB.zw+rr*vec2(cos(a),sin(a)*.82);sz=2.4;core=.15*w;}
    else{float a=aM.w*6.283+t*2.0*uMotion;P=aB.zw+0.5*vec2(cos(a),sin(a)*.8);core=.3;}}
  else if(t<T7){float s=(t-T6)/(T7-T6);P=bez(aB.zw,aC.xy,s);trans=1.;core=.5;
    col=mix(col,aM.y<0.5?teal:(aM.y<1.5?amb:red),s);}
  else{P=aC.zw;col=aM.y<0.5?teal:(aM.y<1.5?amb:red);al=.42;sz=1.9;
    P+=uMotion*0.04*vec2(sin(uT*2.6+aM.w*9.),cos(uT*2.2+aM.w*7.));}
  if(uOff>0.0){al*= trans>0.5? .5:0.0; sz*=.82;}
  if(uHov>-.5){al*= abs(aM.x-uHov)<.5?1.0:.05;}
  vCol=vec4(col,al);vCore=core;
  vec2 clip=(P-uC)*uU/(uVP*.5);clip.y=-clip.y;
  gl_Position=vec4(clip,0.,1.);
  gl_PointSize=sz*uDPR*(1.0+core*.5);}`;

const FRAGMENT_SHADER = `
precision mediump float;varying vec4 vCol;varying float vCore;
void main(){
  vec2 d=gl_PointCoord-.5;float r=length(d);
  float a=smoothstep(.5,.14,r);
  vec3 c=vCol.rgb+vCore*vec3(1.)*smoothstep(.3,.0,r);
  gl_FragColor=vec4(c*vCol.a*a,1.0);}`;

const WIRE_VERTEX_SHADER = `
precision highp float;attribute vec2 aP;attribute float aW;
uniform float uU,uHov;uniform vec2 uVP,uC;varying float vA;
void main(){
  float a=.05;
  if(uHov>-.5){a= aW<-.5? .02 : (abs(aW-uHov)<.5? .3 : .012);}
  vA=a;
  vec2 clip=(aP-uC)*uU/(uVP*.5);clip.y=-clip.y;
  gl_Position=vec4(clip,0.,1.);}`;

const WIRE_FRAGMENT_SHADER = `precision mediump float;varying float vA;
void main(){gl_FragColor=vec4(vec3(.72,.75,.85)*vA,1.);}`;

const RING_VERTEX_SHADER = `
precision highp float;attribute vec3 aP;
uniform float uU,uDPR;uniform mediump float uQ;uniform vec2 uVP,uC;varying float vK;
void main(){vK=aP.z;
  vec2 clip=(aP.xy-uC)*uU/(uVP*.5);clip.y=-clip.y;
  gl_Position=vec4(clip,0.,1.);
  float s=30.0;if(aP.z>3.5&&aP.z<4.5)s=34.0+uQ*10.0;
  gl_PointSize=s*uDPR;}`;

const RING_FRAGMENT_SHADER = `
precision mediump float;varying float vK;uniform float uQ;
void main(){
  vec2 d=gl_PointCoord-.5;float r=length(d);
  float ring=smoothstep(.5,.47,r)-smoothstep(.40,.37,r);
  vec3 col=vec3(.42,.46,.56);
  float glow=0.0;
  if(vK>3.5&&vK<4.5){col=mix(col,vec3(.91,.702,.294),clamp(uQ*1.4,0.,1.));
    glow=uQ*.35*smoothstep(.45,.0,r);}
  gl_FragColor=vec4(col*ring*.85+vec3(.91,.702,.294)*glow,1.);}`;

const ATTRIBUTE_STRIDE = 24 * Float32Array.BYTES_PER_ELEMENT;
const REPLAY_START_HOUR = 5.2;
const REPLAY_HOURS_PER_SECOND = 24 / 20;

interface ProgramLocations {
  readonly program: WebGLProgram;
  readonly attributes: Readonly<Record<string, number>>;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation>>;
}

export interface ObservatorySceneFrame {
  readonly hour: number;
  readonly playing: boolean;
}

export interface ObservatorySceneOptions {
  readonly fixture: ObservatoryFixture;
  readonly initialHour: number;
  readonly reducedMotion: boolean;
  readonly onFrame?: ((frame: ObservatorySceneFrame) => void) | undefined;
}

export interface ObservatorySceneController {
  seek(hour: number): void;
  setPlaying(playing: boolean): void;
  setHoveredAgent(agentIndex: number | null): void;
  destroy(): void;
}

function requireAttribute(gl: VisualWebGLContext, program: WebGLProgram, name: string): number {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) throw new Error(`Run current scene attribute ${name} is unavailable.`);
  return location;
}

function requireUniform(
  gl: VisualWebGLContext,
  program: WebGLProgram,
  name: string,
): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (location === null) throw new Error(`Run current scene uniform ${name} is unavailable.`);
  return location;
}

function createBuffer(
  gl: VisualWebGLContext,
  data: BufferSource,
  buffers: WebGLBuffer[],
): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error('Run current scene could not allocate a buffer.');
  buffers.push(buffer);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

function curve(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): ReadonlyArray<readonly [number, number]> {
  const points: Array<readonly [number, number]> = [];
  const controlOne = [start.x + (end.x - start.x) * 0.45, start.y] as const;
  const controlTwo = [end.x - (end.x - start.x) * 0.45, end.y] as const;
  for (let index = 0; index <= 24; index += 1) {
    const elapsed = index / 24;
    const remaining = 1 - elapsed;
    points.push([
      remaining ** 3 * start.x +
        3 * remaining ** 2 * elapsed * controlOne[0] +
        3 * remaining * elapsed ** 2 * controlTwo[0] +
        elapsed ** 3 * end.x,
      remaining ** 3 * start.y +
        3 * remaining ** 2 * elapsed * controlOne[1] +
        3 * remaining * elapsed ** 2 * controlTwo[1] +
        elapsed ** 3 * end.y,
    ]);
  }
  return points;
}

function buildWireData(fixture: ObservatoryFixture): Float32Array {
  const segments: number[] = [];
  const addWire = (
    start: { readonly x: number; readonly y: number },
    end: { readonly x: number; readonly y: number },
    agentIndex: number,
  ) => {
    const points = curve(start, end);
    for (let index = 0; index < 24; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      if (current === undefined || next === undefined) continue;
      segments.push(current[0], current[1], agentIndex, next[0], next[1], agentIndex);
    }
  };

  OBSERVATORY_AGENTS.forEach((agent, agentIndex) => {
    const triggerIndexes = new Set(
      fixture.runs.filter((run) => run.agentIndex === agentIndex).map((run) => run.triggerIndex),
    );
    for (const triggerIndex of triggerIndexes) {
      const trigger = OBSERVATORY_TRIGGERS[triggerIndex];
      if (trigger !== undefined) addWire(trigger, agent, agentIndex);
    }
    for (const [toolIndex] of agent.toolWeights) {
      const tool = OBSERVATORY_TOOLS[toolIndex];
      if (tool !== undefined) addWire(agent, tool, agentIndex);
    }
  });
  for (const tool of OBSERVATORY_TOOLS) {
    for (const gate of OBSERVATORY_GATES) addWire(tool, gate, -1);
  }
  for (const gate of OBSERVATORY_GATES) {
    addWire(gate, OBSERVATORY_OUTCOMES[0]!, -1);
    addWire(gate, OBSERVATORY_OUTCOMES[1]!, -1);
  }
  return new Float32Array(segments);
}

function buildRingData(): Float32Array {
  const nodes: number[] = [];
  for (const node of OBSERVATORY_TRIGGERS) nodes.push(node.x, node.y, 0);
  for (const node of OBSERVATORY_AGENTS) nodes.push(node.x, node.y, 1);
  for (const node of OBSERVATORY_TOOLS) nodes.push(node.x, node.y, 2);
  const autoGate = OBSERVATORY_GATES[0];
  const approvalGate = OBSERVATORY_GATES[1];
  if (autoGate !== undefined) nodes.push(autoGate.x, autoGate.y, 3);
  if (approvalGate !== undefined) nodes.push(approvalGate.x, approvalGate.y, 4);
  OBSERVATORY_OUTCOMES.forEach((node, index) => nodes.push(node.x, node.y, 5 + index));
  return new Float32Array(nodes);
}

function buildRunData(fixture: ObservatoryFixture): Float32Array {
  const packed = new Float32Array(fixture.runs.length * 24);
  fixture.runs.forEach((run, index) => {
    const trigger = OBSERVATORY_TRIGGERS[run.triggerIndex];
    const agent = OBSERVATORY_AGENTS[run.agentIndex];
    const tool = OBSERVATORY_TOOLS[run.toolIndex];
    const gate = run.failed
      ? OBSERVATORY_OUTCOMES[2]
      : OBSERVATORY_GATES[run.requiresApproval ? 1 : 0];
    const outcome = run.failed ? OBSERVATORY_OUTCOMES[2] : OBSERVATORY_OUTCOMES[run.outcomeIndex];
    if (
      trigger === undefined ||
      agent === undefined ||
      tool === undefined ||
      gate === undefined ||
      outcome === undefined
    ) {
      throw new Error(`Run current fixture ${run.id} references an unknown topology node.`);
    }
    const offset = index * 24;
    packed[offset] = trigger.x;
    packed[offset + 1] = trigger.y;
    packed[offset + 2] = agent.x;
    packed[offset + 3] = agent.y;
    packed[offset + 4] = tool.x;
    packed[offset + 5] = tool.y;
    packed[offset + 6] = gate.x;
    packed[offset + 7] = gate.y;
    packed[offset + 8] = outcome.x;
    packed[offset + 9] = outcome.y;
    packed[offset + 10] = run.landingX;
    packed[offset + 11] = run.landingY;
    run.stageTimes.forEach((time, stageIndex) => {
      packed[offset + 12 + stageIndex] = time;
    });
    packed[offset + 20] = run.agentIndex;
    packed[offset + 21] = run.outcomeIndex;
    packed[offset + 22] = run.queueIndex;
    packed[offset + 23] = run.entropy;
  });
  return packed;
}

function commonUniforms(
  gl: VisualWebGLContext,
  locations: ProgramLocations,
  viewport: VisualViewport,
  unit: number,
) {
  gl.uniform1f(locations.uniforms.uU!, unit * viewport.dpr);
  gl.uniform2f(locations.uniforms.uVP!, viewport.pixelWidth, viewport.pixelHeight);
  gl.uniform2f(locations.uniforms.uC!, 51, 26.5);
}

export function createObservatoryScene(
  canvas: HTMLCanvasElement,
  options: ObservatorySceneOptions,
): ObservatorySceneController | null {
  const gl = createWebGLContext(canvas);
  if (gl === null) return null;

  const buffers: WebGLBuffer[] = [];
  const programs: WebGLProgram[] = [];
  let loop: VisualLoopController | null = null;

  try {
    const runProgram = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER, 'Run current particles');
    const wireProgram = createProgram(
      gl,
      WIRE_VERTEX_SHADER,
      WIRE_FRAGMENT_SHADER,
      'Run current topology',
    );
    const ringProgram = createProgram(
      gl,
      RING_VERTEX_SHADER,
      RING_FRAGMENT_SHADER,
      'Run current nodes',
    );
    programs.push(runProgram, wireProgram, ringProgram);

    const runLocations: ProgramLocations = {
      program: runProgram,
      attributes: Object.fromEntries(
        ['aA', 'aB', 'aC', 'aT0', 'aT1', 'aM'].map((name) => [
          name,
          requireAttribute(gl, runProgram, name),
        ]),
      ),
      uniforms: Object.fromEntries(
        ['uT', 'uOff', 'uU', 'uMotion', 'uHov', 'uDPR', 'uVP', 'uC'].map((name) => [
          name,
          requireUniform(gl, runProgram, name),
        ]),
      ),
    };
    const wireLocations: ProgramLocations = {
      program: wireProgram,
      attributes: {
        aP: requireAttribute(gl, wireProgram, 'aP'),
        aW: requireAttribute(gl, wireProgram, 'aW'),
      },
      uniforms: Object.fromEntries(
        ['uU', 'uHov', 'uVP', 'uC'].map((name) => [name, requireUniform(gl, wireProgram, name)]),
      ),
    };
    const ringLocations: ProgramLocations = {
      program: ringProgram,
      attributes: { aP: requireAttribute(gl, ringProgram, 'aP') },
      uniforms: Object.fromEntries(
        ['uU', 'uDPR', 'uQ', 'uVP', 'uC'].map((name) => [
          name,
          requireUniform(gl, ringProgram, name),
        ]),
      ),
    };

    const runBuffer = createBuffer(gl, buildRunData(options.fixture), buffers);
    const wireData = buildWireData(options.fixture);
    const wireBuffer = createBuffer(gl, wireData, buffers);
    const ringData = buildRingData();
    const ringBuffer = createBuffer(gl, ringData, buffers);

    gl.clearColor(0.0196, 0.0275, 0.0392, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    let currentHour = Math.min(24, Math.max(0, options.initialHour));
    let playing = !options.reducedMotion;
    let hoveredAgent = -1;
    let previousTimestamp: number | null = null;
    let lastReportedTimestamp = Number.NEGATIVE_INFINITY;

    const reportFrame = (timestamp: number, force = false) => {
      if (!force && timestamp - lastReportedTimestamp < 90) return;
      lastReportedTimestamp = timestamp;
      options.onFrame?.({ hour: currentHour, playing });
    };

    const render = (timestamp: number, viewport: VisualViewport) => {
      if (playing) {
        if (previousTimestamp !== null) {
          const elapsedSeconds = Math.min(
            0.1,
            Math.max(0, (timestamp - previousTimestamp) / 1_000),
          );
          currentHour += elapsedSeconds * REPLAY_HOURS_PER_SECOND;
        }
        previousTimestamp = timestamp;
        if (currentHour >= 24) {
          currentHour = 24;
          playing = false;
          previousTimestamp = null;
          loop?.setAnimating(false);
        }
      }

      const unit = Math.min(viewport.cssWidth / 118, viewport.cssHeight / 62);
      const stats = getObservatoryStats(options.fixture, currentHour);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(wireLocations.program);
      commonUniforms(gl, wireLocations, viewport, unit);
      gl.uniform1f(wireLocations.uniforms.uHov!, hoveredAgent);
      gl.bindBuffer(gl.ARRAY_BUFFER, wireBuffer);
      gl.enableVertexAttribArray(wireLocations.attributes.aP!);
      gl.vertexAttribPointer(wireLocations.attributes.aP!, 2, gl.FLOAT, false, 12, 0);
      gl.enableVertexAttribArray(wireLocations.attributes.aW!);
      gl.vertexAttribPointer(wireLocations.attributes.aW!, 1, gl.FLOAT, false, 12, 8);
      gl.drawArrays(gl.LINES, 0, wireData.length / 3);
      gl.disableVertexAttribArray(wireLocations.attributes.aW!);

      gl.useProgram(ringLocations.program);
      commonUniforms(gl, ringLocations, viewport, unit);
      gl.uniform1f(ringLocations.uniforms.uDPR!, viewport.dpr);
      gl.uniform1f(ringLocations.uniforms.uQ!, Math.min(1, stats.waiting / 140));
      gl.bindBuffer(gl.ARRAY_BUFFER, ringBuffer);
      gl.enableVertexAttribArray(ringLocations.attributes.aP!);
      gl.vertexAttribPointer(ringLocations.attributes.aP!, 3, gl.FLOAT, false, 12, 0);
      gl.drawArrays(gl.POINTS, 0, ringData.length / 3);

      gl.useProgram(runLocations.program);
      commonUniforms(gl, runLocations, viewport, unit);
      gl.uniform1f(runLocations.uniforms.uDPR!, viewport.dpr);
      gl.uniform1f(runLocations.uniforms.uT!, currentHour);
      gl.uniform1f(runLocations.uniforms.uMotion!, options.reducedMotion ? 0 : 1);
      gl.uniform1f(runLocations.uniforms.uHov!, hoveredAgent);
      gl.bindBuffer(gl.ARRAY_BUFFER, runBuffer);
      ['aA', 'aB', 'aC', 'aT0', 'aT1', 'aM'].forEach((name, index) => {
        const location = runLocations.attributes[name];
        if (location === undefined) return;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(
          location,
          4,
          gl.FLOAT,
          false,
          ATTRIBUTE_STRIDE,
          index * 4 * Float32Array.BYTES_PER_ELEMENT,
        );
      });
      const trailOffsets = options.reducedMotion ? [0] : [0.18, 0.135, 0.09, 0.045, 0];
      for (const trailOffset of trailOffsets) {
        gl.uniform1f(runLocations.uniforms.uOff!, trailOffset);
        gl.drawArrays(gl.POINTS, 0, options.fixture.runs.length);
      }

      reportFrame(timestamp, !playing);
    };

    loop = createVisualLoop({
      canvas,
      render,
      onResize: (viewport) => gl.viewport(0, 0, viewport.pixelWidth, viewport.pixelHeight),
      initiallyAnimating: playing,
    });
    reportFrame(performance.now(), true);

    return {
      seek(hour) {
        currentHour = Math.min(24, Math.max(0, hour));
        playing = false;
        previousTimestamp = null;
        loop?.setAnimating(false);
        loop?.requestRender();
        reportFrame(performance.now(), true);
      },
      setPlaying(nextPlaying) {
        if (nextPlaying && currentHour >= 24) currentHour = REPLAY_START_HOUR;
        playing = nextPlaying && !options.reducedMotion;
        previousTimestamp = null;
        loop?.setAnimating(playing);
        loop?.requestRender();
        reportFrame(performance.now(), true);
      },
      setHoveredAgent(agentIndex) {
        hoveredAgent = agentIndex ?? -1;
        loop?.requestRender();
      },
      destroy() {
        loop?.destroy();
        loop = null;
        for (const buffer of buffers) gl.deleteBuffer(buffer);
        for (const program of programs) gl.deleteProgram(program);
      },
    };
  } catch (error) {
    loop?.destroy();
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    for (const program of programs) gl.deleteProgram(program);
    throw error;
  }
}
