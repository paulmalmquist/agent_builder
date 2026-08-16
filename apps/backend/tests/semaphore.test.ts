import { Semaphore } from '../src/generation/semaphore.js';

describe('Semaphore', () => {
  it('never exceeds its configured generation concurrency', async () => {
    const semaphore = new Semaphore(2);
    let active = 0;
    let maximum = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operations = Array.from({ length: 5 }, (_, index) =>
      semaphore.use(async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        if (index < 2) await gate;
        active -= 1;
      }),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(maximum).toBe(2);
    release?.();
    await Promise.all(operations);
    expect(active).toBe(0);
  });

  it('rejects invalid capacities', () => {
    expect(() => new Semaphore(0)).toThrow('positive integer');
  });
});
