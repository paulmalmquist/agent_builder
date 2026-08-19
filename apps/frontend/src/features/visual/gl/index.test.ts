import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProgram,
  createVisualLoop,
  createWebGLContext,
  MAX_VISUAL_DPR,
  type VisualWebGLContext,
} from './index';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('visual WebGL plumbing', () => {
  it('tries WebGL2 first and falls back to WebGL', () => {
    const legacyContext = {} as WebGLRenderingContext;
    const canvas = document.createElement('canvas');
    const getContext = vi
      .spyOn(canvas, 'getContext')
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(legacyContext);

    expect(createWebGLContext(canvas)).toBe(legacyContext);
    expect(getContext.mock.calls[0]?.[0]).toBe('webgl2');
    expect(getContext.mock.calls[1]?.[0]).toBe('webgl');
  });

  it('surfaces shader compiler details and frees the rejected shader', () => {
    const shader = {} as WebGLShader;
    const deleteShader = vi.fn();
    const gl = {
      COMPILE_STATUS: 35_713,
      FRAGMENT_SHADER: 35_632,
      VERTEX_SHADER: 35_633,
      compileShader: vi.fn(),
      createShader: vi.fn(() => shader),
      deleteShader,
      getShaderInfoLog: vi.fn(() => 'fixture compiler detail'),
      getShaderParameter: vi.fn(() => false),
      shaderSource: vi.fn(),
    } as unknown as VisualWebGLContext;

    expect(() => createProgram(gl, 'bad vertex', 'fragment', 'Fixture scene')).toThrow(
      'Fixture scene vertex: shader compilation failed. fixture compiler detail',
    );
    expect(deleteShader).toHaveBeenCalledWith(shader);
  });

  it('caps DPR, paints on demand, pauses while hidden, and removes its listeners', () => {
    const canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
      bottom: 50,
      height: 50,
      left: 0,
      right: 100,
      toJSON: () => ({}),
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    });
    vi.stubGlobal('devicePixelRatio', 4);
    const scheduledFrames: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return 17;
    });
    const cancelAnimationFrame = vi.fn();
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    const removeWindowListener = vi.spyOn(window, 'removeEventListener');
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener');
    const render = vi.fn();
    const controller = createVisualLoop({ canvas, render });

    expect(MAX_VISUAL_DPR).toBe(2);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    const scheduledFrame = scheduledFrames[0];
    if (scheduledFrame === undefined) {
      throw new Error('The visual loop did not schedule its first paint.');
    }
    scheduledFrame(10);
    expect(render).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    controller.setAnimating(false);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    controller.requestRender();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    controller.requestRender();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(3);
    controller.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(removeWindowListener).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
