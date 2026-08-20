import { z } from 'zod';
import {
  resourceDependencySchema,
  resourceKindSchema,
  resourceLifecycleSchema,
} from './platform-schemas.js';
import { jsonValueSchema, uuidSchema } from './schemas.js';

const semanticVersionSchema = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  .max(80);
const sourceLocatorSchema = z.string().trim().min(1).max(500);
const roadmapForkIdSchema = z.string().regex(/^fork_[a-z0-9_]+$/);

export const roadmapSourceStateSchema = z.enum(['live', 'synthetic', 'awaiting_transfer']);
export type RoadmapSourceState = z.infer<typeof roadmapSourceStateSchema>;

export const roadmapEdgeProvenanceSchema = z.enum(['live', 'declared', 'synthetic']);
export type RoadmapEdgeProvenance = z.infer<typeof roadmapEdgeProvenanceSchema>;

const roadmapTimelineItemSchema = z
  .object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(160),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    state: z.enum(['complete', 'in_work', 'planned', 'at_risk']),
    source: roadmapSourceStateSchema,
  })
  .strict()
  .superRefine((item, context) => {
    if (Date.parse(item.endAt) <= Date.parse(item.startAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endAt must be after startAt',
        path: ['endAt'],
      });
    }
  });

const roadmapMetricSchema = z
  .object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(160),
    value: z.string().min(1).max(80).nullable(),
    detail: z.string().min(1).max(360),
    state: z.enum(['nominal', 'watch', 'at_risk', 'unavailable']),
    source: roadmapSourceStateSchema,
  })
  .strict()
  .superRefine((metric, context) => {
    if (metric.source === 'awaiting_transfer' && metric.value !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Awaiting-transfer metrics cannot carry a measured value',
        path: ['value'],
      });
    }
    if (metric.source !== 'awaiting_transfer' && metric.value === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Measured metrics require a value',
        path: ['value'],
      });
    }
  });

const roadmapActionSchema = z
  .object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(180),
    consequence: z.string().min(1).max(360),
    dueAt: z.string().datetime({ offset: true }).nullable(),
    owner: z.string().min(1).max(120),
    state: z.enum(['decision', 'blocked', 'next']),
    source: roadmapSourceStateSchema,
  })
  .strict();

const roadmapForkDefinitionObjectSchema = z
  .object({
    id: roadmapForkIdSchema,
    label: z.string().min(1).max(120),
    purpose: z.string().min(1).max(360),
    status: z.enum(['on_track', 'watch', 'at_risk', 'unavailable']),
    jira: z
      .object({
        state: z.enum(['awaiting_transfer', 'configured', 'live']),
        projectKey: z.string().min(1).max(32).nullable(),
        filterId: z.string().min(1).max(80).nullable(),
        includedIssueCount: z.number().int().nonnegative().nullable(),
        totalIssueCount: z.number().int().nonnegative().nullable(),
        lastSyncedAt: z.string().datetime({ offset: true }).nullable(),
      })
      .strict()
      .superRefine((jira, context) => {
        if (jira.state === 'awaiting_transfer') {
          const hasRuntimeValue =
            jira.includedIssueCount !== null ||
            jira.totalIssueCount !== null ||
            jira.lastSyncedAt !== null;
          if (hasRuntimeValue) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'An awaiting-transfer Jira binding cannot claim runtime coverage or sync',
            });
          }
          if (jira.projectKey !== null || jira.filterId !== null) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'An awaiting-transfer Jira binding cannot carry private identifiers',
            });
          }
        }
        if (
          jira.includedIssueCount !== null &&
          jira.totalIssueCount !== null &&
          jira.includedIssueCount > jira.totalIssueCount
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'includedIssueCount cannot exceed totalIssueCount',
            path: ['includedIssueCount'],
          });
        }
        if (
          jira.state !== 'awaiting_transfer' &&
          jira.projectKey === null &&
          jira.filterId === null
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'A configured Jira binding requires an exact project key or filter ID',
          });
        }
        if (
          jira.state === 'configured' &&
          (jira.includedIssueCount !== null ||
            jira.totalIssueCount !== null ||
            jira.lastSyncedAt !== null)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'A configured Jira binding cannot claim a live issue population or sync',
          });
        }
        if (
          jira.state === 'live' &&
          (jira.includedIssueCount === null ||
            jira.totalIssueCount === null ||
            jira.lastSyncedAt === null)
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'A live Jira binding requires coverage counts and a last sync timestamp',
          });
        }
      }),
    metrics: z.array(roadmapMetricSchema).min(1).max(12),
    workstreams: z.array(roadmapTimelineItemSchema).min(1).max(100),
    actions: z.array(roadmapActionSchema).max(25),
  })
  .strict();

