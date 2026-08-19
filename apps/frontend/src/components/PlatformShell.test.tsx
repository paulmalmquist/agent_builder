import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router-dom';
import { PlatformShell } from './PlatformShell';
import { renderWithClient } from '../test/render';
import { server } from '../test/server';

function renderShell(path = '/', attentionElement: ReactNode = <div>Attention route</div>) {
  return renderWithClient(
    <Routes>
      <Route element={<PlatformShell />} path="/">
        <Route index element={<div>Today route</div>} />
        <Route element={attentionElement} path="attention" />
        <Route element={<div>Knowledge route</div>} path="knowledge" />
        <Route element={<div>AIM route</div>} path="aim" />
        <Route element={<div>Build route</div>} path="build" />
        <Route element={<div>Catalog route</div>} path="catalog" />
        <Route element={<div>Library route</div>} path="library" />
        <Route element={<div>Registry route</div>} path="registry" />
        <Route element={<div>Operate route</div>} path="operate" />
        <Route element={<div>Runs route</div>} path="runs" />
        <Route element={<div>Connections route</div>} path="connections" />
        <Route element={<div>Evidence route</div>} path="evidence" />
        <Route element={<div>Certification route</div>} path="certification/:agentId" />
        <Route element={<div>Incubator route</div>} path="incubator" />
        <Route element={<div>Roadmaps route</div>} path="roadmaps" />
        <Route element={<div>Settings route</div>} path="settings" />
      </Route>
    </Routes>,
    [path],
  );
}

