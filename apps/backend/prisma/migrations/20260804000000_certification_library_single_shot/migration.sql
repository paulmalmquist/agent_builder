CREATE TYPE "AgentDerivationMode" AS ENUM ('new', 'configure', 'extend');
CREATE TYPE "CertificationHealth" AS ENUM ('not_certified', 'current', 'degraded');
CREATE TYPE "RetirementReason" AS ENUM ('explicit', 'superseded_by_promotion');
CREATE TYPE "CertificationRunState" AS ENUM ('queued', 'running', 'passed', 'failed', 'error');
CREATE TYPE "CertificationRunKind" AS ENUM ('challenger', 'champion_recertification');
CREATE TYPE "CertificationVerdict" AS ENUM ('passed', 'failed', 'error');
CREATE TYPE "CertificationGateConfigState" AS ENUM ('active', 'superseded');
CREATE TYPE "CertificationGateKey" AS ENUM ('factual_accuracy', 'citation_coverage', 'unauthorized_actions', 'champion_regression');
CREATE TYPE "CertificationGateOperator" AS ENUM ('gte', 'lte', 'eq');
CREATE TYPE "CertificationGateResultStatus" AS ENUM ('passed', 'failed', 'not_applicable');
CREATE TYPE "ExecutorKind" AS ENUM ('manifest_fixture');
CREATE TYPE "EvaluationMode" AS ENUM ('corpus_coverage', 'semantic_execution');
CREATE TYPE "CertificationResultsAvailability" AS ENUM ('full', 'summary_only', 'promotion_evidence');
CREATE TYPE "EvalCaseTag" AS ENUM ('golden', 'replay', 'false_alarm', 'regression');
CREATE TYPE "EvalCaseSource" AS ENUM ('seed', 'override', 'incident');
CREATE TYPE "PromotionDecisionType" AS ENUM ('promoted', 'declined');
CREATE TYPE "SpecSection" AS ENUM ('outcomes', 'knowledge', 'guardrails', 'outputs');
CREATE TYPE "SectionConfirmationKind" AS ENUM ('guided', 'interpreted', 'inherited');

ALTER TYPE "AgentStatus" ADD VALUE 'certifying';
ALTER TYPE "AgentStatus" ADD VALUE 'certified';
ALTER TYPE "AgentStatus" ADD VALUE 'rejected';
ALTER TYPE "AgentStatus" ADD VALUE 'retired';

CREATE TABLE "AgentFamily" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(160) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "department" VARCHAR(120) NOT NULL,
  "owner" VARCHAR(160) NOT NULL,
  "championAgentId" UUID,
  "createdBy" VARCHAR(200) NOT NULL,
  "updatedBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentFamily_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Agent"
  ADD COLUMN "activationDecisionId" UUID,
  ADD COLUMN "certificationHealth" "CertificationHealth" NOT NULL DEFAULT 'not_certified',
  ADD COLUMN "degradationReason" TEXT,
  ADD COLUMN "degradedAt" TIMESTAMPTZ(3),
  ADD COLUMN "derivationMode" "AgentDerivationMode" NOT NULL DEFAULT 'new',
  ADD COLUMN "familyId" UUID,
  ADD COLUMN "legacyActivation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "manifestHash" VARCHAR(128),
  ADD COLUMN "predecessorAgentId" UUID,
  ADD COLUMN "retiredAt" TIMESTAMPTZ(3),
  ADD COLUMN "retiredBy" VARCHAR(200),
  ADD COLUMN "retirementRationale" TEXT,
  ADD COLUMN "retirementReason" "RetirementReason",
  ADD COLUMN "successorAgentId" UUID,
  ADD COLUMN "versionNumber" INTEGER;

