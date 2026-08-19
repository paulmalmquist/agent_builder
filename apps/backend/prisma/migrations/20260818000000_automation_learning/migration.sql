CREATE TYPE "AutomationScheduleState" AS ENUM ('active', 'paused');
CREATE TYPE "AutomationCatchUpPolicy" AS ENUM ('latest_only', 'all', 'none');
CREATE TYPE "AutomationBackoff" AS ENUM ('fixed', 'exponential');
CREATE TYPE "AutomationDispatchState" AS ENUM ('pending', 'processing', 'run_created', 'failed');
CREATE TYPE "ImprovementCandidateState" AS ENUM ('proposed', 'incubating', 'rejected');
CREATE TYPE "MemoryCandidateState" AS ENUM ('staged', 'accepted', 'rejected');

CREATE TABLE "AutomationSchedule" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR(160) NOT NULL,
  "channelKey" VARCHAR(160) NOT NULL,
  "releaseId" UUID NOT NULL,
  "releaseDigest" VARCHAR(64) NOT NULL,
  "projectId" VARCHAR(160),
  "authorityGrantId" UUID,
  "timezone" VARCHAR(100) NOT NULL,
  "intervalSeconds" INTEGER NOT NULL,
  "nextRunAt" TIMESTAMPTZ(3) NOT NULL,
  "inputTemplate" JSONB NOT NULL,
  "inputConstraints" JSONB NOT NULL DEFAULT '{}',
  "catchUpPolicy" "AutomationCatchUpPolicy" NOT NULL DEFAULT 'latest_only',
  "maxCatchUpRuns" INTEGER NOT NULL DEFAULT 10,
  "deduplicationWindowSeconds" INTEGER NOT NULL DEFAULT 300,
  "maximumAttempts" INTEGER NOT NULL DEFAULT 3,
  "backoff" "AutomationBackoff" NOT NULL DEFAULT 'exponential',
  "maxInputTokens" INTEGER NOT NULL,
  "maxOutputTokens" INTEGER NOT NULL,
  "maxEstimatedCostUsd" DECIMAL(18,8) NOT NULL,
  "outcomeExpectations" JSONB NOT NULL DEFAULT '{}',
  "state" "AutomationScheduleState" NOT NULL DEFAULT 'active',
  "lastScheduledAt" TIMESTAMPTZ(3),
  "createdBy" VARCHAR(200) NOT NULL,
  "updatedBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AutomationSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AutomationSchedule_interval_check" CHECK ("intervalSeconds" >= 60),
  CONSTRAINT "AutomationSchedule_catch_up_check" CHECK ("maxCatchUpRuns" BETWEEN 1 AND 100),
  CONSTRAINT "AutomationSchedule_attempts_check" CHECK ("maximumAttempts" BETWEEN 1 AND 20),
  CONSTRAINT "AutomationSchedule_cost_check" CHECK ("maxEstimatedCostUsd" >= 0)
);
CREATE INDEX "AutomationSchedule_state_nextRunAt_idx" ON "AutomationSchedule"("state", "nextRunAt");
CREATE INDEX "AutomationSchedule_channelKey_state_idx" ON "AutomationSchedule"("channelKey", "state");
CREATE INDEX "AutomationSchedule_authorityGrantId_idx" ON "AutomationSchedule"("authorityGrantId");

CREATE TABLE "AutomationDispatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "scheduleId" UUID NOT NULL,
  "scheduledFor" TIMESTAMPTZ(3) NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "state" "AutomationDispatchState" NOT NULL DEFAULT 'pending',
  "claimToken" VARCHAR(100),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "runId" UUID,
  "error" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AutomationDispatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutomationDispatch_idempotencyKey_key" ON "AutomationDispatch"("idempotencyKey");
CREATE UNIQUE INDEX "AutomationDispatch_runId_key" ON "AutomationDispatch"("runId");
CREATE UNIQUE INDEX "AutomationDispatch_scheduleId_scheduledFor_key" ON "AutomationDispatch"("scheduleId", "scheduledFor");
CREATE INDEX "AutomationDispatch_state_createdAt_idx" ON "AutomationDispatch"("state", "createdAt");
CREATE INDEX "AutomationDispatch_state_leaseExpiresAt_idx" ON "AutomationDispatch"("state", "leaseExpiresAt");

