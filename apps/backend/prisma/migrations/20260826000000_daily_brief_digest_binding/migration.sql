BEGIN;

ALTER TABLE "AutomationSchedule"
  ADD COLUMN "includePlatformDigest" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ExecutionRun"
  ADD COLUMN "digestSnapshotId" UUID;

CREATE INDEX "ExecutionRun_digestSnapshotId_createdAt_idx"
  ON "ExecutionRun"("digestSnapshotId", "createdAt");

ALTER TABLE "ExecutionRun"
  ADD CONSTRAINT "ExecutionRun_digestSnapshotId_fkey"
  FOREIGN KEY ("digestSnapshotId") REFERENCES "DigestSnapshot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AttentionResolution" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "itemId" VARCHAR(320) NOT NULL,
  "rationale" TEXT NOT NULL,
  "resolvedBy" VARCHAR(200) NOT NULL,
  "resolvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttentionResolution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AttentionResolution_workspaceId_itemId_key"
  ON "AttentionResolution"("workspaceId", "itemId");
CREATE INDEX "AttentionResolution_workspaceId_departmentId_resolvedAt_idx"
  ON "AttentionResolution"("workspaceId", "departmentId", "resolvedAt");
ALTER TABLE "AttentionResolution"
  ADD CONSTRAINT "AttentionResolution_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "AttentionResolution_departmentId_workspaceId_fkey"
  FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER "AttentionResolution_append_only"
  BEFORE UPDATE OR DELETE ON "AttentionResolution"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();

CREATE FUNCTION "enforce_attention_parent_scope"()
RETURNS trigger AS $$
DECLARE
  parent_workspace UUID;
  parent_department UUID;
  evaluation_release UUID;
BEGIN
  IF TG_TABLE_NAME = 'ExecutionRunEvent' THEN
    SELECT "workspaceId", "departmentId"
      INTO parent_workspace, parent_department
      FROM "ExecutionRun" WHERE "id" = NEW."runId";
  ELSIF TG_TABLE_NAME = 'DigestDeliveryAttempt' THEN
    SELECT "workspaceId", "departmentId"
      INTO parent_workspace, parent_department
      FROM "DigestSnapshot" WHERE "id" = NEW."snapshotId";
    IF NEW."briefingRunId" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "ExecutionRun"
      WHERE "id" = NEW."briefingRunId"
        AND "workspaceId" = NEW."workspaceId"
        AND "departmentId" IS NOT DISTINCT FROM NEW."departmentId"
        AND "digestSnapshotId" = NEW."snapshotId"
    ) THEN
      RAISE EXCEPTION 'DigestDeliveryAttempt run scope or snapshot binding mismatch'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'ReleaseDeclineDecision' THEN
    SELECT release."workspaceId", release."departmentId", evaluation."releaseId"
      INTO parent_workspace, parent_department, evaluation_release
      FROM "ReleaseEvaluation" evaluation
      JOIN "ReleaseBundle" release ON release."id" = evaluation."releaseId"
      WHERE evaluation."id" = NEW."evaluationId";
    IF evaluation_release IS DISTINCT FROM NEW."releaseId" THEN
      RAISE EXCEPTION 'ReleaseDeclineDecision evidence release mismatch'
        USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'ExecutionRun' AND NEW."digestSnapshotId" IS NOT NULL THEN
    SELECT "workspaceId", "departmentId"
      INTO parent_workspace, parent_department
      FROM "DigestSnapshot" WHERE "id" = NEW."digestSnapshotId";
  ELSE
    RETURN NEW;
  END IF;

  IF parent_workspace IS NULL
     OR NEW."workspaceId" IS DISTINCT FROM parent_workspace
     OR NEW."departmentId" IS DISTINCT FROM parent_department THEN
    RAISE EXCEPTION '% parent scope mismatch', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ExecutionRunEvent_parent_scope"
  BEFORE INSERT OR UPDATE ON "ExecutionRunEvent"
  FOR EACH ROW EXECUTE FUNCTION "enforce_attention_parent_scope"();
CREATE TRIGGER "DigestDeliveryAttempt_parent_scope"
  BEFORE INSERT OR UPDATE ON "DigestDeliveryAttempt"
  FOR EACH ROW EXECUTE FUNCTION "enforce_attention_parent_scope"();
CREATE TRIGGER "ReleaseDeclineDecision_parent_scope"
  BEFORE INSERT OR UPDATE ON "ReleaseDeclineDecision"
  FOR EACH ROW EXECUTE FUNCTION "enforce_attention_parent_scope"();
CREATE TRIGGER "ExecutionRun_digest_snapshot_scope"
  BEFORE INSERT OR UPDATE OF "digestSnapshotId", "workspaceId", "departmentId" ON "ExecutionRun"
  FOR EACH ROW EXECUTE FUNCTION "enforce_attention_parent_scope"();

COMMIT;
