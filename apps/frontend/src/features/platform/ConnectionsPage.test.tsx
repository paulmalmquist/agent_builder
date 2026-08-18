import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { ConnectionsPage } from './ConnectionsPage';
import { renderWithClient } from '../../test/render';
import { server } from '../../test/server';

function unavailable(message: string) {
  return HttpResponse.json(
    {
      error: {
        code: 'DEPENDENCY_UNAVAILABLE',
        message,
        requestId: 'connections-test',
      },
    },
    { status: 503 },
  );
}

describe('ConnectionsPage', () => {
  it('renders every declared transport through one local-mark connection pattern', async () => {
    renderWithClient(<ConnectionsPage />, ['/connections']);

    const pluginHeadings = await screen.findAllByRole('heading', {
      name: /Team messages|Calendar API|Analytics preview|Local files/,
    });
    expect(pluginHeadings).toHaveLength(4);
    expect(document.querySelectorAll('.plugin-card')).toHaveLength(4);
    expect(screen.getAllByRole('img', { name: /connector$/i })).toHaveLength(4);
    for (const transport of ['mcp', 'http', 'db', 'cli']) {
      expect(screen.getByText(transport)).toBeInTheDocument();
    }

    expect(screen.getByText('INSTALLED SHOWN').parentElement).toHaveTextContent('2');
    expect(screen.getByText('HEALTHY SHOWN').parentElement).toHaveTextContent('1');
    expect(screen.getByText('DEGRADED SHOWN').parentElement).toHaveTextContent('1');
    expect(screen.getByText('MISSING SECRET REFS SHOWN').parentElement).toHaveTextContent('0');

    const localCard = screen.getByRole('heading', { name: 'Local files' }).closest('article')!;
    expect(
      within(localCard).getByRole('button', { name: 'WORKSTATION UNAVAILABLE' }),
    ).toBeDisabled();
    expect(screen.getByText(/Only HTTP tools execute in this checkpoint/i)).toBeInTheDocument();
  });

  it('installs an available Plugin without a core-code-specific flow', async () => {
    const user = userEvent.setup();
    renderWithClient(<ConnectionsPage />, ['/connections']);

    const analyticsCard = (
      await screen.findByRole('heading', {
        name: 'Analytics preview',
      })
    ).closest('article')!;
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

  it('keeps opaque secret references replace-only and protects certified dependants', async () => {
    const user = userEvent.setup();
    renderWithClient(<ConnectionsPage />, ['/connections']);

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

  it('shows an honest empty state when no Plugin definitions exist', async () => {
    server.use(
      http.get('http://localhost/v1/plugins', () => HttpResponse.json({ items: [] })),
      http.get('http://localhost/v1/plugin-installations', () => HttpResponse.json({ items: [] })),
    );
    renderWithClient(<ConnectionsPage />, ['/connections']);

    expect(await screen.findByText('No Plugin definitions are available.')).toBeInTheDocument();
    expect(screen.getByText('INSTALLED SHOWN').parentElement).toHaveTextContent('0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.plugin-card')).toHaveLength(0);
  });

  it('fails closed and hides cached connection readings when either dependency fails', async () => {
    const { client } = renderWithClient(<ConnectionsPage />, ['/connections']);
    expect(await screen.findByRole('heading', { name: 'Calendar API' })).toBeInTheDocument();

    server.use(
      http.get('http://localhost/v1/plugins', () => unavailable('Plugins are unavailable.')),
      http.get('http://localhost/v1/plugin-installations', () =>
        unavailable('Installation state is unavailable.'),
      ),
    );
    await Promise.all([
      client.invalidateQueries({ queryKey: ['plugins'] }),
      client.invalidateQueries({ queryKey: ['plugin-installations'] }),
    ]);

    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((alert) => alert.textContent)).toEqual(
      expect.arrayContaining([
        'Connections unavailable. Plugins are unavailable.',
        'Connection configuration status unavailable. Installation state is unavailable.',
      ]),
    );
    expect(screen.queryByRole('heading', { name: 'Calendar API' })).not.toBeInTheDocument();
    expect(screen.queryByText('No Plugin definitions are available.')).not.toBeInTheDocument();
    for (const label of [
      'INSTALLED SHOWN',
      'HEALTHY SHOWN',
      'DEGRADED SHOWN',
      'MISSING SECRET REFS SHOWN',
    ]) {
      expect(screen.getByText(label).parentElement).toHaveTextContent('—');
    }
  });
});
