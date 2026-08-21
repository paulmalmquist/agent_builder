import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ResourceVersion } from '@agent-builder/contracts';
import { KnowledgePage } from './KnowledgePage';
import { renderWithClient } from '../../test/render';
import { server } from '../../test/server';

const now = '2026-08-17T12:00:00.000Z';

function resource(
  overrides: Partial<ResourceVersion> &
    Pick<ResourceVersion, 'familyId' | 'id' | 'kind' | 'name' | 'slug'>,
): ResourceVersion {
  const metadata = {
    id: overrides.familyId,
    slug: overrides.slug,
    version: overrides.version ?? '1.0.0',
    name: overrides.name,
    owner: overrides.owner ?? 'Synthetic Owner',
    purpose: overrides.purpose ?? 'Exercise a synthetic governed relationship.',
    lifecycle: overrides.lifecycle ?? ('candidate' as const),
    provenance: { source: 'synthetic-test' },
  };
  return {
    id: overrides.id,
    familyId: overrides.familyId,
    kind: overrides.kind,
    slug: overrides.slug,
    name: overrides.name,
    version: overrides.version ?? '1.0.0',
    owner: overrides.owner ?? 'Synthetic Owner',
    purpose: overrides.purpose ?? 'Exercise a synthetic governed relationship.',
    lifecycle: overrides.lifecycle ?? 'candidate',
    digest: overrides.digest ?? 'a'.repeat(64),
    sourceCommit: overrides.sourceCommit ?? 'test-commit',
    provenance: overrides.provenance ?? { source: 'synthetic-test' },
    dependencyPins: overrides.dependencyPins ?? [],
    definition: overrides.definition ?? {
      apiVersion: 'paul-os/v1',
      kind: overrides.kind,
      metadata,
      dependencies: overrides.dependencyPins ?? [],
      spec: {},
    },
    revision: overrides.revision ?? 1,
    frozenAt: overrides.frozenAt ?? now,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function resourceResponse(items: ResourceVersion[]) {
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

function useResourceResponses(items: ResourceVersion[]) {
  server.use(
    http.get('http://localhost/v1/resources', () => HttpResponse.json(resourceResponse(items))),
    http.get('http://localhost/v1/resources/:resourceVersionId', ({ params }) => {
      const match = items.find((item) => item.id === params.resourceVersionId);
      return match
        ? HttpResponse.json(match)
        : HttpResponse.json(
            {
              error: {
                code: 'RESOURCE_NOT_FOUND',
                message: 'Resource version was not found.',
                requestId: 'knowledge-test',
              },
            },
            { status: 404 },
          );
    }),
  );
}

describe('KnowledgePage', () => {
  it('exposes the definition-graph boundary without inventing semantic knowledge', async () => {
    const user = userEvent.setup();
    renderWithClient(<KnowledgePage />, ['/knowledge']);

    expect(screen.getByRole('heading', { name: 'Knowledge' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'The definition graph is ready. Semantic organization data is not here yet.',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'AIM demonstrates a separate synthetic capability map.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'OPEN AIM →' })).toHaveAttribute('href', '/aim');

    const entityTypes = screen.getByRole('region', { name: 'Knowledge entity types' });
    for (const label of [
      'People',
      'Systems',
      'Projects',
      'Decisions',
      'Datasets',
      'Runbooks',
      'Incidents',
      'Metrics',
      'Agents & Skills',
    ]) {
      expect(
        within(entityTypes).getByRole('button', { name: new RegExp(label, 'i') }),
      ).toBeInTheDocument();
    }

    await user.click(within(entityTypes).getByRole('button', { name: /People/i }));
    expect(
      screen.getByText('People directory is not connected on this machine.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/no private directory data is inferred here/i)).toBeInTheDocument();
    expect(screen.queryByText('Synthetic Owner')).not.toBeInTheDocument();

    const closeIndex = screen.getByRole('button', { name: 'CLOSE INDEX' });
    expect(closeIndex).toHaveClass('secondary-button');
    await user.click(closeIndex);
    expect(screen.queryByRole('heading', { name: 'People' })).not.toBeInTheDocument();
  });

  it('selects an entity and traverses exact dependencies to agents that touch it', async () => {
    const user = userEvent.setup();
    const datasetFamilyId = '11111111-1111-4111-8111-111111111111';
    const dataset = resource({
      id: '12121212-1212-4212-8212-121212121212',
      familyId: datasetFamilyId,
      kind: 'KnowledgeSource',
      name: 'Synthetic Readiness Dataset',
      slug: 'synthetic-readiness-dataset',
    });
    const agent = resource({
      id: '13131313-1313-4313-8313-131313131313',
      familyId: '14141414-1414-4414-8414-141414141414',
      kind: 'Agent',
      name: 'Synthetic Readiness Agent',
      slug: 'synthetic-readiness-agent',
      dependencyPins: [{ familyId: datasetFamilyId, version: '1.0.0' }],
    });
    const wrongVersionAgent = resource({
      id: '15151515-1515-4515-8515-151515151515',
      familyId: '16161616-1616-4616-8616-161616161616',
      kind: 'Agent',
      name: 'Wrong Version Agent',
      slug: 'wrong-version-agent',
      dependencyPins: [{ familyId: datasetFamilyId, version: '2.0.0' }],
    });
    useResourceResponses([dataset, agent, wrongVersionAgent]);
    renderWithClient(<KnowledgePage />, ['/knowledge']);

    await user.click(await screen.findByRole('button', { name: /Datasets.*1 SHOWN/i }));
    expect(
      await screen.findByRole('button', { name: /Synthetic Readiness Dataset/i }),
    ).toBeInTheDocument();
    expect(screen.getByText('Select an entity to traverse it.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Synthetic Readiness Dataset/i }));
    const relationshipPanel = screen.getByRole('complementary');
    expect(
      within(relationshipPanel).getByRole('heading', { name: 'Synthetic Readiness Dataset' }),
    ).toBeInTheDocument();
    expect(within(relationshipPanel).getByText('EXACT LINKS').parentElement).toHaveTextContent('1');
    expect(
      within(relationshipPanel).getByText('AGENTS THAT TOUCH IT').parentElement,
    ).toHaveTextContent('1');
    const usedByEdge = within(relationshipPanel).getByRole('listitem', {
      name: 'Synthetic Readiness Dataset USED BY Synthetic Readiness Agent',
    });
    expect(within(usedByEdge).getByText('Synthetic Readiness Dataset')).toBeInTheDocument();
    expect(within(usedByEdge).getByText('Synthetic Readiness Agent')).toBeInTheDocument();
    expect(usedByEdge).toHaveTextContent('Declared by Synthetic Readiness Agent V1.0.0');
    expect(within(usedByEdge).getByLabelText('USED BY')).toHaveTextContent('USED BY');
    expect(within(relationshipPanel).getByText(/Exact version pin/)).toHaveTextContent(
      'Exact version pin. No semantic relationship is inferred.',
    );
    expect(within(relationshipPanel).queryByText('Wrong Version Agent')).not.toBeInTheDocument();

    await user.click(
      within(screen.getByRole('region', { name: 'Knowledge entity types' })).getByRole('button', {
        name: /Agents & Skills.*2 SHOWN/i,
      }),
    );
    await user.click(screen.getByRole('button', { name: /Synthetic Readiness Agent/i }));
    const dependsOnEdge = within(screen.getByRole('complementary')).getByRole('listitem', {
      name: 'Synthetic Readiness Agent DEPENDS ON Synthetic Readiness Dataset',
    });
    expect(within(dependsOnEdge).getByLabelText('DEPENDS ON')).toHaveTextContent('DEPENDS ON');
  });

  it('resolves a deep link through the exact scoped resource endpoint', async () => {
    const metric = resource({
      id: '17171717-1717-4717-8717-171717171717',
      familyId: '18181818-1818-4818-8818-181818181818',
      kind: 'MetricDefinition',
      name: 'Synthetic Reliability Metric',
      slug: 'synthetic-reliability-metric',
    });
    server.use(
      http.get('http://localhost/v1/resources', () =>
        HttpResponse.json({
          ...resourceResponse([]),
          total: 127,
          countsByLifecycle: {
            experimental: 127,
            candidate: 0,
            evaluating: 0,
            evaluated: 0,
            certified: 0,
            production: 0,
            deprecated: 0,
          },
        }),
      ),
      http.get('http://localhost/v1/resources/:resourceVersionId', ({ params }) =>
        params.resourceVersionId === metric.id
          ? HttpResponse.json(metric)
          : HttpResponse.json({}, { status: 404 }),
      ),
    );

    renderWithClient(<KnowledgePage />, [`/knowledge?type=metrics&entity=${metric.id}`]);

    expect(
      await screen.findByRole('heading', { name: 'Synthetic Reliability Metric' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Knowledge relationship index is partial: 0 of 127/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('No metrics are imported.')).not.toBeInTheDocument();
  });

  it('resolves an exact Project deep link through its own semantic facet', async () => {
    const project = resource({
      id: '30303030-3030-4030-8030-303030303030',
      familyId: '31313131-3131-4131-8131-313131313131',
      kind: 'Project',
      name: 'Synthetic Roadmap Boundary',
      slug: 'synthetic-roadmap-boundary',
    });
    server.use(
      http.get('http://localhost/v1/resources', () =>
        HttpResponse.json({
          ...resourceResponse([]),
          total: 12,
          countsByLifecycle: {
            experimental: 12,
            candidate: 0,
            evaluating: 0,
            evaluated: 0,
            certified: 0,
            production: 0,
            deprecated: 0,
          },
        }),
      ),
      http.get('http://localhost/v1/resources/:resourceVersionId', ({ params }) =>
        params.resourceVersionId === project.id
          ? HttpResponse.json(project)
          : HttpResponse.json({}, { status: 404 }),
      ),
    );

    renderWithClient(<KnowledgePage />, [`/knowledge?entity=${project.id}&type=projects`]);

    expect(
      await screen.findByRole('heading', { name: 'Synthetic Roadmap Boundary' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument();
    expect(
      screen.getByText(/Knowledge relationship index is partial: 0 of 12/i),
    ).toBeInTheDocument();
  });

  it('does not let an exact deep link reintroduce an audit-only fixture', async () => {
    const fixture = resource({
      id: '26262626-2626-4626-8626-262626262626',
      familyId: '27272727-2727-4727-8727-272727272727',
      kind: 'Agent',
      name: 'Persisted integration fixture',
      slug: 'persisted-integration-fixture',
      provenance: { source: 'worker-integration-test' },
    });
    server.use(
      http.get('http://localhost/v1/resources', () => HttpResponse.json(resourceResponse([]))),
      http.get('http://localhost/v1/resources/:resourceVersionId', () =>
        HttpResponse.json(fixture),
      ),
    );

    renderWithClient(<KnowledgePage />, [`/knowledge?type=agents&entity=${fixture.id}`]);

    expect(
      await screen.findByText(
        'This audit-only fixture is excluded from the user-facing knowledge index.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: fixture.name })).not.toBeInTheDocument();
  });

  it('humanizes opaque incident signal types without exposing their identifier suffix', async () => {
    const opaqueId = '28282828-2828-4828-8828-282828282828';
    server.use(
      http.get('http://localhost/v1/observations', () =>
        HttpResponse.json({
          items: [
            {
              id: '29292929-2929-4929-8929-292929292929',
              signalKey: 'governed-signal',
              signalType: `compose-outcome-signal-${opaqueId}`,
              summary: 'A governed operational signal needs review.',
              evidence: {},
              provenance: {},
              sourceRunId: null,
              sourceOutcomeId: null,
              observedBy: 'human:quality-engineer',
              observedAt: now,
            },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithClient(<KnowledgePage />, ['/knowledge']);

    await user.click(await screen.findByRole('button', { name: /Incidents.*1 SHOWN/i }));
    expect(screen.getByText('OBSERVATION · Compose outcome signal')).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(opaqueId, 'u'))).not.toBeInTheDocument();
  });

  it('shows exact versions, deduplicates exact records, and quarantines explicit fixtures', async () => {
    const familyId = '19191919-1919-4919-8919-191919191919';
    const first = resource({
      id: '20202020-2020-4020-8020-202020202020',
      familyId,
      kind: 'Skill',
      name: 'Daily Brief',
      slug: 'daily-brief',
      version: '1.0.0',
    });
    const successor = resource({
      id: '21212121-2121-4121-8121-212121212121',
      familyId,
      kind: 'Skill',
      name: 'Daily Brief',
      slug: 'daily-brief',
      version: '1.1.0',
      digest: 'b'.repeat(64),
    });
    const workerFixture = resource({
      id: '22222222-2222-4222-8222-222222222222',
      familyId: '23232323-2323-4323-8323-232323232323',
      kind: 'Skill',
      name: 'Daily Brief',
      slug: 'daily-brief-worker-fixture',
      version: '1.0.0-workerabc',
      sourceCommit: 'worker-integration-test',
      digest: 'c'.repeat(64),
    });
    const scopeFixture = resource({
      id: '24242424-2424-4424-8424-242424242424',
      familyId: '25252525-2525-4525-8525-252525252525',
      kind: 'Agent',
      name: 'Scoped legacy mirror',
      slug: 'scoped-legacy-mirror',
      provenance: { source: 'scope-test' },
      digest: 'd'.repeat(64),
    });
    useResourceResponses([first, first, successor, workerFixture, scopeFixture]);
    const user = userEvent.setup();
    renderWithClient(<KnowledgePage />, ['/knowledge']);

    await user.click(await screen.findByRole('button', { name: /Agents & Skills.*2 SHOWN/i }));

    expect(screen.getByRole('button', { name: /Daily Brief.*V1\.0\.0/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Daily Brief.*V1\.1\.0/i })).toBeInTheDocument();
    expect(screen.queryByText('Scoped legacy mirror')).not.toBeInTheDocument();
    expect(screen.queryByText('1.0.0-workerabc')).not.toBeInTheDocument();
  });

  it('fails closed when governed definitions are unavailable', async () => {
    server.use(
      http.get('http://localhost/v1/resources', () =>
        HttpResponse.json(
          {
            error: {
              code: 'DEPENDENCY_UNAVAILABLE',
              message: 'The definition index is unavailable.',
              requestId: 'knowledge-test',
            },
          },
          { status: 503 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithClient(<KnowledgePage />, ['/knowledge']);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Knowledge definitions unavailable. The definition index is unavailable.',
    );
    await user.click(screen.getByRole('button', { name: /Agents & Skills/i }));
    expect(screen.queryByText(/No agents & skills are imported/i)).not.toBeInTheDocument();
  });
});
