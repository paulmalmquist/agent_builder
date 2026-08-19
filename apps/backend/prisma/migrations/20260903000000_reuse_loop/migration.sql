BEGIN;

CREATE TYPE "CatalogVisibility" AS ENUM ('private', 'department', 'organization');
CREATE TYPE "CatalogPublicationState" AS ENUM ('prepared', 'active', 'retired');
CREATE TYPE "CatalogIndexOperation" AS ENUM ('upsert', 'remove');
CREATE TYPE "CatalogIndexOutboxState" AS ENUM ('pending', 'processing', 'published', 'failed');
CREATE TYPE "BuilderIntakeState" AS ENUM ('interpreted', 'confirmed', 'decided');
CREATE TYPE "BuilderDecisionAction" AS ENUM ('use_as_is', 'configure', 'extend', 'build_new');
CREATE TYPE "BuilderDraftKind" AS ENUM ('configuration', 'extension', 'new');
CREATE TYPE "BuilderDraftState" AS ENUM ('draft', 'ready', 'materialized', 'discarded');
CREATE TYPE "ResourceLineageRelationship" AS ENUM ('forked_from', 'composed_of');
CREATE TYPE "DeploymentStatus" AS ENUM ('pending', 'active', 'retired', 'failed');

CREATE TABLE "CapabilityProfile" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "resourceVersionId" UUID NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "profile" JSONB NOT NULL,
  "digest" VARCHAR(64) NOT NULL,
  "createdBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CapabilityProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CapabilityProfile_schemaVersion_check" CHECK ("schemaVersion" = 1),
  CONSTRAINT "CapabilityProfile_digest_check" CHECK ("digest" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "CatalogPublication" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "resourceVersionId" UUID NOT NULL,
  "releaseId" UUID NOT NULL,
  "capabilityProfileId" UUID NOT NULL,
  "activationEvaluationId" UUID,
  "activationDecisionId" UUID,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "subjectKind" "ResourceKind" NOT NULL,
  "catalogVisibility" "CatalogVisibility" NOT NULL,
  "trustChip" JSONB,
  "state" "CatalogPublicationState" NOT NULL DEFAULT 'prepared',
  "preparedBy" VARCHAR(200) NOT NULL,
  "preparedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMPTZ(3),
  "retiredAt" TIMESTAMPTZ(3),
  "retiredBy" VARCHAR(200),
  "retirementRationale" TEXT,
  CONSTRAINT "CatalogPublication_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogPublication_subject_check" CHECK ("subjectKind" IN ('Agent'::"ResourceKind", 'Skill'::"ResourceKind")),
  CONSTRAINT "CatalogPublication_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "CatalogPublication_state_check" CHECK (
    ("state" = 'prepared' AND "publishedAt" IS NULL AND "retiredAt" IS NULL AND "trustChip" IS NULL)
    OR ("state" = 'active' AND "publishedAt" IS NOT NULL AND "retiredAt" IS NULL AND "trustChip" IS NOT NULL AND "activationEvaluationId" IS NOT NULL AND "activationDecisionId" IS NOT NULL)
    OR ("state" = 'retired' AND "retiredAt" IS NOT NULL AND "retiredBy" IS NOT NULL AND "retirementRationale" IS NOT NULL)
  )
);

CREATE TABLE "CatalogIndexOutbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "publicationId" UUID NOT NULL,
  "publicationRevision" INTEGER NOT NULL,
  "idempotencyKey" VARCHAR(500) NOT NULL,
  "operation" "CatalogIndexOperation" NOT NULL,
  "resource" JSONB NOT NULL,
  "state" "CatalogIndexOutboxState" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMPTZ(3),
  "publishedAt" TIMESTAMPTZ(3),
  "lastError" VARCHAR(2000),
  CONSTRAINT "CatalogIndexOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CatalogIndexOutbox_revision_check" CHECK ("publicationRevision" > 0),
  CONSTRAINT "CatalogIndexOutbox_attempts_check" CHECK ("attempts" >= 0 AND "attempts" <= 100)
);

