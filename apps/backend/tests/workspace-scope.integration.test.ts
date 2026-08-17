import { randomUUID } from 'node:crypto';
import {
  AgentDerivationMode,
  AgentStatus,
  PrismaClient,
  SourceAuthority,
  SourceProvider,
  SourceRole,
} from '@prisma/client';
import { runWithPrincipal, type RequestPrincipal } from '../src/request-context.js';
import { RegistryService } from '../src/services/registry-service.js';
import { SourceService } from '../src/services/source-service.js';
import {
  LOCAL_DEPARTMENT_ID,
  LOCAL_DEPARTMENT_SLUG,
  LOCAL_WORKSPACE_ID,
  LOCAL_WORKSPACE_SLUG,
} from '../src/scope-constants.js';

const runDatabaseIntegration =
  process.env['RUN_DATABASE_INTEGRATION'] === 'true' && process.env['DATABASE_URL'];
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;

const scopedRoots = [
  'AgentFamily',
  'KnowledgeSource',
  'CertificationGateConfig',
  'EvalCase',
  'EvalCorpusVersion',
  'SpecInterpretation',
  'AuditEvent',
  'ResourceFamily',
  'ReleaseBundle',
  'ProductionChannel',
  'AuthorityGrant',
  'ExecutionRun',
  'MetricSample',
  'AutomationSchedule',
  'Observation',
] as const;

function principal(workspaceId: string, departmentId: string | null): RequestPrincipal {
  return {
    actorId: 'human:workspace-scope-integration',
    workspaceId,
    departmentId,
    authentication: 'local',
    requestId: randomUUID(),
  };
}

