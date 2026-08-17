BEGIN;

ALTER TABLE "AttentionResolution"
  ADD COLUMN "departmentScopeKey" VARCHAR(40);

-- Resolution evidence is normally append-only. Temporarily remove the guard
-- for this deterministic scope-key backfill, then restore it before commit.
DROP TRIGGER "AttentionResolution_append_only" ON "AttentionResolution";

UPDATE "AttentionResolution"
SET "departmentScopeKey" = COALESCE("departmentId"::text, 'workspace');

ALTER TABLE "AttentionResolution"
  ALTER COLUMN "departmentScopeKey" SET NOT NULL;

DROP INDEX "AttentionResolution_workspaceId_itemId_key";
CREATE UNIQUE INDEX "AttentionResolution_scope_item_key"
  ON "AttentionResolution"("workspaceId", "departmentScopeKey", "itemId");

CREATE TRIGGER "AttentionResolution_department_scope_key"
  BEFORE INSERT OR UPDATE ON "AttentionResolution"
  FOR EACH ROW EXECUTE FUNCTION "enforce_attention_department_scope_key"();

CREATE TRIGGER "AttentionResolution_append_only"
  BEFORE UPDATE OR DELETE ON "AttentionResolution"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();

COMMIT;
