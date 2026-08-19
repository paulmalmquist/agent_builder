-- Temporary compatibility adapter: mirror legacy Agent Builder writes into the universal registry.
-- Remove these functions and triggers with the /agents API at the M5 sunset. Legacy mirrors are
-- deliberately stamped unverified and can never certify or enter a production channel.

BEGIN;

-- This matches packages/runtime canonicalJson for the bounded ASCII-key manifests emitted below.
-- Keeping the function in the migration lets compatibility rows use the same digest contract as
-- Git-authored definitions without letting a trigger invoke application code.
CREATE FUNCTION "canonical_jsonb_text"("input_value" JSONB)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  result TEXT;
BEGIN
  CASE jsonb_typeof("input_value")
    WHEN 'object' THEN
      SELECT '{' || COALESCE(
        string_agg(
          to_jsonb(object_key)::text || ':' || "canonical_jsonb_text"("input_value" -> object_key),
          ',' ORDER BY object_key
        ),
        ''
      ) || '}'
      INTO result
      FROM jsonb_object_keys("input_value") AS keys(object_key);
    WHEN 'array' THEN
      SELECT '[' || COALESCE(
        string_agg("canonical_jsonb_text"(element), ',' ORDER BY ordinal),
        ''
      ) || ']'
      INTO result
      FROM jsonb_array_elements("input_value") WITH ORDINALITY AS items(element, ordinal);
    ELSE
      result := "input_value"::text;
  END CASE;
  RETURN result;
END;
$$;

CREATE FUNCTION "legacy_agent_definition"("targetAgentId" UUID)
RETURNS JSONB
LANGUAGE sql
VOLATILE
AS $$
  SELECT jsonb_build_object(
    'apiVersion', 'paul-os/v1',
    'kind', 'Agent',
    'metadata', jsonb_build_object(
      'id', agent."familyId",
      'slug', family."slug",
      'version', agent."versionNumber"::text || '.0.0',
      'name', agent."name",
      'owner', agent."owner",
      'purpose', agent."purpose",
      'lifecycle', CASE agent."status"::text
        WHEN 'certified' THEN 'candidate'
        WHEN 'active' THEN 'candidate'
        WHEN 'rejected' THEN 'deprecated'
        WHEN 'retired' THEN 'deprecated'
        ELSE 'experimental'
      END,
      'provenance', jsonb_build_object(
        'source', 'legacy-agent-compatibility-adapter',
        'verified', false,
        'legacyAgentId', agent."id"
      )
    ),
    'dependencies', '[]'::jsonb,
    'spec', jsonb_build_object(
      'objective', agent."purpose",
      'skills', jsonb_build_array('legacy-agent-capability@1.0.0'),
      'protocols', jsonb_build_array('safe-execution@1.0.0'),
      'contextPolicy', 'default-context@1.0.0',
      'knowledgeSources', '[]'::jsonb,
      'tools', '[]'::jsonb,
      'triggers', '[]'::jsonb,
      'executionLoop', jsonb_build_object(
        'maximumSteps', 25,
        'onUnresolved', 'fail_closed',
        'outputContract', 'legacy-agent-output@1.0.0'
      ),
      'memoryPolicy', jsonb_build_object(
        'reads', 'accepted_only',
        'writes', 'staged_for_human_acceptance'
      ),
      'production', jsonb_build_object(
        'requiresImmutableRelease', true,
        'authorityClass', 'legacy-compatibility-no-production'
      ),
      'legacyCompatibility', jsonb_build_object(
        'agentId', agent."id",
        'department', agent."department",
        'specificationRevision', spec."revision",
        'sectionDigests', jsonb_build_object(
          'outcomes', CASE WHEN spec."outcomes" IS NULL THEN NULL ELSE encode(
            digest(convert_to("canonical_jsonb_text"(spec."outcomes"), 'UTF8'), 'sha256'), 'hex'
          ) END,
          'knowledge', CASE WHEN spec."knowledge" IS NULL THEN NULL ELSE encode(
            digest(convert_to("canonical_jsonb_text"(spec."knowledge"), 'UTF8'), 'sha256'), 'hex'
          ) END,
          'guardrails', CASE WHEN spec."guardrails" IS NULL THEN NULL ELSE encode(
            digest(convert_to("canonical_jsonb_text"(spec."guardrails"), 'UTF8'), 'sha256'), 'hex'
          ) END,
          'outputs', CASE WHEN spec."outputs" IS NULL THEN NULL ELSE encode(
            digest(convert_to("canonical_jsonb_text"(spec."outputs"), 'UTF8'), 'sha256'), 'hex'
          ) END
        ),
        'capabilitiesDigest', encode(
          digest(convert_to("canonical_jsonb_text"(agent."capabilities"), 'UTF8'), 'sha256'), 'hex'
        ),
        'manifestDigest', CASE WHEN agent."manifest" IS NULL THEN NULL ELSE encode(
          digest(convert_to("canonical_jsonb_text"(agent."manifest"), 'UTF8'), 'sha256'), 'hex'
        ) END
      )
    )
  )
  FROM "Agent" agent
  JOIN "AgentFamily" family ON family."id" = agent."familyId"
  LEFT JOIN "AgentSpec" spec ON spec."agentId" = agent."id"
  WHERE agent."id" = "targetAgentId"