CREATE TABLE "Observation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signalKey" VARCHAR(200) NOT NULL,
  "signalType" VARCHAR(120) NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "provenance" JSONB NOT NULL DEFAULT '{}',
  "sourceRunId" UUID,
  "sourceOutcomeId" UUID,
  "observedBy" VARCHAR(200) NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Observation_signalKey_key" ON "Observation"("signalKey");
CREATE INDEX "Observation_sourceRunId_observedAt_idx" ON "Observation"("sourceRunId", "observedAt");
CREATE INDEX "Observation_signalType_observedAt_idx" ON "Observation"("signalType", "observedAt");

CREATE TABLE "ImprovementCandidate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "observationId" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "proposedTarget" VARCHAR(200) NOT NULL,
  "proposedChange" TEXT NOT NULL,
  "evidenceRefs" JSONB NOT NULL DEFAULT '[]',
  "state" "ImprovementCandidateState" NOT NULL DEFAULT 'proposed',
  "createdBy" VARCHAR(200) NOT NULL,
  "reviewedBy" VARCHAR(200),
  "reviewRationale" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ImprovementCandidate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImprovementCandidate_state_createdAt_idx" ON "ImprovementCandidate"("state", "createdAt");
CREATE INDEX "ImprovementCandidate_observationId_idx" ON "ImprovementCandidate"("observationId");

CREATE TABLE "MemoryCandidate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sourceRunId" UUID NOT NULL,
  "namespace" VARCHAR(160) NOT NULL,
  "proposedValue" JSONB NOT NULL,
  "acceptedValue" JSONB,
  "provenance" JSONB NOT NULL DEFAULT '{}',
  "state" "MemoryCandidateState" NOT NULL DEFAULT 'staged',
  "stagedBy" VARCHAR(200) NOT NULL,
  "reviewedBy" VARCHAR(200),
  "reviewRationale" TEXT,
  "stagedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMPTZ(3),
  CONSTRAINT "MemoryCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemoryCandidate_accepted_value_check" CHECK (
    ("state" = 'accepted' AND "acceptedValue" IS NOT NULL)
    OR ("state" <> 'accepted' AND "acceptedValue" IS NULL)
  )
);
CREATE UNIQUE INDEX "MemoryCandidate_sourceRunId_namespace_key" ON "MemoryCandidate"("sourceRunId", "namespace");
CREATE INDEX "MemoryCandidate_state_stagedAt_idx" ON "MemoryCandidate"("state", "stagedAt");

ALTER TABLE "AutomationSchedule" ADD CONSTRAINT "AutomationSchedule_channelKey_fkey"
  FOREIGN KEY ("channelKey") REFERENCES "ProductionChannel"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationSchedule" ADD CONSTRAINT "AutomationSchedule_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationSchedule" ADD CONSTRAINT "AutomationSchedule_authorityGrantId_fkey"
  FOREIGN KEY ("authorityGrantId") REFERENCES "AuthorityGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationDispatch" ADD CONSTRAINT "AutomationDispatch_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "AutomationSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationDispatch" ADD CONSTRAINT "AutomationDispatch_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_sourceRunId_fkey"
  FOREIGN KEY ("sourceRunId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_sourceOutcomeId_fkey"
  FOREIGN KEY ("sourceOutcomeId") REFERENCES "OutcomeRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImprovementCandidate" ADD CONSTRAINT "ImprovementCandidate_observationId_fkey"
  FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemoryCandidate" ADD CONSTRAINT "MemoryCandidate_sourceRunId_fkey"
  FOREIGN KEY ("sourceRunId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "Observation_append_only"
  BEFORE UPDATE OR DELETE ON "Observation"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();

CREATE FUNCTION "protect_reviewed_learning_record"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Reviewed learning records are immutable';
  END IF;
  IF OLD."state"::text <> 'proposed' AND OLD."state"::text <> 'staged' THEN
    RAISE EXCEPTION 'Reviewed learning records are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ImprovementCandidate_reviewed_immutable"
  BEFORE UPDATE OR DELETE ON "ImprovementCandidate"
  FOR EACH ROW EXECUTE FUNCTION "protect_reviewed_learning_record"();
CREATE TRIGGER "MemoryCandidate_reviewed_immutable"
  BEFORE UPDATE OR DELETE ON "MemoryCandidate"
  FOR EACH ROW EXECUTE FUNCTION "protect_reviewed_learning_record"();
