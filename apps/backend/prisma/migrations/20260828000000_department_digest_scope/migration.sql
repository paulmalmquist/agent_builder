BEGIN;

ALTER TABLE "AttentionCursor"
  ADD COLUMN "departmentScopeKey" VARCHAR(40);
ALTER TABLE "DigestSnapshot"
  ADD COLUMN "departmentScopeKey" VARCHAR(40);

-- The snapshot remains immutable to application code. Temporarily remove the
-- evidence trigger only for this deterministic scope-key backfill.
DROP TRIGGER "DigestSnapshot_append_only" ON "DigestSnapshot";

UPDATE "AttentionCursor"
SET "departmentScopeKey" = COALESCE("departmentId"::text, 'workspace');
UPDATE "DigestSnapshot"
SET "departmentScopeKey" = COALESCE("departmentId"::text, 'workspace');

ALTER TABLE "AttentionCursor"
  ALTER COLUMN "departmentScopeKey" SET NOT NULL;
ALTER TABLE "DigestSnapshot"
  ALTER COLUMN "departmentScopeKey" SET NOT NULL;

DROP INDEX "AttentionCursor_workspaceId_actorId_key";
DROP INDEX "DigestSnapshot_workspaceId_actorId_eventSequenceFrom_eventSequenceThrough_key";

CREATE UNIQUE INDEX "AttentionCursor_workspaceId_departmentScopeKey_actorId_key"
  ON "AttentionCursor"("workspaceId", "departmentScopeKey", "actorId");
CREATE UNIQUE INDEX "DigestSnapshot_workspaceId_departmentScopeKey_actorId_eventSequenceFrom_eventSequenceThrough_key"
  ON "DigestSnapshot"(
    "workspaceId", "departmentScopeKey", "actorId",
    "eventSequenceFrom", "eventSequenceThrough"
  );

CREATE FUNCTION "enforce_attention_department_scope_key"()
RETURNS trigger AS $$
BEGIN
  IF NEW."departmentScopeKey" IS DISTINCT FROM COALESCE(NEW."departmentId"::text, 'workspace') THEN
    RAISE EXCEPTION '% department scope key mismatch', TG_TABLE_NAME
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AttentionCursor_department_scope_key"
  BEFORE INSERT OR UPDATE ON "AttentionCursor"
  FOR EACH ROW EXECUTE FUNCTION "enforce_attention_department_scope_key"();
CREATE TRIGGER "DigestSnapshot_department_scope_key"
  BEFORE INSERT OR UPDATE ON "DigestSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "enforce_attention_department_scope_key"();

CREATE TRIGGER "DigestSnapshot_append_only"
  BEFORE UPDATE OR DELETE ON "DigestSnapshot"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();

-- This is intentionally repeated in the later migration so databases that
-- applied the digest-binding migration before the decision-race hardening get
-- the same invariant as clean installations.
DROP TRIGGER IF EXISTS "ReleaseDeclineDecision_single_decision" ON "ReleaseDeclineDecision";
DROP TRIGGER IF EXISTS "ReleasePromotionDecision_single_decision" ON "ReleasePromotionDecision";
CREATE OR REPLACE FUNCTION "enforce_release_evidence_single_decision"()
RETURNS trigger AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW."evaluationId"::text || ':release-evidence-decision'));
  IF TG_TABLE_NAME = 'ReleaseDeclineDecision' AND EXISTS (
    SELECT 1 FROM "ReleasePromotionDecision"
    WHERE "evaluationId" = NEW."evaluationId"
  ) THEN
    RAISE EXCEPTION 'Release evaluation already has a promotion decision'
      USING ERRCODE = '23505';
  END IF;
  IF TG_TABLE_NAME = 'ReleasePromotionDecision' AND EXISTS (
    SELECT 1 FROM "ReleaseDeclineDecision"
    WHERE "evaluationId" = NEW."evaluationId"
  ) THEN
    RAISE EXCEPTION 'Release evaluation already has a decline decision'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ReleaseDeclineDecision_single_decision"
  BEFORE INSERT ON "ReleaseDeclineDecision"
  FOR EACH ROW EXECUTE FUNCTION "enforce_release_evidence_single_decision"();
CREATE TRIGGER "ReleasePromotionDecision_single_decision"
  BEFORE INSERT ON "ReleasePromotionDecision"
  FOR EACH ROW EXECUTE FUNCTION "enforce_release_evidence_single_decision"();

COMMIT;
