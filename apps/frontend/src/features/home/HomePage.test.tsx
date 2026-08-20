import { roadmapProgramSchema } from '@agent-builder/contracts';
import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import seedManifestText from '../../../../../03-projects/aim/program.seed.json?raw';
import { renderWithClient } from '../../test/render';
import { server } from '../../test/server';
import {
  loadHomeProgram,
  metricsForVertical,
  programActionsForVertical,
  workstreamsForVertical,
} from './home-model';
import { HomePage } from './HomePage';

const now = new Date('2026-08-18T13:00:00.000Z');

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
  generatedAt: '2026-08-18T13:00:00.000Z',
  decide: [],
  degraded: [],
  digest: {
    headline: 'No ledger activity in this briefing window',
    runCount: 0,
    totalCostUsd: 0,
    promotionCount: 0,
    observationCount: 0,
    windowStartedAt: null,
    windowEndedAt: '2026-08-18T13:00:00.000Z',
  },
  decideBadgeCount: 0,
  lastDeliveredBriefingAt: null,
};

const emptyRuns = { items: [], total: 0, countsByState: emptyCounts };
const emptyGrants = { items: [], total: 0, activeTotal: 0 };
const emptyPlugins = { items: [] };
const emptySchedules = { items: [], total: 0, activeTotal: 0 };

function roadmapFork(
  index: number,
  id: 'fork_primary' | 'fork_alternate',
  label: string,
  status: 'watch' | 'at_risk',
) {
  const suffix = String(index).padStart(12, '0');
  return {
    id,
    label,
    purpose: `Track the governed state of ${label}.`,
    status,
    jira: {
      state: 'awaiting_transfer' as const,
      projectKey: null,
      filterId: null,
      includedIssueCount: null,
      totalIssueCount: null,
      lastSyncedAt: null,
    },
    metrics: [
      {
        id: `${id}_status`,
        label: 'Fork status',
        value: status === 'watch' ? 'Watch' : 'At risk',
        detail: 'Synthetic status retained until the private Jira binding transfers.',
        state: status,
        source: 'synthetic' as const,
      },
    ],
    workstreams: [
      {
        id: `${id}_workstream`,
        label: `${label} workstream`,
        startAt: '2026-08-01T00:00:00.000Z',
        endAt: '2026-09-01T00:00:00.000Z',
        state: status === 'watch' ? ('in_work' as const) : ('at_risk' as const),
        source: 'synthetic' as const,
      },
    ],
    actions: [
      {
        id: `${id}_decision`,
        label: `Resolve ${label} fork-only decision`,
        consequence: 'This action belongs to its exact roadmap fork, not the global Today queue.',
        dueAt: null,
        owner: `${label} owner`,
        state: 'decision' as const,
        source: 'synthetic' as const,
      },
    ],
    source: 'synthetic' as const,
    resource: {
      resourceVersionId: `41000000-0000-4000-8000-${suffix}`,
      familyId: `42000000-0000-4000-8000-${suffix}`,
      kind: 'Roadmap' as const,
      slug: `roadmap-${id.replace('fork_', '')}`,
      name: label,
      version: '1.0.0',
      lifecycle: 'candidate' as const,
      digest: String(index).repeat(64),
      sourceCommit: 'home-roadmap-test',
      provenance: 'synthetic-test',
    },
    definitionDependencies: [],
    relationships: [],
    relationshipCoverage: {
      vertical: { state: 'unmapped' as const, detail: 'No vertical mapping is loaded.' },
      aimGroup: { state: 'unmapped' as const, detail: 'No AIM group mapping is loaded.' },
      contributingAgents: {
        state: 'unmapped' as const,
        detail: 'No contributing Agent mapping is loaded.',
      },
      executionRuns: {
        state: 'unavailable' as const,
        detail: 'No runtime execution relationship is loaded.',
      },
    },
  };
}

const governedRoadmapProgram = roadmapProgramSchema.parse({
  schemaVersion: 'roadmaps.program/v2',
  id: 'home_two_fork_roadmap',
  title: 'Home two-fork roadmap',
  description: 'Expose exact fork state without copying roadmap actions into Today.',
  synthetic: true,
  timeline: {
    startAt: '2026-08-01T00:00:00.000Z',
    endAt: '2027-02-01T00:00:00.000Z',
  },
  forks: [
    roadmapFork(1, 'fork_primary', 'Primary flight path', 'watch'),
    roadmapFork(2, 'fork_alternate', 'Alternate flight path', 'at_risk'),
  ],
});

