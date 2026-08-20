import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { AuthorityGrant, CatalogPublication, ResourceVersion } from '@agent-builder/contracts';
import { useLocation } from 'react-router-dom';
import { CatalogPage } from './CatalogPage';
import { renderWithClient } from '../../test/render';
import {
  catalogAgent,
  httpPluginInstallationId,
  httpPluginVersionId,
  platformRunFixture,
  server,
} from '../../test/server';

const knowledgeSource: ResourceVersion = {
  id: '61616161-6161-4161-8161-616161616161',
  familyId: '62626262-6262-4262-8262-626262626262',
  kind: 'KnowledgeSource',
  slug: 'synthetic-cost-ledger',
  name: 'Synthetic Cost Ledger',
  version: '1.0.0',
  owner: 'Synthetic Operations',
  purpose: 'Expose bounded synthetic warehouse cost records for cited analysis.',
  lifecycle: 'production',
  digest: 'b'.repeat(64),
  sourceCommit: 'catalog-detail-test',
  provenance: { source: 'synthetic-test' },
  dependencyPins: [],
  definition: {
    apiVersion: 'paul-os/v1',
    kind: 'KnowledgeSource',
    metadata: {
      id: '62626262-6262-4262-8262-626262626262',
      slug: 'synthetic-cost-ledger',
      version: '1.0.0',
      name: 'Synthetic Cost Ledger',
      owner: 'Synthetic Operations',
      purpose: 'Expose bounded synthetic warehouse cost records for cited analysis.',
      lifecycle: 'production',
      provenance: { source: 'synthetic-test' },
    },
    dependencies: [],
    spec: {},
  },
  revision: 1,
  frozenAt: '2026-08-17T12:00:00.000Z',
  createdAt: '2026-08-17T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z',
};

const capabilityProfile = {
  schemaVersion: 1 as const,
  intendedUsers: ['Finance operators'],
  businessDomain: 'Cost Operations',
  triggers: ['Daily anomaly review'],
  tasks: ['Attribute warehouse cost anomalies'],
  inputs: ['Bounded cost records'],
  outputs: ['Cited anomaly brief'],
  knowledgeClasses: ['Warehouse cost ledger'],
  tools: ['Calendar API'],
  potentialActions: ['Draft an escalation'],
  successCriteria: ['Every claim cites a governed record'],
  riskLevel: 'moderate' as const,
};

const canonicalAgent: ResourceVersion = {
  id: '51515151-5151-4151-8151-515151515151',
  familyId: '52525252-5252-4252-8252-525252525252',
  kind: 'Agent',
  slug: 'synthetic-cost-sentinel',
  name: 'Synthetic Cost Sentinel',
  version: '1.2.0',
  owner: 'Synthetic Operations',
  purpose: 'Attribute synthetic warehouse spend anomalies to bounded queries.',
  lifecycle: 'candidate',
  digest: 'c'.repeat(64),
  sourceCommit: 'catalog-detail-test',
  provenance: { source: 'synthetic-test' },
  dependencyPins: [
    { familyId: knowledgeSource.familyId, version: knowledgeSource.version },
    { familyId: '38383838-3838-4383-8383-383838383838', version: '2.1.0' },
  ],
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
      lifecycle: 'candidate',
      provenance: { source: 'synthetic-test' },
      catalogVisibility: 'organization',
      capabilityProfile,
    },
    dependencies: [
      { familyId: knowledgeSource.familyId, version: knowledgeSource.version },
      { familyId: '38383838-3838-4383-8383-383838383838', version: '2.1.0' },
    ],
    spec: {
      objective: 'Attribute bounded warehouse cost anomalies and draft a cited review brief.',
      skills: ['cost-attribution@1.0.0'],
      protocols: ['fail-closed-read@1.0.0'],
      contextPolicy: 'bounded-context@1.0.0',
      knowledgeSources: ['synthetic-cost-ledger@1.0.0'],
      tools: [
        {
          plugin: {
            familyId: '38383838-3838-4383-8383-383838383838',
            version: '2.1.0',
          },
          tool: 'list_events',
        },
      ],
      triggers: [],
      executionLoop: {
        maximumSteps: 8,
        onUnresolved: 'return_to_user',
        outputContract: 'cited-cost-brief@1.0.0',
      },
      memoryPolicy: { reads: 'accepted_only', writes: 'staged_for_human_acceptance' },
      production: { requiresImmutableRelease: true, authorityClass: 'read-only-cost' },
      legacyCompatibility: {
        agentId: catalogAgent.id,
        department: 'Cost Operations',
        specificationRevision: 3,
        sectionDigests: {
          outcomes: '1'.repeat(64),
          knowledge: '2'.repeat(64),
          guardrails: '3'.repeat(64),
          outputs: '4'.repeat(64),
        },
        capabilitiesDigest: '5'.repeat(64),
        manifestDigest: '6'.repeat(64),
      },
    },
  },
  revision: 2,
  frozenAt: '2026-08-17T12:00:00.000Z',
  createdAt: '2026-08-17T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z',
};

