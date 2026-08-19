import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObservatoryPage } from './ObservatoryPage';

const executionRuns = vi.hoisted(() => ({
  result: {
    data: {
      items: [
        {
          id: '00000000-0000-4000-8000-000000000901',
          createdAt: '2026-08-18T11:15:00.000Z',
          entrySubject: { name: 'Cost sentinel' },
          state: 'succeeded',
        },
      ],
      total: 1,
    },
    isError: false,
    isLoading: false,
  },
}));

vi.mock('../../../api/hooks', () => ({
  useExecutionRuns: () => executionRuns.result,
}));

afterEach(() => {
  cleanup();
  executionRuns.result.isError = false;
  executionRuns.result.isLoading = false;
  executionRuns.result.data.items = [
    {
      id: '00000000-0000-4000-8000-000000000901',
      createdAt: '2026-08-18T11:15:00.000Z',
      entrySubject: { name: 'Cost sentinel' },
      state: 'succeeded',
    },
  ];
  executionRuns.result.data.total = 1;
  vi.unstubAllGlobals();
});

describe('ObservatoryPage', () => {
  it('renders the complete flat fallback and keeps fixture provenance explicit without WebGL', async () => {
    render(
      <MemoryRouter>
        <ObservatoryPage />
      </MemoryRouter>,
    );

    expect(screen.getByText('FIXTURE DATA')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'One day through the factory' }),
    ).toBeInTheDocument();
    expect(await screen.findByTestId('observatory-flat-fallback')).toBeInTheDocument();
    expect(screen.getByText('The same fixture, without WebGL')).toBeInTheDocument();
    expect(
      screen.getByText(/LEDGER TIMING ONLY · LATEST PAGE · SHOWING 1 OF 1 LEDGER RUN/u),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2026-08-18 UTC · 1 MARKER FROM THIS PAGE · SUCCEEDED 1/u),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /return to runs/iu })).toHaveAttribute(
      'href',
      '/operate#operate-runs',
    );
  });

  it('updates the displayed clock when the flat-view scrubber changes', async () => {
    render(
      <MemoryRouter>
        <ObservatoryPage />
      </MemoryRouter>,
    );
    await screen.findByTestId('observatory-flat-fallback');

    fireEvent.change(screen.getByRole('slider', { name: 'Time in the fixture day' }), {
      target: { value: '12.5' },
    });

    expect(screen.getByText('12:30')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'RESUME' })).toBeDisabled();
  });

  it('discloses an unavailable live ledger overlay without relabeling fixture particles', async () => {
    executionRuns.result.isError = true;
    render(
      <MemoryRouter>
        <ObservatoryPage />
      </MemoryRouter>,
    );

    await screen.findByTestId('observatory-flat-fallback');
    expect(screen.getByText('LEDGER TIMING OVERLAY · UNAVAILABLE')).toBeInTheDocument();
    expect(screen.getByText('FIXTURE DATA')).toBeInTheDocument();
  });

  it('labels a capped ledger response as the latest page instead of a complete daily count', async () => {
    executionRuns.result.data.items = Array.from({ length: 50 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(902 + index).padStart(12, '0')}`,
      createdAt: `2026-08-18T11:${String(index).padStart(2, '0')}:00.000Z`,
      entrySubject: { name: `Ledger run ${index + 1}` },
      state: 'succeeded',
    }));
    executionRuns.result.data.total = 73;

    render(
      <MemoryRouter>
        <ObservatoryPage />
      </MemoryRouter>,
    );

    await screen.findByTestId('observatory-flat-fallback');
    expect(
      screen.getByText(
        'LEDGER TIMING ONLY · LATEST PAGE · SHOWING 50 OF 73 LEDGER RUNS · CAPPED AT 50',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2026-08-18 UTC · 50 MARKERS FROM THIS PAGE · SUCCEEDED 50/u),
    ).toBeInTheDocument();
    expect(screen.queryByText(/50 RECORDED RUNS/u)).not.toBeInTheDocument();
  });

  it('starts paused at a painted end-state when reduced motion is requested', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(
        (query: string): MediaQueryList => ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(() => true),
        }),
      ),
    );

    render(
      <MemoryRouter>
        <ObservatoryPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('23:30')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'RESUME' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'RESUME' })).toHaveAttribute(
      'title',
      'Playback is disabled by your reduced-motion preference.',
    );
  });
});
