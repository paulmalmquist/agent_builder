import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { GlobalAgentSearch } from './GlobalAgentSearch';
import { renderWithClient } from '../test/render';
import { server } from '../test/server';

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{`${location.pathname}${location.search}`}</output>;
}

function renderSearch(onSelectAgent = vi.fn()) {
  return {
    onSelectAgent,
    ...renderWithClient(
      <>
        <GlobalAgentSearch onSelectAgent={onSelectAgent} />
        <LocationProbe />
      </>,
    ),
  };
}

describe('global entity search', () => {
  it('groups legacy agents and governed definitions, then routes definitions into Knowledge', async () => {
    const user = userEvent.setup();
    const { onSelectAgent } = renderSearch();

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Search governed entities' });
    expect(input).toHaveFocus();
    await user.type(input, 'daily');

    expect(await screen.findByText(/LEGACY AGENT CATALOG · 1/i)).toBeInTheDocument();
    expect(screen.getByText(/GOVERNED DEFINITIONS · 1/i)).toBeInTheDocument();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Daily Brief/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Current route')).toHaveTextContent(
        '/knowledge?type=agents&entity=12121212-1212-4121-8121-121212121212',
      );
    });
    expect(onSelectAgent).not.toHaveBeenCalled();
  });

  it('keeps available definition results visible when the legacy catalog fails', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('http://localhost/agents', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'Legacy catalog unavailable.',
              requestId: 'search-test',
            },
          },
          { status: 503 },
        ),
      ),
    );
    renderSearch();

    await user.click(screen.getByRole('button', { name: 'Search governed entities' }));
    await user.type(screen.getByRole('combobox'), 'daily');

    expect(await screen.findByRole('alert')).toHaveTextContent('AGENT CATALOG UNAVAILABLE');
    expect(screen.getByRole('option', { name: /Daily Brief/i })).toBeInTheDocument();
    expect(
      screen.getByText('1 result available across agents and governed definitions.'),
    ).toBeInTheDocument();
  });

  it('retains keyboard selection for legacy agents and restores focus after Escape', async () => {
    const user = userEvent.setup();
    const { onSelectAgent } = renderSearch();

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Search governed entities' });
    await user.type(input, 'supplier');
    expect(
      await screen.findByRole('option', { name: /Supplier Risk Analyst/i }),
    ).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onSelectAgent).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');

    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Search governed entities' })).toHaveFocus();
  });

  it('does not claim there are no matches when either search index is unavailable', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('http://localhost/agents', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'Legacy catalog unavailable.',
              requestId: 'search-agent-error',
            },
          },
          { status: 503 },
        ),
      ),
      http.get('http://localhost/v1/resources', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'Definition index unavailable.',
              requestId: 'search-resource-error',
            },
          },
          { status: 503 },
        ),
      ),
    );
    renderSearch();

    await user.click(screen.getByRole('button', { name: 'Search governed entities' }));
    await user.type(screen.getByRole('combobox'), 'missing');

    expect(await screen.findAllByRole('alert')).toHaveLength(2);
    expect(screen.queryByText('NO MATCHING ENTITIES')).not.toBeInTheDocument();
  });
});
