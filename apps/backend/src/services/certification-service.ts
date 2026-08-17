import { createHash } from 'node:crypto';
import {
  AgentStatus as DatabaseAgentStatus,
  EvalCaseTag as DatabaseEvalCaseTag,
  CertificationGateKey as DatabaseGateKey,
  CertificationGateOperator as DatabaseGateOperator,
  CertificationGateResultStatus as DatabaseGateStatus,
  CertificationHealth as DatabaseCertificationHealth,
  CertificationResultsAvailability as DatabaseResultsAvailability,
  CertificationRunKind as DatabaseRunKind,
  CertificationRunState as DatabaseRunState,
  CertificationVerdict as DatabaseVerdict,
  EvaluationMode as DatabaseEvaluationMode,
  ExecutorKind as DatabaseExecutorKind,
  Prisma,
  type CertificationRun as DatabaseRun,
  type EvalCaseResult as DatabaseCaseResult,
  type PrismaClient,
} from '@prisma/client';
import {
  agentManifestSchema,
  certificationGateDefinitionsSchema,
  certificationParticipantSnapshotSchema,
  certificationRunAcceptedSchema,
  certificationRunDetailSchema,
  certificationRunHistoryResponseSchema,
  certificationRunSchema,
  evalCaseResultSchema,
  generationErrorSchema,
  jsonObjectSchema,
  jsonValueSchema,
  type AgentManifest,
  type CertificationGateDefinition,
  type CertificationGateResult,
  type CertificationRun,
  type CertificationRunDetail,
  type PromotionEligibility,
} from '@agent-builder/contracts';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import type { AgentExecutor } from '../certification/executor.js';
import {
  applyGate,
  average,
  championRegression,
  scoreCertificationCase,
} from '../certification/scoring.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { currentActorId } from '../request-context.js';
import { aggregateScopeWhere } from '../scope.js';
import { assertAgentTransition, assertCertificationTransition } from './transitions.js';
import { toGateConfig } from './gate-config-service.js';
import type { CertificationApi } from './types.js';
import type { CertificationWorkQueue } from '../certification/dispatcher.js';

const stringArraySchema = z.array(z.string());
const corpusCaseSnapshotSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1).max(160),
  name: z.string().min(2).max(200),
  input: jsonValueSchema,
  expectedOutput: jsonValueSchema,
  expectedCitations: z.array(z.string().min(1).max(500)).max(100),
  tags: z
    .array(
      z
        .string()
        .transform((value) => value.toLowerCase())
        .pipe(z.enum(['golden', 'replay', 'false_alarm', 'regression'])),
    )
    .min(1)
    .max(4),
});
const scoreBreakdownSchema = z.object({
  factualAccuracy: z.number(),
  citationCoverage: z.number(),
  unauthorizedActions: z.number(),
  championFactualAccuracy: z.number().nullable(),
});
const diffSchema = z.object({
  outputEqual: z.boolean(),
  championOnlyCitations: z.array(z.string()),
  challengerOnlyCitations: z.array(z.string()),
});

const iso = (date: Date | null): string | null => date?.toISOString() ?? null;
const manifestHash = (manifest: AgentManifest): string =>
  createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

const gateKeyMap = {
  factual_accuracy: DatabaseGateKey.FACTUAL_ACCURACY,
  citation_coverage: DatabaseGateKey.CITATION_COVERAGE,
  unauthorized_actions: DatabaseGateKey.UNAUTHORIZED_ACTIONS,
  champion_regression: DatabaseGateKey.CHAMPION_REGRESSION,
} as const;
const gateOperatorMap = {
  gte: DatabaseGateOperator.GTE,
  lte: DatabaseGateOperator.LTE,
  eq: DatabaseGateOperator.EQ,
} as const;
const evalCaseTagMap = {
  golden: DatabaseEvalCaseTag.GOLDEN,
  replay: DatabaseEvalCaseTag.REPLAY,
  false_alarm: DatabaseEvalCaseTag.FALSE_ALARM,
  regression: DatabaseEvalCaseTag.REGRESSION,
} as const;

