import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  agentResourceSpecSchema,
  automationSpecSchema,
  businessDomainSpecSchema,
  contextPolicySpecSchema,
  corePolicySpecSchema,
  platformEvaluationSuiteSpecSchema,
  improvementCandidateSpecSchema,
  knowledgeSourceSpecSchema,
  metricDefinitionSpecSchema,
  pluginKnowledgeSourceSpecSchema,
  pluginPackSpecSchema,
  pluginResourceSpecSchema,
  projectSpecSchema,
  protocolSpecSchema,
  roadmapResourceSpecSchema,
  referenceSpecSchema,
  resourceManifestSchema,
  skillSpecSchema,
  type ResourceManifest,
} from '@agent-builder/contracts';
import { parseDocument } from 'yaml';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validateKindSpecificManifest(manifest: ResourceManifest): void {
  const schemas = {
    CorePolicy: corePolicySpecSchema,
    ContextPolicy: contextPolicySpecSchema,
    Skill: skillSpecSchema,
    Project: projectSpecSchema,
    Roadmap: roadmapResourceSpecSchema,
    Automation: automationSpecSchema,
    Reference: referenceSpecSchema,
    BusinessDomain: businessDomainSpecSchema,
    Protocol: protocolSpecSchema,
    KnowledgeSource: knowledgeSourceSpecSchema,
    EvaluationSuite: platformEvaluationSuiteSpecSchema,
    MetricDefinition: metricDefinitionSpecSchema,
    ImprovementCandidate: improvementCandidateSpecSchema,
    Agent: agentResourceSpecSchema,
    Plugin: pluginResourceSpecSchema,
    PluginPack: pluginPackSpecSchema,
  } as const;
  schemas[manifest.kind].parse(manifest.spec);
  if (manifest.kind === 'Roadmap') {
    const spec = roadmapResourceSpecSchema.parse(manifest.spec);
    const declaredPins = new Set(
      manifest.dependencies.map(({ familyId, version }) => `${familyId.toLowerCase()}@${version}`),
    );
    const requiredPins = [
      ...spec.definitionDependencies.map(({ target }) => target),
      ...spec.relationships.flatMap(({ target }) =>
        target.kind === 'resource_version' ? [target] : [],
      ),
    ];
    for (const pin of requiredPins) {
      if (!declaredPins.has(`${pin.familyId.toLowerCase()}@${pin.version}`)) {
        throw new Error(
          `Roadmap ${manifest.metadata.slug} must declare exact dependency ${pin.familyId}@${pin.version}`,
        );
      }
    }
  }
  if (manifest.kind === 'Skill' && manifest.metadata.slug === 'daily-brief') {
    const spec = skillSpecSchema.parse(manifest.spec);
    const expectedCaps = [
      [spec.inputSchema, 'priorities', 20],
      [spec.inputSchema, 'calendarItems', 100],
      [spec.inputSchema, 'tasks', 100],
      [spec.inputSchema, 'signals', 100],
      [spec.inputSchema, 'userConstraints', 20],
      [spec.outputSchema, 'topPriorities', 5],
      [spec.outputSchema, 'scheduleRisks', 10],
      [spec.outputSchema, 'decisionsRequired', 10],
      [spec.outputSchema, 'proposedActions', 10],
      [spec.outputSchema, 'citations', 100],
      [spec.outputSchema, 'unresolvedItems', 20],
    ] as const;
    for (const [schema, property, expectedMaximum] of expectedCaps) {
      const properties = schema['properties'];
      const declaration =
        properties !== null && !Array.isArray(properties) && typeof properties === 'object'
          ? properties[property]
          : undefined;
      const maximum =
        declaration !== null && !Array.isArray(declaration) && typeof declaration === 'object'
          ? declaration['maxItems']
          : undefined;
      if (maximum !== expectedMaximum) {
        throw new Error(
          `Daily-brief ${property} maxItems must match the runtime contract (${expectedMaximum})`,
        );
      }
    }
  }

  const requiredPluginPins: Array<{ familyId: string; version: string }> = [];
  if (manifest.kind === 'PluginPack') {
    requiredPluginPins.push(
      ...pluginPackSpecSchema.parse(manifest.spec).plugins.map(({ plugin }) => plugin),
    );
  }
  if (manifest.kind === 'KnowledgeSource') {
    const pluginSource = pluginKnowledgeSourceSpecSchema.safeParse(manifest.spec);
    if (pluginSource.success) requiredPluginPins.push(pluginSource.data.plugin);
  }
  if (manifest.kind === 'Skill') {
    const skill = skillSpecSchema.parse(manifest.spec);
    requiredPluginPins.push(
      ...skill.tools.flatMap((tool) => (typeof tool === 'string' ? [] : [tool.plugin])),
    );
  }
  if (manifest.kind === 'Agent') {
    const agent = agentResourceSpecSchema.parse(manifest.spec);
    requiredPluginPins.push(
      ...agent.tools.flatMap((tool) => (typeof tool === 'string' ? [] : [tool.plugin])),
    );
  }
  for (const pin of requiredPluginPins) {
    const declared = manifest.dependencies.some(
      (dependency) =>
        dependency.familyId.toLowerCase() === pin.familyId.toLowerCase() &&
        dependency.version === pin.version,
    );
    if (!declared) {
      throw new Error(
        `${manifest.kind} ${manifest.metadata.slug} must declare exact Plugin dependency ${pin.familyId}@${pin.version}`,
      );
    }
  }
}