function addForkStatusIssue(
  fork: z.infer<typeof roadmapForkDefinitionObjectSchema>,
  context: z.RefinementCtx,
): void {
  if (fork.status === 'on_track' && fork.jira.state !== 'live') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Only a live Jira population can support an on-track fork status',
      path: ['status'],
    });
  }
}

export const roadmapForkDefinitionSchema = roadmapForkDefinitionObjectSchema.superRefine(
  (fork, context) => {
    addForkStatusIssue(fork, context);
  },
);

const roadmapTimelineSchema = z
  .object({
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((timeline, context) => {
    if (Date.parse(timeline.endAt) <= Date.parse(timeline.startAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Timeline endAt must be after startAt',
        path: ['endAt'],
      });
    }
  });

export const roadmapProgramIdentitySchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/)
      .max(120),
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(500),
    synthetic: z.boolean(),
    timeline: roadmapTimelineSchema,
  })
  .strict();

export const roadmapRelationshipPredicateSchema = z.enum([
  'scoped_to_vertical',
  'maps_to_aim_group',
  'contributed_to_by_agent',
  'produced_execution_run',
]);
export type RoadmapRelationshipPredicate = z.infer<typeof roadmapRelationshipPredicateSchema>;

export const roadmapVerticalTargetSchema = z
  .object({
    kind: z.literal('vertical'),
    namespace: z.literal('home.vertical'),
    schemaVersion: z.literal('v1'),
    id: z.string().regex(/^group_[a-z0-9_]+$/),
  })
  .strict();

export const roadmapAimGroupTargetSchema = z
  .object({
    kind: z.literal('aim_group'),
    namespace: z.literal('aim_capability_vehicle'),
    schemaVersion: z.literal('aim.program/v2'),
    id: z.string().regex(/^group_[a-z0-9_]+$/),
  })
  .strict();

export const roadmapResourceTargetSchema = z
  .object({
    kind: z.literal('resource_version'),
    familyId: uuidSchema,
    version: semanticVersionSchema,
  })
  .strict();

const roadmapManifestRelationshipTargetSchema = z.discriminatedUnion('kind', [
  roadmapVerticalTargetSchema,
  roadmapAimGroupTargetSchema,
  roadmapResourceTargetSchema,
]);

export const roadmapRelationshipSourceRefSchema = z
  .object({
    definitionDependencyId: z
      .string()
      .regex(/^dependency_[a-z0-9_]+$/)
      .max(160),
    locator: sourceLocatorSchema,
  })
  .strict();

const predicateMatchesTarget = (
  predicate: z.infer<typeof roadmapRelationshipPredicateSchema>,
  targetKind: z.infer<typeof roadmapManifestRelationshipTargetSchema>['kind'] | 'execution_run',
): boolean =>
  (predicate === 'scoped_to_vertical' && targetKind === 'vertical') ||
  (predicate === 'maps_to_aim_group' && targetKind === 'aim_group') ||
  (predicate === 'contributed_to_by_agent' && targetKind === 'resource_version') ||
  (predicate === 'produced_execution_run' && targetKind === 'execution_run');

export const roadmapManifestRelationshipSchema = z
  .object({
    id: z
      .string()
      .regex(/^edge_[a-z0-9_]+$/)
      .max(160),
    direction: z.literal('outbound'),
    predicate: roadmapRelationshipPredicateSchema.exclude(['produced_execution_run']),
    target: roadmapManifestRelationshipTargetSchema,
    provenance: roadmapEdgeProvenanceSchema,
    sourceRef: roadmapRelationshipSourceRefSchema,
  })
  .strict()
  .superRefine((relationship, context) => {
    if (!predicateMatchesTarget(relationship.predicate, relationship.target.kind)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Roadmap relationship predicate does not match its typed target',
        path: ['target'],
      });
    }
  });