interface HomeResponses {
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
  roadmaps?: unknown;
  roadmapsDelayMs?: number;
  roadmapsError?: boolean;
}

function unavailableResponse() {
  return HttpResponse.json(
    { error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Fixture dependency unavailable.' } },
    { status: 503 },
  );
}

function useHomeResponses(responses: HomeResponses = {}) {
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
    http.get('http://localhost/v1/plugins', () =>
      responses.pluginsError
        ? unavailableResponse()
        : HttpResponse.json(responses.plugins ?? emptyPlugins),
    ),
    http.get('http://localhost/v1/automation-schedules', () =>
      responses.schedulesError
        ? unavailableResponse()
        : HttpResponse.json(responses.schedules ?? emptySchedules),
    ),
    http.get('http://localhost/v1/roadmaps', async () => {
      if (responses.roadmapsDelayMs !== undefined) await delay(responses.roadmapsDelayMs);
      return responses.roadmapsError
        ? unavailableResponse()
        : HttpResponse.json(responses.roadmaps ?? governedRoadmapProgram);
    }),
  );
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location-probe">
        {location.pathname}
        {location.search}
      </output>
      <button
        onClick={() => {
          void navigate(-1);
        }}
        type="button"
      >
        Test browser back
      </button>
    </>
  );
}

function renderHome(entry = '/', manifestText?: string, currentNow = now) {
  return renderWithClient(
    <>
      <HomePage now={currentNow} {...(manifestText === undefined ? {} : { manifestText })} />
      <LocationProbe />
    </>,
    [entry],
  );
}

function automationSchedule(
  nextRunAt: string,
  entrySubject: object | null = {
    name: 'Daily Brief',
    kind: 'skill',
    version: '1.0.0',
  },
) {
  return {
    id: '19191919-1919-4191-8191-191919191919',
    name: 'Compose daily brief',
    channelKey: 'daily-operations',
    releaseId: '16161616-1616-4161-8161-161616161616',
    entryResourceVersionId: '12121212-1212-4121-8121-121212121212',
    entrySubject,
    releaseDigest: 'b'.repeat(64),
    projectId: 'local-operations',
    authorityGrantId: null,
    timezone: 'America/New_York',
    intervalSeconds: 86_400,
    nextRunAt,
    inputTemplate: {},
    includePlatformDigest: false,
    inputConstraints: {},
    catchUpPolicy: 'latest_only',
    maxCatchUpRuns: 1,
    deduplicationWindowSeconds: 300,
    retry: { maximumAttempts: 3, backoff: 'exponential' },
    cost: {
      maxInputTokens: 8_000,
      maxOutputTokens: 2_000,
      maxEstimatedCostUsd: 0.25,
    },
    outcomeExpectations: {},
    state: 'active',
    lastScheduledAt: null,
    createdBy: 'test-operator',
    updatedBy: 'test-operator',
    createdAt: '2026-08-18T12:00:00.000Z',
    updatedAt: '2026-08-18T12:00:00.000Z',
  };
}

function plugin(index: number) {
  const suffix = index.toString().padStart(12, '0');
  return {
    pluginVersionId: `30303030-3030-4303-8303-${suffix}`,
    familyId: `38383838-3838-4383-8383-${suffix}`,
    slug: `governed-source-${index}`,
    name: `Governed source ${index}`,
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
    installationId: `31313131-3131-4313-8313-${suffix}`,
    installationState: index === 0 ? 'degraded' : 'enabled',
    healthStatus: index === 0 ? 'degraded' : 'healthy',
    lastUsedAt: '2026-08-18T12:00:00.000Z',
  };
}

interface MutableManifest {
  agents: Array<{ synthetic: boolean }>;
  evidence: Array<{ id: string; freshnessSlaHours?: number }>;
  milestones: Array<{
    id: string;
    gateCriteria: Array<{ id: string; affectedPartIds: string[] }>;
  }>;
  program: { synthetic: boolean };
  sources: Array<{
    id: string;
    observedAt: string;
    synthetic: boolean;
    reconciliationStatus: string;
    [key: string]: unknown;
  }>;
  workstreams: Array<{ id: string; sourceRefs: string[] }>;
}

