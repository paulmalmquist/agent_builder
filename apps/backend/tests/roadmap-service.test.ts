import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import request from 'supertest';
import { pino } from 'pino';
import { ResourceKind, ResourceLifecycle, type PrismaClient } from '@prisma/client';
import { canonicalJson, compileResourceYaml, sha256 } from '@paul-os/runtime';
import { roadmapResourceSpecSchema, resourceManifestSchema } from '@agent-builder/contracts';
import { requestContextMiddleware } from '../src/request-context.js';
import { createApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import { RoadmapService } from '../src/services/roadmap-service.js';
import type { ServiceBundle } from '../src/services/types.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';

const now = new Date('2026-08-20T12:00:00.000Z');
const workspaceRoot = path.resolve(process.cwd(), '..', '..');
const manifestPaths = [
  path.join(workspaceRoot, '03-projects', 'roadmaps', 'fork-01', 'manifest.yaml'),
  path.join(workspaceRoot, '03-projects', 'roadmaps', 'fork-02', 'manifest.yaml'),
] as const;
const targetDefinitions = new Map([
  [
    '30000000-0000-4000-8000-000000000001@1.1.0',
    {
      id: '32000000-0000-4000-8000-000000000001',
      kind: ResourceKind.PROJECT,
      slug: 'personal-operations',
      name: 'Personal operations',
    },
  ],
  [
    '70000000-0000-4000-8000-000000000002@1.3.0',
    {
      id: '32000000-0000-4000-8000-000000000002',
      kind: ResourceKind.PROTOCOL,
      slug: 'console-grammar',
      name: 'Console grammar',
    },
  ],
  [
    '80000000-0000-4000-8000-000000000001@1.1.0',
    {
      id: '32000000-0000-4000-8000-000000000003',
      kind: ResourceKind.KNOWLEDGE_SOURCE,
      slug: 'planning-fixture',
      name: 'Planning fixture',
    },
  ],
]);

function runAsHuman<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const middleware = requestContextMiddleware({ enabled: false, actorId: 'human:roadmap-test' });
    const request = {
      path: '/v1/roadmaps',
      header: () => undefined,
      id: 'roadmap-request',
    } as unknown as Request;
    const response = { setHeader: jest.fn() } as unknown as Response;
    middleware(request, response, (error?: unknown) => {
      if (error !== undefined) {
        reject(error instanceof Error ? error : new Error('Request context failed'));
        return;
      }
      operation().then(resolve, reject);
    });
  });
}

function targetVersion(
  familyId: string,
  version: string,
  input: { id: string; kind: ResourceKind; slug: string; name: string },
) {
  return {
    id: input.id,
    familyId,
    version,
    digest: input.id.replaceAll('-', '').padEnd(64, '0').slice(0, 64),
    family: {
      id: familyId,
      workspaceId: LOCAL_WORKSPACE_ID,
      departmentId: LOCAL_DEPARTMENT_ID,
      kind: input.kind,
      slug: input.slug,
      name: input.name,
    },
  };
}

