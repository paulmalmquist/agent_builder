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

  it('bounds the same-origin browser self-test runner configuration', () => {
    const defaults = loadTestConfig({ NODE_ENV: 'test' });
    expect(defaults.selfTest).toEqual({
      frontendUrl: 'http://127.0.0.1:5173/selftest?machine=1',
      timeoutMs: 240_000,
    });
    expect(() =>
      loadTestConfig({ NODE_ENV: 'test', SELFTEST_FRONTEND_URL: 'file:///private/path' }),
    ).toThrow();
    expect(() => loadTestConfig({ NODE_ENV: 'test', SELFTEST_TIMEOUT_MS: '9999' })).toThrow();

    expect(
      loadTestConfig({
        NODE_ENV: 'test',
        SELFTEST_FRONTEND_URL: 'http://frontend:8080/selftest?machine=1',
        SELFTEST_BROWSER_EXECUTABLE: '/usr/bin/chromium',
        SELFTEST_TIMEOUT_MS: '300000',
      }).selfTest,
    ).toEqual({
      frontendUrl: 'http://frontend:8080/selftest?machine=1',
      executablePath: '/usr/bin/chromium',
      timeoutMs: 300_000,
    });
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

  it('keeps fixture OIDC out of production and validates the production OIDC contract', () => {
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'production',
        EXECUTION_DISPATCH_MODE: 'external',
        AUTH_MODE: 'local',
      }),
    ).toThrow(/production requires AUTH_MODE=oidc/);
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'production',
        EXECUTION_DISPATCH_MODE: 'external',
        AUTH_MODE: 'static_bearer',
        AUTH_BEARER_TOKEN: 'production-static-token-is-not-allowed',
      }),
    ).toThrow(/production requires AUTH_MODE=oidc/);
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'production',
        EXECUTION_DISPATCH_MODE: 'external',
        AUTH_MODE: 'fixture_oidc',
        FIXTURE_OIDC_SECRET: 'fixture-only-oidc-secret-000000000000',
      }),
    ).toThrow(/forbidden in production/);
    expect(() =>
      loadTestConfig({
        NODE_ENV: 'test',
        AUTH_MODE: 'oidc',
        OIDC_ISSUER: 'http://identity.example.test/tenant',
        OIDC_AUDIENCES: 'paul-os-control-plane',
        OIDC_JWKS_URI: 'https://identity.example.test/tenant/keys',
      }),
    ).toThrow(/HTTPS/);

    const config = loadTestConfig({
      NODE_ENV: 'test',
      AUTH_MODE: 'oidc',
      OIDC_ISSUER: 'https://identity.example.test/tenant',
      OIDC_AUDIENCES: 'paul-os-control-plane,paul-os-cli',
      OIDC_JWKS_URI: 'https://identity.example.test/tenant/keys',
      OIDC_GROUP_CLAIM: 'groups',
    });
    expect(config.auth).toMatchObject({
      enabled: true,
      mode: 'oidc',
      oidc: {
        issuer: 'https://identity.example.test/tenant',
        audiences: ['paul-os-control-plane', 'paul-os-cli'],
        groupClaim: 'groups',
      },
    });
  });
});
