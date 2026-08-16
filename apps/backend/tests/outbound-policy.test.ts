import { OutboundHttpError, OutboundHttpPolicy } from '../src/connectors/outbound-policy.js';
import { AppError } from '../src/errors.js';

const options = {
  timeoutMs: 1000,
  maxRetries: 2,
  baseDelayMs: 10,
  cacheTtlMs: 1000,
  circuitFailureThreshold: 1,
  circuitResetMs: 5000,
};

describe('outbound HTTP resilience policy', () => {
  it('retries a 429 with jitter and caches the successful descriptor result', async () => {
    const delay = jest.fn(() => Promise.resolve());
    const policy = new OutboundHttpPolicy(
      options,
      () => 100,
      () => 0.5,
      delay,
    );
    const operation = jest
      .fn<Promise<{ value: string }>, [AbortSignal]>()
      .mockRejectedValueOnce(new OutboundHttpError(429, 'rate limited'))
      .mockResolvedValue({ value: 'cached' });

    await expect(policy.execute('confluence', 'descriptor-1', operation)).resolves.toEqual({
      value: 'cached',
    });
    await expect(policy.execute('confluence', 'descriptor-1', operation)).resolves.toEqual({
      value: 'cached',
    });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledWith(10);
  });

  it('opens the circuit after a terminal provider failure', async () => {
    const policy = new OutboundHttpPolicy(options, () => 100);
    await expect(
      policy.execute('confluence', 'descriptor-1', () =>
        Promise.reject(new OutboundHttpError(403, 'forbidden')),
      ),
    ).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
    await expect(
      policy.execute('confluence', 'descriptor-2', () => Promise.resolve('unreachable')),
    ).rejects.toMatchObject({ status: 503, code: 'DEPENDENCY_UNAVAILABLE' });
  });

  it('preserves non-retryable domain errors without poisoning the dependency circuit', async () => {
    const policy = new OutboundHttpPolicy(options, () => 100);
    await expect(
      policy.execute('bigquery', 'over-budget', () =>
        Promise.reject(new AppError(400, 'QUERY_BUDGET_EXCEEDED', 'Dry run is over budget')),
      ),
    ).rejects.toMatchObject({ status: 400, code: 'QUERY_BUDGET_EXCEEDED' });
    await expect(
      policy.execute('bigquery', 'safe-descriptor', () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
  });
});
