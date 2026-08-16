import {
  AgentStatus as DatabaseAgentStatus,
  CertificationResultsAvailability as DatabaseResultsAvailability,
  CertificationRunState as DatabaseRunState,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import type { Logger } from 'pino';
import { prunedCertificationManifestSnapshotSchema } from '@agent-builder/contracts';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { toPrismaJson } from '../json-boundary.js';
import type { MaintenanceTask } from '../maintenance/scheduler.js';
import type { CertificationService } from './certification-service.js';
import type { InterpretationService } from './interpretation-service.js';

const terminalStates = [DatabaseRunState.PASSED, DatabaseRunState.FAILED, DatabaseRunState.ERROR];

export class MaintenanceService implements MaintenanceTask {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly certification: CertificationService,
    private readonly interpretations: InterpretationService,
    private readonly enqueueCertification: (runId: string) => void,
    private readonly fullRunRetention: number,
    private readonly logger: Logger,
  ) {}

  async run(reason: 'boot' | 'scheduled'): Promise<void> {
    await this.prisma.$transaction(
      async (lockTransaction) => {
        const rows = await lockTransaction.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext('agent-builder-maintenance')) AS acquired
      `;
        if (rows[0]?.acquired !== true) {
          this.logger.info({ reason }, 'Maintenance skipped because another process owns the lock');
          return;
        }

        const deletedInterpretations = await this.interpretations.deleteExpiredUnattached();
        const prunedRuns = await this.pruneRunDetails();
        let queuedRuns = 0;
        if (reason === 'scheduled') queuedRuns = await this.queueChampionRecertifications();
        await appendAuditEvent(lockTransaction, {
          action: 'maintenance.completed',
          entityType: 'Maintenance',
          entityId: new Date().toISOString().slice(0, 10),
          details: { reason, deletedInterpretations, prunedRuns, queuedRuns },
        });
        this.logger.info(
          { reason, deletedInterpretations, prunedRuns, queuedRuns },
          'Maintenance completed',
        );
      },
      { maxWait: 10_000, timeout: 600_000 },
    );
  }

  private async queueChampionRecertifications(): Promise<number> {
    const day = new Date().toISOString().slice(0, 10);
    const champions = await this.prisma.agent.findMany({
      where: {
        status: DatabaseAgentStatus.ACTIVE,
        championForFamily: { isNot: null },
      },
      select: { id: true },
    });
    let queued = 0;
    for (const champion of champions) {
      try {
        const accepted = await this.certification.createScheduledRun(
          champion.id,
          `${day}:${champion.id}`,
        );
        this.enqueueCertification(accepted.runId);
        queued += 1;
      } catch (error: unknown) {
        if (
          error instanceof AppError &&
          (error.code === 'CERTIFICATION_IN_PROGRESS' || error.code === 'RESOURCE_CONFLICT')
        ) {
          continue;
        }
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    return queued;
  }

  private async pruneRunDetails(): Promise<number> {
    const agentIds = await this.prisma.certificationRun.findMany({
      distinct: ['agentVersionId'],
      select: { agentVersionId: true },
    });
    let count = 0;
    for (const { agentVersionId } of agentIds) {
      const runs = await this.prisma.certificationRun.findMany({
        where: {
          agentVersionId,
          state: { in: terminalStates },
          isPromotionEvidence: false,
          resultsAvailability: DatabaseResultsAvailability.FULL,
        },
        orderBy: [{ finishedAt: 'desc' }, { requestedAt: 'desc' }],
        select: { id: true, promotionExpiresAt: true },
      });
      const candidates = runs
        .slice(this.fullRunRetention)
        .filter((run) => run.promotionExpiresAt === null || run.promotionExpiresAt <= new Date());
      for (const run of candidates) {
        const pruned = await this.prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`SELECT "id" FROM "CertificationRun" WHERE "id" = ${run.id}::uuid FOR UPDATE`;
          const locked = await transaction.certificationRun.findUnique({ where: { id: run.id } });
          if (
            !locked ||
            locked.isPromotionEvidence ||
            locked.resultsAvailability !== DatabaseResultsAvailability.FULL
          ) {
            return false;
          }
          await transaction.evalCaseResult.deleteMany({ where: { runId: run.id } });
          await transaction.certificationRun.update({
            where: { id: run.id },
            data: {
              resultsAvailability: DatabaseResultsAvailability.SUMMARY_ONLY,
              caseResultsPrunedAt: new Date(),
              subjectManifestSnapshot: toPrismaJson(
                prunedCertificationManifestSnapshotSchema,
                { pruned: true },
                `CertificationRun(${run.id}).subjectManifestSnapshot`,
              ),
              championManifestSnapshot: Prisma.DbNull,
            },
          });
          await appendAuditEvent(transaction, {
            action: 'certification.results_pruned',
            entityType: 'CertificationRun',
            entityId: run.id,
            details: { agentVersionId },
          });
          return true;
        });
        if (pruned) count += 1;
      }
    }
    return count;
  }
}
