BEGIN;

ALTER TABLE "ExecutionRun"
  ADD COLUMN "requiresPluginApproval" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RunPluginRequirement"
  ADD COLUMN "approvalRequired" BOOLEAN NOT NULL DEFAULT false;

-- Backfill the immutable requirement snapshot from the exact Plugin definition. Non-read effects
-- always require approval even if a malformed historical manifest omitted the label.
ALTER TABLE "RunPluginRequirement" DISABLE TRIGGER "RunPluginRequirement_immutable";
ALTER TABLE "RunPluginRequirement" DISABLE TRIGGER "RunPluginRequirement_exact_binding";
UPDATE "RunPluginRequirement" requirement
SET "approvalRequired" = (
  requirement."effect" <> 'read'::"PluginEffect"
  OR EXISTS (
    SELECT 1
    FROM "PluginInstallation" installation
    JOIN "ResourceVersion" version ON version.id = installation."pluginVersionId",
         LATERAL jsonb_array_elements(version.definition::jsonb #> '{spec,capabilities}') capability
    WHERE installation.id = requirement."installationId"
      AND capability ->> 'tool' = requirement."capabilityName"
      AND capability ->> 'approval' = 'approval_required'
  )
);
ALTER TABLE "RunPluginRequirement" ENABLE TRIGGER "RunPluginRequirement_immutable";
ALTER TABLE "RunPluginRequirement" ENABLE TRIGGER "RunPluginRequirement_exact_binding";

-- Existing JSON snapshots predate approvalRequired. Preserve their order and add the derived
-- boolean before the runtime begins parsing the stricter contract.
ALTER TABLE "ExecutionRun" DISABLE TRIGGER "ExecutionRun_plugin_scopes_immutable";
UPDATE "ExecutionRun" run
SET "requiredPluginScopes" = COALESCE((
  SELECT jsonb_agg(
    scope.value || jsonb_build_object(
      'approvalRequired', COALESCE(requirement."approvalRequired", false)
    )
    ORDER BY scope.ordinality
  )
  FROM jsonb_array_elements(run."requiredPluginScopes"::jsonb)
       WITH ORDINALITY AS scope(value, ordinality)
  LEFT JOIN "RunPluginRequirement" requirement
    ON requirement."runId" = run.id
   AND requirement."installationId" = (scope.value ->> 'installationId')::uuid
   AND requirement."pluginVersionId" = (scope.value ->> 'pluginVersionId')::uuid
   AND requirement."capabilityName" = scope.value ->> 'tool'
), '[]'::jsonb)
WHERE jsonb_array_length(run."requiredPluginScopes"::jsonb) > 0;
ALTER TABLE "ExecutionRun" ENABLE TRIGGER "ExecutionRun_plugin_scopes_immutable";

UPDATE "ExecutionRun" run
SET "requiresPluginApproval" = EXISTS (
  SELECT 1 FROM "RunPluginRequirement" requirement
  WHERE requirement."runId" = run.id AND requirement."approvalRequired"
);

CREATE OR REPLACE FUNCTION "enforce_run_plugin_requirement"()
RETURNS trigger AS $$
DECLARE
  run_entry UUID;
  run_context VARCHAR(64);
  run_workspace UUID;
  run_department UUID;
  run_requires_approval BOOLEAN;
  install_version UUID;
  install_digest VARCHAR(64);
  install_workspace UUID;
  install_department UUID;
  install_state "PluginInstallationState";
BEGIN
  SELECT "entryResourceVersionId", "contextDigest", "workspaceId", "departmentId",
         "requiresPluginApproval"
    INTO run_entry, run_context, run_workspace, run_department, run_requires_approval
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
     OR install_state IS NULL
     OR install_state = 'uninstalled'::"PluginInstallationState"
     OR (NEW."approvalRequired" AND NOT run_requires_approval) THEN
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

CREATE FUNCTION "protect_run_plugin_approval_flag"()
RETURNS trigger AS $$
BEGIN
  IF NEW."requiresPluginApproval" IS DISTINCT FROM OLD."requiresPluginApproval" THEN
    RAISE EXCEPTION 'Run Plugin approval requirement is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ExecutionRun_plugin_approval_immutable"
  BEFORE UPDATE OF "requiresPluginApproval" ON "ExecutionRun"
  FOR EACH ROW EXECUTE FUNCTION "protect_run_plugin_approval_flag"();

-- An envelope authorizes a bounded class of calls. This trigger independently requires a human
-- decision tied to this exact run before any approval-required external effect can start.
CREATE FUNCTION "enforce_plugin_per_run_approval"()
RETURNS trigger AS $$
BEGIN
  IF NEW."sequence" = 1
     AND EXISTS (
       SELECT 1 FROM "RunPluginRequirement" requirement
       WHERE requirement."runId" = NEW."runId"
         AND requirement."installationId" = NEW."installationId"
         AND requirement."pluginVersionId" = NEW."pluginVersionId"
         AND requirement."capabilityName" = NEW."toolName"
         AND requirement."approvalRequired"
     )
     AND NOT EXISTS (
       SELECT 1 FROM "ApprovalRequest" approval
       WHERE approval."runId" = NEW."runId"
         AND approval."state" = 'approved'::"ApprovalRequestState"
         AND approval."decidedBy" IS NOT NULL
         AND approval."decidedBy" !~ '^system:'
         AND approval."rationale" IS NOT NULL
         AND length(btrim(approval."rationale")) >= 10
         AND approval."decidedAt" IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Approval-required Plugin call lacks a human decision for this run'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "PluginInvocation_per_run_approval"
  BEFORE INSERT ON "PluginInvocation"
  FOR EACH ROW EXECUTE FUNCTION "enforce_plugin_per_run_approval"();

COMMIT;
