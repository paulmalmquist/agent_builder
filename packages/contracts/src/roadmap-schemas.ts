import { z } from 'zod';

export const roadmapSourceStateSchema = z.enum(['live', 'synthetic', 'awaiting_transfer']);
export type RoadmapSourceState = z.infer<typeof roadmapSourceStateSchema>;

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

export const roadmapForkSchema = z
  .object({
    id: z.string().regex(/^fork_[a-z0-9_]+$/),
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
  .strict()
  .superRefine((fork, context) => {
    if (fork.status === 'on_track' && fork.jira.state !== 'live') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Only a live Jira population can support an on-track fork status',
        path: ['status'],
      });
    }
  });

export type RoadmapFork = z.infer<typeof roadmapForkSchema>;

export const roadmapProgramSchema = z
  .object({
    schemaVersion: z.literal('roadmaps.program/v1'),
    title: z.string().min(1).max(160),
    description: z.string().min(1).max(500),
    synthetic: z.boolean(),
    timeline: z
      .object({
        startAt: z.string().datetime({ offset: true }),
        endAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    forks: z.array(roadmapForkSchema).length(2),
  })
  .strict()
  .superRefine((program, context) => {
    const programStart = Date.parse(program.timeline.startAt);
    const programEnd = Date.parse(program.timeline.endAt);
    if (programEnd <= programStart) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Timeline endAt must be after startAt',
        path: ['timeline', 'endAt'],
      });
    }

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
