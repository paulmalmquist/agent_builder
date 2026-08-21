import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { roadmapResourceSpecSchema, type ResourceVersion } from '@agent-builder/contracts';
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

const roadmapResourceId = '85858585-8585-4585-8585-858585858585';
const roadmapFamilyId = '86868686-8686-4686-8686-868686868686';
const roadmapSpec = roadmapResourceSpecSchema.parse({
  schemaVersion: 'roadmap.fork/v1',
  program: {
    id: 'two_fork_program',
    title: 'Two-fork program',
    description: 'Track the primary and alternate delivery paths.',
    synthetic: true,
    timeline: {
      startAt: '2026-08-01T00:00:00.000Z',
      endAt: '2027-02-01T00:00:00.000Z',
    },
  },
  fork: {
    id: 'fork_primary',
    label: 'Roadmap fork 01',
    purpose: 'Track the primary delivery path without inventing private Jira state.',
    status: 'watch',
    jira: {
      state: 'awaiting_transfer',
      projectKey: null,
      filterId: null,
      includedIssueCount: null,
      totalIssueCount: null,
      lastSyncedAt: null,
    },
    metrics: [
      {
        id: 'metric_progress',
        label: 'Milestone progress',
        value: '42%',
        detail: 'Synthetic progress until the Jira binding transfers.',
        state: 'watch',
        source: 'synthetic',
      },
    ],
    workstreams: [
      {
        id: 'workstream_primary',
        label: 'Primary workstream',
        startAt: '2026-08-01T00:00:00.000Z',
        endAt: '2026-09-01T00:00:00.000Z',
        state: 'in_work',
        source: 'synthetic',
      },
    ],
    actions: [],
  },
  definitionDependencies: [],
  relationships: [],
  relationshipCoverage: {
    vertical: { state: 'unmapped', detail: 'No vertical relationship is declared.' },
    aimGroup: { state: 'unmapped', detail: 'No AIM group relationship is declared.' },
    contributingAgents: {
      state: 'unmapped',
      detail: 'No contributing Agent relationship is declared.',
    },
    executionRuns: { state: 'unavailable', detail: 'Runtime joins are not loaded.' },
  },
});

const roadmapResource: ResourceVersion = {
  id: roadmapResourceId,
  familyId: roadmapFamilyId,
  kind: 'Roadmap',
  slug: 'roadmap-fork-primary',
  name: 'Roadmap fork 01',
  version: '1.0.0',
  owner: 'Program Operations',
  purpose: 'Track the primary delivery path.',
  lifecycle: 'candidate',
  digest: '8'.repeat(64),
  sourceCommit: 'roadmap-search-test',
  provenance: { source: 'synthetic-test' },
  dependencyPins: [],
  definition: {
    apiVersion: 'paul-os/v1',
    kind: 'Roadmap',
    metadata: {
      id: roadmapFamilyId,
      slug: 'roadmap-fork-primary',
      version: '1.0.0',
      name: 'Roadmap fork 01',
      owner: 'Program Operations',
      purpose: 'Track the primary delivery path.',
      lifecycle: 'candidate',
      provenance: { source: 'synthetic-test' },
    },
    dependencies: [],
    spec: roadmapSpec,
  },
  revision: 1,
  frozenAt: '2026-08-20T12:00:00.000Z',
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z',
};

const projectResourceId = '87878787-8787-4787-8787-878787878787';
const projectFamilyId = '88888888-8888-4888-8888-888888888888';
const projectResource: ResourceVersion = {
  id: projectResourceId,
  familyId: projectFamilyId,
  kind: 'Project',
  slug: 'personal-operations',
  name: 'Personal operations',
  version: '1.1.0',
  owner: 'Personal Operations',
  purpose: 'Bound governed resources for the personal operating system.',
  lifecycle: 'candidate',
  digest: '9'.repeat(64),
  sourceCommit: 'project-search-test',
  provenance: { source: 'synthetic-test' },
  dependencyPins: [],
  definition: {
    apiVersion: 'paul-os/v1',
    kind: 'Project',
    metadata: {
      id: projectFamilyId,
      slug: 'personal-operations',
      version: '1.1.0',
      name: 'Personal operations',
      owner: 'Personal Operations',
      purpose: 'Bound governed resources for the personal operating system.',
      lifecycle: 'candidate',
      provenance: { source: 'synthetic-test' },
    },
    dependencies: [],
    spec: {
      businessDomain: 'personal-operations@1.0.0',
      resourcePins: {},
      overlays: {},
      mayWeakenMandatoryRules: false,
    },
  },
  revision: 1,
  frozenAt: '2026-08-20T12:00:00.000Z',
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z',
};

