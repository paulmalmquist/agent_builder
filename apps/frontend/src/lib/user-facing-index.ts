import {
  isQuarantinedLegacyFixture,
  isQuarantinedTestIdentity,
  isQuarantinedTestProvenance,
  type ResourceVersion,
} from '@agent-builder/contracts';
import type { AgentSearchItem } from '../api/client';

function provenanceHasQuarantinedIdentity(value: unknown): boolean {
  if (typeof value === 'string' && isQuarantinedTestIdentity(value)) return true;
  if (Array.isArray(value)) return value.some(provenanceHasQuarantinedIdentity);
  if (value === null || typeof value !== 'object') return false;
  const entries = Object.entries(value);
  const normalized = new Map(entries.map(([key, nested]) => [key.toLowerCase(), nested]));
  if (
    isQuarantinedTestProvenance({
      createdBy:
        typeof normalized.get('createdby') === 'string'
          ? (normalized.get('createdby') as string)
          : undefined,
      updatedBy:
        typeof normalized.get('updatedby') === 'string'
          ? (normalized.get('updatedby') as string)
          : undefined,
      sourceCommit:
        typeof normalized.get('sourcecommit') === 'string'
          ? (normalized.get('sourcecommit') as string)
          : undefined,
    })
  ) {
    return true;
  }
  return entries.some(
    ([key, nested]) =>
      ['actor', 'createdby', 'importedby', 'source', 'sourcecommit'].includes(key.toLowerCase()) &&
      typeof nested === 'string' &&
      isQuarantinedTestIdentity(nested),
  );
}

export function isQuarantinedResource(resource: ResourceVersion): boolean {
  return (
    isQuarantinedTestProvenance({ sourceCommit: resource.sourceCommit }) ||
    provenanceHasQuarantinedIdentity(resource.provenance)
  );
}

export function isQuarantinedLegacyAgent(agent: AgentSearchItem): boolean {
  // Legacy search does not expose createdBy. The server filters it; this exact owner check is a
  // defense for stale/cached payloads without guessing from an agent's display name.
  return isQuarantinedTestIdentity(agent.owner) || isQuarantinedLegacyFixture(agent);
}

export function distinctResourceVersions(resources: readonly ResourceVersion[]): ResourceVersion[] {
  const byExactRecord = new Map<string, ResourceVersion>();
  for (const resource of resources) {
    if (isQuarantinedResource(resource)) continue;
    if (!byExactRecord.has(resource.id)) byExactRecord.set(resource.id, resource);
  }
  return [...byExactRecord.values()];
}

const terminalOpaqueIdentifier =
  /(?:[-_:])(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{24,64})$/iu;

export function humanizeOperationalSignal(signalType: string): string {
  const withoutOpaqueSuffix = signalType.trim().replace(terminalOpaqueIdentifier, '');
  const words = withoutOpaqueSuffix
    .split(/[^a-z0-9]+/iu)
    .filter(Boolean)
    .slice(0, 6);
  if (words.length === 0) return 'Operational signal';
  const label = words.join(' ');
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}