$$;

-- Normalize the original M2 backfill. It predated strict kind schemas and generic release
-- governance, so its Agent JSON and lifecycle labels are not suitable as production authority.
ALTER TABLE "ResourceVersion" DISABLE TRIGGER "ResourceVersion_frozen_definition";

WITH snapshots AS (
  SELECT
    version."id",
    agent."familyId",
    agent."versionNumber"::text || '.0.0' AS version_number,
    agent."owner",
    agent."purpose",
    agent."updatedBy",
    "legacy_agent_definition"(agent."id") AS definition,
    (CASE agent."status"::text
      WHEN 'certified' THEN 'candidate'
      WHEN 'active' THEN 'candidate'
      WHEN 'rejected' THEN 'deprecated'
      WHEN 'retired' THEN 'deprecated'
      ELSE 'experimental'
    END)::"ResourceLifecycle" AS lifecycle
  FROM "ResourceVersion" version
  JOIN "Agent" agent ON agent."id" = version."legacyAgentId"
)
UPDATE "ResourceVersion" version
SET "familyId" = snapshots."familyId",
    "version" = snapshots.version_number,
    "lifecycle" = snapshots.lifecycle,
    "owner" = snapshots."owner",
    "purpose" = snapshots."purpose",
    "definition" = snapshots.definition,
    "digest" = encode(
      digest(convert_to("canonical_jsonb_text"(snapshots.definition), 'UTF8'), 'sha256'),
      'hex'
    ),
    "sourceCommit" = 'legacy-unverified',
    "provenance" = jsonb_build_object(
      'source', 'legacy-agent-compatibility-adapter',
      'verified', false,
      'digestAlgorithm', 'canonical-json-sha256-v1'
    ),
    "dependencyPins" = '[]'::jsonb,
    "revision" = version."revision" + 1,
    "frozenAt" = CASE WHEN snapshots.lifecycle = 'experimental' THEN NULL ELSE NOW() END,
    "updatedBy" = snapshots."updatedBy",
    "updatedAt" = NOW()
FROM snapshots
WHERE version."id" = snapshots."id";

ALTER TABLE "ResourceVersion" ENABLE TRIGGER "ResourceVersion_frozen_definition";

