import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithClient } from '../../test/render';
import { platformRunFixture, releaseEvaluationId } from '../../test/server';
import { ApprovalDialog } from './ApprovalDialog';
import { EvidencePage } from './EvidencePage';
import { IncubatorPage } from './IncubatorPage';
import { RegistryPage } from './RegistryPage';
import { RunsPage } from './RunsPage';

describe('Paul OS console surfaces', () => {
  it('lists versioned Git definitions through the shared v1 contract', async () => {
    renderWithClient(<RegistryPage />, ['/registry']);

    const resourceHeading = await screen.findByRole('heading', { name: 'Daily Brief' });
    expect(resourceHeading).toBeInTheDocument();
    expect(within(resourceHeading.closest('article')!).getByText('Skill')).toBeInTheDocument();
    expect(screen.getByText(/VERSIONED RESOURCES/i).parentElement).toHaveTextContent('1');
  });

  it('renders every Plugin transport through one quiet, residency-aware card pattern', async () => {
    const user = userEvent.setup();
    renderWithClient(<RegistryPage />, ['/registry']);

    const pluginHeadings = await screen.findAllByRole('heading', {
      name: /Team messages|Calendar API|Analytics preview|Local files/,
    });
    expect(pluginHeadings).toHaveLength(4);
    const pluginCards = document.querySelectorAll('.plugin-card');
    expect(pluginCards).toHaveLength(4);
    expect(pluginCards[0]).toHaveTextContent('Team messages');
    expect(pluginCards[0]).toHaveAttribute('data-health', 'degraded');
    expect(screen.getByText('mcp')).toBeInTheDocument();
    expect(screen.getByText('http')).toBeInTheDocument();
    expect(screen.getByText('db')).toBeInTheDocument();
    expect(screen.getByText('cli')).toBeInTheDocument();

    const localCard = screen.getByRole('heading', { name: 'Local files' }).closest('article')!;
    expect(
      within(localCard).getByRole('button', { name: 'WORKSTATION UNAVAILABLE' }),
    ).toBeDisabled();

    const analyticsCard = screen
      .getByRole('heading', { name: 'Analytics preview' })
      .closest('article')!;
    await user.click(within(analyticsCard).getByRole('button', { name: 'INSTALL PLUGIN' }));
    const installDialog = screen.getByRole('dialog', { name: 'Analytics preview' });
    await user.click(within(installDialog).getByRole('button', { name: 'INSTALL EXACT VERSION' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Analytics preview' })).not.toBeInTheDocument(),
    );
    expect(
      await within(analyticsCard).findByRole('button', { name: 'MANAGE PLUGIN' }),
    ).toBeInTheDocument();
  });

  it('uses replace-only opaque secret references and protects certified Plugin dependents', async () => {
    const user = userEvent.setup();
    renderWithClient(<RegistryPage />, ['/registry']);

    const calendarCard = (await screen.findByRole('heading', { name: 'Calendar API' })).closest(
      'article',
    )!;
    await user.click(within(calendarCard).getByRole('button', { name: 'MANAGE PLUGIN' }));
    const dialog = screen.getByRole('dialog', { name: 'Calendar API' });
    expect(within(dialog).getByText(/Saving replaces every secret binding/i)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/stored values are intentionally never returned/i),
    ).toBeInTheDocument();
    expect(
      await within(dialog).findByText(/Daily Brief · resource · production/i),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'UNINSTALL' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'TRIGGER KILL SWITCH' })).toBeEnabled();
    const secretReference = within(dialog).getByRole('textbox', { name: /access-token/i });
    expect(secretReference).toHaveValue('');
    await user.type(secretReference, 'env://CALENDAR_TOKEN');
    await user.click(within(dialog).getByRole('button', { name: 'SAVE SECRET REFERENCES' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Calendar API' })).not.toBeInTheDocument(),
    );
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
});
