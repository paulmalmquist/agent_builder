import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { App } from './App';
import { renderWithClient } from './test/render';
import { server } from './test/server';

async function defineScope(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /open step 01/i }));
  await user.type(screen.getByLabelText('Agent name'), 'Supplier continuity analyst');
  await user.type(screen.getByLabelText('Department'), 'Manufacturing Operations');
  await user.type(
    screen.getByLabelText('Job to be done'),
    'Monitor supplier delays and prepare an evidence-backed escalation brief.',
  );
  await user.type(screen.getByLabelText('Primary users'), 'Supply planners and program managers');
  await user.type(screen.getByLabelText('Desired outcomes'), 'Identify at-risk builds');
  await user.click(screen.getByRole('button', { name: 'Find reusable agents' }));
}

async function completeSpecification(user: ReturnType<typeof userEvent.setup>) {
  await defineScope(user);
  await user.click(
    await screen.findByRole('button', {
      name: /none of these fit — build a new agent/i,
    }),
  );
  expect(await screen.findByText(/New draft created/i)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /open step 02/i }));
  await user.click(await screen.findByLabelText(/Build genealogy/i));
  await user.click(screen.getByRole('button', { name: 'Save knowledge & access' }));
  expect(await screen.findByText('Knowledge saved.')).toBeInTheDocument();

  await user.click(await screen.findByRole('button', { name: /open step 03/i }));
  await user.click(screen.getByRole('button', { name: 'Save actions & workflow' }));
  expect(await screen.findByText('Guardrails saved.')).toBeInTheDocument();

  await user.click(await screen.findByRole('button', { name: /open step 04/i }));
  await user.click(screen.getByRole('button', { name: 'Save success criteria' }));
  expect(await screen.findByText('Outputs saved.')).toBeInTheDocument();
}

