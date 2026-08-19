import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AttentionPage } from './AttentionPage';
import { ApiError, platformApi } from '../../api/client';
import { renderWithClient } from '../../test/render';
import { attentionApprovalGroupKey, executionRunId, server } from '../../test/server';

const approvalHeading = 'Daily Briefing wants authority for 4 runs.';
const coldReadId = '91919191-9191-4191-8191-919191919191';
const coldReadDigest = 'c'.repeat(64);
const coldReadSubject = { name: 'Warehouse Cost Sentinel', kind: 'agent', version: '2.1.0' };

function coldReadAction(
  kind:
    | 'promote_release'
    | 'decline_release'
    | 'accept_memory'
    | 'reject_memory'
    | 'incubate_candidate'
    | 'reject_candidate'
    | 'open_details'
    | 'resolve_item',
  label: string,
  consequence: string,
) {
  return {
    kind,
    label,
    consequence,
    undo: 'A later governed action can change the resulting state.',
    resourceId: coldReadId,
    requiresRationale: kind !== 'open_details',
  };
}

function coldReadPayload(overrides: Record<string, unknown> = {}) {
  return {
    sourceType: 'ColdReadFixture',
    sourceId: coldReadId,
    detailPath: `/v1/attention-items/${coldReadId}`,
    scopes: [],
    runId: null,
    candidateId: null,
    channelKey: null,
    releaseId: null,
    evaluationId: null,
    expiresAt: null,
    approvalGroupKey: null,
    requestCount: 1,
    subject: coldReadSubject,
    reviewFacts: [
      { label: 'Immutable digest', value: coldReadDigest },
      { label: 'Requester', value: 'worker-test' },
    ],
    metadata: { rawDigest: coldReadDigest, rawActor: 'worker-test' },
    ...overrides,
  };
}

