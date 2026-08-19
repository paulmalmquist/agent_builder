BEGIN;

ALTER TABLE "ApprovalRequest"
  ADD COLUMN "decisionGroupSize" INTEGER;

-- Forward-safe for any group decisions recorded after 20260910 but before this migration. The
-- group key is a scope-bound commitment to exact membership, so its persisted cardinality can be
-- recovered without exposing member identifiers.
WITH group_sizes AS (
  SELECT "decisionGroupKey", count(*)::integer AS member_count
  FROM "ApprovalRequest"
  WHERE "decisionGroupKey" IS NOT NULL
  GROUP BY "decisionGroupKey"
)
UPDATE "ApprovalRequest" approval
SET "decisionGroupSize" = group_sizes.member_count
FROM group_sizes
WHERE approval."decisionGroupKey" = group_sizes."decisionGroupKey";

ALTER TABLE "ApprovalRequest"
  ADD CONSTRAINT "ApprovalRequest_decisionGroupSize_check"
    CHECK ("decisionGroupSize" IS NULL OR "decisionGroupSize" > 0),
  ADD CONSTRAINT "ApprovalRequest_decisionGroup_shape"
    CHECK (
      ("decisionGroupKey" IS NULL AND "decisionGroupSize" IS NULL)
      OR ("decisionGroupKey" IS NOT NULL AND "decisionGroupSize" IS NOT NULL)
    );

-- Replace the 20260910 guard so an explicit reopen clears both pieces of the durable membership
-- commitment. A surviving subset retains the original size and therefore cannot replay as the
-- original decision.
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
       )
       AND NOT (
         NEW."state" = 'pending'::"ApprovalRequestState"
         AND NEW."decisionGroupKey" IS NULL
         AND NEW."decisionGroupSize" IS NULL
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

COMMIT;