describe('Agent Builder workflow', () => {
  it('unlocks each workflow step only after its predecessor is complete', async () => {
    const user = userEvent.setup();
    renderWithClient(<App />);

    const step01 = screen.getByRole('button', { name: /open step 01/i });
    const step02 = screen.getByRole('button', { name: /open step 02/i });
    const step03 = screen.getByRole('button', { name: /open step 03/i });
    const step04 = screen.getByRole('button', { name: /open step 04/i });

    expect(step01).toHaveAttribute('aria-disabled', 'false');
    expect(step02).toHaveAttribute('aria-disabled', 'true');
    expect(step02).not.toBeDisabled();
    expect(step03).toHaveAttribute('aria-disabled', 'true');
    expect(step04).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('LOCKED · COMPLETE STEP 01 FIRST')).toBeInTheDocument();

    await user.click(step02);
    expect(await screen.findByText('Complete step 01 first.')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Define knowledge & access' }),
    ).not.toBeInTheDocument();

    await defineScope(user);
    await user.click(
      await screen.findByRole('button', {
        name: /none of these fit — build a new agent/i,
      }),
    );
    expect(await screen.findByText(/New draft created/i)).toBeInTheDocument();
    await waitFor(() => expect(step02).toHaveAttribute('aria-disabled', 'false'));
    expect(step03).toHaveAttribute('aria-disabled', 'true');

    await user.click(step03);
    expect(await screen.findByText('Complete step 02 first.')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Define actions & workflow' }),
    ).not.toBeInTheDocument();

    await user.click(step02);
    await user.click(await screen.findByLabelText(/Build genealogy/i));
    await user.click(screen.getByRole('button', { name: 'Save knowledge & access' }));
    expect(await screen.findByText('Knowledge saved.')).toBeInTheDocument();
    await waitFor(() => expect(step03).toHaveAttribute('aria-disabled', 'false'));
    expect(step04).toHaveAttribute('aria-disabled', 'true');

    await user.click(step04);
    expect(await screen.findByText('Complete step 03 first.')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Define success criteria' }),
    ).not.toBeInTheDocument();

    await user.click(step03);
    await user.click(screen.getByRole('button', { name: 'Save actions & workflow' }));
    expect(await screen.findByText('Guardrails saved.')).toBeInTheDocument();
    await waitFor(() => expect(step04).toHaveAttribute('aria-disabled', 'false'));
  });

  it('honors pre-completed sections returned by a branched specification', async () => {
    const agentId = '11111111-1111-4111-8111-111111111111';
    const specId = '22222222-2222-4222-8222-222222222222';
    const now = '2026-07-31T14:00:00.000Z';
    const branchedSpec = {
      id: specId,
      agentId,
      baseAgentId: agentId,
      derivationMode: 'configure',
      interpretationId: null,
      unconfirmedPrefill: null,
      status: 'draft',
      revision: 3,
      outcomes: {
        name: 'Supplier continuity analyst',
        department: 'Manufacturing Operations',
        purpose: 'Monitor supplier delays and prepare an evidence-backed escalation brief.',
        audience: 'Supply planners and program managers',
        desiredOutcomes: ['Identify at-risk builds'],
        humanBaseline: 'A planner reconciles reports in 45 minutes.',
        exclusions: ['Changing purchase orders'],
      },
      knowledge: {
        sources: [
          {
            descriptorId: 'relativity-mes-genealogy',
            purpose: 'Trace delayed supply to affected builds',
            requiredCitations: true,
          },
        ],
      },
      guardrails: {
        workflowStages: ['Retrieve governed evidence', 'Draft the requested output'],
        prohibitedActions: [],
        approvalRequirements: [],
        failClosedConditions: ['Stop when a required source is unavailable'],
        responseRequirements: {
          citations: true,
          confidence: true,
          unresolvedConflicts: true,
        },
      },
      outputs: null,
      completion: {
        outcomes: true,
        knowledge: true,
        guardrails: true,
        outputs: false,
      },
      createdAt: now,
      updatedAt: now,
    };
    server.use(
      http.post('http://localhost/agents/specs', () =>
        HttpResponse.json(branchedSpec, { status: 201 }),
      ),
      http.get(`http://localhost/agents/specs/${specId}`, () => HttpResponse.json(branchedSpec)),
    );

    const user = userEvent.setup();
    renderWithClient(<App />);
    await defineScope(user);
    await user.click(await screen.findByRole('button', { name: /Supplier Risk Analyst/i }));
    await user.click(await screen.findByRole('button', { name: /^Configure/i }));

    expect(await screen.findByText(/Configured branch created/i)).toBeInTheDocument();
    const step02 = screen.getByRole('button', { name: /open step 02/i });
    const step03 = screen.getByRole('button', { name: /open step 03/i });
    const step04 = screen.getByRole('button', { name: /open step 04/i });
    await waitFor(() => {
      expect(step02).toHaveAttribute('aria-disabled', 'false');
      expect(step03).toHaveAttribute('aria-disabled', 'false');
      expect(step04).toHaveAttribute('aria-disabled', 'false');
    });
    expect(step04.closest('.workflow-row')).toHaveAttribute('data-next-actionable', 'true');
  });

  it('searches the canonical catalog before creating a draft', async () => {
    const user = userEvent.setup();
    renderWithClient(<App />);

    expect(screen.getAllByText('DEFINE SCOPE & PURPOSE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DEFINE KNOWLEDGE & ACCESS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DEFINE ACTIONS & WORKFLOW').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DEFINE SUCCESS CRITERIA').length).toBeGreaterThan(0);

    await defineScope(user);

    expect(await screen.findByText(/Reuse candidates are ranked/i)).toBeInTheDocument();
    expect(await screen.findByText('87% MATCH')).toBeInTheDocument();
    expect(screen.getByText(/Closest semantic match: 87%/i)).toBeInTheDocument();
  });

  it('completes all sections, generates, and enters shadow evaluation', async () => {
    const user = userEvent.setup();
    renderWithClient(<App />);

    await completeSpecification(user);

    await user.click(await screen.findByRole('button', { name: /review & generate/i }));
    await user.click(screen.getByRole('button', { name: 'Generate agent' }));

    expect(await screen.findByText('Agent manifest generated')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deploy to shadow' }));

    await waitFor(() => {
      expect(screen.getByText('100% passed')).toBeInTheDocument();
    });
    expect(screen.getByText('Produces a governed answer')).toBeInTheDocument();
  });

  it('shows structured generation failure and recovers the agent to draft', async () => {
    const jobId = '33333333-3333-4333-8333-333333333333';
    const agentId = '11111111-1111-4111-8111-111111111111';
    const specId = '22222222-2222-4222-8222-222222222222';
    let recoverCalls = 0;
    server.use(
      http.get(`http://localhost/agents/generation-jobs/${jobId}`, () =>
        HttpResponse.json({
          id: jobId,
          agentId,
          specId,
          state: 'failed',
          progress: 35,
          message: 'Backend restarted while generation was running',
          specRevision: 4,
          generatorVersion: '0.2.0',
          manifest: null,
          error: {
            code: 'ORPHANED_ON_RESTART',
            message: 'Backend restarted while generation was running',
          },
          createdAt: '2026-07-31T14:00:00.000Z',
          updatedAt: '2026-07-31T14:00:00.000Z',
        }),
      ),
      http.post(`http://localhost/agents/${agentId}/recover`, () => {
        recoverCalls += 1;
        return HttpResponse.json({ agentId, status: 'draft' });
      }),
    );

    const user = userEvent.setup();
    renderWithClient(<App />);
    await completeSpecification(user);
    await user.click(await screen.findByRole('button', { name: /review & generate/i }));
    await user.click(screen.getByRole('button', { name: 'Generate agent' }));

    expect(await screen.findByText('ORPHANED_ON_RESTART')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Backend restarted while generation was running',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recover agent to draft' }));

    expect(
      await screen.findByText(/The agent is back in draft and the ready specification/i),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /review & generate/i })).toBeInTheDocument();
    expect(recoverCalls).toBe(1);
  });
});
