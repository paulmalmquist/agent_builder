import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { ConnectionsPage } from './ConnectionsPage';
import { renderWithClient } from '../../test/render';
import { httpPluginVersionId, server } from '../../test/server';

const installableHttpPlugin = {
  pluginVersionId: httpPluginVersionId,
  familyId: '38383838-3838-4383-8383-383838383838',
  slug: 'planning-api',
  name: 'Planning API',
  version: '1.0.0',
  digest: '3'.repeat(64),
  transport: 'http',
  executionPlacement: 'control_plane',
  classification: 'internal',
  brand: { monogram: 'PA', accent: '#7F9CF5' },
  capabilities: [
    {
      tool: 'record_lookup',
      description: 'Read one bounded planning record.',
      effect: 'read',
      approval: 'not_required',
      scopeDescription: 'Read bounded planning records only',
      limits: {
        timeoutMs: 5_000,
        maxResponseBytes: 250_000,
        maxRecords: 100,
        maxInvocationsPerRun: 5,
        maxEstimatedCostUsd: 0.05,
      },
    },
  ],
  secretSlots: [],
  activeScopeDescriptions: [],
  costThisWeekUsd: 0,
  installationId: null,
  installationState: null,
  healthStatus: 'unknown',
  lastUsedAt: null,
};

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

    expect(screen.getByText('CATALOG CARDS SHOWN').parentElement).toHaveTextContent('4');
    expect(screen.getByText('INSTALLED SHOWN').parentElement).toHaveTextContent('2');
    expect(screen.getByText('READY TO INSTALL').parentElement).toHaveTextContent('0');
    expect(screen.getByText('RUNTIME UNAVAILABLE').parentElement).toHaveTextContent('3');

    const mcpCard = screen.getByRole('heading', { name: 'Team messages' }).closest('article')!;
    expect(within(mcpCard).getByText(/1 typed capability is declared\./i)).toBeInTheDocument();
    expect(within(mcpCard).getByRole('button', { name: 'MCP RUNTIME UNAVAILABLE' })).toBeDisabled();
    const databaseCard = screen
      .getByRole('heading', { name: 'Analytics preview' })
      .closest('article')!;
    expect(
      within(databaseCard).getByRole('button', { name: 'DB RUNTIME UNAVAILABLE' }),
    ).toBeDisabled();
    const localCard = screen.getByRole('heading', { name: 'Local files' }).closest('article')!;
    expect(
      within(localCard).getByRole('button', { name: 'WORKSTATION BROKER UNAVAILABLE' }),
    ).toBeDisabled();
    expect(within(localCard).getByText(/workstation broker is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/Only HTTP tools execute in this checkpoint/i)).toBeInTheDocument();
  });

  it('distinguishes one visible installable catalog card from installed cards', async () => {
    server.use(
      http.get('http://localhost/v1/plugins', () =>
        HttpResponse.json({ items: [installableHttpPlugin] }),
      ),
      http.get('http://localhost/v1/plugin-installations', () => HttpResponse.json({ items: [] })),
    );
    renderWithClient(<ConnectionsPage />, ['/connections']);

    const card = (await screen.findByRole('heading', { name: 'Planning API' })).closest('article')!;
    expect(screen.getByText('CATALOG CARDS SHOWN').parentElement).toHaveTextContent('1');
    expect(screen.getByText('INSTALLED SHOWN').parentElement).toHaveTextContent('0');
    expect(screen.getByText('READY TO INSTALL').parentElement).toHaveTextContent('1');
    expect(screen.getByText('RUNTIME UNAVAILABLE').parentElement).toHaveTextContent('0');
    expect(within(card).getByText('1 typed capability is ready to install.')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'INSTALL PLUGIN' })).toBeEnabled();
  });

  it('names workstation placement as the unavailable runtime even for an HTTP connector', async () => {
    server.use(
      http.get('http://localhost/v1/plugins', () =>
        HttpResponse.json({
          items: [
            {
              ...installableHttpPlugin,
              executionPlacement: 'workstation',
              name: 'Workstation planning bridge',
            },
          ],
        }),
      ),
      http.get('http://localhost/v1/plugin-installations', () => HttpResponse.json({ items: [] })),
    );
    renderWithClient(<ConnectionsPage />, ['/connections']);

    const card = (
      await screen.findByRole('heading', { name: 'Workstation planning bridge' })
    ).closest('article')!;
    expect(
      within(card).getByRole('button', { name: 'WORKSTATION BROKER UNAVAILABLE' }),
    ).toBeDisabled();
    expect(within(card).getByText(/workstation broker is unavailable/i)).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/HTTP installation and invocation/i);
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
    expect(screen.getByText('CATALOG CARDS SHOWN').parentElement).toHaveTextContent('0');
    expect(screen.getByText('INSTALLED SHOWN').parentElement).toHaveTextContent('0');
    expect(screen.getByText('READY TO INSTALL').parentElement).toHaveTextContent('0');
    expect(screen.getByText('RUNTIME UNAVAILABLE').parentElement).toHaveTextContent('0');
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
      'CATALOG CARDS SHOWN',
      'INSTALLED SHOWN',
      'READY TO INSTALL',
      'RUNTIME UNAVAILABLE',
    ]) {
      expect(screen.getByText(label).parentElement).toHaveTextContent('—');
    }
  });
});
