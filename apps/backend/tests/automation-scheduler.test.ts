import { pino } from 'pino';
import { AutomationScheduler } from '../src/automation/scheduler.js';
import { currentRequestContext } from '../src/request-context.js';

const emptyResult = {
  runIds: [] as string[],
  claimedSchedules: 0,
  dispatchesCreated: 0,
  runsCreated: 0,
  awaitingApproval: 0,
  failedDispatches: 0,
};

describe('AutomationScheduler', () => {
  afterEach(() => jest.useRealTimers());

  it('can be disabled and remains idempotent when start is called repeatedly', async () => {
    const scheduleDue = jest.fn(() => Promise.resolve(emptyResult));
    const scheduler = new AutomationScheduler(
      { scheduleDue },
      jest.fn(),
      'external',
      pino({ level: 'silent' }),
      false,
      1000,
      25,
    );

    await scheduler.start();
    await scheduler.start();
    await scheduler.stop();
    expect(scheduleDue).not.toHaveBeenCalled();
  });

  it('ticks on boot under the system actor and enqueues new runs only for in-process dispatch', async () => {
    const actors: string[] = [];
    const scheduleDue = jest.fn(() => {
      actors.push(currentRequestContext().actor.id);
      return Promise.resolve({ ...emptyResult, runIds: ['run-1'], runsCreated: 1 });
    });
    const enqueue = jest.fn();
    const scheduler = new AutomationScheduler(
      { scheduleDue },
      enqueue,
      'in_process',
      pino({ level: 'silent' }),
      true,
      60_000,
      7,
    );

    await scheduler.start();
    await scheduler.start();
    await scheduler.stop();

    expect(scheduleDue).toHaveBeenCalledTimes(1);
    expect(scheduleDue).toHaveBeenCalledWith(expect.any(Date), 7);
    expect(enqueue).toHaveBeenCalledWith('run-1');
    expect(actors).toEqual(['system:background']);
  });

  it('leaves queued runs for the durable worker in external dispatch mode', async () => {
    const enqueue = jest.fn();
    const scheduler = new AutomationScheduler(
      {
        scheduleDue: jest.fn(() =>
          Promise.resolve({ ...emptyResult, runIds: ['worker-run'], runsCreated: 1 }),
        ),
      },
      enqueue,
      'external',
      pino({ level: 'silent' }),
      true,
      60_000,
      25,
    );

    await scheduler.start();
    await scheduler.stop();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('uses recursive non-overlapping ticks and waits for an in-flight tick on stop', async () => {
    jest.useFakeTimers();
    let release: (() => void) | undefined;
    let invocation = 0;
    const scheduleDue = jest.fn(() => {
      invocation += 1;
      if (invocation === 1) return Promise.resolve(emptyResult);
      return new Promise<typeof emptyResult>((resolve) => {
        release = () => resolve(emptyResult);
      });
    });
    const scheduler = new AutomationScheduler(
      { scheduleDue },
      jest.fn(),
      'external',
      pino({ level: 'silent' }),
      true,
      1000,
      25,
    );
    await scheduler.start();

    jest.advanceTimersByTime(1000);
    await Promise.resolve();
    expect(scheduleDue).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(10_000);
    expect(scheduleDue).toHaveBeenCalledTimes(2);

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    release?.();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('contains tick failures and continues polling', async () => {
    jest.useFakeTimers();
    const scheduleDue = jest
      .fn<Promise<typeof emptyResult>, [Date, number]>()
      .mockRejectedValueOnce(new Error('temporary database error'))
      .mockResolvedValue(emptyResult);
    const scheduler = new AutomationScheduler(
      { scheduleDue },
      jest.fn(),
      'external',
      pino({ level: 'silent' }),
      true,
      1000,
      25,
    );

    await scheduler.start();
    await jest.advanceTimersByTimeAsync(1000);
    await scheduler.stop();
    expect(scheduleDue).toHaveBeenCalledTimes(2);
  });
});
