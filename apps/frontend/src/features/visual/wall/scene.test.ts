import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VisualLoopOptions, VisualViewport } from '../gl';

const glFactoryMocks = vi.hoisted(() => ({
  createProgram: vi.fn(),
  createVisualLoop: vi.fn(),
  createWebGLContext: vi.fn(),
}));

vi.mock('../gl', () => glFactoryMocks);

import { signalWallFixture } from './fixtures';
import { createSignalWallScene } from './scene';
import { SIGNAL_GROUPS } from './types';
import type { SignalWallSceneSnapshot } from './types';

function fakeGl() {
  const program = {} as WebGLProgram;
  const buffer = {} as WebGLBuffer;
  const texture = {} as WebGLTexture;
  const uniform = {} as WebGLUniformLocation;
  const deleteBuffer = vi.fn();
  const deleteTexture = vi.fn();
  const deleteProgram = vi.fn();
  const getUniformLocation = vi.fn((): WebGLUniformLocation | null => uniform);
  const gl = {
    ARRAY_BUFFER: 1,
    STATIC_DRAW: 2,
    TEXTURE_2D: 3,
    RGBA: 4,
    UNSIGNED_BYTE: 5,
    TEXTURE_MIN_FILTER: 6,
    TEXTURE_MAG_FILTER: 7,
    TEXTURE_WRAP_S: 8,
    TEXTURE_WRAP_T: 9,
    NEAREST: 10,
    CLAMP_TO_EDGE: 11,
    BLEND: 12,
    ONE: 13,
    COLOR_BUFFER_BIT: 14,
    FLOAT: 15,
    TRIANGLES: 16,
    createBuffer: vi.fn(() => buffer),
    createTexture: vi.fn(() => texture),
    deleteBuffer,
    deleteTexture,
    deleteProgram,
    getAttribLocation: vi.fn(() => 0),
    getUniformLocation,
    bindBuffer: vi.fn(),
    bufferData: vi.fn(),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    clearColor: vi.fn(),
    enable: vi.fn(),
    blendFunc: vi.fn(),
    viewport: vi.fn(),
    clear: vi.fn(),
    useProgram: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    vertexAttribPointer: vi.fn(),
    uniform1f: vi.fn(),
    uniform4f: vi.fn(),
    drawArrays: vi.fn(),
  } as unknown as WebGLRenderingContext;
  return {
    gl,
    program,
    buffer,
    texture,
    deleteBuffer,
    deleteTexture,
    deleteProgram,
    getUniformLocation,
  };
}

const viewport: VisualViewport = {
  cssWidth: 1_280,
  cssHeight: 900,
  pixelWidth: 1_280,
  pixelHeight: 900,
  dpr: 1,
};

describe('createSignalWallScene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases every allocated GPU object when initialization fails after program creation', () => {
    const {
      gl,
      program,
      buffer,
      texture,
      deleteBuffer,
      deleteTexture,
      deleteProgram,
      getUniformLocation,
    } = fakeGl();
    getUniformLocation.mockReturnValue(null);
    glFactoryMocks.createWebGLContext.mockReturnValue(gl);
    glFactoryMocks.createProgram.mockReturnValue(program);
    const onUnavailable = vi.fn();

    const scene = createSignalWallScene(document.createElement('canvas'), {
      input: signalWallFixture,
      mode: 'attention',
      replaying: false,
      reducedMotion: false,
      onUnavailable,
    });

    expect(scene).toBeNull();
    expect(onUnavailable).toHaveBeenCalledOnce();
    expect(deleteTexture).toHaveBeenCalledWith(texture);
    expect(deleteBuffer).toHaveBeenCalledWith(buffer);
    expect(deleteProgram).toHaveBeenCalledWith(program);
    expect(glFactoryMocks.createVisualLoop).not.toHaveBeenCalled();
  });

  it('publishes all group positions and advances head-derived values with replay', () => {
    const { gl, program } = fakeGl();
    const loopHarness: { options?: VisualLoopOptions } = {};
    glFactoryMocks.createWebGLContext.mockReturnValue(gl);
    glFactoryMocks.createProgram.mockReturnValue(program);
    glFactoryMocks.createVisualLoop.mockImplementation((options: VisualLoopOptions) => {
      loopHarness.options = options;
      return {
        viewport,
        requestRender: vi.fn(),
        setAnimating: vi.fn(),
        resize: vi.fn(),
        destroy: vi.fn(),
      };
    });
    const snapshots: SignalWallSceneSnapshot[] = [];

    const scene = createSignalWallScene(document.createElement('canvas'), {
      input: signalWallFixture,
      mode: 'attention',
      replaying: false,
      reducedMotion: false,
      onUnavailable: vi.fn(),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
    });

    expect(scene).not.toBeNull();
    expect(snapshots.at(-1)?.sampleIndex).toBe(signalWallFixture.sampleCount - 1);

    scene?.setMode('grouped');
    const groupedFrame = performance.now() + 500;
    loopHarness.options?.render(groupedFrame, viewport);
    expect(snapshots.at(-1)?.groups.map((group) => group.group)).toEqual(SIGNAL_GROUPS);
    const representativeGroups = new Set(
      snapshots
        .at(-1)
        ?.visibleRows.filter((row) => row.representative)
        .map(
          (row) => signalWallFixture.signals.find((signal) => signal.id === row.signalId)?.group,
        ),
    );
    expect(representativeGroups).toEqual(new Set(SIGNAL_GROUPS));

    scene?.setReplaying(true);
    loopHarness.options?.render(groupedFrame + 800, viewport);
    const replaySnapshot = snapshots.at(-1);
    expect(replaySnapshot?.sampleIndex).toBe(0);
    expect(replaySnapshot?.signals[0]?.valueLabel).toMatch(/usual/);
    expect(replaySnapshot?.signals[0]?.valueLabel).not.toBe(
      signalWallFixture.signals[0]?.currentLabel,
    );

    scene?.destroy();
  });
});
