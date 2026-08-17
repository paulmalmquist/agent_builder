import type { ExecutionRun, Prisma } from '@prisma/client';
import {
  recordDigestDeliveryForRun,
  summarizePlatformEventsForDigest,
} from '../src/services/attention-service.js';

describe('Quiet Console digest boundaries', () => {
  it('delivers every bounded allowlisted activity event without copying payloads', () => {
    const startedAt = new Date('2026-08-16T10:00:00.000Z');
    const endedAt = new Date('2026-08-16T12:00:00.000Z');
    const records = Array.from({ length: 25 }, (_, index) => ({
      kind: index === 24 ? 'execution.succeeded' : 'private.connector.event',
      entityId: `entity-${index}`,
      summary:
        index === 24
          ? { costUsd: 0.42, token: 'must-not-appear' }
          : { password: 'must-not-appear', sourcePayload: `private-${index}` },
      occurredAt: new Date(startedAt.getTime() + index * 1_000),
    }));

    const summary = summarizePlatformEventsForDigest(records, startedAt, endedAt);

    expect(summary).toMatchObject({
      eventCount: 25,
      omittedEventCount: 0,
      totalCostUsd: 0.42,
    });
    expect(summary.eventLines).toHaveLength(25);
    expect(summary.eventLines.at(-1)).toBe('A run completed for $0.42.');
    expect(summary.eventLines.every((line) => line.length <= 240)).toBe(true);
    expect(summary.eventLines.join(' ')).not.toMatch(/must-not-appear|private-\d|password|token/i);

    expect(() =>
      summarizePlatformEventsForDigest(
        Array.from({ length: 251 }, (_, index) => ({
          kind: 'execution.succeeded',
          entityId: `run-${index}`,
          summary: {},
          occurredAt: new Date(startedAt.getTime() + index),
        })),
        startedAt,
        endedAt,
      ),
    ).toThrow('cannot be delivered without omission');
  });

  it('fails closed when a delivered digest has no cursor', async () => {
    const attemptCreate = jest.fn();
    const transaction = {
      digestSnapshot: {
        findUnique: jest.fn(() =>
          Promise.resolve({
            id: '10000000-0000-4000-8000-000000000001',
            workspaceId: '20000000-0000-4000-8000-000000000001',
            departmentId: '30000000-0000-4000-8000-000000000001',
            departmentScopeKey: '30000000-0000-4000-8000-000000000001',
            actorId: 'human:test',
            eventSequenceFrom: 1n,
            eventSequenceThrough: 1n,
            attempts: [],
          }),
        ),
      },
      attentionCursor: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        updateMany: jest.fn(),
      },
      digestDeliveryAttempt: { create: attemptCreate },
      $executeRaw: jest.fn(() => Promise.resolve(1)),
    } as unknown as Prisma.TransactionClient;
    const run = {
      id: '40000000-0000-4000-8000-000000000001',
      workspaceId: '20000000-0000-4000-8000-000000000001',
      departmentId: '30000000-0000-4000-8000-000000000001',
      digestSnapshotId: '10000000-0000-4000-8000-000000000001',
    } satisfies Pick<ExecutionRun, 'id' | 'workspaceId' | 'departmentId' | 'digestSnapshotId'>;

    await expect(
      recordDigestDeliveryForRun(transaction, run, { state: 'delivered', costUsd: 0.1 }),
    ).rejects.toMatchObject({ code: 'DIGEST_CURSOR_MISSING' });
    expect(attemptCreate).not.toHaveBeenCalled();
  });
});
