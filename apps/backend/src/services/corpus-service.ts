import { createHash } from 'node:crypto';
import {
  EvalCaseSource as DatabaseEvalCaseSource,
  EvalCaseTag as DatabaseEvalCaseTag,
  Prisma,
  type EvalCase as DatabaseEvalCase,
  type PrismaClient,
} from '@prisma/client';
import {
  createEvalCaseRequestSchema,
  evalCaseListResponseSchema,
  evalCaseSchema,
  evalCorpusVersionSchema,
  type evalCaseListQuerySchema,
  deactivateEvalCaseRequestSchema,
  jsonObjectSchema,
  jsonValueSchema,
  publishEvalCorpusRequestSchema,
  type EvalCase,
} from '@agent-builder/contracts';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { canonicalizeCertificationJson } from '../certification/executor.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { aggregateScope, aggregateScopeWhere } from '../scope.js';
import { requireHumanActor } from './actors.js';
import type { CorpusApi } from './types.js';

const citationArraySchema = z.array(z.string());
const tagMap = {
  golden: DatabaseEvalCaseTag.GOLDEN,
  replay: DatabaseEvalCaseTag.REPLAY,
  false_alarm: DatabaseEvalCaseTag.FALSE_ALARM,
  regression: DatabaseEvalCaseTag.REGRESSION,
} as const;
const sourceMap = {
  override: DatabaseEvalCaseSource.OVERRIDE,
  incident: DatabaseEvalCaseSource.INCIDENT,
} as const;
const querySourceMap = {
  seed: DatabaseEvalCaseSource.SEED,
  ...sourceMap,
} as const;

export function toEvalCase(record: DatabaseEvalCase): EvalCase {
  return evalCaseSchema.parse({
    id: record.id,
    key: record.key,
    name: record.name,
    input: parseJson(jsonValueSchema, record.input, `EvalCase(${record.id}).input`),
    expectedOutput: parseJson(
      jsonValueSchema,
      record.expectedOutput,
      `EvalCase(${record.id}).expectedOutput`,
    ),
    expectedCitations: parseJson(
      citationArraySchema,
      record.expectedCitations,
      `EvalCase(${record.id}).expectedCitations`,
    ),
    tags: record.tags.map((tag) => tag.toLowerCase()),
    source: record.source.toLowerCase(),
    active: record.active,
    provenance: parseJson(jsonObjectSchema, record.provenance, `EvalCase(${record.id}).provenance`),
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
    deactivatedAt: record.deactivatedAt?.toISOString() ?? null,
    deactivatedBy: record.deactivatedBy,
    deactivationRationale: record.deactivationRationale,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  });
}

const contentHash = (cases: readonly EvalCase[]): string =>
  createHash('sha256')
    .update(
      canonicalizeCertificationJson(
        cases.map((item) => ({
          id: item.id,
          key: item.key,
          input: item.input,
          expectedOutput: item.expectedOutput,
          expectedCitations: item.expectedCitations,
          tags: item.tags,
        })),
      ),
    )
    .digest('hex');

export class CorpusService implements CorpusApi {
  constructor(private readonly prisma: PrismaClient) {}