CREATE TABLE "CatalogIndexRecord" (
  "publicationId" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "publicationRevision" INTEGER NOT NULL,
  "subjectKind" "ResourceKind" NOT NULL,
  "resourceVersionId" UUID NOT NULL,
  "releaseDigest" VARCHAR(64) NOT NULL,
  "catalogVisibility" "CatalogVisibility" NOT NULL,
  "departmentLabel" VARCHAR(160) NOT NULL,
  "featureKeys" JSONB NOT NULL,
  "canonicalText" TEXT NOT NULL,
  "embedding" JSONB,
  "embeddingProvenance" JSONB,
  "retired" BOOLEAN NOT NULL DEFAULT false,
  "indexedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CatalogIndexRecord_pkey" PRIMARY KEY ("publicationId"),
  CONSTRAINT "CatalogIndexRecord_subject_check" CHECK ("subjectKind" IN ('Agent'::"ResourceKind", 'Skill'::"ResourceKind")),
  CONSTRAINT "CatalogIndexRecord_embedding_pair_check" CHECK (("embedding" IS NULL) = ("embeddingProvenance" IS NULL)),
  CONSTRAINT "CatalogIndexRecord_digest_check" CHECK ("releaseDigest" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "BuilderIntake" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "request" TEXT NOT NULL,
  "requestedBy" VARCHAR(200) NOT NULL,
  "departmentLabel" VARCHAR(160) NOT NULL,
  "state" "BuilderIntakeState" NOT NULL,
  "capabilityProfile" JSONB NOT NULL,
  "confirmedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuilderIntake_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuilderIntake_confirmation_check" CHECK (
    ("state" = 'interpreted' AND "confirmedAt" IS NULL)
    OR ("state" IN ('confirmed', 'decided') AND "confirmedAt" IS NOT NULL)
  )
);

CREATE TABLE "BuilderDecision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "intakeId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "action" "BuilderDecisionAction" NOT NULL,
  "selectedPublicationId" UUID,
  "buildNewReason" VARCHAR(500),
  "demandObservationId" UUID,
  "highestReferredMatchScore" DOUBLE PRECISION,
  "decidedBy" VARCHAR(200) NOT NULL,
  "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BuilderDecision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuilderDecision_match_check" CHECK ("highestReferredMatchScore" IS NULL OR ("highestReferredMatchScore" >= 0 AND "highestReferredMatchScore" <= 100)),
  CONSTRAINT "BuilderDecision_shape_check" CHECK (
    ("action" IN ('use_as_is', 'configure', 'extend') AND "selectedPublicationId" IS NOT NULL AND "buildNewReason" IS NULL AND "demandObservationId" IS NULL)
    OR ("action" = 'build_new' AND "selectedPublicationId" IS NULL AND (("buildNewReason" IS NULL) = ("demandObservationId" IS NULL)))
  ),
  CONSTRAINT "BuilderDecision_reason_threshold_check" CHECK ("action" <> 'build_new' OR "highestReferredMatchScore" IS NULL OR "highestReferredMatchScore" <= 80 OR "buildNewReason" IS NOT NULL)
);

CREATE TABLE "BuilderDraft" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "intakeId" UUID NOT NULL,
  "decisionId" UUID NOT NULL,
  "draftKind" "BuilderDraftKind" NOT NULL,
  "basePublicationId" UUID,
  "materializedResourceVersionId" UUID,
  "capabilityProfile" JSONB NOT NULL,
  "definition" JSONB NOT NULL DEFAULT '{}',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "state" "BuilderDraftState" NOT NULL DEFAULT 'draft',
  "createdBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "BuilderDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuilderDraft_base_check" CHECK (("draftKind" IN ('configuration', 'extension')) = ("basePublicationId" IS NOT NULL)),
  CONSTRAINT "BuilderDraft_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "BuilderDraft_materialization_check" CHECK (("state" = 'materialized') = ("materializedResourceVersionId" IS NOT NULL))
);

