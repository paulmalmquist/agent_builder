import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signalWallFixture } from './fixtures';
import { SignalWallPage } from './SignalWallPage';
import { SIGNAL_GROUPS } from './types';
import type { SignalWallScene, SignalWallSceneOptions, SignalWallSceneSnapshot } from './types';

function mediaQuery(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
}

function mutableMediaQuery(initialMatches: boolean): {
  readonly query: MediaQueryList;
  setMatches(matches: boolean): void;
} {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    get matches() {
      return matches;
    },
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        listeners.add(listener);
      }
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      if (typeof listener === 'function') {
        listeners.delete(listener);
      }
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MediaQueryList;
  return {
    query,
    setMatches(nextMatches) {
      matches = nextMatches;
      const event = { matches, media: query.media } as MediaQueryListEvent;
      listeners.forEach((listener) => listener(event));
    },
  };
}

function semanticSnapshot(sampleIndex = 31): SignalWallSceneSnapshot {
  const representativeIds = SIGNAL_GROUPS.map(
    (group) => signalWallFixture.signals.find((signal) => signal.group === group)?.id,
  ).filter((id): id is string => Boolean(id));
  const topSignalIds = signalWallFixture.signals.slice(0, 3).map((signal) => signal.id);
  const visibleIds = [...new Set([...topSignalIds, ...representativeIds])];
  return {
    sampleIndex,
    sampleCount: signalWallFixture.sampleCount,
    isLatest: sampleIndex === signalWallFixture.sampleCount - 1,
    elapsedHours:
      (sampleIndex / (signalWallFixture.sampleCount - 1)) * signalWallFixture.historyHours,
    orderedSignalIds: signalWallFixture.signals.map((signal) => signal.id),
    topSignalIds,
    visibleRows: visibleIds.map((signalId, index) => ({
      signalId,
      order: index,
      top: 190 + index * 56,
      height: 55,
      representative: representativeIds.includes(signalId),
    })),
    groups: SIGNAL_GROUPS.map((group, index) => ({
      group,
      top: 190 + index * 100,
      height: 96,
      signalCount: signalWallFixture.signals.filter((signal) => signal.group === group).length,
    })),
    signals: signalWallFixture.signals.map((signal, index) => ({
      signalId: signal.id,
      deviation: index === 0 ? 0.82 : 0.1,
      anomaly: index === 0 ? 0.82 : 0.1,
      valueLabel: index === 0 ? '0.82 above usual' : '0.10 above usual',
      detail: index === 0 ? 'Fixture replay moved outside its usual range.' : 'Usual range',
      status: index === 0 ? ('needs-review' as const) : ('quiet' as const),
    })),
    summary: { needsReview: 1, watch: 0, quiet: signalWallFixture.signals.length - 1 },
  };
}