  async listCases(query: z.infer<typeof evalCaseListQuerySchema>) {
    let corpusCaseIds: string[] | undefined;
    if (query.corpusVersion !== undefined) {
      const corpus = await this.prisma.evalCorpusVersion.findFirst({
        where: { version: query.corpusVersion, ...aggregateScopeWhere() },
        include: { memberships: { select: { caseId: true } } },
      });
      if (!corpus)
        throw new AppError(
          404,
          'EVAL_CORPUS_NOT_FOUND',
          'Evaluation corpus version was not found',
          { version: query.corpusVersion },
        );
      corpusCaseIds = corpus.memberships.map(({ caseId }) => caseId);
    }
    const records = await this.prisma.evalCase.findMany({
      where: {
        ...aggregateScopeWhere(),
        ...(query.tag === undefined ? {} : { tags: { has: tagMap[query.tag] } }),
        ...(query.source === undefined ? {} : { source: querySourceMap[query.source] }),
        ...(query.active === undefined ? {} : { active: query.active === 'true' }),
        ...(corpusCaseIds === undefined ? {} : { id: { in: corpusCaseIds } }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      take: query.limit + 1,
    });
    const hasNext = records.length > query.limit;
    if (hasNext) records.pop();
    return evalCaseListResponseSchema.parse({
      items: records.map(toEvalCase),
      nextCursor: hasNext ? (records.at(-1)?.id ?? null) : null,
    });
  }

  async createCase(rawInput: z.infer<typeof createEvalCaseRequestSchema>) {
    const input = createEvalCaseRequestSchema.parse(rawInput);
    const actorId = requireHumanActor();
    const scope = aggregateScope();
    return this.prisma.$transaction(async (transaction) => {
      const created = await transaction.evalCase.create({
        data: {
          ...scope,
          key: input.key,
          name: input.name,
          input: toPrismaJson(jsonValueSchema, input.input, `EvalCase(${input.key}).input`),
          expectedOutput: toPrismaJson(
            jsonValueSchema,
            input.expectedOutput,
            `EvalCase(${input.key}).expectedOutput`,
          ),
          expectedCitations: toPrismaJson(
            citationArraySchema,
            input.expectedCitations,
            `EvalCase(${input.key}).expectedCitations`,
          ),
          tags: input.tags.map((tag) => tagMap[tag]),
          source: sourceMap[input.source],
          provenance: toPrismaJson(
            z.record(jsonValueSchema),
            input.provenance,
            `EvalCase(${input.key}).provenance`,
          ),
          createdBy: actorId,
          updatedBy: actorId,
        },
      });
      await appendAuditEvent(transaction, {
        action: 'eval_case.created',
        entityType: 'EvalCase',
        entityId: created.id,
        details: { key: created.key, source: input.source, tags: input.tags },
      });
      return toEvalCase(created);
    });
  }

  async deactivateCase(caseId: string, input: { rationale: string }) {
    const request = deactivateEvalCaseRequestSchema.parse(input);
    const actorId = requireHumanActor();
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.evalCase.findFirst({
        where: { id: caseId, ...aggregateScopeWhere() },
      });
      if (!current)
        throw new AppError(404, 'EVAL_CASE_NOT_FOUND', 'Evaluation case was not found', { caseId });
      if (!current.active)
        throw new AppError(409, 'EVAL_CASE_INACTIVE', 'Evaluation case is already inactive', {
          caseId,
        });
      const updated = await transaction.evalCase.update({
        where: { id: caseId },
        data: {
          active: false,
          deactivatedAt: new Date(),
          deactivatedBy: actorId,
          deactivationRationale: request.rationale,
          updatedBy: actorId,
        },
      });
      await appendAuditEvent(transaction, {
        action: 'eval_case.deactivated',
        entityType: 'EvalCase',
        entityId: caseId,
        details: { rationale: request.rationale },
      });
      return toEvalCase(updated);
    });
  }

  async publish(rawInput: z.infer<typeof publishEvalCorpusRequestSchema>) {
    const input = publishEvalCorpusRequestSchema.parse(rawInput);
    if (new Set(input.caseIds).size !== input.caseIds.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Corpus case IDs must be unique');
    }
    const actorId = requireHumanActor();
    const scope = aggregateScope();
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('eval-corpus-publish'))`;
        const current = await transaction.evalCorpusVersion.findFirst({
          where: aggregateScopeWhere(),
          orderBy: { version: 'desc' },
        });
        if ((current?.version ?? null) !== input.baseVersion) {
          throw new AppError(409, 'EVAL_CORPUS_VERSION_CONFLICT', 'Evaluation corpus changed', {
            expectedBaseVersion: input.baseVersion,
            currentVersion: current?.version ?? null,
          });
        }
        const records = await transaction.evalCase.findMany({
          where: {
            id: { in: input.caseIds },
            active: true,
            ...aggregateScopeWhere(),
          },
        });
        if (records.length !== input.caseIds.length) {
          const found = new Set(records.map(({ id }) => id));
          throw new AppError(400, 'VALIDATION_ERROR', 'Corpus contains missing or inactive cases', {
            caseIds: input.caseIds.filter((id) => !found.has(id)),
          });
        }
        const byId = new Map(records.map((record) => [record.id, toEvalCase(record)]));
        const ordered = input.caseIds.map((id) => byId.get(id)!);
        const digest = contentHash(ordered);
        const created = await transaction.evalCorpusVersion.create({
          data: {
            ...scope,
            version: (current?.version ?? 0) + 1,
            contentHash: digest,
            publishedBy: actorId,
            rationale: input.rationale,
          },
        });
        await transaction.evalCorpusCase.createMany({
          data: ordered.map((item, ordinal) => ({
            corpusVersionId: created.id,
            caseId: item.id,
            ordinal,
            caseSnapshot: toPrismaJson(evalCaseSchema, item, `EvalCorpusCase(${item.id}).snapshot`),
            caseHash: createHash('sha256')
              .update(canonicalizeCertificationJson(item))
              .digest('hex'),
          })),
        });
        await appendAuditEvent(transaction, {
          action: 'eval_corpus.published',
          entityType: 'EvalCorpusVersion',
          entityId: created.id,
          details: { version: created.version, caseCount: ordered.length, contentHash: digest },
        });
        return evalCorpusVersionSchema.parse({
          id: created.id,
          version: created.version,
          contentHash: created.contentHash,
          caseCount: ordered.length,
          publishedBy: created.publishedBy,
          rationale: created.rationale,
          publishedAt: created.publishedAt.toISOString(),
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
