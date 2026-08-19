import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryTerrain } from './HistoryTerrain';
import { createHistoryTerrainFixture, historyTerrainFixture } from './history-terrain-fixture';
import { validateHistoryTerrainInput } from './history-terrain-model';
import type {
  HistoryTerrainSceneController,
  HistoryTerrainSceneFactory,
} from './history-terrain-scene';
import type { HistoryTerrainInput } from './history-terrain-types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function reducedMotionMatchMedia(query: string): MediaQueryList {
  return {
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
}

function fakeScene() {
  const setCursor = vi.fn();
  const requestRender = vi.fn();
  const destroy = vi.fn();
  const controller: HistoryTerrainSceneController = {
    setCursor,
    requestRender,
    destroy,
  };
  const factory = vi.fn<HistoryTerrainSceneFactory>(() => controller);
  return { controller, destroy, factory, requestRender, setCursor };
}

describe('HistoryTerrain', () => {
  it('renders the complete deterministic flat view when WebGL is unavailable', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { container } = render(<HistoryTerrain />);

    expect(
      screen.getByRole('heading', { level: 1, name: /last six months, as terrain/i }),
    ).toBeVisible();
    expect(screen.getByText('FIXTURE DATA')).toBeVisible();
    expect(screen.getByText('WebGL is unavailable in this environment.')).toBeVisible();
    expect(screen.getAllByRole('article')).toHaveLength(9);
    expect(screen.getByRole('heading', { level: 3, name: 'Factory operations' })).toBeVisible();
    expect(screen.getByText(/Integration review slipped to week 19/)).toBeVisible();
    expect(screen.getByText(/Registry freeze slipped one week/)).toBeVisible();
    expect(screen.getByRole('slider', { name: 'History week' })).toHaveAttribute(
      'aria-valuetext',
      'Week of AUG 24, 2026',
    );
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('scrubs the same flat data and explains the selected starvation period', () => {
    render(<HistoryTerrain />);
    const scrubber = screen.getByRole('slider', { name: 'History week' });

    fireEvent.input(scrubber, { target: { value: '6' } });

    expect(scrubber).toHaveAttribute('aria-valuetext', 'Week of APR 13, 2026');
    expect(screen.getByText(/Evaluations goes quiet/)).toBeVisible();
    const evaluations = screen
      .getByRole('heading', { level: 3, name: 'Evaluations' })
      .closest('article');
    if (!evaluations) throw new Error('Expected the Evaluations flat row');
    expect(within(evaluations).getByText(/below the starvation threshold/)).toBeVisible();
  });

  it('paints the final WebGL state once and disables autoplay for reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn(reducedMotionMatchMedia));
    const { destroy, factory, requestRender, setCursor } = fakeScene();
    const rendered = render(<HistoryTerrain sceneFactory={factory} />);

    await waitFor(() => expect(factory).toHaveBeenCalledOnce());
    const options = factory.mock.calls[0]?.[0];
    expect(options?.initialCursor).toBe(25.5);
    expect(screen.getByRole('button', { name: 'FINAL STATE · REDUCED MOTION' })).toBeDisabled();
    expect(requestRender).toHaveBeenCalledOnce();
    expect(setCursor).not.toHaveBeenCalled();

    rendered.unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('sends explicit scrubs to WebGL and releases the scene on unmount', async () => {
    const { destroy, factory, setCursor } = fakeScene();
    const rendered = render(<HistoryTerrain autoPlay={false} sceneFactory={factory} />);
    await waitFor(() => expect(factory).toHaveBeenCalledOnce());

    fireEvent.input(screen.getByRole('slider', { name: 'History week' }), {
      target: { value: '13' },
    });

    expect(setCursor).toHaveBeenLastCalledWith(13);
    expect(screen.getByText(/The review jam/)).toBeVisible();
    rendered.unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('fails closed when weekly arrays cannot support the declared time axis', () => {
    const firstStream = historyTerrainFixture.streams[0];
    if (!firstStream) throw new Error('Expected the fixture to contain a workstream');
    const invalidInput: HistoryTerrainInput = {
      ...historyTerrainFixture,
      streams: [{ ...firstStream, actual: [0.1] }, ...historyTerrainFixture.streams.slice(1)],
    };

    const { container } = render(<HistoryTerrain data={invalidInput} />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'History terrain cannot render this input safely.',
    );
    expect(screen.getByText(/actual must contain one value per week/)).toBeVisible();
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

describe('history terrain fixture', () => {
  it('is deterministic, typed, and valid without a runtime request', () => {
    const first = createHistoryTerrainFixture();
    const second = createHistoryTerrainFixture();

    expect(first).toEqual(second);
    expect(first.provenance).toEqual({ kind: 'fixture', label: 'FIXTURE DATA' });
    expect(first.weeks).toHaveLength(26);
    expect(first.streams).toHaveLength(9);
    const validation = validateHistoryTerrainInput(first);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;
    expect(validation.model.statistics.longestStarvation.streamLabel).toBe('Evaluations');
    expect(validation.model.statistics.longestStarvation.weeks).toBeGreaterThanOrEqual(7);
  });
});
