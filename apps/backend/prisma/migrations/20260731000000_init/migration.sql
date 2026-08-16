CREATE TYPE "AgentStatus" AS ENUM ('draft', 'generating', 'ready', 'shadow', 'active', 'failed');
CREATE TYPE "SpecStatus" AS ENUM ('draft', 'ready', 'generating', 'generated');
CREATE TYPE "GenerationJobState" AS ENUM ('queued', 'running', 'succeeded', 'failed');
CREATE TYPE "SourceRole" AS ENUM ('knowledge', 'signal', 'telemetry', 'evaluation');
CREATE TYPE "SourceProvider" AS ENUM ('bigquery', 'confluence', 'jira', 'email', 'slack', 'interstellar', 'fixture');
CREATE TYPE "SourceAuthority" AS ENUM ('system_of_record', 'curated', 'derived', 'transient', 'untrusted');
CREATE TYPE "GuardrailType" AS ENUM ('prohibited_action', 'approval_requirement', 'fail_closed', 'response_requirement');
CREATE TYPE "EvaluationStatus" AS ENUM ('not_run', 'passed', 'failed');

CREATE TABLE "Agent" (
  "id" UUID NOT NULL,
  "slug" VARCHAR(160) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "department" VARCHAR(120) NOT NULL,
  "purpose" TEXT NOT NULL,
  "owner" VARCHAR(160) NOT NULL,
  "status" "AgentStatus" NOT NULL DEFAULT 'draft',
  "capabilities" JSONB NOT NULL DEFAULT '[]',
  "manifest" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentSpec" (
  "id" UUID NOT NULL,
  "agentId" UUID NOT NULL,
  "baseAgentId" UUID,
  "status" "SpecStatus" NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "outcomes" JSONB,
  "knowledge" JSONB,
  "guardrails" JSONB,
  "outputs" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentSpec_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeSource" (
  "id" VARCHAR(100) NOT NULL,
  "role" "SourceRole" NOT NULL,
  "provider" "SourceProvider" NOT NULL,
  "displayName" VARCHAR(160) NOT NULL,
  "uri" VARCHAR(500) NOT NULL,
  "authority" "SourceAuthority" NOT NULL,
  "owner" VARCHAR(160) NOT NULL,
  "region" VARCHAR(80),
  "lastRefreshed" TIMESTAMPTZ(3),
  "citationRequired" BOOLEAN NOT NULL DEFAULT true,
  "readOnly" BOOLEAN NOT NULL DEFAULT true,
  "synthetic" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AgentKnowledgeSource" (
  "agentId" UUID NOT NULL,
  "sourceId" VARCHAR(100) NOT NULL,
  "purpose" VARCHAR(500) NOT NULL,
  "citations" BOOLEAN NOT NULL,
  CONSTRAINT "AgentKnowledgeSource_pkey" PRIMARY KEY ("agentId", "sourceId")
);

CREATE TABLE "Guardrail" (
  "id" UUID NOT NULL,
  "agentId" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "type" "GuardrailType" NOT NULL,
  "parameters" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Guardrail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EvaluationTest" (
  "id" UUID NOT NULL,
  "agentId" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "testCase" JSONB NOT NULL,
  "expectedResult" JSONB NOT NULL,
  "actualResult" JSONB,
  "status" "EvaluationStatus" NOT NULL DEFAULT 'not_run',
  "generatorVersion" VARCHAR(80) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EvaluationTest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GenerationJob" (
  "id" UUID NOT NULL,
  "agentId" UUID NOT NULL,
  "specId" UUID NOT NULL,
  "state" "GenerationJobState" NOT NULL DEFAULT 'queued',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "message" VARCHAR(500) NOT NULL DEFAULT 'Queued',
  "specRevision" INTEGER NOT NULL,
  "generatorVersion" VARCHAR(80) NOT NULL,
  "specSnapshot" JSONB NOT NULL,
  "manifest" JSONB,
  "error" JSONB,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Agent_slug_key" ON "Agent"("slug");
CREATE INDEX "Agent_status_idx" ON "Agent"("status");
CREATE INDEX "Agent_department_idx" ON "Agent"("department");
CREATE UNIQUE INDEX "AgentSpec_agentId_key" ON "AgentSpec"("agentId");
CREATE INDEX "AgentSpec_status_idx" ON "AgentSpec"("status");
CREATE INDEX "AgentSpec_baseAgentId_idx" ON "AgentSpec"("baseAgentId");
CREATE INDEX "KnowledgeSource_role_idx" ON "KnowledgeSource"("role");
CREATE INDEX "KnowledgeSource_provider_idx" ON "KnowledgeSource"("provider");
CREATE INDEX "AgentKnowledgeSource_sourceId_idx" ON "AgentKnowledgeSource"("sourceId");
CREATE INDEX "Guardrail_agentId_type_idx" ON "Guardrail"("agentId", "type");
CREATE UNIQUE INDEX "EvaluationTest_agentId_name_generatorVersion_key" ON "EvaluationTest"("agentId", "name", "generatorVersion");
CREATE INDEX "EvaluationTest_agentId_status_idx" ON "EvaluationTest"("agentId", "status");
CREATE INDEX "GenerationJob_state_createdAt_idx" ON "GenerationJob"("state", "createdAt");
CREATE INDEX "GenerationJob_specId_idx" ON "GenerationJob"("specId");

-- Database-level race-condition backstop: at most one queued/running generation per agent.
CREATE UNIQUE INDEX "GenerationJob_one_active_per_agent"
  ON "GenerationJob" ("agentId")
  WHERE "state" IN ('queued'::"GenerationJobState", 'running'::"GenerationJobState");

ALTER TABLE "AgentSpec" ADD CONSTRAINT "AgentSpec_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentSpec" ADD CONSTRAINT "AgentSpec_baseAgentId_fkey"
  FOREIGN KEY ("baseAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentKnowledgeSource" ADD CONSTRAINT "AgentKnowledgeSource_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentKnowledgeSource" ADD CONSTRAINT "AgentKnowledgeSource_sourceId_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Guardrail" ADD CONSTRAINT "Guardrail_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EvaluationTest" ADD CONSTRAINT "EvaluationTest_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_specId_fkey"
  FOREIGN KEY ("specId") REFERENCES "AgentSpec"("id") ON DELETE CASCADE ON UPDATE CASCADE;
