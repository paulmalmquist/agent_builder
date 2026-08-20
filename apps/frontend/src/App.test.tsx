import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ResourceVersion } from '@agent-builder/contracts';
import { App } from './App';
import { renderWithClient } from './test/render';
import {
  catalogPublicationId,
  lastBuilderDecision,
  lastBuilderDecisionIdempotencyKey,
  platformResourceId,
  server,
} from './test/server';

const catalogSourceId = '81818181-8181-4181-8181-818181818181';
const catalogSourceFamilyId = '82828282-8282-4282-8282-828282828282';
const catalogSource: ResourceVersion = {
  id: catalogSourceId,
  familyId: catalogSourceFamilyId,
  kind: 'Agent',
  slug: 'inventory-risk-analyst',
  name: 'Inventory Risk Analyst',
  version: '1.4.0',
  owner: 'Operations Analytics',
  purpose: 'Review bounded inventory exposure and prepare a cited decision brief.',
  lifecycle: 'candidate',
  digest: '9'.repeat(64),
  sourceCommit: 'builder-source-context-test',
  provenance: { source: 'synthetic-test' },
  dependencyPins: [],
  definition: {
    apiVersion: 'paul-os/v1',
    kind: 'Agent',
    metadata: {
      id: catalogSourceFamilyId,
      slug: 'inventory-risk-analyst',
      version: '1.4.0',
      name: 'Inventory Risk Analyst',
      owner: 'Operations Analytics',
      purpose: 'Review bounded inventory exposure and prepare a cited decision brief.',
      lifecycle: 'candidate',
      provenance: { source: 'synthetic-test' },
    },
    dependencies: [],
    spec: {
      objective: 'Review bounded inventory exposure and prepare a cited decision brief.',
      skills: ['inventory-review@1.0.0'],
      protocols: [],
      contextPolicy: 'bounded-context@1.0.0',
      knowledgeSources: [],
      tools: [],
      triggers: [],
      executionLoop: {
        maximumSteps: 8,
        onUnresolved: 'fail_closed',
        outputContract: 'inventory-decision-brief@1.0.0',
      },
      memoryPolicy: { reads: 'accepted_only', writes: 'staged_for_human_acceptance' },
      production: { requiresImmutableRelease: true, authorityClass: 'R1' },
    },
  },
  revision: 4,
  frozenAt: '2026-08-20T12:00:00.000Z',
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z',
};

async function defineScope(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /open step 01/i }));
  await user.type(screen.getByLabelText('Agent name'), 'Supplier continuity analyst');
  await user.type(screen.getByLabelText('Department'), 'Manufacturing Operations');
  await user.type(
    screen.getByLabelText('Job to be done'),
    'Monitor supplier delays and prepare an evidence-backed escalation brief.',
  );
  await user.type(screen.getByLabelText('Primary users'), 'Supply planners and program managers');
  await user.type(screen.getByLabelText('Desired outcomes'), 'Identify at-risk builds');
  await user.click(screen.getByRole('button', { name: 'Find reusable agents' }));
}

async function chooseBuildNew(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', {
      name: /none of these fit — build a new agent/i,
    }),
  );
  await user.type(
    screen.getByLabelText(/Why does the referred option not fit/i),
    'This workflow needs a distinct approval boundary.',
  );
  await user.click(screen.getByRole('button', { name: 'Create new draft' }));
}

async function completeSpecification(user: ReturnType<typeof userEvent.setup>) {
  await defineScope(user);
  await chooseBuildNew(user);
  expect(await screen.findByText(/New draft created/i)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /open step 02/i }));
  await user.click(await screen.findByLabelText(/Build genealogy/i));
  await user.click(screen.getByRole('button', { name: 'Save knowledge & access' }));
  expect(await screen.findByText('Knowledge saved.')).toBeInTheDocument();

  await user.click(await screen.findByRole('button', { name: /open step 03/i }));
  await user.click(screen.getByRole('button', { name: 'Save actions & workflow' }));
  expect(await screen.findByText('Guardrails saved.')).toBeInTheDocument();

  await user.click(await screen.findByRole('button', { name: /open step 04/i }));
  await user.click(screen.getByRole('button', { name: 'Save success criteria' }));
  expect(await screen.findByText('Outputs saved.')).toBeInTheDocument();
}

