import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { PlatformShell } from './PlatformShell';
import { renderWithClient } from '../test/render';
import { HomePage } from '../features/home/HomePage';
import { server } from '../test/server';

function renderShell(path = '/') {
  return renderWithClient(
    <Routes>
      <Route element={<PlatformShell />} path="/">
        <Route index element={<HomePage aimEnabled={false} />} />
        <Route element={<div>Attention route</div>} path="attention" />
      </Route>
    </Routes>,
    [path],
  );
}

describe('platform search', () => {
  it('uses Paul OS home and reserves the only navigation badge for decisions', async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByText('PAUL OS')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Paul OS home' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const navigation = screen.getByRole('navigation', { name: 'Paul OS' });
    expect(within(navigation).getAllByRole('link')).toHaveLength(6);
    expect(within(navigation).getByRole('link', { name: /ATTENTION/i })).not.toHaveAttribute(
      'aria-current',
    );
    expect(await screen.findByLabelText('1 decisions need review')).toBeInTheDocument();
    expect(within(navigation).getAllByLabelText(/decisions need review/i)).toHaveLength(1);
    expect(screen.getByText('GOVERNED AGENT PLATFORM')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#platform-main',
    );
    await user.click(screen.getByRole('link', { name: 'Skip to main content' }));
    expect(document.getElementById('platform-main')).toHaveFocus();
  });

  it('suppresses a cached decision badge when Attention becomes unavailable', async () => {
    const { client } = renderShell();
    expect(await screen.findByLabelText('1 decisions need review')).toBeInTheDocument();

    server.use(
      http.get('http://localhost/v1/attention', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'The operational ledger is unavailable.',
              requestId: 'shell-test-request',
            },
          },
          { status: 503 },
        ),
      ),
    );
    await client.invalidateQueries({ queryKey: ['attention'] });

    expect(await screen.findByText('UNAVAILABLE')).toBeInTheDocument();
    expect(screen.queryByLabelText(/decisions need review/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', {
        name: 'Daily Briefing is ready for its first approved run',
      }),
    ).not.toBeInTheDocument();
  });

  it('marks Attention active on its dedicated route', () => {
    renderShell('/attention');

    const navigation = screen.getByRole('navigation', { name: 'Paul OS' });
    expect(within(navigation).getByRole('link', { name: /ATTENTION/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Open Paul OS home' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('supports the command shortcut, debounced results, keyboard selection, and focus return', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Search governed agents' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'true');

    await user.type(input, 'supplier');
    expect(
      await screen.findByRole('option', { name: /Supplier Risk Analyst/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('1 result available');

    await user.keyboard('{ArrowDown}{Enter}');
    const drawer = await screen.findByRole('dialog', { name: 'Agent details' });
    await waitFor(() => {
      expect(within(drawer).getByRole('button', { name: 'Close agent details' })).toHaveFocus();
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Agent details' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Search governed agents' })).toHaveFocus();

    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Search governed agents' })).toHaveFocus();
  });
});
