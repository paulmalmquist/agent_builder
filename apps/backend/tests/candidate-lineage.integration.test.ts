import { randomUUID } from 'node:crypto';
import { ImprovementCandidateState, PrismaClient } from '@prisma/client';
import { stringify } from 'yaml';
import { RegistryService } from '../src/services/registry-service.js';

const runDatabaseIntegration = process.env['RUN_DATABASE_INTEGRATION'] === 'true';
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;

function skillManifest(familyId: string, slug: string, version: string): string {
  return stringify({
    apiVersion: 'paul-os/v1',
    kind: 'Skill',
    metadata: {
      id: familyId,
      slug,
      version,
      owner: 'candidate-lineage-integration',
      purpose: 'Verify immutable machine-readable lineage from incubation into Git definitions.',
      lifecycle: 'candidate',
      provenance: 'synthetic',
    },
    dependencies: [],
    spec: {
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      tools: [],
      permissions: [],
      contextRequirements: [],
      successCriteria: ['Keep the reviewed improvement candidate linked to its exact import.'],
    },
  });
}

describeDatabase('repository-import improvement-candidate lineage', () => {
  jest.setTimeout(30_000);
  const prisma = new PrismaClient();

  beforeAll(async () => {
    if (!process.env['DATABASE_URL']) {
      throw new Error('RUN_DATABASE_INTEGRATION requires DATABASE_URL');
    }
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('links only an exact incubating target, audits it, and rejects database bypasses', async () => {
    const suffix = randomUUID().slice(0, 8);
    const familyId = randomUUID();
    const slug = `lineage-skill-${suffix}`;
    const observation = await prisma.observation.create({
      data: {
        signalKey: `candidate-lineage:${randomUUID()}`,
        signalType: 'candidate_lineage_test',
        summary: 'A synthetic observation needs a traceable Git definition.',
        evidence: {},
        provenance: { source: 'integration_test' },
        observedBy: 'system:background',
      },
    });
    const createCandidate = (
      target: string,
      state: ImprovementCandidateState = ImprovementCandidateState.INCUBATING,
    ) =>
      prisma.improvementCandidate.create({
        data: {
          observationId: observation.id,
          title: `Candidate ${randomUUID().slice(0, 8)}`,
          proposedTarget: target,
          proposedChange: 'Create an exact, reviewable skill definition without applying it.',
          evidenceRefs: [`observation:${observation.id}`],
          state,
          createdBy: 'system:background',
          reviewedBy: state === ImprovementCandidateState.INCUBATING ? 'human:test' : null,
          reviewRationale:
            state === ImprovementCandidateState.INCUBATING
              ? 'Accept this synthetic candidate for lineage verification.'
              : null,
          reviewedAt: state === ImprovementCandidateState.INCUBATING ? new Date() : null,
        },
      });

    const exactCandidate = await createCandidate(`Skill:${slug}@1.0.0`);
    const registry = new RegistryService(prisma, 'a'.repeat(40));
    const imported = await registry.importResource({
      manifestYaml: skillManifest(familyId, slug, '1.0.0'),
      sourcePath: `02-skills/${slug}/manifest.yaml`,
      improvementCandidateId: exactCandidate.id,
    });

    expect(imported.import.improvementCandidateId).toBe(exactCandidate.id);
    await expect(
      prisma.auditEvent.count({
        where: {
          action: 'repository_import.lineage_attached',
          entityType: 'RepositoryImport',
          entityId: imported.import.id,
        },
      }),
    ).resolves.toBe(1);

    const otherExactCandidate = await createCandidate(`Skill:${slug}@1.0.0`);
    await expect(
      registry.importResource({
        manifestYaml: skillManifest(familyId, slug, '1.0.0'),
        sourcePath: `02-skills/${slug}/manifest.yaml`,
        improvementCandidateId: otherExactCandidate.id,
      }),
    ).rejects.toMatchObject({ code: 'REPOSITORY_IMPORT_LINEAGE_IMMUTABLE' });
    await expect(
      prisma.$executeRaw`UPDATE "RepositoryImport" SET "improvementCandidateId" = ${otherExactCandidate.id}::uuid WHERE "id" = ${imported.import.id}::uuid`,
    ).rejects.toBeDefined();

    const unlinked = await registry.importResource({
      manifestYaml: skillManifest(familyId, slug, '1.0.1'),
      sourcePath: `02-skills/${slug}/manifest.yaml`,
      improvementCandidateId: null,
    });
    const lateCandidate = await createCandidate(`Skill:${slug}@1.0.1`);
    const lateLinked = await registry.importResource({
      manifestYaml: skillManifest(familyId, slug, '1.0.1'),
      sourcePath: `02-skills/${slug}/manifest.yaml`,
      improvementCandidateId: lateCandidate.id,
    });
    expect(lateLinked).toMatchObject({
      idempotent: true,
      import: { id: unlinked.import.id, improvementCandidateId: lateCandidate.id },
    });
    await expect(
      prisma.repositoryImport.update({
        where: { id: unlinked.import.id },
        data: { sourcePath: `02-skills/${slug}/renamed.yaml` },
      }),
    ).rejects.toBeDefined();

    const invalidUnlinked = await registry.importResource({
      manifestYaml: skillManifest(familyId, slug, '1.0.2'),
      sourcePath: `02-skills/${slug}/manifest.yaml`,
      improvementCandidateId: null,
    });
    const proposed = await createCandidate(
      `Skill:${slug}@1.0.2`,
      ImprovementCandidateState.PROPOSED,
    );
    await expect(
      prisma.$executeRaw`UPDATE "RepositoryImport" SET "improvementCandidateId" = ${proposed.id}::uuid WHERE "id" = ${invalidUnlinked.import.id}::uuid`,
    ).rejects.toBeDefined();

    const wrongTarget = await createCandidate(`Agent:${slug}@1.0.2`);
    await expect(
      prisma.$executeRaw`UPDATE "RepositoryImport" SET "improvementCandidateId" = ${wrongTarget.id}::uuid WHERE "id" = ${invalidUnlinked.import.id}::uuid`,
    ).rejects.toBeDefined();
    await expect(
      prisma.repositoryImport.findUniqueOrThrow({ where: { id: invalidUnlinked.import.id } }),
    ).resolves.toMatchObject({ improvementCandidateId: null });
  });
});
