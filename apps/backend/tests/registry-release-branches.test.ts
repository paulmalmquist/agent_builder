/* eslint-disable @typescript-eslint/unbound-method */
import type { Request, Response } from 'express';
import {
  ImprovementCandidateState,
  ReleaseEvaluationVerdict,
  ReleasePromotionAction,
  ResourceKind,
  ResourceLifecycle,
  type PrismaClient,
} from '@prisma/client';
import { compileResourceYaml } from '@paul-os/runtime';
import { stringify } from 'yaml';
import { requestContextMiddleware } from '../src/request-context.js';
import { RegistryService } from '../src/services/registry-service.js';
import { ReleaseGovernanceService } from '../src/services/release-governance-service.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from '../src/scope-constants.js';

const FAMILY_ID = '10000000-0000-4000-8000-000000000001';
const DEPENDENCY_ID = '20000000-0000-4000-8000-000000000002';
const VERSION_ID = '30000000-0000-4000-8000-000000000003';
const SECOND_VERSION_ID = '40000000-0000-4000-8000-000000000004';
const RELEASE_ID = '50000000-0000-4000-8000-000000000005';
const SECOND_RELEASE_ID = '60000000-0000-4000-8000-000000000006';
const SUITE_ID = '70000000-0000-4000-8000-000000000007';
const EVALUATION_ID = '80000000-0000-4000-8000-000000000008';
const DECISION_ID = '90000000-0000-4000-8000-000000000009';
const CANDIDATE_ID = 'a0000000-0000-4000-8000-000000000010';
const OTHER_CANDIDATE_ID = 'b0000000-0000-4000-8000-000000000011';
const now = new Date('2026-08-16T12:00:00.000Z');
const VISIBLE_SCOPE = {
  workspaceId: LOCAL_WORKSPACE_ID,
  OR: [{ departmentId: null }, { departmentId: LOCAL_DEPARTMENT_ID }],
};

function manifest(input: {
  familyId?: string;
  version?: string;
  lifecycle?: string;
  slug?: string;
  purpose?: string;
  dependencies?: Array<{ familyId: string; version: string }>;
  kind?: 'Skill' | 'EvaluationSuite';
}) {
  const kind = input.kind ?? 'Skill';
  const slug = input.slug ?? 'branch-skill';
  return {
    apiVersion: 'paul-os/v1',
    kind,
    metadata: {
      id: input.familyId ?? FAMILY_ID,
      slug,
      version: input.version ?? '1.0.0',
      owner: 'branch-test',
      purpose:
        input.purpose ?? 'Exercise governed resource and release branches with synthetic data.',
      lifecycle: input.lifecycle ?? 'candidate',
      provenance: 'synthetic',
    },
    dependencies: input.dependencies ?? [],
    spec:
      kind === 'Skill'
        ? {
            inputSchema: { type: 'object', properties: { calendarItems: { type: 'array' } } },
            outputSchema: {
              type: 'object',
              required: ['scheduleRisks', 'citations'],
              properties: {
                scheduleRisks: { type: 'array' },
                citations: { type: 'array' },
              },
            },
            tools: [],
            permissions: [],
            contextRequirements: [],
            successCriteria: ['Return a schema-valid result.'],
          }
        : {
            subject: 'branch-skill@1.0.0',
            executorKind: 'deterministic_contract',
            evaluationMode: 'contract_validation',
            corpusVersion: 1,
            cases: [
              {
                key: 'contract-shape',
                fixture: 'synthetic',
                assertions: ['output_schema_valid', 'no_attempted_actions'],
              },
            ],
            gates: { schemaConformance: 1, citationCoverage: 1, unauthorizedActions: 0 },
          },
  };
}

function yaml(input: Parameters<typeof manifest>[0] = {}): string {
  return stringify(manifest(input));
}

function databaseVersion(input: {
  id?: string;
  familyId?: string;
  version?: string;
  lifecycle?: ResourceLifecycle;
  kind?: ResourceKind;
  slug?: string;
  digest?: string;
  dependencies?: Array<{ familyId: string; version: string }>;
  sourceCommit?: string;
  definition?: object;
}) {
  const familyId = input.familyId ?? FAMILY_ID;
  const kind = input.kind ?? ResourceKind.SKILL;
  const slug = input.slug ?? 'branch-skill';
  const definition =
    input.definition ??
    manifest({
      familyId,
      slug,
      kind: kind === ResourceKind.EVALUATION_SUITE ? 'EvaluationSuite' : 'Skill',
      ...(input.version === undefined ? {} : { version: input.version }),
      ...(input.dependencies === undefined ? {} : { dependencies: input.dependencies }),
    });
  return {
    id: input.id ?? VERSION_ID,
    familyId,
    legacyAgentId: null,
    version: input.version ?? '1.0.0',
    lifecycle: input.lifecycle ?? ResourceLifecycle.CANDIDATE,
    owner: 'branch-test',
    purpose: 'Exercise governed resource and release branches with synthetic data.',
    definition,
    digest: input.digest ?? 'a'.repeat(64),
    sourceCommit: input.sourceCommit ?? 'a'.repeat(40),
    provenance: 'synthetic',
    dependencyPins: input.dependencies ?? [],
    revision: 1,
    frozenAt: now,
    createdBy: 'branch-test',
    updatedBy: 'branch-test',
    createdAt: now,
    updatedAt: now,
    family: {
      id: familyId,
      workspaceId: LOCAL_WORKSPACE_ID,
      departmentId: LOCAL_DEPARTMENT_ID,
      kind,
      slug,
      name: slug,
      createdBy: 'branch-test',
      updatedBy: 'branch-test',
      createdAt: now,
      updatedAt: now,
    },
  };
}