function toRun(record: DatabaseRun): CertificationRun {
  return certificationRunSchema.parse({
    id: record.id,
    agentVersionId: record.agentVersionId,
    familyId: record.familyId,
    championVersionId: record.championVersionId,
    kind: record.kind.toLowerCase(),
    originStatus: record.originStatus.toLowerCase(),
    state: record.state.toLowerCase(),
    corpusVersionId: record.corpusVersionId,
    corpusVersion: record.corpusVersion,
    gateConfigId: record.gateConfigId,
    gateConfigVersion: record.gateConfigVersion,
    subjectManifestHash: record.subjectManifestHash,
    championManifestHash: record.championManifestHash,
    specRevision: record.specRevision,
    generatorVersion: record.generatorVersion,
    executorKind: 'manifest_fixture',
    executorVersion: record.executorVersion,
    evaluationMode: record.evaluationMode.toLowerCase(),
    progress: record.progress,
    message: record.message,
    caseCounts: {
      total: record.totalCaseCount,
      passed: record.passedCaseCount,
      failed: record.failedCaseCount,
    },
    verdict: record.verdict?.toLowerCase() ?? null,
    error:
      record.error === null
        ? null
        : parseJson(generationErrorSchema, record.error, `CertificationRun(${record.id}).error`),
    requestedBy: record.requestedBy,
    startedBy: record.startedBy,
    requestedAt: record.requestedAt.toISOString(),
    startedAt: iso(record.startedAt),
    finishedAt: iso(record.finishedAt),
    promotionExpiresAt: iso(record.promotionExpiresAt),
    isPromotionEvidence: record.isPromotionEvidence,
    resultsAvailability: record.resultsAvailability.toLowerCase(),
    caseResultsPrunedAt: iso(record.caseResultsPrunedAt),
  });
}

function toCaseResult(record: DatabaseCaseResult) {
  return evalCaseResultSchema.parse({
    id: record.id,
    runId: record.runId,
    caseId: record.caseId,
    caseKey: record.caseKey,
    caseName: record.caseName,
    tags: record.tags.map((tag) => tag.toLowerCase()),
    input: parseJson(jsonValueSchema, record.input, `EvalCaseResult(${record.id}).input`),
    expectedOutput: parseJson(
      jsonValueSchema,
      record.expectedOutput,
      `EvalCaseResult(${record.id}).expectedOutput`,
    ),
    expectedCitations: parseJson(
      stringArraySchema,
      record.expectedCitations,
      `EvalCaseResult(${record.id}).expectedCitations`,
    ),
    championOutput:
      record.championOutput === null
        ? null
        : parseJson(
            jsonValueSchema,
            record.championOutput,
            `EvalCaseResult(${record.id}).championOutput`,
          ),
    challengerOutput: parseJson(
      jsonValueSchema,
      record.challengerOutput,
      `EvalCaseResult(${record.id}).challengerOutput`,
    ),
    championCitations: parseJson(
      stringArraySchema,
      record.championCitations,
      `EvalCaseResult(${record.id}).championCitations`,
    ),
    challengerCitations: parseJson(
      stringArraySchema,
      record.challengerCitations,
      `EvalCaseResult(${record.id}).challengerCitations`,
    ),
    championActions: parseJson(
      stringArraySchema,
      record.championActions,
      `EvalCaseResult(${record.id}).championActions`,
    ),
    challengerActions: parseJson(
      stringArraySchema,
      record.challengerActions,
      `EvalCaseResult(${record.id}).challengerActions`,
    ),
    scoreBreakdown: parseJson(
      jsonObjectSchema,
      record.scoreBreakdown,
      `EvalCaseResult(${record.id}).scoreBreakdown`,
    ),
    diff: parseJson(jsonObjectSchema, record.diff, `EvalCaseResult(${record.id}).diff`),
    passed: record.passed,
    createdAt: record.createdAt.toISOString(),
  });
}

function gateResultWire(record: {
  gate: DatabaseGateKey;
  operator: DatabaseGateOperator;
  threshold: number;
  championScore: number | null;
  challengerScore: number | null;
  measuredValue: number | null;
  status: DatabaseGateStatus;
  details: Prisma.JsonValue;
}): CertificationGateResult {
  return {
    gate: record.gate.toLowerCase() as CertificationGateResult['gate'],
    operator: record.operator.toLowerCase() as CertificationGateResult['operator'],
    threshold: record.threshold,
    championScore: record.championScore,
    challengerScore: record.challengerScore,
    measuredValue: record.measuredValue,
    status: record.status.toLowerCase() as CertificationGateResult['status'],
    details: parseJson(jsonObjectSchema, record.details, 'CertificationGateResult.details'),
  };
}

