import {
  CatalogVisibility as DatabaseCatalogVisibility,
  ImprovementCandidateState,
  ResourceKind as DatabaseResourceKind,
  ResourceLifecycle as DatabaseResourceLifecycle,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  capabilityProfileSchema,
  createReleaseRequestSchema,
  jsonValueSchema,
  releaseBundleSchema,
  repositoryImportRequestSchema,
  repositoryImportResponseSchema,
  resourceDependencySchema,
  resourceListResponseSchema,
  resourceManifestSchema,
  resourceVersionSchema,
  type ReleaseBundle,
  type ResourceVersion,
} from '@agent-builder/contracts';
import {
  assertPluginReferencesValid,
  canonicalJson,
  compileResourceYaml,
  isFrozenLifecycle,
  sha256,
} from '@paul-os/runtime';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { currentActorId } from '../request-context.js';
import { aggregateScope, aggregateScopeWhere, isInPrincipalScope } from '../scope.js';
import { userFacingResourceVersionWhere } from './user-facing-records.js';

const kindToDatabase = {
  CorePolicy: DatabaseResourceKind.CORE_POLICY,
  ContextPolicy: DatabaseResourceKind.CONTEXT_POLICY,
  Skill: DatabaseResourceKind.SKILL,
  Project: DatabaseResourceKind.PROJECT,
  Roadmap: DatabaseResourceKind.ROADMAP,
  Automation: DatabaseResourceKind.AUTOMATION,
  Reference: DatabaseResourceKind.REFERENCE,
  BusinessDomain: DatabaseResourceKind.BUSINESS_DOMAIN,
  Protocol: DatabaseResourceKind.PROTOCOL,
  KnowledgeSource: DatabaseResourceKind.KNOWLEDGE_SOURCE,
  EvaluationSuite: DatabaseResourceKind.EVALUATION_SUITE,
  MetricDefinition: DatabaseResourceKind.METRIC_DEFINITION,
  ImprovementCandidate: DatabaseResourceKind.IMPROVEMENT_CANDIDATE,
  Agent: DatabaseResourceKind.AGENT,
  Plugin: DatabaseResourceKind.PLUGIN,
  PluginPack: DatabaseResourceKind.PLUGIN_PACK,
} as const;

const kindToWire = Object.fromEntries(
  Object.entries(kindToDatabase).map(([wire, database]) => [database, wire]),
) as Record<DatabaseResourceKind, keyof typeof kindToDatabase>;

const lifecycleToDatabase = {
  experimental: DatabaseResourceLifecycle.EXPERIMENTAL,
  candidate: DatabaseResourceLifecycle.CANDIDATE,
  evaluating: DatabaseResourceLifecycle.EVALUATING,
  evaluated: DatabaseResourceLifecycle.EVALUATED,
  certified: DatabaseResourceLifecycle.CERTIFIED,
  production: DatabaseResourceLifecycle.PRODUCTION,
  deprecated: DatabaseResourceLifecycle.DEPRECATED,
} as const;
const lifecycleToWire = Object.fromEntries(
  Object.entries(lifecycleToDatabase).map(([wire, database]) => [database, wire]),
) as Record<DatabaseResourceLifecycle, keyof typeof lifecycleToDatabase>;

const catalogVisibilityToDatabase = {
  private: DatabaseCatalogVisibility.PRIVATE,
  department: DatabaseCatalogVisibility.DEPARTMENT,
  organization: DatabaseCatalogVisibility.ORGANIZATION,
} as const;

type ResourceRecord = Prisma.ResourceVersionGetPayload<{ include: { family: true } }>;
type ReleaseRecord = Prisma.ReleaseBundleGetPayload<{ include: { resources: true } }>;

