import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ResourceVersion } from '@agent-builder/contracts';
import { CatalogPage } from './CatalogPage';
import { renderWithClient } from '../../test/render';
import { server } from '../../test/server';

const canonicalAgent: ResourceVersion = {
  id: '51515151-5151-4151-8151-515151515151',
  familyId: '52525252-5252-4252-8252-525252525252',
  kind: 'Agent',
  slug: 'synthetic-cost-sentinel',
  name: 'Synthetic Cost Sentinel',
  version: '1.2.0',
  owner: 'Synthetic Operations',
  purpose: 'Attribute synthetic warehouse spend anomalies to bounded queries.',
  lifecycle: 'production',
  digest: 'c'.repeat(64),
  sourceCommit: 'test-commit',
  provenance: { source: 'synthetic-test' },
  dependencyPins: [{ familyId: '53535353-5353-4353-8353-535353535353', version: '1.0.0' }],
  definition: {
    apiVersion: 'paul-os/v1',
    kind: 'Agent',
    metadata: {
      id: '52525252-5252-4252-8252-525252525252',
      slug: 'synthetic-cost-sentinel',
      version: '1.2.0',
      name: 'Synthetic Cost Sentinel',
      owner: 'Synthetic Operations',
      purpose: 'Attribute synthetic warehouse spend anomalies to bounded queries.',
      lifecycle: 'production',
      provenance: { source: 'synthetic-test' },
    },
    dependencies: [{ familyId: '53535353-5353-4353-8353-535353535353', version: '1.0.0' }],
    spec: {},
  },
  revision: 2,
  frozenAt: '2026-08-17T12:00:00.000Z',
  createdAt: '2026-08-17T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z',
};

function response(items: ResourceVersion[]) {
  return {
    items,
    total: items.length,
    countsByLifecycle: {
      experimental: 0,
      candidate: 0,
      evaluating: 0,
      evaluated: 0,
      certified: 0,
      production: items.length,
      deprecated: 0,
    },
  };
}

describe('CatalogPage', () => {
  it('shows canonical Agent resources with exact knowledge and compatibility routes', async () => {
    server.use(
      http.get('http://localhost/v1/resources', () =>
        HttpResponse.json({
          ...response([canonicalAgent]),
          total: 127,
          countsByLifecycle: {
            experimental: 91,
            candidate: 0,
            evaluating: 0,
            evaluated: 0,
            certified: 13,
            production: 23,
            deprecated: 0,
          },
        }),
      ),
    );
    renderWithClient(<CatalogPage />, ['/catalog']);

    const card = (await screen.findByRole('heading', { name: 'Synthetic Cost Sentinel' })).closest(
      'article',
    )!;
    expect(within(card).getByText(/EXACT DEPENDENCIES · 1/i)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /INSPECT KNOWLEDGE/i })).toHaveAttribute(
      'href',
      `/knowledge?type=agents&entity=${canonicalAgent.id}`,
    );
    expect(screen.getByText('AGENT VERSIONS SHOWN').parentElement).toHaveTextContent('1');
    expect(screen.getByText('PRODUCTION SHOWN').parentElement).toHaveTextContent('1');

    const tabs = screen.getByRole('navigation', { name: 'Catalog views' });
    expect(within(tabs).getByRole('link', { name: 'AGENTS' })).toHaveAttribute('href', '/catalog');
    expect(within(tabs).getByRole('link', { name: 'LEGACY LIBRARY' })).toHaveAttribute(
      'href',
      '/library',
    );
    expect(within(tabs).getByRole('link', { name: 'DEFINITIONS' })).toHaveAttribute(
      'href',
      '/registry',
    );
    const related = screen.getByRole('region', { name: 'Related catalog surfaces' });
    expect(within(related).getByRole('link', { name: /BUILD/i })).toHaveAttribute('href', '/build');
    expect(within(related).getByRole('link', { name: /LEGACY LIBRARY/i })).toHaveAttribute(
      'href',
      '/library',
    );
    expect(within(related).getByRole('link', { name: /DEFINITIONS/i })).toHaveAttribute(
      'href',
      '/registry',
    );
  });

  it('shows a deliberate empty state without fabricating catalog totals', async () => {
    server.use(http.get('http://localhost/v1/resources', () => HttpResponse.json(response([]))));
    renderWithClient(<CatalogPage />, ['/catalog']);

    expect(
      await screen.findByText('No canonical Agent resources are imported.'),
    ).toBeInTheDocument();
    expect(screen.getByText('AGENT VERSIONS SHOWN').parentElement).toHaveTextContent('0');
    expect(screen.getByText('PRODUCTION SHOWN').parentElement).toHaveTextContent('0');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fails closed and hides cached resources when the canonical registry fails', async () => {
    server.use(
      http.get('http://localhost/v1/resources', () =>
        HttpResponse.json(response([canonicalAgent])),
      ),
    );
    const { client } = renderWithClient(<CatalogPage />, ['/catalog']);
    expect(
      await screen.findByRole('heading', { name: 'Synthetic Cost Sentinel' }),
    ).toBeInTheDocument();

    server.use(
      http.get('http://localhost/v1/resources', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'The canonical registry is unavailable.',
              requestId: 'catalog-test',
            },
          },
          { status: 503 },
        ),
      ),
    );
    await client.invalidateQueries({ queryKey: ['platform-resources'] });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Catalog unavailable. The canonical registry is unavailable.',
    );
    expect(
      screen.queryByRole('heading', { name: 'Synthetic Cost Sentinel' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('No canonical Agent resources are imported.'),
    ).not.toBeInTheDocument();
    for (const label of ['AGENT VERSIONS SHOWN', 'PRODUCTION SHOWN', 'CERTIFIED SHOWN']) {
      expect(screen.getByText(label).parentElement).toHaveTextContent('—');
    }
  });
});
