BEGIN;

CREATE TYPE "PluginTransport" AS ENUM ('mcp', 'http', 'cli', 'db');
CREATE TYPE "PluginResidency" AS ENUM ('control_plane', 'workstation');
CREATE TYPE "PluginEffect" AS ENUM ('read', 'write', 'destructive');
CREATE TYPE "PluginInstallationState" AS ENUM ('installed', 'enabled', 'disabled', 'degraded', 'uninstalled');
CREATE TYPE "PluginHealthStatus" AS ENUM ('healthy', 'degraded', 'unavailable');
CREATE TYPE "PluginInvocationState" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused_plugin');

CREATE TABLE "ResourceDependencyPin" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sourceVersionId" UUID NOT NULL,
  "targetVersionId" UUID NOT NULL,
  "targetDigest" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResourceDependencyPin_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResourceDependencyPin_sourceVersionId_fkey"
    FOREIGN KEY ("sourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ResourceDependencyPin_targetVersionId_fkey"
    FOREIGN KEY ("targetVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ResourceDependencyPin_distinct_versions" CHECK ("sourceVersionId" <> "targetVersionId")
);
CREATE UNIQUE INDEX "ResourceDependencyPin_sourceVersionId_targetVersionId_key"
  ON "ResourceDependencyPin"("sourceVersionId", "targetVersionId");
CREATE INDEX "ResourceDependencyPin_targetVersionId_idx"
  ON "ResourceDependencyPin"("targetVersionId");

-- Normalize every existing exact JSON pin before the JSON compatibility snapshot is retired.
INSERT INTO "ResourceDependencyPin" (
  "sourceVersionId", "targetVersionId", "targetDigest"
)
SELECT source."id", target."id", target."digest"
FROM "ResourceVersion" source
CROSS JOIN LATERAL jsonb_array_elements(source."dependencyPins"::jsonb) pin
JOIN "ResourceVersion" target
  ON target."familyId" = (pin ->> 'familyId')::uuid
 AND target."version" = pin ->> 'version'
ON CONFLICT ("sourceVersionId", "targetVersionId") DO NOTHING;

CREATE FUNCTION "enforce_resource_dependency_pin"()
RETURNS trigger AS $$
DECLARE
  actual_digest VARCHAR(64);
BEGIN
  SELECT "digest" INTO actual_digest
  FROM "ResourceVersion"
  WHERE "id" = NEW."targetVersionId";
  IF actual_digest IS NULL OR NEW."targetDigest" IS DISTINCT FROM actual_digest THEN
    RAISE EXCEPTION 'Resource dependency target digest mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    WITH RECURSIVE descendants("id") AS (
      SELECT NEW."targetVersionId"
      UNION
      SELECT pin."targetVersionId"
      FROM "ResourceDependencyPin" pin
      JOIN descendants ON pin."sourceVersionId" = descendants."id"
    )
    SELECT 1 FROM descendants WHERE "id" = NEW."sourceVersionId"
  ) THEN
    RAISE EXCEPTION 'Resource dependency pins form a cycle'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ResourceDependencyPin_exact_target"
  BEFORE INSERT OR UPDATE ON "ResourceDependencyPin"
  FOR EACH ROW EXECUTE FUNCTION "enforce_resource_dependency_pin"();

ALTER TABLE "AuthorityGrant"
  ADD COLUMN "entryResourceVersionId" UUID,
  ADD COLUMN "pluginScopes" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ExecutionRun"
  ADD COLUMN "entryResourceVersionId" UUID,
  ADD COLUMN "legacyEntrypointUnresolved" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requiredPluginScopes" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "AutomationSchedule"
  ADD COLUMN "entryResourceVersionId" UUID;

