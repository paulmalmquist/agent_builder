-- A run must carry the retry policy that was reviewed on its originating schedule. Reading the
-- mutable schedule during recovery would make an in-flight run change semantics after creation.
ALTER TABLE "ExecutionRun"
  ADD COLUMN "retryBackoff" "AutomationBackoff";

-- Preserve the declared policy for already-dispatched scheduled runs. Direct and legacy runs used
-- the worker's historical exponential behavior and therefore backfill to that exact strategy.
UPDATE "ExecutionRun" run
SET "retryBackoff" = schedule."backoff"
FROM "AutomationDispatch" dispatch
JOIN "AutomationSchedule" schedule ON schedule."id" = dispatch."scheduleId"
WHERE dispatch."runId" = run."id";

UPDATE "ExecutionRun"
SET "retryBackoff" = 'exponential'::"AutomationBackoff"
WHERE "retryBackoff" IS NULL;

ALTER TABLE "ExecutionRun"
  ALTER COLUMN "retryBackoff" SET DEFAULT 'exponential'::"AutomationBackoff",
  ALTER COLUMN "retryBackoff" SET NOT NULL;
