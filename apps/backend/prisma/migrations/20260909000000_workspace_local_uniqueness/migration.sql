BEGIN;

-- Human-facing legacy catalog names are workspace-local. Agent versions inherit scope from family.
DROP INDEX "AgentFamily_slug_key";
CREATE UNIQUE INDEX "AgentFamily_workspaceId_slug_key" ON "AgentFamily"("workspaceId", "slug");
DROP INDEX "Agent_slug_key";
CREATE UNIQUE INDEX "Agent_familyId_slug_key" ON "Agent"("familyId", "slug");

-- Source descriptor IDs are public, stable names rather than global database identities.
ALTER TABLE "AgentKnowledgeSource" DROP CONSTRAINT "AgentKnowledgeSource_sourceId_fkey";
ALTER TABLE "AgentKnowledgeSource" ADD COLUMN "workspaceId" UUID;
UPDATE "AgentKnowledgeSource" link
SET "workspaceId" = source."workspaceId"
FROM "KnowledgeSource" source
WHERE source."id" = link."sourceId";
ALTER TABLE "AgentKnowledgeSource" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "AgentKnowledgeSource" DROP CONSTRAINT "AgentKnowledgeSource_pkey";
ALTER TABLE "KnowledgeSource" DROP CONSTRAINT "KnowledgeSource_pkey";
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("workspaceId", "id");
ALTER TABLE "AgentKnowledgeSource" ADD CONSTRAINT "AgentKnowledgeSource_pkey"
  PRIMARY KEY ("agentId", "workspaceId", "sourceId");
DROP INDEX "AgentKnowledgeSource_sourceId_idx";
CREATE INDEX "AgentKnowledgeSource_workspaceId_sourceId_idx"
  ON "AgentKnowledgeSource"("workspaceId", "sourceId");
ALTER TABLE "AgentKnowledgeSource" ADD CONSTRAINT "AgentKnowledgeSource_workspaceId_sourceId_fkey"
  FOREIGN KEY ("workspaceId", "sourceId") REFERENCES "KnowledgeSource"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Governed sequence numbers and stable keys advance independently in each workspace.
DROP INDEX "CertificationGateConfig_version_key";
CREATE UNIQUE INDEX "CertificationGateConfig_workspaceId_version_key"
  ON "CertificationGateConfig"("workspaceId", "version");
DROP INDEX "CertificationGateConfig_one_active";
CREATE UNIQUE INDEX "CertificationGateConfig_one_active_per_workspace"
  ON "CertificationGateConfig"("workspaceId") WHERE "state" = 'active';

DROP INDEX "EvalCase_key_key";
CREATE UNIQUE INDEX "EvalCase_workspaceId_key_key" ON "EvalCase"("workspaceId", "key");
DROP INDEX "EvalCorpusVersion_version_key";
CREATE UNIQUE INDEX "EvalCorpusVersion_workspaceId_version_key"
  ON "EvalCorpusVersion"("workspaceId", "version");
-- EvalCorpusVersion.contentHash, ResourceVersion.digest, and ReleaseBundle.digest remain
-- intentionally global content-addresses.

DROP INDEX "CertificationRun_nightlyScheduleKey_key";
CREATE UNIQUE INDEX "CertificationRun_familyId_nightlyScheduleKey_key"
  ON "CertificationRun"("familyId", "nightlyScheduleKey");

DROP INDEX "ResourceFamily_kind_slug_key";
CREATE UNIQUE INDEX "ResourceFamily_workspaceId_kind_slug_key"
  ON "ResourceFamily"("workspaceId", "kind", "slug");

-- A channel key and its optional project alias identify a channel inside one workspace.
ALTER TABLE "ReleasePromotionDecision" DROP CONSTRAINT "ReleasePromotionDecision_channelKey_fkey";
ALTER TABLE "AutomationSchedule" DROP CONSTRAINT "AutomationSchedule_channelKey_fkey";
ALTER TABLE "ReleasePromotionDecision" ADD COLUMN "workspaceId" UUID;
ALTER TABLE "ReleasePromotionDecision" DISABLE TRIGGER "ReleasePromotionDecision_append_only";
UPDATE "ReleasePromotionDecision" decision
SET "workspaceId" = channel."workspaceId"
FROM "ProductionChannel" channel
WHERE channel."key" = decision."channelKey";
ALTER TABLE "ReleasePromotionDecision" ENABLE TRIGGER "ReleasePromotionDecision_append_only";
ALTER TABLE "ReleasePromotionDecision" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "ProductionChannel" DROP CONSTRAINT "ProductionChannel_pkey";
ALTER TABLE "ProductionChannel" ADD CONSTRAINT "ProductionChannel_pkey"
  PRIMARY KEY ("workspaceId", "key");