-- Existing Phase 1 execution is the Daily Brief. Prefer that exact skill and otherwise use
-- the release's first immutable resource so every historical row remains attributable.
UPDATE "AuthorityGrant" target
SET "entryResourceVersionId" = (
  SELECT rr."resourceVersionId"
  FROM "ReleaseResource" rr
  JOIN "ResourceVersion" rv ON rv."id" = rr."resourceVersionId"
  JOIN "ResourceFamily" rf ON rf."id" = rv."familyId"
  WHERE rr."releaseId" = target."releaseId"
  ORDER BY CASE WHEN rf."kind" = 'Skill' AND rf."slug" = 'daily-brief' THEN 0 ELSE 1 END,
           rr."ordinal" ASC
  LIMIT 1
);
UPDATE "ExecutionRun" target
SET "entryResourceVersionId" = (
  SELECT rr."resourceVersionId"
  FROM "ReleaseResource" rr
  JOIN "ResourceVersion" rv ON rv."id" = rr."resourceVersionId"
  JOIN "ResourceFamily" rf ON rf."id" = rv."familyId"
  WHERE rr."releaseId" = target."releaseId"
  ORDER BY CASE WHEN rf."kind" = 'Skill' AND rf."slug" = 'daily-brief' THEN 0 ELSE 1 END,
           rr."ordinal" ASC
  LIMIT 1
);
UPDATE "AutomationSchedule" target
SET "entryResourceVersionId" = (
  SELECT rr."resourceVersionId"
  FROM "ReleaseResource" rr
  JOIN "ResourceVersion" rv ON rv."id" = rr."resourceVersionId"
  JOIN "ResourceFamily" rf ON rf."id" = rv."familyId"
  WHERE rr."releaseId" = target."releaseId"
  ORDER BY CASE WHEN rf."kind" = 'Skill' AND rf."slug" = 'daily-brief' THEN 0 ELSE 1 END,
           rr."ordinal" ASC
  LIMIT 1
);

CREATE TEMP TABLE "LegacyEntrypointTerminalization" ON COMMIT DROP AS
SELECT "id", "workspaceId", "departmentId", "state"
FROM "ExecutionRun"
WHERE "entryResourceVersionId" IS NULL
  AND "state" IN ('awaiting_approval', 'queued', 'running', 'paused_budget', 'paused_plugin');

UPDATE "ApprovalRequest" approval
SET "state" = 'cancelled'::"ApprovalRequestState",
    "decidedBy" = 'system:migration',
    "rationale" = 'Historical release has no attributable entry resource.',
    "decidedAt" = CURRENT_TIMESTAMP
WHERE approval."runId" IN (SELECT "id" FROM "LegacyEntrypointTerminalization")
  AND approval."state" = 'pending'::"ApprovalRequestState";

UPDATE "ExecutionRun"
SET "legacyEntrypointUnresolved" = true,
    "state" = CASE
      WHEN "id" IN (SELECT "id" FROM "LegacyEntrypointTerminalization")
        THEN 'failed'::"ExecutionRunState"
      ELSE "state"
    END,
    "message" = CASE
      WHEN "id" IN (SELECT "id" FROM "LegacyEntrypointTerminalization")
        THEN 'Historical run stopped: entry resource is unresolved'
      ELSE "message"
    END,
    "error" = CASE
      WHEN "id" IN (SELECT "id" FROM "LegacyEntrypointTerminalization")
        THEN jsonb_build_object(
          'code', 'LEGACY_ENTRYPOINT_UNRESOLVED',
          'message', 'Historical release has no attributable entry resource.'
        )
      ELSE "error"
    END,
    "finishedAt" = CASE
      WHEN "id" IN (SELECT "id" FROM "LegacyEntrypointTerminalization")
        THEN COALESCE("finishedAt", CURRENT_TIMESTAMP)
      ELSE "finishedAt"
    END,
    "leaseOwner" = NULL,
    "leaseExpiresAt" = NULL,
    "heartbeatAt" = NULL,
    "cancelRequestedAt" = NULL
WHERE "entryResourceVersionId" IS NULL;

