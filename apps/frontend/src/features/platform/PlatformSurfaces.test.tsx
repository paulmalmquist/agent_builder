import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { renderWithClient } from '../../test/render';
import { releaseEvaluationId } from '../../test/server';
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

  it('separates approval-required runs from revocable authority envelopes', async () => {
    const user = userEvent.setup();
    renderWithClient(<RunsPage />, ['/runs']);

    expect(await screen.findByText('awaiting approval')).toBeInTheDocument();
    expect(
      screen.getByText('Permit bounded synthetic daily briefing executions.'),
    ).toBeInTheDocument();
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
    await user.click(within(dialog).getByRole('button', { name: 'Approve & queue run' }));

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
