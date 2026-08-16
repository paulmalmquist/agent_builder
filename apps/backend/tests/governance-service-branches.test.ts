/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/unbound-method */
import type { Request, Response } from 'express';
import {
  CertificationGateConfigState,
  CertificationResultsAvailability,
  ExecutorKind,
  Prisma,
  type CertificationGateConfig,
  type PrismaClient,
} from '@prisma/client';
import { pino } from 'pino';
import { AppError } from '../src/errors.js';
import { requestContextMiddleware } from '../src/request-context.js';
import { requireHumanActor } from '../src/services/actors.js';
import type { CertificationService } from '../src/services/certification-service.js';
import { GateConfigService } from '../src/services/gate-config-service.js';
import type { InterpretationService } from '../src/services/interpretation-service.js';
import { MaintenanceService } from '../src/services/maintenance-service.js';

const CONFIG_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_CONFIG_ID = '44444444-4444-4444-8444-444444444444';
const AGENT_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const gates = [
  { key: 'factual_accuracy', operator: 'gte', threshold: 0.98 },
  { key: 'citation_coverage', operator: 'eq', threshold: 1 },
  { key: 'unauthorized_actions', operator: 'eq', threshold: 0 },
  { key: 'champion_regression', operator: 'lte', threshold: 0 },
] as const;

function gateConfig(overrides: Partial<CertificationGateConfig> = {}): CertificationGateConfig {
  const now = new Date('2026-08-04T12:00:00.000Z');
  return {
    id: CONFIG_ID,
    version: 1,
    state: CertificationGateConfigState.ACTIVE,
    promotionFreshnessHours: 24,
    gates: [...gates],
    compatibleExecutorKinds: [ExecutorKind.MANIFEST_FIXTURE],
    publishedBy: 'governance-user',
    rationale: 'Establish the governed baseline certification policy.',
    activatedAt: now,
    supersededAt: null,
    createdAt: now,
    ...overrides,
  };
}

function runAsHuman<T>(operation: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const middleware = requestContextMiddleware({ enabled: false, actorId: 'governance-user' });
    const request = {
      path: '/agents/certification-gate-configs/publish',
      header: () => undefined,
      id: 'governance-test-request',
    } as unknown as Request;
    const response = { setHeader: jest.fn() } as unknown as Response;
    middleware(request, response, (error?: unknown) => {
      if (error !== undefined) {
        reject(error instanceof Error ? error : new Error('Request-context middleware failed'));
        return;
      }
      operation().then(resolve, reject);
    });
  });
}

describe('governance actor enforcement', () => {
  it('rejects governance actions from the default system context', () => {
    expect(() => requireHumanActor()).toThrow('requires an authenticated human actor');
  });
});

describe('GateConfigService branch behavior', () => {
  it('returns only the active config when history is not requested', async () => {
    const active = gateConfig();
    const prisma = {
      certificationGateConfig: { findMany: jest.fn(async () => [active]) },
    } as unknown as PrismaClient;

    const result = await new GateConfigService(prisma).list(false);

    expect(result.active.id).toBe(CONFIG_ID);
    expect(result.history).toEqual([]);
  });

  it('loads the active config separately when superseded history does not contain it', async () => {
    const old = gateConfig({
      id: SECOND_CONFIG_ID,
      state: CertificationGateConfigState.SUPERSEDED,
      supersededAt: new Date('2026-08-04T13:00:00.000Z'),
    });
    const active = gateConfig();
    const findFirst = jest.fn(async () => active);
    const prisma = {
      certificationGateConfig: {
        findMany: jest.fn(async () => [old]),
        findFirst,
      },
    } as unknown as PrismaClient;

    const result = await new GateConfigService(prisma).list(true);

    expect(result.active.id).toBe(CONFIG_ID);
    expect(result.history).toHaveLength(1);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('fails closed when no active gate config exists', async () => {
    const prisma = {
      certificationGateConfig: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaClient;

    await expect(new GateConfigService(prisma).list(false)).rejects.toMatchObject({
      status: 503,
      code: 'DEPENDENCY_UNAVAILABLE',
    });
  });

  it('reports optimistic conflict when the first publish has an unexpected base version', async () => {
    const transaction = {
      $executeRaw: jest.fn(async () => 1),
      certificationGateConfig: { findFirst: jest.fn(async () => null) },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;

    await expect(
      runAsHuman(() =>
        new GateConfigService(prisma).publish({
          baseVersion: 1,
          promotionFreshnessHours: 24,
          gates: [...gates],
          rationale: 'Publish only from the expected predecessor configuration.',
        }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'GATE_CONFIG_VERSION_CONFLICT',
      details: { expectedBaseVersion: 1, currentVersion: null },
    });
  });

  it('publishes the first config without attempting supersession', async () => {
    const created = gateConfig();
    const update = jest.fn();
    const transaction = {
      $executeRaw: jest.fn(async () => 1),
      certificationGateConfig: {
        findFirst: jest.fn(async () => null),
        update,
        create: jest.fn(async () => created),
      },
      auditEvent: { create: jest.fn(async () => ({ id: 'audit-id' })) },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;

    const result = await runAsHuman(() =>
      new GateConfigService(prisma).publish({
        baseVersion: null,
        promotionFreshnessHours: 24,
        gates: [...gates],
        rationale: 'Publish the first governed certification configuration.',
      }),
    );

    expect(result.version).toBe(1);
    expect(update).not.toHaveBeenCalled();
    expect(transaction.certificationGateConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 1 }) }),
    );
  });

  it('atomically supersedes the active config when publishing its successor', async () => {
    const current = gateConfig();
    const created = gateConfig({ id: SECOND_CONFIG_ID, version: 2 });
    const update = jest.fn(async () => current);
    const transaction = {
      $executeRaw: jest.fn(async () => 1),
      certificationGateConfig: {
        findFirst: jest.fn(async () => current),
        update,
        create: jest.fn(async () => created),
      },
      auditEvent: { create: jest.fn(async () => ({ id: 'audit-id' })) },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    } as unknown as PrismaClient;

    const result = await runAsHuman(() =>
      new GateConfigService(prisma).publish({
        baseVersion: 1,
        promotionFreshnessHours: 48,
        gates: [...gates],
        rationale: 'Supersede the baseline after governed threshold review.',
      }),
    );

    expect(result.version).toBe(2);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: CONFIG_ID } }));
    expect(transaction.certificationGateConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
    );
  });
});

