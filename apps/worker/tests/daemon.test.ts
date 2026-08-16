import { pino } from 'pino';
import type { WorkerConfig } from '../src/config.js';
import { WorkerDaemon } from '../src/daemon.js';
import type { ExecutionEngine } from '../src/engine.js';

const config: WorkerConfig = {
  environment: 'test',
  logLevel: 'silent',
  workerId: 'worker:test',
  concurrency: 1,
  pollMs: 5,
  leaseMs: 100,
  heartbeatMs: 5,
  shutdownTimeoutMs: 20,
  profilePath: '.local/profile/nonexistent-worker-daemon-test-profile.yaml',
  provider: {
    kind: 'deterministic',
    policy: 'direct_allowed',
    model: 'daily-brief-fixture',
    timeoutMs: 50,
  },
  pricing: {
    inputUsdPerMillionTokens: 3,
    outputUsdPerMillionTokens: 15,
    version: 'test-pricing',
  },
};

describe('WorkerDaemon', () => {
  it('recovers before polling and stops an idle worker cleanly', async () => {
    const calls: string[] = [];
    const engine = {
      recover: () => {
        calls.push('recover');
        return Promise.resolve();
      },
      runNext: (workerId: string) => {
        calls.push(workerId);
        return Promise.resolve(false);
      },
      abortActive: jest.fn(),
      activeCount: () => 0,
    } as unknown as ExecutionEngine;
    const daemon = new WorkerDaemon(engine, config, pino({ level: 'silent' }));
    await daemon.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await daemon.stop();
    expect(calls[0]).toBe('recover');
    expect(calls).toContain('worker:test:1');
  });

  it('aborts active provider work after the graceful-shutdown deadline', async () => {
    let release: (() => void) | undefined;
    const abortActive = jest.fn(() => release?.());
    const engine = {
      recover: () => Promise.resolve(),
      runNext: () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
      abortActive,
      activeCount: () => 1,
    } as unknown as ExecutionEngine;
    const daemon = new WorkerDaemon(engine, config, pino({ level: 'silent' }));
    await daemon.start();
    await daemon.stop();
    expect(abortActive).toHaveBeenCalledTimes(1);
  });
});
