BEGIN;

ALTER TABLE "Principal" ADD COLUMN "homeDepartmentId" UUID;

ALTER TABLE "Principal" ADD CONSTRAINT "Principal_homeDepartmentId_workspaceId_fkey"
  FOREIGN KEY ("homeDepartmentId", "workspaceId") REFERENCES "Department"("id", "workspaceId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Principal_workspaceId_homeDepartmentId_active_idx"
  ON "Principal"("workspaceId", "homeDepartmentId", "active");

COMMIT;
