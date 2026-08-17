import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const CONFIRMATION = 'remove-invalid-attention-fixtures';
const args = new Map(
  process.argv.slice(2).map((argument) => {
    const separator = argument.indexOf('=');
    return separator === -1
      ? [argument, true]
      : [argument.slice(0, separator), argument.slice(separator + 1)];
  }),
);
const apply = args.has('--apply');

const localScopeSql = (alias) => `
  ${alias}."workspaceId" = '00000000-0000-4000-8000-000000000001'::uuid
  AND (
    ${alias}."departmentId" IS NULL
    OR ${alias}."departmentId" = '00000000-0000-4000-8000-000000000002'::uuid
  )
`;

const APPLY_MAXIMUM_TOTAL = 3_072;
const APPLY_MAXIMUMS = Object.freeze({
  actors: 64,
  approvalRequests: 128,
  attentionCursors: 128,
  attentionResolutions: 256,
  auditEvents: 512,
  dependencyPins: 128,
  digestAttempts: 256,
  digestSnapshots: 128,
  executionRunEvents: 512,
  executionRuns: 256,
  improvementCandidates: 128,
  memoryCandidates: 128,
  observations: 128,
  platformEvents: 512,
  releaseBundles: 64,
  releaseDeclines: 64,
  releaseEvaluations: 64,
  releaseResources: 96,
  resourceFamilies: 64,
  resourceVersions: 64,
  runSteps: 256,
});

function asJson(value) {
  return JSON.stringify(value, (_key, nested) =>
    typeof nested === 'bigint' ? nested.toString() : nested,
  );
}

function assertApplyBounds(counts) {
  const byCategory = new Map(
    counts.map(({ category, count }) => {
      const parsed = Number(count);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error(`Cleanup count for ${category} is not a safe non-negative integer.`);
      }
      return [category, parsed];
    }),
  );
  const resourceVersions = byCategory.get('resourceVersions') ?? 0;
  if (resourceVersions === 0) {
    throw new Error('Cleanup apply found no exact invalid Attention fixture fingerprints.');
  }
  for (const [category, maximum] of Object.entries(APPLY_MAXIMUMS)) {
    const count = byCategory.get(category) ?? 0;
    if (count > maximum) {
      throw new Error(
        `Cleanup apply count ${category}=${count} exceeds the reviewed maximum ${maximum}.`,
      );
    }
  }
  const total = [...byCategory.values()].reduce((sum, count) => sum + count, 0);
  if (total > APPLY_MAXIMUM_TOTAL) {
    throw new Error(
      `Cleanup apply total ${total} exceeds the reviewed maximum ${APPLY_MAXIMUM_TOTAL}.`,
    );
  }
  if ((byCategory.get('resourceFamilies') ?? 0) !== resourceVersions) {
    throw new Error('Cleanup apply expected one fixture family per invalid resource version.');
  }
  if ((byCategory.get('releaseResources') ?? 0) !== resourceVersions) {
    throw new Error('Cleanup apply expected every invalid resource version in one target release.');
  }
  if ((byCategory.get('releaseBundles') ?? 0) > resourceVersions) {
    throw new Error('Cleanup apply found more target releases than invalid resource versions.');
  }
}

async function verifyBackupAcknowledgement() {
  if (!apply) return null;
  if (args.get('--confirm') !== CONFIRMATION) {
    throw new Error(`Apply requires --confirm=${CONFIRMATION}.`);
  }
  const backupArgument = args.get('--backup-file');
  if (typeof backupArgument !== 'string' || backupArgument.trim().length === 0) {
    throw new Error('Apply requires --backup-file=<path-to-a-pg_dump-custom-archive>.');
  }
  const backupPath = path.resolve(backupArgument);
  const metadata = await stat(backupPath);
  if (!metadata.isFile() || metadata.size === 0) {
    throw new Error('The acknowledged backup must be a non-empty regular file.');
  }
  const header = Buffer.alloc(5);
  const handle = await open(backupPath, 'r');
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  if (header.toString('ascii') !== 'PGDMP') {
    throw new Error('The acknowledged backup is not a PostgreSQL custom-format archive.');
  }
  return { path: backupPath, bytes: metadata.size };
}

