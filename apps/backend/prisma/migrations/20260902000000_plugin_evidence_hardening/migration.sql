BEGIN;

CREATE OR REPLACE FUNCTION "protect_plugin_scope_snapshots"()
RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'AuthorityGrant'
     AND NEW."pluginScopes" IS DISTINCT FROM OLD."pluginScopes" THEN
    RAISE EXCEPTION 'Authority Plugin scopes are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'ExecutionRun'
     AND NEW."requiredPluginScopes" IS DISTINCT FROM OLD."requiredPluginScopes" THEN
    RAISE EXCEPTION 'Run Plugin requirements are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AuthorityGrant_plugin_scopes_immutable" ON "AuthorityGrant";
CREATE TRIGGER "AuthorityGrant_plugin_scopes_immutable"
  BEFORE UPDATE OF "pluginScopes" ON "AuthorityGrant"
  FOR EACH ROW EXECUTE FUNCTION "protect_plugin_scope_snapshots"();

DROP TRIGGER IF EXISTS "ExecutionRun_plugin_scopes_immutable" ON "ExecutionRun";
CREATE TRIGGER "ExecutionRun_plugin_scopes_immutable"
  BEFORE UPDATE OF "requiredPluginScopes" ON "ExecutionRun"
  FOR EACH ROW EXECUTE FUNCTION "protect_plugin_scope_snapshots"();

CREATE OR REPLACE FUNCTION "enforce_plugin_invocation"()
RETURNS trigger AS $$
DECLARE
  install_version UUID;
  install_digest VARCHAR(64);
  install_workspace UUID;
  install_department UUID;
  install_state "PluginInstallationState";
  run_workspace UUID;
  run_department UUID;
  run_entry UUID;
  run_context VARCHAR(64);
  run_grant UUID;
  run_state "ExecutionRunState";
  prior "PluginInvocation"%ROWTYPE;
