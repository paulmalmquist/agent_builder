import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttentionPage } from './AttentionPage';
import { ApiError, platformApi } from '../../api/client';
import { renderWithClient } from '../../test/render';
import { server } from '../../test/server';

describe('AttentionPage', () => {
  it('renders verdict-first shelves and opens governed keyboard actions', async () => {
    const user = userEvent.setup();
    renderWithClient(<AttentionPage />);

    expect(
      await screen.findByRole('heading', {
        name: 'Daily Briefing is ready for its first approved run',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Decide 01/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Degraded 01/i })).toBeInTheDocument();
    expect(screen.getByText('34 runs · $2.10 · 2 promotions this week')).toBeInTheDocument();
    expect(screen.getByText('Daily Briefing · immutable production digest')).toBeInTheDocument();
    expect(screen.getByText('About $0.40 per run · $0.50 maximum')).toBeInTheDocument();

    await user.keyboard('r');
    const rejection = await screen.findByRole('dialog');
    expect(within(rejection).getByRole('heading', { name: 'Reject request' })).toBeInTheDocument();
    expect(within(rejection).getByText(/What happens/i)).toBeInTheDocument();
    expect(within(rejection).getByText(/Undo/i)).toBeInTheDocument();

    const rationale = within(rejection).getByLabelText('Decision rationale');
    await user.type(rationale, 'This release needs a narrower calendar scope.');
    await user.keyboard('r');
    expect(rationale).toHaveValue('This release needs a narrower calendar scope.r');
    await user.click(within(rejection).getByRole('button', { name: 'Reject request' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', {
          name: 'Daily Briefing is ready for its first approved run',
        }),
      ).not.toBeInTheDocument();
    });
  });

  it('records a rationale before clearing a resolved degraded item', async () => {
    const user = userEvent.setup();
    renderWithClient(<AttentionPage />);

    const acknowledge = await screen.findByRole('button', { name: 'Acknowledge failure' });
    await user.click(acknowledge);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Failed after the final retry')).toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText('Decision rationale'),
      'Terminal failure reviewed and no retry is required.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Acknowledge failure' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Degraded 01/i })).not.toBeInTheDocument();
    });
  });

  it('opens L3 provenance and flight-recorder detail with E', async () => {
    const user = userEvent.setup();
    renderWithClient(<AttentionPage />);

    await screen.findByRole('heading', {
      name: 'Daily Briefing is ready for its first approved run',
    });
    await user.keyboard('e');

    const detail = await screen.findByRole('dialog');
    expect(within(detail).getByText('WHY YOU ARE SEEING THIS')).toBeInTheDocument();
    expect(within(detail).getByRole('region', { name: 'Flight recorder' })).toBeInTheDocument();
    expect(within(detail).getByText('authority-check')).toBeInTheDocument();
  });

  it('shows the quiet goal state when no item needs review', async () => {
    server.use(
      http.get('http://localhost/v1/attention', () =>
        HttpResponse.json({
          generatedAt: '2026-07-31T14:00:00.000Z',
          decide: [],
          degraded: [],
          digest: {
            headline: 'No new platform activity',
            runCount: 0,
            totalCostUsd: 0,
            promotionCount: 0,
            observationCount: 0,
            windowStartedAt: null,
            windowEndedAt: '2026-07-31T14:00:00.000Z',
          },
          decideBadgeCount: 0,
          lastDeliveredBriefingAt: '2026-07-31T11:00:00.000Z',
        }),
      ),
    );
    renderWithClient(<AttentionPage />);

    expect(await screen.findByRole('heading', { name: 'All quiet' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing needs a decision/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Next briefing digest' })).not.toBeInTheDocument();
  });

  it('never reports a quiet system when the governance queue is unavailable', async () => {
    server.use(
      http.get('http://localhost/v1/attention', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'The operational ledger is unavailable.',
              requestId: 'test-request',
            },
          },
          { status: 503 },
        ),
      ),
    );
    renderWithClient(<AttentionPage />);

    expect(await screen.findByText('The operational ledger is unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'All quiet' })).not.toBeInTheDocument();
  });

  it('suppresses cached actions after a background refresh fails until retry succeeds', async () => {
    const user = userEvent.setup();
    const { client } = renderWithClient(<AttentionPage />);

    expect(
      await screen.findByRole('heading', {
        name: 'Daily Briefing is ready for its first approved run',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and approve' })).toBeInTheDocument();

    server.use(
      http.get('http://localhost/v1/attention', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'The operational ledger is unavailable.',
              requestId: 'background-refresh-request',
            },
          },
          { status: 503 },
        ),
      ),
    );
    await client.refetchQueries({ queryKey: ['attention'] });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The operational ledger is unavailable.',
    );
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review and approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'All quiet' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Next briefing digest' })).not.toBeInTheDocument();

    server.resetHandlers();
    await user.click(screen.getByRole('button', { name: 'Retry loading' }));

    expect(
      await screen.findByRole('heading', {
        name: 'Daily Briefing is ready for its first approved run',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('leaves the loading state and offers a read-only retry when the request times out', async () => {
    const user = userEvent.setup();
    const getAttention = vi.spyOn(platformApi, 'getAttention').mockRejectedValue(
      new ApiError('The review queue took too long to respond.', {
        code: 'REQUEST_TIMEOUT',
        status: 408,
      }),
    );

    try {
      renderWithClient(<AttentionPage />);

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The review queue took too long to respond.',
      );
      expect(screen.queryByText('Loading review queue…')).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Retry loading' }));
      await waitFor(() => expect(getAttention).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('heading', { name: 'All quiet' })).not.toBeInTheDocument();
    } finally {
      getAttention.mockRestore();
    }
  });
});
