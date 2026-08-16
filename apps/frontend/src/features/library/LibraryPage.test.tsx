import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useLocation } from 'react-router-dom';
import { PlatformShell } from '../../components/PlatformShell';
import { renderWithClient } from '../../test/render';
import { catalogAgent, server } from '../../test/server';
import { LibraryPage } from './LibraryPage';

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

describe('agent library', () => {
  it('keeps filters in the URL and opens governed version history', async () => {
    const user = userEvent.setup();
    renderWithClient(
      <Routes>
        <Route element={<PlatformShell />} path="/">
          <Route
            element={
              <>
                <LibraryPage />
                <LocationProbe />
              </>
            }
            path="library"
          />
        </Route>
      </Routes>,
      ['/library'],
    );

    expect(
      await screen.findByRole('button', { name: /Supplier Risk Analyst/i }),
    ).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/PROVIDER/i), 'bigquery');
    await waitFor(() =>
      expect(screen.getByTestId('location-search')).toHaveTextContent('provider=bigquery'),
    );

    await user.click(screen.getByRole('button', { name: /Supplier Risk Analyst/i }));
    expect(await screen.findByText('Family versions')).toBeInTheDocument();
    const drawer = screen.getByRole('dialog', { name: 'Agent details' });
    expect(within(drawer).getByRole('button', { name: /V1/i })).toBeInTheDocument();
    expect(screen.getByTestId('location-search')).toHaveTextContent(
      'agent=11111111-1111-4111-8111-111111111111',
    );
  });

  it('loads the next catalog cursor without replacing the first page', async () => {
    const user = userEvent.setup();
    const secondAgent = {
      ...catalogAgent,
      id: '12121212-1212-4212-8212-121212121212',
      familyId: '13131313-1313-4313-8313-131313131313',
      slug: 'inventory-risk-analyst-v1',
      name: 'Inventory Risk Analyst',
    };
    server.use(
      http.get('http://localhost/agents', ({ request }) => {
        const cursor = new URL(request.url).searchParams.get('cursor');
        return HttpResponse.json({
          mode: 'catalog',
          query: '',
          nextCursor: cursor ? null : 'catalog-page-2',
          items: cursor
            ? [
                {
                  ...secondAgent,
                  score: 75,
                  reuseRecommended: true,
                  matchedCapabilities: ['inventory risk'],
                  gaps: [],
                },
              ]
            : [
                {
                  ...catalogAgent,
                  score: 82,
                  reuseRecommended: true,
                  matchedCapabilities: ['supplier risk'],
                  gaps: [],
                },
              ],
        });
      }),
    );

    renderWithClient(
      <Routes>
        <Route element={<PlatformShell />} path="/">
          <Route element={<LibraryPage />} path="library" />
        </Route>
      </Routes>,
      ['/library'],
    );

    expect(
      await screen.findByRole('button', { name: /Supplier Risk Analyst/i }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more agents' }));

    expect(
      await screen.findByRole('button', { name: /Inventory Risk Analyst/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Supplier Risk Analyst/i })).toBeInTheDocument();
  });
});
