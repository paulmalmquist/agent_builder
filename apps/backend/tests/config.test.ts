import { loadConfig } from '../src/config.js';

const loadTestConfig = (environment: NodeJS.ProcessEnv) =>
  loadConfig({ ALLOW_UNVERIFIED_REPOSITORY_IMPORTS: 'true', ...environment });

describe('backend configuration safety', () => {
  it('requires verified server-owned import provenance unless local mode opts out', () => {
    expect(() => loadConfig({ NODE_ENV: 'test' })).toThrow(/REPOSITORY_SOURCE_COMMIT/);
    const verified = loadConfig({
      NODE_ENV: 'test',
      REPOSITORY_SOURCE_COMMIT: '84cd1e5',
    });
    expect(verified.repositorySourceCommit).toBe('84cd1e5');
    expect(verified.repositorySourceVerified).toBe(true);
    const local = loadTestConfig({
      NODE_ENV: 'test',
      REPOSITORY_SOURCE_COMMIT: 'caller-controlled-value',
    });
    expect(local.repositorySourceCommit).toBe('local-unverified');
    expect(local.repositorySourceVerified).toBe(false);
  });

  it('has no implicit cloud project and leaves authentication disabled for fixture mode', () => {
    const config = loadTestConfig({ NODE_ENV: 'test', BIGQUERY_ENABLED: 'false' });
    expect(config.bigQuery.projectId).toBeNull();
    expect(config.auth).toEqual({ enabled: false, actorId: 'local-user' });
    expect(config.providers.bigquery).toBe(false);
    expect(config.host).toBe('127.0.0.1');
    expect(config.automationScheduler).toEqual({
      enabled: true,
      intervalMs: 30_000,
      batchSize: 25,
    });
    expect(config.profilePath).toMatch(/[\\/].local[\\/]profile[\\/]profile\.yaml$/);
  });

  it('validates autonomous scheduler bounds and allows an explicit private-profile path', () => {
    expect(() =>
      loadTestConfig({ NODE_ENV: 'test', AUTOMATION_SCHEDULER_INTERVAL_MS: '999' }),
    ).toThrow();
    expect(() =>
      loadTestConfig({ NODE_ENV: 'test', AUTOMATION_SCHEDULER_BATCH_SIZE: '101' }),
    ).toThrow();

    const config = loadTestConfig({
      NODE_ENV: 'test',
      AUTOMATION_SCHEDULER_ENABLED: 'false',
      AUTOMATION_SCHEDULER_INTERVAL_MS: '45000',
      AUTOMATION_SCHEDULER_BATCH_SIZE: '10',
      PAUL_OS_PROFILE_PATH: 'private/profile.yaml',
    });
    expect(config.automationScheduler).toEqual({
      enabled: false,
      intervalMs: 45_000,
      batchSize: 10,
    });
    expect(config.profilePath).toMatch(/[\\/]private[\\/]profile\.yaml$/);
  });

  it('requires both an explicit project and bearer token before BigQuery can be enabled', () => {
    expect(() => loadTestConfig({ NODE_ENV: 'test', BIGQUERY_ENABLED: 'true' })).toThrow(
      /GOOGLE_CLOUD_PROJECT is required/,
    );
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'test',
        BIGQUERY_ENABLED: 'true',
        GOOGLE_CLOUD_PROJECT: 'governed-project',
      }),
    ).toThrow(/AUTH_BEARER_TOKEN is required/);

    const config = loadTestConfig({
      NODE_ENV: 'test',
      BIGQUERY_ENABLED: 'true',
      GOOGLE_CLOUD_PROJECT: 'governed-project',
      AUTH_BEARER_TOKEN: 'a-secure-token-with-24-chars',
      AUTH_ACTOR_ID: 'work-user@example.test',
    });
    expect(config.bigQuery.projectId).toBe('governed-project');
    expect(config.auth).toMatchObject({
      enabled: true,
      actorId: 'work-user@example.test',
    });
  });

  it('requires authentication independently for every future live provider', () => {
    expect(() => loadTestConfig({ NODE_ENV: 'test', CONFLUENCE_ENABLED: 'true' })).toThrow(
      /AUTH_BEARER_TOKEN is required/,
    );

    const config = loadTestConfig({
      NODE_ENV: 'test',
      CONFLUENCE_ENABLED: 'true',
      AUTH_BEARER_TOKEN: 'a-secure-token-with-24-chars',
    });
    expect(config.providers.confluence).toBe(true);
    expect(config.providers.bigquery).toBe(false);
  });

  it('keeps model execution deterministic by default and fails closed for restricted transport', () => {
    const fixture = loadTestConfig({ NODE_ENV: 'test' });
    expect(fixture.model).toMatchObject({
      provider: 'deterministic',
      providerPolicy: 'direct_allowed',
      name: 'daily-brief-fixture',
    });
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'test',
        MODEL_PROVIDER: 'anthropic',
        MODEL_NAME: 'configured-model',
      }),
    ).toThrow(/ANTHROPIC_API_KEY/);
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'test',
        PROVIDER_POLICY: 'gateway_only',
        MODEL_PROVIDER: 'deterministic',
      }),
    ).toThrow(/gateway_only/);
    expect(
      loadTestConfig({
        NODE_ENV: 'test',
        PROVIDER_POLICY: 'gateway_only',
        MODEL_PROVIDER: 'gateway',
        EXECUTION_DISPATCH_MODE: 'external',
      }).model.provider,
    ).toBe('gateway');
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'test',
        HOST: '0.0.0.0',
        MODEL_PROVIDER: 'anthropic',
        MODEL_NAME: 'configured-model',
        ANTHROPIC_API_KEY: 'test-only-model-key-value',
      }),
    ).toThrow(/AUTH_BEARER_TOKEN is required for non-loopback model execution/);
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'test',
        HOST: '0.0.0.0',
        MODEL_PROVIDER: 'gateway',
        EXECUTION_DISPATCH_MODE: 'external',
      }),
    ).toThrow(/AUTH_BEARER_TOKEN is required for non-loopback model execution/);
    expect(
      loadTestConfig({
        NODE_ENV: 'test',
        HOST: '0.0.0.0',
        MODEL_PROVIDER: 'anthropic',
        MODEL_NAME: 'configured-model',
        ANTHROPIC_API_KEY: 'test-only-model-key-value',
        AUTH_BEARER_TOKEN: 'a-secure-token-with-24-chars',
        EXECUTION_DISPATCH_MODE: 'external',
      }).auth.enabled,
    ).toBe(true);
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'production',
        EXECUTION_DISPATCH_MODE: 'in_process',
      }),
    ).toThrow(/fixture-only/);
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'test',
        MODEL_PROVIDER: 'anthropic',
        MODEL_NAME: 'configured-model',
        ANTHROPIC_API_KEY: 'test-only-model-key-value',
        EXECUTION_DISPATCH_MODE: 'in_process',
      }),
    ).toThrow(/fixture-only/);
  });
});
