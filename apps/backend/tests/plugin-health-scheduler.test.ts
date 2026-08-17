import type { Logger } from 'pino';
import { PluginHealthScheduler } from '../src/plugins/health-scheduler.js';
import { currentRequestPrincipal } from '../src/request-context.js';
import {
  effectivePluginHealthIntervalMs,
  pluginClassificationAllowed,
  type PluginService,
} from '../src/services/plugin-service.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('PluginHealthScheduler', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('caps declared probe cadences so degradation can surface within sixty seconds', () => {
    expect(effectivePluginHealthIntervalMs(300)).toBe(60_000);
    expect(effectivePluginHealthIntervalMs(30)).toBe(30_000);
  });

  it('hides restricted Plugins until the approved gateway policy is active', () => {
    expect(pluginClassificationAllowed('public', 'direct_allowed')).toBe(true);
    expect(pluginClassificationAllowed('internal', 'direct_allowed')).toBe(true);
    expect(pluginClassificationAllowed('restricted', 'direct_allowed')).toBe(false);
    expect(pluginClassificationAllowed('restricted', 'gateway_only')).toBe(true);
  });

  it('does nothing when disabled', async () => {
    const checkDueHealth = jest.fn();
    const scheduler = new PluginHealthScheduler(
      { checkDueHealth } as unknown as PluginService,
      { warn: jest.fn() } as unknown as Logger,
      false,
    );
    await scheduler.start();
    expect(checkDueHealth).not.toHaveBeenCalled();
  });

  it('runs immediately as the system principal, repeats, and stops cleanly', async () => {
    jest.useFakeTimers();
    const principals: string[] = [];
    const checkDueHealth = jest.fn(() => {
      principals.push(currentRequestPrincipal().actorId);
      return Promise.resolve({ checked: 1, failed: 0 });
    });
    const scheduler = new PluginHealthScheduler(
      { checkDueHealth } as unknown as PluginService,
      { warn: jest.fn() } as unknown as Logger,
      true,
      30_000,
      25,
    );
    await scheduler.start();
    expect(checkDueHealth).toHaveBeenCalledWith(25);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(checkDueHealth).toHaveBeenCalledTimes(2);
    expect(principals).toEqual(['system:background', 'system:background']);
    scheduler.stop();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(checkDueHealth).toHaveBeenCalledTimes(2);
  });

  it('prevents overlapping cycles and never logs adapter error content', async () => {
    jest.useFakeTimers();
    const inFlight = deferred<{ checked: number; failed: number }>();
    const checkDueHealth = jest
      .fn()
      .mockResolvedValueOnce({ checked: 0, failed: 0 })
      .mockImplementationOnce(() => inFlight.promise)
      .mockRejectedValueOnce(new Error('env://PRIVATE_PLUGIN_TOKEN'));
    const warn = jest.fn();
    const scheduler = new PluginHealthScheduler(
      { checkDueHealth } as unknown as PluginService,
      { warn } as unknown as Logger,
      true,
      30_000,
    );
    await scheduler.start();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(checkDueHealth).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(checkDueHealth).toHaveBeenCalledTimes(2);
    inFlight.resolve({ checked: 1, failed: 0 });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30_000);
    expect(checkDueHealth).toHaveBeenCalledTimes(3);
    await Promise.resolve();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE_PLUGIN_TOKEN');
    expect(warn).toHaveBeenCalledWith('Plugin health-check cycle could not complete');
    scheduler.stop();
  });
});