-- Existing concrete agents become version 1 of a same-slug family. Their concrete
-- slug gains the required -v1 suffix; this covers the two seeded agents and any
-- local agents created before versioning was introduced.
INSERT INTO "AgentFamily" (
  "id", "slug", "name", "department", "owner", "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT
  "id", "slug", "name", "department", "owner", "createdBy", "updatedBy", "createdAt", "updatedAt"
FROM "Agent";

UPDATE "Agent"
SET
  "familyId" = "id",
  "versionNumber" = 1,
  "slug" = CASE
    WHEN "slug" ~ '-v[0-9]+$' THEN "slug"
    ELSE "slug" || '-v1'
  END,
  "legacyActivation" = ("status" = 'active');

ALTER TABLE "Agent"
  ALTER COLUMN "familyId" SET NOT NULL,
  ALTER COLUMN "versionNumber" SET NOT NULL;

UPDATE "AgentFamily" AS family
SET "championAgentId" = agent."id"
FROM "Agent" AS agent
WHERE agent."familyId" = family."id" AND agent."status" = 'active';

ALTER TABLE "AgentSpec"
  ADD COLUMN "derivationMode" "AgentDerivationMode" NOT NULL DEFAULT 'new',
  ADD COLUMN "interpretationId" UUID,
  ADD COLUMN "unconfirmedPrefill" JSONB;

-- @updatedAt is application-managed by Prisma; remove legacy database defaults so
-- the deployed schema exactly matches the datamodel.
ALTER TABLE "Agent" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "AgentFamily" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "AgentSpec" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "EvaluationTest" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "GenerationJob" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Guardrail" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "KnowledgeSource" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE "CertificationGateConfig" (
  "id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "state" "CertificationGateConfigState" NOT NULL DEFAULT 'active',
  "promotionFreshnessHours" INTEGER NOT NULL DEFAULT 24,
  "gates" JSONB NOT NULL,
  "compatibleExecutorKinds" "ExecutorKind"[] NOT NULL DEFAULT ARRAY['manifest_fixture']::"ExecutorKind"[],
  "publishedBy" VARCHAR(200) NOT NULL,
  "rationale" TEXT NOT NULL,
  "activatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CertificationGateConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvalCase" (
  "id" UUID NOT NULL,
  "key" VARCHAR(160) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "input" JSONB NOT NULL,
  "expectedOutput" JSONB NOT NULL,
  "expectedCitations" JSONB NOT NULL DEFAULT '[]',
  "tags" "EvalCaseTag"[] NOT NULL,
  "source" "EvalCaseSource" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "provenance" JSONB NOT NULL DEFAULT '{}',
  "createdBy" VARCHAR(200) NOT NULL,
  "updatedBy" VARCHAR(200) NOT NULL,
  "deactivatedAt" TIMESTAMPTZ(3),
  "deactivatedBy" VARCHAR(200),
  "deactivationRationale" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvalCase_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EvalCase" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE TABLE "EvalCorpusVersion" (
  "id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "contentHash" VARCHAR(128) NOT NULL,
  "publishedBy" VARCHAR(200) NOT NULL,
  "rationale" TEXT NOT NULL,
  "publishedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvalCorpusVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvalCorpusCase" (
  "corpusVersionId" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "caseSnapshot" JSONB NOT NULL,
  "caseHash" VARCHAR(128) NOT NULL,
  CONSTRAINT "EvalCorpusCase_pkey" PRIMARY KEY ("corpusVersionId", "caseId")
);

CREATE TABLE "CertificationRun" (
  "id" UUID NOT NULL,
  "agentVersionId" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "championVersionId" UUID,
  "kind" "CertificationRunKind" NOT NULL,
  "originStatus" "AgentStatus" NOT NULL,
  "state" "CertificationRunState" NOT NULL DEFAULT 'queued',
  "corpusVersionId" UUID NOT NULL,
  "corpusVersion" INTEGER NOT NULL,
  "gateConfigId" UUID NOT NULL,
  "gateConfigVersion" INTEGER NOT NULL,
  "corpusSnapshot" JSONB NOT NULL,
  "gateConfigSnapshot" JSONB NOT NULL,
  "subjectSnapshot" JSONB NOT NULL,
  "championSnapshot" JSONB,
  "subjectManifestSnapshot" JSONB NOT NULL,
  "championManifestSnapshot" JSONB,
  "subjectManifestHash" VARCHAR(128) NOT NULL,
  "championManifestHash" VARCHAR(128),
  "specRevision" INTEGER NOT NULL,
  "generatorVersion" VARCHAR(80) NOT NULL,
  "executorKind" "ExecutorKind" NOT NULL DEFAULT 'manifest_fixture',
  "executorVersion" VARCHAR(80) NOT NULL,
  "evaluationMode" "EvaluationMode" NOT NULL DEFAULT 'corpus_coverage',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "message" VARCHAR(500) NOT NULL DEFAULT 'Queued',
  "totalCaseCount" INTEGER NOT NULL DEFAULT 0,
  "passedCaseCount" INTEGER NOT NULL DEFAULT 0,
  "failedCaseCount" INTEGER NOT NULL DEFAULT 0,
  "verdict" "CertificationVerdict",
  "error" JSONB,
  "requestedBy" VARCHAR(200) NOT NULL,
  "startedBy" VARCHAR(200),
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "promotionExpiresAt" TIMESTAMPTZ(3),
  "nightlyScheduleKey" VARCHAR(160),
  "isPromotionEvidence" BOOLEAN NOT NULL DEFAULT false,
  "resultsAvailability" "CertificationResultsAvailability" NOT NULL DEFAULT 'full',
  "caseResultsPrunedAt" TIMESTAMPTZ(3),
  CONSTRAINT "CertificationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CertificationRun_progress_check" CHECK ("progress" BETWEEN 0 AND 100)
);

CREATE TABLE "CertificationGateResult" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "gate" "CertificationGateKey" NOT NULL,
  "operator" "CertificationGateOperator" NOT NULL,
  "threshold" DOUBLE PRECISION NOT NULL,
  "championScore" DOUBLE PRECISION,
  "challengerScore" DOUBLE PRECISION,
  "measuredValue" DOUBLE PRECISION,
  "status" "CertificationGateResultStatus" NOT NULL,
  "details" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CertificationGateResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvalCaseResult" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "caseId" UUID NOT NULL,
  "caseKey" VARCHAR(160) NOT NULL,
  "caseName" VARCHAR(200) NOT NULL,
  "tags" "EvalCaseTag"[] NOT NULL,
  "input" JSONB NOT NULL,
  "expectedOutput" JSONB NOT NULL,
  "expectedCitations" JSONB NOT NULL DEFAULT '[]',
  "championOutput" JSONB,
  "challengerOutput" JSONB NOT NULL,
  "championCitations" JSONB NOT NULL DEFAULT '[]',
  "challengerCitations" JSONB NOT NULL DEFAULT '[]',
  "championActions" JSONB NOT NULL DEFAULT '[]',
  "challengerActions" JSONB NOT NULL DEFAULT '[]',
  "scoreBreakdown" JSONB NOT NULL,
  "diff" JSONB NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvalCaseResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PromotionDecision" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "agentVersionId" UUID NOT NULL,
  "priorChampionVersionId" UUID,
  "decision" "PromotionDecisionType" NOT NULL,
  "decidedBy" VARCHAR(200) NOT NULL,
  "rationale" TEXT NOT NULL,
  "auditEventId" UUID NOT NULL,
  "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PromotionDecision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SpecInterpretation" (
  "id" UUID NOT NULL,
  "parentInterpretationId" UUID,
  "prompt" TEXT NOT NULL,
  "promptHash" VARCHAR(128) NOT NULL,
  "result" JSONB NOT NULL,
  "createdBy" VARCHAR(200) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpecInterpretation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SpecSectionConfirmation" (
  "id" UUID NOT NULL,
  "specId" UUID NOT NULL,
  "interpretationId" UUID,
  "section" "SpecSection" NOT NULL,
  "specRevision" INTEGER NOT NULL,
  "kind" "SectionConfirmationKind" NOT NULL,
  "sourceSpecId" UUID,
  "sourceSpecRevision" INTEGER,
  "resolutions" JSONB NOT NULL DEFAULT '[]',
  "actorId" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SpecSectionConfirmation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgentFamily_slug_key" ON "AgentFamily"("slug");
CREATE UNIQUE INDEX "AgentFamily_championAgentId_key" ON "AgentFamily"("championAgentId");
CREATE INDEX "AgentFamily_department_idx" ON "AgentFamily"("department");
CREATE UNIQUE INDEX "Agent_activationDecisionId_key" ON "Agent"("activationDecisionId");
CREATE UNIQUE INDEX "Agent_familyId_versionNumber_key" ON "Agent"("familyId", "versionNumber");
CREATE INDEX "Agent_familyId_status_idx" ON "Agent"("familyId", "status");
CREATE INDEX "Agent_predecessorAgentId_idx" ON "Agent"("predecessorAgentId");
CREATE UNIQUE INDEX "Agent_one_active_per_family" ON "Agent"("familyId") WHERE "status" = 'active';
CREATE UNIQUE INDEX "AgentSpec_interpretationId_key" ON "AgentSpec"("interpretationId");
CREATE INDEX "AgentSpec_derivationMode_idx" ON "AgentSpec"("derivationMode");

CREATE UNIQUE INDEX "CertificationGateConfig_version_key" ON "CertificationGateConfig"("version");
CREATE INDEX "CertificationGateConfig_state_version_idx" ON "CertificationGateConfig"("state", "version");
CREATE UNIQUE INDEX "CertificationGateConfig_one_active" ON "CertificationGateConfig"((1)) WHERE "state" = 'active';

CREATE UNIQUE INDEX "EvalCase_key_key" ON "EvalCase"("key");
CREATE INDEX "EvalCase_active_source_idx" ON "EvalCase"("active", "source");
CREATE INDEX "EvalCase_tags_idx" ON "EvalCase" USING GIN ("tags");
CREATE UNIQUE INDEX "EvalCorpusVersion_version_key" ON "EvalCorpusVersion"("version");
CREATE UNIQUE INDEX "EvalCorpusVersion_contentHash_key" ON "EvalCorpusVersion"("contentHash");
CREATE UNIQUE INDEX "EvalCorpusCase_corpusVersionId_ordinal_key" ON "EvalCorpusCase"("corpusVersionId", "ordinal");
CREATE INDEX "EvalCorpusCase_caseId_idx" ON "EvalCorpusCase"("caseId");

CREATE UNIQUE INDEX "CertificationRun_nightlyScheduleKey_key" ON "CertificationRun"("nightlyScheduleKey");
CREATE UNIQUE INDEX "CertificationRun_one_active_per_version" ON "CertificationRun"("agentVersionId")
  WHERE "state" IN ('queued', 'running');
CREATE INDEX "CertificationRun_agentVersionId_requestedAt_idx" ON "CertificationRun"("agentVersionId", "requestedAt");
CREATE INDEX "CertificationRun_familyId_requestedAt_idx" ON "CertificationRun"("familyId", "requestedAt");
CREATE INDEX "CertificationRun_state_requestedAt_idx" ON "CertificationRun"("state", "requestedAt");
CREATE INDEX "CertificationRun_corpusVersionId_idx" ON "CertificationRun"("corpusVersionId");
CREATE INDEX "CertificationRun_gateConfigId_idx" ON "CertificationRun"("gateConfigId");
CREATE UNIQUE INDEX "CertificationGateResult_runId_gate_key" ON "CertificationGateResult"("runId", "gate");
CREATE INDEX "CertificationGateResult_runId_status_idx" ON "CertificationGateResult"("runId", "status");
CREATE UNIQUE INDEX "EvalCaseResult_runId_caseId_key" ON "EvalCaseResult"("runId", "caseId");
CREATE INDEX "EvalCaseResult_runId_passed_caseKey_idx" ON "EvalCaseResult"("runId", "passed", "caseKey");
CREATE INDEX "EvalCaseResult_caseId_idx" ON "EvalCaseResult"("caseId");

CREATE UNIQUE INDEX "PromotionDecision_runId_key" ON "PromotionDecision"("runId");
CREATE UNIQUE INDEX "PromotionDecision_auditEventId_key" ON "PromotionDecision"("auditEventId");
CREATE INDEX "PromotionDecision_familyId_decidedAt_idx" ON "PromotionDecision"("familyId", "decidedAt");
CREATE INDEX "PromotionDecision_agentVersionId_idx" ON "PromotionDecision"("agentVersionId");
CREATE INDEX "SpecInterpretation_parentInterpretationId_idx" ON "SpecInterpretation"("parentInterpretationId");
CREATE INDEX "SpecInterpretation_expiresAt_idx" ON "SpecInterpretation"("expiresAt");
CREATE INDEX "SpecInterpretation_promptHash_idx" ON "SpecInterpretation"("promptHash");
CREATE UNIQUE INDEX "SpecSectionConfirmation_specId_section_specRevision_key"
  ON "SpecSectionConfirmation"("specId", "section", "specRevision");
CREATE INDEX "SpecSectionConfirmation_interpretationId_idx" ON "SpecSectionConfirmation"("interpretationId");
CREATE INDEX "SpecSectionConfirmation_sourceSpecId_idx" ON "SpecSectionConfirmation"("sourceSpecId");

ALTER TABLE "AgentFamily" ADD CONSTRAINT "AgentFamily_championAgentId_fkey"
  FOREIGN KEY ("championAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "AgentFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_predecessorAgentId_fkey"
  FOREIGN KEY ("predecessorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_successorAgentId_fkey"
  FOREIGN KEY ("successorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentSpec" ADD CONSTRAINT "AgentSpec_interpretationId_fkey"
  FOREIGN KEY ("interpretationId") REFERENCES "SpecInterpretation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvalCorpusCase" ADD CONSTRAINT "EvalCorpusCase_corpusVersionId_fkey"
  FOREIGN KEY ("corpusVersionId") REFERENCES "EvalCorpusVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvalCorpusCase" ADD CONSTRAINT "EvalCorpusCase_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "EvalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_agentVersionId_fkey"
  FOREIGN KEY ("agentVersionId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "AgentFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_championVersionId_fkey"
  FOREIGN KEY ("championVersionId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_corpusVersionId_fkey"
  FOREIGN KEY ("corpusVersionId") REFERENCES "EvalCorpusVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_gateConfigId_fkey"
  FOREIGN KEY ("gateConfigId") REFERENCES "CertificationGateConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CertificationGateResult" ADD CONSTRAINT "CertificationGateResult_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "CertificationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvalCaseResult" ADD CONSTRAINT "EvalCaseResult_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "CertificationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvalCaseResult" ADD CONSTRAINT "EvalCaseResult_caseId_fkey"
  FOREIGN KEY ("caseId") REFERENCES "EvalCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PromotionDecision" ADD CONSTRAINT "PromotionDecision_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "CertificationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionDecision" ADD CONSTRAINT "PromotionDecision_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "AgentFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionDecision" ADD CONSTRAINT "PromotionDecision_agentVersionId_fkey"
  FOREIGN KEY ("agentVersionId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionDecision" ADD CONSTRAINT "PromotionDecision_priorChampionVersionId_fkey"
  FOREIGN KEY ("priorChampionVersionId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromotionDecision" ADD CONSTRAINT "PromotionDecision_auditEventId_fkey"
  FOREIGN KEY ("auditEventId") REFERENCES "AuditEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_activationDecisionId_fkey"
  FOREIGN KEY ("activationDecisionId") REFERENCES "PromotionDecision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SpecInterpretation" ADD CONSTRAINT "SpecInterpretation_parentInterpretationId_fkey"
  FOREIGN KEY ("parentInterpretationId") REFERENCES "SpecInterpretation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpecSectionConfirmation" ADD CONSTRAINT "SpecSectionConfirmation_specId_fkey"
  FOREIGN KEY ("specId") REFERENCES "AgentSpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpecSectionConfirmation" ADD CONSTRAINT "SpecSectionConfirmation_interpretationId_fkey"
  FOREIGN KEY ("interpretationId") REFERENCES "SpecInterpretation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpecSectionConfirmation" ADD CONSTRAINT "SpecSectionConfirmation_sourceSpecId_fkey"
  FOREIGN KEY ("sourceSpecId") REFERENCES "AgentSpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Agent" ADD CONSTRAINT "Agent_versionNumber_check" CHECK ("versionNumber" > 0);
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_active_evidence_shape_check" CHECK (
  "status" <> 'active' OR "legacyActivation" OR "activationDecisionId" IS NOT NULL
);
ALTER TABLE "CertificationGateConfig" ADD CONSTRAINT "CertificationGateConfig_freshness_check"
  CHECK ("promotionFreshnessHours" > 0);
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_evidence_availability_check" CHECK (
  NOT "isPromotionEvidence" OR "resultsAvailability" = 'promotion_evidence'
);
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_summary_pruned_check" CHECK (
  "resultsAvailability" <> 'summary_only' OR "caseResultsPrunedAt" IS NOT NULL
);
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_case_counts_check" CHECK (
  "totalCaseCount" >= 0
  AND "passedCaseCount" >= 0
  AND "failedCaseCount" >= 0
  AND "passedCaseCount" + "failedCaseCount" = "totalCaseCount"
);
ALTER TABLE "SpecSectionConfirmation" ADD CONSTRAINT "SpecSectionConfirmation_lineage_check" CHECK (
  ("kind" <> 'interpreted' OR "interpretationId" IS NOT NULL)
  AND
  ("kind" <> 'inherited' OR ("sourceSpecId" IS NOT NULL AND "sourceSpecRevision" IS NOT NULL))
);

CREATE FUNCTION "reject_governance_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "PromotionDecision_append_only"
  BEFORE UPDATE OR DELETE ON "PromotionDecision"
  FOR EACH ROW EXECUTE FUNCTION "reject_governance_mutation"();
CREATE TRIGGER "EvalCorpusVersion_append_only"
  BEFORE UPDATE OR DELETE ON "EvalCorpusVersion"
  FOR EACH ROW EXECUTE FUNCTION "reject_governance_mutation"();
CREATE TRIGGER "EvalCorpusCase_append_only"
  BEFORE UPDATE OR DELETE ON "EvalCorpusCase"
  FOR EACH ROW EXECUTE FUNCTION "reject_governance_mutation"();
CREATE TRIGGER "SpecSectionConfirmation_append_only"
  BEFORE UPDATE OR DELETE ON "SpecSectionConfirmation"
  FOR EACH ROW EXECUTE FUNCTION "reject_governance_mutation"();

CREATE FUNCTION "protect_attached_interpretation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AgentSpec" WHERE "interpretationId" = OLD."id")
     OR EXISTS (
       SELECT 1
       FROM "SpecSectionConfirmation"
       WHERE "interpretationId" = OLD."id"
     )
  THEN
    RAISE EXCEPTION 'Lineage-linked SpecInterpretation is immutable';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "SpecInterpretation_attached_immutable"
  BEFORE UPDATE OR DELETE ON "SpecInterpretation"
  FOR EACH ROW EXECUTE FUNCTION "protect_attached_interpretation"();

CREATE FUNCTION "protect_gate_config"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'CertificationGateConfig is immutable';
  END IF;

  IF OLD."state" = 'active'
     AND NEW."state" = 'superseded'
     AND NEW."supersededAt" IS NOT NULL
     AND NEW."id" = OLD."id"
     AND NEW."version" = OLD."version"
     AND NEW."promotionFreshnessHours" = OLD."promotionFreshnessHours"
     AND NEW."gates" = OLD."gates"
     AND NEW."compatibleExecutorKinds" = OLD."compatibleExecutorKinds"
     AND NEW."publishedBy" = OLD."publishedBy"
     AND NEW."rationale" = OLD."rationale"
     AND NEW."activatedAt" = OLD."activatedAt"
     AND NEW."createdAt" = OLD."createdAt"
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'CertificationGateConfig is immutable except for active-to-superseded publication';
END;
$$;

CREATE TRIGGER "CertificationGateConfig_immutable"
  BEFORE UPDATE OR DELETE ON "CertificationGateConfig"
  FOR EACH ROW EXECUTE FUNCTION "protect_gate_config"();

CREATE FUNCTION "protect_promotion_evidence_run"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."isPromotionEvidence" THEN
    RAISE EXCEPTION 'Promotion-evidence CertificationRun is append-only';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF OLD."isPromotionEvidence" AND NOT NEW."isPromotionEvidence" THEN
    RAISE EXCEPTION 'CertificationRun promotion evidence cannot be removed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CertificationRun_evidence_append_only"
  BEFORE UPDATE OR DELETE ON "CertificationRun"
  FOR EACH ROW EXECUTE FUNCTION "protect_promotion_evidence_run"();

CREATE FUNCTION "protect_promotion_evidence_child"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_run_id UUID;
BEGIN
  target_run_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."runId" ELSE NEW."runId" END;
  IF EXISTS (
    SELECT 1 FROM "CertificationRun"
    WHERE "id" = target_run_id AND "isPromotionEvidence" = true
  ) THEN
    RAISE EXCEPTION 'Promotion evidence is append-only';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "CertificationGateResult_evidence_append_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "CertificationGateResult"
  FOR EACH ROW EXECUTE FUNCTION "protect_promotion_evidence_child"();
CREATE TRIGGER "EvalCaseResult_evidence_append_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "EvalCaseResult"
  FOR EACH ROW EXECUTE FUNCTION "protect_promotion_evidence_child"();

CREATE FUNCTION "validate_promotion_decision_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."decision" = 'promoted' AND NOT EXISTS (
    SELECT 1
    FROM "CertificationRun"
    WHERE "id" = NEW."runId"
      AND "agentVersionId" = NEW."agentVersionId"
      AND "familyId" = NEW."familyId"
      AND "state" = 'passed'
      AND "verdict" = 'passed'
      AND "isPromotionEvidence" = true
      AND "resultsAvailability" = 'promotion_evidence'
      AND "promotionExpiresAt" IS NOT NULL
      AND NEW."decidedAt" <= "promotionExpiresAt"
  ) THEN
    RAISE EXCEPTION 'Promoted decision requires fresh passing certification evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "PromotionDecision_evidence_invariant"
  AFTER INSERT ON "PromotionDecision"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_promotion_decision_evidence"();

CREATE FUNCTION "validate_family_champion"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."championAgentId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "Agent"
    WHERE "id" = NEW."championAgentId"
      AND "familyId" = NEW."id"
      AND "status" = 'active'
  ) THEN
    RAISE EXCEPTION 'Champion must be the active version in its family';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "AgentFamily_champion_invariant"
  AFTER INSERT OR UPDATE OF "championAgentId" ON "AgentFamily"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_family_champion"();

CREATE FUNCTION "validate_champion_agent_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'active' AND NOT EXISTS (
    SELECT 1 FROM "AgentFamily"
    WHERE "id" = NEW."familyId"
      AND "championAgentId" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'Active version must be its family champion';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "AgentFamily"
    WHERE "championAgentId" = NEW."id"
      AND ("id" <> NEW."familyId" OR NEW."status" <> 'active')
  ) THEN
    RAISE EXCEPTION 'Family champion pointer must reference its active version';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "Agent_champion_invariant"
  AFTER INSERT OR UPDATE OF "familyId", "status" ON "Agent"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_champion_agent_change"();

CREATE FUNCTION "validate_active_agent_evidence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."status" = 'active'
     AND NEW."status" = 'active'
     AND (
       NEW."manifest" IS DISTINCT FROM OLD."manifest"
       OR NEW."manifestHash" IS DISTINCT FROM OLD."manifestHash"
     )
  THEN
    RAISE EXCEPTION 'Active agent manifests are immutable; certify and promote a successor';
  END IF;
  IF NEW."status" = 'active' AND NOT NEW."legacyActivation" AND NOT EXISTS (
    SELECT 1
    FROM "PromotionDecision" decision
    JOIN "CertificationRun" run ON run."id" = decision."runId"
    WHERE decision."id" = NEW."activationDecisionId"
      AND decision."agentVersionId" = NEW."id"
      AND decision."familyId" = NEW."familyId"
      AND decision."decision" = 'promoted'
      AND run."agentVersionId" = NEW."id"
      AND run."familyId" = NEW."familyId"
      AND run."kind" = 'challenger'
      AND run."state" = 'passed'
      AND run."verdict" = 'passed'
      AND run."isPromotionEvidence" = true
      AND run."resultsAvailability" = 'promotion_evidence'
      AND run."subjectManifestHash" = NEW."manifestHash"
  ) THEN
    RAISE EXCEPTION 'Active agent requires matching promotion evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "Agent_activation_evidence_invariant"
  AFTER INSERT OR UPDATE OF "status", "activationDecisionId", "legacyActivation", "manifest", "manifestHash" ON "Agent"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "validate_active_agent_evidence"();

-- `legacyActivation` exists solely to grandfather versions that were active
-- before certification evidence was introduced. It must never become an
-- application-controlled path around promotion.
CREATE FUNCTION "protect_legacy_activation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW."legacyActivation" THEN
    RAISE EXCEPTION 'Agent legacyActivation cannot be set on new versions';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NOT OLD."legacyActivation" AND NEW."legacyActivation" THEN
      RAISE EXCEPTION 'Agent legacyActivation is migration-only and cannot be enabled';
    END IF;
    IF OLD."legacyActivation" AND NOT NEW."legacyActivation" AND NEW."status" <> 'retired' THEN
      RAISE EXCEPTION 'Legacy activation may only be cleared during retirement';
    END IF;
    IF OLD."legacyActivation" AND NEW."legacyActivation" AND OLD."status" = 'active' AND NEW."status" <> 'active' THEN
      RAISE EXCEPTION 'Retiring a legacy champion must clear legacyActivation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Agent_legacy_activation_immutable"
  BEFORE INSERT OR UPDATE ON "Agent"
  FOR EACH ROW EXECUTE FUNCTION "protect_legacy_activation"();
