import { http, HttpResponse } from 'msw';
import { screen, within } from '@testing-library/react';
import { HomePage } from './HomePage';
import { renderWithClient } from '../../test/render';
import { platformRunFixture, server } from '../../test/server';

const emptyCounts = {
  awaiting_approval: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
  paused_budget: 0,
  paused_plugin: 0,
};

const emptyAttention = {
  generatedAt: '2026-08-17T12:00:00.000Z',
  decide: [],
  degraded: [],
  digest: {
    headline: 'No ledger activity in this briefing window',
    runCount: 0,
    totalCostUsd: 0,
    promotionCount: 0,
    observationCount: 0,
    windowStartedAt: null,
    windowEndedAt: '2026-08-17T12:00:00.000Z',
  },
  decideBadgeCount: 0,
  lastDeliveredBriefingAt: null,
};

const emptyRuns = { items: [], total: 0, countsByState: emptyCounts };
const emptyGrants = { items: [], total: 0, activeTotal: 0 };
const emptySchedules = { items: [], total: 0, activeTotal: 0 };
const emptyPlugins = { items: [] };

interface TodayResponses {
  attention?: unknown;
  attentionError?: boolean;
  grants?: unknown;
  grantsError?: boolean;
  plugins?: unknown;
  pluginsError?: boolean;
  runs?: unknown;
  runsError?: boolean;
  schedules?: unknown;
  schedulesError?: boolean;
}