const createTargetsSql = `
  SELECT pg_advisory_xact_lock(hashtext('paul-os:cleanup-invalid-attention-fixtures'));

  CREATE TEMP TABLE cleanup_target_versions ON COMMIT DROP AS
  SELECT version."id", version."familyId"
  FROM "ResourceVersion" version
  JOIN "ResourceFamily" family ON family."id" = version."familyId"
  WHERE version."definition" = '{}'::jsonb
    AND family."workspaceId" = '00000000-0000-4000-8000-000000000001'::uuid
    AND (
      family."departmentId" IS NULL
      OR family."departmentId" = '00000000-0000-4000-8000-000000000002'::uuid
    )
    AND version."version" = '1.0.0'
    AND version."sourceCommit" = repeat('a', 40)
    AND version."provenance" = '{}'::jsonb
    AND version."dependencyPins" = '[]'::jsonb
    AND version."owner" = version."createdBy"
    AND version."updatedBy" = version."createdBy"
    AND family."createdBy" = version."createdBy"
    AND family."updatedBy" = version."createdBy"
    AND (
      (
        family."kind" = 'Skill'
        AND family."slug" = 'attention-entry-' || family."id"::text
        AND family."name" = 'Attention fixture entrypoint'
        AND version."purpose" = 'Provide an exact entrypoint for Attention integration runs.'
        AND version."createdBy" ~ '^human:(attention|global-resolution|digest-claim)-[0-9a-f-]{36}$'
        AND version."digest" = rpad(
          substr(encode(convert_to('entry-' || version."id"::text, 'UTF8'), 'hex'), 1, 64),
          64,
          '0'
        )
      )
      OR
      (
        family."kind" = 'EvaluationSuite'
        AND family."slug" = 'attention-suite-' || family."id"::text
        AND family."name" = 'Attention fixture suite'
        AND version."purpose" = 'Provide immutable passing evidence for the Attention integration test.'
        AND version."createdBy" ~ '^human:attention-[0-9a-f-]{36}$'
        AND version."digest" = rpad(
          substr(encode(convert_to('suite-' || version."id"::text, 'UTF8'), 'hex'), 1, 64),
          64,
          '0'
        )
      )
    );
  CREATE UNIQUE INDEX ON cleanup_target_versions ("id");

  CREATE TEMP TABLE cleanup_target_releases ON COMMIT DROP AS
  SELECT DISTINCT release."id", release."createdBy"
  FROM "ReleaseBundle" release
  JOIN "ReleaseResource" member ON member."releaseId" = release."id"
  JOIN cleanup_target_versions target ON target."id" = member."resourceVersionId"
  WHERE release."workspaceId" = '00000000-0000-4000-8000-000000000001'::uuid
    AND (
      release."departmentId" IS NULL
      OR release."departmentId" = '00000000-0000-4000-8000-000000000002'::uuid
    )
    AND release."projectId" ~ '^attention-[0-9a-f-]{36}$'
    AND release."createdBy" ~ '^human:(attention|global-resolution|digest-claim)-[0-9a-f-]{36}$'
    AND release."digest" = rpad(
      substr(encode(convert_to(release."id"::text, 'UTF8'), 'hex'), 1, 64),
      64,
      '0'
    );
  CREATE UNIQUE INDEX ON cleanup_target_releases ("id");

  CREATE TEMP TABLE cleanup_target_actors ON COMMIT DROP AS
  SELECT DISTINCT "createdBy" AS "actorId" FROM cleanup_target_releases;
  CREATE UNIQUE INDEX ON cleanup_target_actors ("actorId");

  CREATE TEMP TABLE cleanup_target_runs ON COMMIT DROP AS
  SELECT run."id", run."digestSnapshotId"
  FROM "ExecutionRun" run
  JOIN cleanup_target_releases release ON release."id" = run."releaseId";
  CREATE UNIQUE INDEX ON cleanup_target_runs ("id");

  CREATE TEMP TABLE cleanup_target_evaluations ON COMMIT DROP AS
  SELECT evaluation."id"
  FROM "ReleaseEvaluation" evaluation
  JOIN cleanup_target_releases release ON release."id" = evaluation."releaseId";
  CREATE UNIQUE INDEX ON cleanup_target_evaluations ("id");

  CREATE TEMP TABLE cleanup_target_snapshots ON COMMIT DROP AS
  SELECT DISTINCT snapshot."id"
  FROM "DigestSnapshot" snapshot
  WHERE ${localScopeSql('snapshot')}
    AND (
      snapshot."actorId" IN (SELECT "actorId" FROM cleanup_target_actors)
      OR snapshot."id" IN (
        SELECT "digestSnapshotId" FROM cleanup_target_runs WHERE "digestSnapshotId" IS NOT NULL
      )
    );
  CREATE UNIQUE INDEX ON cleanup_target_snapshots ("id");

  CREATE TEMP TABLE cleanup_target_observations ON COMMIT DROP AS
  SELECT observation."id"
  FROM "Observation" observation
  WHERE ${localScopeSql('observation')}
    AND observation."observedBy" IN (SELECT "actorId" FROM cleanup_target_actors);
  CREATE UNIQUE INDEX ON cleanup_target_observations ("id");

  CREATE TEMP TABLE cleanup_target_cursors ON COMMIT DROP AS
  SELECT attention_cursor."id"
  FROM "AttentionCursor" attention_cursor
  WHERE ${localScopeSql('attention_cursor')}
    AND attention_cursor."actorId" IN (SELECT "actorId" FROM cleanup_target_actors);
  CREATE UNIQUE INDEX ON cleanup_target_cursors ("id");

  CREATE TEMP TABLE cleanup_target_resolutions ON COMMIT DROP AS
  SELECT resolution."id"
  FROM "AttentionResolution" resolution
  WHERE ${localScopeSql('resolution')}
    AND (
      resolution."resolvedBy" IN (SELECT "actorId" FROM cleanup_target_actors)
      OR resolution."itemId" IN (SELECT 'stalled_run:' || "id"::text FROM cleanup_target_runs)
      OR resolution."itemId" IN (SELECT 'budget_stop:' || "id"::text FROM cleanup_target_runs)
    );
  CREATE UNIQUE INDEX ON cleanup_target_resolutions ("id");

  CREATE TEMP TABLE cleanup_target_platform_events ON COMMIT DROP AS
  SELECT event."id"
  FROM "PlatformEvent" event
  WHERE ${localScopeSql('event')}
    AND event."actorId" IN (SELECT "actorId" FROM cleanup_target_actors);
  CREATE UNIQUE INDEX ON cleanup_target_platform_events ("id");

  CREATE TEMP TABLE cleanup_target_audit_events ON COMMIT DROP AS
  SELECT audit."id"
  FROM "AuditEvent" audit
  WHERE ${localScopeSql('audit')}
    AND audit."actorId" IN (SELECT "actorId" FROM cleanup_target_actors);
  CREATE UNIQUE INDEX ON cleanup_target_audit_events ("id");
`;