export function compileResourceYaml(source: string): {
  manifest: ResourceManifest;
  canonicalDefinition: string;
  digest: string;
} {
  const document = parseDocument(source, {
    schema: 'core',
    uniqueKeys: true,
    strict: true,
  });
  if (document.errors.length > 0) {
    throw new Error(
      `Invalid resource YAML: ${document.errors.map((error) => error.message).join('; ')}`,
    );
  }
  const raw: unknown = document.toJS({ maxAliasCount: 20 });
  const manifest = resourceManifestSchema.parse(raw);
  validateKindSpecificManifest(manifest);
  const canonicalDefinition = canonicalJson(manifest);
  return { manifest, canonicalDefinition, digest: sha256(canonicalDefinition) };
}

const resourceVersionKey = (familyId: string, version: string) =>
  `${familyId.toLowerCase()}@${version}`;

export function assertPluginReferencesValid(manifests: readonly ResourceManifest[]): void {
  const byVersion = new Map<string, ResourceManifest>();
  for (const manifest of manifests) {
    const key = resourceVersionKey(manifest.metadata.id, manifest.metadata.version);
    if (byVersion.has(key)) throw new Error(`Duplicate resource version ${key}`);
    byVersion.set(key, manifest);
  }
  const resolvePlugin = (
    source: ResourceManifest,
    reference: { familyId: string; version: string },
  ) => {
    const target = byVersion.get(resourceVersionKey(reference.familyId, reference.version));
    if (target?.kind !== 'Plugin') {
      throw new Error(
        `${source.kind} ${source.metadata.slug} references non-Plugin ${reference.familyId}@${reference.version}`,
      );
    }
    return pluginResourceSpecSchema.parse(target.spec);
  };
  const assertTool = (
    source: ResourceManifest,
    reference: { familyId: string; version: string },
    tool: string,
  ) => {
    const plugin = resolvePlugin(source, reference);
    const capability = plugin.capabilities.find((candidate) => candidate.tool === tool);
    if (capability === undefined) {
      throw new Error(
        `${source.kind} ${source.metadata.slug} references unknown Plugin tool ${reference.familyId}@${reference.version}:${tool}`,
      );
    }
    return capability;
  };
  for (const manifest of manifests) {
    if (manifest.kind === 'PluginPack') {
      const pack = pluginPackSpecSchema.parse(manifest.spec);
      for (const entry of pack.plugins) {
        for (const scope of entry.defaultScopes) {
          const capability = assertTool(manifest, entry.plugin, scope.tool);
          for (const [limit, requested] of Object.entries(scope.limits)) {
            const declared = capability.limits[limit as keyof typeof capability.limits];
            if (
              typeof requested === 'number' &&
              (typeof declared !== 'number' || requested > declared)
            ) {
              throw new Error(
                `PluginPack ${manifest.metadata.slug} broadens ${scope.tool}.${limit}`,
              );
            }
          }
        }
      }
    }
    if (manifest.kind === 'KnowledgeSource') {
      const source = pluginKnowledgeSourceSpecSchema.safeParse(manifest.spec);
      if (source.success) {
        const capability = assertTool(manifest, source.data.plugin, source.data.capability);
        if (capability.effect !== 'read') {
          throw new Error(
            `KnowledgeSource ${manifest.metadata.slug} must reference a read-only Plugin tool`,
          );
        }
      }
    }
    if (manifest.kind === 'Skill') {
      const skill = skillSpecSchema.parse(manifest.spec);
      for (const tool of skill.tools) {
        if (typeof tool !== 'string') assertTool(manifest, tool.plugin, tool.tool);
      }
    }
    if (manifest.kind === 'Agent') {
      const agent = agentResourceSpecSchema.parse(manifest.spec);
      for (const tool of agent.tools) {
        if (typeof tool !== 'string') assertTool(manifest, tool.plugin, tool.tool);
      }
    }
  }
}

