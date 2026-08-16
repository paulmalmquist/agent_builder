import { loadConfig } from '../src/config.js';

describe('backend configuration safety', () => {
  it('has no implicit cloud project and leaves authentication disabled for fixture mode', () => {
    const config = loadConfig({ NODE_ENV: 'test', BIGQUERY_ENABLED: 'false' });
    expect(config.bigQuery.projectId).toBeNull();
    expect(config.auth).toEqual({ enabled: false, actorId: 'local-user' });
    expect(config.providers.bigquery).toBe(false);
    expect(config.host).toBe('127.0.0.1');
  });

  it('requires both an explicit project and bearer token before BigQuery can be enabled', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', BIGQUERY_ENABLED: 'true' })).toThrow(
      /GOOGLE_CLOUD_PROJECT is required/,
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        BIGQUERY_ENABLED: 'true',
        GOOGLE_CLOUD_PROJECT: 'governed-project',
      }),
    ).toThrow(/AUTH_BEARER_TOKEN is required/);

    const config = loadConfig({
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
    expect(() => loadConfig({ NODE_ENV: 'test', CONFLUENCE_ENABLED: 'true' })).toThrow(
      /AUTH_BEARER_TOKEN is required/,
    );

    const config = loadConfig({
      NODE_ENV: 'test',
      CONFLUENCE_ENABLED: 'true',
      AUTH_BEARER_TOKEN: 'a-secure-token-with-24-chars',
    });
    expect(config.providers.confluence).toBe(true);
    expect(config.providers.bigquery).toBe(false);
  });
});