const countSql = `
  SELECT category, count(*)::bigint AS count
  FROM (
    SELECT 'actors' AS category FROM cleanup_target_actors
    UNION ALL SELECT 'resourceVersions' FROM "ResourceVersion" WHERE "id" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'resourceFamilies' FROM "ResourceFamily" WHERE "id" IN (SELECT "familyId" FROM cleanup_target_versions)
    UNION ALL SELECT 'releaseBundles' FROM "ReleaseBundle" WHERE "id" IN (SELECT "id" FROM cleanup_target_releases)
    UNION ALL SELECT 'releaseResources' FROM "ReleaseResource" WHERE "releaseId" IN (SELECT "id" FROM cleanup_target_releases)
    UNION ALL SELECT 'releaseEvaluations' FROM "ReleaseEvaluation" WHERE "id" IN (SELECT "id" FROM cleanup_target_evaluations)
    UNION ALL SELECT 'releaseDeclines' FROM "ReleaseDeclineDecision" WHERE "releaseId" IN (SELECT "id" FROM cleanup_target_releases)
    UNION ALL SELECT 'executionRuns' FROM "ExecutionRun" WHERE "id" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'approvalRequests' FROM "ApprovalRequest" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'executionRunEvents' FROM "ExecutionRunEvent" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'runSteps' FROM "RunStep" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'memoryCandidates' FROM "MemoryCandidate" WHERE "sourceRunId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'digestSnapshots' FROM "DigestSnapshot" WHERE "id" IN (SELECT "id" FROM cleanup_target_snapshots)
    UNION ALL SELECT 'digestAttempts' FROM "DigestDeliveryAttempt"
      WHERE "snapshotId" IN (SELECT "id" FROM cleanup_target_snapshots)
         OR "briefingRunId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'attentionCursors' FROM "AttentionCursor" WHERE "id" IN (SELECT "id" FROM cleanup_target_cursors)
    UNION ALL SELECT 'attentionResolutions' FROM "AttentionResolution" WHERE "id" IN (SELECT "id" FROM cleanup_target_resolutions)
    UNION ALL SELECT 'observations' FROM "Observation" WHERE "id" IN (SELECT "id" FROM cleanup_target_observations)
    UNION ALL SELECT 'improvementCandidates' FROM "ImprovementCandidate" WHERE "observationId" IN (SELECT "id" FROM cleanup_target_observations)
    UNION ALL SELECT 'platformEvents' FROM "PlatformEvent" WHERE "id" IN (SELECT "id" FROM cleanup_target_platform_events)
    UNION ALL SELECT 'auditEvents' FROM "AuditEvent" WHERE "id" IN (SELECT "id" FROM cleanup_target_audit_events)
    UNION ALL SELECT 'dependencyPins' FROM "ResourceDependencyPin"
      WHERE "sourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)
         OR "targetVersionId" IN (SELECT "id" FROM cleanup_target_versions)
  ) targets
  GROUP BY category
  ORDER BY category;
`;

