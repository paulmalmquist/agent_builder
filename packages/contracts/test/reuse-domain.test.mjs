import assert from 'node:assert/strict';
import test from 'node:test';
import {
  builderDecisionSchema,
  catalogIndexOutboxEventSchema,
  compositionSuggestionsSchema,
  configurationRevisionSchema,
  referredChoiceSchema,
  resourceLineageSchema,
} from '../dist/reuse-schemas.js';
import {
  DeterministicFeatureHashEmbeddingProvider,
  assertAcyclicResourceLineage,
  assertConfigurationRevisionAppendOnly,
  buildCatalogIndexResource,
  createCatalogIndexOutboxEvent,
  deterministicFeatureHashEmbedding,
  embedWithProviderPolicy,
  scoreCapabilityMatch,
  suggestSkillCompositions,
} from '../dist/reuse-domain.js';
import { REUSE_OPENAPI_OPERATION_IDS, REUSE_V1_ROUTES } from '../dist/reuse-routes.js';

const ids = Array.from(
  { length: 40 },
  (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
);
const now = '2026-08-17T12:00:00.000Z';
const digest = 'a'.repeat(64);

function profile(overrides = {}) {
  return {
    schemaVersion: 1,
    intendedUsers: ['operations analysts'],
    businessDomain: 'operations',
    triggers: ['new governed record'],
    tasks: ['triage records', 'rank follow-up'],
    inputs: ['governed records'],
    outputs: ['decision brief'],
    knowledgeClasses: ['operational policy'],
    tools: ['record reader'],
    potentialActions: ['draft a recommendation'],
    successCriteria: ['all claims are cited'],
    riskLevel: 'moderate',
    ...overrides,
  };
}

const trustChip = {
  certificationState: 'certified',
  gatesPassed: 12,
  gatesTotal: 12,
  corpusSize: 240,
  recertifiedAt: now,
  label: 'Certified · 12/12 gates · corpus 240 · re-certified Aug 17',
};

function publication(index, overrides = {}) {
  return {
    id: ids[index],
    revision: 1,
    subjectKind: 'skill',
    resourceVersionId: ids[index + 10],
    releaseId: ids[30],
    releaseDigest: digest,
    name: `Certified skill ${index}`,
    version: '1.0.0',
    owner: 'Platform Team',
    department: 'Operations',
    catalogVisibility: 'department',
    capabilityProfile: profile(),
    trustChip,
    publishedAt: now,
    retiredAt: null,
    ...overrides,
  };
}

function referredChoice(overrides = {}) {
  return {
    publicationId: ids[0],
    subjectKind: 'agent',
    name: 'Governed Operations Agent',
    version: '1.0.0',
    trustChip,
    delta: {
      has: ['tasks:triage records'],
      lacks: ['tasks:rank follow-up'],
      offers: [],
    },
    match: {
      score: 50,
      structuredCoverage: 50,
      embeddingCosine: null,
      mode: 'structured_only_fallback',
      label: 'Structured-only fallback',
    },
    provenance: {
      owner: 'Platform Team',
      department: 'Operations',
      resourceVersionId: ids[10],
      releaseId: ids[30],
      releaseDigest: digest,
      publishedAt: now,
    },
    deployment: { total: 4, active: 3 },
    success: { successfulRuns: 9, measuredRuns: 10, rate: 0.9 },
    cost: { usdPerRun: 0.21, basis: 'observed' },
    knownLimitations: [],
    ...overrides,
  };
}

test('referred-choice contracts reject raw evidence and score-only cards', () => {
  assert.equal(referredChoiceSchema.safeParse(referredChoice()).success, true);
  assert.equal(
    referredChoiceSchema.safeParse({ ...referredChoice(), rawEvidence: [{ case: 'secret' }] })
      .success,
    false,
  );
  assert.equal(
    referredChoiceSchema.safeParse({
      publicationId: ids[0],
      subjectKind: 'agent',
      name: 'Score-only card',
      version: '1.0.0',
      match: referredChoice().match,
    }).success,
    false,
  );
  assert.equal(
    referredChoiceSchema.safeParse({
      ...referredChoice(),
      trustChip: { ...trustChip, evidenceRows: [] },
    }).success,
    false,
  );
});

test('hybrid scoring is exactly 70/30 and missing embeddings are labelled structured-only', () => {
  const requested = profile();
  const offered = profile({ tasks: ['triage records'], tools: [] });
  const fallback = scoreCapabilityMatch(requested, offered);
  assert.equal(fallback.match.mode, 'structured_only_fallback');
  assert.equal(fallback.match.label, 'Structured-only fallback');
  assert.equal(fallback.match.score, fallback.match.structuredCoverage);

  const hybrid = scoreCapabilityMatch(requested, offered, {
    requested: [1, 0],
    offered: [0.5, Math.sqrt(0.75)],
  });
  assert.ok(Math.abs(hybrid.match.embeddingCosine - 0.5) < 1e-12);
  assert.ok(
    Math.abs(
      hybrid.match.score -
        (0.7 * hybrid.match.structuredCoverage + 0.3 * hybrid.match.embeddingCosine * 100),
    ) < 1e-12,
  );
});

test('feature-hash fallback is deterministic and provider policy fails closed for direct providers', async () => {
  const input = { text: 'Triage governed records', featureKeys: ['tasks:triage records'] };
  assert.deepEqual(
    deterministicFeatureHashEmbedding(input, 32),
    deterministicFeatureHashEmbedding(input, 32),
  );
  const fallback = new DeterministicFeatureHashEmbeddingProvider(32);
  assert.deepEqual(
    await embedWithProviderPolicy(fallback, 'gateway_only', input),
    deterministicFeatureHashEmbedding(input, 32),
  );
  const direct = {
    kind: 'direct',
    version: '1',
    model: 'external',
    dimensions: 8,
    embed: async () => Array(8).fill(1),
  };
  await assert.rejects(
    embedWithProviderPolicy(direct, 'gateway_only', input),
    /gateway_only denies the direct embedding provider/,
  );
});

test('transactional index events are deterministic/idempotent and reject invalid tombstones', () => {
  const retired = publication(0, { retiredAt: now });
  const resource = buildCatalogIndexResource(retired, now, null);
  const input = { id: ids[39], operation: 'remove', resource, occurredAt: now };
  const first = createCatalogIndexOutboxEvent(input);
  const second = createCatalogIndexOutboxEvent(input);
  assert.deepEqual(first, second);
  assert.equal(first.idempotencyKey, `catalog-index:${retired.id}:1:remove`);
  assert.equal(
    catalogIndexOutboxEventSchema.safeParse({
      ...first,
      resource: { ...first.resource, retired: false },
    }).success,
    false,
  );
});

test('build-new reason semantics use a strict greater-than-80 threshold and capture observation', () => {
  const base = {
    id: ids[0],
    intakeId: ids[1],
    decidedBy: 'builder@example.invalid',
    action: 'build_new',
    selectedPublicationId: null,
    buildNewReason: null,
    demandObservationId: null,
    decidedAt: now,
  };
  assert.equal(
    builderDecisionSchema.safeParse({ ...base, highestReferredMatchScore: 80 }).success,
    true,
  );
  assert.equal(
    builderDecisionSchema.safeParse({ ...base, highestReferredMatchScore: 80.0001 }).success,
    false,
  );
  assert.equal(
    builderDecisionSchema.safeParse({
      ...base,
      highestReferredMatchScore: 91,
      buildNewReason: 'The governed option cannot satisfy the required approval boundary.',
      demandObservationId: ids[2],
    }).success,
    true,
  );
});

test('composition suggestions are deterministic, certified, delta-rich, and capped at five', () => {
  const requested = profile({
    tasks: ['triage records', 'rank follow-up', 'draft escalation', 'check policy'],
  });
  const skills = Array.from({ length: 8 }, (_, index) =>
    publication(index, {
      capabilityProfile: profile({ tasks: [requested.tasks[index % requested.tasks.length]] }),
    }),
  );
  const first = suggestSkillCompositions(requested, skills, {
    maxSuggestions: 50,
    maxSkills: 4,
  });
  const second = suggestSkillCompositions(requested, [...skills].reverse(), {
    maxSuggestions: 50,
    maxSkills: 4,
  });
  assert.deepEqual(first, second);
  assert.ok(first.length <= 5);
  assert.equal(compositionSuggestionsSchema.safeParse(first).success, true);
  assert.equal(compositionSuggestionsSchema.safeParse([...first, ...first]).success, false);
  assert.ok(first.every((suggestion) => suggestion.skills.every((skill) => skill.trustChip)));
  assert.ok(first.every((suggestion) => suggestion.delta.has.length > 0));
});

test('configuration revisions and lineage enforce immutable append-only graph semantics', () => {
  const first = {
    id: ids[0],
    deploymentId: ids[1],
    revision: 1,
    previousRevisionId: null,
    configuration: { timezone: 'UTC' },
    digest,
    createdBy: 'builder@example.invalid',
    createdAt: now,
  };
  const second = {
    ...first,
    id: ids[2],
    revision: 2,
    previousRevisionId: first.id,
    configuration: { timezone: 'America/New_York' },
  };
  assert.doesNotThrow(() => assertConfigurationRevisionAppendOnly(first, second));
  assert.equal(configurationRevisionSchema.safeParse({ ...first, updatedAt: now }).success, false);
  assert.throws(
    () => assertConfigurationRevisionAppendOnly(first, { ...second, revision: 3 }),
    /increment by exactly one/,
  );

  const edge = (id, child, parent) => ({
    id,
    childResourceVersionId: child,
    parentResourceVersionId: parent,
    relationship: 'forked_from',
    ordinal: null,
    decisionId: ids[20],
    createdBy: 'builder@example.invalid',
    createdAt: now,
  });
  assert.equal(resourceLineageSchema.safeParse(edge(ids[3], ids[4], ids[4])).success, false);
  assert.throws(
    () =>
      assertAcyclicResourceLineage([edge(ids[3], ids[4], ids[5]), edge(ids[6], ids[5], ids[4])]),
    /acyclic/,
  );
});

test('isolated route and operation identifiers are stable, unique, and v1-scoped', () => {
  const routes = Object.values(REUSE_V1_ROUTES);
  const operations = Object.values(REUSE_OPENAPI_OPERATION_IDS);
  assert.ok(routes.every((route) => route.startsWith('/v1/')));
  assert.equal(new Set(routes).size, routes.length);
  assert.equal(new Set(operations).size, operations.length);
});