describe('MaintenanceService branch behavior', () => {
  const logger = pino({ level: 'silent' });
  const interpretations = {
    deleteExpiredUnattached: jest.fn(async () => 0),
  } as unknown as InterpretationService;

  it('skips work when another process owns the advisory lock', async () => {
    const lockTransaction = {
      $queryRaw: jest.fn(async () => [{ acquired: false }]),
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof lockTransaction) => unknown) =>
        operation(lockTransaction),
      ),
    } as unknown as PrismaClient;
    const certification = { createScheduledRun: jest.fn() } as unknown as CertificationService;

    await new MaintenanceService(prisma, certification, interpretations, jest.fn(), 20, logger).run(
      'scheduled',
    );

    expect(certification.createScheduledRun).not.toHaveBeenCalled();
  });

  it('continues past expected schedule conflicts and enqueues the available champion', async () => {
    const uniqueConflict = new Prisma.PrismaClientKnownRequestError('duplicate schedule key', {
      code: 'P2002',
      clientVersion: '6.6.0',
    });
    const createScheduledRun = jest
      .fn()
      .mockRejectedValueOnce(
        new AppError(409, 'CERTIFICATION_IN_PROGRESS', 'Certification is already active'),
      )
      .mockRejectedValueOnce(new AppError(409, 'RESOURCE_CONFLICT', 'Schedule exists'))
      .mockRejectedValueOnce(uniqueConflict)
      .mockResolvedValueOnce({ runId: RUN_ID });
    const enqueue = jest.fn();
    const transaction = {
      $queryRaw: jest.fn(async () => [{ acquired: true }]),
      auditEvent: { create: jest.fn(async () => ({ id: 'audit-id' })) },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
      certificationRun: { findMany: jest.fn(async () => []) },
      agent: {
        findMany: jest.fn(async () => [
          { id: 'champion-1' },
          { id: 'champion-2' },
          { id: 'champion-3' },
          { id: AGENT_ID },
        ]),
      },
    } as unknown as PrismaClient;

    await new MaintenanceService(
      prisma,
      { createScheduledRun } as unknown as CertificationService,
      interpretations,
      enqueue,
      20,
      logger,
    ).run('scheduled');

    expect(createScheduledRun).toHaveBeenCalledTimes(4);
    expect(enqueue).toHaveBeenCalledWith(RUN_ID);
  });

  it('propagates unexpected scheduling failures', async () => {
    const transaction = {
      $queryRaw: jest.fn(async () => [{ acquired: true }]),
      auditEvent: { create: jest.fn(async () => ({ id: 'audit-id' })) },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
      certificationRun: { findMany: jest.fn(async () => []) },
      agent: { findMany: jest.fn(async () => [{ id: AGENT_ID }]) },
    } as unknown as PrismaClient;
    const failure = new Error('scheduler database failure');

    await expect(
      new MaintenanceService(
        prisma,
        {
          createScheduledRun: jest.fn(async () => Promise.reject(failure)),
        } as unknown as CertificationService,
        interpretations,
        jest.fn(),
        20,
        logger,
      ).run('scheduled'),
    ).rejects.toBe(failure);
  });

  it.each([
    null,
    {
      id: RUN_ID,
      isPromotionEvidence: true,
      resultsAvailability: CertificationResultsAvailability.FULL,
    },
    {
      id: RUN_ID,
      isPromotionEvidence: false,
      resultsAvailability: CertificationResultsAvailability.SUMMARY_ONLY,
    },
  ])('does not prune a run that became protected while waiting for its lock', async (locked) => {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce([{ acquired: true }])
      .mockResolvedValueOnce([]);
    const transaction = {
      $queryRaw: queryRaw,
      certificationRun: {
        findUnique: jest.fn(async () => locked),
        update: jest.fn(),
      },
      evalCaseResult: { deleteMany: jest.fn() },
      auditEvent: { create: jest.fn(async () => ({ id: 'audit-id' })) },
    };
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([{ agentVersionId: AGENT_ID }])
      .mockResolvedValueOnce([{ id: RUN_ID, promotionExpiresAt: null }]);
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof transaction) => unknown) =>
        operation(transaction),
      ),
      certificationRun: { findMany },
    } as unknown as PrismaClient;

    await new MaintenanceService(
      prisma,
      { createScheduledRun: jest.fn() } as unknown as CertificationService,
      interpretations,
      jest.fn(),
      0,
      logger,
    ).run('boot');

    expect(transaction.evalCaseResult.deleteMany).not.toHaveBeenCalled();
  });
});
