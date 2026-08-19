BEGIN;

CREATE TYPE "DigestDeliveryAttemptState" AS ENUM ('delivered', 'failed');

CREATE TABLE "PlatformEvent" (
  "id" UUID NOT NULL,
  "sequence" BIGSERIAL NOT NULL,
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "kind" VARCHAR(120) NOT NULL,
  "entityType" VARCHAR(120) NOT NULL,
  "entityId" VARCHAR(240) NOT NULL,
  "summary" JSONB NOT NULL,
  "actorId" VARCHAR(200),
  "requestId" VARCHAR(200),
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttentionCursor" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "actorId" VARCHAR(200) NOT NULL,
  "lastDeliveredEventSequence" BIGINT NOT NULL DEFAULT 0,
  "lastDeliveredAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AttentionCursor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DigestSnapshot" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "actorId" VARCHAR(200) NOT NULL,
  "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
  "windowEndedAt" TIMESTAMPTZ(3) NOT NULL,
  "eventSequenceFrom" BIGINT NOT NULL,
  "eventSequenceThrough" BIGINT NOT NULL,
  "summary" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DigestSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigestSnapshot_sequence_window_check"
    CHECK ("eventSequenceFrom" <= "eventSequenceThrough")
);

CREATE TABLE "DigestDeliveryAttempt" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "snapshotId" UUID NOT NULL,
  "attemptKey" VARCHAR(240) NOT NULL,
  "state" "DigestDeliveryAttemptState" NOT NULL,
  "briefingRunId" UUID,
  "error" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMPTZ(3),
  CONSTRAINT "DigestDeliveryAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DigestDeliveryAttempt_delivery_shape_check" CHECK (
    ("state" = 'delivered' AND "deliveredAt" IS NOT NULL AND "error" IS NULL)
    OR ("state" = 'failed' AND "deliveredAt" IS NULL)
  )
);

CREATE TABLE "ExecutionRunEvent" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "runId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "phase" VARCHAR(160) NOT NULL,
  "state" VARCHAR(80) NOT NULL,
  "message" VARCHAR(500) NOT NULL,
  "durationMs" INTEGER,
  "costUsd" DECIMAL(18,8),
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExecutionRunEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExecutionRunEvent_duration_check" CHECK ("durationMs" IS NULL OR "durationMs" >= 0),
  CONSTRAINT "ExecutionRunEvent_cost_check" CHECK ("costUsd" IS NULL OR "costUsd" >= 0)
);

CREATE TABLE "ReleaseDeclineDecision" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "channelKey" VARCHAR(160) NOT NULL,
  "releaseId" UUID NOT NULL,
  "evaluationId" UUID NOT NULL,
  "rationale" TEXT NOT NULL,
  "decidedBy" VARCHAR(200) NOT NULL,
  "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleaseDeclineDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformEvent_sequence_key" ON "PlatformEvent"("sequence");
CREATE INDEX "PlatformEvent_workspaceId_departmentId_sequence_idx"
  ON "PlatformEvent"("workspaceId", "departmentId", "sequence");
CREATE INDEX "PlatformEvent_workspaceId_actorId_sequence_idx"
  ON "PlatformEvent"("workspaceId", "actorId", "sequence");

CREATE UNIQUE INDEX "AttentionCursor_workspaceId_actorId_key"
  ON "AttentionCursor"("workspaceId", "actorId");
CREATE INDEX "AttentionCursor_workspaceId_departmentId_updatedAt_idx"
  ON "AttentionCursor"("workspaceId", "departmentId", "updatedAt");

CREATE UNIQUE INDEX "DigestSnapshot_workspaceId_actorId_eventSequenceFrom_eventSequenceThrough_key"
  ON "DigestSnapshot"("workspaceId", "actorId", "eventSequenceFrom", "eventSequenceThrough");
CREATE INDEX "DigestSnapshot_workspaceId_departmentId_createdAt_idx"
  ON "DigestSnapshot"("workspaceId", "departmentId", "createdAt");

CREATE UNIQUE INDEX "DigestDeliveryAttempt_attemptKey_key"
  ON "DigestDeliveryAttempt"("attemptKey");
CREATE UNIQUE INDEX "DigestDeliveryAttempt_one_delivered_per_snapshot"
  ON "DigestDeliveryAttempt"("snapshotId") WHERE "state" = 'delivered';
CREATE INDEX "DigestDeliveryAttempt_workspaceId_departmentId_createdAt_idx"
  ON "DigestDeliveryAttempt"("workspaceId", "departmentId", "createdAt");
CREATE INDEX "DigestDeliveryAttempt_snapshotId_createdAt_idx"
  ON "DigestDeliveryAttempt"("snapshotId", "createdAt");

CREATE UNIQUE INDEX "ExecutionRunEvent_runId_sequence_key"
  ON "ExecutionRunEvent"("runId", "sequence");
CREATE INDEX "ExecutionRunEvent_workspaceId_departmentId_occurredAt_idx"
  ON "ExecutionRunEvent"("workspaceId", "departmentId", "occurredAt");
CREATE INDEX "ExecutionRunEvent_runId_occurredAt_idx"
  ON "ExecutionRunEvent"("runId", "occurredAt");

CREATE UNIQUE INDEX "ReleaseDeclineDecision_evaluationId_key"
  ON "ReleaseDeclineDecision"("evaluationId");
CREATE INDEX "ReleaseDeclineDecision_workspaceId_departmentId_decidedAt_idx"
  ON "ReleaseDeclineDecision"("workspaceId", "departmentId", "decidedAt");
CREATE INDEX "ReleaseDeclineDecision_channelKey_decidedAt_idx"
  ON "ReleaseDeclineDecision"("channelKey", "decidedAt");
CREATE INDEX "ReleaseDeclineDecision_releaseId_decidedAt_idx"
  ON "ReleaseDeclineDecision"("releaseId", "decidedAt");

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'PlatformEvent', 'AttentionCursor', 'DigestSnapshot',
    'DigestDeliveryAttempt', 'ExecutionRunEvent', 'ReleaseDeclineDecision'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
      table_name,
      table_name || '_workspaceId_fkey'
    );
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE',
      table_name,
      table_name || '_departmentId_workspaceId_fkey'
    );
  END LOOP;
END;
$$;

ALTER TABLE "DigestDeliveryAttempt"
  ADD CONSTRAINT "DigestDeliveryAttempt_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "DigestSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DigestDeliveryAttempt_briefingRunId_fkey"
  FOREIGN KEY ("briefingRunId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExecutionRunEvent"
  ADD CONSTRAINT "ExecutionRunEvent_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReleaseDeclineDecision"
  ADD CONSTRAINT "ReleaseDeclineDecision_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ReleaseDeclineDecision_evaluationId_fkey"
  FOREIGN KEY ("evaluationId") REFERENCES "ReleaseEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "AttentionCursor_scope_immutable"
  BEFORE UPDATE OF "workspaceId", "departmentId" ON "AttentionCursor"
  FOR EACH ROW EXECUTE FUNCTION "protect_aggregate_scope_identity"();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'PlatformEvent', 'DigestSnapshot', 'DigestDeliveryAttempt',
    'ExecutionRunEvent', 'ReleaseDeclineDecision'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"()',
      table_name || '_append_only',
      table_name
    );
  END LOOP;
END;
$$;

COMMIT;