describe('Agent Builder workflow', () => {
  it('keeps an exact governed Catalog version visible as read-only Build context', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('http://localhost/v1/resources/:resourceVersionId', ({ params }) =>
        params.resourceVersionId === catalogSource.id
          ? HttpResponse.json(catalogSource)
          : HttpResponse.json({}, { status: 404 }),
      ),
    );
    renderWithClient(<App />, [`/build?source=${catalogSource.id}`]);

    const source = await screen.findByRole('region', { name: 'Build source lineage' });
    expect(source).toHaveTextContent('STARTING SOURCE · EXACT GOVERNED VERSION');
    expect(source).toHaveTextContent('Inventory Risk Analyst · V1.4.0');
    expect(source).toHaveTextContent(
      /Durable lineage is recorded only with that reviewed decision/i,
    );
    expect(screen.queryByText(catalogSource.id)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'REVIEW EXACT CATALOG RECORD →' })).toHaveAttribute(
      'href',
      `/catalog?resource=${catalogSource.id}`,
    );

    await user.click(screen.getByRole('button', { name: 'CLEAR SOURCE CONTEXT' }));
    expect(screen.queryByRole('region', { name: 'Build source lineage' })).not.toBeInTheDocument();
  });

  it('fails closed when Build source context is not an exact governed Agent version', async () => {
    renderWithClient(<App />, [`/build?source=${platformResourceId}`]);

    const source = await screen.findByRole('region', { name: 'Build source lineage' });
    expect(source).toHaveTextContent('STARTING SOURCE · UNAVAILABLE');
    expect(source).toHaveTextContent(/No replacement is inferred/i);
    expect(source).not.toHaveTextContent('Daily Brief');
    expect(screen.queryByText(platformResourceId)).not.toBeInTheDocument();
  });

  it('opens as the Build workbench with drafting-specific workflow marks', () => {
    renderWithClient(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Build' })).toBeInTheDocument();
    expect(screen.getByText(/Paul OS checks certified agents first/i)).toBeInTheDocument();
    expect(screen.queryByText(/Faster\. Governed\. Effective\./i)).not.toBeInTheDocument();
    expect(
      Array.from(document.querySelectorAll('[data-workflow-mark]')).map((mark) =>
        mark.getAttribute('data-workflow-mark'),
      ),
    ).toEqual(['definition-sheet', 'source-table', 'control-flow', 'acceptance-gate']);
  });

  it('unlocks each workflow step only after its predecessor is complete', async () => {
    const user = userEvent.setup();
    renderWithClient(<App />);

    const step01 = screen.getByRole('button', { name: /open step 01/i });
    const step02 = screen.getByRole('button', { name: /open step 02/i });
    const step03 = screen.getByRole('button', { name: /open step 03/i });
    const step04 = screen.getByRole('button', { name: /open step 04/i });

    expect(step01).toHaveAttribute('aria-disabled', 'false');
    expect(step02).toHaveAttribute('aria-disabled', 'true');
    expect(step02).not.toBeDisabled();
    expect(step03).toHaveAttribute('aria-disabled', 'true');
    expect(step04).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('LOCKED · COMPLETE STEP 01 FIRST')).toBeInTheDocument();

    await user.click(step02);
    expect(await screen.findByText('Complete step 01 first.')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Define knowledge & access' }),
    ).not.toBeInTheDocument();

    await defineScope(user);
    await chooseBuildNew(user);
    expect(await screen.findByText(/New draft created/i)).toBeInTheDocument();
    await waitFor(() => expect(step02).toHaveAttribute('aria-disabled', 'false'));
    expect(step03).toHaveAttribute('aria-disabled', 'true');

    await user.click(step03);
    expect(await screen.findByText('Complete step 02 first.')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Define actions & workflow' }),
    ).not.toBeInTheDocument();

    await user.click(step02);
    await user.click(await screen.findByLabelText(/Build genealogy/i));
    await user.click(screen.getByRole('button', { name: 'Save knowledge & access' }));
    expect(await screen.findByText('Knowledge saved.')).toBeInTheDocument();
    await waitFor(() => expect(step03).toHaveAttribute('aria-disabled', 'false'));
    expect(step04).toHaveAttribute('aria-disabled', 'true');

    await user.click(step04);
    expect(await screen.findByText('Complete step 03 first.')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Define success criteria' }),
    ).not.toBeInTheDocument();

    await user.click(step03);
    await user.click(screen.getByRole('button', { name: 'Save actions & workflow' }));
    expect(await screen.findByText('Guardrails saved.')).toBeInTheDocument();
    await waitFor(() => expect(step04).toHaveAttribute('aria-disabled', 'false'));
  });

  it('creates a configuration overlay without forking a new specification', async () => {
    let specCreates = 0;
    const recordSpecCreation = ({ request }: { request: Request; requestId: string }) => {
      if (new URL(request.url).pathname === '/v1/builder/specs' && request.method === 'POST') {
        specCreates += 1;
      }
    };
    server.events.on('request:start', recordSpecCreation);
    const user = userEvent.setup();
    try {
      renderWithClient(<App />);
      await defineScope(user);
      await user.click(await screen.findByRole('button', { name: /Configure overlay/i }));
      await user.click(screen.getByRole('button', { name: 'Create overlay' }));

      expect(await screen.findByText(/certified agent was not forked/i)).toBeInTheDocument();
      expect(specCreates).toBe(0);
      expect(screen.getByRole('button', { name: /open step 02/i })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
    } finally {
      server.events.removeListener('request:start', recordSpecCreation);
    }
  });

  it('searches the canonical catalog before creating a draft', async () => {
    const user = userEvent.setup();
    renderWithClient(<App />);

    expect(screen.getAllByText('DEFINE SCOPE & PURPOSE').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DEFINE KNOWLEDGE & ACCESS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DEFINE ACTIONS & WORKFLOW').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DEFINE SUCCESS CRITERIA').length).toBeGreaterThan(0);

    await defineScope(user);

    expect(await screen.findByText(/Referred choices are ready/i)).toBeInTheDocument();
    expect(await screen.findByText('87% MATCH')).toBeInTheDocument();
    expect(screen.getByText(/Closest certified match: 87%/i)).toBeInTheDocument();
    expect(screen.getByText(/Certified · 12\/12 gates/i)).toBeInTheDocument();
    expect(screen.getAllByText('Structured-only fallback').length).toBeGreaterThan(0);
    expect(screen.getByText(/Custom approval brief/i)).toBeInTheDocument();
    expect(screen.getByText(/9 active · 14 total deployments/i)).toBeInTheDocument();
    expect(screen.getByText(/92% success across 50 runs/i)).toBeInTheDocument();
    expect(screen.getByText(/\$0.31 per run/i)).toBeInTheDocument();
  });

  it('records an idempotent use-as-is deployment without any legacy Build request', async () => {
    const legacyPaths: string[] = [];
    const recordLegacyPath = ({ request }: { request: Request; requestId: string }) => {
      const path = new URL(request.url).pathname;
      if (path.startsWith('/agents')) legacyPaths.push(path);
    };
    server.events.on('request:start', recordLegacyPath);
    const user = userEvent.setup();
    try {
      renderWithClient(<App />);
      await defineScope(user);
      await user.click(
        await screen.findByRole('button', { name: /Use Supplier Risk Analyst as-is/i }),
      );
      await user.click(screen.getByRole('button', { name: 'Create deployment' }));

      expect(await screen.findByText(/No draft was created/i)).toBeInTheDocument();
      expect(lastBuilderDecision).toEqual({
        action: 'use_as_is',
        selectedPublicationId: catalogPublicationId,
        buildNewReason: null,
      });
      expect(lastBuilderDecisionIdempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
      expect(legacyPaths).toEqual([]);
    } finally {
      server.events.removeListener('request:start', recordLegacyPath);
    }
  });

  it('records Extend as a forked guided draft', async () => {
    const user = userEvent.setup();
    renderWithClient(<App />);
    await defineScope(user);
    await user.click(await screen.findByRole('button', { name: /Extend as fork/i }));
    await user.click(screen.getByRole('button', { name: 'Create extension draft' }));

    expect(await screen.findByText(/recorded source lineage/i)).toBeInTheDocument();
    expect(lastBuilderDecision).toEqual({
      action: 'extend',
      selectedPublicationId: catalogPublicationId,
      buildNewReason: null,
    });
  });

  it('completes all sections, generates, and enters shadow evaluation', async () => {
    const user = userEvent.setup();
    renderWithClient(<App />);

    await completeSpecification(user);

    await user.click(await screen.findByRole('button', { name: /review & generate/i }));
    await user.click(screen.getByRole('button', { name: 'Generate agent' }));

    expect(await screen.findByText('Agent manifest generated')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deploy to shadow' }));

    await waitFor(() => {
      expect(screen.getByText('100% passed')).toBeInTheDocument();
    });
    expect(screen.getByText('Produces a governed answer')).toBeInTheDocument();
  });

  it('shows structured generation failure and recovers the agent to draft', async () => {
    const jobId = '33333333-3333-4333-8333-333333333333';
    const agentId = '11111111-1111-4111-8111-111111111111';
    const specId = '22222222-2222-4222-8222-222222222222';
    let recoverCalls = 0;
    server.use(
      http.get(`http://localhost/v1/builder/generation-jobs/${jobId}`, () =>
        HttpResponse.json({
          id: jobId,
          agentId,
          specId,
          state: 'failed',
          progress: 35,
          message: 'Backend restarted while generation was running',
          specRevision: 4,
          generatorVersion: '0.2.0',
          manifest: null,
          error: {
            code: 'ORPHANED_ON_RESTART',
            message: 'Backend restarted while generation was running',
          },
          createdAt: '2026-07-31T14:00:00.000Z',
          updatedAt: '2026-07-31T14:00:00.000Z',
        }),
      ),
      http.post(`http://localhost/v1/builder/agents/${agentId}/recover`, () => {
        recoverCalls += 1;
        return HttpResponse.json({ agentId, status: 'draft' });
      }),
    );

    const user = userEvent.setup();
    renderWithClient(<App />);
    await completeSpecification(user);
    await user.click(await screen.findByRole('button', { name: /review & generate/i }));
    await user.click(screen.getByRole('button', { name: 'Generate agent' }));

    expect(await screen.findByText('ORPHANED_ON_RESTART')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', {
        name: 'Backend restarted while generation was running',
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Recover agent to draft' }));

    expect(
      await screen.findByText(/The agent is back in draft and the ready specification/i),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /review & generate/i })).toBeInTheDocument();
    expect(recoverCalls).toBe(1);
  });
});