function prismaTransaction<T extends object>(transaction: T): PrismaClient {
  for (const delegate of Object.values(transaction) as Array<Record<string, unknown>>) {
    if (typeof delegate['findUnique'] === 'function' && delegate['findFirst'] === undefined) {
      delegate['findFirst'] = delegate['findUnique'];
    }
  }
  return {
    $transaction: jest.fn((operation: (client: T) => unknown) =>
      Promise.resolve(operation(transaction)),
    ),
  } as unknown as PrismaClient;
}

function runAsHuman<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const middleware = requestContextMiddleware({ enabled: false, actorId: 'human:branch-test' });
    const request = {
      path: '/v1/production-channels/default/promote',
      header: () => undefined,
      id: 'branch-request',
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

describe('RegistryService release and import guard branches', () => {
  it('rejects caller-asserted governed lifecycle before touching storage', async () => {
    const service = new RegistryService({} as PrismaClient, 'a'.repeat(40));

    await expect(
      service.importResource({ manifestYaml: yaml({ lifecycle: 'certified' }), sourcePath: null }),
    ).rejects.toMatchObject({ code: 'RESOURCE_LIFECYCLE_NOT_IMPORTABLE' });
  });

  it('requires linked improvement candidates to exist, be incubating, and target the exact resource', async () => {
    const importWithCandidate = (candidate: unknown) =>
      new RegistryService(
        prismaTransaction({
          improvementCandidate: { findUnique: jest.fn().mockResolvedValue(candidate) },
        }),
        'a'.repeat(40),
      ).importResource({
        manifestYaml: yaml(),
        sourcePath: null,
        improvementCandidateId: CANDIDATE_ID,
      });

    await expect(importWithCandidate(null)).rejects.toMatchObject({
      code: 'IMPROVEMENT_NOT_FOUND',
    });
    await expect(
      importWithCandidate({
        state: ImprovementCandidateState.PROPOSED,
        proposedTarget: 'Skill:branch-skill@1.0.0',
      }),
    ).rejects.toMatchObject({ code: 'IMPROVEMENT_NOT_INCUBATING' });
    await expect(
      importWithCandidate({
        state: ImprovementCandidateState.INCUBATING,
        proposedTarget: 'EvaluationSuite:branch-skill@1.0.0',
      }),
    ).rejects.toMatchObject({
      code: 'IMPROVEMENT_TARGET_MISMATCH',
      details: { expectedTarget: 'Skill:branch-skill@1.0.0' },
    });
  });

  it('rejects family identity conflicts and missing exact dependency pins', async () => {
    const identityTransaction = {
      resourceFamily: {
        findUnique: jest.fn().mockResolvedValue({
          id: FAMILY_ID,
          workspaceId: LOCAL_WORKSPACE_ID,
          departmentId: LOCAL_DEPARTMENT_ID,
          kind: ResourceKind.REFERENCE,
          slug: 'other-slug',
        }),
      },
    };
    await expect(
      new RegistryService(prismaTransaction(identityTransaction), 'a'.repeat(40)).importResource({
        manifestYaml: yaml(),
        sourcePath: null,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_IDENTITY_CONFLICT' });

    const dependencyTransaction = {
      resourceFamily: {
        findUnique: jest.fn().mockResolvedValue({
          id: FAMILY_ID,
          workspaceId: LOCAL_WORKSPACE_ID,
          departmentId: LOCAL_DEPARTMENT_ID,
          kind: ResourceKind.SKILL,
          slug: 'branch-skill',
        }),
      },
      resourceVersion: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    await expect(
      new RegistryService(prismaTransaction(dependencyTransaction), 'a'.repeat(40)).importResource({
        manifestYaml: yaml({ dependencies: [{ familyId: DEPENDENCY_ID, version: '1.0.0' }] }),
        sourcePath: null,
      }),
    ).rejects.toMatchObject({
      code: 'RESOURCE_DEPENDENCY_MISSING',
      details: { familyId: DEPENDENCY_ID, version: '1.0.0' },
    });
  });

  it('detects a transitive exact-pin cycle before version mutation', async () => {
    const resolvedDependency = databaseVersion({
      id: SECOND_VERSION_ID,
      familyId: DEPENDENCY_ID,
      slug: 'dependency-skill',
    });
    const transaction = {
      resourceFamily: {
        findUnique: jest.fn().mockResolvedValue({
          id: FAMILY_ID,
          workspaceId: LOCAL_WORKSPACE_ID,
          departmentId: LOCAL_DEPARTMENT_ID,
          kind: ResourceKind.SKILL,
          slug: 'branch-skill',
        }),
      },
      resourceVersion: {
        findFirst: jest.fn().mockResolvedValue(resolvedDependency),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            familyId: DEPENDENCY_ID,
            version: '1.0.0',
            dependencyPins: [{ familyId: FAMILY_ID, version: '1.0.0' }],
          },
        ]),
      },
      resourceDependencyPin: { findMany: jest.fn().mockResolvedValue([]) },
    };

    await expect(
      new RegistryService(prismaTransaction(transaction), 'a'.repeat(40)).importResource({
        manifestYaml: yaml({ dependencies: [{ familyId: DEPENDENCY_ID, version: '1.0.0' }] }),
        sourcePath: null,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_DEPENDENCY_CYCLE' });
  });

  it('returns idempotent imports and updates only mutable experimental definitions', async () => {
    const compiled = compileResourceYaml(yaml());
    const existing = databaseVersion({ digest: compiled.digest });
    const importRecord = {
      id: 'a0000000-0000-4000-8000-000000000001',
      resourceVersionId: existing.id,
      digest: existing.digest,
      sourceCommit: 'a'.repeat(40),
      sourcePath: null,
      manifestSnapshot: existing.definition,
      importedBy: 'system:background',
      importedAt: now,
    };
    const idempotentTransaction = {
      resourceFamily: { findUnique: jest.fn().mockResolvedValue(existing.family) },
      resourceVersion: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(existing),
      },
      repositoryImport: { findUnique: jest.fn().mockResolvedValue(importRecord) },
      auditEvent: { create: jest.fn() },
    };
    const idempotent = await new RegistryService(
      prismaTransaction(idempotentTransaction),
      'a'.repeat(40),
    ).importResource({ manifestYaml: yaml(), sourcePath: null });
    expect(idempotent.idempotent).toBe(true);
    expect(idempotentTransaction.auditEvent.create).not.toHaveBeenCalled();

    const changedYaml = yaml({
      purpose: 'Exercise a changed but still mutable synthetic resource.',
    });
    const changed = compileResourceYaml(changedYaml);
    const experimental = databaseVersion({
      lifecycle: ResourceLifecycle.EXPERIMENTAL,
      digest: 'b'.repeat(64),
    });
    const updated = databaseVersion({ digest: changed.digest });
    const mutableTransaction = {
      resourceFamily: { findUnique: jest.fn().mockResolvedValue(experimental.family) },
      resourceVersion: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(experimental),
        update: jest.fn().mockResolvedValue(updated),
      },
      resourceDependencyPin: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      repositoryImport: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ ...importRecord, digest: changed.digest }),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };
    const mutated = await new RegistryService(
      prismaTransaction(mutableTransaction),
      'a'.repeat(40),
    ).importResource({ manifestYaml: changedYaml, sourcePath: null });
    expect(mutated.idempotent).toBe(false);
    expect(mutableTransaction.resourceVersion.update).toHaveBeenCalled();
    expect(mutableTransaction.repositoryImport.create).toHaveBeenCalled();
  });

  it('creates a new family, candidate version, import evidence, and audit record', async () => {
    const compiled = compileResourceYaml(yaml());
    const createdVersion = databaseVersion({ digest: compiled.digest });
    const importRecord = {
      id: 'a0000000-0000-4000-8000-000000000002',
      resourceVersionId: createdVersion.id,
      digest: compiled.digest,
      sourceCommit: 'a'.repeat(40),
      sourcePath: '02-skills/branch-skill/manifest.yaml',
      improvementCandidateId: CANDIDATE_ID,
      manifestSnapshot: createdVersion.definition,
      importedBy: 'system:background',
      importedAt: now,
    };
    const transaction = {
      improvementCandidate: {
        findUnique: jest.fn().mockResolvedValue({
          state: ImprovementCandidateState.INCUBATING,
          proposedTarget: 'Skill:branch-skill@1.0.0',
        }),
      },
      resourceFamily: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdVersion.family),
      },
      resourceVersion: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdVersion),
      },
      resourceDependencyPin: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      repositoryImport: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(importRecord),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };

    const result = await new RegistryService(
      prismaTransaction(transaction),
      'a'.repeat(40),
    ).importResource({
      manifestYaml: yaml(),
      sourcePath: '02-skills/branch-skill/manifest.yaml',
      improvementCandidateId: CANDIDATE_ID,
    });

    expect(result.idempotent).toBe(false);
    expect(result.import.improvementCandidateId).toBe(CANDIDATE_ID);
    expect(transaction.resourceFamily.create).toHaveBeenCalled();
    expect(transaction.resourceVersion.create).toHaveBeenCalled();
    expect(transaction.repositoryImport.create).toHaveBeenCalled();
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(2);
    expect(transaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'repository_import.lineage_attached' }),
      }),
    );
  });

  it('attaches lineage once to an existing import and rejects rebinding it', async () => {
    const compiled = compileResourceYaml(yaml());
    const existing = databaseVersion({ digest: compiled.digest });
    const baseImport = {
      id: 'a0000000-0000-4000-8000-000000000012',
      resourceVersionId: existing.id,
      improvementCandidateId: null,
      digest: existing.digest,
      sourceCommit: 'a'.repeat(40),
      sourcePath: null,
      manifestSnapshot: existing.definition,
      importedBy: 'system:background',
      importedAt: now,
    };
    const linkedImport = { ...baseImport, improvementCandidateId: CANDIDATE_ID };
    const transaction = {
      improvementCandidate: {
        findUnique: jest.fn().mockResolvedValue({
          state: ImprovementCandidateState.INCUBATING,
          proposedTarget: 'Skill:branch-skill@1.0.0',
        }),
      },
      resourceFamily: { findUnique: jest.fn().mockResolvedValue(existing.family) },
      resourceVersion: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(existing),
      },
      repositoryImport: {
        findUnique: jest.fn().mockResolvedValue(baseImport),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(linkedImport),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };
    const result = await new RegistryService(
      prismaTransaction(transaction),
      'a'.repeat(40),
    ).importResource({
      manifestYaml: yaml(),
      sourcePath: null,
      improvementCandidateId: CANDIDATE_ID,
    });
    expect(result).toMatchObject({
      idempotent: true,
      import: { improvementCandidateId: CANDIDATE_ID },
    });
    expect(transaction.repositoryImport.updateMany).toHaveBeenCalledWith({
      where: { id: baseImport.id, improvementCandidateId: null },
      data: { improvementCandidateId: CANDIDATE_ID },
    });
    expect(transaction.auditEvent.create).toHaveBeenCalledTimes(1);

    const immutable = {
      ...transaction,
      repositoryImport: {
        findUnique: jest.fn().mockResolvedValue({
          ...baseImport,
          improvementCandidateId: OTHER_CANDIDATE_ID,
        }),
      },
    };
    await expect(
      new RegistryService(prismaTransaction(immutable), 'a'.repeat(40)).importResource({
        manifestYaml: yaml(),
        sourcePath: null,
        improvementCandidateId: CANDIDATE_ID,
      }),
    ).rejects.toMatchObject({ code: 'REPOSITORY_IMPORT_LINEAGE_IMMUTABLE' });
  });

  it('rejects changed frozen versions', async () => {
    const frozen = databaseVersion({
      lifecycle: ResourceLifecycle.CANDIDATE,
      digest: 'c'.repeat(64),
    });
    const transaction = {
      resourceFamily: { findUnique: jest.fn().mockResolvedValue(frozen.family) },
      resourceVersion: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(frozen),
      },
    };
    await expect(
      new RegistryService(prismaTransaction(transaction), 'a'.repeat(40)).importResource({
        manifestYaml: yaml({
          purpose: 'Attempt a forbidden change to a frozen synthetic resource.',
        }),
        sourcePath: null,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_VERSION_IMMUTABLE' });
  });

  it('guards duplicate IDs, missing versions, duplicate families, lifecycle, and dependency closure', async () => {
    const service = new RegistryService({} as PrismaClient, 'a'.repeat(40));
    await expect(
      service.createRelease({ resourceVersionIds: [VERSION_ID, VERSION_ID], projectId: null }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const missingPrisma = {
      resourceVersion: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    await expect(
      new RegistryService(missingPrisma, 'a'.repeat(40)).createRelease({
        resourceVersionIds: [VERSION_ID],
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_VERSION_NOT_FOUND' });

    const duplicateFamilyPrisma = {
      resourceVersion: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            databaseVersion({ id: VERSION_ID, version: '1.0.0' }),
            databaseVersion({ id: SECOND_VERSION_ID, version: '1.1.0' }),
          ]),
      },
    } as unknown as PrismaClient;
    await expect(
      new RegistryService(duplicateFamilyPrisma, 'a'.repeat(40)).createRelease({
        resourceVersionIds: [VERSION_ID, SECOND_VERSION_ID],
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: 'RELEASE_FAMILY_VERSION_CONFLICT' });

    const draftPrisma = {
      resourceVersion: {
        findMany: jest
          .fn()
          .mockResolvedValue([databaseVersion({ lifecycle: ResourceLifecycle.EXPERIMENTAL })]),
      },
    } as unknown as PrismaClient;
    await expect(
      new RegistryService(draftPrisma, 'a'.repeat(40)).createRelease({
        resourceVersionIds: [VERSION_ID],
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_RELEASABLE' });

    const missingDependencyPrisma = {
      resourceVersion: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            databaseVersion({ dependencies: [{ familyId: DEPENDENCY_ID, version: '1.0.0' }] }),
          ]),
      },
    } as unknown as PrismaClient;
    await expect(
      new RegistryService(missingDependencyPrisma, 'a'.repeat(40)).createRelease({
        resourceVersionIds: [VERSION_ID],
        projectId: null,
      }),
    ).rejects.toMatchObject({ code: 'RELEASE_DEPENDENCY_MISSING' });
  });

  it('returns existing releases, creates new ones, maps filtered resources, and reports misses', async () => {
    const first = databaseVersion({
      id: VERSION_ID,
      familyId: FAMILY_ID,
      digest: 'a'.repeat(64),
    });
    const second = databaseVersion({
      id: SECOND_VERSION_ID,
      familyId: DEPENDENCY_ID,
      kind: ResourceKind.REFERENCE,
      slug: 'branch-reference',
      digest: 'b'.repeat(64),
    });
    const releaseRecord = {
      id: RELEASE_ID,
      digest: 'c'.repeat(64),
      projectId: null,
      createdBy: 'system:background',
      createdAt: now,
      resources: [
        {
          releaseId: RELEASE_ID,
          resourceVersionId: second.id,
          kind: second.family.kind,
          digest: second.digest,
          ordinal: 1,
        },
        {
          releaseId: RELEASE_ID,
          resourceVersionId: first.id,
          kind: first.family.kind,
          digest: first.digest,
          ordinal: 0,
        },
      ],
    };
    const existingTransaction = {
      releaseBundle: { findFirst: jest.fn().mockResolvedValue(releaseRecord), create: jest.fn() },
    };
    const existingPrisma = {
      resourceVersion: { findMany: jest.fn().mockResolvedValue([second, first]) },
      $transaction: jest.fn((operation: (client: typeof existingTransaction) => unknown) =>
        Promise.resolve(operation(existingTransaction)),
      ),
    } as unknown as PrismaClient;
    const existing = await new RegistryService(existingPrisma, 'a'.repeat(40)).createRelease({
      resourceVersionIds: [second.id, first.id],
      projectId: null,
    });
    expect(existing.id).toBe(RELEASE_ID);
    expect(existing.resources.map(({ ordinal }) => ordinal)).toEqual([0, 1]);
    expect(existingTransaction.releaseBundle.create).not.toHaveBeenCalled();

    const createdRecord = { ...releaseRecord, id: SECOND_RELEASE_ID };
    const createTransaction = {
      releaseBundle: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdRecord),
      },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };
    const createPrisma = {
      resourceVersion: { findMany: jest.fn().mockResolvedValue([first, second]) },
      $transaction: jest.fn((operation: (client: typeof createTransaction) => unknown) =>
        Promise.resolve(operation(createTransaction)),
      ),
    } as unknown as PrismaClient;
    const created = await new RegistryService(createPrisma, 'a'.repeat(40)).createRelease({
      resourceVersionIds: [first.id, second.id],
      projectId: null,
    });
    expect(created.id).toBe(SECOND_RELEASE_ID);
    expect(createTransaction.auditEvent.create).toHaveBeenCalled();

    const listAndGetPrisma = {
      resourceVersion: {
        findMany: jest.fn().mockResolvedValue([first]),
        groupBy: jest.fn().mockResolvedValue([
          { lifecycle: ResourceLifecycle.CANDIDATE, _count: { _all: 11 } },
          { lifecycle: ResourceLifecycle.PRODUCTION, _count: { _all: 4 } },
        ]),
      },
      releaseBundle: {
        findFirst: jest.fn().mockResolvedValueOnce(releaseRecord).mockResolvedValueOnce(null),
      },
    } as unknown as PrismaClient;
    const queryService = new RegistryService(listAndGetPrisma, 'a'.repeat(40));
    const listed = await queryService.listResources({
      kind: 'Skill',
      lifecycle: 'candidate',
      query: 'branch',
      limit: 5,
    });
    expect(listed.items).toHaveLength(1);
    expect(listed).toMatchObject({
      total: 15,
      countsByLifecycle: { candidate: 11, production: 4, experimental: 0 },
    });
    expect(listAndGetPrisma.resourceVersion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ OR: expect.any(Array) }) }),
    );
    expect(listAndGetPrisma.resourceVersion.groupBy).toHaveBeenCalledWith({
      by: ['lifecycle'],
      where: { family: VISIBLE_SCOPE },
      _count: { _all: true },
    });
    expect((await queryService.getRelease(RELEASE_ID)).id).toBe(RELEASE_ID);
    await expect(queryService.getRelease(SECOND_RELEASE_ID)).rejects.toMatchObject({
      code: 'RELEASE_NOT_FOUND',
    });
  });

  it.each([ResourceLifecycle.EVALUATED, ResourceLifecycle.CERTIFIED])(
    'accepts %s resources into immutable evaluation releases',
    async (lifecycle) => {
      const version = databaseVersion({ lifecycle });
      const releaseRecord = {
        id: RELEASE_ID,
        digest: 'c'.repeat(64),
        projectId: null,
        createdBy: 'system:background',
        createdAt: now,
        resources: [
          {
            releaseId: RELEASE_ID,
            resourceVersionId: version.id,
            kind: version.family.kind,
            digest: version.digest,
            ordinal: 0,
          },
        ],
      };
      const transaction = {
        releaseBundle: { findFirst: jest.fn().mockResolvedValue(releaseRecord) },
      };
      const prisma = {
        resourceVersion: { findMany: jest.fn().mockResolvedValue([version]) },
        $transaction: jest.fn((operation: (client: typeof transaction) => unknown) =>
          Promise.resolve(operation(transaction)),
        ),
      } as unknown as PrismaClient;

      await expect(
        new RegistryService(prisma, 'a'.repeat(40)).createRelease({
          resourceVersionIds: [VERSION_ID],
          projectId: null,
        }),
      ).resolves.toMatchObject({ id: RELEASE_ID });
    },
  );
});

