import { randomUUID } from 'node:crypto';
import {
  ExternalIdentityProvider,
  PlatformRole,
  PrincipalKind,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import type { RequestPrincipal } from '../src/request-context.js';
import {
  withApiPrincipalTransaction,
  withWorkerPrincipalTransaction,
} from '../src/database/scoped-transaction.js';
import { ProjectInstanceService } from '../src/services/project-instance-service.js';
import { PrismaIdentityDirectory } from '../src/services/identity-directory.js';

const databaseEnabled =
  process.env['RUN_DATABASE_INTEGRATION'] === 'true' && process.env['DATABASE_URL'];
const describeDatabase = databaseEnabled ? describe : describe.skip;

const prisma = new PrismaClient();

const principal = (
  workspaceId: string,
  departmentId: string,
  roles: RequestPrincipal['roles'] = ['builder'],
): RequestPrincipal => ({
  principalId: randomUUID(),
  actorId: `human:isolation-${randomUUID()}`,
  workspaceId,
  departmentId,
  authentication: 'local',
  roles,
  requestId: randomUUID(),
});

describeDatabase('identity and representative FORCE-RLS isolation', () => {
  const workspaceIds: string[] = [];

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`
      DO $roles$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paul_os_api') THEN
          CREATE ROLE paul_os_api NOLOGIN NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'paul_os_worker') THEN
          CREATE ROLE paul_os_worker NOLOGIN NOBYPASSRLS;
        END IF;
      END
      $roles$
    `);
    await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO paul_os_api, paul_os_worker');
    await prisma.$executeRawUnsafe(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "ProjectInstance" TO paul_os_api',
    );
    await prisma.$executeRawUnsafe('GRANT SELECT ON "ProjectInstance" TO paul_os_worker');
  });

  afterAll(async () => {
    if (workspaceIds.length > 0) {
      await prisma.projectInstance.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.roleBinding.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.externalIdentity.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.servicePrincipal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.principal.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.department.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    await prisma.$disconnect();
  });

  it('isolates direct SQL and service reads by workspace and department', async () => {
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    const departmentA = randomUUID();
    const departmentA2 = randomUUID();
    const departmentB = randomUUID();
    workspaceIds.push(workspaceA, workspaceB);
    await prisma.workspace.createMany({
      data: [
        { id: workspaceA, slug: `rls-a-${workspaceA}`, name: 'RLS A' },
        { id: workspaceB, slug: `rls-b-${workspaceB}`, name: 'RLS B' },
      ],
    });
    await prisma.department.createMany({
      data: [
        { id: departmentA, workspaceId: workspaceA, slug: 'team', name: 'Team A' },
        { id: departmentA2, workspaceId: workspaceA, slug: 'team-two', name: 'Team A Two' },
        { id: departmentB, workspaceId: workspaceB, slug: 'team', name: 'Team B' },
      ],
    });
    const principalA = principal(workspaceA, departmentA);
    const principalB = principal(workspaceB, departmentB);
    const service = new ProjectInstanceService(prisma);
    const projectA = await service.create(
      { slug: 'project-a', name: 'Project A', departmentId: departmentA },
      principalA,
    );
    const projectB = await service.create(
      { slug: 'project-b', name: 'Project B', departmentId: departmentB },
      principalB,
    );
    const projectA2 = await service.create(
      { slug: 'project-a-two', name: 'Project A Two', departmentId: departmentA2 },
      principal(workspaceA, departmentA, ['admin']),
    );

    expect((await service.list(principalA)).map(({ id }) => id)).toEqual([projectA.id]);
    expect((await service.list(principalB)).map(({ id }) => id)).toEqual([projectB.id]);
    expect(
      new Set(
        (await service.list(principal(workspaceA, departmentA, ['admin']))).map(({ id }) => id),
      ),
    ).toEqual(new Set([projectA.id, projectA2.id]));

    const direct = await withApiPrincipalTransaction(prisma, principalA, (transaction) =>
      transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "ProjectInstance"`),
    );
    expect(direct).toEqual([{ id: projectA.id }]);

    const workerVisible = await withWorkerPrincipalTransaction(prisma, principalB, (transaction) =>
      transaction.projectInstance.findMany({ select: { id: true } }),
    );
    expect(workerVisible).toEqual([{ id: projectB.id }]);
  });

  it('rejects cross-scope writes and exposes nothing when scope settings are absent', async () => {
    const workspaceA = workspaceIds[0] as string;
    const workspaceB = workspaceIds[1] as string;
    const departmentA = (
      await prisma.department.findFirstOrThrow({ where: { workspaceId: workspaceA } })
    ).id;
    const principalA = principal(workspaceA, departmentA);

    await expect(
      withApiPrincipalTransaction(prisma, principalA, (transaction) =>
        transaction.projectInstance.create({
          data: {
            workspaceId: workspaceB,
            departmentId: null,
            slug: `cross-scope-${randomUUID()}`,
            name: 'Cross scope',
            createdBy: principalA.actorId,
          },
        }),
      ),
    ).rejects.toBeDefined();

    const withoutScope = await prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe('SET LOCAL ROLE paul_os_api');
      return transaction.$queryRaw<Array<{ count: bigint }>>(
        Prisma.sql`SELECT COUNT(*)::bigint AS count FROM "ProjectInstance"`,
      );
    });
    expect(withoutScope[0]?.count).toBe(0n);

    const leaked = await prisma.$queryRaw<
      Array<{ workspace: string | null; department: string | null; roles: string | null }>
    >(Prisma.sql`
      SELECT
        current_setting('paul_os.workspace_id', true) AS workspace,
        current_setting('paul_os.department_id', true) AS department,
        current_setting('paul_os.roles', true) AS roles
    `);
    expect(leaked).toEqual([{ workspace: '', department: '', roles: '' }]);
  });

  it('maps issuer/subject to DB-owned authority and ignores token groups', async () => {
    const workspaceId = workspaceIds[0] as string;
    const otherWorkspaceId = workspaceIds[1] as string;
    const departmentId = (await prisma.department.findFirstOrThrow({ where: { workspaceId } })).id;
    const principalId = randomUUID();
    await prisma.principal.create({
      data: {
        id: principalId,
        workspaceId,
        homeDepartmentId: departmentId,
        actorId: `human:db-owned-${randomUUID()}`,
        kind: PrincipalKind.HUMAN,
        displayName: 'DB-owned test identity',
      },
    });
    await prisma.externalIdentity.create({
      data: {
        workspaceId,
        principalId,
        provider: ExternalIdentityProvider.OIDC,
        issuer: 'https://identity.example.test/tenant',
        subject: 'opaque-db-subject',
      },
    });
    await prisma.roleBinding.create({
      data: {
        workspaceId,
        principalId,
        role: PlatformRole.BUILDER,
        departmentId,
        scopeKey: `department:${departmentId}`,
        grantedBy: 'system:test',
      },
    });

    await expect(
      prisma.roleBinding.create({
        data: {
          workspaceId,
          principalId,
          role: PlatformRole.BUILDER,
          scopeKey: 'workspace',
          grantedBy: 'system:test',
        },
      }),
    ).rejects.toBeDefined();

    const runtimeRole = await withApiPrincipalTransaction(
      prisma,
      principal(workspaceId, departmentId, ['admin']),
      (transaction) =>
        transaction.$queryRaw<
          Array<{ role: string; bypass: boolean; superuser: boolean; owns_table: boolean }>
        >(Prisma.sql`
          SELECT
            current_user AS role,
            roles.rolbypassrls AS bypass,
            roles.rolsuper AS superuser,
            pg_get_userbyid(classes.relowner) = current_user AS owns_table
          FROM pg_roles roles
          CROSS JOIN pg_class classes
          WHERE roles.rolname = current_user AND classes.oid = '"ProjectInstance"'::regclass
        `),
    );
    expect(runtimeRole).toEqual([
      { role: 'paul_os_api', bypass: false, superuser: false, owns_table: false },
    ]);

    const directory = new PrismaIdentityDirectory(prisma);
    const resolved = await directory.resolveExternal({
      workspaceId,
      provider: 'oidc',
      authentication: 'oidc',
      identity: {
        issuer: 'https://identity.example.test/tenant',
        subject: 'opaque-db-subject',
        groups: ['administrator', 'another-department'],
      },
    });
    expect(resolved).toMatchObject({
      principalId,
      workspaceId,
      departmentId,
      authentication: 'oidc',
      roles: ['builder'],
    });

    await expect(
      directory.resolveExternal({
        workspaceId: otherWorkspaceId,
        provider: 'oidc',
        authentication: 'oidc',
        identity: {
          issuer: 'https://identity.example.test/tenant',
          subject: 'opaque-db-subject',
          groups: ['admin'],
        },
      }),
    ).rejects.toMatchObject({ code: 'IDENTITY_NOT_MAPPED', status: 401 });
  });
});
