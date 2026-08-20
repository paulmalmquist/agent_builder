import assert from 'node:assert/strict';
import { test } from 'node:test';
import { roadmapProgramSchema, roadmapResourceSpecSchema } from '../dist/index.js';

const digest = 'a'.repeat(64);
const programIdentity = {
  id: 'personal_two_fork_roadmaps',
  title: 'Roadmaps',
  description: 'Two governed workflow branches; missing source coverage remains unavailable.',
  synthetic: true,
  timeline: {
    startAt: '2026-08-01T00:00:00Z',
    endAt: '2027-01-31T23:59:59Z',
  },
};

function forkDefinition(index) {
  const id = index === 1 ? 'fork_primary' : 'fork_alternate';
  return {
    id,
    label: `Roadmap fork 0${index}`,
    purpose: `Neutral transfer slot ${index}.`,
    status: 'watch',
    jira: {
      state: 'awaiting_transfer',
      projectKey: null,
      filterId: null,
      includedIssueCount: null,
      totalIssueCount: null,
      lastSyncedAt: null,
    },
    metrics: [
      {
        id: `${id}_progress`,
        label: 'Progress',
        value: '40%',
        detail: 'Synthetic interaction fixture.',
        state: 'watch',
        source: 'synthetic',
      },
    ],
    workstreams: [
      {
        id: `${id}_work`,
        label: 'Delivery path',
        startAt: '2026-08-04T00:00:00Z',
        endAt: '2026-09-18T00:00:00Z',
        state: 'planned',
        source: 'synthetic',
      },
    ],
    actions: [],
  };
}

function relationshipCoverage() {
  return {
    vertical: { state: 'unmapped', detail: 'No vertical mapping is declared.' },
    aimGroup: { state: 'unmapped', detail: 'No AIM mapping is declared.' },
    contributingAgents: { state: 'unmapped', detail: 'No Agent mapping is declared.' },
    executionRuns: { state: 'unavailable', detail: 'No runtime binding is available.' },
  };
}

