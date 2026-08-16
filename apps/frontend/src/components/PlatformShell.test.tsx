import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { PlatformShell } from './PlatformShell';
import { renderWithClient } from '../test/render';

describe('platform search', () => {
  it('supports the command shortcut, debounced results, keyboard selection, and focus return', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <Routes>
        <Route element={<PlatformShell />} path="/">
          <Route index element={<div>Builder route</div>} />
        </Route>
      </Routes>,
    );

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
