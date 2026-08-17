BEGIN;

-- The active-run partial index is checked before this AFTER INSERT trigger runs.
-- That ordering lets a new claim wait for an existing active briefing to finish
-- before taking the delivery cursor lock, avoiding a run-index/cursor deadlock.
CREATE FUNCTION "enforce_pending_digest_run"()
RETURNS trigger AS $$
DECLARE
  snapshot_workspace UUID;
  snapshot_department UUID;
  snapshot_scope_key VARCHAR(40);
  snapshot_actor VARCHAR(200);
  snapshot_sequence_from BIGINT;
  delivered_sequence BIGINT;
BEGIN
  IF NEW."digestSnapshotId" IS NULL
     OR NEW."state" NOT IN ('awaiting_approval', 'queued', 'running', 'paused_budget') THEN
    RETURN NEW;
  END IF;

  SELECT snapshot."workspaceId", snapshot."departmentId",
         snapshot."departmentScopeKey", snapshot."actorId",
         snapshot."eventSequenceFrom"
    INTO snapshot_workspace, snapshot_department, snapshot_scope_key,
         snapshot_actor, snapshot_sequence_from
    FROM "DigestSnapshot" snapshot
    WHERE snapshot."id" = NEW."digestSnapshotId";

  IF snapshot_workspace IS NULL
     OR NEW."workspaceId" IS DISTINCT FROM snapshot_workspace
     OR NEW."departmentId" IS DISTINCT FROM snapshot_department THEN
    RAISE EXCEPTION 'ExecutionRun digest snapshot scope mismatch'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext(
      snapshot_workspace::text || ':' || snapshot_scope_key || ':' ||
      snapshot_actor || ':attention-cursor'
    )
  );

  SELECT cursor."lastDeliveredEventSequence"
    INTO delivered_sequence
    FROM "AttentionCursor" cursor
    WHERE cursor."workspaceId" = snapshot_workspace
      AND cursor."departmentScopeKey" = snapshot_scope_key
      AND cursor."actorId" = snapshot_actor;

  IF delivered_sequence IS NULL THEN
    RAISE EXCEPTION 'ExecutionRun digest cursor is unavailable'
      USING ERRCODE = '23514';
  END IF;

  IF snapshot_sequence_from <= delivered_sequence
     OR EXISTS (
       SELECT 1
       FROM "DigestDeliveryAttempt" attempt
       WHERE attempt."snapshotId" = NEW."digestSnapshotId"
         AND attempt."state" = 'delivered'
     ) THEN
    RAISE EXCEPTION 'ExecutionRun digest snapshot was already delivered'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ExecutionRun_pending_digest_snapshot"
  AFTER INSERT ON "ExecutionRun"
  FOR EACH ROW EXECUTE FUNCTION "enforce_pending_digest_run"();

COMMIT;