export class CertificationService implements CertificationApi, CertificationWorkQueue {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly executor: AgentExecutor,
  ) {}

  async createRun(agentId: string) {
    return this.createRunInternal(agentId, null);
  }

  async createScheduledRun(agentId: string, scheduleKey: string) {
    return this.createRunInternal(agentId, scheduleKey);
  }

  private async createRunInternal(agentId: string, scheduleKey: string | null) {
    const actorId = currentActorId();
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const agent = await transaction.agent.findFirst({
            where: { id: agentId, family: aggregateScopeWhere() },
            include: { family: true, spec: true },
          });
          if (!agent)
            throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent version was not found', { agentId });
          const active = await transaction.certificationRun.findFirst({
            where: {
              agentVersionId: agentId,
              family: aggregateScopeWhere(),
              state: { in: [DatabaseRunState.QUEUED, DatabaseRunState.RUNNING] },
            },
          });
          if (active) throw this.inProgress(active.id, agentId);
          const isChampion =
            agent.family.championAgentId === agent.id &&
            agent.status === DatabaseAgentStatus.ACTIVE;
          if (
            !isChampion &&
            agent.status !== DatabaseAgentStatus.SHADOW &&
            agent.status !== DatabaseAgentStatus.CERTIFIED
          ) {
            throw new AppError(
              409,
              'INVALID_AGENT_TRANSITION',
              'Only shadow or certified challengers can enter certification',
              {
                agentId,
                status: agent.status.toLowerCase(),
              },
            );
          }
          const manifest = parseJson(
            agentManifestSchema,
            agent.manifest,
            `Agent(${agent.id}).manifest`,
          );
          const subjectHash = agent.manifestHash ?? manifestHash(manifest);
          const corpus = await transaction.evalCorpusVersion.findFirst({
            where: aggregateScopeWhere(),
            orderBy: { version: 'desc' },
            include: { memberships: { orderBy: { ordinal: 'asc' } } },
          });
          const gateConfig = await transaction.certificationGateConfig.findFirst({
            where: { state: 'ACTIVE', ...aggregateScopeWhere() },
            orderBy: { version: 'desc' },
          });
          if (!corpus || !gateConfig) {
            throw new AppError(
              503,
              'DEPENDENCY_UNAVAILABLE',
              'Certification requires a published corpus and active gate configuration',
            );
          }
          const champion =
            !isChampion && agent.family.championAgentId !== null
              ? await transaction.agent.findFirst({
                  where: {
                    id: agent.family.championAgentId,
                    family: aggregateScopeWhere(),
                  },
                })
              : null;
          const championManifest =
            champion === null
              ? null
              : parseJson(agentManifestSchema, champion.manifest, `Agent(${champion.id}).manifest`);
          const championHash =
            champion === null ? null : (champion.manifestHash ?? manifestHash(championManifest!));
          const subjectSnapshot = certificationParticipantSnapshotSchema.parse({
            agentVersionId: agent.id,
            name: agent.name,
            versionNumber: agent.versionNumber,
            lifecycleStatus: agent.status.toLowerCase(),
            manifestHash: subjectHash,
          });
          const championSnapshot =
            champion === null
              ? null
              : certificationParticipantSnapshotSchema.parse({
                  agentVersionId: champion.id,
                  name: champion.name,
                  versionNumber: champion.versionNumber,
                  lifecycleStatus: champion.status.toLowerCase(),
                  manifestHash: championHash,
                });
          if (!isChampion) {
            assertAgentTransition(
              agent.status.toLowerCase() as 'shadow' | 'certified',
              'certifying',
            );
            const changed = await transaction.agent.updateMany({
              where: { id: agent.id, status: agent.status },
              data: { status: DatabaseAgentStatus.CERTIFYING, updatedBy: actorId },
            });
            if (changed.count !== 1)
              throw new AppError(
                409,
                'CERTIFICATION_IN_PROGRESS',
                'Agent state changed while certification was accepted',
              );
          }
          const run = await transaction.certificationRun.create({
            data: {
              agentVersionId: agent.id,
              familyId: agent.familyId,
              championVersionId: champion?.id ?? null,
              kind: isChampion
                ? DatabaseRunKind.CHAMPION_RECERTIFICATION
                : DatabaseRunKind.CHALLENGER,
              originStatus: agent.status,
              corpusVersionId: corpus.id,
              corpusVersion: corpus.version,
              gateConfigId: gateConfig.id,
              gateConfigVersion: gateConfig.version,
              corpusSnapshot: toPrismaJson(
                jsonValueSchema,
                {
                  version: corpus.version,
                  contentHash: corpus.contentHash,
                  caseHashes: corpus.memberships.map((membership) => membership.caseHash),
                },
                'CertificationRun.corpusSnapshot',
              ),
              gateConfigSnapshot: toPrismaJson(
                jsonValueSchema,
                toGateConfig(gateConfig),
                'CertificationRun.gateConfigSnapshot',
              ),
              subjectSnapshot: toPrismaJson(
                jsonValueSchema,
                subjectSnapshot,
                'CertificationRun.subjectSnapshot',
              ),
              championSnapshot:
                championSnapshot === null
                  ? Prisma.DbNull
                  : toPrismaJson(
                      jsonValueSchema,
                      championSnapshot,
                      'CertificationRun.championSnapshot',
                    ),
              subjectManifestSnapshot: toPrismaJson(
                agentManifestSchema,
                manifest,
                'CertificationRun.subjectManifestSnapshot',
              ),
              championManifestSnapshot:
                championManifest === null
                  ? Prisma.DbNull
                  : toPrismaJson(
                      agentManifestSchema,
                      championManifest,
                      'CertificationRun.championManifestSnapshot',
                    ),
              subjectManifestHash: subjectHash,
              championManifestHash: championHash,
              specRevision: agent.spec?.revision ?? manifest.specRevision,
              generatorVersion: manifest.generatorVersion,
              executorKind: DatabaseExecutorKind.MANIFEST_FIXTURE,
              executorVersion: this.executor.version,
              evaluationMode: DatabaseEvaluationMode.CORPUS_COVERAGE,
              requestedBy: actorId,
              nightlyScheduleKey: scheduleKey,
            },
          });
          await appendAuditEvent(transaction, {
            action: 'certification.queued',
            entityType: 'CertificationRun',
            entityId: run.id,
            details: {
              agentId,
              familyId: agent.familyId,
              corpusVersion: corpus.version,
              gateConfigVersion: gateConfig.version,
              executorKind: this.executor.kind,
              executorVersion: this.executor.version,
              evaluationMode: this.executor.evaluationMode,
            },
          });
          return certificationRunAcceptedSchema.parse({
            runId: run.id,
            agentVersionId: agent.id,
            state: 'queued',
            corpusVersion: run.corpusVersion,
            gateConfigVersion: run.gateConfigVersion,
            executorKind: this.executor.kind,
            executorVersion: this.executor.version,
            evaluationMode: this.executor.evaluationMode,
            statusUrl: `/agents/certification-runs/${run.id}`,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2002' || error.code === 'P2034')
      ) {
        const active = await this.prisma.certificationRun.findFirst({
          where: {
            agentVersionId: agentId,
            family: aggregateScopeWhere(),
            state: { in: [DatabaseRunState.QUEUED, DatabaseRunState.RUNNING] },
          },
          orderBy: { requestedAt: 'desc' },
        });
        if (active) throw this.inProgress(active.id, agentId);
      }
      throw error;
    }
  }

  async getRun(runId: string, limit: number, cursor?: string): Promise<CertificationRunDetail> {
    const record = await this.prisma.certificationRun.findFirst({
      where: { id: runId, family: aggregateScopeWhere() },
      include: {
        gateResults: { orderBy: { gate: 'asc' } },
        promotionDecision: { select: { id: true } },
      },
    });
    if (!record)
      throw new AppError(404, 'CERTIFICATION_RUN_NOT_FOUND', 'Certification run was not found', {
        runId,
      });
    const results =
      record.resultsAvailability === DatabaseResultsAvailability.SUMMARY_ONLY
        ? []
        : await this.prisma.evalCaseResult.findMany({
            where: { runId },
            orderBy: [{ passed: 'asc' }, { caseKey: 'asc' }, { id: 'asc' }],
            ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
            take: limit + 1,
          });
    const hasNext = results.length > limit;
    if (hasNext) results.pop();
    return certificationRunDetailSchema.parse({
      run: toRun(record),
      subject: parseJson(
        certificationParticipantSnapshotSchema,
        record.subjectSnapshot,
        `CertificationRun(${runId}).subjectSnapshot`,
      ),
      champion:
        record.championSnapshot === null
          ? null
          : parseJson(
              certificationParticipantSnapshotSchema,
              record.championSnapshot,
              `CertificationRun(${runId}).championSnapshot`,
            ),
      gates: record.gateResults.map(gateResultWire),
      results: {
        items: results.map(toCaseResult),
        nextCursor: hasNext ? (results.at(-1)?.id ?? null) : null,
      },
      promotionEligibility: await this.promotionEligibility(
        record,
        record.promotionDecision !== null,
      ),
    });
  }

  async listRuns(agentId: string, query: { limit: number; cursor?: string }) {
    const agent = await this.prisma.agent.findFirst({
      where: { id: agentId, family: aggregateScopeWhere() },
      select: { id: true },
    });
    if (!agent)
      throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent version was not found', { agentId });
    const records = await this.prisma.certificationRun.findMany({
      where: { agentVersionId: agentId, family: aggregateScopeWhere() },
      orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
      take: query.limit + 1,
    });
    const hasNext = records.length > query.limit;
    if (hasNext) records.pop();
    return certificationRunHistoryResponseSchema.parse({
      items: records.map(toRun),
      nextCursor: hasNext ? (records.at(-1)?.id ?? null) : null,
    });
  }

  async executeRun(runId: string): Promise<void> {
    assertCertificationTransition('queued', 'running');
    const claimed = await this.prisma.$transaction(async (transaction) => {
      const startedAt = new Date();
      const changed = await transaction.certificationRun.updateMany({
        where: {
          id: runId,
          state: DatabaseRunState.QUEUED,
          family: aggregateScopeWhere(),
        },
        data: {
          state: DatabaseRunState.RUNNING,
          progress: 1,
          message: 'Certification started',
          startedAt,
          startedBy: currentActorId(),
        },
      });
      if (changed.count === 1) {
        await appendAuditEvent(transaction, {
          action: 'certification.started',
          entityType: 'CertificationRun',
          entityId: runId,
          details: { startedAt: startedAt.toISOString() },
        });
      }
      return changed;
    });
    if (claimed.count !== 1) return;
    const run = await this.prisma.certificationRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        corpus: { include: { memberships: { orderBy: { ordinal: 'asc' } } } },
        gateConfig: true,
      },
    });
    const subjectManifest = parseJson(
      agentManifestSchema,
      run.subjectManifestSnapshot,
      `CertificationRun(${runId}).subjectManifest`,
    );
    const championManifest =
      run.championManifestSnapshot === null
        ? null
        : parseJson(
            agentManifestSchema,
            run.championManifestSnapshot,
            `CertificationRun(${runId}).championManifest`,
          );
    // Corpus snapshots are the immutable execution input. The pre-versioning seed
    // stored Prisma enum values in uppercase, so the boundary normalizes only enum
    // casing while continuing to reject malformed evaluation content.
    const cases = run.corpus.memberships.map((membership) =>
      parseJson(
        corpusCaseSnapshotSchema,
        membership.caseSnapshot,
        `EvalCorpusCase(${membership.caseId}).snapshot`,
      ),
    );
    const subjectScores: ReturnType<typeof scoreCertificationCase>[] = [];
    const championScores: ReturnType<typeof scoreCertificationCase>[] = [];
    for (const [index, evaluationCase] of cases.entries()) {
      await this.assertRunning(runId);
      const challenger = await this.executor.execute(subjectManifest, evaluationCase.input);
      const champion =
        championManifest === null
          ? null
          : await this.executor.execute(championManifest, evaluationCase.input);
      await this.assertRunning(runId);
      const challengerScore = scoreCertificationCase({
        expectedOutput: evaluationCase.expectedOutput,
        expectedCitations: evaluationCase.expectedCitations,
        unauthorizedActionPatterns: subjectManifest.guardrails.prohibitedActions,
        execution: challenger,
      });
      const championScore =
        champion === null
          ? null
          : scoreCertificationCase({
              expectedOutput: evaluationCase.expectedOutput,
              expectedCitations: evaluationCase.expectedCitations,
              unauthorizedActionPatterns: championManifest!.guardrails.prohibitedActions,
              execution: champion,
            });
      subjectScores.push(challengerScore);
      if (championScore !== null) championScores.push(championScore);
      const championCitations = new Set(champion?.citations ?? []);
      const challengerCitations = new Set(challenger.citations);
      await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "CertificationRun" WHERE "id" = ${runId}::uuid FOR UPDATE`;
        const current = await transaction.certificationRun.findUnique({
          where: { id: runId },
          select: { state: true },
        });
        if (current?.state !== DatabaseRunState.RUNNING) {
          throw new Error('Certification run is no longer active');
        }
        await transaction.evalCaseResult.upsert({
          where: { runId_caseId: { runId, caseId: evaluationCase.id } },
          create: {
            runId,
            caseId: evaluationCase.id,
            caseKey: evaluationCase.key,
            caseName: evaluationCase.name,
            tags: evaluationCase.tags.map(
              (tag) => evalCaseTagMap[tag as keyof typeof evalCaseTagMap],
            ),
            input: toPrismaJson(jsonValueSchema, evaluationCase.input, 'EvalCaseResult.input'),
            expectedOutput: toPrismaJson(
              jsonValueSchema,
              evaluationCase.expectedOutput,
              'EvalCaseResult.expectedOutput',
            ),
            expectedCitations: toPrismaJson(
              stringArraySchema,
              evaluationCase.expectedCitations,
              'EvalCaseResult.expectedCitations',
            ),
            championOutput:
              champion === null
                ? Prisma.DbNull
                : toPrismaJson(jsonValueSchema, champion.output, 'EvalCaseResult.championOutput'),
            challengerOutput: toPrismaJson(
              jsonValueSchema,
              challenger.output,
              'EvalCaseResult.challengerOutput',
            ),
            championCitations: toPrismaJson(
              stringArraySchema,
              champion?.citations ?? [],
              'EvalCaseResult.championCitations',
            ),
            challengerCitations: toPrismaJson(
              stringArraySchema,
              challenger.citations,
              'EvalCaseResult.challengerCitations',
            ),
            championActions: toPrismaJson(
              stringArraySchema,
              champion?.attemptedActions ?? [],
              'EvalCaseResult.championActions',
            ),
            challengerActions: toPrismaJson(
              stringArraySchema,
              challenger.attemptedActions,
              'EvalCaseResult.challengerActions',
            ),
            scoreBreakdown: toPrismaJson(
              scoreBreakdownSchema,
              {
                factualAccuracy: challengerScore.factualAccuracy,
                citationCoverage: challengerScore.citationCoverage,
                unauthorizedActions: challengerScore.unauthorizedActions,
                championFactualAccuracy: championScore?.factualAccuracy ?? null,
              },
              'EvalCaseResult.scoreBreakdown',
            ),
            diff: toPrismaJson(
              diffSchema,
              {
                outputEqual:
                  champion === null
                    ? false
                    : JSON.stringify(champion.output) === JSON.stringify(challenger.output),
                championOnlyCitations: [...championCitations].filter(
                  (citation) => !challengerCitations.has(citation),
                ),
                challengerOnlyCitations: [...challengerCitations].filter(
                  (citation) => !championCitations.has(citation),
                ),
              },
              'EvalCaseResult.diff',
            ),
            passed: challengerScore.passed,
          },
          update: {},
        });
        await transaction.certificationRun.update({
          where: { id: runId },
          data: {
            progress: Math.min(95, Math.round(((index + 1) / Math.max(cases.length, 1)) * 90)),
            message: `Evaluated ${index + 1} of ${cases.length} cases`,
          },
        });
      });
    }
    const definitions = parseJson(
      certificationGateDefinitionsSchema,
      run.gateConfig.gates,
      `CertificationRun(${runId}).gates`,
    );
    const factual = average(subjectScores.map((score) => score.factualAccuracy));
    const citations = average(subjectScores.map((score) => score.citationCoverage));
    const unauthorized = subjectScores.reduce(
      (total, score) => total + score.unauthorizedActions,
      0,
    );
    const championFactual =
      championScores.length === 0
        ? null
        : average(championScores.map((score) => score.factualAccuracy));
    const championCitations =
      championScores.length === 0
        ? null
        : average(championScores.map((score) => score.citationCoverage));
    const championUnauthorized =
      championScores.length === 0
        ? null
        : championScores.reduce((total, score) => total + score.unauthorizedActions, 0);
    const regressionApplicable =
      run.kind === DatabaseRunKind.CHALLENGER && championFactual !== null;
    const gateRows = definitions.map((definition) =>
      this.evaluateGate(
        definition,
        factual,
        citations,
        unauthorized,
        championFactual,
        championCitations,
        championUnauthorized,
        regressionApplicable,
      ),
    );
    const passed = gateRows.every((gate) => gate.status !== DatabaseGateStatus.FAILED);
    const passedCaseCount = subjectScores.filter((score) => score.passed).length;
    const failedCaseCount = subjectScores.length - passedCaseCount;
    const finishedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "CertificationRun" WHERE "id" = ${runId}::uuid FOR UPDATE`;
      const current = await transaction.certificationRun.findUnique({ where: { id: runId } });
      if (!current || current.state !== DatabaseRunState.RUNNING) return;
      assertCertificationTransition('running', passed ? 'passed' : 'failed');
      await transaction.certificationGateResult.createMany({
        data: gateRows.map((gate) => ({ ...gate, runId })),
        skipDuplicates: true,
      });
      const terminal = await transaction.certificationRun.updateMany({
        where: { id: runId, state: DatabaseRunState.RUNNING },
        data: {
          state: passed ? DatabaseRunState.PASSED : DatabaseRunState.FAILED,
          verdict: passed ? DatabaseVerdict.PASSED : DatabaseVerdict.FAILED,
          progress: 100,
          message: passed ? 'Certification gates passed' : 'Certification gates failed',
          finishedAt,
          totalCaseCount: subjectScores.length,
          passedCaseCount,
          failedCaseCount,
          promotionExpiresAt:
            passed && run.kind === DatabaseRunKind.CHALLENGER
              ? new Date(
                  finishedAt.getTime() + run.gateConfig.promotionFreshnessHours * 60 * 60 * 1000,
                )
              : null,
        },
      });
      if (terminal.count !== 1) return;
      if (run.kind === DatabaseRunKind.CHALLENGER) {
        assertAgentTransition('certifying', passed ? 'certified' : 'rejected');
        await transaction.agent.updateMany({
          where: { id: run.agentVersionId, status: DatabaseAgentStatus.CERTIFYING },
          data: {
            status: passed ? DatabaseAgentStatus.CERTIFIED : DatabaseAgentStatus.REJECTED,
            certificationHealth: passed
              ? DatabaseCertificationHealth.CURRENT
              : DatabaseCertificationHealth.NOT_CERTIFIED,
            updatedBy: currentActorId(),
          },
        });
      } else {
        await transaction.agent.update({
          where: { id: run.agentVersionId },
          data: {
            certificationHealth: passed
              ? DatabaseCertificationHealth.CURRENT
              : DatabaseCertificationHealth.DEGRADED,
            degradedAt: passed ? null : finishedAt,
            degradationReason: passed ? null : 'Nightly corpus coverage certification failed',
            updatedBy: currentActorId(),
          },
        });
      }
      await appendAuditEvent(transaction, {
        action: passed ? 'certification.passed' : 'certification.failed',
        entityType: 'CertificationRun',
        entityId: runId,
        details: {
          agentId: run.agentVersionId,
          runKind: run.kind.toLowerCase(),
          caseCount: cases.length,
        },
      });
    });
  }

  async failRun(runId: string, code: string, message: string): Promise<void> {
    const error = generationErrorSchema.parse({ code, message });
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "CertificationRun" WHERE "id" = ${runId}::uuid FOR UPDATE`;
      const run = await transaction.certificationRun.findUnique({ where: { id: runId } });
      if (!run || (run.state !== DatabaseRunState.QUEUED && run.state !== DatabaseRunState.RUNNING))
        return;
      assertCertificationTransition(
        run.state === DatabaseRunState.QUEUED ? 'queued' : 'running',
        'error',
      );
      const [totalCaseCount, passedCaseCount] = await Promise.all([
        transaction.evalCaseResult.count({ where: { runId } }),
        transaction.evalCaseResult.count({ where: { runId, passed: true } }),
      ]);
      const changed = await transaction.certificationRun.updateMany({
        where: { id: runId, state: run.state },
        data: {
          state: DatabaseRunState.ERROR,
          verdict: DatabaseVerdict.ERROR,
          message: message.slice(0, 500),
          error: toPrismaJson(generationErrorSchema, error, `CertificationRun(${runId}).error`),
          finishedAt: new Date(),
          totalCaseCount,
          passedCaseCount,
          failedCaseCount: totalCaseCount - passedCaseCount,
        },
      });
      if (changed.count !== 1) return;
      if (run.kind === DatabaseRunKind.CHALLENGER) {
        await transaction.agent.updateMany({
          where: { id: run.agentVersionId, status: DatabaseAgentStatus.CERTIFYING },
          data: { status: DatabaseAgentStatus.SHADOW, updatedBy: currentActorId() },
        });
      } else {
        await transaction.agent.update({
          where: { id: run.agentVersionId },
          data: {
            certificationHealth: DatabaseCertificationHealth.DEGRADED,
            degradedAt: new Date(),
            degradationReason: code,
            updatedBy: currentActorId(),
          },
        });
      }
      await appendAuditEvent(transaction, {
        action: 'certification.error',
        entityType: 'CertificationRun',
        entityId: runId,
        details: { agentId: run.agentVersionId, code },
      });
    });
  }

  async reapRunningRuns(): Promise<number> {
    const running = await this.prisma.certificationRun.findMany({
      where: { state: DatabaseRunState.RUNNING, family: aggregateScopeWhere() },
      select: { id: true },
    });
    for (const run of running)
      await this.failRun(
        run.id,
        'ORPHANED_ON_RESTART',
        'Backend restarted while certification was running',
      );
    return running.length;
  }

  async queuedRunIds(): Promise<string[]> {
    const runs = await this.prisma.certificationRun.findMany({
      where: { state: DatabaseRunState.QUEUED, family: aggregateScopeWhere() },
      orderBy: { requestedAt: 'asc' },
      select: { id: true },
    });
    return runs.map(({ id }) => id);
  }

  private evaluateGate(
    definition: CertificationGateDefinition,
    factual: number,
    citations: number,
    unauthorized: number,
    championFactual: number | null,
    championCitations: number | null,
    championUnauthorized: number | null,
    regressionApplicable: boolean,
  ) {
    const challengerScore =
      definition.key === 'factual_accuracy'
        ? factual
        : definition.key === 'citation_coverage'
          ? citations
          : definition.key === 'unauthorized_actions'
            ? unauthorized
            : factual;
    const championScore =
      definition.key === 'factual_accuracy'
        ? championFactual
        : definition.key === 'citation_coverage'
          ? championCitations
          : definition.key === 'unauthorized_actions'
            ? championUnauthorized
            : championFactual;
    if (definition.key === 'champion_regression' && !regressionApplicable) {
      return {
        gate: gateKeyMap[definition.key],
        operator: gateOperatorMap[definition.operator],
        threshold: definition.threshold,
        championScore,
        challengerScore: factual,
        measuredValue: null,
        status: DatabaseGateStatus.NOT_APPLICABLE,
        details: toPrismaJson(
          jsonObjectSchema,
          { reason: 'No paired champion comparison applies to this run kind' },
          'CertificationGateResult.details',
        ),
      };
    }
    const measured =
      definition.key === 'champion_regression'
        ? championRegression(championFactual!, factual)
        : challengerScore;
    const passed = applyGate(definition.operator, measured, definition.threshold);
    return {
      gate: gateKeyMap[definition.key],
      operator: gateOperatorMap[definition.operator],
      threshold: definition.threshold,
      championScore,
      challengerScore,
      measuredValue: measured,
      status: passed ? DatabaseGateStatus.PASSED : DatabaseGateStatus.FAILED,
      details: toPrismaJson(
        jsonObjectSchema,
        { evaluationMode: this.executor.evaluationMode },
        'CertificationGateResult.details',
      ),
    };
  }

  private async promotionEligibility(
    run: DatabaseRun,
    alreadyDecided: boolean,
  ): Promise<PromotionEligibility> {
    const blockers: PromotionEligibility['blockers'] = [];
    const recertify = 'recertify' as const;
    if (alreadyDecided)
      blockers.push({
        code: 'already_decided',
        message: 'A promotion decision already exists for this run.',
        recommendedAction: null,
      });
    if (run.resultsAvailability === DatabaseResultsAvailability.SUMMARY_ONLY)
      blockers.push({
        code: 'results_pruned',
        message: 'Paired case evidence is no longer available.',
        recommendedAction: recertify,
      });
    if (run.promotionExpiresAt !== null && run.promotionExpiresAt <= new Date())
      blockers.push({
        code: 'run_stale',
        message: 'The promotion freshness window expired.',
        recommendedAction: recertify,
      });
    const [corpus, config, agent, family, champion] = await Promise.all([
      this.prisma.evalCorpusVersion.findFirst({
        where: aggregateScopeWhere(),
        orderBy: { version: 'desc' },
        select: { version: true },
      }),
      this.prisma.certificationGateConfig.findFirst({
        where: { state: 'ACTIVE', ...aggregateScopeWhere() },
        select: { version: true },
      }),
      this.prisma.agent.findFirst({
        where: { id: run.agentVersionId, family: aggregateScopeWhere() },
        include: { spec: { select: { revision: true } } },
      }),
      this.prisma.agentFamily.findFirst({
        where: { id: run.familyId, ...aggregateScopeWhere() },
        select: { championAgentId: true },
      }),
      run.championVersionId === null
        ? null
        : this.prisma.agent.findFirst({
            where: { id: run.championVersionId, family: aggregateScopeWhere() },
            select: { manifestHash: true },
          }),
    ]);
    const canRecertify =
      agent?.status === DatabaseAgentStatus.SHADOW ||
      agent?.status === DatabaseAgentStatus.CERTIFIED ||
      agent?.status === DatabaseAgentStatus.ACTIVE;
    if (run.state !== DatabaseRunState.PASSED || run.totalCaseCount <= 0) {
      blockers.push({
        code: 'run_not_passed',
        message: 'Certification run did not produce complete passing case evidence.',
        recommendedAction: canRecertify ? recertify : null,
      });
    }
    if (run.kind !== DatabaseRunKind.CHALLENGER) {
      blockers.push({
        code: 'run_kind_not_promotable',
        message: 'Champion re-certification runs are health evidence, not promotion evidence.',
        recommendedAction: null,
      });
    }
    if (corpus?.version !== run.corpusVersion)
      blockers.push({
        code: 'corpus_superseded',
        message: 'A newer evaluation corpus is published.',
        recommendedAction: recertify,
      });
    if (config?.version !== run.gateConfigVersion)
      blockers.push({
        code: 'gate_config_superseded',
        message: 'A newer certification gate configuration is active.',
        recommendedAction: recertify,
      });
    if (agent !== null && agent.status !== DatabaseAgentStatus.CERTIFIED) {
      blockers.push({
        code: 'agent_not_promotable',
        message: `The agent is ${agent.status.toLowerCase()} and cannot be promoted from its current lifecycle state.`,
        recommendedAction: null,
      });
    }
    if (
      !agent ||
      agent.manifestHash !== run.subjectManifestHash ||
      agent.spec?.revision !== run.specRevision
    )
      blockers.push({
        code: 'manifest_changed',
        message: 'The challenger manifest or spec revision changed after certification.',
        recommendedAction: recertify,
      });
    if (
      family?.championAgentId !== run.championVersionId ||
      (champion !== null && champion?.manifestHash !== run.championManifestHash)
    )
      blockers.push({
        code: 'champion_changed',
        message: 'The family champion changed after the paired run.',
        recommendedAction: recertify,
      });
    if (!canRecertify) {
      for (const blocker of blockers) {
        if (blocker.recommendedAction === recertify) blocker.recommendedAction = null;
      }
    }
    return {
      eligible: blockers.length === 0,
      freshUntil: iso(run.promotionExpiresAt),
      blockers,
    };
  }

  private async assertRunning(runId: string): Promise<void> {
    const run = await this.prisma.certificationRun.findFirst({
      where: { id: runId, family: aggregateScopeWhere() },
      select: { state: true },
    });
    if (run?.state !== DatabaseRunState.RUNNING)
      throw new Error('Certification run is no longer active');
  }

  private inProgress(runId: string, agentId: string): AppError {
    return new AppError(409, 'CERTIFICATION_IN_PROGRESS', 'Certification is already in progress', {
      runId,
      agentId,
      statusUrl: `/agents/certification-runs/${runId}`,
    });
  }
}