CREATE TABLE "Deployment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "decisionId" UUID NOT NULL,
  "deployedResourceVersionId" UUID NOT NULL,
  "sourcePublicationId" UUID,
  "projectId" VARCHAR(200) NOT NULL,
  "currentConfigurationRevisionId" UUID,
  "status" "DeploymentStatus" NOT NULL DEFAULT 'active',
  "sourceRetiredAt" TIMESTAMPTZ(3),
  "deployedBy" VARCHAR(200) NOT NULL,
  "deployedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConfigurationRevision" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "deploymentId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "previousRevisionId" UUID,
  "configuration" JSONB NOT NULL,
  "digest" VARCHAR(64) NOT NULL,
  "createdBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConfigurationRevision_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConfigurationRevision_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "ConfigurationRevision_chain_check" CHECK (("revision" = 1) = ("previousRevisionId" IS NULL)),
  CONSTRAINT "ConfigurationRevision_digest_check" CHECK ("digest" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "ResourceLineage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "childResourceVersionId" UUID NOT NULL,
  "parentResourceVersionId" UUID NOT NULL,
  "relationship" "ResourceLineageRelationship" NOT NULL,
  "ordinal" INTEGER,
  "decisionId" UUID NOT NULL,
  "createdBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResourceLineage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResourceLineage_self_check" CHECK ("childResourceVersionId" <> "parentResourceVersionId"),
  CONSTRAINT "ResourceLineage_ordinal_check" CHECK (("relationship" = 'composed_of') = ("ordinal" IS NOT NULL) AND ("ordinal" IS NULL OR "ordinal" >= 0))
);

CREATE UNIQUE INDEX "CapabilityProfile_resourceVersionId_key" ON "CapabilityProfile"("resourceVersionId");
CREATE INDEX "CapabilityProfile_workspaceId_departmentId_createdAt_idx" ON "CapabilityProfile"("workspaceId", "departmentId", "createdAt");
CREATE INDEX "CapabilityProfile_digest_idx" ON "CapabilityProfile"("digest");
CREATE UNIQUE INDEX "CatalogPublication_releaseId_resourceVersionId_key" ON "CatalogPublication"("releaseId", "resourceVersionId");
CREATE INDEX "CatalogPublication_workspaceId_departmentId_state_catalogVisibility_idx" ON "CatalogPublication"("workspaceId", "departmentId", "state", "catalogVisibility");
CREATE INDEX "CatalogPublication_resourceVersionId_state_idx" ON "CatalogPublication"("resourceVersionId", "state");
CREATE INDEX "CatalogPublication_releaseId_state_idx" ON "CatalogPublication"("releaseId", "state");
CREATE UNIQUE INDEX "CatalogIndexOutbox_idempotencyKey_key" ON "CatalogIndexOutbox"("idempotencyKey");
CREATE INDEX "CatalogIndexOutbox_state_availableAt_occurredAt_idx" ON "CatalogIndexOutbox"("state", "availableAt", "occurredAt");
CREATE INDEX "CatalogIndexOutbox_workspaceId_departmentId_occurredAt_idx" ON "CatalogIndexOutbox"("workspaceId", "departmentId", "occurredAt");
CREATE INDEX "CatalogIndexOutbox_publicationId_publicationRevision_idx" ON "CatalogIndexOutbox"("publicationId", "publicationRevision");
CREATE INDEX "CatalogIndexRecord_workspaceId_departmentId_retired_subjectKind_idx" ON "CatalogIndexRecord"("workspaceId", "departmentId", "retired", "subjectKind");
CREATE INDEX "CatalogIndexRecord_resourceVersionId_idx" ON "CatalogIndexRecord"("resourceVersionId");
CREATE INDEX "BuilderIntake_workspaceId_departmentId_createdAt_idx" ON "BuilderIntake"("workspaceId", "departmentId", "createdAt");
CREATE INDEX "BuilderIntake_state_createdAt_idx" ON "BuilderIntake"("state", "createdAt");
CREATE UNIQUE INDEX "BuilderDecision_intakeId_key" ON "BuilderDecision"("intakeId");
CREATE UNIQUE INDEX "BuilderDecision_idempotencyKey_key" ON "BuilderDecision"("idempotencyKey");
CREATE UNIQUE INDEX "BuilderDecision_demandObservationId_key" ON "BuilderDecision"("demandObservationId");
CREATE INDEX "BuilderDecision_workspaceId_departmentId_decidedAt_idx" ON "BuilderDecision"("workspaceId", "departmentId", "decidedAt");
CREATE INDEX "BuilderDecision_selectedPublicationId_decidedAt_idx" ON "BuilderDecision"("selectedPublicationId", "decidedAt");
CREATE UNIQUE INDEX "BuilderDraft_decisionId_draftKind_key" ON "BuilderDraft"("decisionId", "draftKind");
CREATE INDEX "BuilderDraft_workspaceId_departmentId_state_updatedAt_idx" ON "BuilderDraft"("workspaceId", "departmentId", "state", "updatedAt");
CREATE INDEX "BuilderDraft_basePublicationId_idx" ON "BuilderDraft"("basePublicationId");
CREATE UNIQUE INDEX "Deployment_decisionId_key" ON "Deployment"("decisionId");
CREATE INDEX "Deployment_workspaceId_departmentId_status_deployedAt_idx" ON "Deployment"("workspaceId", "departmentId", "status", "deployedAt");
CREATE INDEX "Deployment_sourcePublicationId_status_idx" ON "Deployment"("sourcePublicationId", "status");
CREATE INDEX "Deployment_deployedResourceVersionId_status_idx" ON "Deployment"("deployedResourceVersionId", "status");
CREATE UNIQUE INDEX "ConfigurationRevision_previousRevisionId_key" ON "ConfigurationRevision"("previousRevisionId");
CREATE UNIQUE INDEX "ConfigurationRevision_deploymentId_revision_key" ON "ConfigurationRevision"("deploymentId", "revision");
CREATE INDEX "ConfigurationRevision_workspaceId_departmentId_createdAt_idx" ON "ConfigurationRevision"("workspaceId", "departmentId", "createdAt");
CREATE UNIQUE INDEX "ResourceLineage_childResourceVersionId_relationship_parentResourceVersionId_key" ON "ResourceLineage"("childResourceVersionId", "relationship", "parentResourceVersionId");
CREATE UNIQUE INDEX "ResourceLineage_childResourceVersionId_ordinal_key" ON "ResourceLineage"("childResourceVersionId", "ordinal");
CREATE INDEX "ResourceLineage_workspaceId_departmentId_createdAt_idx" ON "ResourceLineage"("workspaceId", "departmentId", "createdAt");
CREATE INDEX "ResourceLineage_parentResourceVersionId_idx" ON "ResourceLineage"("parentResourceVersionId");
CREATE INDEX "ResourceLineage_decisionId_idx" ON "ResourceLineage"("decisionId");

