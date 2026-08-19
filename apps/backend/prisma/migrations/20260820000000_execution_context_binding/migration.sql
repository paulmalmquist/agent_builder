-- Bind every authority decision and execution attempt to an immutable, reproducible context
-- snapshot without storing private context values.
BEGIN;

CREATE TYPE "ContextClassification" AS ENUM ('public', 'internal', 'private', 'restricted');

ALTER TABLE "AuthorityGrant"
  ADD COLUMN "contextDigest" VARCHAR(64);

ALTER TABLE "ExecutionRun"
  ADD COLUMN "contextDigest" VARCHAR(64),
  ADD COLUMN "contextProvenance" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "contextClassification" "ContextClassification" NOT NULL DEFAULT 'public',
  ADD COLUMN "contextEstimatedTokens" INTEGER NOT NULL DEFAULT 0;

-- Pre-existing rows have no reconstructible private-context snapshot. Keep them readable but make
-- any unfinished run terminal so it cannot execute under an invented context.
UPDATE "ExecutionRun"
SET "contextDigest" = encode(digest('legacy-context-snapshot-unavailable', 'sha256'), 'hex'),
    "error" = CASE
      WHEN "state" IN ('awaiting_approval', 'queued', 'running', 'paused_budget')
        THEN jsonb_build_object('code', 'EXECUTION_CONTEXT_SNAPSHOT_MISSING')
      ELSE "error"
    END,
    "state" = CASE
      WHEN "state" IN ('awaiting_approval', 'queued', 'running', 'paused_budget')
        THEN 'failed'::"ExecutionRunState"
      ELSE "state"
    END,
    "message" = CASE
      WHEN "state" IN ('awaiting_approval', 'queued', 'running', 'paused_budget')
        THEN 'Execution context snapshot is unavailable'
      ELSE "message"
    END,
    "finishedAt" = CASE
      WHEN "state" IN ('awaiting_approval', 'queued', 'running', 'paused_budget')
        THEN COALESCE("finishedAt", NOW())
      ELSE "finishedAt"
    END;

UPDATE "ApprovalRequest" approval
SET "state" = 'cancelled',
    "decidedBy" = COALESCE(approval."decidedBy", 'system:migration'),
    "rationale" = COALESCE(approval."rationale", 'Execution context snapshot unavailable'),
    "decidedAt" = COALESCE(approval."decidedAt", NOW())
FROM "ExecutionRun" run
WHERE approval."runId" = run."id"
  AND approval."state" = 'pending'
  AND run."error"->>'code' = 'EXECUTION_CONTEXT_SNAPSHOT_MISSING';

-- A legacy running claim may have reserved its full upper-bound cost. Its real usage is
-- unknowable after the context-less attempt is terminalized, so conservatively settle every
-- remaining reservation as spent rather than silently restoring authority.
UPDATE "AuthorityGrant"
SET "spentCostUsd" = "spentCostUsd" + "reservedCostUsd",
    "reservedCostUsd" = 0,
    "state" = CASE
      WHEN "state" IN ('active', 'exhausted')
        AND (
          "usedRuns" >= "maxRuns"
          OR "spentCostUsd" + "reservedCostUsd" >= "totalCostBudgetUsd"
        )
        THEN 'exhausted'::"AuthorityGrantState"
      ELSE "state"
    END
WHERE "reservedCostUsd" > 0;

UPDATE "AuthorityGrant" authority_grant
SET "contextDigest" = COALESCE(
  (
    SELECT run."contextDigest"
    FROM "ExecutionRun" run
    WHERE run."authorityGrantId" = authority_grant."id"
    ORDER BY run."createdAt" ASC
    LIMIT 1
  ),
  encode(digest('legacy-context-snapshot-unavailable', 'sha256'), 'hex')
);

ALTER TABLE "AuthorityGrant" ALTER COLUMN "contextDigest" SET NOT NULL;
ALTER TABLE "ExecutionRun" ALTER COLUMN "contextDigest" SET NOT NULL;

ALTER TABLE "AuthorityGrant" ADD CONSTRAINT "AuthorityGrant_context_digest_check"
  CHECK ("contextDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "ExecutionRun" ADD CONSTRAINT "ExecutionRun_context_snapshot_check"
  CHECK (
    "contextDigest" ~ '^[a-f0-9]{64}$'
    AND "contextEstimatedTokens" >= 0
    AND jsonb_typeof("contextProvenance") = 'array'
  );

CREATE FUNCTION "protect_authority_context_binding"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."contextDigest" IS DISTINCT FROM OLD."contextDigest" THEN
    RAISE EXCEPTION 'Authority context digest is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "protect_execution_context_binding"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."contextDigest" IS DISTINCT FROM OLD."contextDigest"
    OR (
    NEW."contextProvenance" IS DISTINCT FROM OLD."contextProvenance"
    OR NEW."contextClassification" IS DISTINCT FROM OLD."contextClassification"
    OR NEW."contextEstimatedTokens" IS DISTINCT FROM OLD."contextEstimatedTokens"
  ) THEN
    RAISE EXCEPTION 'Execution context summary is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AuthorityGrant_context_binding_immutable"
  BEFORE UPDATE ON "AuthorityGrant"
  FOR EACH ROW EXECUTE FUNCTION "protect_authority_context_binding"();

CREATE TRIGGER "ExecutionRun_context_binding_immutable"
  BEFORE UPDATE ON "ExecutionRun"
  FOR EACH ROW EXECUTE FUNCTION "protect_execution_context_binding"();

COMMIT;
