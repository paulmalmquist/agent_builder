import {
  AgentStatus as DatabaseAgentStatus,
  CertificationGateKey as DatabaseGateKey,
  CertificationGateResultStatus as DatabaseGateStatus,
  CertificationResultsAvailability as DatabaseResultsAvailability,
  CertificationRunKind as DatabaseRunKind,
  CertificationRunState as DatabaseRunState,
  GenerationJobState as DatabaseGenerationJobState,
  PromotionDecisionType,
  Prisma,
  RetirementReason,
  type PrismaClient,
} from '@prisma/client';
import {
  promotionRequestSchema,
  promotionResponseSchema,
  retirementRequestSchema,
  retirementResponseSchema,
} from '@agent-builder/contracts';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { assertAgentTransition } from './transitions.js';
import { requireHumanActor } from './actors.js';
import type { PromotionApi } from './types.js';

const retireable = new Set<DatabaseAgentStatus>([
  DatabaseAgentStatus.DRAFT,
  DatabaseAgentStatus.READY,
  DatabaseAgentStatus.SHADOW,
  DatabaseAgentStatus.CERTIFIED,
  DatabaseAgentStatus.REJECTED,
  DatabaseAgentStatus.FAILED,
  DatabaseAgentStatus.ACTIVE,
]);

function isPromotionConcurrencyError(error: unknown): boolean {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2002' || error.code === 'P2034')
  ) {
    return true;
  }
  const metadata =
    typeof error === 'object' && error !== null && 'meta' in error
      ? (error as { meta?: { code?: unknown } }).meta
      : undefined;
  return (
    metadata?.code === '40001' ||
    metadata?.code === '40P01' ||
    (error instanceof Error && /could not serialize access|deadlock detected/i.test(error.message))
  );
}