function suiteVersion(kind: ResourceKind = ResourceKind.EVALUATION_SUITE) {
  return databaseVersion({
    id: SUITE_ID,
    familyId: SUITE_ID,
    kind,
    slug: 'branch-suite',
    digest: 'b'.repeat(64),
    definition: manifest({
      familyId: SUITE_ID,
      slug: 'branch-suite',
      kind: 'EvaluationSuite',
      dependencies: [{ familyId: FAMILY_ID, version: '1.0.0' }],
    }),
  });
}

function releaseForEvaluation(
  options: {
    includeSuite?: boolean;
    suiteKind?: ResourceKind;
    projectId?: string | null;
    lifecycle?: ResourceLifecycle;
    sourceCommit?: string;
  } = {},
) {
  const skill = databaseVersion({
    ...(options.lifecycle === undefined ? {} : { lifecycle: options.lifecycle }),
    ...(options.sourceCommit === undefined ? {} : { sourceCommit: options.sourceCommit }),
  });
  const suite = {
    ...suiteVersion(options.suiteKind),
    lifecycle: options.lifecycle ?? ResourceLifecycle.CANDIDATE,
  };
  return {
    id: RELEASE_ID,
    digest: 'c'.repeat(64),
    projectId: options.projectId ?? null,
    createdBy: 'branch-test',
    createdAt: now,
    resources: [
      {
        releaseId: RELEASE_ID,
        resourceVersionId: skill.id,
        kind: ResourceKind.SKILL,
        digest: skill.digest,
        ordinal: 0,
        resourceVersion: skill,
      },
      ...(options.includeSuite === false
        ? []
        : [
            {
              releaseId: RELEASE_ID,
              resourceVersionId: suite.id,
              kind: ResourceKind.EVALUATION_SUITE,
              digest: suite.digest,
              ordinal: 1,
              resourceVersion: suite,
            },
          ]),
    ],
  };
}