CREATE FUNCTION "sync_legacy_agent_resource"("targetAgentId" UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  agent_record "Agent"%ROWTYPE;
  family_record "AgentFamily"%ROWTYPE;
  snapshot_definition JSONB;
  desired_digest TEXT;
  existing_digest TEXT;
  existing_lifecycle "ResourceLifecycle";
  desired_lifecycle "ResourceLifecycle";
BEGIN
  SELECT * INTO agent_record FROM "Agent" WHERE "id" = "targetAgentId";
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO STRICT family_record FROM "AgentFamily" WHERE "id" = agent_record."familyId";

  IF EXISTS (
    SELECT 1 FROM "ResourceFamily"
    WHERE "id" = family_record."id"
      AND ("kind" <> 'Agent'::"ResourceKind" OR "slug" <> family_record."slug")
  ) THEN
    RAISE EXCEPTION 'Legacy family identity conflicts with an existing registry family';
  END IF;

  snapshot_definition := "legacy_agent_definition"("targetAgentId");
  desired_digest := encode(
    digest(convert_to("canonical_jsonb_text"(snapshot_definition), 'UTF8'), 'sha256'),
    'hex'
  );
  desired_lifecycle := CASE agent_record."status"::text
    WHEN 'certified' THEN 'candidate'::"ResourceLifecycle"
    WHEN 'active' THEN 'candidate'::"ResourceLifecycle"
    WHEN 'rejected' THEN 'deprecated'::"ResourceLifecycle"
    WHEN 'retired' THEN 'deprecated'::"ResourceLifecycle"
    ELSE 'experimental'::"ResourceLifecycle"
  END;

  INSERT INTO "ResourceFamily" (
    "id", "kind", "slug", "name", "createdBy", "updatedBy", "createdAt", "updatedAt"
  ) VALUES (
    family_record."id", 'Agent', family_record."slug", family_record."name",
    family_record."createdBy", agent_record."updatedBy", family_record."createdAt", NOW()
  )
  ON CONFLICT ("id") DO UPDATE SET
    "name" = EXCLUDED."name",
    "updatedBy" = EXCLUDED."updatedBy",
    "updatedAt" = NOW();

  SELECT "lifecycle", "digest" INTO existing_lifecycle, existing_digest
  FROM "ResourceVersion"
  WHERE "legacyAgentId" = agent_record."id";

  IF NOT FOUND THEN
    INSERT INTO "ResourceVersion" (
      "id", "familyId", "legacyAgentId", "version", "lifecycle", "owner", "purpose",
      "definition", "digest", "sourceCommit", "provenance", "dependencyPins", "revision",
      "frozenAt", "createdBy", "updatedBy", "createdAt", "updatedAt"
    ) VALUES (
      agent_record."id", agent_record."familyId", agent_record."id",
      agent_record."versionNumber"::text || '.0.0', desired_lifecycle,
      agent_record."owner", agent_record."purpose", snapshot_definition, desired_digest,
      'legacy-unverified',
      jsonb_build_object(
        'source', 'legacy-agent-compatibility-adapter',
        'verified', false,
        'digestAlgorithm', 'canonical-json-sha256-v1'
      ),
      '[]'::jsonb, 1,
      CASE WHEN desired_lifecycle = 'experimental' THEN NULL ELSE NOW() END,
      agent_record."createdBy", agent_record."updatedBy", agent_record."createdAt", NOW()
    );
  ELSE
    IF existing_lifecycle = 'experimental' AND existing_digest IS DISTINCT FROM desired_digest THEN
      UPDATE "ResourceVersion"
      SET "owner" = agent_record."owner",
          "purpose" = agent_record."purpose",
          "definition" = snapshot_definition,
          "digest" = desired_digest,
          "revision" = "revision" + 1,
          "updatedBy" = agent_record."updatedBy",
          "updatedAt" = NOW()
      WHERE "legacyAgentId" = agent_record."id";
    END IF;

    -- A legacy certification freezes a candidate snapshot. It does not mint universal
    -- certification; retirement may only deprecate that already-frozen snapshot.
    IF desired_lifecycle <> 'experimental' AND existing_lifecycle < desired_lifecycle THEN
      UPDATE "ResourceVersion"
      SET "lifecycle" = desired_lifecycle,
          "frozenAt" = COALESCE("frozenAt", NOW()),
          "updatedBy" = agent_record."updatedBy",
          "updatedAt" = NOW()
      WHERE "legacyAgentId" = agent_record."id";
    END IF;
  END IF;
END;
$$;

CREATE FUNCTION "sync_legacy_agent_trigger"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "sync_legacy_agent_resource"(NEW."id");
  RETURN NEW;
END;
$$;

CREATE FUNCTION "protect_legacy_agent_identity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ResourceVersion" WHERE "legacyAgentId" = OLD."id") AND (
    NEW."familyId" IS DISTINCT FROM OLD."familyId"
    OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber"
    OR NEW."slug" IS DISTINCT FROM OLD."slug"
  ) THEN
    RAISE EXCEPTION 'Mirrored legacy agent identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Agent_registry_identity_guard"
  BEFORE UPDATE OF "familyId", "versionNumber", "slug"
  ON "Agent"
  FOR EACH ROW EXECUTE FUNCTION "protect_legacy_agent_identity"();

