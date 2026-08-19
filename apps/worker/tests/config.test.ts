import { loadWorkerConfig } from '../src/config.js';

describe('loadWorkerConfig', () => {
  it('loads safe deterministic defaults', () => {
    const config = loadWorkerConfig({ NODE_ENV: 'test' });
    expect(config.provider.kind).toBe('deterministic');
    expect(config.provider.policy).toBe('direct_allowed');
    expect(config.concurrency).toBe(2);
    expect(config.profilePath).toMatch(/[\\/].local[\\/]profile[\\/]profile\.yaml$/);
    expect(config.heartbeatMs * 2).toBeLessThan(config.leaseMs);
  });

  it('resolves an explicit private-profile path for execution-time digest verification', () => {
    const config = loadWorkerConfig({
      NODE_ENV: 'test',
      PAUL_OS_PROFILE_PATH: 'private/profile.yaml',
    });
    expect(config.profilePath).toMatch(/[\\/]private[\\/]profile\.yaml$/);
  });

  it('requires Anthropic credentials and a model', () => {
    expect(() => loadWorkerConfig({ NODE_ENV: 'test', MODEL_PROVIDER: 'anthropic' })).toThrow(
      /ANTHROPIC_API_KEY and MODEL_NAME/,
    );
  });

  it('fails closed when gateway-only policy has no gateway selection', () => {
    expect(() => loadWorkerConfig({ NODE_ENV: 'test', PROVIDER_POLICY: 'gateway_only' })).toThrow(
      /gateway_only requires MODEL_PROVIDER=gateway/,
    );
  });

  it('rejects a heartbeat that cannot safely renew its lease', () => {
    expect(() =>
      loadWorkerConfig({
        NODE_ENV: 'test',
        WORKER_LEASE_MS: '10000',
        WORKER_HEARTBEAT_MS: '5000',
      }),
    ).toThrow(/Heartbeat interval/);
  });
});
