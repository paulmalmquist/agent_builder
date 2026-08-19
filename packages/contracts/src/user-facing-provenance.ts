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
