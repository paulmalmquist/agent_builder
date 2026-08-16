import { createHash } from 'node:crypto';
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
  projectSpecSchema,
  protocolSpecSchema,
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
    Automation: automationSpecSchema,
    Reference: referenceSpecSchema,
    BusinessDomain: businessDomainSpecSchema,
    Protocol: protocolSpecSchema,
    KnowledgeSource: knowledgeSourceSpecSchema,
    EvaluationSuite: platformEvaluationSuiteSpecSchema,
    MetricDefinition: metricDefinitionSpecSchema,
    ImprovementCandidate: improvementCandidateSpecSchema,
    Agent: agentResourceSpecSchema,
  } as const;
  schemas[manifest.kind].parse(manifest.spec);
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

export function assertAcyclicDependencies(manifests: readonly ResourceManifest[]): void {
  const byFamily = new Map(manifests.map((manifest) => [manifest.metadata.id, manifest]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (familyId: string): void => {
    if (visited.has(familyId)) return;
    if (visiting.has(familyId)) throw new Error(`Resource dependency cycle includes ${familyId}`);
    visiting.add(familyId);
    const manifest = byFamily.get(familyId);
    for (const dependency of manifest?.dependencies ?? []) {
      if (byFamily.has(dependency.familyId)) visit(dependency.familyId);
    }
    visiting.delete(familyId);
    visited.add(familyId);
  };
  for (const familyId of byFamily.keys()) visit(familyId);
}

export function isFrozenLifecycle(lifecycle: ResourceManifest['metadata']['lifecycle']): boolean {
  return lifecycle !== 'experimental';
}