INSERT INTO "ExecutionRunEvent" (
  "id", "workspaceId", "departmentId", "runId", "sequence", "phase", "state",
  "message", "metadata", "occurredAt"
)
SELECT gen_random_uuid(), legacy."workspaceId", legacy."departmentId", legacy."id",
       COALESCE((SELECT max(event."sequence") + 1 FROM "ExecutionRunEvent" event WHERE event."runId" = legacy."id"), 1),
       'migration', 'failed', 'Historical run stopped because its entry resource is unresolved.',
       jsonb_build_object('code', 'LEGACY_ENTRYPOINT_UNRESOLVED'), CURRENT_TIMESTAMP
FROM "LegacyEntrypointTerminalization" legacy;

INSERT INTO "PlatformEvent" (
  "id", "workspaceId", "departmentId", "kind", "entityType", "entityId", "summary",
  "actorId", "requestId", "occurredAt"
)
SELECT gen_random_uuid(), legacy."workspaceId", legacy."departmentId",
       'execution.legacy_entrypoint_unresolved', 'ExecutionRun', legacy."id"::text,
       jsonb_build_object('reason', 'legacy_entrypoint_unresolved'),
       'system:migration', NULL, CURRENT_TIMESTAMP
FROM "LegacyEntrypointTerminalization" legacy;

INSERT INTO "AuditEvent" (
  "id", "workspaceId", "departmentId", "actorId", "requestId", "action",
  "entityType", "entityId", "details", "createdAt"
)
SELECT gen_random_uuid(), run."workspaceId", run."departmentId", 'system:migration', NULL,
       'execution.legacy_entrypoint_marked', 'ExecutionRun', run."id"::text,
       jsonb_build_object(
         'terminalized', EXISTS (
           SELECT 1 FROM "LegacyEntrypointTerminalization" legacy WHERE legacy."id" = run."id"
         )
       ), CURRENT_TIMESTAMP