describe('SignalWallPage', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery(false));
  });

  it('renders a complete, explicitly synthetic flat fallback without WebGL', async () => {
    const unavailableFactory = vi.fn(
      (_canvas: HTMLCanvasElement, options: SignalWallSceneOptions): null => {
        options.onUnavailable();
        return null;
      },
    );

    render(
      <MemoryRouter>
        <SignalWallPage createScene={unavailableFactory} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'What needs a look in this fixture replay' }),
    ).toBeVisible();
    expect(screen.getByText('FIXTURE DATA')).toBeVisible();
    const flat = screen.getByTestId('signal-wall-flat');
    expect(within(flat).getByText(/WebGL is unavailable here/)).toBeVisible();
    expect(within(flat).getByText('web · error rate')).toBeVisible();
    expect(within(flat).getAllByRole('listitem')).toHaveLength(15);
    expect(flat.closest('.signal-wall-hud')).toBeNull();
    expect(flat).toHaveAttribute('tabindex', '0');
  });

  it('falls back when scene initialization throws after WebGL is acquired', async () => {
    const throwingFactory = vi.fn((): SignalWallScene | null => {
      throw new Error('uniform lookup failed');
    });

    render(
      <MemoryRouter>
        <SignalWallPage createScene={throwingFactory} />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: 'What needs a look in this fixture replay' }),
    ).toBeVisible();
    expect(screen.getByText(/WebGL is unavailable here/)).toBeVisible();
  });

  it('sends sort and replay controls to the scene without mutating platform state', () => {
    const setMode = vi.fn();
    const setReplaying = vi.fn();
    const destroy = vi.fn();
    const scene: SignalWallScene = {
      setMode,
      setReplaying,
      destroy,
    };
    const factory = vi.fn((_canvas: HTMLCanvasElement, options: SignalWallSceneOptions) => {
      options.onRankingChange?.(signalWallFixture.signals.slice(0, 3).map((signal) => signal.id));
      return scene;
    });

    const { unmount } = render(
      <MemoryRouter>
        <SignalWallPage createScene={factory} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'SORT · GROUPED' }));
    expect(setMode).toHaveBeenCalledWith('grouped');
    expect(screen.getByRole('button', { name: 'SORT · GROUPED' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'REPLAYING' }));
    expect(setReplaying).toHaveBeenCalledWith(false);
    expect(screen.getByRole('button', { name: 'PAUSED' })).toHaveAttribute('aria-pressed', 'false');

    unmount();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('keeps DOM labels, summary, groups, and the accessible index aligned to scene snapshots', () => {
    const snapshot = semanticSnapshot();
    const scene: SignalWallScene = {
      setMode: vi.fn(),
      setReplaying: vi.fn(),
      destroy: vi.fn(),
    };
    const factory = vi.fn((_canvas: HTMLCanvasElement, options: SignalWallSceneOptions) => {
      options.onSnapshot?.(snapshot);
      return scene;
    });

    const { container } = render(
      <MemoryRouter>
        <SignalWallPage createScene={factory} />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Replay position')).toHaveTextContent('SAMPLE 32 / 512');
    expect(container.querySelector('.signal-wall-row-value')).toHaveTextContent('0.82 above usual');
    expect(screen.getByLabelText('Signal summary')).toHaveTextContent('needs a look 1');

    fireEvent.click(screen.getByRole('button', { name: 'SORT · GROUPED' }));
    SIGNAL_GROUPS.forEach((group) => {
      expect(container.querySelector(`[data-signal-group="${group}"]`)).toHaveTextContent(group);
      const representative = signalWallFixture.signals.find((signal) => signal.group === group);
      expect(
        container.querySelector(`[data-signal-id="${representative?.id ?? ''}"]`),
      ).toHaveTextContent(representative?.label ?? 'missing representative');
    });

    const index = screen.getByRole('region', { name: 'All signal wall signals' });
    expect(within(index).getAllByRole('listitem')).toHaveLength(signalWallFixture.signals.length);
  });

  it('paints a final state once and disables autoplay for reduced motion', async () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery(true));
    const scene: SignalWallScene = {
      setMode: vi.fn(),
      setReplaying: vi.fn(),
      destroy: vi.fn(),
    };
    let receivedOptions: SignalWallSceneOptions | null = null;

    render(
      <MemoryRouter>
        <SignalWallPage
          createScene={(_canvas, options) => {
            receivedOptions = options;
            return scene;
          }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(receivedOptions).not.toBeNull());
    expect(receivedOptions).toMatchObject({ reducedMotion: true, replaying: false });
    expect(screen.getByRole('button', { name: 'MOTION OFF' })).toBeDisabled();
  });

  it('stops replay and rebuilds at the final frame when reduced motion changes', async () => {
    const preference = mutableMediaQuery(false);
    vi.spyOn(window, 'matchMedia').mockReturnValue(preference.query);
    const setReplaying = vi.fn();
    const destroy = vi.fn();
    const receivedOptions: SignalWallSceneOptions[] = [];

    render(
      <MemoryRouter>
        <SignalWallPage
          createScene={(_canvas, options) => {
            receivedOptions.push(options);
            options.onSnapshot?.(semanticSnapshot(signalWallFixture.sampleCount - 1));
            return { setMode: vi.fn(), setReplaying, destroy };
          }}
        />
      </MemoryRouter>,
    );

    act(() => preference.setMatches(true));

    await waitFor(() => expect(screen.getByRole('button', { name: 'MOTION OFF' })).toBeDisabled());
    expect(destroy).toHaveBeenCalled();
    expect(receivedOptions.at(-1)).toMatchObject({ reducedMotion: true, replaying: false });
    expect(screen.getByLabelText('Replay position')).toHaveTextContent('NOW');
  });

  it('keeps the deterministic wall fixture above one hundred signals', () => {
    expect(signalWallFixture.signals.length).toBeGreaterThan(100);
    expect(signalWallFixture.signals[0]?.history).toHaveLength(signalWallFixture.sampleCount);
    expect(signalWallFixture.isFixture).toBe(true);
  });
});