function crossKindAttentionItems() {
  const base = {
    status: 'decide' as const,
    shelf: 'decide' as const,
    cost: null,
    provenance: {
      sourceType: 'ColdReadFixture',
      sourceId: coldReadId,
      actorId: 'worker-test',
      requestId: coldReadDigest,
      explanation: 'A governed source record placed this item in Attention.',
    },
    occurredAt: '2026-08-17T16:00:00.000Z',
  };
  return {
    decide: [
      {
        ...base,
        id: `release_promotion:${coldReadId}`,
        kind: 'release_promotion' as const,
        headline: 'Warehouse Cost Sentinel is ready for a production decision.',
        delta: 'Corpus 7 passed · production has not changed',
        reason:
          'Production remains unchanged until a human promotes or declines Warehouse Cost Sentinel.',
        primaryAction: coldReadAction(
          'promote_release',
          'Promote release',
          'Moves production to this exact reviewed release.',
        ),
        secondaryAction: coldReadAction(
          'decline_release',
          'Decline release',
          'Keeps production unchanged and records the reason.',
        ),
        payload: coldReadPayload({
          channelKey: 'warehouse-cost-sentinel',
          releaseId: '92929292-9292-4292-8292-929292929292',
          evaluationId: '93939393-9393-4393-8393-939393939393',
        }),
      },
      {
        ...base,
        id: `memory_review:${coldReadId}`,
        kind: 'memory_review' as const,
        headline: 'Warehouse Cost Sentinel proposed a durable memory.',
        delta: 'Nothing is stored yet · review before this value persists',
        reason:
          "Without approval, Warehouse Cost Sentinel's proposed value remains staged and does not change durable memory.",
        primaryAction: coldReadAction(
          'accept_memory',
          'Accept memory',
          'Stores this reviewed value with its source and provenance.',
        ),
        secondaryAction: coldReadAction(
          'reject_memory',
          'Reject memory',
          'Discards this proposal and leaves existing memory unchanged.',
        ),
        payload: coldReadPayload({
          runId: '94949494-9494-4494-8494-949494949494',
          candidateId: coldReadId,
          metadata: { namespace: `preferences.${coldReadDigest}` },
        }),
      },
      {
        ...base,
        id: `improvement_review:${coldReadId}`,
        kind: 'improvement_review' as const,
        headline: 'Review an improvement for Warehouse Cost Sentinel.',
        delta: 'No repository change exists · review before exploration begins',
        reason:
          'A repeated signal suggests a change to Warehouse Cost Sentinel; no change exists until a human moves it to the Incubator.',
        primaryAction: coldReadAction(
          'incubate_candidate',
          'Move to incubator',
          'Starts governed exploration without applying a patch.',
        ),
        secondaryAction: coldReadAction(
          'reject_candidate',
          'Reject candidate',
          'Closes this proposal while retaining its evidence.',
        ),
        payload: coldReadPayload({
          candidateId: coldReadId,
          metadata: { authoredTitle: 'Candidate 3f8bdaf6' },
        }),
      },
    ],
    degraded: [
      {
        ...base,
        id: `stalled_run:${coldReadId}`,
        kind: 'stalled_run' as const,
        shelf: 'degraded' as const,
        status: 'degraded' as const,
        headline: 'Warehouse Cost Sentinel failed before producing an outcome.',
        delta: '40% complete · no new work can proceed',
        reason:
          'Warehouse Cost Sentinel produced no outcome, and acknowledgement is available only after reviewing its recorder.',
        primaryAction: coldReadAction(
          'open_details',
          'Review flight recorder',
          'Shows phases, timing, cost, and the final recorded error.',
        ),
        secondaryAction: coldReadAction(
          'resolve_item',
          'Acknowledge failure',
          'Removes this terminal item from Attention after review.',
        ),
        payload: coldReadPayload({ runId: coldReadId }),
      },
      {
        ...base,
        id: `plugin_health:${coldReadId}`,
        kind: 'plugin_health' as const,
        shelf: 'degraded' as const,
        status: 'degraded' as const,
        headline: 'BigQuery is degraded.',
        delta: 'Required calls are held · no silent fallback is allowed',
        reason: "BigQuery's latest health evidence did not pass, so new calls fail closed.",
        primaryAction: coldReadAction(
          'open_details',
          'Review details',
          'Opens governed health evidence without changing the Plugin.',
        ),
        secondaryAction: null,
        payload: coldReadPayload({
          subject: { name: 'BigQuery', kind: 'plugin', version: '1.4.0' },
        }),
      },
      {
        ...base,
        id: `safety_stop:memory_review:${coldReadId}`,
        kind: 'safety_stop' as const,
        shelf: 'degraded' as const,
        status: 'safety_stop' as const,
        headline: 'Review stopped: the governed subject is unavailable.',
        delta: 'Subject identity missing · details are read-only',
        reason:
          'Paul OS cannot name a trustworthy subject, so it offers no decision until the source record is repaired.',
        primaryAction: coldReadAction(
          'open_details',
          'Why am I seeing this?',
          'Opens provenance and exact evidence without changing anything.',
        ),
        secondaryAction: null,
        payload: coldReadPayload({
          subject: null,
          metadata: { authoredTitle: 'Candidate 3f8bdaf6' },
        }),
      },
    ],
  };
}

