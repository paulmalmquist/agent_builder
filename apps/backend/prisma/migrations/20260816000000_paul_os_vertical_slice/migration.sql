-- Paul OS resource registry and the first approval-gated execution vertical slice.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TYPE "SourceProvider" RENAME VALUE 'interstellar' TO 'telemetry';

CREATE TYPE "ResourceKind" AS ENUM (
  'CorePolicy', 'ContextPolicy', 'Skill', 'Project', 'Automation', 'Reference',
  'BusinessDomain', 'Protocol', 'KnowledgeSource', 'EvaluationSuite',
  'MetricDefinition', 'ImprovementCandidate', 'Agent'
);
CREATE TYPE "ResourceLifecycle" AS ENUM (
  'experimental', 'candidate', 'evaluating', 'evaluated', 'certified', 'production', 'deprecated'
);
CREATE TYPE "AuthorityGrantState" AS ENUM ('active', 'revoked', 'exhausted', 'expired');
CREATE TYPE "ExecutionRunState" AS ENUM (
  'awaiting_approval', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused_budget'
);
CREATE TYPE "ModelProviderKind" AS ENUM ('deterministic', 'anthropic', 'gateway');
CREATE TYPE "ApprovalRequestState" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

CREATE TABLE "ResourceFamily" (
  "id" UUID NOT NULL,
  "kind" "ResourceKind" NOT NULL,
  "slug" VARCHAR(160) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "createdBy" VARCHAR(200) NOT NULL,
  "updatedBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ResourceFamily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ResourceFamily_kind_slug_key" ON "ResourceFamily"("kind", "slug");
CREATE INDEX "ResourceFamily_kind_name_idx" ON "ResourceFamily"("kind", "name");

CREATE TABLE "ResourceVersion" (
  "id" UUID NOT NULL,
  "familyId" UUID NOT NULL,
  "legacyAgentId" UUID,
  "version" VARCHAR(80) NOT NULL,
  "lifecycle" "ResourceLifecycle" NOT NULL,
  "owner" VARCHAR(200) NOT NULL,
  "purpose" TEXT NOT NULL,
  "definition" JSONB NOT NULL,
  "digest" VARCHAR(64) NOT NULL,
  "sourceCommit" VARCHAR(160) NOT NULL,
  "provenance" JSONB NOT NULL DEFAULT '{}',
  "dependencyPins" JSONB NOT NULL DEFAULT '[]',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "frozenAt" TIMESTAMPTZ(3),
  "createdBy" VARCHAR(200) NOT NULL,
  "updatedBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ResourceVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResourceVersion_freeze_check" CHECK (
    ("lifecycle" = 'experimental' AND "frozenAt" IS NULL)
    OR ("lifecycle" <> 'experimental' AND "frozenAt" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "ResourceVersion_legacyAgentId_key" ON "ResourceVersion"("legacyAgentId");
CREATE UNIQUE INDEX "ResourceVersion_digest_key" ON "ResourceVersion"("digest");
CREATE UNIQUE INDEX "ResourceVersion_familyId_version_key" ON "ResourceVersion"("familyId", "version");
CREATE INDEX "ResourceVersion_familyId_lifecycle_idx" ON "ResourceVersion"("familyId", "lifecycle");

CREATE TABLE "RepositoryImport" (
  "id" UUID NOT NULL,
  "resourceVersionId" UUID NOT NULL,
  "digest" VARCHAR(64) NOT NULL,
  "sourceCommit" VARCHAR(160) NOT NULL,
  "sourcePath" VARCHAR(500),
  "manifestSnapshot" JSONB NOT NULL,
  "importedBy" VARCHAR(200) NOT NULL,
  "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RepositoryImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RepositoryImport_resourceVersionId_digest_key" ON "RepositoryImport"("resourceVersionId", "digest");
CREATE INDEX "RepositoryImport_sourceCommit_importedAt_idx" ON "RepositoryImport"("sourceCommit", "importedAt");

CREATE TABLE "ReleaseBundle" (
  "id" UUID NOT NULL,
  "digest" VARCHAR(64) NOT NULL,
  "projectId" VARCHAR(160),
  "createdBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReleaseBundle_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReleaseBundle_digest_key" ON "ReleaseBundle"("digest");

CREATE TABLE "ReleaseResource" (
  "releaseId" UUID NOT NULL,
  "resourceVersionId" UUID NOT NULL,
  "kind" "ResourceKind" NOT NULL,
  "digest" VARCHAR(64) NOT NULL,
  "ordinal" INTEGER NOT NULL,
  CONSTRAINT "ReleaseResource_pkey" PRIMARY KEY ("releaseId", "resourceVersionId")
);
CREATE UNIQUE INDEX "ReleaseResource_releaseId_ordinal_key" ON "ReleaseResource"("releaseId", "ordinal");
CREATE INDEX "ReleaseResource_resourceVersionId_idx" ON "ReleaseResource"("resourceVersionId");

CREATE TABLE "AuthorityGrant" (
  "id" UUID NOT NULL,
  "releaseId" UUID NOT NULL,
  "releaseDigest" VARCHAR(64) NOT NULL,
  "projectId" VARCHAR(160),
  "inputConstraints" JSONB NOT NULL DEFAULT '{}',
  "toolScopes" JSONB NOT NULL DEFAULT '[]',
  "validFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMPTZ(3) NOT NULL,
  "maxRuns" INTEGER NOT NULL,
  "usedRuns" INTEGER NOT NULL DEFAULT 0,
  "maxEstimatedCostPerRunUsd" DECIMAL(18,8) NOT NULL,
  "totalCostBudgetUsd" DECIMAL(18,8) NOT NULL,
  "spentCostUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "reservedCostUsd" DECIMAL(18,8) NOT NULL DEFAULT 0,
  "state" "AuthorityGrantState" NOT NULL DEFAULT 'active',
  "actorId" VARCHAR(200) NOT NULL,
  "rationale" TEXT NOT NULL,
  "revokedAt" TIMESTAMPTZ(3),
  "revokedBy" VARCHAR(200),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AuthorityGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthorityGrant_limits_check" CHECK (
    "maxRuns" > 0 AND "usedRuns" >= 0 AND "usedRuns" <= "maxRuns"
    AND "maxEstimatedCostPerRunUsd" >= 0 AND "totalCostBudgetUsd" >= 0
    AND "spentCostUsd" >= 0 AND "reservedCostUsd" >= 0
  )
);
CREATE INDEX "AuthorityGrant_releaseId_state_validUntil_idx" ON "AuthorityGrant"("releaseId", "state", "validUntil");
CREATE INDEX "AuthorityGrant_actorId_createdAt_idx" ON "AuthorityGrant"("actorId", "createdAt");

CREATE TABLE "ExecutionRun" (
  "id" UUID NOT NULL,
  "releaseId" UUID NOT NULL,
  "authorityGrantId" UUID,
  "releaseDigest" VARCHAR(64) NOT NULL,
  "projectId" VARCHAR(160),
  "requiredToolScopes" JSONB NOT NULL DEFAULT '[]',
  "state" "ExecutionRunState" NOT NULL DEFAULT 'awaiting_approval',
  "input" JSONB NOT NULL,
  "providerKind" "ModelProviderKind" NOT NULL,
  "providerVersion" VARCHAR(80) NOT NULL,
  "model" VARCHAR(160) NOT NULL,
  "maxInputTokens" INTEGER NOT NULL,
  "maxOutputTokens" INTEGER NOT NULL,
  "maxEstimatedCostUsd" DECIMAL(18,8) NOT NULL,
  "estimatedUpperCostUsd" DECIMAL(18,8) NOT NULL,
  "actualCostUsd" DECIMAL(18,8),
  "pricingVersion" VARCHAR(80) NOT NULL,
  "approvalReasons" JSONB NOT NULL DEFAULT '[]',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "message" VARCHAR(500) NOT NULL DEFAULT 'Awaiting approval',
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "requestedBy" VARCHAR(200) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "leaseOwner" VARCHAR(200),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "heartbeatAt" TIMESTAMPTZ(3),
  "cancelRequestedAt" TIMESTAMPTZ(3),
  "error" JSONB,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ExecutionRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExecutionRun_budget_check" CHECK (
    "maxInputTokens" > 0 AND "maxOutputTokens" > 0
    AND "maxEstimatedCostUsd" >= 0 AND "estimatedUpperCostUsd" >= 0
    AND "progress" BETWEEN 0 AND 100 AND "attempts" >= 0 AND "maxAttempts" > 0
  )
);
CREATE UNIQUE INDEX "ExecutionRun_idempotencyKey_key" ON "ExecutionRun"("idempotencyKey");
CREATE INDEX "ExecutionRun_state_createdAt_idx" ON "ExecutionRun"("state", "createdAt");
CREATE INDEX "ExecutionRun_leaseExpiresAt_idx" ON "ExecutionRun"("leaseExpiresAt");
CREATE INDEX "ExecutionRun_authorityGrantId_createdAt_idx" ON "ExecutionRun"("authorityGrantId", "createdAt");

CREATE TABLE "ApprovalRequest" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "state" "ApprovalRequestState" NOT NULL DEFAULT 'pending',
  "reasons" JSONB NOT NULL DEFAULT '[]',
  "requestedBy" VARCHAR(200) NOT NULL,
  "decidedBy" VARCHAR(200),
  "rationale" TEXT,
  "decidedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ApprovalRequest_runId_key" ON "ApprovalRequest"("runId");
CREATE INDEX "ApprovalRequest_state_createdAt_idx" ON "ApprovalRequest"("state", "createdAt");

CREATE TABLE "RunStep" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "stepKey" VARCHAR(160) NOT NULL,
  "idempotencyKey" VARCHAR(240) NOT NULL,
  "state" VARCHAR(40) NOT NULL,
  "result" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RunStep_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RunStep_idempotencyKey_key" ON "RunStep"("idempotencyKey");
CREATE UNIQUE INDEX "RunStep_runId_stepKey_key" ON "RunStep"("runId", "stepKey");
CREATE INDEX "RunStep_runId_state_idx" ON "RunStep"("runId", "state");

CREATE TABLE "OutcomeRecord" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "output" JSONB NOT NULL,
  "confidence" DOUBLE PRECISION,
  "citations" JSONB NOT NULL DEFAULT '[]',
  "unresolvedItems" JSONB NOT NULL DEFAULT '[]',
  "qualityScore" DOUBLE PRECISION,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutcomeRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OutcomeRecord_runId_key" ON "OutcomeRecord"("runId");

CREATE TABLE "MetricSample" (
  "id" UUID NOT NULL,
  "runId" UUID,
  "name" VARCHAR(160) NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "unit" VARCHAR(40) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "observedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MetricSample_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MetricSample_runId_observedAt_idx" ON "MetricSample"("runId", "observedAt");
CREATE INDEX "MetricSample_name_observedAt_idx" ON "MetricSample"("name", "observedAt");

ALTER TABLE "CertificationRun" ADD COLUMN "subjectResourceVersionId" UUID;
ALTER TABLE "CertificationRun" ADD COLUMN "comparisonResourceVersionId" UUID;

-- Backfill the current Agent Builder catalog into the universal resource registry.
INSERT INTO "ResourceFamily" (
  "id", "kind", "slug", "name", "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT "id", 'Agent'::"ResourceKind", "slug", "name", "createdBy", "updatedBy", "createdAt", "updatedAt"
FROM "AgentFamily";

WITH definitions AS (
  SELECT
    agent.*,
    jsonb_build_object(
      'apiVersion', 'paul-os/v1',
      'kind', 'Agent',
      'metadata', jsonb_build_object(
        'id', agent."familyId",
        'slug', family."slug",
        'version', agent."versionNumber"::text || '.0.0',
        'name', agent."name",
        'owner', agent."owner",
        'purpose', agent."purpose",
        'lifecycle', CASE agent."status"::text
          WHEN 'draft' THEN 'experimental'
          WHEN 'certifying' THEN 'evaluating'
          WHEN 'certified' THEN 'certified'
          WHEN 'active' THEN 'production'
          WHEN 'retired' THEN 'deprecated'
          ELSE 'candidate'
        END,
        'provenance', 'agent-builder-backfill'
      ),
      'dependencies', '[]'::jsonb,
      'spec', jsonb_build_object('legacyAgentId', agent."id", 'manifest', agent."manifest")
    ) AS definition
  FROM "Agent" agent
  JOIN "AgentFamily" family ON family."id" = agent."familyId"
)
INSERT INTO "ResourceVersion" (
  "id", "familyId", "legacyAgentId", "version", "lifecycle", "owner", "purpose",
  "definition", "digest", "sourceCommit", "provenance", "dependencyPins", "revision",
  "frozenAt", "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT
  "id", "familyId", "id", "versionNumber"::text || '.0.0',
  (CASE "status"::text
    WHEN 'draft' THEN 'experimental'
    WHEN 'certifying' THEN 'evaluating'
    WHEN 'certified' THEN 'certified'
    WHEN 'active' THEN 'production'
    WHEN 'retired' THEN 'deprecated'
    ELSE 'candidate'
  END)::"ResourceLifecycle",
  "owner", "purpose", definition,
  encode(digest(definition::text, 'sha256'), 'hex'),
  '84cd1e5', jsonb_build_object('source', 'agent-builder-backfill'), '[]'::jsonb,
  1,
  CASE WHEN "status"::text = 'draft' THEN NULL ELSE "updatedAt" END,
  "createdBy", "updatedBy", "createdAt", "updatedAt"
FROM definitions;

UPDATE "CertificationRun"
SET "subjectResourceVersionId" = "agentVersionId",
    "comparisonResourceVersionId" = "championVersionId";

CREATE INDEX "CertificationRun_subjectResourceVersionId_requestedAt_idx"
  ON "CertificationRun"("subjectResourceVersionId", "requestedAt");
CREATE INDEX "CertificationRun_comparisonResourceVersionId_idx"
  ON "CertificationRun"("comparisonResourceVersionId");

ALTER TABLE "ResourceVersion" ADD CONSTRAINT "ResourceVersion_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "ResourceFamily"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceVersion" ADD CONSTRAINT "ResourceVersion_legacyAgentId_fkey"
  FOREIGN KEY ("legacyAgentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RepositoryImport" ADD CONSTRAINT "RepositoryImport_resourceVersionId_fkey"
  FOREIGN KEY ("resourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleaseResource" ADD CONSTRAINT "ReleaseResource_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReleaseResource" ADD CONSTRAINT "ReleaseResource_resourceVersionId_fkey"
  FOREIGN KEY ("resourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuthorityGrant" ADD CONSTRAINT "AuthorityGrant_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExecutionRun" ADD CONSTRAINT "ExecutionRun_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExecutionRun" ADD CONSTRAINT "ExecutionRun_authorityGrantId_fkey"
  FOREIGN KEY ("authorityGrantId") REFERENCES "AuthorityGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RunStep" ADD CONSTRAINT "RunStep_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OutcomeRecord" ADD CONSTRAINT "OutcomeRecord_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MetricSample" ADD CONSTRAINT "MetricSample_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ExecutionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_subjectResourceVersionId_fkey"
  FOREIGN KEY ("subjectResourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CertificationRun" ADD CONSTRAINT "CertificationRun_comparisonResourceVersionId_fkey"
  FOREIGN KEY ("comparisonResourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION "protect_registry_evidence"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "RepositoryImport_append_only"
  BEFORE UPDATE OR DELETE ON "RepositoryImport"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();
CREATE TRIGGER "ReleaseBundle_append_only"
  BEFORE UPDATE OR DELETE ON "ReleaseBundle"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();
CREATE TRIGGER "ReleaseResource_append_only"
  BEFORE UPDATE OR DELETE ON "ReleaseResource"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();
CREATE TRIGGER "OutcomeRecord_append_only"
  BEFORE UPDATE OR DELETE ON "OutcomeRecord"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();
CREATE TRIGGER "MetricSample_append_only"
  BEFORE UPDATE OR DELETE ON "MetricSample"
  FOR EACH ROW EXECUTE FUNCTION "protect_registry_evidence"();

CREATE FUNCTION "protect_frozen_resource_version"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
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
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "ResourceVersion_frozen_definition"
  BEFORE INSERT OR UPDATE OR DELETE ON "ResourceVersion"
  FOR EACH ROW EXECUTE FUNCTION "protect_frozen_resource_version"();
