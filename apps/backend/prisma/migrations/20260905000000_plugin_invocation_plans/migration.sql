BEGIN;

CREATE TABLE "RunPluginCallPlan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "runId" UUID NOT NULL,
  "requirementId" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "invocationKey" VARCHAR(200) NOT NULL,
  "inputPath" JSONB NOT NULL,
  "outputContextKey" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RunPluginCallPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RunPluginCallPlan_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RunPluginCallPlan_departmentId_workspaceId_fkey"
    FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RunPluginCallPlan_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RunPluginCallPlan_requirementId_fkey"
    FOREIGN KEY ("requirementId") REFERENCES "RunPluginRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RunPluginCallPlan_ordinal_bounds" CHECK ("ordinal" >= 0 AND "ordinal" < 20),
  CONSTRAINT "RunPluginCallPlan_input_path_bounds" CHECK (
    jsonb_typeof("inputPath") = 'array' AND jsonb_array_length("inputPath") <= 16
  ),
  CONSTRAINT "RunPluginCallPlan_output_context_key" CHECK (
    "outputContextKey" ~ '^[a-z][a-z0-9_]{0,79}$'
  )
);

CREATE UNIQUE INDEX "RunPluginCallPlan_invocationKey_key"
  ON "RunPluginCallPlan"("invocationKey");
CREATE UNIQUE INDEX "RunPluginCallPlan_runId_ordinal_key"
  ON "RunPluginCallPlan"("runId", "ordinal");
CREATE UNIQUE INDEX "RunPluginCallPlan_runId_outputContextKey_key"
  ON "RunPluginCallPlan"("runId", "outputContextKey");
CREATE INDEX "RunPluginCallPlan_requirementId_idx"
  ON "RunPluginCallPlan"("requirementId");
CREATE INDEX "RunPluginCallPlan_workspaceId_departmentId_createdAt_idx"
  ON "RunPluginCallPlan"("workspaceId", "departmentId", "createdAt");

ALTER TABLE "PluginInvocation"
  ADD COLUMN "planId" UUID,
  ADD COLUMN "legacyPlanUnresolved" BOOLEAN NOT NULL DEFAULT false;

-- Evidence written before an explicit call plan existed remains readable, but cannot be extended
-- or used to authorize a replay. Every new event is required to carry an exact plan below.
ALTER TABLE "PluginInvocation" DISABLE TRIGGER "PluginInvocation_append_only";
UPDATE "PluginInvocation"
SET "legacyPlanUnresolved" = true
WHERE "planId" IS NULL;
ALTER TABLE "PluginInvocation" ENABLE TRIGGER "PluginInvocation_append_only";

ALTER TABLE "PluginInvocation"
  ADD CONSTRAINT "PluginInvocation_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "RunPluginCallPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PluginInvocation_plan_resolution" CHECK (
    ("legacyPlanUnresolved" AND "planId" IS NULL)
    OR (NOT "legacyPlanUnresolved" AND "planId" IS NOT NULL)
  );

CREATE UNIQUE INDEX "PluginInvocation_planId_sequence_key"
  ON "PluginInvocation"("planId", "sequence");

CREATE FUNCTION "enforce_run_plugin_call_plan"()
RETURNS trigger AS $$
DECLARE
  requirement_run UUID;
  run_workspace UUID;
  run_department UUID;
  run_input JSONB;
  segment JSONB;
  segment_text TEXT;
  path_segments TEXT[] := ARRAY[]::TEXT[];
  selected_input JSONB;
BEGIN
  SELECT requirement."runId"
    INTO requirement_run
  FROM "RunPluginRequirement" requirement
  WHERE requirement."id" = NEW."requirementId";

  SELECT run."workspaceId", run."departmentId", run."input"::jsonb
    INTO run_workspace, run_department, run_input
  FROM "ExecutionRun" run
  WHERE run."id" = NEW."runId";

  IF requirement_run IS NULL OR run_workspace IS NULL
     OR requirement_run IS DISTINCT FROM NEW."runId"
     OR NEW."workspaceId" IS DISTINCT FROM run_workspace
     OR NEW."departmentId" IS DISTINCT FROM run_department
     OR NEW."invocationKey" IS DISTINCT FROM NEW."runId"::text || ':plugin:' || NEW."ordinal"::text THEN
    RAISE EXCEPTION 'Plugin call plan exact run or requirement binding mismatch'
      USING ERRCODE = '23514';
  END IF;

  FOR segment IN SELECT value FROM jsonb_array_elements(NEW."inputPath") LOOP
    IF jsonb_typeof(segment) = 'string' THEN
      segment_text := segment #>> '{}';
      IF segment_text IS DISTINCT FROM btrim(segment_text)
         OR length(segment_text) < 1 OR length(segment_text) > 120
         OR lower(segment_text) IN ('__proto__', 'prototype', 'constructor') THEN
        RAISE EXCEPTION 'Plugin call input path contains a forbidden object segment'
          USING ERRCODE = '23514';
      END IF;
    ELSIF jsonb_typeof(segment) = 'number' THEN
      segment_text := segment #>> '{}';
      IF segment_text::numeric < 0
         OR segment_text::numeric > 10000
         OR segment_text::numeric <> trunc(segment_text::numeric) THEN
        RAISE EXCEPTION 'Plugin call input path contains an invalid array index'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'Plugin call input path segments must be strings or integers'
        USING ERRCODE = '23514';
    END IF;
    path_segments := array_append(path_segments, segment_text);
  END LOOP;

  selected_input := CASE
    WHEN cardinality(path_segments) = 0 THEN run_input
    ELSE run_input #> path_segments
  END;
  IF selected_input IS NULL THEN
    RAISE EXCEPTION 'Plugin call input path does not resolve inside the immutable run input'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RunPluginCallPlan_exact_binding"
  BEFORE INSERT ON "RunPluginCallPlan"
  FOR EACH ROW EXECUTE FUNCTION "enforce_run_plugin_call_plan"();