describeDatabase('workspace scope seam', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('seeds one deterministic local workspace and department', async () => {
    const [workspaces, departments] = await Promise.all([
      prisma.workspace.findMany({ where: { slug: LOCAL_WORKSPACE_SLUG } }),
      prisma.department.findMany({
        where: { workspaceId: LOCAL_WORKSPACE_ID, slug: LOCAL_DEPARTMENT_SLUG },
      }),
    ]);

    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]?.id).toBe(LOCAL_WORKSPACE_ID);
    expect(departments).toHaveLength(1);
    expect(departments[0]?.id).toBe(LOCAL_DEPARTMENT_ID);
  });

  it('requires explicit workspace scope on every aggregate root after backfill', async () => {
    const columns = await prisma.$queryRaw<
      Array<{
        table_name: string;
        column_name: string;
        is_nullable: string;
        column_default: string | null;
      }>
    >`
      SELECT table_name, column_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = ANY(${scopedRoots}::text[])
        AND column_name IN ('workspaceId', 'departmentId')
      ORDER BY table_name, column_name
    `;

    expect(columns).toHaveLength(scopedRoots.length * 2);
    for (const table of scopedRoots) {
      expect(columns).toContainEqual({
        table_name: table,
        column_name: 'workspaceId',
        is_nullable: 'NO',
        column_default: null,
      });
      expect(columns).toContainEqual({
        table_name: table,
        column_name: 'departmentId',
        is_nullable: 'YES',
        column_default: null,
      });
    }
  });

  it('enforces department/workspace pairing and immutable aggregate scope', async () => {
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    const departmentA = randomUUID();
    await prisma.workspace.createMany({
      data: [
        { id: workspaceA, slug: `scope-a-${workspaceA}`, name: 'Scope A' },
        { id: workspaceB, slug: `scope-b-${workspaceB}`, name: 'Scope B' },
      ],
    });
    await prisma.department.create({
      data: { id: departmentA, workspaceId: workspaceA, slug: 'scope-a', name: 'Scope A' },
    });

    const sourceId = `scope-source-${randomUUID()}`;
    await expect(
      prisma.knowledgeSource.create({
        data: {
          id: sourceId,
          workspaceId: workspaceB,
          departmentId: departmentA,
          role: SourceRole.KNOWLEDGE,
          provider: SourceProvider.FIXTURE,
          displayName: 'Invalid cross-workspace source',
          uri: 'fixture://scope/invalid',
          authority: SourceAuthority.SYSTEM_OF_RECORD,
          owner: 'Scope test',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    await prisma.knowledgeSource.create({
      data: {
        id: sourceId,
        workspaceId: workspaceA,
        departmentId: departmentA,
        role: SourceRole.KNOWLEDGE,
        provider: SourceProvider.FIXTURE,
        displayName: 'Immutable scoped source',
        uri: 'fixture://scope/immutable',
        authority: SourceAuthority.SYSTEM_OF_RECORD,
        owner: 'Scope test',
      },
    });
    await expect(
      prisma.knowledgeSource.update({
        where: { id: sourceId },
        data: { workspaceId: workspaceB, departmentId: null },
      }),
    ).rejects.toThrow(/scope is immutable/i);
  });

  it('shows global and own-department roots but hides sibling and foreign roots', async () => {
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    const departmentA = randomUUID();
    const departmentB = randomUUID();
    await prisma.workspace.createMany({
      data: [
        { id: workspaceA, slug: `visible-a-${workspaceA}`, name: 'Visible A' },
        { id: workspaceB, slug: `visible-b-${workspaceB}`, name: 'Visible B' },
      ],
    });
    await prisma.department.createMany({
      data: [
        { id: departmentA, workspaceId: workspaceA, slug: 'own', name: 'Own department' },
        { id: departmentB, workspaceId: workspaceA, slug: 'sibling', name: 'Sibling department' },
      ],
    });
    const prefix = `visibility-${randomUUID()}`;
    const source = (suffix: string, workspaceId: string, departmentId: string | null) => ({
      id: `${prefix}-${suffix}`,
      workspaceId,
      departmentId,
      role: SourceRole.KNOWLEDGE,
      provider: SourceProvider.FIXTURE,
      displayName: `${suffix} scope source`,
      uri: `fixture://scope/${suffix}`,
      authority: SourceAuthority.SYSTEM_OF_RECORD,
      owner: 'Scope test',
    });
    await prisma.knowledgeSource.createMany({
      data: [
        source('global', workspaceA, null),
        source('own', workspaceA, departmentA),
        source('sibling', workspaceA, departmentB),
        source('foreign', workspaceB, null),
      ],
    });

    const visible = await runWithPrincipal(principal(workspaceA, departmentA), () =>
      new SourceService(prisma).list(null),
    );
    const visibleFixtureIds = visible
      .map(({ id }) => id)
      .filter((id) => id.startsWith(prefix))
      .sort();
    expect(visibleFixtureIds).toEqual([`${prefix}-global`, `${prefix}-own`].sort());

    const foreignReleaseId = randomUUID();
    await prisma.releaseBundle.create({
      data: {
        id: foreignReleaseId,
        workspaceId: workspaceB,
        departmentId: null,
        digest: Buffer.from(foreignReleaseId).toString('hex').slice(0, 64).padEnd(64, '0'),
        createdBy: 'scope-test',
      },
    });
    await expect(
      runWithPrincipal(principal(workspaceA, departmentA), () =>
        new RegistryService(prisma, 'a'.repeat(40)).getRelease(foreignReleaseId),
      ),
    ).rejects.toMatchObject({ status: 404, code: 'RELEASE_NOT_FOUND' });
  });

  it('inherits the owning AgentFamily scope into the legacy registry mirror', async () => {
    const familyId = randomUUID();
    const agentId = randomUUID();
    await prisma.agentFamily.create({
      data: {
        id: familyId,
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        slug: `scope-legacy-${familyId}`,
        name: 'Scoped legacy mirror',
        department: 'Personal',
        owner: 'Scope test',
        createdBy: 'scope-test',
        updatedBy: 'scope-test',
      },
    });
    await prisma.agent.create({
      data: {
        id: agentId,
        familyId,
        slug: `scope-legacy-${familyId}-v1`,
        versionNumber: 1,
        derivationMode: AgentDerivationMode.NEW,
        name: 'Scoped legacy mirror',
        department: 'Personal',
        purpose: 'Verify that legacy resource mirrors inherit aggregate scope.',
        owner: 'Scope test',
        status: AgentStatus.DRAFT,
        createdBy: 'scope-test',
        updatedBy: 'scope-test',
      },
    });

    const mirrored = await prisma.resourceFamily.findUniqueOrThrow({ where: { id: familyId } });
    expect(mirrored).toMatchObject({
      workspaceId: LOCAL_WORKSPACE_ID,
      departmentId: LOCAL_DEPARTMENT_ID,
    });
  });
});