async function prepareCatalogPublications(
  transaction: Prisma.TransactionClient,
  release: { id: string; workspaceId: string; departmentId: string | null },
  versions: Array<ResourceRecord>,
  actor: string,
): Promise<void> {
  for (const version of versions) {
    if (
      version.family.kind !== DatabaseResourceKind.AGENT &&
      version.family.kind !== DatabaseResourceKind.SKILL
    ) {
      continue;
    }
    const manifest = resourceManifestSchema.parse(version.definition);
    const profileValue = manifest.metadata.capabilityProfile;
    const visibility = manifest.metadata.catalogVisibility;
    if (profileValue === undefined || visibility === undefined) continue;
    const profile = capabilityProfileSchema.parse(profileValue);
    const profileDigest = sha256(canonicalJson(profile));
    const existingProfile = await transaction.capabilityProfile.findUnique({
      where: { resourceVersionId: version.id },
    });
    if (existingProfile !== null && existingProfile.digest !== profileDigest) {
      throw new AppError(
        409,
        'CAPABILITY_PROFILE_IMMUTABLE',
        'A frozen resource version cannot change its governed capability profile',
      );
    }
    const storedProfile =
      existingProfile ??
      (await transaction.capabilityProfile.create({
        data: {
          workspaceId: version.family.workspaceId,
          departmentId: version.family.departmentId,
          resourceVersionId: version.id,
          schemaVersion: profile.schemaVersion,
          profile: toPrismaJson(capabilityProfileSchema, profile, 'CapabilityProfile.profile'),
          digest: profileDigest,
          createdBy: actor,
        },
      }));
    await transaction.catalogPublication.upsert({
      where: {
        releaseId_resourceVersionId: {
          releaseId: release.id,
          resourceVersionId: version.id,
        },
      },
      create: {
        workspaceId: release.workspaceId,
        departmentId: release.departmentId,
        resourceVersionId: version.id,
        releaseId: release.id,
        capabilityProfileId: storedProfile.id,
        subjectKind: version.family.kind,
        catalogVisibility: catalogVisibilityToDatabase[visibility],
        preparedBy: actor,
      },
      update: {},
    });
  }
}

function assertAcyclicExactPins(
  versions: Array<{ familyId: string; version: string; dependencyPins: Prisma.JsonValue }>,
  proposed: {
    familyId: string;
    version: string;
    dependencies: z.infer<typeof resourceDependencySchema>[];
  },
): void {
  const proposedKey = `${proposed.familyId}:${proposed.version}`;
  const graph = new Map<string, string[]>();
  for (const version of versions) {
    const key = `${version.familyId}:${version.version}`;
    if (key === proposedKey) continue;
    graph.set(
      key,
      parseJson(
        z.array(resourceDependencySchema),
        version.dependencyPins,
        'ResourceVersion.dependencyPins',
      ).map((dependency) => `${dependency.familyId}:${dependency.version}`),
    );
  }
  graph.set(
    proposedKey,
    proposed.dependencies.map((dependency) => `${dependency.familyId}:${dependency.version}`),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new AppError(
        422,
        'RESOURCE_DEPENDENCY_CYCLE',
        'Resource dependency pins form a cycle',
        {
          resource: key,
        },
      );
    }
    visiting.add(key);
    for (const dependency of graph.get(key) ?? []) {
      if (graph.has(dependency)) visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of graph.keys()) visit(key);
}

