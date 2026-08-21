// These values identify persisted integration provenance. They are shared by the API and browser
// so user-facing indexes cannot drift into different interpretations of the same audit records.
// Display names and resource slugs are deliberately absent.
export const QUARANTINED_TEST_IDENTITIES = [
  'integration-test',
  'plugin-store-integration',
  'plugin-worker-test',
  'scope-test',
  'worker-integration-test',
  'worker-test',
] as const;

export const QUARANTINED_TEST_ACTOR_PREFIXES = [
  'human:attention-',
  'human:digest-claim-',
  'human:global-resolution-',
  'human:plugin-service-',
  'human:reuse-',
] as const;

// These records were written by the pre-provenance full-flow harness under the background actor,
// so their actor fields no longer distinguish them from real background work. Exact multi-field
// fingerprints quarantine only the known legacy fixtures; new test records must use reserved test
// provenance instead.
export const QUARANTINED_LEGACY_FIXTURE_FINGERPRINTS = [
  {
    name: 'Integration Conflict Probe',
    owner: 'Supply Chain Agent Owner',
    purpose:
      'Produces an evidence-backed supplier risk briefing for production planners and escalation owners.',
  },
  {
    name: 'Integration Orphan Recovery Probe',
    owner: 'Supply Chain Agent Owner',
    purpose:
      'Produces an evidence-backed supplier risk briefing for production planners and escalation owners.',
  },
  {
    name: 'Integration Queued Resume Probe',
    owner: 'Supply Chain Agent Owner',
    purpose:
      'Produces an evidence-backed supplier risk briefing for production planners and escalation owners.',
  },
  {
    name: 'Integration Readiness Probe',
    owner: 'Supply Chain Agent Owner',
    purpose:
      'Produces an evidence-backed supplier risk briefing for production planners and escalation owners.',
  },
] as const;

export function isQuarantinedLegacyFixture(input: {
  name: string;
  owner: string;
  purpose: string;
}): boolean {
  return QUARANTINED_LEGACY_FIXTURE_FINGERPRINTS.some(
    (fingerprint) =>
      input.name === fingerprint.name &&
      input.owner === fingerprint.owner &&
      input.purpose === fingerprint.purpose,
  );
}

export interface UserFacingProvenanceFields {
  createdBy?: string | null | undefined;
  updatedBy?: string | null | undefined;
  sourceCommit?: string | null | undefined;
  familyCreatedBy?: string | null | undefined;
  familyUpdatedBy?: string | null | undefined;
}

export function isQuarantinedTestIdentity(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return (
    QUARANTINED_TEST_IDENTITIES.some((identity) => identity === normalized) ||
    QUARANTINED_TEST_ACTOR_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

export function isQuarantinedTestProvenance(input: UserFacingProvenanceFields): boolean {
  if (
    [
      input.createdBy,
      input.updatedBy,
      input.sourceCommit,
      input.familyCreatedBy,
      input.familyUpdatedBy,
    ].some(isQuarantinedTestIdentity)
  ) {
    return true;
  }
  const createdBy = input.createdBy?.trim().toLowerCase();
  const sourceCommit = input.sourceCommit?.trim().toLowerCase();
  return (
    createdBy === 'system:background' &&
    (sourceCommit === 'legacy-unverified' || sourceCommit === 'a'.repeat(40))
  );
}
