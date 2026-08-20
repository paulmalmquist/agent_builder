import { roadmapProgramSchema, type RoadmapFork } from '@agent-builder/contracts';

const digest = 'a'.repeat(64);

function resource(index: number, forkId: string) {
  return {
    resourceVersionId: `33000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    familyId: `31000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    kind: 'Roadmap' as const,
    slug: `roadmap-fork-0${index}`,
    name: `Roadmap fork 0${index}`,
    version: '1.0.0',
    lifecycle: 'candidate' as const,
    digest,
    sourceCommit: 'roadmap-test-fixture',
    provenance: { kind: 'synthetic', sourceRef: `fixture://${forkId}` },
  };
}

function definitionDependencies(index: number): RoadmapFork['definitionDependencies'] {
  const targetId = (offset: number) =>
    `32000000-0000-4000-8000-${String(index * 10 + offset).padStart(12, '0')}`;
  return [
    {
      id: 'dependency_project_boundary',
      role: 'project_boundary',
      provenance: 'synthetic',
      target: {
        resourceVersionId: targetId(1),
        familyId: '30000000-0000-4000-8000-000000000001',
        kind: 'Project',
        slug: 'personal-operations',
        name: 'Personal operations',
        version: '1.1.0',
        digest,
      },
    },
    {
      id: 'dependency_console_protocol',
      role: 'protocol',
      provenance: 'synthetic',
      target: {
        resourceVersionId: targetId(2),
        familyId: '70000000-0000-4000-8000-000000000002',
        kind: 'Protocol',
        slug: 'console-grammar',
        name: 'Console grammar',
        version: '1.3.0',
        digest,
      },
    },
    {
      id: 'dependency_planning_source',
      role: 'source',
      provenance: 'synthetic',
      target: {
        resourceVersionId: targetId(3),
        familyId: '80000000-0000-4000-8000-000000000001',
        kind: 'KnowledgeSource',
        slug: 'planning-fixture',
        name: 'Planning fixture',
        version: '1.1.0',
        digest,
      },
    },
  ];
}

function fork(
  index: number,
  id: 'fork_primary' | 'fork_alternate',
  input: {
    status: RoadmapFork['status'];
    workstreams: RoadmapFork['workstreams'];
    metricValues: readonly [string, string, string];
    actions: RoadmapFork['actions'];
  },
): RoadmapFork {
  const label = `Roadmap fork 0${index}`;
  const prefix = id;
  return {
    id,
    label,
    purpose: `Neutral transfer slot for private workflow ${index} and its Jira history.`,
    status: input.status,
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
        id: `${prefix}_progress`,
        label: 'Resolved scope',
        value: input.metricValues[0],
        detail: 'Synthetic shape only; Jira history replaces this sample after transfer.',
        state: index === 1 ? 'watch' : 'at_risk',
        source: 'synthetic',
      },
      {
        id: `${prefix}_blocked`,
        label: 'Blocked work',
        value: input.metricValues[1],
        detail: 'Synthetic count shaped like Jira issue-link data.',
        state: 'at_risk',
        source: 'synthetic',
      },
      {
        id: `${prefix}_cycle`,
        label: 'Median cycle time',
        value: input.metricValues[2],
        detail: 'Synthetic changelog-derived duration, not a live measurement.',
        state: index === 1 ? 'watch' : 'at_risk',
        source: 'synthetic',
      },
    ],
    workstreams: input.workstreams,
    actions: input.actions,
    source: 'synthetic',
    resource: resource(index, id),
    definitionDependencies: definitionDependencies(index),
    relationships: [],
    relationshipCoverage: {
      vertical: {
        state: 'unmapped',
        detail: 'No governed Jira-to-vertical mapping is present on this machine.',
      },
      aimGroup: {
        state: 'unmapped',
        detail: 'No exact AIM group mapping is declared for this neutral fork.',
      },
      contributingAgents: {
        state: 'unmapped',
        detail: 'No exact-version contributing Agent is declared for this neutral fork.',
      },
      executionRuns: {
        state: 'unavailable',
        detail: 'Run links require a live runtime binding and are never inferred.',
      },
    },
  };
}