function toResource(record: ResourceRecord): ResourceVersion {
  return resourceVersionSchema.parse({
    id: record.id,
    familyId: record.familyId,
    kind: kindToWire[record.family.kind],
    slug: record.family.slug,
    name: record.family.name,
    version: record.version,
    owner: record.owner,
    purpose: record.purpose,
    lifecycle: lifecycleToWire[record.lifecycle],
    digest: record.digest,
    sourceCommit: record.sourceCommit,
    provenance: parseJson(jsonValueSchema, record.provenance, 'ResourceVersion.provenance'),
    dependencyPins: parseJson(
      z.array(resourceDependencySchema),
      record.dependencyPins,
      'ResourceVersion.dependencyPins',
    ),
    definition: parseJson(resourceManifestSchema, record.definition, 'ResourceVersion.definition'),
    revision: record.revision,
    frozenAt: record.frozenAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

function toRelease(record: ReleaseRecord): ReleaseBundle {
  return releaseBundleSchema.parse({
    id: record.id,
    digest: record.digest,
    projectId: record.projectId,
    resources: record.resources
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((resource) => ({
        resourceVersionId: resource.resourceVersionId,
        kind: kindToWire[resource.kind],
        digest: resource.digest,
        ordinal: resource.ordinal,
      })),
    createdBy: record.createdBy,
    createdAt: record.createdAt.toISOString(),
  });
}

export class RegistryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly trustedSourceCommit: string,
  ) {}

  async importResource(
    input: z.input<typeof repositoryImportRequestSchema>,
  ): Promise<z.infer<typeof repositoryImportResponseSchema>> {
    const parsed = repositoryImportRequestSchema.parse(input);
    const compiled = compileResourceYaml(parsed.manifestYaml);
    const { manifest, digest } = compiled;
    const sourceCommit = this.trustedSourceCommit;
    if (
      manifest.metadata.lifecycle !== 'experimental' &&
      manifest.metadata.lifecycle !== 'candidate'
    ) {
      throw new AppError(
        422,
        'RESOURCE_LIFECYCLE_NOT_IMPORTABLE',
        'Git imports may declare only experimental or candidate lifecycle; evaluation and promotion own later states',
      );
    }
    const actor = currentActorId();
    const scope = aggregateScope();
    const visibleScope = aggregateScopeWhere();
    const result = await this.prisma.$transaction(async (transaction) => {
      if (parsed.improvementCandidateId !== null) {
        const candidate = await transaction.improvementCandidate.findFirst({
          where: {
            id: parsed.improvementCandidateId,
            observation: visibleScope,
          },
          select: { state: true, proposedTarget: true },
        });
        if (candidate === null) {
          throw new AppError(404, 'IMPROVEMENT_NOT_FOUND', 'Improvement candidate was not found');
        }
        if (candidate.state !== ImprovementCandidateState.INCUBATING) {
          throw new AppError(
            409,
            'IMPROVEMENT_NOT_INCUBATING',
            'Only an incubating improvement candidate may be linked to an import',
          );
        }
        const expectedTarget = `${manifest.kind}:${manifest.metadata.slug}@${manifest.metadata.version}`;
        if (candidate.proposedTarget !== expectedTarget) {
          throw new AppError(
            422,
            'IMPROVEMENT_TARGET_MISMATCH',
            'Improvement candidate target must match the imported resource kind, slug, and version',
            { expectedTarget, proposedTarget: candidate.proposedTarget },
          );
        }
      }

      const family = await transaction.resourceFamily.findUnique({
        where: { id: manifest.metadata.id },
      });
      if (family !== null && !isInPrincipalScope(family)) {
        throw new AppError(404, 'RESOURCE_FAMILY_NOT_FOUND', 'Resource family was not found');
      }
      if (
        family !== null &&
        (family.kind !== kindToDatabase[manifest.kind] || family.slug !== manifest.metadata.slug)
      ) {
        throw new AppError(
          409,
          'RESOURCE_IDENTITY_CONFLICT',
          'The resource family ID is already bound to a different kind or slug',
        );
      }
      if (family === null) {
        await transaction.resourceFamily.create({
          data: {
            ...scope,
            id: manifest.metadata.id,
            kind: kindToDatabase[manifest.kind],
            slug: manifest.metadata.slug,
            name: manifest.metadata.name ?? manifest.metadata.slug,
            createdBy: actor,
            updatedBy: actor,
          },
        });
      }

      const resolvedDependencies: Array<{ id: string; digest: string }> = [];
      const resolvedDependencyManifests = [];
      for (const dependency of manifest.dependencies) {
        const found = await transaction.resourceVersion.findFirst({
          where: {
            familyId: dependency.familyId,
            version: dependency.version,
            family: visibleScope,
          },
        });
        if (found === null) {
          throw new AppError(
            422,
            'RESOURCE_DEPENDENCY_MISSING',
            'An exact dependency pin is unavailable',
            {
              familyId: dependency.familyId,
              version: dependency.version,
            },
          );
        }
        resolvedDependencies.push({ id: found.id, digest: found.digest });
        resolvedDependencyManifests.push(resourceManifestSchema.parse(found.definition));
      }
      const resolvedManifestIds = new Set(resolvedDependencies.map(({ id }) => id));
      let dependencyFrontier = [...resolvedManifestIds];
      while (dependencyFrontier.length > 0) {
        const transitivePins = await transaction.resourceDependencyPin.findMany({
          where: { sourceVersionId: { in: dependencyFrontier } },
          include: { targetVersion: true },
        });
        const next: string[] = [];
        for (const pin of transitivePins) {
          if (resolvedManifestIds.has(pin.targetVersionId)) continue;
          resolvedManifestIds.add(pin.targetVersionId);
          next.push(pin.targetVersionId);
          resolvedDependencyManifests.push(
            resourceManifestSchema.parse(pin.targetVersion.definition),
          );
        }
        dependencyFrontier = next;
      }
      try {
        assertPluginReferencesValid([manifest, ...resolvedDependencyManifests]);
      } catch {
        throw new AppError(
          422,
          'PLUGIN_REFERENCE_INVALID',
          'The resource contains an invalid exact Plugin or capability reference',
        );
      }
      const dependencyGraph = await transaction.resourceVersion.findMany({
        where: { family: visibleScope },
        select: { familyId: true, version: true, dependencyPins: true },
      });
      assertAcyclicExactPins(dependencyGraph, {
        familyId: manifest.metadata.id,
        version: manifest.metadata.version,
        dependencies: manifest.dependencies,
      });

      const existing = await transaction.resourceVersion.findUnique({
        where: {
          familyId_version: {
            familyId: manifest.metadata.id,
            version: manifest.metadata.version,
          },
        },
        include: { family: true },
      });
      if (existing !== null && !isInPrincipalScope(existing.family)) {
        throw new AppError(404, 'RESOURCE_VERSION_NOT_FOUND', 'Resource version was not found');
      }
      let resource: ResourceRecord;
      let idempotent = false;
      if (existing === null) {
        resource = await transaction.resourceVersion.create({
          data: {
            familyId: manifest.metadata.id,
            version: manifest.metadata.version,
            lifecycle: lifecycleToDatabase[manifest.metadata.lifecycle],
            owner: manifest.metadata.owner,
            purpose: manifest.metadata.purpose,
            definition: toPrismaJson(
              resourceManifestSchema,
              manifest,
              'ResourceVersion.definition',
            ),
            digest,
            sourceCommit,
            provenance: toPrismaJson(
              jsonValueSchema,
              manifest.metadata.provenance,
              'ResourceVersion.provenance',
            ),
            dependencyPins: toPrismaJson(
              z.array(resourceDependencySchema),
              manifest.dependencies,
              'ResourceVersion.dependencyPins',
            ),
            frozenAt: isFrozenLifecycle(manifest.metadata.lifecycle) ? new Date() : null,
            createdBy: actor,
            updatedBy: actor,
          },
          include: { family: true },
        });
      } else if (existing.digest === digest) {
        resource = existing;
        idempotent = true;
      } else if (existing.lifecycle === DatabaseResourceLifecycle.EXPERIMENTAL) {
        resource = await transaction.resourceVersion.update({
          where: { id: existing.id },
          data: {
            lifecycle: lifecycleToDatabase[manifest.metadata.lifecycle],
            owner: manifest.metadata.owner,
            purpose: manifest.metadata.purpose,
            definition: toPrismaJson(
              resourceManifestSchema,
              manifest,
              'ResourceVersion.definition',
            ),
            digest,
            sourceCommit,
            provenance: toPrismaJson(
              jsonValueSchema,
              manifest.metadata.provenance,
              'ResourceVersion.provenance',
            ),
            dependencyPins: toPrismaJson(
              z.array(resourceDependencySchema),
              manifest.dependencies,
              'ResourceVersion.dependencyPins',
            ),
            revision: { increment: 1 },
            frozenAt: isFrozenLifecycle(manifest.metadata.lifecycle) ? new Date() : null,
            updatedBy: actor,
          },
          include: { family: true },
        });
      } else {
        throw new AppError(
          409,
          'RESOURCE_VERSION_IMMUTABLE',
          'A frozen resource version cannot be changed; create a successor version',
        );
      }

      if (!idempotent) {
        await transaction.resourceDependencyPin.deleteMany({
          where: { sourceVersionId: resource.id },
        });
      }
      if (resolvedDependencies.length > 0) {
        await transaction.resourceDependencyPin.createMany({
          data: resolvedDependencies.map((dependency) => ({
            sourceVersionId: resource.id,
            targetVersionId: dependency.id,
            targetDigest: dependency.digest,
          })),
          skipDuplicates: true,
        });
      }

      const existingImport = await transaction.repositoryImport.findUnique({
        where: { resourceVersionId_digest: { resourceVersionId: resource.id, digest } },
      });
      let repositoryImport = existingImport;
      let lineageAttached = false;
      if (repositoryImport === null) {
        repositoryImport = await transaction.repositoryImport.create({
          data: {
            resourceVersionId: resource.id,
            improvementCandidateId: parsed.improvementCandidateId,
            digest,
            sourceCommit,
            sourcePath: parsed.sourcePath,
            manifestSnapshot: toPrismaJson(
              resourceManifestSchema,
              manifest,
              'RepositoryImport.manifestSnapshot',
            ),
            importedBy: actor,
          },
        });
        lineageAttached = parsed.improvementCandidateId !== null;
      } else if (parsed.improvementCandidateId !== null) {
        const currentCandidateId = repositoryImport.improvementCandidateId ?? null;
        if (currentCandidateId === null) {
          const attached = await transaction.repositoryImport.updateMany({
            where: { id: repositoryImport.id, improvementCandidateId: null },
            data: { improvementCandidateId: parsed.improvementCandidateId },
          });
          repositoryImport = await transaction.repositoryImport.findUniqueOrThrow({
            where: { id: repositoryImport.id },
          });
          lineageAttached = attached.count === 1;
        }
        if (repositoryImport.improvementCandidateId !== parsed.improvementCandidateId) {
          throw new AppError(
            409,
            'REPOSITORY_IMPORT_LINEAGE_IMMUTABLE',
            'Repository import lineage is already bound to another improvement candidate',
          );
        }
      }
      if (!idempotent) {
        await appendAuditEvent(transaction, {
          action: 'resource.imported',
          entityType: 'ResourceVersion',
          entityId: resource.id,
          details: {
            digest,
            sourceCommit,
            improvementCandidateId: parsed.improvementCandidateId,
          },
        });
      }
      if (lineageAttached) {
        await appendAuditEvent(transaction, {
          action: 'repository_import.lineage_attached',
          entityType: 'RepositoryImport',
          entityId: repositoryImport.id,
          details: {
            improvementCandidateId: parsed.improvementCandidateId,
            resourceVersionId: resource.id,
            digest,
          },
        });
      }
      return { resource, repositoryImport, idempotent };
    });
    return repositoryImportResponseSchema.parse({
      import: {
        id: result.repositoryImport.id,
        resourceVersionId: result.repositoryImport.resourceVersionId,
        digest: result.repositoryImport.digest,
        sourceCommit: result.repositoryImport.sourceCommit,
        sourcePath: result.repositoryImport.sourcePath,
        improvementCandidateId: result.repositoryImport.improvementCandidateId ?? null,
        importedBy: result.repositoryImport.importedBy,
        importedAt: result.repositoryImport.importedAt.toISOString(),
      },
      resource: toResource(result.resource),
      idempotent: result.idempotent,
    });
  }

  async listResources(query: {
    kind?: keyof typeof kindToDatabase | undefined;
    query?: string | undefined;
    lifecycle?: keyof typeof lifecycleToDatabase | undefined;
    limit: number;
  }): Promise<z.infer<typeof resourceListResponseSchema>> {
    const scopeWhere = aggregateScopeWhere();
    const [records, lifecycleTotals] = await Promise.all([
      this.prisma.resourceVersion.findMany({
        where: {
          AND: [
            userFacingResourceVersionWhere,
            {
              family: {
                ...scopeWhere,
                ...(query.kind === undefined ? {} : { kind: kindToDatabase[query.kind] }),
              },
              ...(query.lifecycle === undefined
                ? {}
                : { lifecycle: lifecycleToDatabase[query.lifecycle] }),
              ...(query.query === undefined || query.query.length === 0
                ? {}
                : {
                    OR: [
                      { family: { name: { contains: query.query, mode: 'insensitive' } } },
                      { family: { slug: { contains: query.query, mode: 'insensitive' } } },
                      {
                        legacyAgent: {
                          is: { slug: { equals: query.query, mode: 'insensitive' } },
                        },
                      },
                      { purpose: { contains: query.query, mode: 'insensitive' } },
                    ],
                  }),
            },
          ],
        },
        include: { family: true },
        orderBy: [{ updatedAt: 'desc' }],
        take: query.limit,
      }),
      this.prisma.resourceVersion.groupBy({
        by: ['lifecycle'],
        where: {
          AND: [userFacingResourceVersionWhere, { family: scopeWhere }],
        },
        _count: { _all: true },
      }),
    ]);
    const countsByLifecycle = {
      experimental: 0,
      candidate: 0,
      evaluating: 0,
      evaluated: 0,
      certified: 0,
      production: 0,
      deprecated: 0,
    };
    for (const group of lifecycleTotals) {
      countsByLifecycle[lifecycleToWire[group.lifecycle]] = group._count._all;
    }
    const total = Object.values(countsByLifecycle).reduce((sum, count) => sum + count, 0);
    return resourceListResponseSchema.parse({
      items: records.map(toResource),
      total,
      countsByLifecycle,
    });
  }

  async getResource(resourceVersionId: string): Promise<ResourceVersion> {
    const record = await this.prisma.resourceVersion.findFirst({
      where: {
        AND: [
          userFacingResourceVersionWhere,
          { id: resourceVersionId, family: aggregateScopeWhere() },
        ],
      },
      include: { family: true },
    });
    if (record === null) {
      throw new AppError(404, 'RESOURCE_NOT_FOUND', 'Resource version was not found', {
        resourceVersionId,
      });
    }
    return toResource(record);
  }

  async createRelease(input: z.input<typeof createReleaseRequestSchema>): Promise<ReleaseBundle> {
    const parsed = createReleaseRequestSchema.parse(input);
    const uniqueIds = [...new Set(parsed.resourceVersionIds)];
    if (uniqueIds.length !== parsed.resourceVersionIds.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'A resource version may appear only once');
    }
    const versions = await this.prisma.resourceVersion.findMany({
      where: { id: { in: uniqueIds }, family: aggregateScopeWhere() },
      include: { family: true },
    });
    if (versions.length !== uniqueIds.length) {
      throw new AppError(
        404,
        'RESOURCE_VERSION_NOT_FOUND',
        'One or more resource versions were not found',
      );
    }
    const familyIds = new Set(versions.map((version) => version.familyId));
    if (familyIds.size !== versions.length) {
      throw new AppError(
        422,
        'RELEASE_FAMILY_VERSION_CONFLICT',
        'A release can contain only one version of each resource family',
      );
    }
    const byPin = new Set(versions.map((version) => `${version.familyId}:${version.version}`));
    for (const version of versions) {
      if (
        version.lifecycle !== DatabaseResourceLifecycle.CANDIDATE &&
        version.lifecycle !== DatabaseResourceLifecycle.EVALUATED &&
        version.lifecycle !== DatabaseResourceLifecycle.CERTIFIED
      ) {
        throw new AppError(
          422,
          'RESOURCE_NOT_RELEASABLE',
          'Only candidate, evaluated, or certified resource versions can enter an immutable evaluation release',
        );
      }
      const dependencies = parseJson(
        z.array(resourceDependencySchema),
        version.dependencyPins,
        'ResourceVersion.dependencyPins',
      );
      const missing = dependencies.find(
        (dependency) => !byPin.has(`${dependency.familyId}:${dependency.version}`),
      );
      if (missing !== undefined) {
        throw new AppError(
          422,
          'RELEASE_DEPENDENCY_MISSING',
          'Release omits an exact dependency pin',
          missing,
        );
      }
    }
    const ordered = [...versions].sort((left, right) =>
      `${left.family.kind}:${left.familyId}:${left.version}`.localeCompare(
        `${right.family.kind}:${right.familyId}:${right.version}`,
      ),
    );
    const digest = sha256(
      canonicalJson({
        projectId: parsed.projectId,
        resources: ordered.map((version) => ({
          id: version.id,
          digest: version.digest,
          kind: kindToWire[version.family.kind],
        })),
      }),
    );
    const actor = currentActorId();
    const scope = aggregateScope();
    const record = await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.releaseBundle.findFirst({
        where: { digest, ...aggregateScopeWhere() },
        include: { resources: true },
      });
      if (existing !== null) {
        await prepareCatalogPublications(transaction, existing, ordered, actor);
        return existing;
      }
      const created = await transaction.releaseBundle.create({
        data: {
          ...scope,
          digest,
          projectId: parsed.projectId,
          createdBy: actor,
          resources: {
            create: ordered.map((version, ordinal) => ({
              resourceVersionId: version.id,
              kind: version.family.kind,
              digest: version.digest,
              ordinal,
            })),
          },
        },
        include: { resources: true },
      });
      await prepareCatalogPublications(transaction, created, ordered, actor);
      await appendAuditEvent(transaction, {
        action: 'release.created',
        entityType: 'ReleaseBundle',
        entityId: created.id,
        details: { digest, resourceCount: ordered.length },
      });
      return created;
    });
    return toRelease(record);
  }

  async getRelease(releaseId: string): Promise<ReleaseBundle> {
    const record = await this.prisma.releaseBundle.findFirst({
      where: { id: releaseId, ...aggregateScopeWhere() },
      include: { resources: true },
    });
    if (record === null) throw new AppError(404, 'RELEASE_NOT_FOUND', 'Release was not found');
    return toRelease(record);
  }
}
