import { roadmapProgramSchema, type RoadmapProgram } from '@agent-builder/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { useLocation, useNavigate } from 'react-router-dom';
import { renderWithClient } from '../../test/render';
import { roadmapProgramFixture } from '../../test/roadmap-fixture';
import { server } from '../../test/server';
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

function serveRoadmaps(program: RoadmapProgram) {
  server.use(http.get('http://localhost/v1/roadmaps', () => HttpResponse.json(program)));
}

function mutableProgram(): RoadmapProgram {
  return structuredClone(roadmapProgramFixture);
}

describe('RoadmapsPage', () => {
  it('loads its two governed transfer slots from the API and exposes relationship coverage', async () => {
    renderRoadmaps();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Roadmaps');
    expect(
      await screen.findByText('PRIVATE ROADMAP IDENTITIES ARE NOT PRESENT ON THIS MACHINE'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Roadmap fork 01').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Roadmap fork 02').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SYNTHETIC').length).toBeGreaterThan(0);
    expect(screen.getByText('AWAITING TRANSFER')).toBeInTheDocument();
    expect(screen.getAllByText('NO ISSUE POPULATION LOADED')).toHaveLength(2);
    expect(screen.getAllByText('NO PRIVATE BINDING LOADED')).toHaveLength(2);
    expect(screen.getAllByText('Program vertical')).toHaveLength(2);
    expect(screen.getAllByText('Execution runs')).toHaveLength(2);
    expect(screen.getAllByText(/No governed relationship edge is declared/)).toHaveLength(2);
    expect(screen.getAllByText('DEFINITION PINS · 3')).toHaveLength(2);
  });

  it('uses one URL-backed fork selection across state, plan, and action bands', async () => {
    const user = userEvent.setup();
    renderRoadmaps();

    await user.click(await screen.findByRole('button', { name: 'Roadmap fork 01' }));

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
    expect(within(planBand!).queryByRole('heading', { name: 'Roadmap fork 02' })).toBeNull();
    expect(within(actionBand!).getAllByText('Roadmap fork 01')).toHaveLength(2);
    expect(within(actionBand!).queryByText('Roadmap fork 02')).toBeNull();
    expect(
      within(stateBand!).getByText('Is this fork moving, blocked, or waiting for a decision?'),
    ).toBeInTheDocument();
    expect(
      within(planBand!).getByText('Where does this plan carry sequence and risk?'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Compare both' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
  });

  it('fails closed when the backend cannot produce a complete governed projection', async () => {
    server.use(
      http.get('http://localhost/v1/roadmaps', () =>
        HttpResponse.json(
          {
            error: {
              code: 'ROADMAPS_UNAVAILABLE',
              message: 'Roadmap definitions are unavailable.',
              requestId: 'roadmap-test',
            },
          },
          { status: 503 },
        ),
      ),
    );
    renderRoadmaps();

    expect(
      await screen.findByRole('heading', { name: 'Roadmap source unavailable' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('No progress or nominal state is inferred');
    expect(screen.queryByText('ON TRACK')).not.toBeInTheDocument();
  });

  it('switches provenance without a UI rewrite when operational Jira data becomes live', async () => {
    const program = mutableProgram();
    program.synthetic = false;
    program.forks.forEach((fork, index) => {
      fork.source = 'live';
      fork.jira = {
        state: 'live',
        projectKey: `FORK${index + 1}`,
        filterId: null,
        includedIssueCount: 80,
        totalIssueCount: 100,
        lastSyncedAt: '2026-08-19T12:00:00Z',
      };
      fork.metrics.forEach((metric) => (metric.source = 'live'));
      fork.workstreams.forEach((workstream) => (workstream.source = 'live'));
      fork.actions.forEach((action) => (action.source = 'live'));
    });
    serveRoadmaps(roadmapProgramSchema.parse(program));
    renderRoadmaps();

    expect((await screen.findAllByText('LIVE')).length).toBeGreaterThan(0);
    expect(screen.queryByText('SYNTHETIC')).not.toBeInTheDocument();
    expect(screen.queryByText('AWAITING TRANSFER')).not.toBeInTheDocument();
    expect(screen.getAllByText('80 OF 100 ISSUES MAPPED')).toHaveLength(2);
    expect(screen.getByText('BOTH GOVERNED JIRA BINDINGS ARE LIVE')).toBeInTheDocument();
    expect(screen.getByText('PROJECT FORK1')).toBeInTheDocument();
    expect(screen.getByText('PROJECT FORK2')).toBeInTheDocument();
  });

  it('binds mixed plan provenance to the exact workstream row', async () => {
    const program = mutableProgram();
    program.synthetic = false;
    const firstFork = program.forks[0];
    const secondFork = program.forks[1];
    if (!firstFork || !secondFork) throw new Error('Expected the governed two-fork fixture.');
    firstFork.source = 'live';
    firstFork.jira = {
      state: 'live',
      projectKey: 'FORK1',
      filterId: null,
      includedIssueCount: 80,
      totalIssueCount: 100,
      lastSyncedAt: '2026-08-19T12:00:00Z',
    };
    firstFork.workstreams[0]!.source = 'live';
    secondFork.source = 'awaiting_transfer';
    serveRoadmaps(roadmapProgramSchema.parse(program));
    renderRoadmaps();

    const liveRow = (await screen.findByText('Baseline and discovery')).closest('li');
    const syntheticRow = screen.getByText('Primary delivery path').closest('li');
    expect(within(liveRow!).getByText('LIVE')).toBeInTheDocument();
    expect(within(syntheticRow!).getByText('SYNTHETIC')).toBeInTheDocument();
  });

  it('keeps a one-day workstream proportional on the six-month axis', async () => {
    const program = mutableProgram();
    const firstFork = program.forks[0];
    if (!firstFork) throw new Error('Expected the first governed roadmap fixture.');
    firstFork.workstreams[0]!.startAt = '2026-08-04T00:00:00Z';
    firstFork.workstreams[0]!.endAt = '2026-08-05T00:00:00Z';
    serveRoadmaps(roadmapProgramSchema.parse(program));
    renderRoadmaps();

    const row = (await screen.findByText('Baseline and discovery')).closest('li');
    const bar = row?.querySelector<HTMLElement>('.roadmap-row-bar');
    const state = row?.querySelector<HTMLElement>('.roadmap-row-state');
    const exactWidth = Number.parseFloat(bar!.style.getPropertyValue('--roadmap-width'));
    expect(exactWidth).toBeGreaterThan(0);
    expect(exactWidth).toBeLessThan(1);
    expect(bar).toHaveAttribute('data-duration-percent', exactWidth.toFixed(4));
    expect(bar).toHaveAttribute('aria-hidden', 'true');
    expect(state).toHaveTextContent('COMPLETE');
  });

  it('renders navigable typed targets while keeping exact provenance subordinate', async () => {
    const program = mutableProgram();
    const fork = program.forks[0];
    if (!fork) throw new Error('Expected the first governed roadmap fixture.');
    const agentTarget = {
      resourceVersionId: '41000000-0000-4000-8000-000000000001',
      familyId: '42000000-0000-4000-8000-000000000001',
      kind: 'Agent' as const,
      slug: 'workflow-agent',
      name: 'Workflow agent',
      version: '2.1.0',
      digest: 'b'.repeat(64),
    };
    fork.definitionDependencies.push({
      id: 'dependency_agent_binding',
      role: 'source',
      provenance: 'declared',
      target: agentTarget,
    });
    const { kind: resourceKind, ...exactAgentTarget } = agentTarget;
    fork.relationshipCoverage.vertical.state = 'mapped';
    fork.relationshipCoverage.aimGroup.state = 'mapped';
    fork.relationshipCoverage.contributingAgents.state = 'mapped';
    fork.relationships = [
      {
        id: 'edge_primary_vertical',
        direction: 'outbound',
        predicate: 'scoped_to_vertical',
        source: fork.resource,
        target: {
          kind: 'vertical',
          namespace: 'home.vertical',
          schemaVersion: 'v1',
          id: 'group_factory',
        },
        provenance: 'declared',
        sourceRef: {
          definitionDependencyId: 'dependency_planning_source',
          locator: 'fixture://roadmaps/fork-primary#vertical',
        },
      },
      {
        id: 'edge_primary_aim',
        direction: 'outbound',
        predicate: 'maps_to_aim_group',
        source: fork.resource,
        target: {
          kind: 'aim_group',
          namespace: 'aim_capability_vehicle',
          schemaVersion: 'aim.program/v2',
          id: 'group_factory',
        },
        provenance: 'declared',
        sourceRef: {
          definitionDependencyId: 'dependency_planning_source',
          locator: 'fixture://roadmaps/fork-primary#aim',
        },
      },
      {
        id: 'edge_primary_agent',
        direction: 'outbound',
        predicate: 'contributed_to_by_agent',
        source: fork.resource,
        target: { kind: 'resource_version', resourceKind, ...exactAgentTarget },
        provenance: 'declared',
        sourceRef: {
          definitionDependencyId: 'dependency_agent_binding',
          locator: 'fixture://roadmaps/fork-primary#agent',
        },
      },
    ];
    serveRoadmaps(roadmapProgramSchema.parse(program));
    const user = userEvent.setup();
    renderRoadmaps('/roadmaps?fork=fork_primary');

    const factoryLinks = await screen.findAllByRole('link', { name: /factory/i });
    expect(factoryLinks[0]).toHaveAttribute('href', '/?vertical=group_factory');
    expect(factoryLinks[1]).toHaveAttribute('href', '/aim?group=group_factory');
    expect(screen.getByRole('link', { name: /Workflow agent/ })).toHaveAttribute(
      'href',
      '/catalog?resource=41000000-0000-4000-8000-000000000001',
    );
    expect(
      screen.getByText('dependency_agent_binding · fixture://roadmaps/fork-primary#agent'),
    ).not.toBeVisible();
    await user.click(screen.getAllByText('EDGE EVIDENCE')[2]!);
    expect(
      screen.getByText('dependency_agent_binding · fixture://roadmaps/fork-primary#agent'),
    ).toBeVisible();
  });
});
