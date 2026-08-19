BEGIN;

ALTER TABLE "RepositoryImport"
ADD COLUMN "improvementCandidateId" UUID;

CREATE INDEX "RepositoryImport_improvementCandidateId_idx"
ON "RepositoryImport"("improvementCandidateId");

ALTER TABLE "RepositoryImport"
ADD CONSTRAINT "RepositoryImport_improvementCandidateId_fkey"
FOREIGN KEY ("improvementCandidateId") REFERENCES "ImprovementCandidate"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_repository_import_candidate_lineage()
RETURNS trigger AS $$
DECLARE
  candidate_state "ImprovementCandidateState";
  candidate_target TEXT;
  expected_target TEXT;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."improvementCandidateId" IS NOT NULL
     AND NEW."improvementCandidateId" IS DISTINCT FROM OLD."improvementCandidateId" THEN
    RAISE EXCEPTION 'Repository import improvement-candidate lineage is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."improvementCandidateId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "state", "proposedTarget"
  INTO candidate_state, candidate_target
  FROM "ImprovementCandidate"
  WHERE "id" = NEW."improvementCandidateId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Linked improvement candidate does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF candidate_state <> 'incubating'::"ImprovementCandidateState" THEN
    RAISE EXCEPTION 'Only incubating improvement candidates may be linked to repository imports'
      USING ERRCODE = '23514';
  END IF;

  expected_target := CONCAT(
    NEW."manifestSnapshot" ->> 'kind',
    ':',
    NEW."manifestSnapshot" -> 'metadata' ->> 'slug',
    '@',
    NEW."manifestSnapshot" -> 'metadata' ->> 'version'
  );

  IF candidate_target IS DISTINCT FROM expected_target THEN
    RAISE EXCEPTION 'Improvement candidate target does not match imported resource kind, slug, and version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RepositoryImport_candidate_lineage_guard"
BEFORE INSERT OR UPDATE OF "improvementCandidateId" ON "RepositoryImport"
FOR EACH ROW EXECUTE FUNCTION enforce_repository_import_candidate_lineage();

COMMIT;