ALTER TABLE "CapabilityProfile" ADD CONSTRAINT "CapabilityProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CapabilityProfile" ADD CONSTRAINT "CapabilityProfile_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CapabilityProfile" ADD CONSTRAINT "CapabilityProfile_resourceVersionId_fkey" FOREIGN KEY ("resourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogPublication" ADD CONSTRAINT "CatalogPublication_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogPublication" ADD CONSTRAINT "CatalogPublication_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogPublication" ADD CONSTRAINT "CatalogPublication_resourceVersionId_fkey" FOREIGN KEY ("resourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogPublication" ADD CONSTRAINT "CatalogPublication_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ReleaseBundle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogPublication" ADD CONSTRAINT "CatalogPublication_capabilityProfileId_fkey" FOREIGN KEY ("capabilityProfileId") REFERENCES "CapabilityProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogPublication" ADD CONSTRAINT "CatalogPublication_activationEvaluationId_fkey" FOREIGN KEY ("activationEvaluationId") REFERENCES "ReleaseEvaluation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogPublication" ADD CONSTRAINT "CatalogPublication_activationDecisionId_fkey" FOREIGN KEY ("activationDecisionId") REFERENCES "ReleasePromotionDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogIndexOutbox" ADD CONSTRAINT "CatalogIndexOutbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogIndexOutbox" ADD CONSTRAINT "CatalogIndexOutbox_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogIndexOutbox" ADD CONSTRAINT "CatalogIndexOutbox_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "CatalogPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogIndexRecord" ADD CONSTRAINT "CatalogIndexRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogIndexRecord" ADD CONSTRAINT "CatalogIndexRecord_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CatalogIndexRecord" ADD CONSTRAINT "CatalogIndexRecord_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "CatalogPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderIntake" ADD CONSTRAINT "BuilderIntake_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderIntake" ADD CONSTRAINT "BuilderIntake_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDecision" ADD CONSTRAINT "BuilderDecision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDecision" ADD CONSTRAINT "BuilderDecision_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDecision" ADD CONSTRAINT "BuilderDecision_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "BuilderIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDecision" ADD CONSTRAINT "BuilderDecision_selectedPublicationId_fkey" FOREIGN KEY ("selectedPublicationId") REFERENCES "CatalogPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDecision" ADD CONSTRAINT "BuilderDecision_demandObservationId_fkey" FOREIGN KEY ("demandObservationId") REFERENCES "Observation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDraft" ADD CONSTRAINT "BuilderDraft_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDraft" ADD CONSTRAINT "BuilderDraft_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDraft" ADD CONSTRAINT "BuilderDraft_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "BuilderIntake"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDraft" ADD CONSTRAINT "BuilderDraft_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "BuilderDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDraft" ADD CONSTRAINT "BuilderDraft_basePublicationId_fkey" FOREIGN KEY ("basePublicationId") REFERENCES "CatalogPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BuilderDraft" ADD CONSTRAINT "BuilderDraft_materializedResourceVersionId_fkey" FOREIGN KEY ("materializedResourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "BuilderDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_deployedResourceVersionId_fkey" FOREIGN KEY ("deployedResourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_sourcePublicationId_fkey" FOREIGN KEY ("sourcePublicationId") REFERENCES "CatalogPublication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigurationRevision" ADD CONSTRAINT "ConfigurationRevision_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigurationRevision" ADD CONSTRAINT "ConfigurationRevision_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigurationRevision" ADD CONSTRAINT "ConfigurationRevision_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "Deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConfigurationRevision" ADD CONSTRAINT "ConfigurationRevision_previousRevisionId_fkey" FOREIGN KEY ("previousRevisionId") REFERENCES "ConfigurationRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceLineage" ADD CONSTRAINT "ResourceLineage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceLineage" ADD CONSTRAINT "ResourceLineage_departmentId_workspaceId_fkey" FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceLineage" ADD CONSTRAINT "ResourceLineage_childResourceVersionId_fkey" FOREIGN KEY ("childResourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceLineage" ADD CONSTRAINT "ResourceLineage_parentResourceVersionId_fkey" FOREIGN KEY ("parentResourceVersionId") REFERENCES "ResourceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ResourceLineage" ADD CONSTRAINT "ResourceLineage_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "BuilderDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "protect_reuse_evidence"()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME IN ('CapabilityProfile', 'BuilderDecision', 'ConfigurationRevision', 'ResourceLineage') THEN
    RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'CatalogIndexOutbox' AND (
    NEW."publicationId" IS DISTINCT FROM OLD."publicationId"
    OR NEW."publicationRevision" IS DISTINCT FROM OLD."publicationRevision"
    OR NEW."idempotencyKey" IS DISTINCT FROM OLD."idempotencyKey"
    OR NEW."operation" IS DISTINCT FROM OLD."operation"
    OR NEW."resource" IS DISTINCT FROM OLD."resource"
    OR NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
    OR NEW."departmentId" IS DISTINCT FROM OLD."departmentId"
  ) THEN
    RAISE EXCEPTION 'Catalog index outbox payload is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CapabilityProfile_immutable" BEFORE UPDATE OR DELETE ON "CapabilityProfile" FOR EACH ROW EXECUTE FUNCTION "protect_reuse_evidence"();
CREATE TRIGGER "BuilderDecision_immutable" BEFORE UPDATE OR DELETE ON "BuilderDecision" FOR EACH ROW EXECUTE FUNCTION "protect_reuse_evidence"();
CREATE TRIGGER "ConfigurationRevision_immutable" BEFORE UPDATE OR DELETE ON "ConfigurationRevision" FOR EACH ROW EXECUTE FUNCTION "protect_reuse_evidence"();
CREATE TRIGGER "ResourceLineage_immutable" BEFORE UPDATE OR DELETE ON "ResourceLineage" FOR EACH ROW EXECUTE FUNCTION "protect_reuse_evidence"();
CREATE TRIGGER "CatalogIndexOutbox_payload_immutable" BEFORE UPDATE OR DELETE ON "CatalogIndexOutbox" FOR EACH ROW EXECUTE FUNCTION "protect_reuse_evidence"();

COMMIT;