FROM "ExecutionRun" run
WHERE run."legacyEntrypointUnresolved" = true;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AuthorityGrant" WHERE "entryResourceVersionId" IS NULL)
     OR EXISTS (SELECT 1 FROM "AutomationSchedule" WHERE "entryResourceVersionId" IS NULL) THEN
    RAISE EXCEPTION 'Every historical grant and schedule requires a release entry resource';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "ExecutionRun"
    WHERE ("legacyEntrypointUnresolved" AND "entryResourceVersionId" IS NOT NULL)
       OR (NOT "legacyEntrypointUnresolved" AND "entryResourceVersionId" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Historical run entrypoint compatibility shape is invalid';
  END IF;
END;
$$;

ALTER TABLE "AuthorityGrant" ALTER COLUMN "entryResourceVersionId" SET NOT NULL;
ALTER TABLE "AutomationSchedule" ALTER COLUMN "entryResourceVersionId" SET NOT NULL;
ALTER TABLE "AuthorityGrant"
  ADD CONSTRAINT "AuthorityGrant_entryResourceVersionId_fkey"
  FOREIGN KEY ("entryResourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExecutionRun"
  ADD CONSTRAINT "ExecutionRun_entryResourceVersionId_fkey"
  FOREIGN KEY ("entryResourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationSchedule"
  ADD CONSTRAINT "AutomationSchedule_entryResourceVersionId_fkey"
  FOREIGN KEY ("entryResourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AuthorityGrant_entryResourceVersionId_state_validUntil_idx"
  ON "AuthorityGrant"("entryResourceVersionId", "state", "validUntil");
CREATE INDEX "ExecutionRun_entryResourceVersionId_createdAt_idx"
  ON "ExecutionRun"("entryResourceVersionId", "createdAt");
CREATE INDEX "AutomationSchedule_entryResourceVersionId_idx"
  ON "AutomationSchedule"("entryResourceVersionId");
ALTER TABLE "AuthorityGrant"
  ADD CONSTRAINT "AuthorityGrant_pluginScopes_array" CHECK (jsonb_typeof("pluginScopes"::jsonb) = 'array');
ALTER TABLE "ExecutionRun"
  ADD CONSTRAINT "ExecutionRun_requiredPluginScopes_array" CHECK (jsonb_typeof("requiredPluginScopes"::jsonb) = 'array');
ALTER TABLE "ExecutionRun"
  ADD CONSTRAINT "ExecutionRun_legacy_entrypoint_shape" CHECK (
    (NOT "legacyEntrypointUnresolved" AND "entryResourceVersionId" IS NOT NULL)
    OR ("legacyEntrypointUnresolved" AND "entryResourceVersionId" IS NULL)
  );

CREATE FUNCTION "enforce_release_entrypoint"()
RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'ExecutionRun' THEN
    IF NEW."legacyEntrypointUnresolved" THEN
      IF TG_OP = 'INSERT'
         OR (TG_OP = 'UPDATE' AND NOT OLD."legacyEntrypointUnresolved")
         OR NEW."entryResourceVersionId" IS NOT NULL THEN
        RAISE EXCEPTION 'Legacy unresolved entrypoints are migration-only and immutable'
          USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE'
       AND OLD."legacyEntrypointUnresolved"
       AND NOT NEW."legacyEntrypointUnresolved" THEN
      RAISE EXCEPTION 'Legacy unresolved entrypoint marker is immutable'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."entryResourceVersionId" IS NULL THEN
    RAISE EXCEPTION '% requires an exact entry resource', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "ReleaseResource"
    WHERE "releaseId" = NEW."releaseId"
      AND "resourceVersionId" = NEW."entryResourceVersionId"
  ) THEN
    RAISE EXCEPTION '% entry resource does not belong to its release', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AuthorityGrant_release_entrypoint"
  BEFORE INSERT OR UPDATE OF "releaseId", "entryResourceVersionId" ON "AuthorityGrant"
  FOR EACH ROW EXECUTE FUNCTION "enforce_release_entrypoint"();
CREATE TRIGGER "ExecutionRun_release_entrypoint"
  BEFORE INSERT OR UPDATE OF "releaseId", "entryResourceVersionId", "legacyEntrypointUnresolved" ON "ExecutionRun"
  FOR EACH ROW EXECUTE FUNCTION "enforce_release_entrypoint"();
CREATE TRIGGER "AutomationSchedule_release_entrypoint"
  BEFORE INSERT OR UPDATE OF "releaseId", "entryResourceVersionId" ON "AutomationSchedule"
  FOR EACH ROW EXECUTE FUNCTION "enforce_release_entrypoint"();

CREATE FUNCTION "protect_plugin_scope_snapshots"()
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
CREATE TRIGGER "AuthorityGrant_plugin_scopes_immutable"
  BEFORE UPDATE OF "pluginScopes" ON "AuthorityGrant"
  FOR EACH ROW EXECUTE FUNCTION "protect_plugin_scope_snapshots"();
CREATE TRIGGER "ExecutionRun_plugin_scopes_immutable"
  BEFORE UPDATE OF "requiredPluginScopes" ON "ExecutionRun"
  FOR EACH ROW EXECUTE FUNCTION "protect_plugin_scope_snapshots"();

CREATE FUNCTION "enforce_bound_entrypoint"()
RETURNS trigger AS $$
DECLARE
  grant_entry UUID;
BEGIN
  IF NEW."authorityGrantId" IS NULL THEN RETURN NEW; END IF;
  SELECT "entryResourceVersionId" INTO grant_entry
  FROM "AuthorityGrant" WHERE "id" = NEW."authorityGrantId";
  IF grant_entry IS NULL OR grant_entry IS DISTINCT FROM NEW."entryResourceVersionId" THEN
    RAISE EXCEPTION '% authority entry resource mismatch', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ExecutionRun_authority_entrypoint"
  BEFORE INSERT OR UPDATE OF "authorityGrantId", "entryResourceVersionId" ON "ExecutionRun"
  FOR EACH ROW EXECUTE FUNCTION "enforce_bound_entrypoint"();
CREATE TRIGGER "AutomationSchedule_authority_entrypoint"
  BEFORE INSERT OR UPDATE OF "authorityGrantId", "entryResourceVersionId" ON "AutomationSchedule"
  FOR EACH ROW EXECUTE FUNCTION "enforce_bound_entrypoint"();

CREATE TABLE "PluginInstallation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "pluginVersionId" UUID NOT NULL,
  "pluginDigest" VARCHAR(64) NOT NULL,
  "transport" "PluginTransport" NOT NULL,
  "residency" "PluginResidency" NOT NULL,
  "state" "PluginInstallationState" NOT NULL DEFAULT 'installed',
  "developmentOnly" BOOLEAN NOT NULL DEFAULT false,
  "configurationDigest" VARCHAR(64),
  "installedBy" VARCHAR(200) NOT NULL,
  "installedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "configuredAt" TIMESTAMPTZ(3),
  "enableRequestedAt" TIMESTAMPTZ(3),
  "enableRequestedBy" VARCHAR(200),
  "updatedBy" VARCHAR(200) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "disabledAt" TIMESTAMPTZ(3),
  "disabledBy" VARCHAR(200),
  "disabledReason" TEXT,
  "uninstalledAt" TIMESTAMPTZ(3),
  "uninstalledBy" VARCHAR(200),
  "uninstallReason" TEXT,
  CONSTRAINT "PluginInstallation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PluginInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PluginInstallation_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PluginInstallation_pluginVersionId_fkey" FOREIGN KEY ("pluginVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PluginInstallation_state_timestamps" CHECK (
    ("state" IN ('installed', 'enabled') AND "disabledAt" IS NULL AND "uninstalledAt" IS NULL)
    OR ("state" = 'disabled' AND "disabledAt" IS NOT NULL AND "uninstalledAt" IS NULL)
    OR ("state" = 'degraded' AND "uninstalledAt" IS NULL)
    OR ("state" = 'uninstalled' AND "uninstalledAt" IS NOT NULL)
  )
);
CREATE INDEX "PluginInstallation_workspaceId_departmentId_state_idx" ON "PluginInstallation"("workspaceId", "departmentId", "state");
CREATE INDEX "PluginInstallation_pluginVersionId_state_idx" ON "PluginInstallation"("pluginVersionId", "state");
CREATE UNIQUE INDEX "PluginInstallation_active_scope_version_key"
  ON "PluginInstallation"("workspaceId", COALESCE("departmentId", '00000000-0000-0000-0000-000000000000'::uuid), "pluginVersionId")
  WHERE "state" <> 'uninstalled';

CREATE TABLE "PluginSecretBinding" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "installationId" UUID NOT NULL,
  "slot" VARCHAR(120) NOT NULL,
  "secretRef" VARCHAR(500) NOT NULL,
  "createdBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy" VARCHAR(200) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PluginSecretBinding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PluginSecretBinding_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "PluginInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PluginSecretBinding_opaque_ref" CHECK (
    "secretRef" ~ '^(env|secret-manager|windows-credential|keychain)://[A-Za-z0-9_./:@-]+$'
  )
);
CREATE UNIQUE INDEX "PluginSecretBinding_installationId_slot_key" ON "PluginSecretBinding"("installationId", "slot");

CREATE TABLE "PluginHealthCheck" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "installationId" UUID NOT NULL,
  "status" "PluginHealthStatus" NOT NULL,
  "probe" VARCHAR(120) NOT NULL,
  "latencyMs" INTEGER,
  "summary" VARCHAR(1000),
  "checkedBy" VARCHAR(200) NOT NULL,
  "checkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PluginHealthCheck_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PluginHealthCheck_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "PluginInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PluginHealthCheck_latency_nonnegative" CHECK ("latencyMs" IS NULL OR "latencyMs" >= 0)
);
CREATE INDEX "PluginHealthCheck_installationId_checkedAt_idx" ON "PluginHealthCheck"("installationId", "checkedAt");

CREATE TABLE "PluginInvocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "invocationKey" VARCHAR(200) NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 1,
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "installationId" UUID NOT NULL,
  "runId" UUID,
  "pluginVersionId" UUID NOT NULL,
  "pluginDigest" VARCHAR(64) NOT NULL,
  "toolName" VARCHAR(160) NOT NULL,
  "effect" "PluginEffect" NOT NULL,
  "state" "PluginInvocationState" NOT NULL,
  "requestDigest" VARCHAR(64) NOT NULL,
  "responseDigest" VARCHAR(64),
  "errorCode" VARCHAR(160),
  "summary" VARCHAR(500),
  "latencyMs" INTEGER,
  "costUsd" DECIMAL(18,8),
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PluginInvocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PluginInvocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PluginInvocation_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PluginInvocation_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "PluginInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PluginInvocation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PluginInvocation_pluginVersionId_fkey" FOREIGN KEY ("pluginVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PluginInvocation_bounds" CHECK (
    "sequence" > 0 AND ("latencyMs" IS NULL OR "latencyMs" >= 0)
    AND ("costUsd" IS NULL OR "costUsd" >= 0)
    AND "pluginDigest" ~ '^[a-f0-9]{64}$'
    AND "requestDigest" ~ '^[a-f0-9]{64}$'
    AND ("responseDigest" IS NULL OR "responseDigest" ~ '^[a-f0-9]{64}$')
  )
);
CREATE UNIQUE INDEX "PluginInvocation_invocationKey_sequence_key" ON "PluginInvocation"("invocationKey", "sequence");
CREATE INDEX "PluginInvocation_workspaceId_departmentId_createdAt_idx" ON "PluginInvocation"("workspaceId", "departmentId", "createdAt");
CREATE INDEX "PluginInvocation_installationId_createdAt_idx" ON "PluginInvocation"("installationId", "createdAt");
CREATE INDEX "PluginInvocation_runId_createdAt_idx" ON "PluginInvocation"("runId", "createdAt");

CREATE TABLE "RunPluginRequirement" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "installationId" UUID NOT NULL,
  "pluginVersionId" UUID NOT NULL,
  "pluginDigest" VARCHAR(64) NOT NULL,
  "capabilityName" VARCHAR(160) NOT NULL,
  "effect" "PluginEffect" NOT NULL,
  "authorityScope" JSONB NOT NULL,
  "contextDigest" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunPluginRequirement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RunPluginRequirement_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RunPluginRequirement_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "PluginInstallation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RunPluginRequirement_pluginVersionId_fkey" FOREIGN KEY ("pluginVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RunPluginRequirement_authority_object" CHECK (jsonb_typeof("authorityScope"::jsonb) = 'object')
);
CREATE UNIQUE INDEX "RunPluginRequirement_runId_installationId_pluginVersionId_capabilityName_key" ON "RunPluginRequirement"("runId", "installationId", "pluginVersionId", "capabilityName");
CREATE INDEX "RunPluginRequirement_installationId_runId_idx" ON "RunPluginRequirement"("installationId", "runId");

CREATE FUNCTION "enforce_plugin_installation"()
RETURNS trigger AS $$
DECLARE
  version_digest VARCHAR(64);
  version_lifecycle "ResourceLifecycle";
  version_kind "ResourceKind";
  version_source_commit VARCHAR(160);
  version_transport TEXT;
  version_residency TEXT;
  family_workspace UUID;
  family_department UUID;
BEGIN
  SELECT rv."digest", rv."lifecycle", rf."kind", rv."sourceCommit",
         rv."definition"::jsonb #>> '{spec,transport}',
         rv."definition"::jsonb #>> '{spec,executionPlacement}',
         rf."workspaceId", rf."departmentId"
    INTO version_digest, version_lifecycle, version_kind, version_source_commit,
         version_transport, version_residency, family_workspace, family_department
  FROM "ResourceVersion" rv JOIN "ResourceFamily" rf ON rf."id" = rv."familyId"
  WHERE rv."id" = NEW."pluginVersionId";
  IF version_kind IS DISTINCT FROM 'Plugin'::"ResourceKind" THEN
    RAISE EXCEPTION 'Plugin installation must reference a Plugin resource'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."pluginDigest" IS DISTINCT FROM version_digest THEN
    RAISE EXCEPTION 'Plugin installation digest mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."transport"::text IS DISTINCT FROM version_transport
     OR NEW."residency"::text IS DISTINCT FROM version_residency THEN
    RAISE EXCEPTION 'Plugin installation transport or residency mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."workspaceId" IS DISTINCT FROM family_workspace
     OR NOT (family_department IS NULL OR family_department IS NOT DISTINCT FROM NEW."departmentId") THEN
    RAISE EXCEPTION 'Plugin installation scope mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF NOT NEW."developmentOnly" AND (
    version_lifecycle NOT IN ('certified', 'production')
    OR version_source_commit !~ '^[a-f0-9]{7,64}$'
  ) THEN
    RAISE EXCEPTION 'Production Plugin installation requires verified lifecycle evidence'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."state" = 'enabled'::"PluginInstallationState" AND (
    NEW."enableRequestedAt" IS NULL
    OR NEW."residency" <> 'control_plane'::"PluginResidency"
    OR NOT EXISTS (
      SELECT 1 FROM "PluginHealthCheck" health
      WHERE health."installationId" = NEW."id"
        AND health."status" = 'healthy'::"PluginHealthStatus"
        AND health."checkedAt" >= COALESCE(NEW."configuredAt", NEW."installedAt")
    )
  ) THEN
    RAISE EXCEPTION 'Enabled Plugin installation requires a current healthy control-plane probe'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PluginInstallation_exact_resource"
  BEFORE INSERT OR UPDATE OF "pluginVersionId", "pluginDigest", "workspaceId", "departmentId", "developmentOnly", "transport", "residency", "state", "configuredAt", "enableRequestedAt"
  ON "PluginInstallation" FOR EACH ROW EXECUTE FUNCTION "enforce_plugin_installation"();
