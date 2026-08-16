CREATE TYPE "ReleaseEvaluationVerdict" AS ENUM ('passed', 'failed', 'error');
CREATE TYPE "ReleasePromotionAction" AS ENUM ('promoted', 'rolled_back');

ALTER TABLE "ExecutionRun" ADD COLUMN "developmentDraft" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ReleaseEvaluation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "releaseId" UUID NOT NULL,
  "releaseDigest" VARCHAR(64) NOT NULL,
  "suiteVersionId" UUID NOT NULL,
  "suiteDigest" VARCHAR(64) NOT NULL,
  "executorKind" VARCHAR(100) NOT NULL,
  "executorVersion" VARCHAR(80) NOT NULL,
  "evaluationMode" VARCHAR(100) NOT NULL,
  "corpusVersion" INTEGER NOT NULL,
  "verdict" "ReleaseEvaluationVerdict" NOT NULL,
  "results" JSONB NOT NULL,
  "gateScores" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "requestedBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ReleaseEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReleaseEvaluation_releaseId_suiteVersionId_suiteDigest_key"
  ON "ReleaseEvaluation"("releaseId", "suiteVersionId", "suiteDigest");
CREATE INDEX "ReleaseEvaluation_releaseId_verdict_finishedAt_idx"
  ON "ReleaseEvaluation"("releaseId", "verdict", "finishedAt");
CREATE INDEX "ReleaseEvaluation_suiteVersionId_finishedAt_idx"
  ON "ReleaseEvaluation"("suiteVersionId", "finishedAt");

CREATE TABLE "ProductionChannel" (
  "key" VARCHAR(160) NOT NULL,
  "projectId" VARCHAR(160),
  "currentReleaseId" UUID,
  "priorReleaseId" UUID,
  "promotedBy" VARCHAR(200),
  "promotedAt" TIMESTAMPTZ(3),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProductionChannel_pkey" PRIMARY KEY ("key")
);
CREATE UNIQUE INDEX "ProductionChannel_projectId_key" ON "ProductionChannel"("projectId");

CREATE TABLE "ReleasePromotionDecision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "channelKey" VARCHAR(160) NOT NULL,
  "action" "ReleasePromotionAction" NOT NULL,
  "releaseId" UUID NOT NULL,
  "previousReleaseId" UUID,
  "evaluationId" UUID NOT NULL,
  "rationale" TEXT NOT NULL,
  "decidedBy" VARCHAR(200) NOT NULL,
  "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleasePromotionDecision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReleasePromotionDecision_channelKey_decidedAt_idx"
  ON "ReleasePromotionDecision"("channelKey", "decidedAt");
CREATE INDEX "ReleasePromotionDecision_releaseId_decidedAt_idx"
  ON "ReleasePromotionDecision"("releaseId", "decidedAt");

