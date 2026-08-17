type GuardModule = {
  assertSafeDatabaseIntegrationEnvironment: (environment?: NodeJS.ProcessEnv) => void;
  databaseNameFromUrl: (databaseUrl: string) => string;
};

const { assertSafeDatabaseIntegrationEnvironment, databaseNameFromUrl } =
  jest.requireActual<GuardModule>('../../../test-support/database-integration-guard.cjs');

describe('database integration safety guard', () => {
  it('permits the disposable CI database', () => {
    expect(() =>
      assertSafeDatabaseIntegrationEnvironment({
        RUN_DATABASE_INTEGRATION: 'true',
        DATABASE_URL:
          'postgresql://fixture:fixture@localhost:5432/agent_builder_test?schema=public',
      }),
    ).not.toThrow();
  });

  it.each(['paul_os_integration_20260817', 'agent-builder-verify', 'coverage_run_test'])(
    'permits a clearly named disposable database: %s',
    (databaseName) => {
      expect(() =>
        assertSafeDatabaseIntegrationEnvironment({
          RUN_DATABASE_INTEGRATION: 'true',
          DATABASE_URL: `postgresql://fixture:fixture@localhost:5432/${databaseName}`,
        }),
      ).not.toThrow();
    },
  );

  it('rejects the persistent Compose database', () => {
    expect(() =>
      assertSafeDatabaseIntegrationEnvironment({
        RUN_DATABASE_INTEGRATION: 'true',
        DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/agent_builder?schema=public',
      }),
    ).toThrow(/Refusing database integration tests against "agent_builder"/);
  });

  it('fails closed when database configuration is absent or ambiguous', () => {
    expect(() =>
      assertSafeDatabaseIntegrationEnvironment({ RUN_DATABASE_INTEGRATION: 'true' }),
    ).toThrow(/requires DATABASE_URL/);
    expect(() =>
      assertSafeDatabaseIntegrationEnvironment({
        RUN_DATABASE_INTEGRATION: 'true',
        DATABASE_URL: 'postgresql://fixture:fixture@localhost:5432/postgres',
      }),
    ).toThrow(/disposable database/);
  });

  it('does not inspect DATABASE_URL when database integration is disabled', () => {
    expect(() =>
      assertSafeDatabaseIntegrationEnvironment({
        RUN_DATABASE_INTEGRATION: 'false',
        DATABASE_URL: 'not-a-url',
      }),
    ).not.toThrow();
  });

  it('extracts URL-encoded PostgreSQL database names without exposing credentials', () => {
    expect(databaseNameFromUrl('postgresql://fixture:secret@localhost:5432/paul%5Fos%5Ftest')).toBe(
      'paul_os_test',
    );
  });
});