function mutableManifest(): MutableManifest {
  return JSON.parse(seedManifestText) as MutableManifest;
}

function reviewItem(index: number) {
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
    occurredAt: `2026-08-18T1${index}:00:00.000Z`,
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
      expiresAt: null,
      approvalGroupKey: null,
      requestCount: 1,
      subject: { name: `Governed review item ${index}`, kind: 'Review item', version: '1.0.0' },
      reviewFacts: [],
      metadata: {},
    },
  };
}

describe('HomePage', () => {
  it('renders three ordered bands and an honest all-vertical rollup', async () => {
    useHomeResponses({
      attention: {
        ...emptyAttention,
        digest: { ...emptyAttention.digest, runCount: 7, totalCostUsd: 12.34 },
      },
    });
    renderHome();

    const bands = [
      screen.getByTestId('home-band-health'),
      screen.getByTestId('home-band-plan'),
      screen.getByTestId('home-band-action'),
    ];
    expect(bands[0]?.compareDocumentPosition(bands[1] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(bands[1]?.compareDocumentPosition(bands[2] as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    const metrics = screen.getByLabelText('All health metrics');
    expect(await within(metrics).findByText('$12.34')).toBeVisible();
    expect(within(metrics).getAllByRole('article')).toHaveLength(8);
    expect(within(metrics).getByTestId('home-metric-coverage:group_quality')).toHaveTextContent(
      /0%.*NO COVERAGE/,
    );
    expect(within(metrics).getByTestId('home-metric-coverage:group_avionics')).toHaveTextContent(
      /0%.*NO COVERAGE/,
    );
    expect(within(metrics).getByTestId('home-metric-digest-runs')).toHaveTextContent('7');
    expect(within(metrics).getByTestId('home-metric-digest-runs')).toHaveTextContent('LIVE');
    expect(screen.queryByText(/on track/i)).toBeVisible();
    expect(screen.getByRole('link', { name: /compare roadmap forks/i })).toHaveAttribute(
      'href',
      '/roadmaps',
    );
    expect(document.querySelector('.today-home svg')).not.toBeInTheDocument();
  });

  it('shows both governed roadmap forks with exact status, source, and deep links', async () => {
    useHomeResponses();
    renderHome();

    const strip = screen.getByTestId('home-roadmap-strip');
    const primary = await within(strip).findByRole('link', {
      name: 'Open Primary flight path: WATCH, SYNTHETIC',
    });
    const alternate = within(strip).getByRole('link', {
      name: 'Open Alternate flight path: AT RISK, SYNTHETIC',
    });
    expect(primary).toHaveAttribute('href', '/roadmaps?fork=fork_primary');
    expect(alternate).toHaveAttribute('href', '/roadmaps?fork=fork_alternate');
    expect(primary).toHaveTextContent(/Primary flight path.*WATCH.*SYNTHETIC/);
    expect(alternate).toHaveTextContent(/Alternate flight path.*AT RISK.*SYNTHETIC/);
    expect(within(strip).getByRole('link', { name: 'COMPARE BOTH →' })).toHaveAttribute(
      'href',
      '/roadmaps',
    );
    expect(screen.queryByText(/fork-only decision/i)).not.toBeInTheDocument();
  });

  it('keeps roadmap fork state unavailable while the governed projection is pending', async () => {
    useHomeResponses({ roadmapsDelayMs: 75 });
    renderHome();

    const strip = screen.getByTestId('home-roadmap-strip');
    expect(within(strip).getByText(/Roadmap fork status is still loading/i)).toBeVisible();
    expect(within(strip).queryByRole('link', { name: /^Open /i })).not.toBeInTheDocument();
    expect(within(strip).queryByRole('list')).not.toBeInTheDocument();
    await within(strip).findByRole('link', {
      name: 'Open Primary flight path: WATCH, SYNTHETIC',
    });
  });

  it('fails roadmap state closed when the backend reports it unavailable', async () => {
    useHomeResponses({ roadmapsError: true });
    renderHome();

    const strip = screen.getByTestId('home-roadmap-strip');
    expect(await within(strip).findByText(/Roadmap fork status unavailable/i)).toBeVisible();
    expect(within(strip).queryByRole('link', { name: /^Open /i })).not.toBeInTheDocument();
    expect(within(strip).queryByRole('list')).not.toBeInTheDocument();
    expect(strip).toHaveTextContent(/No zero or nominal state is inferred/i);
  });

  it('rejects a partial roadmap response without rendering one fork as complete', async () => {
    useHomeResponses({
      roadmaps: { ...governedRoadmapProgram, forks: [governedRoadmapProgram.forks[0]] },
    });
    renderHome();

    const strip = screen.getByTestId('home-roadmap-strip');
    expect(await within(strip).findByText(/Roadmap fork status unavailable/i)).toBeVisible();
    expect(within(strip).queryByRole('link', { name: /^Open /i })).not.toBeInTheDocument();
    expect(within(strip).queryByRole('list')).not.toBeInTheDocument();
    expect(strip).toHaveTextContent(/No zero or nominal state is inferred/i);
  });

  it('uses one history-backed Factory filter across metrics, plan, and action', async () => {
    const user = userEvent.setup();
    useHomeResponses();
    renderHome();

    await user.click(screen.getByRole('button', { name: 'Factory operations' }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/?vertical=group_factory');
    await waitFor(() =>
      expect(screen.getByTestId('home-scope-summary')).toHaveTextContent(
        'Factory operations · 4 metrics · 2 workstreams · 1 next move',
      ),
    );
    expect(
      within(screen.getByLabelText('Factory operations health metrics')).getAllByRole('article'),
    ).toHaveLength(4);
    expect(screen.getAllByTestId('home-gantt-row')).toHaveLength(2);
    expect(within(screen.getByTestId('home-task-list')).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('Foundation contract and test evidence verified')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Propulsion' }));
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/?vertical=group_propulsion');
    await user.click(screen.getByRole('button', { name: 'Test browser back' }));
    expect(screen.getByTestId('home-scope-summary')).toHaveTextContent('Factory operations');
  });

  it('defaults an invalid vertical to All without mutating the bad URL', () => {
    useHomeResponses();
    renderHome('/?vertical=not_a_group');

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('All health metrics')).toBeVisible();
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/?vertical=not_a_group');
  });

  it('shows awaiting-transfer outcomes without a value, progress, or verdict', () => {
    useHomeResponses();
    renderHome('/?vertical=group_factory');

    const outcome = screen.getByTestId('home-metric-outcome:group_factory');
    expect(outcome).toHaveTextContent('Print first-pass yield');
    expect(outcome).toHaveTextContent('AWAITING TRANSFER');
    expect(outcome).toHaveTextContent('—');
    expect(outcome).toHaveTextContent('NOT CONNECTED');
    expect(outcome).toHaveTextContent('NOT MEASURED');
    expect(within(outcome).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(outcome).not.toHaveTextContent(/on track|off track|nominal/i);
  });

  it('fails live digest metrics closed without hiding synthetic program state', async () => {
    useHomeResponses({ attentionError: true });
    renderHome();

    const runMetric = screen.getByTestId('home-metric-digest-runs');
    const costMetric = screen.getByTestId('home-metric-digest-cost');
    expect(await within(runMetric).findByText('UNAVAILABLE')).toBeVisible();
    expect(runMetric).toHaveTextContent('—');
    expect(costMetric).toHaveTextContent('—');
    expect(screen.getByTestId('home-metric-coverage:group_factory')).toHaveTextContent('100%');
    expect(screen.queryByText(/all systems nominal|all quiet/i)).not.toBeInTheDocument();
  });

  it('keeps global operating exceptions and Attention visible under a vertical filter', async () => {
    useHomeResponses({
      attention: {
        ...emptyAttention,
        decide: [reviewItem(1)],
        decideBadgeCount: 1,
      },
      runs: {
        items: [],
        total: 1,
        countsByState: { ...emptyCounts, paused_plugin: 1 },
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
            lastUsedAt: '2026-08-18T12:00:00.000Z',
          },
        ],
      },
    });
    renderHome('/?vertical=group_factory');

    const tasks = screen.getByTestId('home-task-list');
    expect(await within(tasks).findByText('GLOBAL · CONNECTION EXCEPTION')).toBeVisible();
    expect(await within(tasks).findByText('GLOBAL · RUN EXCEPTION')).toBeVisible();
    expect(within(tasks).getByText('MILESTONE BLOCKER')).toBeVisible();
    const attention = screen.getByRole('heading', { name: 'Needs you' }).closest('section');
    expect(attention).toHaveTextContent('GLOBAL · READ-ONLY PREVIEW');
    expect(attention).toHaveTextContent('Governed review item 1');
  });

  it('keeps the Attention preview read-only, capped, and behind one primary handoff', async () => {
    const items = [reviewItem(1), reviewItem(2), reviewItem(3), reviewItem(4)];
    useHomeResponses({
      attention: { ...emptyAttention, decide: items, decideBadgeCount: items.length },
    });
    renderHome();

    const needsYou = screen.getByRole('heading', { name: 'Needs you' }).closest('section');
    expect(needsYou).not.toBeNull();
    expect(
      await within(needsYou as HTMLElement).findByText('Governed review item 1'),
    ).toBeVisible();
    expect(within(needsYou as HTMLElement).getByText('Governed review item 3')).toBeVisible();
    expect(
      within(needsYou as HTMLElement).queryByText('Governed review item 4'),
    ).not.toBeInTheDocument();
    expect(within(needsYou as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect(document.querySelectorAll('.primary-button')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /Open Attention/i })).toHaveAttribute(
      'href',
      '/attention',
    );
  });

  it('names Gantt state and dates without claiming a multi-part link is exact', () => {
    useHomeResponses();
    renderHome('/?vertical=group_factory');

    const printCell = screen.getByTestId('home-workstream-workstream_print_cell_qualification');
    expect(printCell).toHaveAttribute('href', '/aim?group=group_factory&part=stargate');
    expect(printCell).toHaveAccessibleName(
      /Print cell qualification, Factory operations, Aug 1, 2026 through Aug 15, 2026, COMPLETE, synthetic plan/i,
    );
    expect(screen.getByText(/Aug 1, 2026 – Aug 15, 2026 · COMPLETE/)).toBeVisible();
    expect(
      screen.getByRole('img', { name: /Foundation evidence gate.*unsatisfied/i }),
    ).toBeVisible();
    const tankBarrel = screen.getByTestId('home-workstream-workstream_tank_barrel_production');
    expect(tankBarrel).toHaveAccessibleName(/Open related aim part/i);
    expect(tankBarrel.closest('li')).toHaveTextContent('OPENS RELATED AIM PART');
    expect(screen.getByTestId('home-task-list')).toHaveTextContent('OPEN RELATED AIM PART');
    expect(screen.getByTestId('home-task-list')).not.toHaveTextContent('OPEN EXACT SUBJECT');
  });

  it('keeps valid plan rows when one declared workstream source is not observable', () => {
    const manifest = mutableManifest();
    const planSource = manifest.sources.find(({ id }) => id === 'synthetic_program_plan');
    expect(planSource).toBeDefined();
    if (!planSource) return;
    manifest.sources.push({
      ...planSource,
      id: 'future_plan_source',
      observedAt: '2026-08-18T00:00:00Z',
    });
    const printCell = manifest.workstreams.find(
      ({ id }) => id === 'workstream_print_cell_qualification',
    );
    expect(printCell).toBeDefined();
    if (!printCell) return;
    printCell.sourceRefs = ['future_plan_source'];

    const result = loadHomeProgram(JSON.stringify(manifest));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.planAvailability.available).toBe(true);
    expect(result.model.planAvailability.unavailableCount).toBe(1);
    expect(result.model.planAvailability.message).toMatch(
      /unavailable, future, stale, or conflicting/i,
    );
    const factoryRows = workstreamsForVertical(result.model, 'group_factory');
    expect(factoryRows).toHaveLength(2);
    expect(factoryRows.find(({ id }) => id === printCell.id)).toMatchObject({
      available: false,
      state: null,
      source: 'unavailable',
    });
    expect(factoryRows.find(({ id }) => id === 'workstream_tank_barrel_production')).toMatchObject({
      available: true,
      state: 'in_work',
    });

    useHomeResponses();
    renderHome('/?vertical=group_factory', JSON.stringify(manifest));
    const unavailable = screen.getByTestId('home-workstream-workstream_print_cell_qualification');
    expect(unavailable).toHaveAttribute('role', 'status');
    expect(unavailable).not.toHaveAttribute('href');
    expect(screen.getByTestId('home-workstream-workstream_tank_barrel_production')).toHaveAttribute(
      'href',
      '/aim?group=group_factory&part=s1_fuel_tank',
    );
  });

  it('derives metric and action provenance from every contributing source', () => {
    const seeded = loadHomeProgram(seedManifestText);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    expect(
      metricsForVertical(seeded.model, 'group_factory')
        .slice(0, 3)
        .map(({ source }) => source),
    ).toEqual(['synthetic', 'synthetic', 'synthetic']);
    expect(
      programActionsForVertical(seeded.model, 'group_factory').find(
        ({ eligibility }) => eligibility === 'milestone_blocker',
      ),
    ).toMatchObject({ available: true, source: 'synthetic' });
    expect(workstreamsForVertical(seeded.model, 'group_factory')).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'synthetic' })]),
    );

    const mixedManifest = mutableManifest();
    const planSource = mixedManifest.sources.find(({ id }) => id === 'synthetic_program_plan');
    expect(planSource).toBeDefined();
    if (!planSource) return;
    planSource.synthetic = false;
    const mixed = loadHomeProgram(JSON.stringify(mixedManifest));
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    expect(
      metricsForVertical(mixed.model, 'group_factory')
        .slice(0, 3)
        .map(({ source }) => source),
    ).toEqual(['synthetic', 'synthetic', 'synthetic']);

    const authoritativeManifest = mutableManifest();
    authoritativeManifest.program.synthetic = false;
    for (const source of authoritativeManifest.sources) source.synthetic = false;
    for (const agent of authoritativeManifest.agents) agent.synthetic = false;
    const authoritative = loadHomeProgram(JSON.stringify(authoritativeManifest));
    expect(authoritative.ok).toBe(true);
    if (!authoritative.ok) return;
    expect(
      metricsForVertical(authoritative.model, 'group_factory')
        .slice(0, 3)
        .map(({ source }) => source),
    ).toEqual(['live', 'live', 'live']);
    expect(
      programActionsForVertical(authoritative.model, 'group_factory').find(
        ({ eligibility }) => eligibility === 'milestone_blocker',
      ),
    ).toMatchObject({ available: true, source: 'live' });
    expect(workstreamsForVertical(authoritative.model, 'group_factory')).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'declared' })]),
    );
  });

  it('scopes milestone actions to criterion parts instead of the broader milestone', () => {
    const manifest = mutableManifest();
    const milestone = manifest.milestones.find(({ id }) => id === 'milestone_foundation_gate');
    const criterion = milestone?.gateCriteria.find(
      ({ id }) => id === 'criterion_foundation_verified',
    );
    expect(criterion).toBeDefined();
    if (!criterion) return;
    criterion.affectedPartIds = ['stargate'];

    const result = loadHomeProgram(JSON.stringify(manifest));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const action = programActionsForVertical(result.model, 'group_factory').find(
      ({ eligibility }) => eligibility === 'milestone_blocker',
    );
    expect(action).toBeDefined();
    if (!action) return;
    expect(action).toMatchObject({
      groupIds: ['group_factory'],
      partIds: ['stargate'],
      partTargets: [{ groupId: 'group_factory', partId: 'stargate' }],
    });
    expect(programActionsForVertical(result.model, 'group_structures')).not.toContainEqual(
      expect.objectContaining({ id: action.id }),
    );
  });

  it('fails stale coverage evidence and stale action evidence closed independently', () => {
    const manifest = mutableManifest();
    const coverageEvidence = manifest.evidence.find(({ id }) => id === 'ev_seed_contract');
    const milestoneEvidence = manifest.evidence.find(({ id }) => id === 'ev_foundation_test');
    expect(coverageEvidence).toBeDefined();
    expect(milestoneEvidence).toBeDefined();
    if (!coverageEvidence || !milestoneEvidence) return;
    coverageEvidence.freshnessSlaHours = 1;
    milestoneEvidence.freshnessSlaHours = 1;

    const result = loadHomeProgram(JSON.stringify(manifest));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const metrics = metricsForVertical(result.model, 'group_factory');
    const coverageMetric = metrics.find(({ id }) => id === 'vertical-coverage:group_factory');
    expect(coverageMetric).toMatchObject({ source: 'unavailable', value: '—' });
    expect(coverageMetric).not.toHaveProperty('progressPercent');
    expect(metrics.find(({ id }) => id === 'evidence:group_factory')).toMatchObject({
      source: 'unavailable',
      value: '—',
    });
    expect(
      programActionsForVertical(result.model, 'group_factory').find(
        ({ eligibility }) => eligibility === 'milestone_blocker',
      ),
    ).toMatchObject({ available: false, source: 'unavailable' });
  });

  it('discloses bounded global exception coverage and reports counts as at least', async () => {
    useHomeResponses({
      grants: { items: [], total: 101, activeTotal: 101 },
      plugins: { items: Array.from({ length: 100 }, (_, index) => plugin(index)) },
      schedules: { items: [], total: 51, activeTotal: 51 },
    });
    renderHome('/?vertical=group_factory');

    expect(await screen.findByText(/Authority coverage is incomplete/i)).toBeVisible();
    expect(screen.getByText(/Connection coverage is bounded at 100/i)).toBeVisible();
    expect(screen.getByText(/Schedule coverage is incomplete/i)).toBeVisible();
    expect(screen.getByText(/At least 1 installed connection needs review/i)).toBeVisible();
    expect(
      screen.getAllByText(/at least 2 eligible · source coverage incomplete/i),
    ).not.toHaveLength(0);
    expect(screen.getByTestId('home-scope-summary')).toHaveTextContent(
      /at least 2 next moves · source coverage incomplete/i,
    );
  });

  it('surfaces active schedules due today as global live next moves', async () => {
    const nextRunAt = '2026-08-18T17:00:00.000Z';
    useHomeResponses({
      schedules: {
        items: [automationSchedule(nextRunAt)],
        total: 1,
        activeTotal: 1,
      },
    });
    renderHome('/?vertical=group_factory');

    const task = (await screen.findByText('Daily Brief is scheduled today')).closest('li');
    expect(task).not.toBeNull();
    expect(task).toHaveTextContent('GLOBAL · SCHEDULE DUE TODAY');
    expect(task).toHaveTextContent('1:00 PM EDT');
    expect(task).toHaveTextContent('LIVE · OPEN SCHEDULES');
    expect(within(task as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/operate#operate-schedules',
    );
  });

  it('uses the schedule timezone for eligibility, clock time, and due date near midnight', async () => {
    const scheduleNow = new Date('2026-08-18T06:30:00.000Z');
    const schedule = automationSchedule('2026-08-18T06:45:00.000Z');
    schedule.timezone = 'America/Los_Angeles';
    useHomeResponses({ schedules: { items: [schedule], total: 1, activeTotal: 1 } });
    renderHome('/?vertical=group_factory', undefined, scheduleNow);

    const task = (await screen.findByText('Daily Brief is scheduled today')).closest('li');
    expect(task).not.toBeNull();
    expect(task).toHaveTextContent('11:45 PM PDT');
    expect(task).toHaveTextContent('DUE AUG 17, 2026, 11:45 PM PDT');
    expect(task).not.toHaveTextContent('DUE AUG 18');
  });

  it('does not imply complete global exception coverage while sources are unavailable', async () => {
    useHomeResponses({
      grantsError: true,
      pluginsError: true,
      runsError: true,
      schedulesError: true,
    });
    renderHome('/?vertical=group_factory');

    expect(await screen.findByText(/Authority status unavailable/i)).toBeVisible();
    expect(screen.getByText(/Connections status unavailable/i)).toBeVisible();
    expect(screen.getByText(/Held-run status unavailable/i)).toBeVisible();
    expect(screen.getByText(/Schedule status unavailable/i)).toBeVisible();
    expect(
      screen.getAllByText(/at least 1 eligible · source coverage incomplete/i),
    ).not.toHaveLength(0);
  });
});
