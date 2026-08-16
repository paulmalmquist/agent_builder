ALTER TABLE "Agent"
  ADD COLUMN "createdBy" VARCHAR(200),
  ADD COLUMN "updatedBy" VARCHAR(200);

ALTER TABLE "AgentSpec"
  ADD COLUMN "createdBy" VARCHAR(200),
  ADD COLUMN "updatedBy" VARCHAR(200);

UPDATE "Agent"
SET "createdBy" = 'system:migration', "updatedBy" = 'system:migration'
WHERE "createdBy" IS NULL OR "updatedBy" IS NULL;

UPDATE "AgentSpec"
SET "createdBy" = 'system:migration', "updatedBy" = 'system:migration'
WHERE "createdBy" IS NULL OR "updatedBy" IS NULL;

ALTER TABLE "Agent"
  ALTER COLUMN "createdBy" SET NOT NULL,
  ALTER COLUMN "updatedBy" SET NOT NULL;

ALTER TABLE "AgentSpec"
  ALTER COLUMN "createdBy" SET NOT NULL,
  ALTER COLUMN "updatedBy" SET NOT NULL;

CREATE TABLE "AuditEvent" (
  "id" UUID NOT NULL,
  "actorId" VARCHAR(200) NOT NULL,
  "requestId" VARCHAR(200),
  "action" VARCHAR(120) NOT NULL,
  "entityType" VARCHAR(80) NOT NULL,
  "entityId" VARCHAR(200) NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditEvent_entityType_entityId_createdAt_idx"
  ON "AuditEvent"("entityType", "entityId", "createdAt");
CREATE INDEX "AuditEvent_actorId_createdAt_idx"
  ON "AuditEvent"("actorId", "createdAt");

CREATE FUNCTION "reject_audit_event_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only';
END;
$$;

CREATE TRIGGER "AuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "reject_audit_event_mutation"();
