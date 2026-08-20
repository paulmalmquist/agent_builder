import {
  ResourceKind as DatabaseResourceKind,
  ResourceLifecycle as DatabaseResourceLifecycle,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  jsonValueSchema,
  roadmapProgramSchema,
  roadmapResourceSpecSchema,
  resourceManifestSchema,
  type RoadmapProgram,
  type RoadmapResourceSpec,
  type RoadmapSourceState,
} from '@agent-builder/contracts';
import { canonicalJson, sha256 } from '@paul-os/runtime';
import { AppError } from '../errors.js';
import { parseJson } from '../json-boundary.js';
import { aggregateScopeWhere } from '../scope.js';
import { userFacingResourceVersionWhere } from './user-facing-records.js';

const kindToWire = {
  [DatabaseResourceKind.CORE_POLICY]: 'CorePolicy',
  [DatabaseResourceKind.CONTEXT_POLICY]: 'ContextPolicy',
  [DatabaseResourceKind.SKILL]: 'Skill',
  [DatabaseResourceKind.PROJECT]: 'Project',
  [DatabaseResourceKind.ROADMAP]: 'Roadmap',
  [DatabaseResourceKind.AUTOMATION]: 'Automation',
  [DatabaseResourceKind.REFERENCE]: 'Reference',
  [DatabaseResourceKind.BUSINESS_DOMAIN]: 'BusinessDomain',
  [DatabaseResourceKind.PROTOCOL]: 'Protocol',
  [DatabaseResourceKind.KNOWLEDGE_SOURCE]: 'KnowledgeSource',
  [DatabaseResourceKind.EVALUATION_SUITE]: 'EvaluationSuite',
  [DatabaseResourceKind.METRIC_DEFINITION]: 'MetricDefinition',
  [DatabaseResourceKind.IMPROVEMENT_CANDIDATE]: 'ImprovementCandidate',
  [DatabaseResourceKind.AGENT]: 'Agent',
  [DatabaseResourceKind.PLUGIN]: 'Plugin',
  [DatabaseResourceKind.PLUGIN_PACK]: 'PluginPack',
} as const;

const lifecycleToWire = {
  [DatabaseResourceLifecycle.EXPERIMENTAL]: 'experimental',
  [DatabaseResourceLifecycle.CANDIDATE]: 'candidate',
  [DatabaseResourceLifecycle.EVALUATING]: 'evaluating',
  [DatabaseResourceLifecycle.EVALUATED]: 'evaluated',
  [DatabaseResourceLifecycle.CERTIFIED]: 'certified',
  [DatabaseResourceLifecycle.PRODUCTION]: 'production',
  [DatabaseResourceLifecycle.DEPRECATED]: 'deprecated',
} as const;

type RoadmapRecord = Prisma.ResourceVersionGetPayload<{
  include: {
    family: true;
    dependencyPinsFrom: { include: { targetVersion: { include: { family: true } } } };
  };
}>;

function unavailable(reason: string): never {
  throw new AppError(
    503,
    'ROADMAPS_UNAVAILABLE',
    'Roadmap definitions are unavailable; no progress or nominal state is inferred.',
    { reason },
  );
}

interface ParsedSemver {
  readonly core: readonly [number, number, number];
  readonly prerelease: readonly string[] | null;
}

function parseSemver(value: string): ParsedSemver {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (match === null) unavailable('A Roadmap ResourceVersion has an invalid semantic version.');
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] === undefined ? null : match[4].split('.'),
  };
}

