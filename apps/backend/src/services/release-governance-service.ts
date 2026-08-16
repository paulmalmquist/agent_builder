import { createHash } from 'node:crypto';
import {
  ExecutionRunState,
  ReleaseEvaluationVerdict,
  ReleasePromotionAction,
  ResourceKind,
  ResourceLifecycle,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import {
  createReleaseEvaluationRequestSchema,
  evaluationSuiteSpecSchema,
  productionChannelMutationResponseSchema,
  productionChannelSchema,
  promoteReleaseRequestSchema,
  releaseEvaluationResultSchema,
  releaseEvaluationEvidenceSchema,
  releaseEvaluationGateScoresSchema,
  releaseEvaluationSchema,
  releasePromotionDecisionSchema,
  rollbackReleaseRequestSchema,
  resourceManifestSchema,
  type ProductionChannel,
  type ReleaseEvaluation,
} from '@agent-builder/contracts';
import { z } from 'zod';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { currentRequestContext } from '../request-context.js';
import {
  DeterministicContractReleaseEvaluator,
  deterministicContractDisclaimer,
} from '../release-governance/deterministic-evaluator.js';
import type {
  ReleaseEvaluationHistory,
  ReleaseEvaluator,
} from '../release-governance/evaluator.js';

const evaluationResultsSchema = z.array(releaseEvaluationResultSchema);
const gateScoresSchema = releaseEvaluationGateScoresSchema;

type EvaluationRecord = Prisma.ReleaseEvaluationGetPayload<Record<string, never>>;
type ChannelRecord = Prisma.ProductionChannelGetPayload<{
  include: { currentRelease: true };
}>;
type DecisionRecord = Prisma.ReleasePromotionDecisionGetPayload<Record<string, never>>;

function toEvaluation(record: EvaluationRecord): ReleaseEvaluation {
  const evidence = parseJson(
    releaseEvaluationEvidenceSchema,
    record.evidence,
    'ReleaseEvaluation.evidence',
  );
  return releaseEvaluationSchema.parse({
    id: record.id,
    releaseId: record.releaseId,
    releaseDigest: record.releaseDigest,
    suiteVersionId: record.suiteVersionId,
    suiteDigest: record.suiteDigest,
    executorKind: record.executorKind,
    executorVersion: record.executorVersion,
    evaluationMode: record.evaluationMode,
    historySnapshotDigest: record.historySnapshotDigest,
    corpusVersion: record.corpusVersion,
    verdict:
      record.verdict === ReleaseEvaluationVerdict.PASSED
        ? 'passed'
        : record.verdict === ReleaseEvaluationVerdict.FAILED
          ? 'failed'
          : 'error',
    results: parseJson(evaluationResultsSchema, record.results, 'ReleaseEvaluation.results'),
    gateScores: parseJson(gateScoresSchema, record.gateScores, 'ReleaseEvaluation.gateScores'),
    gateResults: evidence.gateResults,
    disclaimer: deterministicContractDisclaimer,
    evidence,
    requestedBy: record.requestedBy,
    createdAt: record.createdAt.toISOString(),
    finishedAt: record.finishedAt.toISOString(),
  });
}

function toChannel(record: ChannelRecord): ProductionChannel {
  return productionChannelSchema.parse({
    key: record.key,
    projectId: record.projectId,
    currentReleaseId: record.currentReleaseId,
    currentReleaseDigest: record.currentRelease?.digest ?? null,
    priorReleaseId: record.priorReleaseId,
    promotedBy: record.promotedBy,
    promotedAt: record.promotedAt?.toISOString() ?? null,
    updatedAt: record.updatedAt.toISOString(),
  });
}

function toDecision(record: DecisionRecord) {
  return releasePromotionDecisionSchema.parse({
    id: record.id,
    channelKey: record.channelKey,
    action: record.action === ReleasePromotionAction.PROMOTED ? 'promoted' : 'rolled_back',
    releaseId: record.releaseId,
    previousReleaseId: record.previousReleaseId,
    evaluationId: record.evaluationId,
    rationale: record.rationale,
    decidedBy: record.decidedBy,
    decidedAt: record.decidedAt.toISOString(),
  });
}

function requireHumanActor(): string {
  const context = currentRequestContext();
  if (context.actor.authentication === 'system') {
    throw new AppError(
      403,
      'HUMAN_APPROVAL_REQUIRED',
      'Release promotion and rollback require an authenticated human actor',
    );
  }
  return context.actor.id;
}

function expectedChannelKey(projectId: string | null): string {
  return projectId ?? 'default';
}

export class ReleaseGovernanceService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly evaluators: readonly ReleaseEvaluator[] = [
      new DeterministicContractReleaseEvaluator(),
    ],
  ) {}

  async evaluate(
    input: z.input<typeof createReleaseEvaluationRequestSchema>,
  ): Promise<ReleaseEvaluation> {
    const parsed = createReleaseEvaluationRequestSchema.parse(input);
    const evaluator = this.evaluators.find(({ mode }) => mode === parsed.requestedMode);
    if (evaluator === undefined) {
      throw new AppError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'No approved evaluator is configured for the requested evaluation mode',
        { requestedMode: parsed.requestedMode },
      );
    }
    const actor = currentRequestContext().actor.id;
    const record = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "ReleaseBundle" WHERE "id" = ${parsed.releaseId}::uuid FOR UPDATE`;
        const release = await transaction.releaseBundle.findUnique({
          where: { id: parsed.releaseId },
          include: {
            resources: { include: { resourceVersion: { include: { family: true } } } },
          },
        });
        if (release === null) throw new AppError(404, 'RELEASE_NOT_FOUND', 'Release was not found');
        const suiteMember = release.resources.find(
          ({ resourceVersionId }) => resourceVersionId === parsed.suiteVersionId,
        );
        if (suiteMember === undefined) {
          throw new AppError(
            422,
            'EVALUATION_SUITE_NOT_IN_RELEASE',
            'The immutable release must contain the exact evaluation suite version',
          );
        }
        const suiteVersion = suiteMember.resourceVersion;
        if (suiteVersion.family.kind !== ResourceKind.EVALUATION_SUITE) {
          throw new AppError(
            422,
            'INVALID_EVALUATION_SUITE',
            'The selected resource is not an EvaluationSuite',
          );
        }
        const suiteManifest = resourceManifestSchema.parse(suiteVersion.definition);
        const suite = evaluationSuiteSpecSchema.parse(suiteManifest.spec);
        if (suite.executorKind !== evaluator.kind || suite.evaluationMode !== evaluator.mode) {
          throw new AppError(
            422,
            'EVALUATOR_MISMATCH',
            'The suite requires an evaluator that does not match the requested execution mode',
            {
              requestedMode: parsed.requestedMode,
              suiteExecutorKind: suite.executorKind,
              suiteEvaluationMode: suite.evaluationMode,
            },
          );
        }
        let history: ReleaseEvaluationHistory = {
          costUsd: [],
          latencyMs: [],
          outcomeQuality: [],
        };
        let normalizedHistory: Array<{
          runId: string;
          finishedAt: string | null;
          costUsd: number | null;
          latencyMs: number | null;
          outcomeQuality: number | null;
        }> = [];
        const historyWindow = suite.gates.historical?.historyWindow ?? 0;
        if (historyWindow > 0) {
          const historicalRuns = await transaction.executionRun.findMany({
            where: {
              releaseId: release.id,
              releaseDigest: release.digest,
              developmentDraft: false,
              state: { in: [ExecutionRunState.SUCCEEDED, ExecutionRunState.FAILED] },
              finishedAt: { not: null },
            },
            select: {
              id: true,
              finishedAt: true,
              actualCostUsd: true,
              outcome: { select: { qualityScore: true } },
              metrics: {
                where: { name: 'run.latency' },
                select: { value: true },
                orderBy: { observedAt: 'desc' },
                take: 1,
              },
            },
            orderBy: [{ finishedAt: 'desc' }, { id: 'desc' }],
            take: historyWindow,
          });
          normalizedHistory = historicalRuns.map((run) => ({
            runId: run.id,
            finishedAt: run.finishedAt?.toISOString() ?? null,
            costUsd: run.actualCostUsd?.toNumber() ?? null,
            latencyMs: run.metrics[0]?.value ?? null,
            outcomeQuality: run.outcome?.qualityScore ?? null,
          }));
          history = {
            costUsd: normalizedHistory.flatMap(({ costUsd }) =>
              costUsd === null ? [] : [costUsd],
            ),
            latencyMs: normalizedHistory.flatMap(({ latencyMs }) =>
              latencyMs === null ? [] : [latencyMs],
            ),
            outcomeQuality: normalizedHistory.flatMap(({ outcomeQuality }) =>
              outcomeQuality === null ? [] : [outcomeQuality],
            ),
          };
        }
        const historySnapshotDigest = createHash('sha256')
          .update(JSON.stringify(normalizedHistory))
          .digest('hex');
        const existing = await transaction.releaseEvaluation.findUnique({
          where: {
            releaseId_suiteVersionId_suiteDigest_executorKind_executorVersion_evaluationMode_historySnapshotDigest:
              {
                releaseId: release.id,
                suiteVersionId: suiteVersion.id,
                suiteDigest: suiteVersion.digest,
                executorKind: evaluator.kind,
                executorVersion: evaluator.version,
                evaluationMode: evaluator.mode,
                historySnapshotDigest,
              },
          },
        });
        if (existing !== null) return existing;

        const evaluated = evaluator.evaluate({
          suiteDefinition: suiteVersion.definition,
          resources: release.resources.map(({ resourceVersion }) => ({
            id: resourceVersion.id,
            slug: resourceVersion.family.slug,
            version: resourceVersion.version,
            digest: resourceVersion.digest,
            definition: resourceVersion.definition,
          })),
          history,
          historySnapshotDigest,
          historyRunIds: normalizedHistory.map(({ runId }) => runId),
        });
        const finishedAt = new Date();
        const created = await transaction.releaseEvaluation.create({
          data: {
            releaseId: release.id,
            releaseDigest: release.digest,
            suiteVersionId: suiteVersion.id,
            suiteDigest: suiteVersion.digest,
            executorKind: evaluator.kind,
            executorVersion: evaluator.version,
            evaluationMode: evaluator.mode,
            historySnapshotDigest,
            corpusVersion: evaluated.corpusVersion,
            verdict:
              evaluated.verdict === 'passed'
                ? ReleaseEvaluationVerdict.PASSED
                : ReleaseEvaluationVerdict.FAILED,
            results: toPrismaJson(
              evaluationResultsSchema,
              evaluated.results,
              'ReleaseEvaluation.results',
            ),
            gateScores: toPrismaJson(
              gateScoresSchema,
              evaluated.gateScores,
              'ReleaseEvaluation.gateScores',
            ),
            evidence: toPrismaJson(
              releaseEvaluationEvidenceSchema,
              evaluated.evidence,
              'ReleaseEvaluation.evidence',
            ),
            requestedBy: actor,
            finishedAt,
          },
        });
        if (created.verdict === ReleaseEvaluationVerdict.PASSED) {
          await transaction.$queryRaw`SELECT set_config('paul_os.certification_evidence_id', ${created.id}, true)`;
          await transaction.resourceVersion.updateMany({
            where: {
              id: {
                in: [suiteVersion.id, ...evaluated.certifiedResourceIds],
              },
              lifecycle: {
                in: [
                  ResourceLifecycle.CANDIDATE,
                  ResourceLifecycle.EVALUATING,
                  ResourceLifecycle.EVALUATED,
                ],
              },
            },
            data: { lifecycle: ResourceLifecycle.CERTIFIED, updatedBy: actor },
          });
        }
        await appendAuditEvent(transaction, {
          action: 'release.evaluated',
          entityType: 'ReleaseBundle',
          entityId: release.id,
          details: {
            evaluationId: created.id,
            suiteVersionId: suiteVersion.id,
            verdict: created.verdict,
            executorKind: created.executorKind,
            evaluationMode: created.evaluationMode,
          },
        });
        return created;
      },
      { isolationLevel: 'Serializable' },
    );
    return toEvaluation(record);
  }

  async getEvaluation(evaluationId: string): Promise<ReleaseEvaluation> {
    const record = await this.prisma.releaseEvaluation.findUnique({ where: { id: evaluationId } });
    if (record === null) {
      throw new AppError(404, 'RELEASE_EVALUATION_NOT_FOUND', 'Release evaluation was not found');
    }
    return toEvaluation(record);
  }

  async getChannel(channelKey: string): Promise<ProductionChannel> {
    const channel = await this.prisma.productionChannel.findUnique({
      where: { key: channelKey },
      include: { currentRelease: true },
    });
    if (channel === null) {
      throw new AppError(404, 'PRODUCTION_CHANNEL_NOT_FOUND', 'Production channel was not found');
    }
    return toChannel(channel);
  }

  async promote(channelKey: string, input: z.input<typeof promoteReleaseRequestSchema>) {
    const parsed = promoteReleaseRequestSchema.parse(input);
    return this.movePointer(channelKey, {
      action: ReleasePromotionAction.PROMOTED,
      releaseId: parsed.releaseId,
      evaluationId: parsed.evaluationId,
      rationale: parsed.rationale,
    });
  }

  async rollback(channelKey: string, input: z.input<typeof rollbackReleaseRequestSchema>) {
    const parsed = rollbackReleaseRequestSchema.parse(input);
    const actor = requireHumanActor();
    const result = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${channelKey}))`;
        const channel = await transaction.productionChannel.findUnique({
          where: { key: channelKey },
          include: { currentRelease: true },
        });
        if (channel === null || channel.currentReleaseId === null) {
          throw new AppError(
            409,
            'NO_PRODUCTION_RELEASE',
            'The channel has no release to roll back',
          );
        }
        if (channel.currentReleaseId === parsed.targetReleaseId) {
          throw new AppError(
            409,
            'RELEASE_ALREADY_ACTIVE',
            'The requested release is already active',
          );
        }
        const earlierDecision = await transaction.releasePromotionDecision.findFirst({
          where: {
            channelKey,
            releaseId: parsed.targetReleaseId,
            evaluation: { verdict: ReleaseEvaluationVerdict.PASSED },
          },
          orderBy: { decidedAt: 'desc' },
        });
        if (earlierDecision === null) {
          throw new AppError(
            422,
            'ROLLBACK_TARGET_NOT_CERTIFIED',
            'Rollback requires a release previously promoted with passing evidence',
          );
        }
        return this.swapChannel(transaction, channel, {
          action: ReleasePromotionAction.ROLLED_BACK,
          releaseId: parsed.targetReleaseId,
          evaluationId: earlierDecision.evaluationId,
          rationale: parsed.rationale,
          actor,
        });
      },
      { isolationLevel: 'Serializable' },
    );
    return productionChannelMutationResponseSchema.parse(result);
  }

  private async movePointer(
    channelKey: string,
    input: {
      action: typeof ReleasePromotionAction.PROMOTED;
      releaseId: string;
      evaluationId: string;
      rationale: string;
    },
  ) {
    const actor = requireHumanActor();
    const result = await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${channelKey}))`;
        const release = await transaction.releaseBundle.findUnique({
          where: { id: input.releaseId },
          include: { resources: { include: { resourceVersion: true } } },
        });
        if (release === null) throw new AppError(404, 'RELEASE_NOT_FOUND', 'Release was not found');
        if (expectedChannelKey(release.projectId) !== channelKey) {
          throw new AppError(
            422,
            'PRODUCTION_CHANNEL_MISMATCH',
            'The release project does not match the production channel',
          );
        }
        const evidence = await transaction.releaseEvaluation.findUnique({
          where: { id: input.evaluationId },
        });
        if (
          evidence === null ||
          evidence.releaseId !== release.id ||
          evidence.releaseDigest !== release.digest ||
          evidence.verdict !== ReleaseEvaluationVerdict.PASSED
        ) {
          throw new AppError(
            422,
            'PASSING_RELEASE_EVIDENCE_REQUIRED',
            'Promotion requires passing evidence for this exact release digest',
          );
        }
        if (
          release.resources.some(
            ({ resourceVersion }) => resourceVersion.lifecycle !== ResourceLifecycle.CERTIFIED,
          )
        ) {
          throw new AppError(
            422,
            'RELEASE_RESOURCES_NOT_CERTIFIED',
            'Every production release resource must be certified by governed evidence',
          );
        }
        if (
          release.resources.some(
            ({ resourceVersion }) => !/^[a-f0-9]{7,64}$/i.test(resourceVersion.sourceCommit),
          )
        ) {
          throw new AppError(
            422,
            'UNVERIFIED_RELEASE_PROVENANCE',
            'Production promotion requires repository-verified source provenance',
          );
        }
        let channel = await transaction.productionChannel.findUnique({
          where: { key: channelKey },
          include: { currentRelease: true },
        });
        channel ??= await transaction.productionChannel.create({
          data: { key: channelKey, projectId: release.projectId },
          include: { currentRelease: true },
        });
        if (channel.currentReleaseId === release.id) {
          throw new AppError(
            409,
            'RELEASE_ALREADY_ACTIVE',
            'The requested release is already active',
          );
        }
        return this.swapChannel(transaction, channel, { ...input, actor });
      },
      { isolationLevel: 'Serializable' },
    );
    return productionChannelMutationResponseSchema.parse(result);
  }

  private async swapChannel(
    transaction: Prisma.TransactionClient,
    channel: ChannelRecord,
    input: {
      action: ReleasePromotionAction;
      releaseId: string;
      evaluationId: string;
      rationale: string;
      actor: string;
    },
  ) {
    const decision = await transaction.releasePromotionDecision.create({
      data: {
        channelKey: channel.key,
        action: input.action,
        releaseId: input.releaseId,
        previousReleaseId: channel.currentReleaseId,
        evaluationId: input.evaluationId,
        rationale: input.rationale,
        decidedBy: input.actor,
      },
    });
    await transaction.$queryRaw`SELECT set_config('paul_os.production_decision_id', ${decision.id}, true)`;
    const updated = await transaction.productionChannel.update({
      where: { key: channel.key },
      data: {
        currentReleaseId: input.releaseId,
        priorReleaseId: channel.currentReleaseId,
        promotedBy: input.actor,
        promotedAt: new Date(),
      },
      include: { currentRelease: true },
    });
    await appendAuditEvent(transaction, {
      action:
        input.action === ReleasePromotionAction.PROMOTED
          ? 'release.promoted'
          : 'release.rolled_back',
      entityType: 'ProductionChannel',
      entityId: channel.key,
      details: {
        decisionId: decision.id,
        releaseId: input.releaseId,
        previousReleaseId: channel.currentReleaseId,
        evaluationId: input.evaluationId,
      },
    });
    return { channel: toChannel(updated), decision: toDecision(decision) };
  }
}