function installRoadmapSearchResult(resource: ResourceVersion = roadmapResource) {
  server.use(
    http.get('http://localhost/agents', () =>
      HttpResponse.json({ mode: 'catalog', query: 'roadmap', nextCursor: null, items: [] }),
    ),
    http.get('http://localhost/v1/resources', () =>
      HttpResponse.json({
        items: [resource],
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
}

function installProjectSearchResult() {
  server.use(
    http.get('http://localhost/agents', () =>
      HttpResponse.json({ mode: 'catalog', query: 'project', nextCursor: null, items: [] }),
    ),
    http.get('http://localhost/v1/resources', () =>
      HttpResponse.json({
        items: [projectResource],
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
}

describe('global entity search', () => {
  it('opens a typed Roadmap fork with a mouse selection', async () => {
    installRoadmapSearchResult();
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole('button', { name: 'Search governed entities' }));
    await user.type(screen.getByRole('combobox'), 'roadmap');
    const result = await screen.findByRole('option', { name: /Roadmap fork 01/i });
    expect(result).toHaveAttribute('href', '/roadmaps?fork=fork_primary');
    expect(result).toHaveAttribute('tabindex', '-1');
    await user.pointer({ target: result, keys: '[MouseLeft]' });

    expect(screen.getByLabelText('Current route')).toHaveTextContent('/roadmaps?fork=fork_primary');
  });

  it('opens a typed Roadmap fork with the active keyboard selection', async () => {
    installRoadmapSearchResult();
    const user = userEvent.setup();
    renderSearch();

    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), 'roadmap');
    await screen.findByRole('option', { name: /Roadmap fork 01/i });
    await user.keyboard('{Enter}');

    expect(screen.getByLabelText('Current route')).toHaveTextContent('/roadmaps?fork=fork_primary');
  });

  it('owns ArrowDown, ArrowUp, and Enter while DOM focus stays on the combobox', async () => {
    const user = userEvent.setup();
    renderSearch();

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Search governed entities' });
    await user.type(input, 'daily');
    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[1]?.id);
    expect(input).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id);
    expect(input).toHaveFocus();

    await user.keyboard('{ArrowUp}{Enter}');
    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      '/knowledge?type=agents&entity=12121212-1212-4121-8121-121212121212',
    );
  });

  it('opens an exact Project version in the Projects facet by pointer', async () => {
    installProjectSearchResult();
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole('button', { name: 'Search governed entities' }));
    await user.type(screen.getByRole('combobox'), 'project');
    const result = await screen.findByRole('option', { name: /Personal operations/i });
    expect(result).toHaveAttribute('href', `/knowledge?type=projects&entity=${projectResourceId}`);
    await user.pointer({ target: result, keys: '[MouseLeft]' });

    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      `/knowledge?type=projects&entity=${projectResourceId}`,
    );
  });

  it('opens an exact Project version in the Projects facet by keyboard', async () => {
    installProjectSearchResult();
    const user = userEvent.setup();
    renderSearch();

    await user.keyboard('{Control>}k{/Control}');
    await user.type(screen.getByRole('combobox'), 'project');
    await screen.findByRole('option', { name: /Personal operations/i });
    await user.keyboard('{ArrowDown}{ArrowUp}{Enter}');

    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      `/knowledge?type=projects&entity=${projectResourceId}`,
    );
  });

  it('does not guess a fork route from an invalid Roadmap definition', async () => {
    installRoadmapSearchResult({
      ...roadmapResource,
      definition: { ...roadmapResource.definition, spec: {} },
    });
    const user = userEvent.setup();
    renderSearch();

    await user.click(screen.getByRole('button', { name: 'Search governed entities' }));
    await user.type(screen.getByRole('combobox'), 'roadmap');
    await user.click(await screen.findByRole('option', { name: /Roadmap fork 01/i }));

    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      '/registry?query=roadmap-fork-primary',
    );
  });

  it('separates legacy agents from other governed definitions, then routes definitions into Knowledge', async () => {
    const user = userEvent.setup();
    const { onSelectAgent } = renderSearch();

    await user.keyboard('{Control>}k{/Control}');
    const input = screen.getByRole('combobox', { name: 'Search governed entities' });
    expect(input).toHaveFocus();
    await user.type(input, 'daily');

    expect(await screen.findByText(/LEGACY AGENTS NOT YET IMPORTED · 1/i)).toBeInTheDocument();
    expect(screen.getByText(/OTHER GOVERNED DEFINITIONS · 1/i)).toBeInTheDocument();
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeInTheDocument();
    expect(window.getComputedStyle(listbox.parentElement!).backgroundColor).toBe('rgb(7, 9, 13)');
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