describe('Paul OS platform shell', () => {
  beforeEach(() => window.localStorage.clear());

  it('uses the numbered 00–10 rail and reserves its only count badge for Attention', async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByText('PAUL OS')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Paul OS Today' })).toHaveAttribute('href', '/');

    const navigation = screen.getByRole('navigation', { name: 'Paul OS' });
    const links = within(navigation).getAllByRole('link');
    expect(links).toHaveLength(12);
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      '00TODAY',
      '01ATTENTION',
      '02KNOWLEDGE',
      '03AIM',
      '04BUILD',
      '05CATALOG',
      '06OPERATE',
      '07CONNECTIONS',
      '08EVIDENCE',
      '09INCUBATOR',
      '10ROADMAPS',
      '—SETTINGS',
    ]);
    expect(within(navigation).getByRole('link', { name: /TODAY/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(await screen.findByLabelText('1 decisions need review')).toBeInTheDocument();
    expect(navigation.querySelectorAll('.attention-badge')).toHaveLength(1);
    expect(screen.getByText('PAUL OS · GOVERNED')).toBeInTheDocument();

    const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skipLink).toHaveAttribute('href', '#platform-main');
    await user.click(skipLink);
    expect(document.getElementById('platform-main')).toHaveFocus();
  });

  it('persists rail collapse through both the control and the [ shortcut', async () => {
    const user = userEvent.setup();
    const first = renderShell();
    const shell = document.querySelector('.platform-shell');

    await user.click(screen.getByRole('button', { name: 'Collapse navigation' }));
    expect(shell).toHaveAttribute('data-rail-collapsed', 'true');
    expect(window.localStorage.getItem('paul-os:rail-collapsed:v1')).toBe('true');
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const todayLink = screen.getByRole('link', { name: 'TODAY' });
    expect(todayLink).toHaveAttribute('title', 'TODAY');
    await user.hover(todayLink);
    expect(todayLink).toHaveAttribute('aria-describedby', 'platform-rail-tooltip');
    expect(screen.getByRole('tooltip')).toHaveTextContent('TODAY');
    await user.unhover(todayLink);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    first.unmount();
    renderShell();
    expect(document.querySelector('.platform-shell')).toHaveAttribute(
      'data-rail-collapsed',
      'true',
    );

    fireEvent.keyDown(document.body, { key: '[' });
    expect(document.querySelector('.platform-shell')).toHaveAttribute(
      'data-rail-collapsed',
      'false',
    );
    expect(window.localStorage.getItem('paul-os:rail-collapsed:v1')).toBe('false');
  });

  it('ignores the [ shortcut while focus is in an input or dialog', async () => {
    const user = userEvent.setup();
    const { unmount } = renderShell();

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Search governed entities' });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: '[' });
    expect(document.querySelector('.platform-shell')).toHaveAttribute(
      'data-rail-collapsed',
      'false',
    );

    unmount();
    const dialogButton = (
      <div aria-label="Test dialog" role="dialog">
        <button type="button">Dialog action</button>
      </div>
    );
    renderShell('/attention', dialogButton);
    const button = screen.getByRole('button', { name: 'Dialog action' });
    button.focus();
    fireEvent.keyDown(button, { key: '[' });
    expect(document.querySelector('.platform-shell')).toHaveAttribute(
      'data-rail-collapsed',
      'false',
    );
  });

  it.each([
    ['/', 'TODAY'],
    ['/attention', 'ATTENTION'],
    ['/aim', 'AIM'],
    ['/library', 'CATALOG'],
    ['/registry', 'CATALOG'],
    ['/runs', 'OPERATE'],
    ['/certification/test-agent', 'EVIDENCE'],
  ])('marks %s under the correct rail section', (path, activeLabel) => {
    renderShell(path);

    const navigation = screen.getByRole('navigation', { name: 'Paul OS' });
    expect(
      within(navigation).getByRole('link', { name: new RegExp(activeLabel, 'i') }),
    ).toHaveAttribute('aria-current', 'page');
    if (path !== '/') {
      expect(within(navigation).getByRole('link', { name: /TODAY/i })).not.toHaveAttribute(
        'aria-current',
      );
    }
  });

  it('offers a persisted Resume route after leaving a working surface', async () => {
    const user = userEvent.setup();
    renderShell('/attention');

    expect(await screen.findByRole('link', { name: /RESUME/i })).toHaveAttribute(
      'href',
      '/attention',
    );
    expect(window.localStorage.getItem('paul-os:resume-route:v1')).toBe('/attention');

    await user.click(
      within(screen.getByRole('navigation', { name: 'Paul OS' })).getByRole('link', {
        name: /TODAY/i,
      }),
    );
    expect(screen.getByText('Today route')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /RESUME/i })).toHaveAttribute('href', '/attention');
  });

  it('preserves an in-progress Build route while browsing non-working surfaces', async () => {
    const user = userEvent.setup();
    const specId = '51515151-5151-4151-8151-515151515151';
    renderShell(`/build?spec=${specId}&mode=guided`);

    expect(await screen.findByRole('link', { name: /RESUME/i })).toHaveAttribute(
      'href',
      `/build?spec=${specId}&mode=guided`,
    );
    await user.click(
      within(screen.getByRole('navigation', { name: 'Paul OS' })).getByRole('link', {
        name: /CATALOG/i,
      }),
    );

    expect(screen.getByText('Catalog route')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /RESUME/i })).toHaveAttribute(
      'href',
      `/build?spec=${specId}&mode=guided`,
    );
    expect(
      within(screen.getByRole('navigation', { name: 'Paul OS' })).getByRole('link', {
        name: /BUILD/i,
      }),
    ).toHaveAttribute('href', `/build?spec=${specId}&mode=guided`);
  });

  it('rejects a cross-origin value from the persisted Resume boundary', () => {
    window.localStorage.setItem('paul-os:resume-route:v1', '//example.test/collect');
    renderShell();

    expect(screen.queryByRole('link', { name: /RESUME/i })).not.toBeInTheDocument();
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

    expect(await screen.findByLabelText('ATTENTION unavailable')).toBeInTheDocument();
    expect(screen.queryByLabelText(/decisions need review/i)).not.toBeInTheDocument();
  });

  it('supports entity search, keyboard selection, and focus return', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Search governed entities' });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('aria-expanded', 'true');

    await user.type(input, 'supplier');
    expect(
      await screen.findByRole('option', { name: /Supplier Risk Analyst/i }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(
      '2 results available across governed agents, legacy agents, and other definitions.',
    );

    await user.keyboard('{Enter}');
    const drawer = await screen.findByRole('dialog', { name: 'Agent details' });
    await waitFor(() => {
      expect(within(drawer).getByRole('button', { name: 'Close agent details' })).toHaveFocus();
    });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Agent details' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Search governed entities' })).toHaveFocus();

    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Search governed entities' })).toHaveFocus();
  });
});
