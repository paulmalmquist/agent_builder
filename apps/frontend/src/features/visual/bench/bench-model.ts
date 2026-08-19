import type {
  Agent,
  AuthorityGrant,
  PluginInstallation,
  ResourceVersion,
} from '@agent-builder/contracts';
import type { PluginCatalogItem } from '../../../api/client';
import type {
  AssemblyBenchModel,
  BenchAuthorityState,
  BenchCapability,
  BenchConnectorState,
  BenchManifest,
  BenchManifestSource,
} from './types';

const MAX_PAGE_SIZE = 100;
const FALLBACK_CONNECTOR_BRAND = { monogram: 'PL', accent: '#8f96a3', assetSrc: null };

export interface BenchModelInput {
  agent: Agent;
  grants?: { activeTotal: number; items: readonly AuthorityGrant[] } | undefined;
  installations?: readonly PluginInstallation[] | undefined;
  plugins?: readonly PluginCatalogItem[] | undefined;
  resourceQueryComplete: boolean;
  resources?: readonly ResourceVersion[] | undefined;
}

interface ExactToolRequirement {
  plugin: { familyId: string; version: string };
  tool: string;
}

interface ManifestSelection {
  manifest: BenchManifest;
  resource: ResourceVersion | null;
  source: BenchManifestSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function containsSyntheticProvenance(value: unknown): boolean {
  if (typeof value === 'string') return value.toLocaleLowerCase().includes('synthetic');
  if (Array.isArray(value)) return value.some(containsSyntheticProvenance);
  if (!isRecord(value)) return false;
  return Object.values(value).some(containsSyntheticProvenance);
}

function exactToolRequirement(value: unknown): ExactToolRequirement | null {
  if (!isRecord(value) || typeof value['tool'] !== 'string' || !isRecord(value['plugin'])) {
    return null;
  }
  const familyId = value['plugin']['familyId'];
  const version = value['plugin']['version'];
  if (typeof familyId !== 'string' || typeof version !== 'string') return null;
  return { plugin: { familyId, version }, tool: value['tool'] };
}

function linkedLegacyAgentId(resource: ResourceVersion): string | null {
  if (resource.kind !== 'Agent') return null;
  const legacy = resource.definition.spec['legacyCompatibility'];
  if (!isRecord(legacy)) return null;
  return typeof legacy['agentId'] === 'string' ? legacy['agentId'] : null;
}

function linkedAgentResources(
  agentId: string,
  resources: readonly ResourceVersion[] | undefined,
): ResourceVersion[] {
  return resources?.filter((resource) => linkedLegacyAgentId(resource) === agentId) ?? [];
}

function selectManifest(input: BenchModelInput): ManifestSelection | null {
  const linkedResources = linkedAgentResources(input.agent.id, input.resources);
  const resource =
    input.resourceQueryComplete && linkedResources.length === 1 ? linkedResources[0]! : null;
  if (resource) {
    return { manifest: resource.definition, resource, source: 'governed_resource' };
  }
  if (input.agent.manifest) {
    return { manifest: input.agent.manifest, resource: null, source: 'builder_agent' };
  }
  return null;
}

export function serializeBenchManifest(manifest: BenchManifest): string {
  // JSON is valid YAML 1.2 and preserves the exact API value without inventing a second model.
  return JSON.stringify(manifest, null, 2);
}

function humanizeTool(tool: string): string {
  const words = tool
    .trim()
    .split(/[^a-z0-9]+/iu)
    .filter(Boolean)
    .slice(0, 6);
  if (words.length === 0) return 'Declared tool';
  const label = words.join(' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function toolRequirements(resource: ResourceVersion): readonly unknown[] {
  const tools = resource.definition.spec['tools'];
  return Array.isArray(tools) ? tools : [];
}

function authorityState(
  tool: string,
  resource: ResourceVersion,
  plugin: PluginCatalogItem | null,
  grants: BenchModelInput['grants'],
): BenchAuthorityState {
  if (!grants) return 'unavailable';
  const resourceGrants = grants.items.filter(
    (grant) => grant.state === 'active' && grant.entryResourceVersionId === resource.id,
  );
  const granted = plugin
    ? resourceGrants.some((grant) =>
        grant.pluginScopes.some(
          (scope) =>
            plugin.installationId !== null &&
            scope.installationId === plugin.installationId &&
            scope.pluginVersionId === plugin.pluginVersionId &&
            scope.pluginDigest === plugin.digest &&
            scope.tool === tool,
        ),
      )
    : resourceGrants.some((grant) => grant.toolScopes.includes(tool));
  if (granted) return 'granted';
  return grants.items.length >= grants.activeTotal ? 'declared' : 'unavailable';
}

function connectorState(
  plugin: PluginCatalogItem,
  installations: readonly PluginInstallation[] | undefined,
): BenchConnectorState {
  if (plugin.installationId === null) return 'not_installed';
  const installation = installations?.find(({ id }) => id === plugin.installationId);
  if (!installation) return 'unavailable';
  if (
    installation.pluginVersionId !== plugin.pluginVersionId ||
    installation.pluginDigest !== plugin.digest
  ) {
    return 'unavailable';
  }
  if (installation.state === 'disabled' || plugin.installationState === 'disabled')
    return 'disabled';
  if (
    installation.state === 'degraded' ||
    plugin.installationState === 'degraded' ||
    plugin.healthStatus === 'degraded'
  ) {
    return 'degraded';
  }
  if (
    plugin.healthStatus !== 'healthy' ||
    plugin.installationState !== 'enabled' ||
    installation.state !== 'enabled'
  ) {
    return 'unavailable';
  }
  return 'healthy';
}

function legacyCapability(
  tool: string,
  resource: ResourceVersion,
  grants: BenchModelInput['grants'],
): BenchCapability {
  return {
    approvalRequired: false,
    authority: authorityState(tool, resource, null, grants),
    brand: FALLBACK_CONNECTOR_BRAND,
    connectorState: 'unavailable',
    detail: 'This legacy tool name does not pin an exact Plugin version.',
    effect: 'read',
    executionPlacement: 'unavailable',
    id: `legacy:${tool}`,
    name: humanizeTool(tool),
    tool,
  };
}

function exactCapability(
  requirement: ExactToolRequirement,
  resource: ResourceVersion,
  input: BenchModelInput,
): BenchCapability {
  const plugin =
    input.plugins?.find(
      (candidate) =>
        candidate.familyId === requirement.plugin.familyId &&
        candidate.version === requirement.plugin.version,
    ) ?? null;
  const declaredCapability = plugin?.capabilities.find(({ tool }) => tool === requirement.tool);
  const effect = declaredCapability?.effect ?? 'read';
  return {
    approvalRequired: declaredCapability?.approval === 'approval_required',
    authority: plugin
      ? authorityState(requirement.tool, resource, plugin, input.grants)
      : 'unavailable',
    brand: plugin?.brand ?? FALLBACK_CONNECTOR_BRAND,
    connectorState: plugin ? connectorState(plugin, input.installations) : 'unavailable',
    detail:
      declaredCapability?.scopeDescription ??
      'The exact Plugin metadata is unavailable; this connector remains fail closed.',
    effect,
    executionPlacement: plugin?.executionPlacement ?? 'unavailable',
    id: `${requirement.plugin.familyId}@${requirement.plugin.version}:${requirement.tool}`,
    name: plugin
      ? `${plugin.name} · ${humanizeTool(requirement.tool)}`
      : humanizeTool(requirement.tool),
    tool: requirement.tool,
  };
}

function capabilitiesFromResource(
  resource: ResourceVersion,
  input: BenchModelInput,
): BenchCapability[] {
  return toolRequirements(resource).flatMap((requirement) => {
    if (typeof requirement === 'string') {
      return [legacyCapability(requirement, resource, input.grants)];
    }
    const exact = exactToolRequirement(requirement);
    return exact ? [exactCapability(exact, resource, input)] : [];
  });
}

function authorityClass(resource: ResourceVersion | null): string | null {
  if (!resource) return null;
  const production = resource.definition.spec['production'];
  if (!isRecord(production)) return null;
  return typeof production['authorityClass'] === 'string' ? production['authorityClass'] : null;
}

function buildIssues(
  input: BenchModelInput,
  selection: ManifestSelection,
  capabilities: readonly BenchCapability[],
): string[] {
  const issues: string[] = [];
  if (!selection.resource) {
    const linkedResourceCount = linkedAgentResources(input.agent.id, input.resources).length;
    issues.push(
      input.resources === undefined
        ? 'The governed Agent resource link is unavailable, so exact connector and grant wiring stays closed.'
        : !input.resourceQueryComplete
          ? 'The governed Agent search did not return a provably complete page. Visible matches are not proof of a unique resource, so exact connector and grant wiring stays closed.'
          : linkedResourceCount > 1
            ? 'Multiple governed Agent resources claim this Builder agent; exact connector and grant wiring stays closed.'
            : 'This Builder agent is not linked to a governed Agent resource; exact connector and grant wiring is unavailable.',
    );
  }
  if (selection.resource && input.plugins?.length === MAX_PAGE_SIZE) {
    const hasUnavailable = capabilities.some(
      ({ connectorState }) => connectorState === 'unavailable',
    );
    if (hasUnavailable) {
      issues.push(
        'The Plugin catalog reached its result cap; unmatched exact connectors stay unavailable.',
      );
    }
  }
  if (selection.resource && input.grants && input.grants.items.length < input.grants.activeTotal) {
    issues.push(
      'The active-grant response is incomplete; unmatched capabilities do not imply no authority.',
    );
  }
  if (capabilities.some(({ authority }) => authority === 'unavailable')) {
    issues.push(
      'One or more authority readings are unavailable and remain fail closed in this view.',
    );
  }
  if (capabilities.some(({ connectorState }) => connectorState !== 'healthy')) {
    issues.push('One or more declared connectors are not healthy and available now.');
  }
  return [...new Set(issues)];
}

export function createAssemblyBenchModel(input: BenchModelInput): AssemblyBenchModel | null {
  const selection = selectManifest(input);
  if (!selection) return null;
  const capabilities = selection.resource
    ? capabilitiesFromResource(selection.resource, input)
    : [];
  return {
    agentId: input.agent.id,
    agentName: input.agent.name,
    authorityClass: authorityClass(selection.resource),
    capabilities,
    certificationHealth: input.agent.certificationHealth,
    department: input.agent.department,
    issues: buildIssues(input, selection, capabilities),
    manifest: selection.manifest,
    manifestSource: selection.source,
    manifestText: serializeBenchManifest(selection.manifest),
    provenance: selection.resource
      ? containsSyntheticProvenance(selection.resource.definition.metadata.provenance)
        ? 'synthetic'
        : 'declared'
      : 'unavailable',
    purpose: input.agent.purpose,
    readOnlyReason:
      'This bench reads the current manifest, connector health, and bounded grants. Authority changes still go through governed review.',
    resourceVersionId: selection.resource?.id ?? null,
  };
}
