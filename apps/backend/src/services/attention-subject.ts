import { ResourceKind } from '@prisma/client';

export interface AttentionSubject {
  name: string;
  kind: string;
  version: string;
}

export interface NamedResourceVersion {
  version: string;
  family: {
    id: string;
    name: string;
    kind: ResourceKind;
  };
}

export interface NamedReleaseResource {
  resourceVersion: NamedResourceVersion;
}

export interface SubjectBearingRun {
  projectId: string | null;
  entryResourceVersion: NamedResourceVersion | null;
  release: {
    resources: NamedReleaseResource[];
  };
}

const UUID_FRAGMENT =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu;
const HEX_IDENTIFIER_FRAGMENT = /\b[0-9a-f]{8,}\b/iu;
const PRINCIPAL_FRAGMENT = /\b(?:human|service|system|test|worker)[.:/_-][a-z0-9.:/_-]+\b/iu;
const COMPACT_IDENTIFIER = /^[a-z0-9]+(?:[.:/_@-][a-z0-9]+)+$/iu;
const GENERIC_LABEL = /^(?:candidate|default|item|record|release|run|unknown|untitled)$/iu;
const EMAIL_FRAGMENT = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu;
const URI_OR_PATH_FRAGMENT =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/|\burn:[^\s]+|(?:^|\s)[a-z]:[\\/]|(?:^|\s)\.{0,2}[\\/]|\\|\/[^\s/]+\/)/iu;

// These labels cover canonical resources whose frozen manifests predate metadata.name. Keeping the
// UI mapping here avoids mutating an existing version and invalidating its exact digest pins.
const GOVERNED_RESOURCE_DISPLAY_NAMES = new Map<string, string>([
  ['20000000-0000-4000-8000-000000000001', 'Daily Brief'],
  ['c0000000-0000-4000-8000-000000000001', 'Daily Briefing'],
]);

/**
 * Returns copy that can be used on a card face, or null when the value looks like an opaque
 * identifier. Exact identifiers remain available in Attention detail and provenance payloads.
 */
export function safeAttentionLabel(value: string, maxLength = 160): string | null {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  if (normalized.length === 0 || normalized.length > maxLength || !/\p{L}/u.test(normalized)) {
    return null;
  }
  if (
    UUID_FRAGMENT.test(normalized) ||
    HEX_IDENTIFIER_FRAGMENT.test(normalized) ||
    PRINCIPAL_FRAGMENT.test(normalized) ||
    EMAIL_FRAGMENT.test(normalized) ||
    URI_OR_PATH_FRAGMENT.test(normalized) ||
    /[\\/]/u.test(normalized) ||
    COMPACT_IDENTIFIER.test(normalized) ||
    GENERIC_LABEL.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function safeSubjectVersion(value: string): string | null {
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 80 ||
    UUID_FRAGMENT.test(normalized) ||
    HEX_IDENTIFIER_FRAGMENT.test(normalized) ||
    PRINCIPAL_FRAGMENT.test(normalized) ||
    EMAIL_FRAGMENT.test(normalized) ||
    URI_OR_PATH_FRAGMENT.test(normalized) ||
    /[\\/@]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function subjectFromNamedVersion(
  nameValue: string,
  kind: string,
  versionValue: string,
): AttentionSubject | null {
  const name = safeAttentionLabel(nameValue);
  const version = safeSubjectVersion(versionValue);
  return name === null || version === null ? null : { name, kind, version };
}

export function subjectFromResourceVersion(
  resourceVersion: NamedResourceVersion | null,
): AttentionSubject | null {
  if (resourceVersion === null) return null;
  const mappedName = GOVERNED_RESOURCE_DISPLAY_NAMES.get(resourceVersion.family.id);
  return subjectFromNamedVersion(
    mappedName ?? resourceVersion.family.name,
    resourceVersion.family.kind.toLowerCase(),
    resourceVersion.version,
  );
}

function uniqueSubjectForKind(
  resources: NamedReleaseResource[],
  kind: ResourceKind,
): AttentionSubject | null {
  const matches = resources.filter(({ resourceVersion }) => resourceVersion.family.kind === kind);
  if (matches.length !== 1) return null;
  return subjectFromResourceVersion(matches[0]?.resourceVersion ?? null);
}

function subjectFromProjectId(projectId: string | null): AttentionSubject | null {
  if (projectId === null) return null;
  const name = safeAttentionLabel(projectId);
  return name === null ? null : { name, kind: 'project', version: 'project scope' };
}

/**
 * Release bundles can contain many dependencies. Prefer one named Agent, then a governed Project,
 * then one Skill. Ambiguous bundles fall back only to an already-human-readable project label.
 */
export function subjectFromRelease(
  resources: NamedReleaseResource[],
  projectId: string | null,
): AttentionSubject | null {
  return (
    uniqueSubjectForKind(resources, ResourceKind.AGENT) ??
    uniqueSubjectForKind(resources, ResourceKind.PROJECT) ??
    uniqueSubjectForKind(resources, ResourceKind.SKILL) ??
    subjectFromProjectId(projectId)
  );
}

export function subjectFromRun(run: SubjectBearingRun): AttentionSubject | null {
  return (
    subjectFromResourceVersion(run.entryResourceVersion) ??
    subjectFromRelease(run.release.resources, run.projectId)
  );
}