DROP INDEX "ProductionChannel_projectId_key";
CREATE UNIQUE INDEX "ProductionChannel_workspaceId_projectId_key"
  ON "ProductionChannel"("workspaceId", "projectId");
DROP INDEX "ReleasePromotionDecision_channelKey_decidedAt_idx";
CREATE INDEX "ReleasePromotionDecision_workspaceId_channelKey_decidedAt_idx"
  ON "ReleasePromotionDecision"("workspaceId", "channelKey", "decidedAt");
DROP INDEX "ReleaseDeclineDecision_channelKey_decidedAt_idx";
CREATE INDEX "ReleaseDeclineDecision_workspaceId_channelKey_decidedAt_idx"
  ON "ReleaseDeclineDecision"("workspaceId", "channelKey", "decidedAt");
DROP INDEX "AutomationSchedule_channelKey_state_idx";
CREATE INDEX "AutomationSchedule_workspaceId_channelKey_state_idx"
  ON "AutomationSchedule"("workspaceId", "channelKey", "state");
ALTER TABLE "ReleasePromotionDecision" ADD CONSTRAINT "ReleasePromotionDecision_workspaceId_channelKey_fkey"
  FOREIGN KEY ("workspaceId", "channelKey") REFERENCES "ProductionChannel"("workspaceId", "key")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationSchedule" ADD CONSTRAINT "AutomationSchedule_workspaceId_channelKey_fkey"
  FOREIGN KEY ("workspaceId", "channelKey") REFERENCES "ProductionChannel"("workspaceId", "key")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Request, effect, schedule, observation, delivery, and index idempotency is tenant-local.
DROP INDEX "ExecutionRun_idempotencyKey_key";
CREATE UNIQUE INDEX "ExecutionRun_workspaceId_idempotencyKey_key"
  ON "ExecutionRun"("workspaceId", "idempotencyKey");
DROP INDEX "RunStep_idempotencyKey_key";
CREATE UNIQUE INDEX "RunStep_runId_idempotencyKey_key" ON "RunStep"("runId", "idempotencyKey");
DROP INDEX "PluginInvocation_invocationKey_sequence_key";
CREATE UNIQUE INDEX "PluginInvocation_workspaceId_invocationKey_sequence_key"
  ON "PluginInvocation"("workspaceId", "invocationKey", "sequence");
DROP INDEX "RunPluginCallPlan_invocationKey_key";
CREATE UNIQUE INDEX "RunPluginCallPlan_workspaceId_invocationKey_key"
  ON "RunPluginCallPlan"("workspaceId", "invocationKey");
DROP INDEX "AutomationDispatch_idempotencyKey_key";
CREATE UNIQUE INDEX "AutomationDispatch_scheduleId_idempotencyKey_key"
  ON "AutomationDispatch"("scheduleId", "idempotencyKey");
DROP INDEX "Observation_signalKey_key";
CREATE UNIQUE INDEX "Observation_workspaceId_signalKey_key"
  ON "Observation"("workspaceId", "signalKey");
DROP INDEX "DigestDeliveryAttempt_attemptKey_key";
CREATE UNIQUE INDEX "DigestDeliveryAttempt_workspaceId_attemptKey_key"
  ON "DigestDeliveryAttempt"("workspaceId", "attemptKey");
DROP INDEX "CatalogIndexOutbox_idempotencyKey_key";
CREATE UNIQUE INDEX "CatalogIndexOutbox_workspaceId_idempotencyKey_key"
  ON "CatalogIndexOutbox"("workspaceId", "idempotencyKey");
DROP INDEX "BuilderDecision_idempotencyKey_key";
CREATE UNIQUE INDEX "BuilderDecision_workspaceId_idempotencyKey_key"
  ON "BuilderDecision"("workspaceId", "idempotencyKey");

COMMIT;
