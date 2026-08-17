BEGIN;

CREATE TYPE "PrincipalKind" AS ENUM ('human', 'service');
CREATE TYPE "PlatformRole" AS ENUM ('consumer', 'builder', 'owner', 'admin');
CREATE TYPE "ExternalIdentityProvider" AS ENUM ('local', 'fixture_oidc', 'oidc');
CREATE TYPE "ServicePrincipalState" AS ENUM ('active', 'disabled');
CREATE TYPE "ProjectInstanceState" AS ENUM ('active', 'archived');

CREATE TABLE "Principal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "actorId" VARCHAR(200) NOT NULL,
  "kind" "PrincipalKind" NOT NULL,
  "displayName" VARCHAR(200) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Principal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalIdentity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "principalId" UUID NOT NULL,
  "provider" "ExternalIdentityProvider" NOT NULL,
  "issuer" VARCHAR(500) NOT NULL,
  "subject" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMPTZ(3),
  CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ServicePrincipal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "principalId" UUID NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "purpose" VARCHAR(500) NOT NULL,
  "credentialRef" VARCHAR(500),
  "state" "ServicePrincipalState" NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ServicePrincipal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectInstance" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "departmentId" UUID,
  "slug" VARCHAR(120) NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "state" "ProjectInstanceState" NOT NULL DEFAULT 'active',
  "createdBy" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ProjectInstance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoleBinding" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspaceId" UUID NOT NULL,
  "principalId" UUID NOT NULL,
  "departmentId" UUID,
  "projectInstanceId" UUID,
  "role" "PlatformRole" NOT NULL,
  "scopeKey" VARCHAR(220) NOT NULL,
  "grantedBy" VARCHAR(200) NOT NULL,
  "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "RoleBinding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RoleBinding_scope_check" CHECK (
    ("scopeKey" = 'workspace' AND "departmentId" IS NULL AND "projectInstanceId" IS NULL)
    OR (
      "projectInstanceId" IS NULL
      AND "departmentId" IS NOT NULL
      AND "scopeKey" = 'department:' || "departmentId"::text
    )
    OR (
      "projectInstanceId" IS NOT NULL
      AND "scopeKey" = 'project:' || "projectInstanceId"::text
    )
  )
);

CREATE UNIQUE INDEX "Principal_workspaceId_actorId_key" ON "Principal"("workspaceId", "actorId");
CREATE UNIQUE INDEX "Principal_id_workspaceId_key" ON "Principal"("id", "workspaceId");
CREATE INDEX "Principal_workspaceId_active_kind_idx" ON "Principal"("workspaceId", "active", "kind");

CREATE UNIQUE INDEX "ExternalIdentity_workspaceId_issuer_subject_key" ON "ExternalIdentity"("workspaceId", "issuer", "subject");
CREATE INDEX "ExternalIdentity_principalId_workspaceId_idx" ON "ExternalIdentity"("principalId", "workspaceId");

CREATE UNIQUE INDEX "ServicePrincipal_principalId_key" ON "ServicePrincipal"("principalId");
CREATE UNIQUE INDEX "ServicePrincipal_workspaceId_slug_key" ON "ServicePrincipal"("workspaceId", "slug");
CREATE UNIQUE INDEX "ServicePrincipal_principalId_workspaceId_key" ON "ServicePrincipal"("principalId", "workspaceId");
CREATE INDEX "ServicePrincipal_workspaceId_state_idx" ON "ServicePrincipal"("workspaceId", "state");

CREATE UNIQUE INDEX "ProjectInstance_workspaceId_slug_key" ON "ProjectInstance"("workspaceId", "slug");
CREATE UNIQUE INDEX "ProjectInstance_id_workspaceId_key" ON "ProjectInstance"("id", "workspaceId");
CREATE INDEX "ProjectInstance_workspaceId_departmentId_state_idx" ON "ProjectInstance"("workspaceId", "departmentId", "state");

CREATE UNIQUE INDEX "RoleBinding_workspaceId_principalId_role_scopeKey_key" ON "RoleBinding"("workspaceId", "principalId", "role", "scopeKey");
CREATE INDEX "RoleBinding_workspaceId_departmentId_role_revokedAt_idx" ON "RoleBinding"("workspaceId", "departmentId", "role", "revokedAt");
CREATE INDEX "RoleBinding_projectInstanceId_role_revokedAt_idx" ON "RoleBinding"("projectInstanceId", "role", "revokedAt");

ALTER TABLE "Principal" ADD CONSTRAINT "Principal_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_principalId_workspaceId_fkey"
  FOREIGN KEY ("principalId", "workspaceId") REFERENCES "Principal"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServicePrincipal" ADD CONSTRAINT "ServicePrincipal_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServicePrincipal" ADD CONSTRAINT "ServicePrincipal_principalId_workspaceId_fkey"
  FOREIGN KEY ("principalId", "workspaceId") REFERENCES "Principal"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectInstance" ADD CONSTRAINT "ProjectInstance_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectInstance" ADD CONSTRAINT "ProjectInstance_departmentId_workspaceId_fkey"
  FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_principalId_workspaceId_fkey"
  FOREIGN KEY ("principalId", "workspaceId") REFERENCES "Principal"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_departmentId_workspaceId_fkey"
  FOREIGN KEY ("departmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_projectInstanceId_workspaceId_fkey"
  FOREIGN KEY ("projectInstanceId", "workspaceId") REFERENCES "ProjectInstance"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- This is intentionally a representative isolation slice, not a claim that every legacy table
-- is protected by PostgreSQL RLS. The scoped transaction wrapper sets both values with SET LOCAL.
ALTER TABLE "ProjectInstance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProjectInstance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ProjectInstance_principal_scope" ON "ProjectInstance"
  USING (
    "workspaceId" = NULLIF(current_setting('paul_os.workspace_id', true), '')::uuid
    AND (
      "departmentId" IS NULL
      OR "departmentId" = NULLIF(current_setting('paul_os.department_id', true), '')::uuid
    )
  )
  WITH CHECK (
    "workspaceId" = NULLIF(current_setting('paul_os.workspace_id', true), '')::uuid
    AND (
      "departmentId" IS NULL
      OR "departmentId" = NULLIF(current_setting('paul_os.department_id', true), '')::uuid
    )
  );

COMMIT;