CREATE FUNCTION "protect_run_plugin_call_plan"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Run Plugin call plans are immutable'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RunPluginCallPlan_append_only"
  BEFORE UPDATE OR DELETE ON "RunPluginCallPlan"
  FOR EACH ROW EXECUTE FUNCTION "protect_run_plugin_call_plan"();

CREATE FUNCTION "protect_planned_plugin_snapshots"()
RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'ExecutionRun'
     AND EXISTS (SELECT 1 FROM "RunPluginCallPlan" plan WHERE plan."runId" = OLD."id")
     AND (
       NEW."input" IS DISTINCT FROM OLD."input"
       OR NEW."entryResourceVersionId" IS DISTINCT FROM OLD."entryResourceVersionId"
       OR NEW."releaseDigest" IS DISTINCT FROM OLD."releaseDigest"
       OR NEW."contextDigest" IS DISTINCT FROM OLD."contextDigest"
     ) THEN
    RAISE EXCEPTION 'A planned Plugin run snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'RunPluginRequirement'
     AND EXISTS (
       SELECT 1 FROM "RunPluginCallPlan" plan WHERE plan."requirementId" = OLD."id"
     ) THEN
    RAISE EXCEPTION 'A planned Plugin requirement is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ExecutionRun_planned_plugin_snapshot_immutable"
  BEFORE UPDATE OF "input", "entryResourceVersionId", "releaseDigest", "contextDigest"
  ON "ExecutionRun"
  FOR EACH ROW EXECUTE FUNCTION "protect_planned_plugin_snapshots"();

CREATE TRIGGER "RunPluginRequirement_planned_snapshot_immutable"
  BEFORE UPDATE OR DELETE ON "RunPluginRequirement"
  FOR EACH ROW EXECUTE FUNCTION "protect_planned_plugin_snapshots"();

CREATE FUNCTION "enforce_plugin_invocation_plan_binding"()
RETURNS trigger AS $$
DECLARE
  plan_run UUID;
  plan_requirement UUID;
  plan_key VARCHAR(200);
  requirement_installation UUID;
  requirement_version UUID;
  requirement_digest VARCHAR(64);
  requirement_tool VARCHAR(160);
  requirement_effect "PluginEffect";
  prior_plan UUID;
BEGIN
  IF NEW."legacyPlanUnresolved" OR NEW."planId" IS NULL THEN
    RAISE EXCEPTION 'New Plugin invocation evidence requires an exact immutable call plan'
      USING ERRCODE = '23514';
  END IF;

  SELECT plan."runId", plan."requirementId", plan."invocationKey",
         requirement."installationId", requirement."pluginVersionId",
         requirement."pluginDigest", requirement."capabilityName", requirement."effect"
    INTO plan_run, plan_requirement, plan_key,
         requirement_installation, requirement_version,
         requirement_digest, requirement_tool, requirement_effect
  FROM "RunPluginCallPlan" plan
  JOIN "RunPluginRequirement" requirement ON requirement."id" = plan."requirementId"
  WHERE plan."id" = NEW."planId";

  IF plan_run IS NULL OR plan_requirement IS NULL
     OR NEW."runId" IS DISTINCT FROM plan_run
     OR NEW."invocationKey" IS DISTINCT FROM plan_key
     OR NEW."installationId" IS DISTINCT FROM requirement_installation
     OR NEW."pluginVersionId" IS DISTINCT FROM requirement_version
     OR NEW."pluginDigest" IS DISTINCT FROM requirement_digest
     OR NEW."toolName" IS DISTINCT FROM requirement_tool
     OR NEW."effect" IS DISTINCT FROM requirement_effect THEN
    RAISE EXCEPTION 'Plugin invocation does not match its exact call plan and requirement'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."sequence" = 2 THEN
    SELECT prior."planId" INTO prior_plan
    FROM "PluginInvocation" prior
    WHERE prior."invocationKey" = NEW."invocationKey" AND prior."sequence" = 1;
    IF prior_plan IS NULL OR NEW."planId" IS DISTINCT FROM prior_plan THEN
      RAISE EXCEPTION 'Plugin invocation terminal evidence changed its call plan'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PluginInvocation_exact_plan"
  BEFORE INSERT ON "PluginInvocation"
  FOR EACH ROW EXECUTE FUNCTION "enforce_plugin_invocation_plan_binding"();

COMMIT;
