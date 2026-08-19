-- Migration 20260913 initially copied the current schedule backoff onto historical scheduled
-- runs. Before that migration, however, every worker retry used exponential backoff regardless of
-- the schedule declaration. Restore the behavior that was actually in force without touching runs
-- created after the snapshot column became durable.
DO $$
DECLARE
  snapshot_finished_at TIMESTAMPTZ;
BEGIN
  SELECT "finished_at"
  INTO snapshot_finished_at
  FROM "_prisma_migrations"
  WHERE "migration_name" = '20260913000000_execution_retry_policy_snapshot'
    AND "rolled_back_at" IS NULL
    AND "finished_at" IS NOT NULL
  ORDER BY "finished_at" DESC
  LIMIT 1;

  IF snapshot_finished_at IS NULL THEN
    RAISE EXCEPTION
      'Cannot correct historical retry policy: migration 20260913000000_execution_retry_policy_snapshot has no completed record';
  END IF;

  UPDATE "ExecutionRun"
  SET "retryBackoff" = 'exponential'::"AutomationBackoff"
  WHERE "createdAt" <= snapshot_finished_at;
END $$;
