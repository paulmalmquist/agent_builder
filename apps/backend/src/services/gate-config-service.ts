import {
  CertificationGateConfigState,
  ExecutorKind,
  Prisma,
  type CertificationGateConfig as DatabaseGateConfig,
  type PrismaClient,
} from '@prisma/client';
import {
  certificationGateConfigSchema,
  certificationGateDefinitionsSchema,
  gateConfigListResponseSchema,
  publishGateConfigRequestSchema,
  type CertificationGateConfig,
  type PublishGateConfigRequest,
} from '@agent-builder/contracts';
import { appendAuditEvent } from '../audit.js';
import { AppError } from '../errors.js';
import { parseJson, toPrismaJson } from '../json-boundary.js';
import { aggregateScope, aggregateScopeWhere } from '../scope.js';
import { requireHumanActor } from './actors.js';
import type { GateConfigApi } from './types.js';

export function toGateConfig(record: DatabaseGateConfig): CertificationGateConfig {
  return certificationGateConfigSchema.parse({
    id: record.id,
    version: record.version,
    state: record.state.toLowerCase(),
    promotionFreshnessHours: record.promotionFreshnessHours,
    gates: parseJson(
      certificationGateDefinitionsSchema,
      record.gates,
      `CertificationGateConfig(${record.id}).gates`,
    ),
    compatibleExecutorKinds: record.compatibleExecutorKinds.map(() => 'manifest_fixture'),
    publishedBy: record.publishedBy,
    rationale: record.rationale,
    activatedAt: record.activatedAt.toISOString(),
    supersededAt: record.supersededAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  });
}

export class GateConfigService implements GateConfigApi {
  constructor(private readonly prisma: PrismaClient) {}

  async list(includeSuperseded: boolean) {
    const records = await this.prisma.certificationGateConfig.findMany({
      where: {
        ...aggregateScopeWhere(),
        ...(includeSuperseded ? {} : { state: CertificationGateConfigState.ACTIVE }),
      },
      orderBy: { version: 'desc' },
    });
    const active =
      records.find((record) => record.state === CertificationGateConfigState.ACTIVE) ??
      (includeSuperseded
        ? await this.prisma.certificationGateConfig.findFirst({
            where: { state: CertificationGateConfigState.ACTIVE, ...aggregateScopeWhere() },
          })
        : null);
    if (!active)
      throw new AppError(
        503,
        'DEPENDENCY_UNAVAILABLE',
        'No active certification gate configuration is published',
      );
    return gateConfigListResponseSchema.parse({
      active: toGateConfig(active),
      history: includeSuperseded
        ? records.filter((record) => record.id !== active.id).map(toGateConfig)
        : [],
    });
  }

  async publish(rawInput: PublishGateConfigRequest) {
    const input = publishGateConfigRequestSchema.parse(rawInput);
    const actorId = requireHumanActor();
    const scope = aggregateScope();
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('certification-gate-config-publish'))`;
        const current = await transaction.certificationGateConfig.findFirst({
          where: { state: CertificationGateConfigState.ACTIVE, ...aggregateScopeWhere() },
          orderBy: { version: 'desc' },
        });
        if ((current?.version ?? null) !== input.baseVersion) {
          throw new AppError(
            409,
            'GATE_CONFIG_VERSION_CONFLICT',
            'Certification gate configuration changed',
            {
              expectedBaseVersion: input.baseVersion,
              currentVersion: current?.version ?? null,
            },
          );
        }
        const now = new Date();
        if (current) {
          await transaction.certificationGateConfig.update({
            where: { id: current.id },
            data: { state: CertificationGateConfigState.SUPERSEDED, supersededAt: now },
          });
        }
        const created = await transaction.certificationGateConfig.create({
          data: {
            ...scope,
            version: (current?.version ?? 0) + 1,
            state: CertificationGateConfigState.ACTIVE,
            promotionFreshnessHours: input.promotionFreshnessHours,
            gates: toPrismaJson(
              certificationGateDefinitionsSchema,
              input.gates,
              'CertificationGateConfig.gates',
            ),
            compatibleExecutorKinds: [ExecutorKind.MANIFEST_FIXTURE],
            publishedBy: actorId,
            rationale: input.rationale,
            activatedAt: now,
          },
        });
        await appendAuditEvent(transaction, {
          action: 'certification_gate_config.published',
          entityType: 'CertificationGateConfig',
          entityId: created.id,
          details: { version: created.version, supersededConfigId: current?.id ?? null },
        });
        return toGateConfig(created);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