export function assertAcyclicDependencies(manifests: readonly ResourceManifest[]): void {
  const byVersion = new Map<string, ResourceManifest>();
  for (const manifest of manifests) {
    const key = resourceVersionKey(manifest.metadata.id, manifest.metadata.version);
    if (byVersion.has(key)) throw new Error(`Duplicate resource version ${key}`);
    byVersion.set(key, manifest);
  }
  for (const manifest of manifests) {
    const dependencyKeys = manifest.dependencies.map((dependency) =>
      resourceVersionKey(dependency.familyId, dependency.version),
    );
    if (new Set(dependencyKeys).size !== dependencyKeys.length) {
      throw new Error(
        `Duplicate exact dependency in ${manifest.metadata.slug}@${manifest.metadata.version}`,
      );
    }
    for (const dependency of manifest.dependencies) {
      const dependencyKey = resourceVersionKey(dependency.familyId, dependency.version);
      if (!byVersion.has(dependencyKey)) {
        throw new Error(
          `Unresolved exact resource dependency ${dependencyKey} from ${manifest.metadata.slug}@${manifest.metadata.version}`,
        );
      }
    }
  }
  assertPluginReferencesValid(manifests);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (resourceKey: string): void => {
    if (visited.has(resourceKey)) return;
    if (visiting.has(resourceKey))
      throw new Error(`Resource dependency cycle includes ${resourceKey}`);
    visiting.add(resourceKey);
    const manifest = byVersion.get(resourceKey);
    for (const dependency of manifest?.dependencies ?? []) {
      visit(resourceVersionKey(dependency.familyId, dependency.version));
    }
    visiting.delete(resourceKey);
    visited.add(resourceKey);
  };
  for (const resourceKey of byVersion.keys()) visit(resourceKey);
}

const contentRootPattern = /^\d{2}-[a-z0-9-]+$/;

async function discoverManifestsBelow(directory: string): Promise<string[]> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const manifests: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      manifests.push(...(await discoverManifestsBelow(candidate)));
    } else if (entry.isFile() && entry.name === 'manifest.yaml') {
      manifests.push(candidate);
    }
  }
  return manifests;
}

export async function discoverResourceManifestPaths(workspaceRoot: string): Promise<string[]> {
  const roots = (await readdir(workspaceRoot, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() && !entry.isSymbolicLink() && contentRootPattern.test(entry.name),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const manifests = (
    await Promise.all(
      roots.map((entry) => discoverManifestsBelow(path.join(workspaceRoot, entry.name))),
    )
  ).flat();
  return manifests.sort((left, right) => left.localeCompare(right));
}

export async function compileContentTree(workspaceRoot: string): Promise<
  Array<{
    sourcePath: string;
    manifest: ResourceManifest;
    canonicalDefinition: string;
    digest: string;
  }>
> {
  const compiled = await Promise.all(
    (await discoverResourceManifestPaths(workspaceRoot)).map(async (manifestPath) => ({
      sourcePath: path.relative(workspaceRoot, manifestPath).replaceAll('\\', '/'),
      ...compileResourceYaml(await readFile(manifestPath, 'utf8')),
    })),
  );
  assertAcyclicDependencies(compiled.map(({ manifest }) => manifest));
  return compiled;
}

export function isFrozenLifecycle(lifecycle: ResourceManifest['metadata']['lifecycle']): boolean {
  return lifecycle !== 'experimental';
}