describe('AttentionPage', () => {
  it('renders verdict-first shelves and opens governed keyboard actions', async () => {
    const user = userEvent.setup();
    const rejectGroup = vi.spyOn(platformApi, 'rejectExecutionApprovalGroup');
    try {
      renderWithClient(<AttentionPage />);

      const heading = await screen.findByRole('heading', { name: approvalHeading });
      const card = heading.closest('article');
      expect(card).not.toBeNull();
      expect(screen.getByRole('heading', { name: /Decide 01/i })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Degraded 01/i })).toBeInTheDocument();
      expect(screen.getByText('34 runs · $2.10 · 2 promotions this week')).toBeInTheDocument();
      expect(within(card!).getByText('Daily Briefing')).toBeInTheDocument();
      expect(within(card!).getByText('agent')).toBeInTheDocument();
      expect(within(card!).getByText('1.0.0')).toBeInTheDocument();
      const groupedRequests = within(card!).getByRole('button', {
        name: 'Inspect 4 exact matching requests',
      });
      expect(groupedRequests).toHaveAttribute('aria-haspopup', 'dialog');
      expect(groupedRequests).toHaveTextContent('4 exact matching requests');
      expect(
        within(card!).getByText(/Queues these 4 runs under one bounded grant/i),
      ).toBeInTheDocument();
      expect(
        within(card!).getByText(/Revoke the grant to prevent later matching runs/i),
      ).toBeInTheDocument();
      expect(card).not.toHaveTextContent(attentionApprovalGroupKey);
      expect(card).not.toHaveTextContent(executionRunId);
      expect(card).not.toHaveTextContent('b'.repeat(64));
      expect(card).not.toHaveTextContent('worker-test');
      expect(card).not.toHaveTextContent(/0 (tool scopes|authority boundaries)/i);
      expect(
        [...document.querySelectorAll('.attention-status-mark')].map((mark) => mark.textContent),
      ).toEqual(['01', '02']);

      const whyButton = within(card!).getByRole('button', { name: 'Why am I seeing this?' });
      expect(whyButton).toHaveAttribute('aria-haspopup', 'dialog');
      await user.click(whyButton);
      const detail = await screen.findByRole('dialog', { name: approvalHeading });
      expect(
        within(detail).getByRole('heading', { name: '4 exact matching requests' }),
      ).toBeVisible();
      expect(within(detail).getByLabelText('Decision evidence')).toHaveTextContent(
        'AuthorityCalendar — read only',
      );
      const membership = within(detail).getByRole('region', { name: 'Exact group membership' });
      expect(within(membership).getAllByRole('listitem')).toHaveLength(4);
      expect(within(membership).getByText('Authority request 04')).toBeVisible();
      expect(within(membership).getByText(executionRunId)).not.toBeVisible();
      const technicalMembership = within(membership).getAllByText('Technical membership')[0]!;
      await user.click(technicalMembership);
      expect(within(membership).getByText(executionRunId)).toBeVisible();
      await user.click(within(detail).getByRole('button', { name: 'Close detail' }));

      await user.click(groupedRequests);
      expect(await screen.findByRole('dialog', { name: approvalHeading })).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Close detail' }));

      card!.focus();
      await user.keyboard('r');
      const rejection = await screen.findByRole('dialog');
      expect(
        within(rejection).getByRole('heading', { name: 'Reject request' }),
      ).toBeInTheDocument();
      expect(within(rejection).getByText(/What happens/i)).toBeInTheDocument();
      expect(within(rejection).getByText(/Undo/i)).toBeInTheDocument();

      const rationale = within(rejection).getByLabelText('Decision rationale');
      await user.type(rationale, 'This release needs a narrower calendar scope.');
      await user.keyboard('r');
      expect(rationale).toHaveValue('This release needs a narrower calendar scope.r');
      await user.click(within(rejection).getByRole('button', { name: 'Reject request' }));

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: approvalHeading })).not.toBeInTheDocument();
      });
      expect(rejectGroup).toHaveBeenCalledWith(
        attentionApprovalGroupKey,
        'This release needs a narrower calendar scope.r',
      );
    } finally {
      rejectGroup.mockRestore();
    }
  });

  it('approves a grouped request with floors that cover every reviewed run', async () => {
    const user = userEvent.setup();
    const approveGroup = vi.spyOn(platformApi, 'approveExecutionApprovalGroup');
    try {
      renderWithClient(<AttentionPage />);

      await screen.findByRole('heading', { name: approvalHeading });
      await user.click(screen.getByRole('button', { name: 'Review and approve' }));

      const dialog = await screen.findByRole('dialog', { name: 'Approve execution envelope' });
      expect(
        within(dialog).getByText(/One decision covers 4 exact matching pending runs/i),
      ).toBeInTheDocument();
      expect(within(dialog).getByRole('spinbutton', { name: 'Maximum runs' })).toHaveValue(4);
      expect(within(dialog).getByRole('spinbutton', { name: 'Maximum runs' })).toHaveAttribute(
        'min',
        '4',
      );
      expect(within(dialog).getByRole('spinbutton', { name: 'Total budget · USD' })).toHaveValue(
        0.48,
      );
      expect(
        within(dialog).getByText('RETRY · UP TO 3 TOTAL ATTEMPTS · EXPONENTIAL BACKOFF'),
      ).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Approve authority' }));

      await waitFor(() => {
        expect(
          screen.queryByRole('dialog', { name: 'Approve execution envelope' }),
        ).not.toBeInTheDocument();
      });
      expect(approveGroup).toHaveBeenCalledWith(
        attentionApprovalGroupKey,
        expect.objectContaining({ maxRuns: 4, totalCostBudgetUsd: 0.48 }),
      );
    } finally {
      approveGroup.mockRestore();
    }
  });

  it('renders named cross-kind subjects and keeps identifiers in details only', async () => {
    const items = crossKindAttentionItems();
    server.use(
      http.get('http://localhost/v1/attention', () =>
        HttpResponse.json({
          generatedAt: '2026-08-17T16:00:00.000Z',
          ...items,
          digest: {
            headline: 'Five governed records need review',
            runCount: 1,
            totalCostUsd: 0,
            promotionCount: 0,
            observationCount: 1,
            windowStartedAt: null,
            windowEndedAt: '2026-08-17T16:00:00.000Z',
          },
          decideBadgeCount: items.decide.length,
          lastDeliveredBriefingAt: null,
        }),
      ),
    );
    renderWithClient(<AttentionPage />);

    const releaseHeading = await screen.findByRole('heading', {
      name: 'Warehouse Cost Sentinel is ready for a production decision.',
    });
    expect(releaseHeading).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Warehouse Cost Sentinel proposed a durable memory.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Review an improvement for Warehouse Cost Sentinel.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Warehouse Cost Sentinel failed before producing an outcome.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'BigQuery is degraded.' })).toBeInTheDocument();

    const safetyHeading = screen.getByRole('heading', {
      name: 'Review stopped: the governed subject is unavailable.',
    });
    const safetyCard = safetyHeading.closest('article');
    expect(safetyCard).not.toBeNull();
    expect(
      within(safetyCard!).getByText('Subject identity missing · details are read-only'),
    ).toBeInTheDocument();
    expect(
      within(safetyCard!).queryByRole('button', { name: /accept|promote|incubator/i }),
    ).toBeNull();

    const cards = screen.getAllByRole('article');
    expect(cards).toHaveLength(6);
    for (const card of cards) {
      expect(card).not.toHaveTextContent(coldReadId);
      expect(card).not.toHaveTextContent(coldReadDigest);
      expect(card).not.toHaveTextContent('worker-test');
      expect(card).not.toHaveTextContent('Candidate 3f8bdaf6');
      expect(
        within(card).queryAllByText(/Opens|Moves|Keeps|Stores|Discards|Starts|Closes|Shows|Removes/)
          .length,
      ).toBeGreaterThan(0);
    }
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

    await screen.findByRole('heading', { name: approvalHeading });
    await user.keyboard('e');

    const detail = await screen.findByRole('dialog');
    expect(within(detail).getByText('WHY YOU ARE SEEING THIS')).toBeInTheDocument();
    expect(within(detail).getByRole('region', { name: 'Flight recorder' })).toBeInTheDocument();
    const recorder = within(detail).getByRole('region', { name: 'Flight recorder' });
    const phases = within(recorder).getAllByRole('listitem');
    expect(phases[0]).toHaveTextContent('Worker claimed');
    expect(phases[1]).toHaveTextContent('Model execution');
    expect(phases[0]).not.toHaveTextContent('—');
    expect(phases[1]).toHaveTextContent('18 ms · $0.0042');
    expect(within(detail).getByText('Grouped authority requests')).toBeInTheDocument();
    expect(within(detail).queryByText('ApprovalRequestGroup')).not.toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: approvalHeading })).toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: approvalHeading })).toBeInTheDocument();
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
