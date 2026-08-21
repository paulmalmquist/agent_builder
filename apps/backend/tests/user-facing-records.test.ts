import type { PrismaClient } from '@prisma/client';
import { CatalogService } from '../src/services/catalog-service.js';
import { PluginService } from '../src/services/plugin-service.js';
import { runWithPrincipal } from '../src/request-context.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';
import {
  isQuarantinedTestIdentity,
  isQuarantinedTestProvenance,
  userFacingAgentWhere,
  userFacingAgentFamilyWhere,
  userFacingResourceVersionWhere,
} from '../src/services/user-facing-records.js';
import { isQuarantinedLegacyFixture } from '@agent-builder/contracts';

describe('user-facing record quarantine', () => {
  it('excludes explicit fixture provenance from the legacy agent catalog query', async () => {
    const findMany: jest.Mock = jest.fn(() => Promise.resolve([]));
    const prisma = {
      agent: { findMany },
    } as unknown as PrismaClient;

    await runWithPrincipal(
      {
        principalId: '41414141-4141-4141-8141-414141414141',
        actorId: 'human:index-review',
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        authentication: 'local',
        roles: ['consumer'],
        requestId: 'user-facing-index-test',
      },
      () => new CatalogService(prisma).list({ query: 'test', limit: 20 }),
    );

    const query = findMany.mock.calls[0]?.[0] as {
      where: { AND: unknown[]; family: unknown };
    };
    expect(query.where.AND).toContainEqual(userFacingAgentWhere);
    expect(query.where.family).toMatchObject({ workspaceId: LOCAL_WORKSPACE_ID });
  });

  it('applies the same quarantine to similarity, family versions, and the Plugin catalog', async () => {
    const agentFindMany: jest.Mock = jest.fn(() => Promise.resolve([]));
    const familyFindFirst: jest.Mock = jest.fn(() => Promise.resolve({ id: 'family' }));
    const resourceFindMany: jest.Mock = jest.fn(() => Promise.resolve([]));
    const prisma = {
      agent: { findMany: agentFindMany },
      agentFamily: { findFirst: familyFindFirst },
      resourceVersion: { findMany: resourceFindMany },
      authorityGrant: { findMany: jest.fn(() => Promise.resolve([])) },
      pluginInvocation: { findMany: jest.fn(() => Promise.resolve([])) },
    } as unknown as PrismaClient;
    const catalog = new CatalogService(prisma);

    await runWithPrincipal(
      {
        principalId: '41414141-4141-4141-8141-414141414141',
        actorId: 'human:index-review',
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        authentication: 'local',
        roles: ['consumer'],
        requestId: 'user-facing-secondary-index-test',
      },
      async () => {
        await catalog.similarity({ query: 'warehouse cost' });
        expect(agentFindMany.mock.calls[0]?.[0].where.AND).toContainEqual(userFacingAgentWhere);
        agentFindMany.mockClear();
        await catalog.list({
          familyId: '51515151-5151-4151-8151-515151515151',
          limit: 20,
        });
        expect(familyFindFirst.mock.calls[0]?.[0].where.AND).toContainEqual(
          userFacingAgentFamilyWhere,
        );
        expect(agentFindMany.mock.calls[0]?.[0].where.AND).toContainEqual(userFacingAgentWhere);

        const plugins = new PluginService(prisma, { environment: 'test' }, { probe: jest.fn() });
        await plugins.listCatalog({ includeDisabled: false, limit: 20 });
        expect(resourceFindMany.mock.calls[0]?.[0].where.AND).toContainEqual(
          userFacingResourceVersionWhere,
        );
      },
    );
  });

  it('uses explicit provenance identities and bounded legacy fixture fingerprints', () => {
    expect(isQuarantinedTestIdentity('plugin-worker-test')).toBe(true);
    expect(isQuarantinedTestIdentity('plugin-store-integration')).toBe(true);
    expect(isQuarantinedTestIdentity('human:reuse-41414141-4141-4141-8141-414141414141')).toBe(
      true,
    );
    expect(isQuarantinedTestIdentity('human:plugin-service-audit')).toBe(true);
    expect(isQuarantinedTestIdentity('human:quality-engineer')).toBe(false);
    expect(isQuarantinedTestIdentity('Test Readiness Agent')).toBe(false);
    expect(
      isQuarantinedLegacyFixture({
        name: 'Integration Queued Resume Probe',
        owner: 'Supply Chain Agent Owner',
        purpose:
          'Produces an evidence-backed supplier risk briefing for production planners and escalation owners.',
      }),
    ).toBe(true);
    expect(
      isQuarantinedLegacyFixture({
        name: 'Integration Queued Resume Probe',
        owner: 'Real Integration Team',
        purpose: 'Review real integration readiness.',
      }),
    ).toBe(false);
    expect(
      isQuarantinedTestProvenance({
        createdBy: 'system:background',
        sourceCommit: 'legacy-unverified',
      }),
    ).toBe(true);
    expect(
      isQuarantinedTestProvenance({
        createdBy: 'system:background',
        sourceCommit: 'a'.repeat(40),
      }),
    ).toBe(true);
    expect(
      isQuarantinedTestProvenance({
        createdBy: 'system:background',
        sourceCommit: 'b'.repeat(40),
      }),
    ).toBe(false);
    expect(
      isQuarantinedTestProvenance({
        createdBy: 'system:background',
        sourceCommit: 'synthetic-baseline',
      }),
    ).toBe(false);
  });
});
