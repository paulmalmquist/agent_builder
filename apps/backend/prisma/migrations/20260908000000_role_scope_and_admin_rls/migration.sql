BEGIN;

ALTER TABLE "RoleBinding" DROP CONSTRAINT "RoleBinding_scope_check";
ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_scope_check" CHECK (
  (
    "role" = 'admin'
    AND "scopeKey" = 'workspace'
    AND "departmentId" IS NULL
    AND "projectInstanceId" IS NULL
  )
  OR (
    "role" IN ('consumer', 'builder', 'owner')
    AND "projectInstanceId" IS NULL
    AND "departmentId" IS NOT NULL
    AND "scopeKey" = 'department:' || "departmentId"::text
  )
);

DROP POLICY "ProjectInstance_principal_scope" ON "ProjectInstance";
CREATE POLICY "ProjectInstance_principal_scope" ON "ProjectInstance"
  USING (
    "workspaceId" = NULLIF(current_setting('paul_os.workspace_id', true), '')::uuid
    AND (
      current_setting('paul_os.is_workspace_admin', true) = 'true'
      OR "departmentId" = NULLIF(current_setting('paul_os.department_id', true), '')::uuid
    )
  )
  WITH CHECK (
    "workspaceId" = NULLIF(current_setting('paul_os.workspace_id', true), '')::uuid
    AND (
      current_setting('paul_os.is_workspace_admin', true) = 'true'
      OR "departmentId" = NULLIF(current_setting('paul_os.department_id', true), '')::uuid
    )
  );

COMMIT;
