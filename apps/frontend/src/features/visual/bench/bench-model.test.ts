import { describe, expect, it } from 'vitest';
import type {
  Agent,
  AuthorityGrant,
  PluginInstallation,
  ResourceVersion,
} from '@agent-builder/contracts';
import type { PluginCatalogItem } from '../../../api/client';
import { createAssemblyBenchModel, serializeBenchManifest } from './bench-model';

const agentId = '11111111-1111-4111-8111-111111111111';
const resourceId = '22222222-2222-4222-8222-222222222222';
const pluginVersionId = '33333333-3333-4333-8333-333333333333';
const installationId = '44444444-4444-4444-8444-444444444444';
const pluginDigest = 'a'.repeat(64);
const now = '2026-08-18T13:00:00.000Z';

const agent: Agent = {
  id: agentId,
  familyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'synthetic-inspector-v1',
  versionNumber: 1,
  predecessorAgentId: null,
  derivationMode: 'new',
  name: 'Synthetic inspector',
  department: 'Manufacturing Operations',
  purpose: 'Inspect synthetic records and produce a bounded cited report.',
  owner: 'Manufacturing Operations',
  status: 'ready',
  capabilities: ['inspect records'],
  manifest: null,
  manifestHash: null,
  certificationHealth: 'not_certified',
  degradedAt: null,
  degradationReason: null,
  createdAt: now,
  updatedAt: now,
};

const resource: ResourceVersion = {
  id: resourceId,
  familyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'Agent',
  slug: 'synthetic-inspector',
  name: 'Synthetic inspector',
  version: '1.0.0',
  owner: 'Manufacturing Operations',
  purpose: 'Inspect synthetic records and produce a bounded cited report.',
  lifecycle: 'candidate',
  digest: 'b'.repeat(64),
  sourceCommit: 'synthetic-test-commit',
  provenance: { source: 'synthetic-test' },
  dependencyPins: [],
  definition: {
    apiVersion: 'paul-os/v1',
    kind: 'Agent',
    metadata: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      slug: 'synthetic-inspector',
      version: '1.0.0',
      name: 'Synthetic inspector',
      owner: 'Manufacturing Operations',
      purpose: 'Inspect synthetic records and produce a bounded cited report.',
      lifecycle: 'candidate',
      provenance: { source: 'synthetic-test' },
    },
    dependencies: [],
    spec: {
      objective: 'Inspect synthetic records and produce a bounded cited report.',
      skills: ['record-inspection@1.0.0'],
      protocols: [],
      contextPolicy: 'default-context@1.0.0',
      knowledgeSources: [],
      tools: [
        {
          plugin: {
            familyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            version: '1.0.0',
          },
          tool: 'inspect_records',
        },
      ],
      triggers: [],
      executionLoop: {
        maximumSteps: 8,
        onUnresolved: 'fail_closed',
        outputContract: 'inspection-report@1.0.0',
      },
      memoryPolicy: { reads: 'none', writes: 'disabled' },
      production: { requiresImmutableRelease: true, authorityClass: 'R2' },
      legacyCompatibility: {
        agentId,
        department: 'Manufacturing Operations',
        specificationRevision: null,
        sectionDigests: { outcomes: null, knowledge: null, guardrails: null, outputs: null },
        capabilitiesDigest: 'c'.repeat(64),
        manifestDigest: null,
      },
    },
  },
  revision: 1,
  frozenAt: null,
  createdAt: now,
  updatedAt: now,
};

const plugin: PluginCatalogItem = {
  pluginVersionId,
  familyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  slug: 'records',
  name: 'Records warehouse',
  version: '1.0.0',
  digest: pluginDigest,
  transport: 'db',
  executionPlacement: 'control_plane',
  classification: 'internal',
  brand: { monogram: 'RW', accent: '#2f9d82', assetSrc: null },
  capabilities: [
    {
      tool: 'inspect_records',
      description: 'Inspect bounded records through a typed schema.',
      effect: 'read',
      approval: 'not_required',
      scopeDescription: 'Read the requested bounded synthetic records only',
      limits: {
        timeoutMs: 5_000,
        maxResponseBytes: 250_000,
        maxRecords: 100,
        maxInvocationsPerRun: 5,
        maxEstimatedCostUsd: 0.05,
      },
    },
  ],
  secretSlots: [],
  activeScopeDescriptions: ['Read the requested bounded synthetic records only'],
  costThisWeekUsd: 0,
  installationId,
  installationState: 'enabled',
  healthStatus: 'healthy',
  lastUsedAt: now,
};

const installation: PluginInstallation = {
  id: installationId,
  pluginVersionId,
  pluginDigest,
  state: 'enabled',
  executionPlacement: 'control_plane',
  developmentOnly: false,
  secretBindings: [],
  installedBy: 'synthetic-operator',
  installedAt: now,
  configuredAt: now,
  disabledAt: null,
  updatedAt: now,
};