function dependency(index, kind = 'KnowledgeSource') {
  return {
    id: 'dependency_planning_source',
    role: 'source',
    provenance: 'synthetic',
    target: {
      resourceVersionId: `32000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      familyId: '80000000-0000-4000-8000-000000000001',
      kind,
      slug: 'planning-fixture',
      name: 'Planning fixture',
      version: '1.1.0',
      digest,
    },
  };
}

function resource(index) {
  return {
    resourceVersionId: `33000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    familyId: `31000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    kind: 'Roadmap',
    slug: `roadmap-fork-0${index}`,
    name: `Roadmap fork 0${index}`,
    version: '1.0.0',
    lifecycle: 'candidate',
    digest,
    sourceCommit: 'contract-test',
    provenance: { kind: 'synthetic' },
  };
}

function apiFork(index) {
  return {
    ...forkDefinition(index),
    source: 'synthetic',
    resource: resource(index),
    definitionDependencies: [dependency(index)],
    relationships: [],
    relationshipCoverage: relationshipCoverage(),
  };
}

function apiProgram() {
  return {
    schemaVersion: 'roadmaps.program/v2',
    ...programIdentity,
    forks: [apiFork(1), apiFork(2)],
  };
}

function manifestSpec() {
  return {
    schemaVersion: 'roadmap.fork/v1',
    program: programIdentity,
    fork: forkDefinition(1),
    definitionDependencies: [
      {
        id: 'dependency_planning_source',
        role: 'source',
        provenance: 'synthetic',
        target: {
          familyId: '80000000-0000-4000-8000-000000000001',
          version: '1.1.0',
        },
      },
    ],
    relationships: [],
    relationshipCoverage: relationshipCoverage(),
  };
}

test('the API contract requires exactly two honest governed roadmap forks', () => {
  const parsed = roadmapProgramSchema.parse(apiProgram());
  assert.equal(parsed.schemaVersion, 'roadmaps.program/v2');
  assert.equal(parsed.title, 'Roadmaps');
  assert.equal(parsed.forks.length, 2);
  assert.ok(parsed.forks.every((fork) => fork.relationships.length === 0));
  assert.ok(
    parsed.forks.every((fork) => fork.relationshipCoverage.executionRuns.state === 'unavailable'),
  );
});

test('awaiting-transfer metrics cannot masquerade as measurements', () => {
  const input = apiProgram();
  input.forks[0].metrics[0] = {
    ...input.forks[0].metrics[0],
    source: 'awaiting_transfer',
    value: '82%',
  };
  assert.equal(roadmapProgramSchema.safeParse(input).success, false);
});

test('tracked relationship evidence must resolve through a declared exact dependency', () => {
  const input = manifestSpec();
  input.relationships.push({
    id: 'edge_primary_vertical',
    direction: 'outbound',
    predicate: 'scoped_to_vertical',
    target: {
      kind: 'vertical',
      namespace: 'home.vertical',
      schemaVersion: 'v1',
      id: 'group_factory',
    },
    provenance: 'declared',
    sourceRef: {
      definitionDependencyId: 'dependency_missing',
      locator: 'fixture://roadmaps#vertical',
    },
  });
  input.relationshipCoverage.vertical.state = 'mapped';
  assert.equal(roadmapResourceSpecSchema.safeParse(input).success, false);
});

test('tracked manifests reject operational execution-run edges', () => {
  const input = manifestSpec();
  input.relationships.push({
    id: 'edge_primary_run',
    direction: 'outbound',
    predicate: 'produced_execution_run',
    target: { kind: 'execution_run', id: '41000000-0000-4000-8000-000000000001' },
    provenance: 'live',
    sourceRef: {
      definitionDependencyId: 'dependency_planning_source',
      locator: 'fixture://roadmaps#run',
    },
  });
  assert.equal(roadmapResourceSpecSchema.safeParse(input).success, false);
});

test('mapped coverage requires a matching typed directional edge', () => {
  const input = manifestSpec();
  input.relationshipCoverage.aimGroup.state = 'mapped';
  assert.equal(roadmapResourceSpecSchema.safeParse(input).success, false);
});

test('resolved resource edges require the enclosing source and an exact dependency target', () => {
  const input = apiProgram();
  const fork = input.forks[0];
  const exactAgent = {
    resourceVersionId: '41000000-0000-4000-8000-000000000001',
    familyId: '80000000-0000-4000-8000-000000000001',
    kind: 'Agent',
    slug: 'planning-agent',
    name: 'Planning agent',
    version: '1.1.0',
    digest,
  };
  fork.definitionDependencies[0] = {
    ...fork.definitionDependencies[0],
    target: exactAgent,
  };
  fork.relationships.push({
    id: 'edge_primary_agent',
    direction: 'outbound',
    predicate: 'contributed_to_by_agent',
    source: fork.resource,
    target: { ...exactAgent, kind: 'resource_version', resourceKind: 'Agent' },
    provenance: 'declared',
    sourceRef: {
      definitionDependencyId: 'dependency_planning_source',
      locator: 'fixture://roadmaps#agent',
    },
  });
  fork.relationshipCoverage.contributingAgents.state = 'mapped';
  assert.equal(roadmapProgramSchema.safeParse(input).success, true);

  fork.relationships[0].source = resource(2);
  assert.equal(roadmapProgramSchema.safeParse(input).success, false);
});

test('synthetic or absent Jira populations cannot claim live or on-track state', () => {
  const input = apiProgram();
  input.forks[0].metrics[0].source = 'live';
  assert.equal(roadmapProgramSchema.safeParse(input).success, false);

  const absent = apiProgram();
  absent.forks[0].status = 'on_track';
  assert.equal(roadmapProgramSchema.safeParse(absent).success, false);
});
