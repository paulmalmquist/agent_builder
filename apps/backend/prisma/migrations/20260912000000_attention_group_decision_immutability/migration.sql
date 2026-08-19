BEGIN;

-- A grouped decision is human evidence, not merely a lookup key. Preserve the complete decision
-- tuple after commit so a stale individual operation cannot rewrite its outcome or attribution.
-- The only supported mutation is an explicit new request generation, which clears every piece of
-- the old decision evidence before the request can become pending again.
CREATE OR REPLACE FUNCTION "enforce_approval_group_binding"()
RETURNS trigger AS $$
BEGIN
  IF NEW."state" = 'pending'::"ApprovalRequestState" THEN
    IF NEW."decisionGroupKey" IS NOT NULL OR NEW."decisionGroupSize" IS NOT NULL THEN
      RAISE EXCEPTION 'Pending approval request cannot retain a decision group binding'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."decisionGroupKey" IS NOT NULL AND (
    NEW."decisionGroupSize" IS NULL
    OR NEW."decidedBy" IS NULL
    OR NEW."decidedBy" ~ '^system:'
    OR NEW."rationale" IS NULL
    OR length(btrim(NEW."rationale")) < 10
    OR NEW."decidedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Approval group decision requires exact membership and attributable human evidence'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD."decisionGroupKey" IS NOT NULL
       AND (
         NEW."decisionGroupKey" IS DISTINCT FROM OLD."decisionGroupKey"
         OR NEW."decisionGroupSize" IS DISTINCT FROM OLD."decisionGroupSize"
         OR NEW."state" IS DISTINCT FROM OLD."state"
         OR NEW."decidedBy" IS DISTINCT FROM OLD."decidedBy"
         OR NEW."rationale" IS DISTINCT FROM OLD."rationale"
         OR NEW."decidedAt" IS DISTINCT FROM OLD."decidedAt"
         OR NEW."requestVersion" IS DISTINCT FROM OLD."requestVersion"
       )
       AND NOT (
         NEW."state" = 'pending'::"ApprovalRequestState"
         AND NEW."decisionGroupKey" IS NULL
         AND NEW."decisionGroupSize" IS NULL
         AND NEW."decidedBy" IS NULL
         AND NEW."rationale" IS NULL
         AND NEW."decidedAt" IS NULL
         AND NEW."requestVersion" = OLD."requestVersion" + 1
       ) THEN
      RAISE EXCEPTION 'Approval group decision evidence is immutable until an explicit reopen'
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

COMMIT;