CREATE TRIGGER "PluginInstallation_scope_immutable"
  BEFORE UPDATE OF "workspaceId", "departmentId" ON "PluginInstallation"
  FOR EACH ROW EXECUTE FUNCTION "protect_aggregate_scope_identity"();
CREATE TRIGGER "PluginInvocation_scope_immutable"
  BEFORE UPDATE OF "workspaceId", "departmentId" ON "PluginInvocation"
  FOR EACH ROW EXECUTE FUNCTION "protect_aggregate_scope_identity"();

CREATE FUNCTION "enforce_run_plugin_requirement"()
RETURNS trigger AS $$
DECLARE
  run_entry UUID;
  run_context VARCHAR(64);
  run_workspace UUID;
  run_department UUID;
  install_version UUID;
  install_digest VARCHAR(64);
  install_workspace UUID;
  install_department UUID;
  install_state "PluginInstallationState";
BEGIN
  SELECT "entryResourceVersionId", "contextDigest", "workspaceId", "departmentId"
    INTO run_entry, run_context, run_workspace, run_department
  FROM "ExecutionRun" WHERE "id" = NEW."runId";
  SELECT "pluginVersionId", "pluginDigest", "workspaceId", "departmentId", "state"
    INTO install_version, install_digest, install_workspace, install_department, install_state
  FROM "PluginInstallation" WHERE "id" = NEW."installationId";
  IF run_entry IS NULL OR install_version IS NULL
     OR NEW."pluginVersionId" IS DISTINCT FROM install_version
     OR NEW."pluginDigest" IS DISTINCT FROM install_digest
     OR NEW."contextDigest" IS DISTINCT FROM run_context
     OR run_workspace IS DISTINCT FROM install_workspace
     OR NOT (install_department IS NULL OR install_department IS NOT DISTINCT FROM run_department)
     OR install_state IS DISTINCT FROM 'enabled'::"PluginInstallationState" THEN
    RAISE EXCEPTION 'Run Plugin requirement exact binding mismatch'
      USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    WITH RECURSIVE closure("id") AS (
      SELECT run_entry
      UNION
      SELECT pin."targetVersionId"
      FROM "ResourceDependencyPin" pin
      JOIN closure ON pin."sourceVersionId" = closure."id"
    )
    SELECT 1 FROM closure WHERE "id" = NEW."pluginVersionId"
  ) THEN
    RAISE EXCEPTION 'Run Plugin requirement is outside the entrypoint dependency closure'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "RunPluginRequirement_exact_binding"
  BEFORE INSERT OR UPDATE ON "RunPluginRequirement"
  FOR EACH ROW EXECUTE FUNCTION "enforce_run_plugin_requirement"();

