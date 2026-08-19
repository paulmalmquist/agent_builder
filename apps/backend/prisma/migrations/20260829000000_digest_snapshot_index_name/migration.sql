BEGIN;

ALTER INDEX "DigestSnapshot_workspaceId_departmentScopeKey_actorId_eventSequ"
  RENAME TO "DigestSnapshot_scope_actor_window_key";

COMMIT;
