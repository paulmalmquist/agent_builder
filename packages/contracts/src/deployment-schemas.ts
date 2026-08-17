import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './schemas.js';

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const semanticVersionSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
const sha256DigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const imageDigestReferenceSchema = z.string().regex(/^[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}$/);
const sourceCommitSchema = z.string().regex(/^[a-f0-9]{7,64}$/);

export const platformDistributionChannelSchema = z.enum(['pilot', 'stable']);
export const platformDistributionStatusSchema = z.enum(['candidate', 'certified', 'retired']);

export const platformDistributionSchema = z
  .object({
    schemaVersion: z.literal('platform.distribution/v1'),
    id: uuidSchema,
    slug: slugSchema,
    version: semanticVersionSchema,
    channel: platformDistributionChannelSchema,
    status: platformDistributionStatusSchema,
    releaseBundleId: uuidSchema,
    releaseDigest: sha256DigestSchema,
    sourceCommit: sourceCommitSchema,
    chart: z
      .object({
        name: z.literal('paul-os'),
        version: semanticVersionSchema,
        digest: sha256DigestSchema,
      })
      .strict(),
    images: z
      .object({
        backend: imageDigestReferenceSchema,
        frontend: imageDigestReferenceSchema,
        worker: imageDigestReferenceSchema,
        migrator: imageDigestReferenceSchema,
      })
      .strict(),
    publishedAt: isoDateTimeSchema.nullable(),
    rollbackDistributionId: uuidSchema.nullable(),
    proposalOnly: z.boolean(),
  })
  .strict()
  .superRefine((distribution, context) => {
    if (distribution.status === 'certified' && distribution.publishedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['publishedAt'],
        message: 'Certified distributions require a publication timestamp',
      });
    }
    if (distribution.rollbackDistributionId === distribution.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rollbackDistributionId'],
        message: 'A distribution cannot roll back to itself',
      });
    }
  });

export const starterPackManifestSchema = z
  .object({
    schemaVersion: z.literal('starter-pack/v1'),
    id: uuidSchema,
    slug: slugSchema,
    name: z.string().trim().min(3).max(160),
    departmentKey: slugSchema,
    owner: z.string().trim().min(2).max(160),
    version: semanticVersionSchema,
    synthetic: z.boolean(),
    referredReleases: z
      .array(
        z
          .object({
            releaseBundleId: uuidSchema,
            releaseDigest: sha256DigestSchema,
          })
          .strict(),
      )
      .max(20),
    pluginPacks: z
      .array(
        z
          .object({
            familyId: uuidSchema,
            version: semanticVersionSchema,
            digest: sha256DigestSchema,
          })
          .strict(),
      )
      .max(20),
    defaultAuthorityPolicy: z
      .object({
        selfApprovableEffects: z.array(z.literal('read')).max(1),
        maximumValidityDays: z.number().int().min(1).max(90),
        maximumRunCount: z.number().int().min(1).max(10_000),
        maximumCostUsd: z.number().nonnegative().max(100_000),
      })
      .strict(),
    subscriptions: z
      .array(
        z
          .object({
            kind: z.literal('daily_brief'),
            localTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
            timezone: z.string().trim().min(1).max(100),
            freshnessWindowSeconds: z.number().int().min(60).max(86_400),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

export const adoptionAggregateSchema = z
  .object({
    schemaVersion: z.literal('adoption.aggregate/v1'),
    id: uuidSchema,
    workspaceId: uuidSchema,
    departmentId: uuidSchema,
    periodStartedAt: isoDateTimeSchema,
    periodEndedAt: isoDateTimeSchema,
    generatedAt: isoDateTimeSchema,
    aggregation: z.literal('department'),
    containsIndividualRankings: z.literal(false),
    metrics: z
      .object({
        weeklyActiveUsers: z.number().int().nonnegative(),
        referredChoiceAcceptanceRate: z.number().min(0).max(1).nullable(),
        timeToFirstApprovedRunP50Minutes: z.number().nonnegative().nullable(),
        zeroEscalationRate: z.number().min(0).max(1).nullable(),
        costUsd: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict()
  .superRefine((aggregate, context) => {
    if (Date.parse(aggregate.periodEndedAt) <= Date.parse(aggregate.periodStartedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['periodEndedAt'],
        message: 'Aggregate period must end after it starts',
      });
    }
    if (Date.parse(aggregate.generatedAt) < Date.parse(aggregate.periodEndedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['generatedAt'],
        message: 'Aggregate cannot be generated before its period ends',
      });
    }
  });

export type PlatformDistribution = z.infer<typeof platformDistributionSchema>;
export type StarterPackManifest = z.infer<typeof starterPackManifestSchema>;
export type AdoptionAggregate = z.infer<typeof adoptionAggregateSchema>;