BEGIN
  IF NEW."runId" IS NULL OR NEW."sequence" NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Plugin invocation must be a two-event run sequence'
      USING ERRCODE = '23514';
  END IF;
  SELECT "pluginVersionId", "pluginDigest", "workspaceId", "departmentId", "state"
    INTO install_version, install_digest, install_workspace, install_department, install_state
  FROM "PluginInstallation" WHERE "id" = NEW."installationId";
  SELECT "workspaceId", "departmentId", "entryResourceVersionId", "contextDigest", "authorityGrantId", "state"
    INTO run_workspace, run_department, run_entry, run_context, run_grant, run_state
  FROM "ExecutionRun" WHERE "id" = NEW."runId";
  IF install_version IS NULL OR run_entry IS NULL
     OR NEW."pluginVersionId" IS DISTINCT FROM install_version
     OR NEW."pluginDigest" IS DISTINCT FROM install_digest
     OR NEW."workspaceId" IS DISTINCT FROM run_workspace
     OR NEW."departmentId" IS DISTINCT FROM run_department
     OR NEW."workspaceId" IS DISTINCT FROM install_workspace
     OR NOT (install_department IS NULL OR install_department IS NOT DISTINCT FROM run_department)
     OR NOT EXISTS (
       SELECT 1 FROM "RunPluginRequirement" requirement
       WHERE requirement."runId" = NEW."runId"
         AND requirement."installationId" = NEW."installationId"
         AND requirement."pluginVersionId" = NEW."pluginVersionId"
         AND requirement."pluginDigest" = NEW."pluginDigest"
         AND requirement."capabilityName" = NEW."toolName"
         AND requirement."effect" = NEW."effect"
         AND requirement."contextDigest" = run_context
     ) THEN
    RAISE EXCEPTION 'Plugin invocation exact run or requirement binding mismatch'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."sequence" = 1 THEN
    IF NEW."state" <> 'running'::"PluginInvocationState"
       OR NEW."responseDigest" IS NOT NULL
       OR NEW."errorCode" IS NOT NULL
       OR NEW."startedAt" IS NULL
       OR NEW."finishedAt" IS NOT NULL
       OR install_state <> 'enabled'::"PluginInstallationState"
       OR run_state <> 'running'::"ExecutionRunState"
       OR run_grant IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM "AuthorityGrant" authority
         JOIN "RunPluginRequirement" requirement
           ON requirement."runId" = NEW."runId"
          AND requirement."installationId" = NEW."installationId"
          AND requirement."pluginVersionId" = NEW."pluginVersionId"
          AND requirement."pluginDigest" = NEW."pluginDigest"
          AND requirement."capabilityName" = NEW."toolName"
          AND requirement."effect" = NEW."effect"
          AND requirement."contextDigest" = run_context,
           LATERAL jsonb_array_elements(authority."pluginScopes"::jsonb) scope
         WHERE authority."id" = run_grant
           AND authority."state" = 'active'::"AuthorityGrantState"
           AND authority."entryResourceVersionId" = run_entry
           AND authority."contextDigest" = run_context
           AND (scope ->> 'installationId')::uuid = NEW."installationId"
           AND (scope ->> 'pluginVersionId')::uuid = NEW."pluginVersionId"
           AND scope ->> 'pluginDigest' = NEW."pluginDigest"
           AND scope ->> 'tool' = NEW."toolName"
           AND scope ->> 'effect' = NEW."effect"::text
           AND scope ->> 'scopeDescription' = requirement."authorityScope"::jsonb ->> 'scopeDescription'
           AND NOT EXISTS (
             SELECT 1
             FROM (VALUES
               ('timeoutMs'),
               ('maxResponseBytes'),
               ('maxRecords'),
               ('maxInvocationsPerRun'),
               ('maximumBytesBilled'),
               ('maxEstimatedCostUsd')
             ) AS limit_key(key)
             WHERE (scope -> 'limits') ? limit_key.key
               AND (
                 NOT ((requirement."authorityScope"::jsonb -> 'limits') ? limit_key.key)
                 OR ((scope -> 'limits' ->> limit_key.key)::numeric >
                     (requirement."authorityScope"::jsonb -> 'limits' ->> limit_key.key)::numeric)
               )
           )
       ) THEN
      RAISE EXCEPTION 'Plugin invocation start lacks current exact authority'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO prior FROM "PluginInvocation"
    WHERE "invocationKey" = NEW."invocationKey" AND "sequence" = 1;
    IF prior."id" IS NULL
       OR NEW."state" NOT IN (
         'succeeded'::"PluginInvocationState",
         'failed'::"PluginInvocationState",
         'cancelled'::"PluginInvocationState"
       )
       OR NEW."runId" IS DISTINCT FROM prior."runId"
       OR NEW."installationId" IS DISTINCT FROM prior."installationId"
       OR NEW."pluginVersionId" IS DISTINCT FROM prior."pluginVersionId"
       OR NEW."pluginDigest" IS DISTINCT FROM prior."pluginDigest"
       OR NEW."toolName" IS DISTINCT FROM prior."toolName"
       OR NEW."effect" IS DISTINCT FROM prior."effect"
       OR NEW."requestDigest" IS DISTINCT FROM prior."requestDigest" THEN
      RAISE EXCEPTION 'Plugin invocation terminal event does not match its start event'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."finishedAt" IS NULL
       OR (NEW."state" = 'succeeded'::"PluginInvocationState" AND (
         NEW."responseDigest" IS NULL OR NEW."errorCode" IS NOT NULL
       ))
       OR (NEW."state" IN (
         'failed'::"PluginInvocationState",
         'cancelled'::"PluginInvocationState"
       ) AND (
         NEW."responseDigest" IS NOT NULL OR NEW."errorCode" IS NULL
       )) THEN
      RAISE EXCEPTION 'Plugin invocation terminal evidence is incomplete'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
