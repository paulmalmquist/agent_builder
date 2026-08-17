BEGIN;

CREATE UNIQUE INDEX "ExecutionRun_one_active_digest_snapshot"
  ON "ExecutionRun"("digestSnapshotId")
  WHERE "digestSnapshotId" IS NOT NULL
    AND "state" IN ('awaiting_approval', 'queued', 'running', 'paused_budget');

COMMIT;