const publication: CatalogPublication = {
  id: '71717171-7171-4171-8171-717171717171',
  revision: 1,
  subjectKind: 'agent',
  resourceVersionId: canonicalAgent.id,
  releaseId: '72727272-7272-4272-8272-727272727272',
  releaseDigest: '7'.repeat(64),
  name: canonicalAgent.name,
  version: canonicalAgent.version,
  owner: canonicalAgent.owner,
  department: 'Cost Operations',
  catalogVisibility: 'organization',
  capabilityProfile,
  trustChip: {
    certificationState: 'certified',
    gatesPassed: 12,
    gatesTotal: 12,
    corpusSize: 240,
    recertifiedAt: '2026-08-17T12:00:00.000Z',
    label: 'Certified · 12/12 gates · corpus 240 · re-certified Aug 17',
  },
  publishedAt: '2026-08-17T12:00:00.000Z',
  retiredAt: null,
};

const matchingGrant: AuthorityGrant = {
  id: '73737373-7373-4373-8373-737373737373',
  releaseId: publication.releaseId,
  entryResourceVersionId: canonicalAgent.id,
  entrySubject: { name: canonicalAgent.name, kind: 'agent', version: canonicalAgent.version },
  releaseDigest: publication.releaseDigest,
  contextDigest: '8'.repeat(64),
  projectId: 'cost-operations',
  inputConstraints: {},
  toolScopes: [],
  pluginScopes: [
    {
      installationId: httpPluginInstallationId,
      pluginVersionId: httpPluginVersionId,
      pluginDigest: '3'.repeat(64),
      tool: 'list_events',
      effect: 'read',
      scopeDescription: 'Read calendar events in the requested window',
      limits: {
        timeoutMs: 5_000,
        maxResponseBytes: 100_000,
        maxRecords: 100,
        maxInvocationsPerRun: 4,
        maxEstimatedCostUsd: 0.1,
      },
    },
  ],
  validFrom: '2026-08-17T12:00:00.000Z',
  validUntil: '2027-08-17T12:00:00.000Z',
  maxRuns: 10,
  usedRuns: 2,
  maxEstimatedCostPerRunUsd: 0.1,
  totalCostBudgetUsd: 2,
  spentCostUsd: 0.2,
  reservedCostUsd: 0,
  state: 'active',
  actorId: 'catalog-reviewer',
  rationale: 'Permit bounded cost review runs for this exact certified release.',
  revokedAt: null,
  createdAt: '2026-08-17T12:00:00.000Z',
};

