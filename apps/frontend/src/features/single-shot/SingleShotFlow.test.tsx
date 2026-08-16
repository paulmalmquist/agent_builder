import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../../App';
import { renderWithClient } from '../../test/render';
import {
  interpretationId,
  lastKnowledgeConfirmation,
  lastOutcomesConfirmation,
  server,
} from '../../test/server';

describe('single-shot specification input', () => {
  it('prefills governed sections, runs reuse discovery, and escalates requested authority', async () => {
    const user = userEvent.setup();
    renderWithClient(<App />, ['/?mode=single-shot']);

    const prompt =
      'Monitor supplier delays using build genealogy, write updates to production holds, and report evidence coverage.';
    await user.type(screen.getByLabelText('Agent brief'), prompt);
    await user.click(screen.getByRole('button', { name: 'Interpret brief' }));

    expect(
      await screen.findByText('INTERPRETATION READY · HUMAN REVIEW REQUIRED'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Production writes require explicit human approval/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/approval required/i)).toBeInTheDocument();
    expect(await screen.findByText('87% MATCH')).toBeInTheDocument();
    expect(screen.queryByText(/New draft created/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open step 02/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('requires an explicit scope save before an interpreted draft can be created', async () => {
    const user = userEvent.setup();
    let specCreationRequests = 0;
    const recordSpecCreation = ({ request }: { request: Request; requestId: string }) => {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/agents/specs') {
        specCreationRequests += 1;
      }
    };
    server.events.on('request:start', recordSpecCreation);

    try {
      renderWithClient(<App />, ['/?mode=single-shot']);

      await user.type(
        screen.getByLabelText('Agent brief'),
        'Monitor supplier delays and prepare an evidence-backed escalation brief.',
      );
      await user.click(screen.getByRole('button', { name: 'Interpret brief' }));
      expect(await screen.findByText('87% MATCH')).toBeInTheDocument();

      await user.click(
        screen.getByRole('button', { name: /None of these fit — Build a new agent/i }),
      );

      expect(specCreationRequests).toBe(0);
      expect(
        screen.getByText('Review and save the interpreted scope before creating a draft.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('dialog', { name: 'Define scope & purpose' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Find reusable agents' }));
      await user.click(
        screen.getByRole('button', { name: /None of these fit — Build a new agent/i }),
      );

      expect(
        await screen.findByText('New draft created. Continue with governed knowledge.'),
      ).toBeInTheDocument();
      expect(specCreationRequests).toBe(1);
      expect(lastOutcomesConfirmation).toEqual({ interpretationId, resolutions: [] });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /open step 02/i })).toHaveAttribute(
          'aria-disabled',
          'false',
        ),
      );
    } finally {
      server.events.removeListener('request:start', recordSpecCreation);
    }
  });

  it('blocks an unknown source until the user explicitly maps or removes it', async () => {
    const user = userEvent.setup();
    renderWithClient(<App />, ['/?mode=single-shot']);

    await user.type(
      screen.getByLabelText('Agent brief'),
      'Monitor supplier delays using our ERP and prepare an evidence-backed escalation brief.',
    );
    await user.click(screen.getByRole('button', { name: 'Interpret brief' }));
    expect(await screen.findByText('87% MATCH')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /None of these fit — Build a new agent/i }),
    );
    await user.click(screen.getByRole('button', { name: 'Find reusable agents' }));
    await user.click(
      screen.getByRole('button', { name: /None of these fit — Build a new agent/i }),
    );
    expect(
      await screen.findByText('New draft created. Continue with governed knowledge.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open step 02/i }));
    const saveKnowledge = await screen.findByRole('button', {
      name: 'Save knowledge & access',
    });
    expect(saveKnowledge).toBeDisabled();

    const sourceResolution = screen.getByLabelText('Resolution for our ERP');
    expect(screen.getByRole('option', { name: /Map to Build genealogy/i })).toBeInTheDocument();
    await user.selectOptions(sourceResolution, 'remove');
    expect(saveKnowledge).toBeEnabled();
    await user.click(saveKnowledge);

    expect(await screen.findByText('Knowledge saved.')).toBeInTheDocument();
    expect(lastKnowledgeConfirmation?.resolutions).toContainEqual({
      unresolvedId: 'unknown-source-erp',
      action: 'remove',
    });
    expect(screen.getByRole('button', { name: /open step 03/i })).toHaveAttribute(
      'aria-disabled',
      'false',
    );
  });

  it('never overwrites a guided section that was already confirmed', async () => {
    const user = userEvent.setup();
    renderWithClient(<App />);

    await user.click(screen.getByRole('button', { name: /open step 01/i }));
    await user.type(screen.getByLabelText('Agent name'), 'Human Confirmed Agent');
    await user.type(screen.getByLabelText('Department'), 'Program Operations');
    await user.type(
      screen.getByLabelText('Job to be done'),
      'Review governed program risks and draft a traceable action brief.',
    );
    await user.type(screen.getByLabelText('Primary users'), 'Program managers');
    await user.type(screen.getByLabelText('Desired outcomes'), 'Produce a traceable action brief');
    await user.click(screen.getByRole('button', { name: 'Find reusable agents' }));
    await user.click(
      await screen.findByRole('button', {
        name: /None of these fit — Build a new agent/i,
      }),
    );
    expect(
      await screen.findByText('New draft created. Continue with governed knowledge.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Single-shot' }));
    await user.type(
      screen.getByLabelText('Agent brief'),
      'Monitor supplier delays and prepare an evidence-backed escalation brief.',
    );
    await user.click(screen.getByRole('button', { name: 'Interpret brief' }));
    expect(await screen.findByText('87% MATCH')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open step 01/i }));
    expect(screen.getByLabelText('Agent name')).toHaveValue('Human Confirmed Agent');
  });
});
