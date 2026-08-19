import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigate } from 'react-router-dom';
import seedManifestText from '../../../../../03-projects/roadmaps/roadmaps.seed.json?raw';
import { renderWithClient } from '../../test/render';
import { RoadmapsPage } from './RoadmapsPage';

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <button onClick={() => void navigate(-1)} type="button">
        Browser back
      </button>
    </>
  );
}

function renderRoadmaps(path = '/roadmaps') {
  return renderWithClient(
    <>
      <RoadmapsPage />
      <LocationProbe />
    </>,
    [path],
  );
}

interface MutableRoadmapManifest {
  synthetic: boolean;
  forks: Array<{
    jira: {
      state: string;
      projectKey: string | null;
      filterId: string | null;
      includedIssueCount: number | null;
      totalIssueCount: number | null;
      lastSyncedAt: string | null;
    };
    metrics: Array<{ source: string }>;
    workstreams: Array<{ label: string; source: string; startAt: string; endAt: string }>;
    actions: Array<{ source: string }>;
  }>;
}

function mutableSeedManifest(): MutableRoadmapManifest {
  return JSON.parse(seedManifestText) as MutableRoadmapManifest;
}

describe('RoadmapsPage', () => {
  it('makes both private transfer slots and their source boundary unmistakable', () => {
    renderRoadmaps();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Two-fork roadmap demonstration',
    );
    expect(
      screen.getByText('PRIVATE ROADMAP IDENTITIES ARE NOT PRESENT ON THIS MACHINE'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Roadmap fork 01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Roadmap fork 02').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SYNTHETIC').length).toBeGreaterThan(0);
    expect(screen.getByText('AWAITING TRANSFER')).toBeInTheDocument();
    expect(screen.getAllByText('NO ISSUE POPULATION LOADED')).toHaveLength(2);
    expect(screen.getAllByText('NO PRIVATE BINDING LOADED')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'State now' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Plan across six months' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Actions and decisions' })).toBeInTheDocument();
  });

  it('uses one URL-backed fork selection across state, plan, and action bands', async () => {
    const user = userEvent.setup();
    renderRoadmaps();

    await user.click(screen.getByRole('button', { name: 'Roadmap fork 01' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/roadmaps?fork=fork_primary');
    const stateBand = screen.getByRole('heading', { name: 'State now' }).closest('section');
    const planBand = screen
      .getByRole('heading', { name: 'Plan across six months' })
      .closest('section');
    const actionBand = screen
      .getByRole('heading', { name: 'Actions and decisions' })
      .closest('section');
    expect(stateBand).not.toBeNull();
    expect(planBand).not.toBeNull();
    expect(actionBand).not.toBeNull();
    expect(within(stateBand!).getAllByText('Roadmap fork 01').length).toBeGreaterThan(0);
    expect(within(stateBand!).queryByText('Roadmap fork 02')).not.toBeInTheDocument();
    expect(within(planBand!).getByRole('heading', { name: 'Roadmap fork 01' })).toBeInTheDocument();
    expect(
      within(planBand!).queryByRole('heading', { name: 'Roadmap fork 02' }),
    ).not.toBeInTheDocument();
    expect(within(actionBand!).getAllByText('Roadmap fork 01')).toHaveLength(2);
    expect(within(actionBand!).queryByText('Roadmap fork 02')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(screen.getByRole('button', { name: 'Compare both' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('fails closed when the governed two-fork manifest is invalid', () => {
    renderWithClient(<RoadmapsPage manifestText="{}" />, ['/roadmaps']);

    expect(screen.getByRole('heading', { name: 'Roadmap source unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No progress or nominal state is inferred');
    expect(screen.queryByText('ON TRACK')).not.toBeInTheDocument();
  });

  it('switches provenance without a UI rewrite when both Jira bindings become live', () => {
    const manifest = mutableSeedManifest();
    manifest.synthetic = false;
    manifest.forks.forEach((fork, index) => {
      fork.jira = {
        ...fork.jira,
        state: 'live',
        projectKey: `FORK${index + 1}`,
        includedIssueCount: 80,
        totalIssueCount: 100,
        lastSyncedAt: '2026-08-19T12:00:00Z',
      };
      fork.metrics.forEach((metric) => (metric.source = 'live'));
      fork.workstreams.forEach((workstream) => (workstream.source = 'live'));
      fork.actions.forEach((action) => (action.source = 'live'));
    });

    renderWithClient(<RoadmapsPage manifestText={JSON.stringify(manifest)} />, ['/roadmaps']);

    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0);
    expect(screen.queryByText('SYNTHETIC')).not.toBeInTheDocument();
    expect(screen.queryByText('AWAITING TRANSFER')).not.toBeInTheDocument();
    expect(screen.getAllByText('80 OF 100 ISSUES MAPPED')).toHaveLength(2);
    expect(screen.getByText('BOTH GOVERNED JIRA BINDINGS ARE LIVE')).toBeInTheDocument();
    expect(screen.getByText('PROJECT FORK1')).toBeInTheDocument();
    expect(screen.getByText('PROJECT FORK2')).toBeInTheDocument();
    expect(screen.getAllByText(/LAST SYNC/)).toHaveLength(2);
    expect(
      screen.queryByText(/PRIVATE ROADMAP IDENTITIES ARE NOT PRESENT/),
    ).not.toBeInTheDocument();
  });

  it('binds mixed plan provenance to the exact workstream row', () => {
    const manifest = mutableSeedManifest();
    manifest.synthetic = false;
    const firstFork = manifest.forks[0];
    if (!firstFork) throw new Error('Expected first roadmap fork fixture.');
    firstFork.jira = {
      state: 'live',
      projectKey: 'FORK1',
      filterId: null,
      includedIssueCount: 80,
      totalIssueCount: 100,
      lastSyncedAt: '2026-08-19T12:00:00Z',
    };
    const firstWorkstream = firstFork.workstreams[0];
    if (!firstWorkstream) throw new Error('Expected first roadmap workstream fixture.');
    firstWorkstream.source = 'live';

    renderWithClient(<RoadmapsPage manifestText={JSON.stringify(manifest)} />, ['/roadmaps']);

    const liveRow = screen.getByText('Baseline and discovery').closest('li');
    const syntheticRow = screen.getByText('Primary delivery path').closest('li');
    expect(liveRow).not.toBeNull();
    expect(syntheticRow).not.toBeNull();
    expect(within(liveRow!).getByText('LIVE')).toBeInTheDocument();
    expect(within(syntheticRow!).getByText('SYNTHETIC')).toBeInTheDocument();
  });

  it('keeps a one-day workstream proportional on the six-month axis', () => {
    const manifest = mutableSeedManifest();
    const firstWorkstream = manifest.forks[0]?.workstreams[0];
    if (!firstWorkstream) throw new Error('Expected first roadmap workstream fixture.');
    firstWorkstream.startAt = '2026-08-04T00:00:00Z';
    firstWorkstream.endAt = '2026-08-05T00:00:00Z';

    renderWithClient(<RoadmapsPage manifestText={JSON.stringify(manifest)} />, ['/roadmaps']);

    const row = screen.getByText('Baseline and discovery').closest('li');
    const bar = row?.querySelector<HTMLElement>('.roadmap-row-bar');
    const state = row?.querySelector<HTMLElement>('.roadmap-row-state');
    expect(bar).not.toBeNull();
    const exactWidth = Number.parseFloat(bar!.style.getPropertyValue('--roadmap-width'));
    expect(exactWidth).toBeGreaterThan(0);
    expect(exactWidth).toBeLessThan(1);
    expect(bar).toHaveAttribute('data-duration-percent', exactWidth.toFixed(4));
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(bar).toBeEmptyDOMElement();
    expect(state).toHaveTextContent('COMPLETE');
    expect(state).toHaveAttribute('data-state', 'complete');
    expect(state?.parentElement).toHaveClass('roadmap-row-identity');
  });
});
