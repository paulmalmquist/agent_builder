BEGIN;

ALTER TABLE "ApprovalRequest"
  ADD COLUMN "requestVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "decisionGroupKey" VARCHAR(64);

ALTER TABLE "ApprovalRequest"
  ADD CONSTRAINT "ApprovalRequest_requestVersion_check" CHECK ("requestVersion" > 0),
  ADD CONSTRAINT "ApprovalRequest_decisionGroupKey_check"
    CHECK ("decisionGroupKey" IS NULL OR "decisionGroupKey" ~ '^[a-f0-9]{64}$');

CREATE INDEX "ApprovalRequest_decisionGroupKey_idx" ON "ApprovalRequest"("decisionGroupKey");

-- A group binding exists only for a completed, attributable human decision. Reopening a request
-- clears the binding and increments requestVersion so the next queue snapshot gets a new key.
CREATE FUNCTION "enforce_approval_group_binding"()
RETURNS trigger AS $$
BEGIN
  IF NEW."state" = 'pending'::"ApprovalRequestState" THEN
    IF NEW."decisionGroupKey" IS NOT NULL THEN
      RAISE EXCEPTION 'Pending approval request cannot retain a decision group binding'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."decisionGroupKey" IS NOT NULL AND (
    NEW."decidedBy" IS NULL
    OR NEW."decidedBy" ~ '^system:'
    OR NEW."rationale" IS NULL
    OR length(btrim(NEW."rationale")) < 10
    OR NEW."decidedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Approval group decision requires attributable human evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."decisionGroupKey" IS NOT NULL
       AND NEW."decisionGroupKey" IS DISTINCT FROM OLD."decisionGroupKey"
       AND NOT (
         NEW."state" = 'pending'::"ApprovalRequestState"
         AND NEW."decisionGroupKey" IS NULL
         AND NEW."requestVersion" = OLD."requestVersion" + 1
       ) THEN
      RAISE EXCEPTION 'Approval group decision binding is immutable until an explicit reopen'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."state" = 'pending'::"ApprovalRequestState"
       AND OLD."state" <> 'pending'::"ApprovalRequestState"
       AND NEW."requestVersion" <> OLD."requestVersion" + 1 THEN
      RAISE EXCEPTION 'Reopened approval request must advance its generation'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ApprovalRequest_group_binding"
  BEFORE INSERT OR UPDATE ON "ApprovalRequest"
  FOR EACH ROW EXECUTE FUNCTION "enforce_approval_group_binding"();

COMMIT;
