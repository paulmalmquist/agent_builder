import { HttpResponse, http } from 'msw';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentManifest, ResourceVersion } from '@agent-builder/contracts';
import { renderWithClient } from '../../../test/render';
import { catalogAgent, server } from '../../../test/server';
import { serializeBenchManifest } from './bench-model';
import { ASSEMBLY_BENCH_FIXTURE_MODEL } from './fixtures';
import { AssemblyBench, AssemblyBenchEntry } from './AssemblyBench';

const benchScene = vi.hoisted(() => ({
  create: vi.fn(),
  destroy: vi.fn(),
  wake: vi.fn(),
}));

vi.mock('./scene', () => ({ createBenchScene: benchScene.create }));

afterEach(() => {
  cleanup();
  benchScene.create.mockReset();
  benchScene.destroy.mockReset();
  benchScene.wake.mockReset();
  vi.restoreAllMocks();
});

const apiManifest: AgentManifest = {
  agentId: catalogAgent.id,
  name: catalogAgent.name,
  department: catalogAgent.department,
  purpose: catalogAgent.purpose,
  version: '0.1.0',
  specRevision: 2,
  generatorVersion: '0.2.0',
  workflow: ['Retrieve governed evidence', 'Draft a cited escalation'],
  knowledgeSourceIds: ['synthetic-supplier-records'],
  guardrails: {
    workflowStages: ['Retrieve governed evidence', 'Draft a cited escalation'],
    prohibitedActions: ['Changing purchase orders'],
    approvalRequirements: [],
    failClosedConditions: ['Stop when a required source is unavailable'],
    responseRequirements: { citations: true, confidence: true, unresolvedConflicts: true },
  },
  outputType: 'investigation_report',
  outputSchema: { type: 'object', required: ['summary'] },
  evaluations: [
    {
      name: 'Produces a governed answer',
      input: { request: 'Summarize the highest-priority synthetic case' },
      expectedResult: { includesCitations: true },
    },
  ],
  generatedAt: '2026-08-18T13:00:00.000Z',
};

function governedAgentResource(linkedAgentId: string, id: string): ResourceVersion {
  const familyId = '51515151-5151-4151-8151-515151515151';
  return {
    id,
    familyId,
    kind: 'Agent',
    slug: 'supplier-risk-analyst',
    name: 'Supplier Risk Analyst',
    version: '1.0.0',
    owner: 'Supply Operations',
    purpose: 'Inspect bounded supplier risk evidence.',
    lifecycle: 'candidate',
    digest: 'f'.repeat(64),
    sourceCommit: 'synthetic-test-commit',
    provenance: { source: 'synthetic-test' },
    dependencyPins: [],
    definition: {
      apiVersion: 'paul-os/v1',
      kind: 'Agent',
      metadata: {
        id: familyId,
        slug: 'supplier-risk-analyst',
        version: '1.0.0',
        name: 'Supplier Risk Analyst',
        owner: 'Supply Operations',
        purpose: 'Inspect bounded supplier risk evidence.',
        lifecycle: 'candidate',
        provenance: { source: 'synthetic-test' },
      },
      dependencies: [],
      spec: { legacyCompatibility: { agentId: linkedAgentId } },
    },
    revision: 1,
    frozenAt: null,
    createdAt: '2026-08-18T13:00:00.000Z',
    updatedAt: '2026-08-18T13:00:00.000Z',
  };
}