function evaluationRecord(overrides: Record<string, unknown> = {}) {
  const gateResults = [
    {
      key: 'schema_conformance',
      category: 'contract',
      operator: 'gte',
      threshold: 1,
      measuredValue: 1,
      status: 'passed',
      sampleSize: 1,
      evidenceSource: 'manifest_declaration',
      detail: 'Measured from deterministic assertions.',
    },
    {
      key: 'citation_coverage',
      category: 'contract',
      operator: 'gte',
      threshold: 1,
      measuredValue: 1,
      status: 'passed',
      sampleSize: 1,
      evidenceSource: 'manifest_declaration',
      detail: 'Measured from deterministic assertions.',
    },
    {
      key: 'unauthorized_actions',
      category: 'contract',
      operator: 'lte',
      threshold: 0,
      measuredValue: 0,
      status: 'passed',
      sampleSize: 1,
      evidenceSource: 'manifest_declaration',
      detail: 'Measured from deterministic assertions.',
    },
  ];
  return {
    id: EVALUATION_ID,
    releaseId: RELEASE_ID,
    releaseDigest: 'c'.repeat(64),
    suiteVersionId: SUITE_ID,
    suiteDigest: 'b'.repeat(64),
    executorKind: 'deterministic_contract',
    executorVersion: '1.0.0',
    evaluationMode: 'contract_validation',
    historySnapshotDigest: '0'.repeat(64),
    corpusVersion: 1,
    verdict: ReleaseEvaluationVerdict.PASSED,
    results: [],
    gateScores: { schemaConformance: 1, citationCoverage: 1, unauthorizedActions: 0 },
    evidence: {
      schemaVersion: 1,
      historySnapshotDigest: '0'.repeat(64),
      historyRunIds: [],
      suiteCaseCount: 1,
      assertionCount: 3,
      subjectPresent: true,
      subjectDigest: 'a'.repeat(64),
      gateResults,
    },
    requestedBy: 'branch-test',
    createdAt: now,
    finishedAt: now,
    declineDecisions: [],
    ...overrides,
  };
}