export const roadmapDefinitionDependencySchema = z
  .object({
    id: z
      .string()
      .regex(/^dependency_[a-z0-9_]+$/)
      .max(160),
    role: z.enum(['project_boundary', 'source', 'protocol']),
    target: resourceDependencySchema,
    provenance: roadmapEdgeProvenanceSchema,
  })
  .strict();

const relationshipCoverageValueSchema = z
  .object({
    state: z.enum(['mapped', 'unmapped', 'unavailable']),
    detail: z.string().trim().min(1).max(360),
  })
  .strict();

export const roadmapManifestRelationshipCoverageSchema = z
  .object({
    vertical: relationshipCoverageValueSchema,
    aimGroup: relationshipCoverageValueSchema,
    contributingAgents: relationshipCoverageValueSchema,
    executionRuns: relationshipCoverageValueSchema.extend({ state: z.literal('unavailable') }),
  })
  .strict();

const predicateByCoverageKey = {
  vertical: 'scoped_to_vertical',
  aimGroup: 'maps_to_aim_group',
  contributingAgents: 'contributed_to_by_agent',
  executionRuns: 'produced_execution_run',
} as const;

function addRelationshipCoverageIssues(
  value: {
    relationships: ReadonlyArray<{ predicate: RoadmapRelationshipPredicate }>;
    relationshipCoverage: Record<
      keyof typeof predicateByCoverageKey,
      { state: 'mapped' | 'unmapped' | 'unavailable'; detail: string }
    >;
  },
  context: z.RefinementCtx,
): void {
  for (const [coverageKey, predicate] of Object.entries(predicateByCoverageKey) as Array<
    [
      keyof typeof predicateByCoverageKey,
      (typeof predicateByCoverageKey)[keyof typeof predicateByCoverageKey],
    ]
  >) {
    const hasRelationship = value.relationships.some(
      (relationship) => relationship.predicate === predicate,
    );
    const isMapped = value.relationshipCoverage[coverageKey].state === 'mapped';
    if (hasRelationship !== isMapped) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Relationship coverage for ${coverageKey} must match declared ${predicate} edges`,
        path: ['relationshipCoverage', coverageKey, 'state'],
      });
    }
  }
}

export const roadmapResourceSpecSchema = z
  .object({
    schemaVersion: z.literal('roadmap.fork/v1'),
    program: roadmapProgramIdentitySchema,
    fork: roadmapForkDefinitionSchema,
    definitionDependencies: z.array(roadmapDefinitionDependencySchema).max(20),
    relationships: z.array(roadmapManifestRelationshipSchema).max(50),
    relationshipCoverage: roadmapManifestRelationshipCoverageSchema,
  })
  .strict()
  .superRefine((spec, context) => {
    const dependencyKeys = spec.definitionDependencies.map(
      ({ role, target }) => `${role}:${target.familyId.toLowerCase()}@${target.version}`,
    );
    if (new Set(dependencyKeys).size !== dependencyKeys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Roadmap definition dependencies must be unique by role and exact target',
        path: ['definitionDependencies'],
      });
    }
    const dependencyIds = new Set(spec.definitionDependencies.map(({ id }) => id));
    if (dependencyIds.size !== spec.definitionDependencies.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Roadmap definition dependency IDs must be unique',
        path: ['definitionDependencies'],
      });
    }
    const relationshipIds = spec.relationships.map(({ id }) => id);
    if (new Set(relationshipIds).size !== relationshipIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Roadmap relationship IDs must be unique',
        path: ['relationships'],
      });
    }
    for (const [relationshipIndex, relationship] of spec.relationships.entries()) {
      if (!dependencyIds.has(relationship.sourceRef.definitionDependencyId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Roadmap relationship sourceRef must name an exact definition dependency',
          path: ['relationships', relationshipIndex, 'sourceRef', 'definitionDependencyId'],
        });
      }
    }
    addRelationshipCoverageIssues(spec, context);
  });

export type RoadmapResourceSpec = z.infer<typeof roadmapResourceSpecSchema>;

export const roadmapResourceIdentitySchema = z
  .object({
    resourceVersionId: uuidSchema,
    familyId: uuidSchema,
    kind: z.literal('Roadmap'),
    slug: z.string().min(1).max(160),
    name: z.string().min(1).max(160),
    version: semanticVersionSchema,
    lifecycle: resourceLifecycleSchema,
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    sourceCommit: z.string().min(1).max(160),
    provenance: jsonValueSchema,
  })
  .strict();

const resolvedDefinitionDependencySchema = roadmapDefinitionDependencySchema
  .omit({ target: true })
  .extend({
    target: z
      .object({
        resourceVersionId: uuidSchema,
        familyId: uuidSchema,
        kind: resourceKindSchema,
        slug: z.string().min(1).max(160),
        name: z.string().min(1).max(160),
        version: semanticVersionSchema,
        digest: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict();

const resolvedResourceRelationshipTargetSchema = roadmapResourceTargetSchema
  .omit({ kind: true })
  .extend({
    kind: z.literal('resource_version'),
    resourceVersionId: uuidSchema,
    resourceKind: resourceKindSchema,
    slug: z.string().min(1).max(160),
    name: z.string().min(1).max(160),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const executionRunRelationshipTargetSchema = z
  .object({
    kind: z.literal('execution_run'),
    id: uuidSchema,
  })
  .strict();

const roadmapResolvedRelationshipTargetSchema = z.discriminatedUnion('kind', [
  roadmapVerticalTargetSchema,
  roadmapAimGroupTargetSchema,
  resolvedResourceRelationshipTargetSchema,
  executionRunRelationshipTargetSchema,
]);

export const roadmapRelationshipSchema = z
  .object({
    id: z.string().min(1).max(220),
    direction: z.literal('outbound'),
    predicate: roadmapRelationshipPredicateSchema,
    source: roadmapResourceIdentitySchema,
    target: roadmapResolvedRelationshipTargetSchema,
    provenance: roadmapEdgeProvenanceSchema,
    sourceRef: roadmapRelationshipSourceRefSchema,
  })
  .strict()
  .superRefine((relationship, context) => {
    if (!predicateMatchesTarget(relationship.predicate, relationship.target.kind)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Roadmap relationship predicate does not match its typed target',
        path: ['target'],
      });
    }
    if (
      relationship.predicate === 'contributed_to_by_agent' &&
      relationship.target.kind === 'resource_version' &&
      relationship.target.resourceKind !== 'Agent'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A contributing-agent relationship must resolve an exact Agent resource version',
        path: ['target', 'resourceKind'],
      });
    }
  });

export const roadmapRelationshipCoverageSchema = z
  .object({
    vertical: relationshipCoverageValueSchema,
    aimGroup: relationshipCoverageValueSchema,
    contributingAgents: relationshipCoverageValueSchema,
    executionRuns: relationshipCoverageValueSchema,
  })
  .strict();

export const roadmapForkSchema = roadmapForkDefinitionObjectSchema
  .extend({
    source: roadmapSourceStateSchema,
    resource: roadmapResourceIdentitySchema,
    definitionDependencies: z.array(resolvedDefinitionDependencySchema).max(20),
    relationships: z.array(roadmapRelationshipSchema).max(100),
    relationshipCoverage: roadmapRelationshipCoverageSchema,
  })
  .strict()
  .superRefine((fork, context) => {
    addForkStatusIssue(fork, context);
    addRelationshipCoverageIssues(fork, context);
    const dependencyIds = new Set(fork.definitionDependencies.map(({ id }) => id));
    const relationshipIds = new Set<string>();
    for (const [relationshipIndex, relationship] of fork.relationships.entries()) {
      if (relationshipIds.has(relationship.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Resolved Roadmap relationship IDs must be unique',
          path: ['relationships', relationshipIndex, 'id'],
        });
      }
      relationshipIds.add(relationship.id);
      if (!dependencyIds.has(relationship.sourceRef.definitionDependencyId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Resolved Roadmap relationship sourceRef must name an exact definition dependency',
          path: ['relationships', relationshipIndex, 'sourceRef', 'definitionDependencyId'],
        });
      }
      if (
        relationship.source.resourceVersionId !== fork.resource.resourceVersionId ||
        relationship.source.familyId !== fork.resource.familyId ||
        relationship.source.version !== fork.resource.version ||
        relationship.source.digest !== fork.resource.digest
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Resolved Roadmap relationship source must be the enclosing exact Roadmap resource',
          path: ['relationships', relationshipIndex, 'source'],
        });
      }
      const relationshipTarget = relationship.target;
      if (relationshipTarget.kind === 'resource_version') {
        const exactTarget = fork.definitionDependencies.some(
          ({ target }) =>
            target.resourceVersionId === relationshipTarget.resourceVersionId &&
            target.familyId === relationshipTarget.familyId &&
            target.version === relationshipTarget.version &&
            target.digest === relationshipTarget.digest,
        );
        if (!exactTarget) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              'Resolved Roadmap resource relationship target must be an exact definition dependency',
            path: ['relationships', relationshipIndex, 'target'],
          });
        }
      }
    }
  });

export type RoadmapFork = z.infer<typeof roadmapForkSchema>;

export const roadmapProgramSchema = z
  .object({
    schemaVersion: z.literal('roadmaps.program/v2'),
    id: roadmapProgramIdentitySchema.shape.id,
    title: roadmapProgramIdentitySchema.shape.title,
    description: roadmapProgramIdentitySchema.shape.description,
    synthetic: roadmapProgramIdentitySchema.shape.synthetic,
    timeline: roadmapTimelineSchema,
    forks: z.array(roadmapForkSchema).length(2),
  })
  .strict()
  .superRefine((program, context) => {
    const programStart = Date.parse(program.timeline.startAt);
    const programEnd = Date.parse(program.timeline.endAt);
    const forkIds = new Set<string>();
    for (const [forkIndex, fork] of program.forks.entries()) {
      if (forkIds.has(fork.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Roadmap fork IDs must be unique',
          path: ['forks', forkIndex, 'id'],
        });
      }
      forkIds.add(fork.id);

      const itemIds = new Set<string>();
      for (const [itemIndex, item] of [
        ...fork.metrics,
        ...fork.workstreams,
        ...fork.actions,
      ].entries()) {
        if (itemIds.has(item.id)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'IDs must be unique within a roadmap fork',
            path: ['forks', forkIndex, itemIndex, 'id'],
          });
        }
        itemIds.add(item.id);
      }

      for (const [workstreamIndex, workstream] of fork.workstreams.entries()) {
        if (
          Date.parse(workstream.startAt) < programStart ||
          Date.parse(workstream.endAt) > programEnd
        ) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Workstream falls outside the declared roadmap timeline',
            path: ['forks', forkIndex, 'workstreams', workstreamIndex],
          });
        }
      }

      const hasLiveDerivedItem =
        fork.metrics.some((metric) => metric.source === 'live') ||
        fork.workstreams.some((workstream) => workstream.source === 'live') ||
        fork.actions.some((action) => action.source === 'live');
      const expectedForkSource: RoadmapSourceState = program.synthetic
        ? 'synthetic'
        : fork.jira.state === 'live'
          ? 'live'
          : 'awaiting_transfer';
      if (fork.source !== expectedForkSource) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Fork source must derive from program and Jira binding provenance',
          path: ['forks', forkIndex, 'source'],
        });
      }
      if (program.synthetic && (fork.jira.state === 'live' || hasLiveDerivedItem)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'A synthetic roadmap program cannot produce live Jira-derived state',
          path: ['forks', forkIndex],
        });
      }
      if (fork.jira.state !== 'live' && hasLiveDerivedItem) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Live roadmap state requires a live Jira binding',
          path: ['forks', forkIndex],
        });
      }
    }
  });

export type RoadmapProgram = z.infer<typeof roadmapProgramSchema>;