function response(items: ResourceVersion[]) {
  return {
    items,
    total: items.length,
    countsByLifecycle: {
      experimental: 0,
      candidate: items.filter((item) => item.lifecycle === 'candidate').length,
      evaluating: 0,
      evaluated: 0,
      certified: 0,
      production: items.filter((item) => item.lifecycle === 'production').length,
      deprecated: 0,
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{`${location.pathname}${location.search}`}</output>;
}

function installDetailedCatalogHandlers(agent: ResourceVersion = canonicalAgent) {
  const run = {
    ...platformRunFixture(),
    entryResourceVersionId: agent.id,
    entrySubject: { name: agent.name, kind: 'agent', version: agent.version },
    state: 'succeeded' as const,
    progress: 100,
    message: 'Cited cost review completed.',
    finishedAt: '2026-08-17T12:10:00.000Z',
  };
  server.use(
    http.get('http://localhost/v1/resources', ({ request }) => {
      const kind = new URL(request.url).searchParams.get('kind');
      return HttpResponse.json(response(kind === 'Agent' ? [agent] : [agent, knowledgeSource]));
    }),
    http.get('http://localhost/v1/resources/:resourceVersionId', ({ params }) =>
      params.resourceVersionId === agent.id
        ? HttpResponse.json(agent)
        : HttpResponse.json(
            { error: { code: 'RESOURCE_NOT_FOUND', message: 'Resource version was not found.' } },
            { status: 404 },
          ),
    ),
    http.get('http://localhost/v1/catalog/publications', () =>
      HttpResponse.json({ items: agent.id === canonicalAgent.id ? [publication] : [] }),
    ),
    http.get('http://localhost/v1/authority-grants', () =>
      HttpResponse.json({
        items: agent.id === canonicalAgent.id ? [matchingGrant] : [],
        total: agent.id === canonicalAgent.id ? 1 : 0,
        activeTotal: agent.id === canonicalAgent.id ? 1 : 0,
      }),
    ),
    http.get('http://localhost/v1/execution-runs', () =>
      HttpResponse.json({
        items: [run],
        total: 1,
        countsByState: {
          awaiting_approval: 0,
          queued: 0,
          running: 0,
          succeeded: 1,
          failed: 0,
          cancelled: 0,
          paused_budget: 0,
          paused_plugin: 0,
        },
      }),
    ),
  );

  return run;
}

describe('CatalogPage', () => {
  it('opens one exact governed record with truthful knowledge, connector, authority, and evidence', async () => {
    const user = userEvent.setup();
    const matchingRun = installDetailedCatalogHandlers();
    renderWithClient(
      <>
        <CatalogPage />
        <LocationProbe />
      </>,
      ['/catalog'],
    );

    const card = await screen.findByRole('link', {
      name: 'Open governed record for Synthetic Cost Sentinel, version 1.2.0',
    });
    expect(within(card).getByText(/EXACT DEPENDENCIES · 2/i)).toBeInTheDocument();
    expect(within(card).getByText('DEFINITION LIFECYCLE · candidate')).toBeInTheDocument();
    expect(
      within(card).getByText(/REUSE CERTIFICATION · 12\/12 GATES PASSED/i),
    ).toBeInTheDocument();

    await user.click(card);

    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Cost Sentinel' });
    expect(within(dialog).getByText('DEFINITION LIFECYCLE · candidate')).toBeInTheDocument();
    expect(within(dialog).getByText('REUSE CERTIFICATION · CERTIFIED')).toBeInTheDocument();
    expect(within(dialog).getByText('Synthetic Cost Ledger')).toBeInTheDocument();
    expect(within(dialog).getByText(/Calendar API · list_events/i)).toBeInTheDocument();
    expect(within(dialog).getByText('EFFECT · read')).toBeInTheDocument();
    expect(within(dialog).getByText('ACTIVE MATCHING GRANT')).toBeInTheDocument();
    expect(within(dialog).getByText(/12\/12 gates · corpus 240/i)).toBeInTheDocument();
    const currentVersion = within(dialog).getByText('CURRENT VERSION').closest('[aria-current]');
    expect(currentVersion).toHaveAttribute('aria-current', 'page');
    expect(currentVersion?.tagName).toBe('DIV');
    expect(within(currentVersion as HTMLElement).getByText('Version 1.2.0')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('link', { name: /Version 1\.2\.0/i }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('link', { name: /Cited cost review completed\./i }),
    ).toHaveAttribute('href', `/runs?run=${matchingRun.id}`);
    expect(
      within(dialog).getByRole('link', { name: /CHECK CERTIFIED FIT IN BUILD/i }),
    ).toHaveAttribute('href', `/build?source=${canonicalAgent.id}`);
    expect(within(dialog).getByText('INSPECT ASSEMBLY · NOT ENABLED')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('link', { name: /CHECK CERTIFIED FIT IN BUILD/i }));
    expect(screen.getByLabelText('Current route')).toHaveTextContent(
      `/build?source=${canonicalAgent.id}`,
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows a deliberate empty state without claiming a global agent total', async () => {
    server.use(http.get('http://localhost/v1/resources', () => HttpResponse.json(response([]))));
    renderWithClient(<CatalogPage />, ['/catalog']);

    expect(
      await screen.findByText('No canonical Agent resources are imported.'),
    ).toBeInTheDocument();
    expect(screen.getByText('AGENT DEFINITIONS SHOWN').parentElement).toHaveTextContent('0');
    expect(screen.getByText('PRODUCTION DEFINITIONS SHOWN').parentElement).toHaveTextContent('0');
    expect(screen.getByText(/Every count above describes this loaded view/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('fails closed and hides cached definitions when the canonical registry fails', async () => {
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
    for (const label of [
      'AGENT DEFINITIONS SHOWN',
      'PRODUCTION DEFINITIONS SHOWN',
      'CERTIFIED DEFINITIONS SHOWN',
    ]) {
      expect(screen.getByText(label).parentElement).toHaveTextContent('—');
    }
  });

  it('quarantines an explicit fixture identity from both the index and an exact deep link', async () => {
    const fixture = { ...canonicalAgent, sourceCommit: 'integration-test' };
    installDetailedCatalogHandlers(fixture);
    renderWithClient(<CatalogPage />, [`/catalog?resource=${fixture.id}`]);

    expect(
      await screen.findByText(
        'This audit-only fixture is quarantined from the user-facing Catalog.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: fixture.name })).not.toBeInTheDocument();
    expect(screen.getByText('AGENT DEFINITIONS SHOWN').parentElement).toHaveTextContent('0');
  });
});