function channel(currentReleaseId: string | null = RELEASE_ID) {
  return {
    key: 'default',
    projectId: null,
    currentReleaseId,
    priorReleaseId: null,
    promotedBy: 'human:branch-test',
    promotedAt: now,
    updatedAt: now,
    currentRelease:
      currentReleaseId === null ? null : { id: currentReleaseId, digest: 'c'.repeat(64) },
  };
}

describe('ReleaseGovernanceService evaluation, promotion, and rollback guards', () => {
  it('rejects missing releases, absent suites, and non-suite resources', async () => {
    const missingTransaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      releaseBundle: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    await expect(
      new ReleaseGovernanceService(prismaTransaction(missingTransaction)).evaluate({
        releaseId: RELEASE_ID,
        suiteVersionId: SUITE_ID,
      }),
    ).rejects.toMatchObject({ code: 'RELEASE_NOT_FOUND' });

    const absentTransaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      releaseBundle: {
        findUnique: jest.fn().mockResolvedValue(releaseForEvaluation({ includeSuite: false })),
      },
    };
    await expect(
      new ReleaseGovernanceService(prismaTransaction(absentTransaction)).evaluate({
        releaseId: RELEASE_ID,
        suiteVersionId: SUITE_ID,
      }),
    ).rejects.toMatchObject({ code: 'EVALUATION_SUITE_NOT_IN_RELEASE' });

    const wrongKindTransaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      releaseBundle: {
        findUnique: jest
          .fn()
          .mockResolvedValue(releaseForEvaluation({ suiteKind: ResourceKind.SKILL })),
      },
    };
    await expect(
      new ReleaseGovernanceService(prismaTransaction(wrongKindTransaction)).evaluate({
        releaseId: RELEASE_ID,
        suiteVersionId: SUITE_ID,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EVALUATION_SUITE' });
  });

  it('returns immutable existing evidence and maps every verdict branch', async () => {
    const existingTransaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      releaseBundle: { findUnique: jest.fn().mockResolvedValue(releaseForEvaluation()) },
      releaseEvaluation: {
        findUnique: jest
          .fn()
          .mockResolvedValue(evaluationRecord({ verdict: ReleaseEvaluationVerdict.ERROR })),
      },
    };
    const service = new ReleaseGovernanceService(prismaTransaction(existingTransaction));
    expect(
      (await service.evaluate({ releaseId: RELEASE_ID, suiteVersionId: SUITE_ID })).verdict,
    ).toBe('error');

    const directPrisma = {
      releaseEvaluation: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(evaluationRecord({ verdict: ReleaseEvaluationVerdict.FAILED }))
          .mockResolvedValueOnce(null),
      },
    } as unknown as PrismaClient;
    const direct = new ReleaseGovernanceService(directPrisma);
    expect((await direct.getEvaluation(EVALUATION_ID)).verdict).toBe('failed');
    await expect(direct.getEvaluation(EVALUATION_ID)).rejects.toMatchObject({
      code: 'RELEASE_EVALUATION_NOT_FOUND',
    });
  });

  it('records failed evaluation evidence without certifying resources', async () => {
    const release = releaseForEvaluation();
    const suite = release.resources.find(({ resourceVersionId }) => resourceVersionId === SUITE_ID);
    if (suite === undefined) throw new Error('Suite fixture missing');
    suite.resourceVersion.definition = {
      ...suite.resourceVersion.definition,
      spec: {
        ...(suite.resourceVersion.definition as { spec: object }).spec,
        subject: 'missing@1.0.0',
      },
    };
    const failed = evaluationRecord({ verdict: ReleaseEvaluationVerdict.FAILED });
    const transaction = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      releaseBundle: { findUnique: jest.fn().mockResolvedValue(release) },
      releaseEvaluation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(failed),
      },
      resourceVersion: { updateMany: jest.fn() },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
      platformEvent: { create: jest.fn().mockResolvedValue({ id: 'platform-event-id' }) },
    };
    const result = await new ReleaseGovernanceService(prismaTransaction(transaction)).evaluate({
      releaseId: RELEASE_ID,
      suiteVersionId: SUITE_ID,
    });
    expect(result.verdict).toBe('failed');
    expect(transaction.resourceVersion.updateMany).not.toHaveBeenCalled();
  });

  it('maps channel absence and nullable production metadata', async () => {
    const neverPromoted = { ...channel(null), promotedBy: null, promotedAt: null };
    const prisma = {
      productionChannel: {
        findFirst: jest.fn().mockResolvedValueOnce(neverPromoted).mockResolvedValueOnce(null),
      },
    } as unknown as PrismaClient;
    const service = new ReleaseGovernanceService(prisma);
    const empty = await service.getChannel('default');
    expect(empty.currentReleaseDigest).toBeNull();
    expect(empty.promotedAt).toBeNull();
    await expect(service.getChannel('missing')).rejects.toMatchObject({
      code: 'PRODUCTION_CHANNEL_NOT_FOUND',
    });
  });

  it.each([
    {
      name: 'missing release',
      release: null,
      evidence: null,
      code: 'RELEASE_NOT_FOUND',
      key: 'default',
    },
    {
      name: 'project channel mismatch',
      release: releaseForEvaluation({ projectId: 'project-a' }),
      evidence: null,
      code: 'PRODUCTION_CHANNEL_MISMATCH',
      key: 'default',
    },
    {
      name: 'missing evidence',
      release: releaseForEvaluation({ lifecycle: ResourceLifecycle.CERTIFIED }),
      evidence: null,
      code: 'PASSING_RELEASE_EVIDENCE_REQUIRED',
      key: 'default',
    },
    {
      name: 'failed evidence',
      release: releaseForEvaluation({ lifecycle: ResourceLifecycle.CERTIFIED }),
      evidence: evaluationRecord({ verdict: ReleaseEvaluationVerdict.FAILED }),
      code: 'PASSING_RELEASE_EVIDENCE_REQUIRED',
      key: 'default',
    },
    {
      name: 'evidence for another release',
      release: releaseForEvaluation({ lifecycle: ResourceLifecycle.CERTIFIED }),
      evidence: evaluationRecord({ releaseId: SECOND_RELEASE_ID }),
      code: 'PASSING_RELEASE_EVIDENCE_REQUIRED',
      key: 'default',
    },
    {
      name: 'evidence for another digest',
      release: releaseForEvaluation({ lifecycle: ResourceLifecycle.CERTIFIED }),
      evidence: evaluationRecord({ releaseDigest: 'd'.repeat(64) }),
      code: 'PASSING_RELEASE_EVIDENCE_REQUIRED',
      key: 'default',
    },
    {
      name: 'uncertified resource',
      release: releaseForEvaluation(),
      evidence: evaluationRecord(),
      code: 'RELEASE_RESOURCES_NOT_CERTIFIED',
      key: 'default',
    },
    {
      name: 'unverified provenance',
      release: releaseForEvaluation({
        lifecycle: ResourceLifecycle.CERTIFIED,
        sourceCommit: 'local-unverified',
      }),
      evidence: evaluationRecord(),
      code: 'UNVERIFIED_RELEASE_PROVENANCE',
      key: 'default',
    },
  ])('rejects promotion for $name', async ({ release, evidence, code, key }) => {
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      releaseBundle: { findUnique: jest.fn().mockResolvedValue(release) },
      releaseEvaluation: { findUnique: jest.fn().mockResolvedValue(evidence) },
    };
    const service = new ReleaseGovernanceService(prismaTransaction(transaction));
    await expect(
      runAsHuman(() =>
        service.promote(key, {
          releaseId: RELEASE_ID,
          evaluationId: EVALUATION_ID,
          rationale: 'Exercise a meaningful production promotion guard branch.',
        }),
      ),
    ).rejects.toMatchObject({ code });
  });

  it('rejects promoting the already-active release on an existing channel', async () => {
    const release = releaseForEvaluation({ lifecycle: ResourceLifecycle.CERTIFIED });
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      releaseBundle: { findUnique: jest.fn().mockResolvedValue(release) },
      releaseEvaluation: { findUnique: jest.fn().mockResolvedValue(evaluationRecord()) },
      productionChannel: { findUnique: jest.fn().mockResolvedValue(channel(RELEASE_ID)) },
    };
    await expect(
      runAsHuman(() =>
        new ReleaseGovernanceService(prismaTransaction(transaction)).promote('default', {
          releaseId: RELEASE_ID,
          evaluationId: EVALUATION_ID,
          rationale: 'Prevent a redundant decision for an already active release.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'RELEASE_ALREADY_ACTIVE' });
  });

  it('guards rollback state and atomically records a valid rollback', async () => {
    const noChannelTransaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      productionChannel: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    await expect(
      runAsHuman(() =>
        new ReleaseGovernanceService(prismaTransaction(noChannelTransaction)).rollback('default', {
          targetReleaseId: SECOND_RELEASE_ID,
          rationale: 'Reject rollback when no production release is active.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'NO_PRODUCTION_RELEASE' });

    const emptyChannelTransaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      productionChannel: { findUnique: jest.fn().mockResolvedValue(channel(null)) },
    };
    await expect(
      runAsHuman(() =>
        new ReleaseGovernanceService(prismaTransaction(emptyChannelTransaction)).rollback(
          'default',
          {
            targetReleaseId: SECOND_RELEASE_ID,
            rationale: 'Reject rollback when the channel exists without an active release.',
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'NO_PRODUCTION_RELEASE' });

    const sameTransaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      productionChannel: { findUnique: jest.fn().mockResolvedValue(channel(SECOND_RELEASE_ID)) },
    };
    await expect(
      runAsHuman(() =>
        new ReleaseGovernanceService(prismaTransaction(sameTransaction)).rollback('default', {
          targetReleaseId: SECOND_RELEASE_ID,
          rationale: 'Reject rollback when the requested release is already active.',
        }),
      ),
    ).rejects.toMatchObject({ code: 'RELEASE_ALREADY_ACTIVE' });

    const uncertifiedTransaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      productionChannel: { findUnique: jest.fn().mockResolvedValue(channel(RELEASE_ID)) },
      releasePromotionDecision: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    await expect(
      runAsHuman(() =>
        new ReleaseGovernanceService(prismaTransaction(uncertifiedTransaction)).rollback(
          'default',
          {
            targetReleaseId: SECOND_RELEASE_ID,
            rationale: 'Reject rollback without prior passing promotion evidence.',
          },
        ),
      ),
    ).rejects.toMatchObject({ code: 'ROLLBACK_TARGET_NOT_CERTIFIED' });

    const active = channel(RELEASE_ID);
    const earlier = {
      id: 'a0000000-0000-4000-8000-000000000001',
      channelKey: 'default',
      action: ReleasePromotionAction.PROMOTED,
      releaseId: SECOND_RELEASE_ID,
      previousReleaseId: null,
      evaluationId: EVALUATION_ID,
      rationale: 'Original promotion decision.',
      decidedBy: 'human:branch-test',
      decidedAt: now,
    };
    const rollbackDecision = {
      ...earlier,
      id: DECISION_ID,
      action: ReleasePromotionAction.ROLLED_BACK,
      previousReleaseId: RELEASE_ID,
      rationale: 'Restore the prior certified release after a synthetic regression.',
    };
    const updatedChannel = {
      ...active,
      currentReleaseId: SECOND_RELEASE_ID,
      priorReleaseId: RELEASE_ID,
      currentRelease: { id: SECOND_RELEASE_ID, digest: 'd'.repeat(64) },
    };
    const successTransaction = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([]),
      productionChannel: {
        findUnique: jest.fn().mockResolvedValue(active),
        update: jest.fn().mockResolvedValue(updatedChannel),
      },
      releasePromotionDecision: {
        findFirst: jest.fn().mockResolvedValue(earlier),
        create: jest.fn().mockResolvedValue(rollbackDecision),
      },
      catalogPublication: { findMany: jest.fn().mockResolvedValue([]) },
      auditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
      platformEvent: { create: jest.fn().mockResolvedValue({ id: 'platform-event-id' }) },
    };
    const rolledBack = await runAsHuman(() =>
      new ReleaseGovernanceService(prismaTransaction(successTransaction)).rollback('default', {
        targetReleaseId: SECOND_RELEASE_ID,
        rationale: rollbackDecision.rationale,
      }),
    );
    expect(rolledBack.channel.currentReleaseId).toBe(SECOND_RELEASE_ID);
    expect(rolledBack.decision.action).toBe('rolled_back');
    expect(successTransaction.auditEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'release.rolled_back' }) }),
    );
  });
});