CREATE FUNCTION "protect_frozen_legacy_agent_content"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ResourceVersion"
    WHERE "legacyAgentId" = OLD."id" AND "lifecycle" <> 'experimental'
  ) AND (
    NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."department" IS DISTINCT FROM OLD."department"
    OR NEW."purpose" IS DISTINCT FROM OLD."purpose"
    OR NEW."owner" IS DISTINCT FROM OLD."owner"
    OR NEW."capabilities" IS DISTINCT FROM OLD."capabilities"
    OR NEW."manifest" IS DISTINCT FROM OLD."manifest"
  ) THEN
    RAISE EXCEPTION 'The source of a frozen legacy candidate is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "Agent_registry_frozen_content_guard"
  BEFORE UPDATE OF "name", "department", "purpose", "owner", "capabilities", "manifest"
  ON "Agent"
  FOR EACH ROW EXECUTE FUNCTION "protect_frozen_legacy_agent_content"();

CREATE TRIGGER "Agent_registry_compatibility_sync"
  AFTER INSERT OR UPDATE OF "name", "department", "purpose", "owner", "status", "capabilities", "manifest", "updatedBy"
  ON "Agent"
  FOR EACH ROW EXECUTE FUNCTION "sync_legacy_agent_trigger"();

CREATE FUNCTION "sync_legacy_family_trigger"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  agent_id UUID;
BEGIN
  IF NEW."slug" IS DISTINCT FROM OLD."slug" AND EXISTS (
    SELECT 1 FROM "ResourceVersion" WHERE "familyId" = OLD."id" AND "legacyAgentId" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Mirrored legacy family slug is immutable';
  END IF;

  UPDATE "ResourceFamily"
  SET "name" = NEW."name", "updatedBy" = NEW."updatedBy", "updatedAt" = NOW()
  WHERE "id" = NEW."id" AND "kind" = 'Agent'::"ResourceKind";

  FOR agent_id IN SELECT "id" FROM "Agent" WHERE "familyId" = NEW."id" LOOP
    PERFORM "sync_legacy_agent_resource"(agent_id);
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "AgentFamily_registry_compatibility_sync"
  AFTER UPDATE OF "name", "slug", "updatedBy"
  ON "AgentFamily"
  FOR EACH ROW EXECUTE FUNCTION "sync_legacy_family_trigger"();

CREATE FUNCTION "sync_legacy_spec_trigger"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM "sync_legacy_agent_resource"(CASE WHEN TG_OP = 'DELETE' THEN OLD."agentId" ELSE NEW."agentId" END);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION "protect_frozen_legacy_spec_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ResourceVersion"
    WHERE "legacyAgentId" = OLD."agentId" AND "lifecycle" <> 'experimental'
  ) THEN
    RAISE EXCEPTION 'The spec behind a frozen legacy candidate is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER "AgentSpec_registry_compatibility_sync"
  AFTER INSERT OR UPDATE OF "status", "revision", "outcomes", "knowledge", "guardrails", "outputs", "updatedBy"
  ON "AgentSpec"
  FOR EACH ROW EXECUTE FUNCTION "sync_legacy_spec_trigger"();