ALTER TABLE "ReleaseEvaluation" ADD CONSTRAINT "ReleaseEvaluation_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleaseEvaluation" ADD CONSTRAINT "ReleaseEvaluation_suiteVersionId_fkey"
  FOREIGN KEY ("suiteVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionChannel" ADD CONSTRAINT "ProductionChannel_currentReleaseId_fkey"
  FOREIGN KEY ("currentReleaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductionChannel" ADD CONSTRAINT "ProductionChannel_priorReleaseId_fkey"
  FOREIGN KEY ("priorReleaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleasePromotionDecision" ADD CONSTRAINT "ReleasePromotionDecision_channelKey_fkey"
  FOREIGN KEY ("channelKey") REFERENCES "ProductionChannel"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleasePromotionDecision" ADD CONSTRAINT "ReleasePromotionDecision_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleasePromotionDecision" ADD CONSTRAINT "ReleasePromotionDecision_previousReleaseId_fkey"
  FOREIGN KEY ("previousReleaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleasePromotionDecision" ADD CONSTRAINT "ReleasePromotionDecision_evaluationId_fkey"
  FOREIGN KEY ("evaluationId") REFERENCES "ReleaseEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "ReleaseEvaluation_append_only"
  BEFORE UPDATE OR DELETE ON "ReleaseEvaluation"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();
CREATE TRIGGER "ReleasePromotionDecision_append_only"
  BEFORE UPDATE OR DELETE ON "ReleasePromotionDecision"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();

CREATE OR REPLACE FUNCTION "protect_frozen_resource_version"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  certification_evidence TEXT;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."lifecycle" IN ('certified', 'production') THEN
    RAISE EXCEPTION 'Certified and production lifecycle are assigned only by governed platform services';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."lifecycle" <> 'experimental' AND NEW."frozenAt" IS NULL THEN
    RAISE EXCEPTION 'Frozen resource versions must record frozenAt';
  END IF;
  IF TG_OP = 'DELETE' AND OLD."lifecycle" <> 'experimental' THEN
    RAISE EXCEPTION 'Frozen resource versions cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."lifecycle" <> 'experimental' AND (
    NEW."definition" IS DISTINCT FROM OLD."definition"
    OR NEW."digest" IS DISTINCT FROM OLD."digest"
    OR NEW."familyId" IS DISTINCT FROM OLD."familyId"
    OR NEW."legacyAgentId" IS DISTINCT FROM OLD."legacyAgentId"
    OR NEW."version" IS DISTINCT FROM OLD."version"
    OR NEW."dependencyPins" IS DISTINCT FROM OLD."dependencyPins"
    OR NEW."sourceCommit" IS DISTINCT FROM OLD."sourceCommit"
    OR NEW."owner" IS DISTINCT FROM OLD."owner"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."provenance" IS DISTINCT FROM OLD."provenance"
    OR NEW."revision" IS DISTINCT FROM OLD."revision"
    OR NEW."frozenAt" IS DISTINCT FROM OLD."frozenAt"
  ) THEN
    RAISE EXCEPTION 'Frozen resource definition is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."lifecycle" <> 'experimental'
     AND NEW."lifecycle" < OLD."lifecycle" THEN
    RAISE EXCEPTION 'Frozen resource lifecycle cannot move backwards';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."lifecycle" = 'experimental' AND NEW."lifecycle" <> 'experimental'
     AND NEW."frozenAt" IS NULL THEN
    RAISE EXCEPTION 'Candidate resources must record frozenAt';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."lifecycle" = 'production' AND OLD."lifecycle" <> 'production' THEN
    RAISE EXCEPTION 'Production authority is represented by a production channel pointer';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."lifecycle" = 'certified' AND OLD."lifecycle" <> 'certified' THEN
    certification_evidence := current_setting('paul_os.certification_evidence_id', true);
    IF certification_evidence IS NULL OR NOT EXISTS (
      SELECT 1
      FROM "ReleaseEvaluation" evaluation
      JOIN "ReleaseResource" member ON member."releaseId" = evaluation."releaseId"
      WHERE evaluation."id" = certification_evidence::uuid
        AND evaluation."verdict" = 'passed'
        AND member."resourceVersionId" = OLD."id"
    ) THEN
      RAISE EXCEPTION 'Certification requires immutable passing release evidence';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "protect_production_channel"()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  decision_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Production channels cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."currentReleaseId" IS NOT NULL THEN
    RAISE EXCEPTION 'A production channel must be activated by an immutable decision';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."currentReleaseId" IS DISTINCT FROM OLD."currentReleaseId" THEN
    decision_id := current_setting('paul_os.production_decision_id', true);
    IF decision_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM "ReleasePromotionDecision" decision
      WHERE decision."id" = decision_id::uuid
        AND decision."channelKey" = NEW."key"
        AND decision."releaseId" = NEW."currentReleaseId"
        AND decision."previousReleaseId" IS NOT DISTINCT FROM OLD."currentReleaseId"
    ) THEN
      RAISE EXCEPTION 'Production pointer changes require an immutable promotion decision';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ProductionChannel_governed_pointer"
  BEFORE INSERT OR UPDATE OR DELETE ON "ProductionChannel"
  FOR EACH ROW EXECUTE FUNCTION "protect_production_channel"();