const blockerSql = `
  SELECT blocker, count(*)::bigint AS count
  FROM (
    SELECT 'release_contains_non_target_resource' AS blocker
    FROM "ReleaseResource" member
    WHERE member."releaseId" IN (SELECT "id" FROM cleanup_target_releases)
      AND member."resourceVersionId" NOT IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'family_contains_non_target_version'
    FROM "ResourceVersion" version
    WHERE version."familyId" IN (SELECT "familyId" FROM cleanup_target_versions)
      AND version."id" NOT IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_repository_import' FROM "RepositoryImport" WHERE "resourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_non_target_release_resource' FROM "ReleaseResource" WHERE "resourceVersionId" IN (SELECT "id" FROM cleanup_target_versions) AND "releaseId" NOT IN (SELECT "id" FROM cleanup_target_releases)
    UNION ALL SELECT 'target_version_non_target_evaluation' FROM "ReleaseEvaluation" WHERE "suiteVersionId" IN (SELECT "id" FROM cleanup_target_versions) AND "id" NOT IN (SELECT "id" FROM cleanup_target_evaluations)
    UNION ALL SELECT 'target_version_non_target_execution_run' FROM "ExecutionRun" WHERE "entryResourceVersionId" IN (SELECT "id" FROM cleanup_target_versions) AND "id" NOT IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'target_version_certification_run' FROM "CertificationRun" WHERE "subjectResourceVersionId" IN (SELECT "id" FROM cleanup_target_versions) OR "comparisonResourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_authority_grant' FROM "AuthorityGrant" WHERE "entryResourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_automation_schedule' FROM "AutomationSchedule" WHERE "entryResourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_builder_draft' FROM "BuilderDraft" WHERE "materializedResourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_capability_profile' FROM "CapabilityProfile" WHERE "resourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_catalog_publication' FROM "CatalogPublication" WHERE "resourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_deployment' FROM "Deployment" WHERE "deployedResourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_plugin_installation' FROM "PluginInstallation" WHERE "pluginVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_plugin_invocation' FROM "PluginInvocation" WHERE "pluginVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_resource_lineage' FROM "ResourceLineage" WHERE "childResourceVersionId" IN (SELECT "id" FROM cleanup_target_versions) OR "parentResourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'target_version_plugin_requirement' FROM "RunPluginRequirement" WHERE "pluginVersionId" IN (SELECT "id" FROM cleanup_target_versions)
    UNION ALL SELECT 'dependency_pin_crosses_target_boundary' FROM "ResourceDependencyPin"
      WHERE ("sourceVersionId" IN (SELECT "id" FROM cleanup_target_versions)) <> ("targetVersionId" IN (SELECT "id" FROM cleanup_target_versions))
    UNION ALL SELECT 'target_release_authority_grant' FROM "AuthorityGrant" WHERE "releaseId" IN (SELECT "id" FROM cleanup_target_releases)
    UNION ALL SELECT 'target_release_automation_schedule' FROM "AutomationSchedule" WHERE "releaseId" IN (SELECT "id" FROM cleanup_target_releases)
    UNION ALL SELECT 'target_release_catalog_publication' FROM "CatalogPublication" WHERE "releaseId" IN (SELECT "id" FROM cleanup_target_releases)
    UNION ALL SELECT 'target_release_production_channel' FROM "ProductionChannel" WHERE "currentReleaseId" IN (SELECT "id" FROM cleanup_target_releases) OR "priorReleaseId" IN (SELECT "id" FROM cleanup_target_releases)
    UNION ALL SELECT 'target_release_promotion_decision' FROM "ReleasePromotionDecision" WHERE "releaseId" IN (SELECT "id" FROM cleanup_target_releases) OR "previousReleaseId" IN (SELECT "id" FROM cleanup_target_releases)
    UNION ALL SELECT 'target_run_has_authority_grant' FROM "ExecutionRun" WHERE "id" IN (SELECT "id" FROM cleanup_target_runs) AND "authorityGrantId" IS NOT NULL
    UNION ALL SELECT 'target_run_automation_dispatch' FROM "AutomationDispatch" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'target_run_metric_sample' FROM "MetricSample" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'target_run_observation' FROM "Observation" WHERE "sourceRunId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'target_run_outcome' FROM "OutcomeRecord" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'target_run_plugin_invocation' FROM "PluginInvocation" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'target_run_plugin_plan' FROM "RunPluginCallPlan" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'target_run_plugin_requirement' FROM "RunPluginRequirement" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'target_evaluation_catalog_publication' FROM "CatalogPublication" WHERE "activationEvaluationId" IN (SELECT "id" FROM cleanup_target_evaluations)
    UNION ALL SELECT 'target_evaluation_promotion_decision' FROM "ReleasePromotionDecision" WHERE "evaluationId" IN (SELECT "id" FROM cleanup_target_evaluations)
    UNION ALL SELECT 'target_observation_builder_decision' FROM "BuilderDecision" WHERE "demandObservationId" IN (SELECT "id" FROM cleanup_target_observations)
    UNION ALL SELECT 'target_improvement_repository_import' FROM "RepositoryImport" WHERE "improvementCandidateId" IN (SELECT "id" FROM "ImprovementCandidate" WHERE "observationId" IN (SELECT "id" FROM cleanup_target_observations))
    UNION ALL SELECT 'target_snapshot_non_target_run' FROM "ExecutionRun" WHERE "digestSnapshotId" IN (SELECT "id" FROM cleanup_target_snapshots) AND "id" NOT IN (SELECT "id" FROM cleanup_target_runs)
    UNION ALL SELECT 'target_audit_promotion_decision' FROM "PromotionDecision" WHERE "auditEventId" IN (SELECT "id" FROM cleanup_target_audit_events)
    UNION ALL SELECT 'user_trigger_not_ordinary_enabled'
    FROM pg_catalog.pg_trigger database_trigger
    JOIN pg_catalog.pg_class relation ON relation.oid = database_trigger.tgrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE NOT database_trigger.tgisinternal
      AND namespace.nspname = current_schema()
      AND relation.relname IN (
        'AttentionCursor', 'AttentionResolution', 'AuditEvent', 'DigestDeliveryAttempt',
        'DigestSnapshot', 'ExecutionRun', 'ExecutionRunEvent', 'ImprovementCandidate',
        'MemoryCandidate', 'Observation', 'PlatformEvent', 'ReleaseBundle',
        'ReleaseDeclineDecision', 'ReleaseEvaluation', 'ReleaseResource',
        'ResourceFamily', 'ResourceVersion'
      )
      AND database_trigger.tgenabled <> 'O'
  ) blockers
  GROUP BY blocker
  ORDER BY blocker;
`;