CREATE TRIGGER "AgentSpec_registry_delete_guard"
  BEFORE DELETE ON "AgentSpec"
  FOR EACH ROW EXECUTE FUNCTION "protect_frozen_legacy_spec_mutation"();

CREATE TRIGGER "AgentSpec_registry_update_guard"
  BEFORE UPDATE OF "status", "revision", "outcomes", "knowledge", "guardrails", "outputs"
  ON "AgentSpec"
  FOR EACH ROW EXECUTE FUNCTION "protect_frozen_legacy_spec_mutation"();

CREATE TRIGGER "AgentSpec_registry_delete_sync"
  AFTER DELETE ON "AgentSpec"
  FOR EACH ROW EXECUTE FUNCTION "sync_legacy_spec_trigger"();

CREATE FUNCTION "link_certification_resource_versions"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_subject UUID;
  expected_comparison UUID;
  subject_family UUID;
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW."agentVersionId" IS DISTINCT FROM OLD."agentVersionId"
    OR NEW."championVersionId" IS DISTINCT FROM OLD."championVersionId"
    OR NEW."familyId" IS DISTINCT FROM OLD."familyId"
    OR NEW."subjectResourceVersionId" IS DISTINCT FROM OLD."subjectResourceVersionId"
    OR NEW."comparisonResourceVersionId" IS DISTINCT FROM OLD."comparisonResourceVersionId"
  ) THEN
    RAISE EXCEPTION 'Certification run lineage is immutable';
  END IF;

  SELECT "id", "familyId" INTO expected_subject, subject_family
  FROM "ResourceVersion" WHERE "legacyAgentId" = NEW."agentVersionId";
  IF expected_subject IS NULL THEN
    RAISE EXCEPTION 'Certification subject has no registry mirror';
  END IF;
  IF subject_family IS DISTINCT FROM NEW."familyId" THEN
    RAISE EXCEPTION 'Certification subject registry family mismatch';
  END IF;
  IF NEW."subjectResourceVersionId" IS NOT NULL
     AND NEW."subjectResourceVersionId" IS DISTINCT FROM expected_subject THEN
    RAISE EXCEPTION 'Certification subject resource lineage mismatch';
  END IF;
  NEW."subjectResourceVersionId" := expected_subject;

  IF NEW."championVersionId" IS NULL THEN
    IF NEW."comparisonResourceVersionId" IS NOT NULL THEN
      RAISE EXCEPTION 'Certification comparison requires a champion version';
    END IF;
    NEW."comparisonResourceVersionId" := NULL;
  ELSE
    SELECT "id" INTO expected_comparison
    FROM "ResourceVersion"
    WHERE "legacyAgentId" = NEW."championVersionId" AND "familyId" = NEW."familyId";
    IF expected_comparison IS NULL THEN
      RAISE EXCEPTION 'Certification champion has no matching registry mirror';
    END IF;
    IF NEW."comparisonResourceVersionId" IS NOT NULL
       AND NEW."comparisonResourceVersionId" IS DISTINCT FROM expected_comparison THEN
      RAISE EXCEPTION 'Certification comparison resource lineage mismatch';
    END IF;
    NEW."comparisonResourceVersionId" := expected_comparison;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CertificationRun_resource_version_link"
  BEFORE INSERT OR UPDATE OF "agentVersionId", "championVersionId", "familyId", "subjectResourceVersionId", "comparisonResourceVersionId"
  ON "CertificationRun"
  FOR EACH ROW EXECUTE FUNCTION "link_certification_resource_versions"();

COMMIT;
