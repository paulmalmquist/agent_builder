import { DeterministicDailyBriefProvider } from '@paul-os/runtime';
import type { WorkerConfig } from '../src/config.js';
import { createModelProvider } from '../src/provider.js';

const config: WorkerConfig = {
  environment: 'test',
  logLevel: 'silent',
  concurrency: 1,
  pollMs: 100,
  leaseMs: 60_000,
  heartbeatMs: 15_000,
  shutdownTimeoutMs: 10_000,
  profilePath: '.local/profile/nonexistent-worker-provider-test-profile.yaml',
  provider: {
    kind: 'deterministic',
    policy: 'direct_allowed',
    model: 'daily-brief-fixture',
    timeoutMs: 30_000,
  },
  pricing: {
    inputUsdPerMillionTokens: 3,
    outputUsdPerMillionTokens: 15,
    version: 'test-pricing',
  },
};

describe('createModelProvider', () => {
  it('creates the deterministic CI provider', () => {
    expect(createModelProvider(config)).toBeInstanceOf(DeterministicDailyBriefProvider);
  });

  it('fails closed when gateway-only mode has no adapter', () => {
    expect(() =>
      createModelProvider({
        ...config,
        provider: { ...config.provider, kind: 'gateway', policy: 'gateway_only' },
      }),
    ).toThrow('GATEWAY_PROVIDER_UNAVAILABLE');
  });

  it('does not construct an Anthropic provider without a credential', () => {
    expect(() =>
      createModelProvider({
        ...config,
        provider: { ...config.provider, kind: 'anthropic' },
      }),
    ).toThrow('ANTHROPIC_API_KEY_REQUIRED');
  });
});