const triggerTables = [
  'AttentionCursor',
  'AttentionResolution',
  'AuditEvent',
  'DigestDeliveryAttempt',
  'DigestSnapshot',
  'ExecutionRun',
  'ExecutionRunEvent',
  'ImprovementCandidate',
  'MemoryCandidate',
  'Observation',
  'PlatformEvent',
  'ReleaseBundle',
  'ReleaseDeclineDecision',
  'ReleaseEvaluation',
  'ReleaseResource',
  'ResourceFamily',
  'ResourceVersion',
];

async function prepareTargets(transaction) {
  const [advisoryLock, ...targetStatements] = createTargetsSql
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  await transaction.$executeRawUnsafe(advisoryLock);
  for (const statement of targetStatements) {
    await transaction.$executeRawUnsafe(statement);
  }
  const counts = await transaction.$queryRawUnsafe(countSql);
  const blockers = await transaction.$queryRawUnsafe(blockerSql);
  return { counts, blockers };
}

async function deleteTargets(transaction) {
  const triggerTableList = triggerTables.map((table) => `"${table}"`).join(', ');
  await transaction.$executeRawUnsafe(`LOCK TABLE ${triggerTableList} IN ACCESS EXCLUSIVE MODE`);
  const nonOrdinaryTriggers = await transaction.$queryRawUnsafe(`
    SELECT relation.relname AS "tableName", database_trigger.tgname AS "triggerName", database_trigger.tgenabled AS state
    FROM pg_catalog.pg_trigger database_trigger
    JOIN pg_catalog.pg_class relation ON relation.oid = database_trigger.tgrelid
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE NOT database_trigger.tgisinternal
      AND namespace.nspname = current_schema()
      AND relation.relname IN (${triggerTables.map((table) => `'${table}'`).join(', ')})
      AND database_trigger.tgenabled <> 'O'
    ORDER BY relation.relname, database_trigger.tgname
  `);
  if (nonOrdinaryTriggers.length > 0) {
    throw new Error(
      `Cleanup apply requires every affected USER trigger to be ordinarily enabled: ${asJson(nonOrdinaryTriggers)}`,
    );
  }
  for (const table of triggerTables) {
    await transaction.$executeRawUnsafe(`ALTER TABLE "${table}" DISABLE TRIGGER USER`);
  }
  const deleted = {};
  const remove = async (category, sql) => {
    deleted[category] = await transaction.$executeRawUnsafe(sql);
  };
  await remove(
    'digestAttempts',
    `DELETE FROM "DigestDeliveryAttempt" WHERE "snapshotId" IN (SELECT "id" FROM cleanup_target_snapshots) OR "briefingRunId" IN (SELECT "id" FROM cleanup_target_runs)`,
  );
  await remove(
    'approvalRequests',
    `DELETE FROM "ApprovalRequest" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)`,
  );
  await remove(
    'executionRunEvents',
    `DELETE FROM "ExecutionRunEvent" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)`,
  );
  await remove(
    'runSteps',
    `DELETE FROM "RunStep" WHERE "runId" IN (SELECT "id" FROM cleanup_target_runs)`,
  );
  await remove(
    'memoryCandidates',
    `DELETE FROM "MemoryCandidate" WHERE "sourceRunId" IN (SELECT "id" FROM cleanup_target_runs)`,
  );
  await remove(
    'attentionResolutions',
    `DELETE FROM "AttentionResolution" WHERE "id" IN (SELECT "id" FROM cleanup_target_resolutions)`,
  );
  await remove(
    'platformEvents',
    `DELETE FROM "PlatformEvent" WHERE "id" IN (SELECT "id" FROM cleanup_target_platform_events)`,
  );
  await remove(
    'auditEvents',
    `DELETE FROM "AuditEvent" WHERE "id" IN (SELECT "id" FROM cleanup_target_audit_events)`,
  );
  await remove(
    'improvementCandidates',
    `DELETE FROM "ImprovementCandidate" WHERE "observationId" IN (SELECT "id" FROM cleanup_target_observations)`,
  );
  await remove(
    'observations',
    `DELETE FROM "Observation" WHERE "id" IN (SELECT "id" FROM cleanup_target_observations)`,
  );
  await remove(
    'executionRuns',
    `DELETE FROM "ExecutionRun" WHERE "id" IN (SELECT "id" FROM cleanup_target_runs)`,
  );
  await remove(
    'digestSnapshots',
    `DELETE FROM "DigestSnapshot" WHERE "id" IN (SELECT "id" FROM cleanup_target_snapshots)`,
  );
  await remove(
    'attentionCursors',
    `DELETE FROM "AttentionCursor" WHERE "id" IN (SELECT "id" FROM cleanup_target_cursors)`,
  );
  await remove(
    'releaseDeclines',
    `DELETE FROM "ReleaseDeclineDecision" WHERE "releaseId" IN (SELECT "id" FROM cleanup_target_releases)`,
  );
  await remove(
    'releaseEvaluations',
    `DELETE FROM "ReleaseEvaluation" WHERE "id" IN (SELECT "id" FROM cleanup_target_evaluations)`,
  );
  await remove(
    'dependencyPins',
    `DELETE FROM "ResourceDependencyPin" WHERE "sourceVersionId" IN (SELECT "id" FROM cleanup_target_versions) OR "targetVersionId" IN (SELECT "id" FROM cleanup_target_versions)`,
  );
  await remove(
    'releaseResources',
    `DELETE FROM "ReleaseResource" WHERE "releaseId" IN (SELECT "id" FROM cleanup_target_releases)`,
  );
  await remove(
    'releaseBundles',
    `DELETE FROM "ReleaseBundle" WHERE "id" IN (SELECT "id" FROM cleanup_target_releases)`,
  );
  await remove(
    'resourceVersions',
    `DELETE FROM "ResourceVersion" WHERE "id" IN (SELECT "id" FROM cleanup_target_versions)`,
  );
  await remove(
    'resourceFamilies',
    `DELETE FROM "ResourceFamily" WHERE "id" IN (SELECT "familyId" FROM cleanup_target_versions)`,
  );
  for (const table of [...triggerTables].reverse()) {
    await transaction.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE TRIGGER USER`);
  }
  return deleted;
}

const backup = await verifyBackupAcknowledgement();
if (typeof process.env.DATABASE_URL !== 'string' || process.env.DATABASE_URL.length === 0) {
  throw new Error('DATABASE_URL is required.');
}

const prisma = new PrismaClient();
try {
  const result = await prisma.$transaction(
    async (transaction) => {
      const before = await prepareTargets(transaction);
      if (before.blockers.length > 0) {
        throw new Error(
          `Cleanup preflight found unsupported references: ${asJson(before.blockers)}`,
        );
      }
      if (!apply) return { mode: 'dry-run', before };
      assertApplyBounds(before.counts);
      const deleted = await deleteTargets(transaction);
      const remaining = (await transaction.$queryRawUnsafe(countSql)).filter(
        ({ category }) => category !== 'actors',
      );
      return { mode: 'apply', backup, before, deleted, remaining };
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
  process.stdout.write(`${asJson(result)}\n`);
} finally {
  await prisma.$disconnect();
}
