import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const scene = vi.hoisted(() => ({
  create: vi.fn(),
  destroy: vi.fn(),
  seek: vi.fn(),
  setHoveredAgent: vi.fn(),
  setPlaying: vi.fn(),
}));

vi.mock('../../../api/hooks', () => ({
  useExecutionRuns: () => ({ data: { items: [], total: 0 }, isError: false, isLoading: false }),
}));

vi.mock('./observatory-scene', () => ({
  createObservatoryScene: scene.create,
}));

import { ObservatoryPage } from './ObservatoryPage';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ObservatoryPage WebGL lifecycle', () => {
  it('destroys the scene controller when the route unmounts', async () => {
    scene.create.mockReturnValue({
      destroy: scene.destroy,
      seek: scene.seek,
      setHoveredAgent: scene.setHoveredAgent,
      setPlaying: scene.setPlaying,
    });
    vi.stubGlobal('navigator', { userAgent: 'visual-surface-test' });

    const view = render(
      <MemoryRouter>
        <ObservatoryPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(scene.create).toHaveBeenCalledOnce());
    view.unmount();
    expect(scene.destroy).toHaveBeenCalledOnce();
  });

  it('pauses the scene before seeking when the operator scrubs time', async () => {
    scene.create.mockReturnValue({
      destroy: scene.destroy,
      seek: scene.seek,
      setHoveredAgent: scene.setHoveredAgent,
      setPlaying: scene.setPlaying,
    });
    vi.stubGlobal('navigator', { userAgent: 'visual-surface-test' });

    render(
      <MemoryRouter>
        <ObservatoryPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(scene.create).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole('slider', { name: 'Time in the fixture day' }), {
      target: { value: '12' },
    });

    expect(scene.setPlaying).toHaveBeenCalledWith(false);
    expect(scene.seek).toHaveBeenCalledWith(12);
    expect(scene.setPlaying.mock.invocationCallOrder[0]).toBeLessThan(
      scene.seek.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it('prevents context loss, destroys once, shows the flat view, and removes its listener', async () => {
    const addListener = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    const removeListener = vi.spyOn(HTMLCanvasElement.prototype, 'removeEventListener');
    scene.create.mockReturnValue({
      destroy: scene.destroy,
      seek: scene.seek,
      setHoveredAgent: scene.setHoveredAgent,
      setPlaying: scene.setPlaying,
    });
    vi.stubGlobal('navigator', { userAgent: 'visual-surface-test' });

    const view = render(
      <MemoryRouter>
        <ObservatoryPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(scene.create).toHaveBeenCalledOnce());
    const canvas = view.container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    const contextListener = addListener.mock.calls.find(
      ([eventName]) => eventName === 'webglcontextlost',
    )?.[1];
    expect(contextListener).toBeDefined();

    const contextLost = new Event('webglcontextlost', { cancelable: true });
    fireEvent(canvas!, contextLost);

    expect(contextLost.defaultPrevented).toBe(true);
    expect(scene.destroy).toHaveBeenCalledOnce();
    expect(await screen.findByTestId('observatory-flat-fallback')).toBeInTheDocument();

    view.unmount();
    expect(removeListener).toHaveBeenCalledWith('webglcontextlost', contextListener);
    expect(scene.destroy).toHaveBeenCalledOnce();
  });

  it('removes the context-loss listener when WebGL is unavailable during initialization', async () => {
    const addListener = vi.spyOn(HTMLCanvasElement.prototype, 'addEventListener');
    const removeListener = vi.spyOn(HTMLCanvasElement.prototype, 'removeEventListener');
    scene.create.mockReturnValue(null);
    vi.stubGlobal('navigator', { userAgent: 'visual-surface-test' });

    const view = render(
      <MemoryRouter>
        <ObservatoryPage />
      </MemoryRouter>,
    );

    await screen.findByTestId('observatory-flat-fallback');
    const contextListener = addListener.mock.calls.find(
      ([eventName]) => eventName === 'webglcontextlost',
    )?.[1];
    expect(contextListener).toBeDefined();

    view.unmount();
    expect(removeListener).toHaveBeenCalledWith('webglcontextlost', contextListener);
    expect(scene.destroy).not.toHaveBeenCalled();
  });
});