const grant: AuthorityGrant = {
  id: '55555555-5555-4555-8555-555555555555',
  releaseId: '66666666-6666-4666-8666-666666666666',
  entryResourceVersionId: resourceId,
  entrySubject: { name: 'Synthetic inspector', kind: 'agent', version: '1.0.0' },
  releaseDigest: 'd'.repeat(64),
  contextDigest: 'e'.repeat(64),
  projectId: 'synthetic-program',
  inputConstraints: {},
  toolScopes: [],
  pluginScopes: [
    {
      installationId,
      pluginVersionId,
      pluginDigest,
      tool: 'inspect_records',
      effect: 'read',
      scopeDescription: 'Read the requested bounded synthetic records only',
      limits: {
        timeoutMs: 5_000,
        maxResponseBytes: 250_000,
        maxRecords: 100,
        maxInvocationsPerRun: 5,
        maxEstimatedCostUsd: 0.05,
      },
    },
  ],
  validFrom: now,
  validUntil: '2027-08-18T13:00:00.000Z',
  maxRuns: 10,
  usedRuns: 1,
  maxEstimatedCostPerRunUsd: 0.05,
  totalCostBudgetUsd: 0.5,
  spentCostUsd: 0.01,
  reservedCostUsd: 0,
  state: 'active',
  actorId: 'synthetic-operator',
  rationale: 'Permit bounded synthetic inspection runs for this exact release.',
  revokedAt: null,
  createdAt: now,
};

const builderManifest: NonNullable<Agent['manifest']> = {
  agentId,
  name: 'Synthetic inspector',
  department: 'Manufacturing Operations',
  purpose: 'Inspect synthetic records and produce a bounded cited report.',
  version: '0.1.0',
  specRevision: 1,
  generatorVersion: '0.2.0',
  workflow: ['Retrieve governed evidence'],
  knowledgeSourceIds: ['synthetic-records'],
  guardrails: {
    workflowStages: ['Retrieve governed evidence'],
    prohibitedActions: [],
    approvalRequirements: [],
    failClosedConditions: ['Stop when records are unavailable'],
    responseRequirements: {
      citations: true,
      confidence: true,
      unresolvedConflicts: true,
    },
  },
  outputType: 'investigation_report',
  outputSchema: { type: 'object' },
  evaluations: [],
  generatedAt: now,
};

describe('assembly bench model', () => {
  it('renders exact governed tool, connector, and grant records from one manifest', () => {
    const model = createAssemblyBenchModel({
      agent,
      resources: [resource],
      plugins: [plugin],
      installations: [installation],
      grants: { items: [grant], activeTotal: 1 },
      resourceQueryComplete: true,
    });

    expect(model?.manifest).toEqual(resource.definition);
    expect(model?.manifestText).toBe(serializeBenchManifest(resource.definition));
    expect(model?.resourceVersionId).toBe(resourceId);
    expect(model?.authorityClass).toBe('R2');
    expect(model?.provenance).toBe('synthetic');
    expect(model?.capabilities).toEqual([
      expect.objectContaining({
        authority: 'granted',
        connectorState: 'healthy',
        effect: 'read',
        tool: 'inspect_records',
      }),
    ]);
  });

  it('does not turn an incomplete active-grant page into a not-granted claim', () => {
    const model = createAssemblyBenchModel({
      agent,
      resources: [resource],
      plugins: [plugin],
      installations: [installation],
      grants: { items: [], activeTotal: 3 },
      resourceQueryComplete: true,
    });

    expect(model?.capabilities[0]?.authority).toBe('unavailable');
    expect(model?.issues).toContain(
      'The active-grant response is incomplete; unmatched capabilities do not imply no authority.',
    );
  });

  it('refuses one visible governed match when the 100-result search page is incomplete', () => {
    const unlinkedResource: ResourceVersion = {
      ...resource,
      id: '77777777-7777-4777-8777-777777777777',
      definition: {
        ...resource.definition,
        spec: {
          ...resource.definition.spec,
          legacyCompatibility: {
            ...(resource.definition.spec['legacyCompatibility'] as Record<string, unknown>),
            agentId: '88888888-8888-4888-8888-888888888888',
          },
        },
      },
    };
    const model = createAssemblyBenchModel({
      agent: { ...agent, manifest: builderManifest },
      resources: [resource, ...Array.from({ length: 99 }, () => unlinkedResource)],
      resourceQueryComplete: false,
      plugins: [plugin],
      installations: [installation],
      grants: { items: [grant], activeTotal: 1 },
    });

    expect(model?.manifestSource).toBe('builder_agent');
    expect(model?.resourceVersionId).toBeNull();
    expect(model?.capabilities).toEqual([]);
    expect(model?.issues).toContain(
      'The governed Agent search did not return a provably complete page. Visible matches are not proof of a unique resource, so exact connector and grant wiring stays closed.',
    );
  });

  it('uses the Builder manifest without inventing connector wiring when no governed link exists', () => {
    const builderAgent: Agent = {
      ...agent,
      manifest: builderManifest,
    };

    const model = createAssemblyBenchModel({
      agent: builderAgent,
      resources: [],
      resourceQueryComplete: true,
    });

    expect(model?.manifestSource).toBe('builder_agent');
    expect(model?.capabilities).toEqual([]);
    expect(model?.issues[0]).toContain('not linked to a governed Agent resource');
  });
});
