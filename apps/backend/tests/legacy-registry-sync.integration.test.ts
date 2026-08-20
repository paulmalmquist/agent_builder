import { randomUUID } from 'node:crypto';
import { AgentStatus, CertificationRunKind, PrismaClient, ResourceLifecycle } from '@prisma/client';
import { agentResourceSpecSchema, resourceManifestSchema } from '@agent-builder/contracts';
import { canonicalJson, sha256 } from '@paul-os/runtime';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';
import { RegistryService } from '../src/services/registry-service.js';

const describeDatabase =
  process.env['RUN_DATABASE_INTEGRATION'] === 'true' && process.env['DATABASE_URL']
    ? describe
    : describe.skip;
const inventoryAgentId = 'fbcbcd95-15be-49c0-a8a7-a2bc361b7521';

describeDatabase('legacy registry compatibility synchronization', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('resolves the seeded inventory compatibility record by its exact legacy version slug', async () => {
    const result = await new RegistryService(prisma, 'a'.repeat(40)).listResources({
      kind: 'Agent',
      query: 'inventory-risk-analyst-v1',
      limit: 100,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: inventoryAgentId,
      familyId: inventoryAgentId,
      kind: 'Agent',
      lifecycle: 'candidate',
      name: 'Inventory Risk Analyst',
      owner: 'Operations Analytics',
      purpose:
        'Analyzes inventory exposure and material shortages to prioritize operational risk and mitigation actions.',
      sourceCommit: 'legacy-unverified',
      provenance: {
        source: 'legacy-agent-compatibility-adapter',
        verified: false,
      },
      definition: {
        metadata: {
          name: 'Inventory Risk Analyst',
          owner: 'Operations Analytics',
        },
        spec: {
          objective:
            'Analyzes inventory exposure and material shortages to prioritize operational risk and mitigation actions.',
          executionLoop: { outputContract: 'legacy-agent-output@1.0.0' },
          legacyCompatibility: { agentId: inventoryAgentId },
        },
      },
    });
    expect(JSON.stringify(result.items[0])).not.toMatch(/supplier|supply chain/iu);
  });

  it('mirrors new legacy agents/spec edits and links them with unverified provenance', async () => {
    const familyId = randomUUID();
    const agentId = randomUUID();
    const specId = randomUUID();
    const suffix = familyId.slice(0, 8);
    const actor = 'human:governance-compatibility-spec';
    await prisma.agentFamily.create({
      data: {
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        id: familyId,
        slug: `compat-${suffix}`,
        name: 'Compatibility test family',
        department: 'Synthetic Operations',
        owner: 'integration-test',
        createdBy: actor,
        updatedBy: actor,
      },
    });
    await prisma.agent.create({
      data: {
        id: agentId,
        familyId,
        slug: `compat-${suffix}-v1`,
        versionNumber: 1,
        name: 'Compatibility test agent',
        department: 'Synthetic Operations',
        purpose: 'Prove compatibility writes remain visible in the universal registry.',
        owner: 'integration-test',
        createdBy: actor,
        updatedBy: actor,
      },
    });

    const initial = await prisma.resourceVersion.findUniqueOrThrow({ where: { id: agentId } });
    expect(initial.legacyAgentId).toBe(agentId);
    expect(initial.sourceCommit).toBe('legacy-unverified');
    expect(initial.lifecycle).toBe(ResourceLifecycle.EXPERIMENTAL);
    const initialManifest = resourceManifestSchema.parse(initial.definition);
    agentResourceSpecSchema.parse(initialManifest.spec);
    expect(initial.digest).toBe(sha256(canonicalJson(initialManifest)));

    await prisma.agentSpec.create({
      data: {
        id: specId,
        agentId,
        outcomes: { purpose: 'Synthetic compatibility outcome' },
        createdBy: actor,
        updatedBy: actor,
      },
    });
    const afterSpec = await prisma.resourceVersion.findUniqueOrThrow({ where: { id: agentId } });
    expect(afterSpec.revision).toBeGreaterThan(initial.revision);
    expect(afterSpec.digest).not.toBe(initial.digest);
    const specManifest = resourceManifestSchema.parse(afterSpec.definition);
    const compatibility = agentResourceSpecSchema.parse(specManifest.spec).legacyCompatibility;
    expect(compatibility?.specificationRevision).toBe(1);
    expect(compatibility?.sectionDigests.outcomes).not.toBeNull();
    expect(afterSpec.digest).toBe(sha256(canonicalJson(specManifest)));

    await prisma.agent.update({
      where: { id: agentId },
      data: { status: AgentStatus.CERTIFIED, updatedBy: actor },
    });
    const certified = await prisma.resourceVersion.findUniqueOrThrow({ where: { id: agentId } });
    // Legacy evidence remains linked, but it cannot bypass the universal release-governance
    // evaluator and production-channel promotion path.
    expect(certified.lifecycle).toBe(ResourceLifecycle.CANDIDATE);
    expect(certified.frozenAt).not.toBeNull();

    const exactLegacySlug = await new RegistryService(prisma, 'a'.repeat(40)).listResources({
      kind: 'Agent',
      query: `compat-${suffix}-v1`,
      limit: 100,
    });
    expect(exactLegacySlug.items).toHaveLength(1);
    expect(exactLegacySlug.items[0]).toMatchObject({
      id: agentId,
      familyId,
      kind: 'Agent',
      lifecycle: 'candidate',
      owner: 'integration-test',
      version: '1.0.0',
      definition: {
        spec: {
          objective: 'Prove compatibility writes remain visible in the universal registry.',
          executionLoop: { outputContract: 'legacy-agent-output@1.0.0' },
          legacyCompatibility: { agentId },
        },
      },
    });
    expect(JSON.stringify(exactLegacySlug.items[0])).not.toContain('supplier');
    await expect(prisma.agentSpec.delete({ where: { id: specId } })).rejects.toThrow();
    await expect(
      prisma.resourceVersion.update({
        where: { id: agentId },
        data: { purpose: 'This frozen mirror must reject mutation.' },
      }),
    ).rejects.toThrow();

    const [corpus, gateConfig] = await Promise.all([
      prisma.evalCorpusVersion.findFirst({ orderBy: { version: 'desc' } }),
      prisma.certificationGateConfig.findFirst({ orderBy: { version: 'desc' } }),
    ]);
    if (!corpus || !gateConfig) throw new Error('Integration seed must publish corpus and gates.');

    const run = await prisma.certificationRun.create({
      data: {
        agentVersionId: agentId,
        familyId,
        championVersionId: null,
        kind: CertificationRunKind.CHALLENGER,
        originStatus: AgentStatus.CERTIFIED,
        corpusVersionId: corpus.id,
        corpusVersion: corpus.version,
        gateConfigId: gateConfig.id,
        gateConfigVersion: gateConfig.version,
        corpusSnapshot: {},
        gateConfigSnapshot: {},
        subjectSnapshot: {},
        subjectManifestSnapshot: {},
        subjectManifestHash: 'compatibility-subject-hash',
        championManifestHash: null,
        specRevision: 1,
        generatorVersion: 'integration-test',
        executorVersion: '1.0.0',
        requestedBy: 'integration-test',
      },
    });
    expect(run.subjectResourceVersionId).toBe(agentId);
    expect(run.comparisonResourceVersionId).toBeNull();
    await expect(
      prisma.certificationRun.update({
        where: { id: run.id },
        data: { comparisonResourceVersionId: agentId },
      }),
    ).rejects.toThrow();
  });
});
