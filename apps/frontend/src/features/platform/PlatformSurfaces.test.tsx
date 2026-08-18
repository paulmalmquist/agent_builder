import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes } from 'react-router-dom';
import { renderWithClient } from '../../test/render';
import { platformRunFixture, releaseEvaluationId, server } from '../../test/server';
import { ApprovalDialog } from './ApprovalDialog';
import { EvidencePage } from './EvidencePage';
import { IncubatorPage } from './IncubatorPage';
import { RegistryPage } from './RegistryPage';
import { RunsPage } from './RunsPage';

describe('Paul OS console surfaces', () => {
  function unavailable(message: string) {
    return HttpResponse.json(
      {
        error: {
          code: 'DEPENDENCY_UNAVAILABLE',
          message,
          requestId: 'test-request',
        },
      },
      { status: 500 },
    );
  }

  it('lists versioned Git definitions through the shared v1 contract', async () => {
    renderWithClient(<RegistryPage />, ['/registry']);

    const resourceHeading = await screen.findByRole('heading', { name: 'Daily Brief' });
    expect(resourceHeading).toBeInTheDocument();
    expect(within(resourceHeading.closest('article')!).getByText('Skill')).toBeInTheDocument();
    expect(screen.getByText(/VERSIONED RESOURCES/i).parentElement).toHaveTextContent('137');
    expect(screen.getByText('PRODUCTION').parentElement).toHaveTextContent('23');
    expect(screen.getByText('CANDIDATE').parentElement).toHaveTextContent('12');
    expect(screen.getByText('DEPRECATED').parentElement).toHaveTextContent('2');
  });

  it('hides cached Registry data and nominal readings when its dependencies fail', async () => {
    const { client } = renderWithClient(<RegistryPage />, ['/registry']);
    expect(await screen.findByRole('heading', { name: 'Daily Brief' })).toBeInTheDocument();

    server.use(
      http.get('http://localhost/v1/resources', () => unavailable('Registry is unavailable.')),
    );

    await client.invalidateQueries({ queryKey: ['platform-resources'] });

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Registry is unavailable.');
    expect(screen.queryByRole('heading', { name: 'Daily Brief' })).not.toBeInTheDocument();
    expect(screen.queryByText('No imported definitions match.')).not.toBeInTheDocument();
    for (const label of ['VERSIONED RESOURCES', 'PRODUCTION', 'CANDIDATE', 'DEPRECATED']) {
      expect(screen.getByText(label).parentElement).toHaveTextContent('—');
    }
  });

  it('only submits selected server-derived Plugin scopes at equal or lower ceilings', async () => {
    const user = userEvent.setup();
    const baseRun = platformRunFixture();
    const run = {
      ...baseRun,
      requiredPluginScopes: [
        baseRun.requiredPluginScopes[0]!,
        {
          ...baseRun.requiredPluginScopes[0]!,
          tool: 'list_tasks',
          scopeDescription: 'Read task records in the requested project only',
        },
      ],
    };
    const onApprove = vi.fn();
    renderWithClient(
      <ApprovalDialog
        error={null}
        isApproving={false}
        onApprove={onApprove}
        onClose={() => undefined}
        run={run}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Approve execution envelope' });
    const recordCaps = within(dialog).getAllByRole('spinbutton', { name: 'Record cap' });
    expect(recordCaps[0]).toHaveAttribute('max', '100');
    await user.click(recordCaps[0]!);
    await user.keyboard('{Control>}a{/Control}50');
    await user.click(
      within(dialog).getByRole('checkbox', {
        name: /Read task records in the requested project only/i,
      }),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Approve authority' }));

    expect(onApprove).toHaveBeenCalledOnce();
    const submitted = onApprove.mock.calls[0]![0];
    expect(submitted.entryResourceVersionId).toBe(run.entryResourceVersionId);
    expect(submitted.pluginScopes).toHaveLength(1);
    expect(submitted.pluginScopes[0]).toMatchObject({
      tool: 'list_events',
      limits: { maxRecords: 50 },
    });
    expect(submitted.pluginScopes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ tool: 'list_tasks' })]),
    );
  });

  it('separates approval-required runs from revocable authority envelopes', async () => {
    const user = userEvent.setup();
    renderWithClient(<RunsPage />, ['/runs']);

    expect(await screen.findByText('awaiting approval')).toBeInTheDocument();
    expect(screen.getByText('AWAITING APPROVAL').parentElement).toHaveTextContent('27');
    expect(screen.getByText('ACTIVE RUNS').parentElement).toHaveTextContent('7');
    expect(screen.getByText('ACTIVE GRANTS').parentElement).toHaveTextContent('19');
    expect(screen.getByText('ACTIVE SCHEDULES').parentElement).toHaveTextContent('8');
    expect(
      screen.getByText('Permit bounded synthetic daily briefing executions.'),
    ).toBeInTheDocument();
    await user.click(screen.getByText('FLIGHT RECORDER'));
    const flightRecorder = screen.getByRole('list', { name: /Run .* phases/i });
    for (const phase of ['REQUEST', 'AUTHORITY', 'EXECUTION', 'OUTCOME']) {
      expect(within(flightRecorder).getByText(phase)).toBeInTheDocument();
    }
    const scheduleHeading = await screen.findByRole('heading', {
      name: 'Daily operations briefing',
    });
    const scheduleCard = scheduleHeading.closest('article')!;
    await user.click(within(scheduleCard).getByRole('button', { name: 'PAUSE SCHEDULE' }));
    expect(
      await within(scheduleCard).findByRole('button', { name: 'RESUME SCHEDULE' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'REVIEW AUTHORITY REQUEST' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve execution envelope' });
    expect(within(dialog).getByText(/applies only to release/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve authority' }));

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Approve execution envelope' }),
      ).not.toBeInTheDocument();
    });
    expect(await screen.findByText('queued')).toBeInTheDocument();
  });

  it('discloses every failed run dependency and hides cached ledger data', async () => {
    const { client } = renderWithClient(<RunsPage />, ['/runs']);
    expect(await screen.findByText('awaiting approval')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Daily operations briefing' }),
    ).toBeInTheDocument();

    server.use(
      http.get('http://localhost/v1/execution-runs', () => unavailable('Runs are unavailable.')),
      http.get('http://localhost/v1/authority-grants', () =>
        unavailable('Authority grants are unavailable.'),
      ),
      http.get('http://localhost/v1/automation-schedules', () =>
        unavailable('Schedules are unavailable.'),
      ),
    );

    await Promise.all([
      client.invalidateQueries({ queryKey: ['execution-runs'] }),
      client.invalidateQueries({ queryKey: ['authority-grants'] }),
      client.invalidateQueries({ queryKey: ['automation-schedules'] }),
    ]);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(3);
    expect(alerts.map((alert) => alert.textContent)).toEqual(
      expect.arrayContaining([
        'Execution ledger unavailable. Runs are unavailable.',
        'Authority envelopes unavailable. Authority grants are unavailable.',
        'Durable schedules unavailable. Schedules are unavailable.',
      ]),
    );
    expect(screen.queryByText('awaiting approval')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Permit bounded synthetic daily briefing executions.'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Daily operations briefing' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No execution runs yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('No authority has been granted.')).not.toBeInTheDocument();
    expect(screen.queryByText('No durable schedules configured.')).not.toBeInTheDocument();
    for (const label of ['AWAITING APPROVAL', 'ACTIVE RUNS', 'ACTIVE GRANTS', 'ACTIVE SCHEDULES']) {
      expect(screen.getByText(label).parentElement).toHaveTextContent('—');
    }
  });

  it('shows validated outcomes and measured cost without rendering raw output payloads', async () => {
    renderWithClient(<EvidencePage />, [`/evidence?evaluation=${releaseEvaluationId}`]);

    expect(await screen.findByRole('heading', { name: 'Outcome 17171717' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current production release' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Deterministic contract evaluation' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Server-owned gate results')).toHaveTextContent(
      'SCHEMA CONFORMANCE · manifest declaration100%',
    );
    expect(screen.getByLabelText('Server-owned gate results')).toHaveTextContent(
      'MEAN COST · execution historyN/Anot applicable',
    );
    expect(screen.getAllByText(/does not measure semantic model quality/i).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole('heading', { name: 'provider cost usd' })).toBeInTheDocument();
    expect(screen.getByText('$0.0032')).toBeInTheDocument();
    expect(screen.queryByText('Protect the focus block')).not.toBeInTheDocument();
    expect(screen.queryByText('synthetic-test')).not.toBeInTheDocument();
  });

  it('discloses every failed evidence source and hides cached evidence', async () => {
    const { client } = renderWithClient(<EvidencePage />, ['/evidence']);
    expect(await screen.findByRole('heading', { name: 'Outcome 17171717' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'provider cost usd' })).toBeInTheDocument();

    server.use(
      http.get('http://localhost/v1/outcomes', () => unavailable('Outcomes are unavailable.')),
      http.get('http://localhost/v1/metrics', () => unavailable('Metrics are unavailable.')),
    );

    await Promise.all([
      client.invalidateQueries({ queryKey: ['outcomes'] }),
      client.invalidateQueries({ queryKey: ['metrics'] }),
    ]);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(alerts.map((alert) => alert.textContent)).toEqual(
      expect.arrayContaining([
        'Outcomes unavailable. Outcomes are unavailable.',
        'Metrics unavailable. Metrics are unavailable.',
      ]),
    );
    expect(screen.queryByRole('heading', { name: 'Outcome 17171717' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'provider cost usd' })).not.toBeInTheDocument();
    expect(screen.queryByText('No outcomes have been recorded.')).not.toBeInTheDocument();
    expect(screen.queryByText('No metrics have been observed.')).not.toBeInTheDocument();
    for (const label of ['OUTCOMES SHOWN', 'METRICS SHOWN', 'CITED SHOWN', 'UNRESOLVED SHOWN']) {
      expect(screen.getByText(label).parentElement).toHaveTextContent('—');
    }
  });

  it('keeps incubator learning and durable memory human-curated', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <Routes>
        <Route element={<IncubatorPage />} path="/incubator" />
        <Route element={<div>Candidate registry</div>} path="/registry" />
      </Routes>,
      ['/incubator'],
    );

    expect(screen.getByRole('heading', { name: 'Incubator' })).toBeInTheDocument();
    expect(
      await screen.findByText(
        'A synthetic briefing left one priority without a supporting schedule reference.',
      ),
    ).toBeInTheDocument();
    const improvementHeading = screen.getByRole('heading', {
      name: 'Require a schedule reference for time-bound priorities',
    });
    const improvementCard = improvementHeading.closest('article')!;
    await user.click(within(improvementCard).getByRole('button', { name: 'RECORD DECISION' }));
    expect(await screen.findByText(/entered the governed incubator/i)).toBeInTheDocument();

    const memoryHeading = screen.getByRole('heading', { name: 'preferences.briefing' });
    const memoryCard = memoryHeading.closest('article')!;
    await user.click(within(memoryCard).getByRole('button', { name: 'RECORD MEMORY DECISION' }));
    expect(await screen.findByText(/accepted as an immutable memory record/i)).toBeInTheDocument();

    expect(screen.queryByText('fixture://observation/priority')).not.toBeInTheDocument();
    expect(screen.queryByText('schedule-risk-first')).not.toBeInTheDocument();
    expect(screen.getByText(/may not apply, commit, certify, or promote/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view candidate definitions/i })).toHaveAttribute(
      'href',
      '/registry?kind=ImprovementCandidate&lifecycle=experimental',
    );
  });

  it('discloses every failed learning source and hides cached ledger data', async () => {
    const { client } = renderWithClient(<IncubatorPage />, ['/incubator']);
    expect(
      await screen.findByText(
        'A synthetic briefing left one priority without a supporting schedule reference.',
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', {
        name: 'Require a schedule reference for time-bound priorities',
      }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'preferences.briefing' }),
    ).toBeInTheDocument();

    server.use(
      http.get('http://localhost/v1/observations', () =>
        unavailable('Observations are unavailable.'),
      ),
      http.get('http://localhost/v1/improvement-candidates', () =>
        unavailable('Candidates are unavailable.'),
      ),
      http.get('http://localhost/v1/memory-candidates', () =>
        unavailable('Memory staging is unavailable.'),
      ),
    );

    await Promise.all([
      client.invalidateQueries({ queryKey: ['observations'] }),
      client.invalidateQueries({ queryKey: ['improvement-candidates'] }),
      client.invalidateQueries({ queryKey: ['memory-candidates'] }),
    ]);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(3);
    expect(alerts.map((alert) => alert.textContent)).toEqual(
      expect.arrayContaining([
        'Observations unavailable. Observations are unavailable.',
        'Improvement candidates unavailable. Candidates are unavailable.',
        'Staged memory unavailable. Memory staging is unavailable.',
      ]),
    );
    expect(
      screen.queryByText(
        'A synthetic briefing left one priority without a supporting schedule reference.',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'Require a schedule reference for time-bound priorities',
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'preferences.briefing' })).not.toBeInTheDocument();
    expect(screen.queryByText('No governed observations recorded.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('No improvement candidates are awaiting curation.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No durable-memory writes are staged.')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Observations' }).parentElement).toHaveTextContent(
      '— SIGNALS SHOWN',
    );
  });
});