CREATE FUNCTION "enforce_plugin_invocation"()
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
CREATE TRIGGER "PluginInvocation_exact_evidence"
  BEFORE INSERT ON "PluginInvocation"
  FOR EACH ROW EXECUTE FUNCTION "enforce_plugin_invocation"();

CREATE FUNCTION "protect_plugin_evidence"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PluginHealthCheck_append_only"
  BEFORE UPDATE OR DELETE ON "PluginHealthCheck"
  FOR EACH ROW EXECUTE FUNCTION "protect_plugin_evidence"();
CREATE TRIGGER "PluginInvocation_append_only"
  BEFORE UPDATE OR DELETE ON "PluginInvocation"
  FOR EACH ROW EXECUTE FUNCTION "protect_plugin_evidence"();
CREATE TRIGGER "RunPluginRequirement_immutable"
  BEFORE UPDATE OR DELETE ON "RunPluginRequirement"
  FOR EACH ROW EXECUTE FUNCTION "protect_plugin_evidence"();

CREATE FUNCTION "protect_plugin_uninstall"()
RETURNS trigger AS $$
BEGIN
  IF NEW."state" <> 'uninstalled' OR OLD."state" = 'uninstalled' THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE dependents("id") AS (
      SELECT pin."sourceVersionId" FROM "ResourceDependencyPin" pin
      WHERE pin."targetVersionId" = NEW."pluginVersionId"
      UNION
      SELECT pin."sourceVersionId" FROM "ResourceDependencyPin" pin
      JOIN dependents ON pin."targetVersionId" = dependents."id"
    )
    SELECT 1 FROM dependents d
    JOIN "ResourceVersion" rv ON rv."id" = d."id"
    WHERE rv."lifecycle" IN ('certified', 'production')
  ) OR EXISTS (
    SELECT 1 FROM "ProductionChannel" channel
    JOIN "ReleaseResource" rr ON rr."releaseId" = channel."currentReleaseId"
    WHERE channel."workspaceId" = NEW."workspaceId"
      AND (channel."departmentId" IS NULL OR channel."departmentId" IS NOT DISTINCT FROM NEW."departmentId")
      AND rr."resourceVersionId" IN (
        WITH RECURSIVE dependents("id") AS (
          SELECT NEW."pluginVersionId"
          UNION
          SELECT pin."sourceVersionId" FROM "ResourceDependencyPin" pin
          JOIN dependents ON pin."targetVersionId" = dependents."id"
        ) SELECT "id" FROM dependents
      )
  ) THEN
    RAISE EXCEPTION 'Plugin version has certified or active dependents'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PluginInstallation_uninstall_protection"
  BEFORE UPDATE OF "state" ON "PluginInstallation"
  FOR EACH ROW EXECUTE FUNCTION "protect_plugin_uninstall"();

COMMIT;
