import { createHash, randomUUID } from 'node:crypto';
import {
  PrismaClient,
  ReleaseEvaluationVerdict,
  ResourceKind,
  ResourceLifecycle,
} from '@prisma/client';
import {
  DeterministicFeatureHashEmbeddingProvider,
  type CapabilityProfile,
} from '@agent-builder/contracts';
import { runWithPrincipal, type RequestPrincipal } from '../src/request-context.js';
import { RegistryService } from '../src/services/registry-service.js';
import { ReleaseGovernanceService } from '../src/services/release-governance-service.js';
import { ReuseService } from '../src/services/reuse-service.js';

const databaseEnabled =
  process.env['RUN_DATABASE_INTEGRATION'] === 'true' && process.env['DATABASE_URL'];
const describeDatabase = databaseEnabled ? describe : describe.skip;
const prisma = new PrismaClient();

jest.setTimeout(30_000);

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

const capabilityProfile: CapabilityProfile = {
  schemaVersion: 1,
  intendedUsers: ['knowledge workers'],
  businessDomain: 'personal productivity',
  triggers: ['daily planning request'],
  tasks: ['prioritize the day', 'identify schedule risks'],
  inputs: ['priorities', 'calendar items'],
  outputs: ['top priorities', 'schedule risks'],
  knowledgeClasses: ['user-supplied planning context'],
  tools: [],
  potentialActions: ['propose actions without executing them'],
  successCriteria: ['produce a validated daily briefing'],
  riskLevel: 'low',
};

