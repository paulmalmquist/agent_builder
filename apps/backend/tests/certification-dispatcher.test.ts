import { pino } from 'pino';
import { CertificationDispatcher } from '../src/certification/dispatcher.js';
import { millisecondsUntilNextUtcHour } from '../src/maintenance/scheduler.js';

describe('CertificationDispatcher', () => {
  it('reaps persisted work, resumes queued runs, and deduplicates scheduling', async () => {
    let release: (() => void) | undefined;
    const executeRun = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const work = {
      reapRunningRuns: jest.fn(() => Promise.resolve(2)),
      queuedRunIds: jest.fn(() => Promise.resolve(['run-1'])),
      executeRun,
      failRun: jest.fn(() => Promise.resolve()),
    };
    const dispatcher = new CertificationDispatcher(1, work, pino({ level: 'silent' }), 10_000);
    await dispatcher.recoverAndResume();
    dispatcher.enqueue('run-1');
    await new Promise((resolve) => setImmediate(resolve));
    expect(work.reapRunningRuns).toHaveBeenCalledTimes(1);
    expect(executeRun).toHaveBeenCalledTimes(1);
    release?.();
  });

  it('persists a structured failure when execution rejects', async () => {
    const work = {
      reapRunningRuns: jest.fn(() => Promise.resolve(0)),
      queuedRunIds: jest.fn(() => Promise.resolve([])),
      executeRun: jest.fn(() => Promise.reject(new Error('executor unavailable'))),
      failRun: jest.fn(() => Promise.resolve()),
    };
    const dispatcher = new CertificationDispatcher(1, work, pino({ level: 'silent' }), 10_000);
    dispatcher.enqueue('run-2');
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(work.failRun).toHaveBeenCalledWith(
      'run-2',
      'CERTIFICATION_EXECUTION_ERROR',
      'executor unavailable',
    );
  });

  it('marks a timed-out run while retaining the concurrency permit until late work settles', async () => {
    let release: (() => void) | undefined;
    const work = {
      reapRunningRuns: jest.fn(() => Promise.resolve(0)),
      queuedRunIds: jest.fn(() => Promise.resolve([])),
      executeRun: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      ),
      failRun: jest.fn(() => Promise.resolve()),
    };
    const dispatcher = new CertificationDispatcher(1, work, pino({ level: 'silent' }), 5);
    dispatcher.enqueue('run-timeout');
    dispatcher.enqueue('run-next');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(work.failRun).toHaveBeenCalledWith(
      'run-timeout',
      'CERTIFICATION_TIMEOUT',
      'Certification exceeded 5ms',
    );
    expect(work.executeRun).toHaveBeenCalledTimes(1);
    release?.();
    await new Promise((resolve) => setImmediate(resolve));
    expect(work.executeRun).toHaveBeenCalledTimes(2);
    release?.();
  });
});

describe('maintenance scheduling', () => {
  it('calculates the next requested UTC hour', () => {
    expect(millisecondsUntilNextUtcHour(new Date('2026-08-04T01:30:00.000Z'), 2)).toBe(
      30 * 60 * 1000,
    );
    expect(millisecondsUntilNextUtcHour(new Date('2026-08-04T02:00:00.000Z'), 2)).toBe(
      24 * 60 * 60 * 1000,
    );
  });
});
