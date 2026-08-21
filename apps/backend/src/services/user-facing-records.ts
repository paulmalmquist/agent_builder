import type { Prisma } from '@prisma/client';
import {
  QUARANTINED_LEGACY_FIXTURE_FINGERPRINTS,
  QUARANTINED_TEST_ACTOR_PREFIXES,
  QUARANTINED_TEST_IDENTITIES,
  isQuarantinedTestIdentity,
  isQuarantinedTestProvenance,
} from '@agent-builder/contracts';

// Integration fixtures remain available through exact-id audit and detail routes. They are kept
// out of user-facing indexes only when persisted provenance names an explicit test identity.
// Display names are deliberately not considered: legitimate resources may discuss testing.
export { isQuarantinedTestIdentity, isQuarantinedTestProvenance };

export function quarantinedActorPredicates<Field extends string>(
  field: Field,
): Array<Record<Field, Prisma.StringFilter>> {
  return [
    { [field]: { in: [...QUARANTINED_TEST_IDENTITIES] } },
    ...QUARANTINED_TEST_ACTOR_PREFIXES.map((prefix) => ({
      [field]: { startsWith: prefix },
    })),
  ] as Array<Record<Field, Prisma.StringFilter>>;
}

export const userFacingResourceVersionWhere = {
  NOT: [
    {
      createdBy: 'system:background',
      sourceCommit: { in: ['legacy-unverified', 'a'.repeat(40)] },
    },
    ...quarantinedActorPredicates('createdBy'),
    ...quarantinedActorPredicates('sourceCommit'),
    ...quarantinedActorPredicates('updatedBy'),
    ...quarantinedActorPredicates('createdBy').map((predicate) => ({ family: predicate })),
    ...quarantinedActorPredicates('updatedBy').map((predicate) => ({ family: predicate })),
  ],
} satisfies Prisma.ResourceVersionWhereInput;

export const userFacingAgentWhere = {
  NOT: [
    ...QUARANTINED_LEGACY_FIXTURE_FINGERPRINTS.map((fingerprint) => ({ ...fingerprint })),
    ...quarantinedActorPredicates('createdBy'),
    ...quarantinedActorPredicates('updatedBy'),
    ...quarantinedActorPredicates('createdBy').map((predicate) => ({ family: predicate })),
    ...quarantinedActorPredicates('updatedBy').map((predicate) => ({ family: predicate })),
  ],
} satisfies Prisma.AgentWhereInput;

export const userFacingAgentFamilyWhere = {
  NOT: [
    ...QUARANTINED_LEGACY_FIXTURE_FINGERPRINTS.map(({ name, owner }) => ({ name, owner })),
    ...quarantinedActorPredicates('createdBy'),
    ...quarantinedActorPredicates('updatedBy'),
  ],
} satisfies Prisma.AgentFamilyWhereInput;

/**
 * Composable projection predicate for run-backed user-facing surfaces. Legacy runs with no
 * resolved entrypoint remain visible unless their own actor provenance is explicitly reserved.
 */
export const userFacingExecutionRunWhere = {
  AND: [
    { NOT: quarantinedActorPredicates('requestedBy') },
    {
      OR: [
        { entryResourceVersionId: null },
        { entryResourceVersion: { is: userFacingResourceVersionWhere } },
      ],
    },
  ],
} satisfies Prisma.ExecutionRunWhereInput;

export const userFacingObservationWhere = {
  AND: [
    { NOT: quarantinedActorPredicates('observedBy') },
    {
      OR: [{ sourceRunId: null }, { sourceRun: { is: userFacingExecutionRunWhere } }],
    },
  ],
} satisfies Prisma.ObservationWhereInput;

export const userFacingImprovementCandidateWhere = {
  AND: [
    { NOT: quarantinedActorPredicates('createdBy') },
    { observation: { is: userFacingObservationWhere } },
  ],
} satisfies Prisma.ImprovementCandidateWhereInput;

export const userFacingMemoryCandidateWhere = {
  AND: [
    { NOT: quarantinedActorPredicates('stagedBy') },
    { sourceRun: { is: userFacingExecutionRunWhere } },
  ],
} satisfies Prisma.MemoryCandidateWhereInput;

export const userFacingReleaseBundleWhere = {
  AND: [
    { NOT: quarantinedActorPredicates('createdBy') },
    {
      resources: {
        some: {},
        every: { resourceVersion: { is: userFacingResourceVersionWhere } },
      },
    },
  ],
} satisfies Prisma.ReleaseBundleWhereInput;

export const userFacingPluginInstallationWhere = {
  AND: [
    {
      NOT: [
        ...quarantinedActorPredicates('installedBy'),
        ...quarantinedActorPredicates('updatedBy'),
      ],
    },
    { pluginVersion: { is: userFacingResourceVersionWhere } },
  ],
} satisfies Prisma.PluginInstallationWhereInput;