export class PromotionService implements PromotionApi {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly afterRetirementCheckpoint: () => void | Promise<void> = () => undefined,
  ) {}

  async promote(agentId: string, rawInput: unknown) {
    const input = promotionRequestSchema.parse(rawInput);
    const actorId = requireHumanActor();
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const agent = await transaction.agent.findUnique({
            where: { id: agentId },
            include: { family: true, spec: { select: { revision: true } } },
          });
          if (!agent)
            throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent version was not found', { agentId });
          await transaction.$queryRaw`SELECT "id" FROM "AgentFamily" WHERE "id" = ${agent.familyId}::uuid FOR UPDATE`;
          await transaction.$queryRaw`SELECT "id" FROM "CertificationRun" WHERE "id" = ${input.runId}::uuid FOR UPDATE`;
          const run = await transaction.certificationRun.findUnique({
            where: { id: input.runId },
            include: {
              promotionDecision: true,
              gateResults: true,
              _count: { select: { caseResults: true } },
            },
          });
          if (!run || run.agentVersionId !== agentId || run.familyId !== agent.familyId) {
            throw new AppError(
              404,
              'CERTIFICATION_RUN_NOT_FOUND',
              'Certification run does not belong to this version',
              { agentId, runId: input.runId },
            );
          }
          if (agent.status !== DatabaseAgentStatus.CERTIFIED) {
            throw new AppError(
              409,
              'INVALID_AGENT_TRANSITION',
              'Only a certified challenger can be promoted',
              { agentId, status: agent.status.toLowerCase() },
            );
          }
          if (run.kind !== DatabaseRunKind.CHALLENGER) {
            throw this.ineligible(
              'run_kind_not_promotable',
              'Champion re-certification runs cannot be used to promote a challenger',
            );
          }
          if (run.state !== DatabaseRunState.PASSED)
            throw this.ineligible('run_not_passed', 'Certification run did not pass');
          if (run.promotionDecision !== null)
            throw this.ineligible('already_decided', 'A decision already exists for this run');
          if (run.resultsAvailability === DatabaseResultsAvailability.SUMMARY_ONLY)
            throw this.ineligible('results_pruned', 'Paired certification evidence was pruned');
          if (run.promotionExpiresAt === null || run.promotionExpiresAt <= new Date())
            throw this.ineligible('run_stale', 'Certification evidence is stale');
          const expectedGateStatuses = new Map([
            [DatabaseGateKey.FACTUAL_ACCURACY, DatabaseGateStatus.PASSED],
            [DatabaseGateKey.CITATION_COVERAGE, DatabaseGateStatus.PASSED],
            [DatabaseGateKey.UNAUTHORIZED_ACTIONS, DatabaseGateStatus.PASSED],
            [
              DatabaseGateKey.CHAMPION_REGRESSION,
              run.championVersionId === null
                ? DatabaseGateStatus.NOT_APPLICABLE
                : DatabaseGateStatus.PASSED,
            ],
          ]);
          const gateStatuses = new Map(run.gateResults.map((gate) => [gate.gate, gate.status]));
          if (
            run.totalCaseCount <= 0 ||
            run._count.caseResults !== run.totalCaseCount ||
            run.gateResults.length !== 4 ||
            gateStatuses.size !== expectedGateStatuses.size ||
            [...expectedGateStatuses].some(
              ([gate, expectedStatus]) => gateStatuses.get(gate) !== expectedStatus,
            )
          ) {
            throw this.ineligible(
              'run_not_passed',
              'Certification evidence is incomplete or contains failing case or gate results',
            );
          }
          const [latestCorpus, activeConfig, currentChampion] = await Promise.all([
            transaction.evalCorpusVersion.findFirst({ orderBy: { version: 'desc' } }),
            transaction.certificationGateConfig.findFirst({ where: { state: 'ACTIVE' } }),
            agent.family.championAgentId === null
              ? Promise.resolve(null)
              : transaction.agent.findUnique({ where: { id: agent.family.championAgentId } }),
          ]);
          if (latestCorpus?.version !== run.corpusVersion)
            throw this.ineligible('corpus_superseded', 'A newer evaluation corpus is published');
          if (activeConfig?.version !== run.gateConfigVersion)
            throw this.ineligible('gate_config_superseded', 'A newer gate configuration is active');
          if (
            agent.manifestHash !== run.subjectManifestHash ||
            agent.spec?.revision !== run.specRevision
          )
            throw this.ineligible(
              'manifest_changed',
              'Challenger manifest or spec changed after certification',
            );
          if (
            agent.family.championAgentId !== run.championVersionId ||
            (currentChampion !== null && currentChampion.manifestHash !== run.championManifestHash)
          )
            throw this.ineligible(
              'champion_changed',
              'Champion changed after paired certification',
            );

          assertAgentTransition('certified', 'active');
          if (currentChampion !== null) assertAgentTransition('active', 'retired');
          const supersededCertified = await transaction.agent.findMany({
            where: {
              familyId: agent.familyId,
              id: { not: agentId },
              status: DatabaseAgentStatus.CERTIFIED,
            },
            select: { id: true },
          });
          supersededCertified.forEach(() => assertAgentTransition('certified', 'retired'));
          const now = new Date();
          await transaction.certificationRun.update({
            where: { id: run.id },
            data: {
              isPromotionEvidence: true,
              resultsAvailability: DatabaseResultsAvailability.PROMOTION_EVIDENCE,
            },
          });
          const auditEventId = await appendAuditEvent(transaction, {
            action: 'promotion.approved',
            entityType: 'Agent',
            entityId: agentId,
            details: {
              runId: run.id,
              familyId: agent.familyId,
              priorChampionVersionId: currentChampion?.id ?? null,
              rationale: input.rationale,
            },
          });
          const decision = await transaction.promotionDecision.create({
            data: {
              runId: run.id,
              familyId: agent.familyId,
              agentVersionId: agent.id,
              priorChampionVersionId: currentChampion?.id ?? null,
              decision: PromotionDecisionType.PROMOTED,
              decidedBy: actorId,
              rationale: input.rationale,
              auditEventId,
              decidedAt: now,
            },
          });
          const retireIds = [
            ...(currentChampion === null ? [] : [currentChampion.id]),
            ...supersededCertified.map(({ id }) => id),
          ];
          if (retireIds.length > 0) {
            await transaction.agent.updateMany({
              where: { id: { in: retireIds } },
              data: {
                status: DatabaseAgentStatus.RETIRED,
                retirementReason: RetirementReason.SUPERSEDED_BY_PROMOTION,
                retiredAt: now,
                retiredBy: actorId,
                retirementRationale: `Superseded by promotion of ${agent.slug}: ${input.rationale}`,
                successorAgentId: agent.id,
                activationDecisionId: null,
                legacyActivation: false,
                updatedBy: actorId,
              },
            });
            for (const retiredId of retireIds) {
              await appendAuditEvent(transaction, {
                action: 'agent.retired',
                entityType: 'Agent',
                entityId: retiredId,
                details: {
                  reason: 'superseded_by_promotion',
                  successorAgentId: agent.id,
                  decisionId: decision.id,
                },
              });
            }
          }
          await this.afterRetirementCheckpoint();
          await transaction.agent.update({
            where: { id: agent.id },
            data: {
              status: DatabaseAgentStatus.ACTIVE,
              activationDecisionId: decision.id,
              updatedBy: actorId,
            },
          });
          await transaction.agentFamily.update({
            where: { id: agent.familyId },
            data: {
              championAgentId: agent.id,
              name: agent.name,
              department: agent.department,
              owner: agent.owner,
              updatedBy: actorId,
            },
          });
          return promotionResponseSchema.parse({
            decisionId: decision.id,
            familyId: agent.familyId,
            agentVersionId: agent.id,
            previousChampionVersionId: currentChampion?.id ?? null,
            status: 'active',
            decidedBy: actorId,
            decidedAt: decision.decidedAt.toISOString(),
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      if (isPromotionConcurrencyError(error)) {
        throw new AppError(
          409,
          'PROMOTION_CONFLICT',
          'The champion or promotion evidence changed concurrently; refresh eligibility and retry',
          { agentId, runId: input.runId },
        );
      }
      throw error;
    }
  }

  async retire(agentId: string, rawInput: unknown) {
    const input = retirementRequestSchema.parse(rawInput);
    const actorId = requireHumanActor();
    try {
      return await this.prisma.$transaction(
        async (transaction) => {
          const candidate = await transaction.agent.findUnique({
            where: { id: agentId },
            select: { familyId: true },
          });
          if (!candidate)
            throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent version was not found', { agentId });
          await transaction.$queryRaw`SELECT "id" FROM "AgentFamily" WHERE "id" = ${candidate.familyId}::uuid FOR UPDATE`;
          await transaction.$queryRaw`SELECT "id" FROM "Agent" WHERE "id" = ${agentId}::uuid FOR UPDATE`;
          const agent = await transaction.agent.findUnique({
            where: { id: agentId },
            include: { family: true },
          });
          if (!agent)
            throw new AppError(404, 'AGENT_NOT_FOUND', 'Agent version was not found', { agentId });
          if (!retireable.has(agent.status)) {
            throw new AppError(
              409,
              agent.status === DatabaseAgentStatus.RETIRED
                ? 'AGENT_ALREADY_RETIRED'
                : 'AGENT_WORK_IN_PROGRESS',
              'Agent cannot be retired from its current state',
              { agentId, status: agent.status.toLowerCase() },
            );
          }
          const [activeCertification, activeGeneration] = await Promise.all([
            transaction.certificationRun.findFirst({
              where: {
                agentVersionId: agent.id,
                state: { in: [DatabaseRunState.QUEUED, DatabaseRunState.RUNNING] },
              },
              select: { id: true },
            }),
            transaction.generationJob.findFirst({
              where: {
                agentId: agent.id,
                state: {
                  in: [DatabaseGenerationJobState.QUEUED, DatabaseGenerationJobState.RUNNING],
                },
              },
              select: { id: true },
            }),
          ]);
          if (activeCertification !== null || activeGeneration !== null) {
            throw new AppError(
              409,
              'AGENT_WORK_IN_PROGRESS',
              'Agent cannot be retired while generation or certification work is active',
              {
                agentId,
                certificationRunId: activeCertification?.id ?? null,
                generationJobId: activeGeneration?.id ?? null,
              },
            );
          }
          assertAgentTransition(agent.status.toLowerCase() as never, 'retired');
          const now = new Date();
          const championCleared = agent.family.championAgentId === agent.id;
          const retired = await transaction.agent.updateMany({
            where: { id: agent.id, status: agent.status },
            data: {
              status: DatabaseAgentStatus.RETIRED,
              retirementReason: RetirementReason.EXPLICIT,
              retiredAt: now,
              retiredBy: actorId,
              retirementRationale: input.rationale,
              activationDecisionId: null,
              legacyActivation: false,
              updatedBy: actorId,
            },
          });
          if (retired.count !== 1) {
            throw new AppError(
              409,
              'RETIREMENT_CONFLICT',
              'Agent lifecycle changed concurrently; refresh and retry retirement',
              { agentId },
            );
          }
          if (championCleared) {
            await transaction.agentFamily.update({
              where: { id: agent.familyId },
              data: { championAgentId: null, updatedBy: actorId },
            });
          }
          await appendAuditEvent(transaction, {
            action: 'agent.retired',
            entityType: 'Agent',
            entityId: agent.id,
            details: { reason: 'explicit', rationale: input.rationale, championCleared },
          });
          return retirementResponseSchema.parse({
            agentVersionId: agent.id,
            familyId: agent.familyId,
            status: 'retired',
            championCleared,
            retiredAt: now.toISOString(),
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      if (isPromotionConcurrencyError(error)) {
        throw new AppError(
          409,
          'RETIREMENT_CONFLICT',
          'Agent lifecycle changed concurrently; refresh and retry retirement',
          { agentId },
        );
      }
      throw error;
    }
  }

  private ineligible(code: string, message: string): AppError {
    return new AppError(409, 'PROMOTION_INELIGIBLE', message, {
      blockers: [
        { code, message, recommendedAction: code === 'already_decided' ? null : 'recertify' },
      ],
    });
  }
}