async function roadmapRecords() {
  return Promise.all(
    manifestPaths.map(async (manifestPath, index) => {
      const compiled = compileResourceYaml(await readFile(manifestPath, 'utf8'));
      const resourceVersionId = `33000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const dependencyPinsFrom = compiled.manifest.dependencies.map((dependency, pinIndex) => {
        const key = `${dependency.familyId}@${dependency.version}`;
        const target = targetDefinitions.get(key);
        if (target === undefined) throw new Error(`Missing test target ${key}`);
        const resolved = targetVersion(dependency.familyId, dependency.version, target);
        return {
          id: `34000000-0000-4000-8000-${String(index * 10 + pinIndex + 1).padStart(12, '0')}`,
          sourceVersionId: resourceVersionId,
          targetVersionId: resolved.id,
          targetDigest: resolved.digest,
          createdAt: now,
          targetVersion: resolved,
        };
      });
      return {
        id: resourceVersionId,
        familyId: compiled.manifest.metadata.id,
        legacyAgentId: null,
        version: compiled.manifest.metadata.version,
        lifecycle: ResourceLifecycle.CANDIDATE,
        owner: compiled.manifest.metadata.owner,
        purpose: compiled.manifest.metadata.purpose,
        definition: compiled.manifest,
        digest: compiled.digest,
        sourceCommit: 'roadmap-service-test',
        provenance: compiled.manifest.metadata.provenance,
        dependencyPins: compiled.manifest.dependencies,
        revision: 1,
        frozenAt: now,
        createdBy: 'human:roadmap-test',
        updatedBy: 'human:roadmap-test',
        createdAt: now,
        updatedAt: now,
        family: {
          id: compiled.manifest.metadata.id,
          workspaceId: LOCAL_WORKSPACE_ID,
          departmentId: LOCAL_DEPARTMENT_ID,
          kind: ResourceKind.ROADMAP,
          slug: compiled.manifest.metadata.slug,
          name: compiled.manifest.metadata.name,
          createdBy: 'human:roadmap-test',
          updatedBy: 'human:roadmap-test',
          createdAt: now,
          updatedAt: now,
        },
        dependencyPinsFrom,
      };
    }),
  );
}

function serviceFor(records: unknown[]) {
  const findMany = jest.fn().mockResolvedValue(records);
  return {
    findMany,
    service: new RoadmapService({ resourceVersion: { findMany } } as unknown as PrismaClient),
  };
}

function refreshDigest(record: Awaited<ReturnType<typeof roadmapRecords>>[number]): void {
  record.digest = sha256(canonicalJson(resourceManifestSchema.parse(record.definition)));
}

describe('RoadmapService', () => {
  it('projects exactly two current governed resources without capping the registry query', async () => {
    const records = await roadmapRecords();
    const old = structuredClone(records[0]!);
    old.id = '33000000-0000-4000-8000-000000000099';
    old.version = '0.9.0';
    old.definition.metadata.version = '0.9.0';
    const { service, findMany } = serviceFor([...records, old]);

    const program = await runAsHuman(() => service.getProgram());

    expect(program).toMatchObject({
      schemaVersion: 'roadmaps.program/v2',
      title: 'Roadmaps',
      synthetic: true,
      forks: [
        {
          id: 'fork_primary',
          source: 'synthetic',
          resource: { version: '1.0.0', kind: 'Roadmap' },
          relationshipCoverage: {
            vertical: { state: 'unmapped' },
            aimGroup: { state: 'unmapped' },
            contributingAgents: { state: 'unmapped' },
            executionRuns: { state: 'unavailable' },
          },
        },
        { id: 'fork_alternate', source: 'synthetic' },
      ],
    });
    expect(program.title.toLowerCase()).not.toContain('demonstration');
    expect(program.forks.every(({ relationships }) => relationships.length === 0)).toBe(true);
    expect(
      program.forks.every(({ definitionDependencies }) => definitionDependencies.length === 3),
    ).toBe(true);
    expect(findMany).toHaveBeenCalledWith(expect.not.objectContaining({ take: expect.anything() }));
  });

  it('fails closed on an incomplete family population and unresolved exact pins', async () => {
    const records = await roadmapRecords();
    await expect(
      runAsHuman(() => serviceFor([records[0]!]).service.getProgram()),
    ).rejects.toMatchObject({ code: 'ROADMAPS_UNAVAILABLE', status: 503 });

    const partial = structuredClone(records);
    partial[0]!.dependencyPinsFrom.pop();
    await expect(runAsHuman(() => serviceFor(partial).service.getProgram())).rejects.toMatchObject({
      code: 'ROADMAPS_UNAVAILABLE',
      details: { reason: expect.stringContaining('partial') },
    });
  });

  it('fails closed on mixed program identity or duplicate canonical fork IDs', async () => {
    const mixed = structuredClone(await roadmapRecords());
    const mixedSpec = roadmapResourceSpecSchema.parse(mixed[1]!.definition.spec);
    mixed[1]!.definition.spec = {
      ...mixedSpec,
      program: { ...mixedSpec.program, title: 'A different program' },
    };
    refreshDigest(mixed[1]!);
    await expect(runAsHuman(() => serviceFor(mixed).service.getProgram())).rejects.toMatchObject({
      code: 'ROADMAPS_UNAVAILABLE',
      details: { reason: 'Roadmap forks declare mixed program metadata.' },
    });

    const duplicate = structuredClone(await roadmapRecords());
    const duplicateSpec = roadmapResourceSpecSchema.parse(duplicate[1]!.definition.spec);
    duplicate[1]!.definition.spec = {
      ...duplicateSpec,
      fork: { ...duplicateSpec.fork, id: 'fork_primary' },
    };
    refreshDigest(duplicate[1]!);
    await expect(
      runAsHuman(() => serviceFor(duplicate).service.getProgram()),
    ).rejects.toMatchObject({
      code: 'ROADMAPS_UNAVAILABLE',
      details: { reason: 'Roadmap forks declare duplicate canonical fork IDs.' },
    });
  });

  it('fails closed when stored provenance digest does not match the selected definition', async () => {
    const records = await roadmapRecords();
    records[0]!.definition.metadata.purpose = 'Tampered after compilation';

    await expect(runAsHuman(() => serviceFor(records).service.getProgram())).rejects.toMatchObject({
      code: 'ROADMAPS_UNAVAILABLE',
      details: { reason: 'A selected Roadmap definition does not match its immutable digest.' },
    });
  });

  it('serves the typed projection and preserves an integrity failure as HTTP 503', async () => {
    const records = await roadmapRecords();
    const program = await runAsHuman(() => serviceFor(records).service.getProgram());
    const getProgram = jest.fn().mockResolvedValue(program);
    const services = {
      health: { check: jest.fn() },
      platform: {
        roadmaps: { getProgram },
        registry: {},
        reuse: {},
        plugins: {},
        attention: {},
        releaseGovernance: {},
        execution: {},
        automationLearning: {},
        executionDispatcher: { enqueue: jest.fn(), recoverAndResume: jest.fn() },
        dispatchMode: 'external',
      },
    } as unknown as ServiceBundle;
    const app = createApp(services, pino({ level: 'silent' }), {
      auth: { enabled: true, actorId: 'human:roadmap-route-test', bearerToken: 'roadmap-secret' },
    });
    const get = () =>
      request(app).get('/v1/roadmaps').set('authorization', 'Bearer roadmap-secret');

    await get().expect(200, program);
    getProgram.mockRejectedValueOnce(
      new AppError(
        503,
        'ROADMAPS_UNAVAILABLE',
        'Roadmap definitions are unavailable; no progress or nominal state is inferred.',
      ),
    );
    const unavailable = await get().expect(503);
    expect(unavailable.body).toMatchObject({ error: { code: 'ROADMAPS_UNAVAILABLE' } });
  });
});
