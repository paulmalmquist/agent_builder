import { randomUUID } from 'node:crypto';
import { AgentStatus, CertificationRunKind, PrismaClient, ResourceLifecycle } from '@prisma/client';
import { agentResourceSpecSchema, resourceManifestSchema } from '@agent-builder/contracts';
import { canonicalJson, sha256 } from '@paul-os/runtime';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';

const describeDatabase =
  process.env['RUN_DATABASE_INTEGRATION'] === 'true' && process.env['DATABASE_URL']
    ? describe
    : describe.skip;

describeDatabase('legacy registry compatibility synchronization', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('mirrors new legacy agents/spec edits and links them with unverified provenance', async () => {
    const familyId = randomUUID();
    const agentId = randomUUID();
    const specId = randomUUID();
    const suffix = familyId.slice(0, 8);
    await prisma.agentFamily.create({
      data: {
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        id: familyId,
        slug: `compat-${suffix}`,
        name: 'Compatibility test family',
        department: 'Synthetic Operations',
        owner: 'integration-test',
        createdBy: 'integration-test',
        updatedBy: 'integration-test',
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
        createdBy: 'integration-test',
        updatedBy: 'integration-test',
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
        createdBy: 'integration-test',
        updatedBy: 'integration-test',
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
      data: { status: AgentStatus.CERTIFIED, updatedBy: 'integration-test' },
    });
    const certified = await prisma.resourceVersion.findUniqueOrThrow({ where: { id: agentId } });
    // Legacy evidence remains linked, but it cannot bypass the universal release-governance
    // evaluator and production-channel promotion path.
    expect(certified.lifecycle).toBe(ResourceLifecycle.CANDIDATE);
    expect(certified.frozenAt).not.toBeNull();
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