function comparePrerelease(left: readonly string[], right: readonly string[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

export function compareRoadmapVersions(left: string, right: string): number {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    const difference = parsedLeft.core[index]! - parsedRight.core[index]!;
    if (difference !== 0) return difference;
  }
  if (parsedLeft.prerelease === null && parsedRight.prerelease === null) return 0;
  if (parsedLeft.prerelease === null) return 1;
  if (parsedRight.prerelease === null) return -1;
  return comparePrerelease(parsedLeft.prerelease, parsedRight.prerelease);
}

function currentRoadmapVersions(records: readonly RoadmapRecord[]): RoadmapRecord[] {
  const byFamily = new Map<string, RoadmapRecord[]>();
  for (const record of records) {
    const family = byFamily.get(record.familyId) ?? [];
    family.push(record);
    byFamily.set(record.familyId, family);
  }
  if (byFamily.size !== 2) {
    unavailable('Exactly two governed Roadmap families must be visible in principal scope.');
  }
  return [...byFamily.values()]
    .map(
      (versions) =>
        [...versions].sort((left, right) => compareRoadmapVersions(right.version, left.version))[0],
    )
    .flatMap((record) => (record === undefined ? [] : [record]))
    .sort((left, right) => left.family.slug.localeCompare(right.family.slug));
}

function parseRoadmapRecord(record: RoadmapRecord): {
  readonly record: RoadmapRecord;
  readonly spec: RoadmapResourceSpec;
} {
  const manifest = resourceManifestSchema.safeParse(record.definition);
  if (!manifest.success || manifest.data.kind !== 'Roadmap') {
    unavailable('A selected Roadmap resource does not contain a valid Roadmap manifest.');
  }
  if (sha256(canonicalJson(manifest.data)) !== record.digest) {
    unavailable('A selected Roadmap definition does not match its immutable digest.');
  }
  const spec = roadmapResourceSpecSchema.safeParse(manifest.data.spec);
  if (!spec.success) unavailable('A selected Roadmap resource failed roadmap.fork/v1 validation.');
  if (
    manifest.data.metadata.id !== record.familyId ||
    manifest.data.metadata.slug !== record.family.slug ||
    manifest.data.metadata.version !== record.version ||
    record.family.kind !== DatabaseResourceKind.ROADMAP
  ) {
    unavailable('A Roadmap resource identity does not match its immutable manifest identity.');
  }
  return { record, spec: spec.data };
}

function dependencyKey(familyId: string, version: string): string {
  return `${familyId.toLowerCase()}@${version}`;
}

function resolvedDependencies(
  record: RoadmapRecord,
): Map<string, RoadmapRecord['dependencyPinsFrom'][number]> {
  const manifest = resourceManifestSchema.parse(record.definition);
  const resolved = new Map(
    record.dependencyPinsFrom.map((pin) => [
      dependencyKey(pin.targetVersion.familyId, pin.targetVersion.version),
      pin,
    ]),
  );
  const declared = new Set(
    manifest.dependencies.map(({ familyId, version }) => dependencyKey(familyId, version)),
  );
  if (declared.size !== manifest.dependencies.length || resolved.size !== declared.size) {
    unavailable('A Roadmap resource has a partial or duplicate exact dependency projection.');
  }
  for (const key of declared) {
    const pin = resolved.get(key);
    if (pin === undefined || pin.targetDigest !== pin.targetVersion.digest) {
      unavailable('A Roadmap resource has an unresolved or digest-mismatched exact dependency.');
    }
  }
  for (const key of resolved.keys()) {
    if (!declared.has(key)) unavailable('A Roadmap resource has an undeclared dependency edge.');
  }
  return resolved;
}

function sourceFor(spec: RoadmapResourceSpec): RoadmapSourceState {
  if (spec.program.synthetic) return 'synthetic';
  return spec.fork.jira.state === 'live' ? 'live' : 'awaiting_transfer';
}

function projectFork(input: ReturnType<typeof parseRoadmapRecord>) {
  const { record, spec } = input;
  const pins = resolvedDependencies(record);
  const resource = {
    resourceVersionId: record.id,
    familyId: record.familyId,
    kind: 'Roadmap' as const,
    slug: record.family.slug,
    name: record.family.name,
    version: record.version,
    lifecycle: lifecycleToWire[record.lifecycle],
    digest: record.digest,
    sourceCommit: record.sourceCommit,
    provenance: parseJson(jsonValueSchema, record.provenance, 'ResourceVersion.provenance'),
  };
  const definitionDependencies = spec.definitionDependencies.map((dependency) => {
    const pin = pins.get(dependencyKey(dependency.target.familyId, dependency.target.version));
    if (pin === undefined) unavailable('A declared Roadmap definition dependency is unresolved.');
    return {
      id: dependency.id,
      role: dependency.role,
      provenance: dependency.provenance,
      target: {
        resourceVersionId: pin.targetVersion.id,
        familyId: pin.targetVersion.familyId,
        kind: kindToWire[pin.targetVersion.family.kind],
        slug: pin.targetVersion.family.slug,
        name: pin.targetVersion.family.name,
        version: pin.targetVersion.version,
        digest: pin.targetVersion.digest,
      },
    };
  });
  const relationships = spec.relationships.map((relationship) => {
    if (relationship.target.kind !== 'resource_version') {
      return { ...relationship, source: resource };
    }
    const pin = pins.get(dependencyKey(relationship.target.familyId, relationship.target.version));
    if (pin === undefined) unavailable('A Roadmap relationship has an unresolved exact target.');
    return {
      ...relationship,
      source: resource,
      target: {
        ...relationship.target,
        resourceVersionId: pin.targetVersion.id,
        resourceKind: kindToWire[pin.targetVersion.family.kind],
        slug: pin.targetVersion.family.slug,
        name: pin.targetVersion.family.name,
        digest: pin.targetVersion.digest,
      },
    };
  });
  return {
    ...spec.fork,
    source: sourceFor(spec),
    resource,
    definitionDependencies,
    relationships,
    relationshipCoverage: spec.relationshipCoverage,
  };
}

export class RoadmapService {
  constructor(private readonly prisma: PrismaClient) {}

  async getProgram(): Promise<RoadmapProgram> {
    const records = await this.prisma.resourceVersion.findMany({
      where: {
        AND: [
          userFacingResourceVersionWhere,
          {
            lifecycle: { not: DatabaseResourceLifecycle.DEPRECATED },
            family: { ...aggregateScopeWhere(), kind: DatabaseResourceKind.ROADMAP },
          },
        ],
      },
      include: {
        family: true,
        dependencyPinsFrom: { include: { targetVersion: { include: { family: true } } } },
      },
    });
    const selected = currentRoadmapVersions(records).map(parseRoadmapRecord);
    if (selected.length !== 2) unavailable('The complete two-fork projection was not available.');
    const first = selected[0];
    if (first === undefined) unavailable('The first Roadmap fork was not available.');
    const programIdentity = canonicalJson(first.spec.program);
    if (selected.some(({ spec }) => canonicalJson(spec.program) !== programIdentity)) {
      unavailable('Roadmap forks declare mixed program metadata.');
    }
    if (new Set(selected.map(({ spec }) => spec.fork.id)).size !== selected.length) {
      unavailable('Roadmap forks declare duplicate canonical fork IDs.');
    }
    return roadmapProgramSchema.parse({
      schemaVersion: 'roadmaps.program/v2',
      ...first.spec.program,
      forks: selected.map(projectFork),
    });
  }
}
