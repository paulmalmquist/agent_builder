BEGIN;

CREATE TABLE "Workspace" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

CREATE TABLE "Department" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Department_workspaceId_slug_key"
  ON "Department"("workspaceId", "slug");
CREATE UNIQUE INDEX "Department_id_workspaceId_key"
  ON "Department"("id", "workspaceId");
CREATE INDEX "Department_workspaceId_name_idx"
  ON "Department"("workspaceId", "name");
ALTER TABLE "Department"
  ADD CONSTRAINT "Department_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "Workspace" ("id", "slug", "name", "createdAt", "updatedAt")
VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'local',
  'Local workspace',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

INSERT INTO "Department" (
  "id", "workspaceId", "slug", "name", "createdAt", "updatedAt"
)
VALUES (
  '00000000-0000-4000-8000-000000000002'::uuid,
  '00000000-0000-4000-8000-000000000001'::uuid,
  'personal',
  'Personal',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
);

-- Adding with a temporary constant default backfills existing immutable evidence without
-- firing its UPDATE/DELETE guards. Defaults are removed immediately so future writes must
-- carry an explicit principal scope.
ALTER TABLE "AgentFamily"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "KnowledgeSource"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "CertificationGateConfig"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "EvalCase"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "EvalCorpusVersion"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "SpecInterpretation"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "AuditEvent"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "ResourceFamily"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "ReleaseBundle"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "ProductionChannel"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "AuthorityGrant"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "ExecutionRun"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "MetricSample"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "AutomationSchedule"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
ALTER TABLE "Observation"
  ADD COLUMN "workspaceId" UUID NOT NULL DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ADD COLUMN "departmentId" UUID DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'AgentFamily', 'KnowledgeSource', 'CertificationGateConfig', 'EvalCase',
    'EvalCorpusVersion', 'SpecInterpretation', 'AuditEvent', 'ResourceFamily',
    'ReleaseBundle', 'ProductionChannel', 'AuthorityGrant', 'ExecutionRun',
    'MetricSample', 'AutomationSchedule', 'Observation'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN "workspaceId" DROP DEFAULT, ALTER COLUMN "departmentId" DROP DEFAULT',
      table_name
    );
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
      table_name,
      table_name || '_workspaceId_fkey'
    );
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE',
      table_name,
      table_name || '_departmentId_workspaceId_fkey'
    );
    EXECUTE format(
      'CREATE INDEX %I ON %I ("workspaceId", "departmentId")',
      table_name || '_workspaceId_departmentId_idx',
      table_name
    );
  END LOOP;
END;
$$;

-- Replace a few generic indexes with time-aware forms represented in the Prisma schema.
DROP INDEX "AuditEvent_workspaceId_departmentId_idx";
CREATE INDEX "AuditEvent_workspaceId_departmentId_createdAt_idx"
  ON "AuditEvent"("workspaceId", "departmentId", "createdAt");
DROP INDEX "ExecutionRun_workspaceId_departmentId_idx";
CREATE INDEX "ExecutionRun_workspaceId_departmentId_createdAt_idx"
  ON "ExecutionRun"("workspaceId", "departmentId", "createdAt");
DROP INDEX "MetricSample_workspaceId_departmentId_idx";
CREATE INDEX "MetricSample_workspaceId_departmentId_observedAt_idx"
  ON "MetricSample"("workspaceId", "departmentId", "observedAt");
DROP INDEX "Observation_workspaceId_departmentId_idx";
CREATE INDEX "Observation_workspaceId_departmentId_observedAt_idx"
  ON "Observation"("workspaceId", "departmentId", "observedAt");

CREATE FUNCTION "protect_aggregate_scope_identity"()
RETURNS trigger AS $$
BEGIN
  IF NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
     OR NEW."departmentId" IS DISTINCT FROM OLD."departmentId" THEN
    RAISE EXCEPTION '% scope is immutable', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'AgentFamily', 'KnowledgeSource', 'CertificationGateConfig', 'EvalCase',
    'EvalCorpusVersion', 'SpecInterpretation', 'AuditEvent', 'ResourceFamily',
    'ReleaseBundle', 'ProductionChannel', 'AuthorityGrant', 'ExecutionRun',
    'MetricSample', 'AutomationSchedule', 'Observation'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OF "workspaceId", "departmentId" ON %I FOR EACH ROW EXECUTE FUNCTION "protect_aggregate_scope_identity"()',
      table_name || '_scope_immutable',
      table_name
    );
  END LOOP;
END;
$$;

-- The temporary legacy Agent compatibility function inserts ResourceFamily through SQL and
-- therefore cannot supply newly generated Prisma fields. Inherit the exact family scope; all
-- non-legacy imports must continue to provide scope explicitly.
CREATE FUNCTION "inherit_legacy_resource_family_scope"()
RETURNS trigger AS $$
DECLARE
  inherited_workspace UUID;
  inherited_department UUID;
BEGIN
  SELECT "workspaceId", "departmentId"
  INTO inherited_workspace, inherited_department
  FROM "AgentFamily"
  WHERE "id" = NEW."id";

  IF FOUND THEN
    IF NEW."workspaceId" IS NULL THEN
      NEW."workspaceId" := inherited_workspace;
    ELSIF NEW."workspaceId" IS DISTINCT FROM inherited_workspace THEN
      RAISE EXCEPTION 'Legacy resource family workspace mismatch'
        USING ERRCODE = '23514';
    END IF;

    IF NEW."departmentId" IS NULL THEN
      NEW."departmentId" := inherited_department;
    ELSIF NEW."departmentId" IS DISTINCT FROM inherited_department THEN
      RAISE EXCEPTION 'Legacy resource family department mismatch'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."workspaceId" IS NULL THEN
    RAISE EXCEPTION 'Resource family scope is required'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResourceFamily_legacy_scope_inherit"
  BEFORE INSERT ON "ResourceFamily"
  FOR EACH ROW EXECUTE FUNCTION "inherit_legacy_resource_family_scope"();

CREATE FUNCTION "enforce_legacy_resource_family_scope"()
RETURNS trigger AS $$
DECLARE
  expected_workspace UUID;
  expected_department UUID;
BEGIN
  SELECT "workspaceId", "departmentId"
  INTO expected_workspace, expected_department
  FROM "AgentFamily"
  WHERE "id" = NEW."id";

  IF FOUND AND (
    NEW."workspaceId" IS DISTINCT FROM expected_workspace
    OR NEW."departmentId" IS DISTINCT FROM expected_department
  ) THEN
    RAISE EXCEPTION 'Legacy resource family scope mismatch'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ResourceFamily_legacy_scope_guard"
  AFTER INSERT OR UPDATE ON "ResourceFamily"
  FOR EACH ROW EXECUTE FUNCTION "enforce_legacy_resource_family_scope"();

COMMIT;