function unavailableResponse() {
  return HttpResponse.json(
    { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Fixture dependency unavailable.' } },
    { status: 503 },
  );
}

function useTodayResponses(responses: TodayResponses = {}) {
  server.use(
    http.get('http://localhost/v1/attention', () =>
      responses.attentionError
        ? unavailableResponse()
        : HttpResponse.json(responses.attention ?? emptyAttention),
    ),
    http.get('http://localhost/v1/execution-runs', () =>
      responses.runsError ? unavailableResponse() : HttpResponse.json(responses.runs ?? emptyRuns),
    ),
    http.get('http://localhost/v1/authority-grants', () =>
      responses.grantsError
        ? unavailableResponse()
        : HttpResponse.json(responses.grants ?? emptyGrants),
    ),
    http.get('http://localhost/v1/automation-schedules', () =>
      responses.schedulesError
        ? unavailableResponse()
        : HttpResponse.json(responses.schedules ?? emptySchedules),
    ),
    http.get('http://localhost/v1/plugins', () =>
      responses.pluginsError
        ? unavailableResponse()
        : HttpResponse.json(responses.plugins ?? emptyPlugins),
    ),
  );
}

function localTime(hour: number, minute = 0): string {
  return new Date(2026, 7, 17, hour, minute).toISOString();
}

function reviewItem(index: number, occurredAt: string, expiresAt: string | null = null) {
  return {
    id: `waiting-for-user-${index}`,
    kind: 'waiting_for_user' as const,
    shelf: 'decide' as const,
    headline: `Governed review item ${index}`,
    delta: `Review item ${index} changed after a recorded ledger event.`,
    status: 'decide' as const,
    primaryAction: {
      kind: 'open_details' as const,
      label: 'Open detail',
      consequence: 'Opens immutable detail without changing the item.',
      undo: 'Close the detail to leave the item unchanged.',
      resourceId: `waiting-for-user-${index}`,
      requiresRationale: false,
    },
    secondaryAction: null,
    cost: null,
    reason: 'A governed item is waiting for a human review.',
    provenance: {
      sourceType: 'test_ledger',
      sourceId: `source-${index}`,
      actorId: 'test-operator',
      requestId: null,
      explanation: 'A deterministic test ledger event produced this review item.',
    },
    occurredAt,
    payload: {
      sourceType: 'test_ledger',
      sourceId: `source-${index}`,
      detailPath: `/attention?item=waiting-for-user-${index}`,
      scopes: [],
      runId: null,
      candidateId: null,
      channelKey: null,
      releaseId: null,
      evaluationId: null,
      expiresAt,
      reviewFacts: [],
      metadata: {},
    },
  };
}

function activeSchedule(nextRunAt: string) {
  return {
    id: '19191919-1919-4191-8191-191919191919',
    name: 'Governed planning cycle',
    channelKey: 'planning-cycle',
    releaseId: '16161616-1616-4161-8161-161616161616',
    entryResourceVersionId: '12121212-1212-4121-8121-121212121212',
    releaseDigest: 'b'.repeat(64),
    projectId: 'local-operations',
    authorityGrantId: null,
    timezone: 'America/New_York',
    intervalSeconds: 86_400,
    nextRunAt,
    inputTemplate: {},
    includePlatformDigest: false,
    inputConstraints: {},
    catchUpPolicy: 'latest_only' as const,
    maxCatchUpRuns: 1,
    deduplicationWindowSeconds: 300,
    retry: { maximumAttempts: 3, backoff: 'exponential' as const },
    cost: { maxInputTokens: 8_000, maxOutputTokens: 2_000, maxEstimatedCostUsd: 0.25 },
    outcomeExpectations: {},
    state: 'active' as const,
    lastScheduledAt: null,
    createdBy: 'test-operator',
    updatedBy: 'test-operator',
    createdAt: localTime(7),
    updatedAt: localTime(7),
  };
}

describe('HomePage', () => {
  it('merges real ledger timestamps chronologically around a fixed NOW marker', async () => {
    const now = new Date(2026, 7, 17, 11);
    const run = {
      ...platformRunFixture(),
      state: 'succeeded' as const,
      message: 'Governed run completed.',
      startedAt: localTime(9),
      finishedAt: localTime(10),
      createdAt: localTime(8),
      updatedAt: localTime(10),
    };
    const item = reviewItem(1, localTime(10, 30), localTime(15));

    useTodayResponses({
      attention: { ...emptyAttention, decide: [item], decideBadgeCount: 1 },
      runs: {
        items: [run],
        total: 1,
        countsByState: { ...emptyCounts, succeeded: 1 },
      },
      schedules: { items: [activeSchedule(localTime(13))], total: 1, activeTotal: 1 },
    });
    renderWithClient(<HomePage now={now} />);

    const timeline = screen.getByRole('list', { name: 'Merged work timeline' });
    expect(await within(timeline).findByText('Governed planning cycle')).toBeVisible();
    const rows = within(timeline).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Agent run requested'),
      expect.stringContaining('Agent run started'),
      expect.stringContaining('Agent run finished'),
      expect.stringContaining('Governed review item 1'),
      expect.stringContaining('NOW'),
      expect.stringContaining('Governed planning cycle'),
      expect.stringContaining('Governed review item 1'),
    ]);
  });

  it('fails each unavailable section closed while retaining independent source results', async () => {
    const now = new Date(2026, 7, 17, 11);
    useTodayResponses({ runsError: true, pluginsError: true });
    renderWithClient(<HomePage now={now} />);

    expect(await screen.findByText('Run timeline unavailable.')).toBeVisible();
    expect(screen.getByText('Held-run status unavailable.')).toBeVisible();
    expect(screen.getByText('Connections status unavailable.')).toBeVisible();
    expect(
      screen.getByText('No current review items in the available Attention data.'),
    ).toBeVisible();
    expect(screen.queryByText(/all systems nominal/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/all quiet/i)).not.toBeInTheDocument();
  });

  it('names unavailable Attention, schedule, and authority contracts without hiding live sources', async () => {
    const now = new Date(2026, 7, 17, 11);
    useTodayResponses({ attentionError: true, grantsError: true, schedulesError: true });
    renderWithClient(<HomePage now={now} />);

    expect(await screen.findByText('Attention timeline unavailable.')).toBeVisible();
    expect(screen.getByText('Schedule timeline unavailable.')).toBeVisible();
    expect(screen.getByText('Needs You unavailable.')).toBeVisible();
    expect(screen.getByText('Briefing digest unavailable.')).toBeVisible();
    expect(screen.getByText('Authority status unavailable.')).toBeVisible();
    expect(screen.queryByText('Run timeline unavailable.')).not.toBeInTheDocument();
    expect(screen.queryByText('Connections status unavailable.')).not.toBeInTheDocument();
  });

  it('surfaces only exceptions supported by current scoped query results', async () => {
    const now = new Date(2026, 7, 17, 11);
    useTodayResponses({
      grants: {
        items: [
          {
            id: '51515151-5151-4515-8515-515151515151',
            releaseId: '16161616-1616-4161-8161-161616161616',
            entryResourceVersionId: '12121212-1212-4121-8121-121212121212',
            releaseDigest: 'b'.repeat(64),
            contextDigest: 'd'.repeat(64),
            projectId: 'local-operations',
            inputConstraints: {},
            toolScopes: [],
            pluginScopes: [],
            validFrom: localTime(7),
            validUntil: new Date(2026, 7, 19, 11).toISOString(),
            maxRuns: 10,
            usedRuns: 1,
            maxEstimatedCostPerRunUsd: 0.25,
            totalCostBudgetUsd: 2.5,
            spentCostUsd: 0.1,
            reservedCostUsd: 0,
            state: 'active',
            actorId: 'test-operator',
            rationale: 'Permit bounded deterministic test execution.',
            revokedAt: null,
            createdAt: localTime(7),
          },
        ],
        total: 1,
        activeTotal: 1,
      },
      plugins: {
        items: [
          {
            pluginVersionId: '30303030-3030-4303-8303-303030303030',
            familyId: '38383838-3838-4383-8383-383838383838',
            slug: 'governed-source',
            name: 'Governed source',
            version: '1.0.0',
            digest: '3'.repeat(64),
            transport: 'http',
            executionPlacement: 'control_plane',
            classification: 'internal',
            brand: { monogram: 'GS', accent: '#B9AAFF' },
            capabilities: [],
            secretSlots: [],
            activeScopeDescriptions: [],
            costThisWeekUsd: 0,
            installationId: '31313131-3131-4313-8313-313131313131',
            installationState: 'degraded',
            healthStatus: 'degraded',
            lastUsedAt: localTime(9),
          },
        ],
      },
      runs: {
        items: [],
        total: 3,
        countsByState: { ...emptyCounts, awaiting_approval: 2, paused_plugin: 1 },
      },
    });
    renderWithClient(<HomePage now={now} />);

    expect(await screen.findByRole('heading', { name: 'Operating exceptions' })).toBeVisible();
    expect(screen.getByText(/At least 1 active grant expires within seven days/)).toBeVisible();
    expect(screen.getByText(/At least 1 installed connection needs review/)).toBeVisible();
    expect(screen.getByText(/3 runs are held: 2 awaiting approval/)).toBeVisible();
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });

  it('never invents meetings, deadlines, or historical decision points', async () => {
    const now = new Date(2026, 7, 17, 11);
    useTodayResponses();
    renderWithClient(<HomePage now={now} />);

    expect(
      await screen.findByText('No events are recorded in the connected ledger sources.'),
    ).toBeVisible();
    expect(screen.getByText('Meetings').parentElement).toHaveTextContent(
      'Not connected on this machine.',
    );
    expect(screen.getByText('Project deadlines').parentElement).toHaveTextContent(
      'Not connected on this machine.',
    );
    expect(screen.getAllByTestId('timeline-now')).toHaveLength(1);
    expect(screen.queryAllByTestId('timeline-event')).toHaveLength(0);
    expect(screen.getByText('Paul OS draws no chart', { exact: false })).toBeVisible();
    expect(document.querySelector('.today-home svg')).not.toBeInTheDocument();
  });

  it('previews only three Attention items through one read-only handoff', async () => {
    const now = new Date(2026, 7, 17, 11);
    const items = [
      reviewItem(1, localTime(8)),
      reviewItem(2, localTime(9)),
      reviewItem(3, localTime(10)),
      reviewItem(4, localTime(10, 30)),
    ];
    useTodayResponses({
      attention: { ...emptyAttention, decide: items, decideBadgeCount: items.length },
    });
    renderWithClient(<HomePage now={now} />);

    const needsYou = screen.getByRole('region', { name: 'Needs you' });
    expect(await within(needsYou).findByText('Governed review item 1')).toBeVisible();
    expect(within(needsYou).getByText('Governed review item 2')).toBeVisible();
    expect(within(needsYou).getByText('Governed review item 3')).toBeVisible();
    expect(within(needsYou).queryByText('Governed review item 4')).not.toBeInTheDocument();
    expect(within(needsYou).queryAllByRole('button')).toHaveLength(0);
    const attentionLinks = screen.getAllByRole('link', { name: /Open Attention/i });
    expect(attentionLinks).toHaveLength(1);
    expect(attentionLinks[0]).toHaveAttribute('href', '/attention');
  });

  it('renders a date-driven dense shell and an honest all-success empty state', async () => {
    const now = new Date(2026, 7, 17, 8);
    useTodayResponses();
    renderWithClient(<HomePage aimEnabled now={now} />);

    expect(screen.getByText('TODAY · GOOD MORNING')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('August 17, 2026');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      await screen.findByText('No current review items in the available Attention data.'),
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { name: 'Since the last delivered briefing' }),
    ).toBeVisible();
    expect(screen.getByText('No ledger activity in this briefing window')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Operating exceptions' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.primary-button')).toHaveLength(1);
  });
});