export const roadmapProgramFixture = roadmapProgramSchema.parse({
  schemaVersion: 'roadmaps.program/v2',
  id: 'personal_two_fork_roadmaps',
  title: 'Roadmaps',
  description:
    'Compare two private Jira-backed workflow branches through neutral transfer slots; absent bindings remain unavailable.',
  synthetic: true,
  timeline: {
    startAt: '2026-08-01T00:00:00Z',
    endAt: '2027-01-31T23:59:59Z',
  },
  forks: [
    fork(1, 'fork_primary', {
      status: 'watch',
      metricValues: ['42%', '5', '8.4 d'],
      workstreams: [
        {
          id: 'fork_primary_discovery',
          label: 'Baseline and discovery',
          startAt: '2026-08-04T00:00:00Z',
          endAt: '2026-09-18T00:00:00Z',
          state: 'complete',
          source: 'synthetic',
        },
        {
          id: 'fork_primary_delivery',
          label: 'Primary delivery path',
          startAt: '2026-09-08T00:00:00Z',
          endAt: '2026-11-20T00:00:00Z',
          state: 'in_work',
          source: 'synthetic',
        },
        {
          id: 'fork_primary_acceptance',
          label: 'Acceptance and rollout',
          startAt: '2026-11-03T00:00:00Z',
          endAt: '2027-01-16T00:00:00Z',
          state: 'planned',
          source: 'synthetic',
        },
      ],
      actions: [
        {
          id: 'fork_primary_mapping',
          label: 'Bind Jira components to governed verticals',
          consequence: 'Cross-vertical progress remains unavailable until mapped.',
          dueAt: null,
          owner: 'Roadmap owner 01',
          state: 'next',
          source: 'synthetic',
        },
        {
          id: 'fork_primary_dependency',
          label: 'Resolve the oldest cross-team dependency',
          consequence: 'The representative critical path remains on watch.',
          dueAt: '2026-08-22T17:00:00-04:00',
          owner: 'Roadmap owner 01',
          state: 'blocked',
          source: 'synthetic',
        },
      ],
    }),
    fork(2, 'fork_alternate', {
      status: 'at_risk',
      metricValues: ['31%', '9', '12.1 d'],
      workstreams: [
        {
          id: 'fork_alternate_discovery',
          label: 'Alternate-path discovery',
          startAt: '2026-08-04T00:00:00Z',
          endAt: '2026-09-30T00:00:00Z',
          state: 'in_work',
          source: 'synthetic',
        },
        {
          id: 'fork_alternate_delivery',
          label: 'Alternate delivery path',
          startAt: '2026-09-22T00:00:00Z',
          endAt: '2026-12-18T00:00:00Z',
          state: 'at_risk',
          source: 'synthetic',
        },
        {
          id: 'fork_alternate_acceptance',
          label: 'Acceptance and rollout',
          startAt: '2026-12-01T00:00:00Z',
          endAt: '2027-01-29T00:00:00Z',
          state: 'planned',
          source: 'synthetic',
        },
      ],
      actions: [
        {
          id: 'fork_alternate_mapping',
          label: 'Bind the second Jira filter and changelog',
          consequence: 'Scope, aging, and forecast confidence remain unavailable.',
          dueAt: null,
          owner: 'Roadmap owner 02',
          state: 'next',
          source: 'synthetic',
        },
        {
          id: 'fork_alternate_scope',
          label: 'Decide whether discovered scope stays in this fork',
          consequence: 'The representative finish date continues to drift.',
          dueAt: '2026-08-21T17:00:00-04:00',
          owner: 'Roadmap owner 02',
          state: 'decision',
          source: 'synthetic',
        },
      ],
    }),
  ],
});
