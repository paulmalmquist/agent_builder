-- Release evaluation evidence is immutable, but the same release can be
-- re-evaluated after its exact production-history snapshot changes.
BEGIN;

ALTER TABLE "ReleaseEvaluation"
  ADD COLUMN "historySnapshotDigest" VARCHAR(64) NOT NULL DEFAULT repeat('0', 64);

ALTER TABLE "ReleaseEvaluation"
  ALTER COLUMN "historySnapshotDigest" DROP DEFAULT;

-- This is the one controlled rewrite of pre-snapshot evidence. Keep the
-- protection disabled only inside this migration transaction.
ALTER TABLE "ReleaseEvaluation" DISABLE TRIGGER "ReleaseEvaluation_append_only";

UPDATE "ReleaseEvaluation" evaluation
SET "evidence" = evaluation."evidence" || jsonb_build_object(
  'schemaVersion', 1,
  'historySnapshotDigest', evaluation."historySnapshotDigest",
  'historyRunIds', '[]'::jsonb,
  'gateResults', jsonb_build_array(
    jsonb_build_object(
      'key', 'schema_conformance',
      'category', 'contract',
      'operator', 'gte',
      'threshold', (suite."definition" #>> '{spec,gates,schemaConformance}')::double precision,
      'measuredValue', (evaluation."gateScores" ->> 'schemaConformance')::double precision,
      'status', CASE
        WHEN (evaluation."gateScores" ->> 'schemaConformance')::double precision >=
          (suite."definition" #>> '{spec,gates,schemaConformance}')::double precision
        THEN 'passed' ELSE 'failed' END,
      'sampleSize', 1,
      'evidenceSource', 'manifest_declaration',
      'detail', 'Migrated from immutable deterministic aggregate evidence.'
    ),
    jsonb_build_object(
      'key', 'citation_coverage',
      'category', 'contract',
      'operator', 'gte',
      'threshold', (suite."definition" #>> '{spec,gates,citationCoverage}')::double precision,
      'measuredValue', (evaluation."gateScores" ->> 'citationCoverage')::double precision,
      'status', CASE
        WHEN (evaluation."gateScores" ->> 'citationCoverage')::double precision >=
          (suite."definition" #>> '{spec,gates,citationCoverage}')::double precision
        THEN 'passed' ELSE 'failed' END,
      'sampleSize', 1,
      'evidenceSource', 'manifest_declaration',
      'detail', 'Migrated from immutable deterministic aggregate evidence.'
    ),
    jsonb_build_object(
      'key', 'unauthorized_actions',
      'category', 'contract',
      'operator', 'lte',
      'threshold', (suite."definition" #>> '{spec,gates,unauthorizedActions}')::double precision,
      'measuredValue', (evaluation."gateScores" ->> 'unauthorizedActions')::double precision,
      'status', CASE
        WHEN (evaluation."gateScores" ->> 'unauthorizedActions')::double precision <=
          (suite."definition" #>> '{spec,gates,unauthorizedActions}')::double precision
        THEN 'passed' ELSE 'failed' END,
      'sampleSize', 1,
      'evidenceSource', 'manifest_declaration',
      'detail', 'Migrated from immutable deterministic aggregate evidence.'
    )
  )
)
FROM "ResourceVersion" suite
WHERE suite."id" = evaluation."suiteVersionId";

ALTER TABLE "ReleaseEvaluation" ENABLE TRIGGER "ReleaseEvaluation_append_only";

DROP INDEX "ReleaseEvaluation_releaseId_suiteVersionId_suiteDigest_key";

CREATE UNIQUE INDEX "ReleaseEvaluation_evidence_snapshot_key"
  ON "ReleaseEvaluation"(
    "releaseId",
    "suiteVersionId",
    "suiteDigest",
    "executorKind",
    "executorVersion",
    "evaluationMode",
    "historySnapshotDigest"
  );

COMMIT;
