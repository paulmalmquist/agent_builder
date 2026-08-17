'use strict';

const SAFE_DATABASE_NAME = /(?:^|[_-])(test|integration|verify|coverage)(?:$|[_-])/i;

/** @param {string} databaseUrl */
function databaseNameFromUrl(databaseUrl) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('RUN_DATABASE_INTEGRATION requires a valid PostgreSQL DATABASE_URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('RUN_DATABASE_INTEGRATION requires a PostgreSQL DATABASE_URL.');
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).trim();
  if (databaseName.length === 0) {
    throw new Error('RUN_DATABASE_INTEGRATION requires a named disposable database.');
  }
  return databaseName;
}

/** @param {NodeJS.ProcessEnv} [environment] */
function assertSafeDatabaseIntegrationEnvironment(environment = process.env) {
  if (environment.RUN_DATABASE_INTEGRATION !== 'true') return;
  const databaseUrl = environment.DATABASE_URL;
  if (typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0) {
    throw new Error('RUN_DATABASE_INTEGRATION=true requires DATABASE_URL.');
  }
  const databaseName = databaseNameFromUrl(databaseUrl);
  if (!SAFE_DATABASE_NAME.test(databaseName)) {
    throw new Error(
      `Refusing database integration tests against "${databaseName}". ` +
        'Use a disposable database whose name contains test, integration, verify, or coverage.',
    );
  }
}

assertSafeDatabaseIntegrationEnvironment();

module.exports = { assertSafeDatabaseIntegrationEnvironment, databaseNameFromUrl };