async function fixture() {
  const suffix = randomUUID();
  const workspaceId = randomUUID();
  const departmentId = randomUUID();
  const agentFamilyId = randomUUID();
  const suiteFamilyId = randomUUID();
  const principal: RequestPrincipal = {
    actorId: `human:reuse-${suffix}`,
    workspaceId,
    departmentId,
    authentication: 'local',
    requestId: randomUUID(),
  };
  await prisma.workspace.create({
    data: { id: workspaceId, slug: `reuse-${suffix}`, name: 'Reuse Test' },
  });
  await prisma.department.create({
    data: { id: departmentId, workspaceId, slug: 'planning', name: 'Planning' },
  });
  await prisma.resourceFamily.createMany({
    data: [
      {
        id: agentFamilyId,
        workspaceId,
        departmentId,
        kind: ResourceKind.AGENT,
        slug: `briefing-agent-${suffix}`,
        name: 'Daily Briefing Agent',
        createdBy: principal.actorId,
        updatedBy: principal.actorId,
      },
      {
        id: suiteFamilyId,
        workspaceId,
        departmentId,
        kind: ResourceKind.EVALUATION_SUITE,
        slug: `briefing-suite-${suffix}`,
        name: 'Daily Briefing Suite',
        createdBy: principal.actorId,
        updatedBy: principal.actorId,
      },
    ],
  });
  const agentDefinition = {
    apiVersion: 'paul-os/v1',
    kind: 'Agent',
    metadata: {
      id: agentFamilyId,
      slug: `briefing-agent-${suffix}`,
      version: '1.0.0',
      name: 'Daily Briefing Agent',
      owner: principal.actorId,
      purpose: 'Create a governed planning briefing from bounded user inputs.',
      lifecycle: 'candidate',
      provenance: 'synthetic-test',
      catalogVisibility: 'organization',
      capabilityProfile,
    },
    dependencies: [],
    spec: {},
  };
  const suiteDefinition = {
    apiVersion: 'paul-os/v1',
    kind: 'EvaluationSuite',
    metadata: {
      id: suiteFamilyId,
      slug: `briefing-suite-${suffix}`,
      version: '1.0.0',
      name: 'Daily Briefing Suite',
      owner: principal.actorId,
      purpose: 'Provide synthetic contract evidence for the reusable briefing fixture.',
      lifecycle: 'candidate',
      provenance: 'synthetic-test',
    },
    dependencies: [],
    spec: {},
  };
  const sourceCommit = digest(suffix).slice(0, 40);
  const channelKey = `reuse-${suffix}`;
  const [agentVersion, suiteVersion] = await Promise.all([
    prisma.resourceVersion.create({
      data: {
        familyId: agentFamilyId,
        version: '1.0.0',
        lifecycle: ResourceLifecycle.CANDIDATE,
        owner: principal.actorId,
        purpose: agentDefinition.metadata.purpose,
        definition: agentDefinition,
        digest: digest(JSON.stringify(agentDefinition)),
        sourceCommit,
        provenance: { source: 'synthetic-test' },
        dependencyPins: [],
        frozenAt: new Date(),
        createdBy: principal.actorId,
        updatedBy: principal.actorId,
      },
    }),
    prisma.resourceVersion.create({
      data: {
        familyId: suiteFamilyId,
        version: '1.0.0',
        lifecycle: ResourceLifecycle.CANDIDATE,
        owner: principal.actorId,
        purpose: suiteDefinition.metadata.purpose,
        definition: suiteDefinition,
        digest: digest(JSON.stringify(suiteDefinition)),
        sourceCommit,
        provenance: { source: 'synthetic-test' },
        dependencyPins: [],
        frozenAt: new Date(),
        createdBy: principal.actorId,
        updatedBy: principal.actorId,
      },
    }),
  ]);
  return runWithPrincipal(principal, async () => {
    const registry = new RegistryService(prisma, sourceCommit);
    const release = await registry.createRelease({
      resourceVersionIds: [agentVersion.id, suiteVersion.id],
      projectId: channelKey,
    });
    const evidence = await prisma.releaseEvaluation.create({
      data: {
        releaseId: release.id,
        releaseDigest: release.digest,
        suiteVersionId: suiteVersion.id,
        suiteDigest: suiteVersion.digest,
        executorKind: 'deterministic_contract',
        executorVersion: '1.0.0',
        evaluationMode: 'contract_validation',
        historySnapshotDigest: digest('history'),
        corpusVersion: 1,
        verdict: ReleaseEvaluationVerdict.PASSED,
        results: [],
        gateScores: {
          schemaConformance: 1,
          citationCoverage: 1,
          unauthorizedActions: 0,
        },
        evidence: {
          schemaVersion: 1,
          historySnapshotDigest: digest('history'),
          historyRunIds: [],
          suiteCaseCount: 12,
          assertionCount: 36,
          subjectPresent: true,
          subjectDigest: agentVersion.digest,
          dependencyClosureComplete: true,
          certifiedResourceIds: [agentVersion.id, suiteVersion.id],
          gateResults: [
            {
              key: 'dependency_closure',
              category: 'contract',
              operator: 'eq',
              threshold: 1,
              measuredValue: 1,
              status: 'passed',
              sampleSize: 1,
              evidenceSource: 'manifest_declaration',
              detail: 'Exact dependency closure is complete.',
            },
            {
              key: 'schema_conformance',
              category: 'contract',
              operator: 'gte',
              threshold: 1,
              measuredValue: 1,
              status: 'passed',
              sampleSize: 12,
              evidenceSource: 'manifest_declaration',
              detail: 'Synthetic outputs match the declared schema.',
            },
            {
              key: 'unauthorized_actions',
              category: 'contract',
              operator: 'eq',
              threshold: 0,
              measuredValue: 0,
              status: 'passed',
              sampleSize: 12,
              evidenceSource: 'manifest_declaration',
              detail: 'The fixture declares no external actions.',
            },
          ],
        },
        requestedBy: principal.actorId,
        finishedAt: new Date(),
      },
    });
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT set_config('paul_os.certification_evidence_id', ${evidence.id}, true)`;
      await transaction.resourceVersion.updateMany({
        where: { id: { in: [agentVersion.id, suiteVersion.id] } },
        data: { lifecycle: ResourceLifecycle.CERTIFIED, updatedBy: principal.actorId },
      });
    });
    const governance = new ReleaseGovernanceService(prisma);
    await governance.promote(channelKey, {
      releaseId: release.id,
      evaluationId: evidence.id,
      rationale: 'Publish the certified synthetic briefing for reuse testing.',
    });
    const publication = await prisma.catalogPublication.findFirstOrThrow({
      where: { releaseId: release.id, resourceVersionId: agentVersion.id },
    });
    const reuse = new ReuseService(
      prisma,
      'direct_allowed',
      new DeterministicFeatureHashEmbeddingProvider(64),
    );
    await reuse.indexer.processPending();
    return { principal, agentVersion, release, publication, reuse };
  });
}

describeDatabase('Promotion-to-reuse PostgreSQL lifecycle', () => {
  afterAll(async () => prisma.$disconnect());

  it('activates and indexes explicit publications, then creates exact deployments and overlays', async () => {
    const test = await fixture();
    await runWithPrincipal(test.principal, async () => {
      const stored = await prisma.catalogPublication.findUniqueOrThrow({
        where: { id: test.publication.id },
      });
      expect(stored).toMatchObject({ state: 'ACTIVE', revision: 2 });
      expect(await prisma.catalogIndexOutbox.count({ where: { publicationId: stored.id } })).toBe(
        1,
      );
      expect(
        await prisma.catalogIndexRecord.findUnique({ where: { publicationId: stored.id } }),
      ).toMatchObject({
        retired: false,
        publicationRevision: 2,
      });

      const intake = await test.reuse.createIntake({
        request: 'Create my daily planning briefing and highlight schedule risks.',
        department: 'Planning',
        capabilityProfile,
        confirmed: true,
      });
      const choices = await test.reuse.referredChoices(intake.id);
      expect(choices.referredChoices[0]).toMatchObject({
        publicationId: stored.id,
        match: { structuredCoverage: 100, mode: 'hybrid_70_30' },
      });
      expect(choices.referredChoices[0]!.match.score).toBeGreaterThan(80);
      expect(JSON.stringify(choices)).not.toContain('"embedding":[');
      expect(JSON.stringify(choices)).not.toContain('embeddingProvenance');
      const decision = await test.reuse.createDecision(
        intake.id,
        {
          action: 'configure',
          selectedPublicationId: stored.id,
          buildNewReason: null,
        },
        `configure:${randomUUID()}`,
      );
      const deployment = await prisma.deployment.findUniqueOrThrow({
        where: { decisionId: decision.id },
      });
      expect(deployment).toMatchObject({
        deployedResourceVersionId: test.agentVersion.id,
        sourcePublicationId: stored.id,
      });
      expect(await prisma.resourceLineage.count({ where: { decisionId: decision.id } })).toBe(0);
      expect(
        await prisma.configurationRevision.count({ where: { deploymentId: deployment.id } }),
      ).toBe(1);
      const second = await test.reuse.appendConfigurationRevision(deployment.id, {
        timezone: 'America/New_York',
      });
      expect(second).toMatchObject({ revision: 2 });
      await expect(
        prisma.configurationRevision.update({
          where: { id: second.id },
          data: { configuration: { timezone: 'UTC' } },
        }),
      ).rejects.toThrow();

      await test.reuse.retirePublication(stored.id, {
        rationale: 'Retire the source to verify deployed configurations are flagged for review.',
      });
      expect(await test.reuse.getDeployment(deployment.id)).toMatchObject({
        sourceRetiredAt: expect.any(String),
        retiredSourceWarning: true,
      });
    });
  });

  it('requires demand evidence over 80%, records it once, and removes retired choices', async () => {
    const test = await fixture();
    await runWithPrincipal(test.principal, async () => {
      const intake = await test.reuse.createIntake({
        request: 'Create my daily planning briefing and highlight schedule risks.',
        department: 'Planning',
        capabilityProfile,
        confirmed: true,
      });
      await expect(
        test.reuse.createDecision(
          intake.id,
          { action: 'build_new', selectedPublicationId: null, buildNewReason: null },
          `build-new:${randomUUID()}`,
        ),
      ).rejects.toMatchObject({ code: 'BUILD_NEW_REASON_REQUIRED' });
      const key = `build-new:${randomUUID()}`;
      const input = {
        action: 'build_new' as const,
        selectedPublicationId: null,
        buildNewReason: 'The briefing needs a new constrained decision format.',
      };
      const [decision, concurrentReplay] = await Promise.all([
        test.reuse.createDecision(intake.id, input, key),
        test.reuse.createDecision(intake.id, input, key),
      ]);
      expect(concurrentReplay.id).toBe(decision.id);
      const replay = await test.reuse.createDecision(intake.id, input, key);
      expect(replay.id).toBe(decision.id);
      expect(decision.demandObservationId).not.toBeNull();
      expect(
        await prisma.observation.count({ where: { signalKey: `builder-demand:${intake.id}` } }),
      ).toBe(1);
      expect(
        await prisma.builderDraft.findUniqueOrThrow({
          where: { decisionId_draftKind: { decisionId: decision.id, draftKind: 'NEW' } },
        }),
      ).toMatchObject({ basePublicationId: null });

      const retired = await test.reuse.retirePublication(test.publication.id, {
        rationale: 'Retire this synthetic catalog entry after the test decision.',
      });
      expect(retired.retiredAt).not.toBeNull();
      await test.reuse.indexer.processPending();
      const replayAfterRetirement = await test.reuse.createDecision(intake.id, input, key);
      expect(replayAfterRetirement.id).toBe(decision.id);
      expect(
        await prisma.observation.count({ where: { signalKey: `builder-demand:${intake.id}` } }),
      ).toBe(1);
      const another = await test.reuse.createIntake({
        request: 'Create another daily planning briefing and highlight schedule risks.',
        department: 'Planning',
        capabilityProfile,
        confirmed: true,
      });
      expect((await test.reuse.referredChoices(another.id)).referredChoices).toHaveLength(0);
      expect(
        await prisma.catalogIndexRecord.findUniqueOrThrow({
          where: { publicationId: test.publication.id },
        }),
      ).toMatchObject({ retired: true });
    });
  });
});
