BEGIN;

DROP TRIGGER "RepositoryImport_append_only" ON "RepositoryImport";

CREATE OR REPLACE FUNCTION protect_repository_import_evidence()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."improvementCandidateId" IS NULL
     AND NEW."improvementCandidateId" IS NOT NULL
     AND (to_jsonb(NEW) - 'improvementCandidateId')
       IS NOT DISTINCT FROM (to_jsonb(OLD) - 'improvementCandidateId') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION '% is immutable', TG_TABLE_NAME
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "RepositoryImport_append_only"
  BEFORE UPDATE OR DELETE ON "RepositoryImport"
  FOR EACH ROW EXECUTE FUNCTION protect_repository_import_evidence();

COMMIT;
