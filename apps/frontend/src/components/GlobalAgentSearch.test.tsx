import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ResourceVersion } from '@agent-builder/contracts';
import { useLocation } from 'react-router-dom';
import { GlobalAgentSearch } from './GlobalAgentSearch';
import { renderWithClient } from '../test/render';
import { catalogAgent, server } from '../test/server';

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
  it('separates legacy agents from other governed definitions, then routes definitions into Knowledge', async () => {
    const user = userEvent.setup();
    const { onSelectAgent } = renderSearch();

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Search governed entities' });
    expect(input).toHaveFocus();
    await user.type(input, 'daily');

    expect(await screen.findByText(/LEGACY AGENTS NOT YET IMPORTED · 1/i)).toBeInTheDocument();
    expect(screen.getByText(/OTHER GOVERNED DEFINITIONS · 1/i)).toBeInTheDocument();
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
      screen.getByText(
        '1 result available across governed agents, legacy agents, and other definitions.',
      ),
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

  it('quarantines explicit fixture identities without hiding legitimate test work', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('http://localhost/agents', ({ request }) => {
        const query = new URL(request.url).searchParams.get('query') ?? '';
        return HttpResponse.json({
          mode: 'catalog',
          query,
          nextCursor: null,
          items: [
            {
              ...catalogAgent,
              id: '31313131-3131-4131-8131-313131313131',
              familyId: '32323232-3232-4232-8232-323232323232',
              name: 'Compatibility test agent',
              owner: 'integration-test',
              department: 'Synthetic Operations',
              score: 90,
              reuseRecommended: true,
              matchedCapabilities: ['test compatibility'],
              gaps: [],
            },
            {
              ...catalogAgent,
              id: '33333333-3333-4333-8333-333333333333',
              familyId: '34343434-3434-4434-8434-343434343434',
              name: 'Test Readiness Agent',
              owner: 'Quality Engineering',
              department: 'Quality',
              score: 88,
              reuseRecommended: true,
              matchedCapabilities: ['test readiness'],
              gaps: [],
            },
          ],
        });
      }),
      http.get('http://localhost/v1/resources', () =>
        HttpResponse.json({
          items: [],
          total: 0,
          countsByLifecycle: {
            experimental: 0,
            candidate: 0,
            evaluating: 0,
            evaluated: 0,
            certified: 0,
            production: 0,
            deprecated: 0,
          },
        }),
      ),
    );
    renderSearch();

    await user.click(screen.getByRole('button', { name: 'Search governed entities' }));
    await user.type(screen.getByRole('combobox'), 'test');

    expect(
      await screen.findByRole('option', { name: /Test Readiness Agent/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Compatibility test agent')).not.toBeInTheDocument();
    expect(screen.getByText(/LEGACY AGENTS NOT YET IMPORTED · 1/i)).toBeInTheDocument();
  });

  it('shows one canonical result when an exact ResourceVersion links the legacy agent', async () => {
    const user = userEvent.setup();
    const governedAgent: ResourceVersion = {
      id: '45454545-4545-4454-8454-454545454545',
      familyId: '46464646-4646-4464-8464-464646464646',
      kind: 'Agent',
      slug: 'supplier-risk-analyst',
      name: catalogAgent.name,
      version: '1.0.0',
      owner: catalogAgent.owner,
      purpose: catalogAgent.purpose,
      lifecycle: 'candidate',
      digest: 'e'.repeat(64),
      sourceCommit: 'governed-search-test',
      provenance: { source: 'synthetic-test' },
      dependencyPins: [],
      definition: {
        apiVersion: 'paul-os/v1',
        kind: 'Agent',
        metadata: {
          id: '46464646-4646-4464-8464-464646464646',
          slug: 'supplier-risk-analyst',
          version: '1.0.0',
          name: catalogAgent.name,
          owner: catalogAgent.owner,
          purpose: catalogAgent.purpose,
          lifecycle: 'candidate',
          provenance: { source: 'synthetic-test' },
        },
        dependencies: [],
        spec: {
          objective: 'Inspect bounded supplier risk and draft a cited escalation brief.',
          skills: ['supplier-risk-review@1.0.0'],
          protocols: [],
          contextPolicy: 'bounded-context@1.0.0',
          knowledgeSources: [],
          tools: [],
          triggers: [],
          executionLoop: {
            maximumSteps: 8,
            onUnresolved: 'return_to_user',
            outputContract: 'supplier-risk-brief@1.0.0',
          },
          memoryPolicy: { reads: 'accepted_only', writes: 'staged_for_human_acceptance' },
          production: { requiresImmutableRelease: true, authorityClass: 'read-only-risk' },
          legacyCompatibility: {
            agentId: catalogAgent.id,
            department: catalogAgent.department,
            specificationRevision: null,
            sectionDigests: {
              outcomes: null,
              knowledge: null,
              guardrails: null,
              outputs: null,
            },
            capabilitiesDigest: 'f'.repeat(64),
            manifestDigest: null,
          },
        },
      },
      revision: 1,
      frozenAt: '2026-08-18T12:00:00.000Z',
      createdAt: '2026-08-18T12:00:00.000Z',
      updatedAt: '2026-08-18T12:00:00.000Z',
    };
    server.use(
      http.get('http://localhost/v1/resources', () =>
        HttpResponse.json({
          items: [governedAgent],
          total: 1,
          countsByLifecycle: {
            experimental: 0,
            candidate: 1,
            evaluating: 0,
            evaluated: 0,
            certified: 0,
            production: 0,
            deprecated: 0,
          },
        }),
      ),
    );
    const { onSelectAgent } = renderSearch();

    await user.click(screen.getByRole('button', { name: 'Search governed entities' }));
    await user.type(screen.getByRole('combobox'), 'supplier');

    expect(await screen.findByText('GOVERNED AGENTS · 1')).toBeInTheDocument();
    expect(screen.queryByText(/LEGACY AGENTS NOT YET IMPORTED/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await user.click(screen.getByRole('option', { name: /Supplier Risk Analyst/i }));

    await waitFor(() => {
      expect(screen.getByLabelText('Current route')).toHaveTextContent(
        `/catalog?resource=${governedAgent.id}`,
      );
    });
    expect(onSelectAgent).not.toHaveBeenCalled();
  });
});