describe('AssemblyBench', () => {
  it('renders the complete capability schematic when WebGL is absent', async () => {
    renderWithClient(<AssemblyBench model={ASSEMBLY_BENCH_FIXTURE_MODEL} />);

    expect(await screen.findByTestId('assembly-bench-flat-fallback')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Build anomaly investigator connector authority' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'See what this agent knows and can do.' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot grant, revoke, or execute tools/i)).toBeInTheDocument();
    expect(screen.getByText('NO DIRECT MUTATIONS')).toBeInTheDocument();
    expect(screen.getAllByText('FIXTURE DATA').length).toBeGreaterThan(0);
    expect(screen.getByText('Quality system · Create hold request')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'DRY RUN · NOT CONNECTED' })).toBeDisabled();
  });

  it('prints the exact manifest value supplied by the API fixture', async () => {
    server.use(
      http.get('http://localhost/agents/:agentId', () =>
        HttpResponse.json({ ...catalogAgent, manifest: apiManifest }),
      ),
    );

    renderWithClient(<AssemblyBenchEntry agentId={catalogAgent.id} />);

    await waitFor(() => {
      expect(screen.getByTestId('assembly-bench-manifest').textContent).toBe(
        serializeBenchManifest(apiManifest),
      );
    });
    expect(
      screen.getAllByText('CURRENT BUILDER MANIFEST · PROVENANCE UNAVAILABLE').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/exact connector and grant wiring is unavailable/i),
    ).toBeInTheDocument();
  });

  it('does not present one visible governed match as unique on a capped resource page', async () => {
    const linked = governedAgentResource(catalogAgent.id, '52525252-5252-4252-8252-525252525252');
    const unlinked = governedAgentResource(
      '53535353-5353-4353-8353-535353535353',
      '54545454-5454-4454-8454-545454545454',
    );
    server.use(
      http.get('http://localhost/agents/:agentId', () =>
        HttpResponse.json({ ...catalogAgent, manifest: apiManifest }),
      ),
      http.get('http://localhost/v1/resources', () =>
        HttpResponse.json({
          items: [linked, ...Array.from({ length: 99 }, () => unlinked)],
          total: 100,
          countsByLifecycle: {
            experimental: 0,
            candidate: 100,
            evaluating: 0,
            evaluated: 0,
            certified: 0,
            production: 0,
            deprecated: 0,
          },
        }),
      ),
    );

    renderWithClient(<AssemblyBenchEntry agentId={catalogAgent.id} />);

    expect(
      await screen.findByText(/governed Agent search did not return a provably complete page/i),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('CURRENT BUILDER MANIFEST · PROVENANCE UNAVAILABLE').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText('CURRENT GOVERNED MANIFEST')).not.toBeInTheDocument();
    expect(screen.getByTestId('assembly-bench-manifest').textContent).toBe(
      serializeBenchManifest(apiManifest),
    );
  });

  it('prevents WebGL context loss and switches to the complete flat schematic', async () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Assembly Bench Browser');
    benchScene.create.mockReturnValue({
      destroy: benchScene.destroy,
      wake: benchScene.wake,
    });
    const { unmount } = renderWithClient(<AssemblyBench model={ASSEMBLY_BENCH_FIXTURE_MODEL} />);

    await waitFor(() => expect(benchScene.create).toHaveBeenCalledOnce());
    const canvas = screen.getByTestId('assembly-bench-webgl');
    const contextLost = new Event('webglcontextlost', { cancelable: true });
    const preventDefault = vi.spyOn(contextLost, 'preventDefault');
    fireEvent(canvas, contextLost);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(await screen.findByTestId('assembly-bench-flat-fallback')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Build anomaly investigator connector authority' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/WebGL context was lost/i)).toBeInTheDocument();
    expect(benchScene.destroy).toHaveBeenCalledOnce();

    unmount();
    expect(benchScene.destroy).toHaveBeenCalledOnce();
    const detachedEvent = new Event('webglcontextlost', { cancelable: true });
    const detachedPreventDefault = vi.spyOn(detachedEvent, 'preventDefault');
    fireEvent(canvas, detachedEvent);
    expect(detachedPreventDefault).not.toHaveBeenCalled();
  });

  it('stays read-only and unavailable when the agent record has no manifest', async () => {
    renderWithClient(<AssemblyBenchEntry agentId={catalogAgent.id} />);

    expect(
      await screen.findByRole('heading', { name: 'The assembly bench is unavailable.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/will not infer tools, connectors, or authority from a display name/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
