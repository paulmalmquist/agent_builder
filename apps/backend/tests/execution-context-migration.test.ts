import { readFile } from 'node:fs/promises';
import path from 'node:path';

const migrationPath = path.resolve(
  process.cwd(),
  'prisma',
  'migrations',
  '20260820000000_execution_context_binding',
  'migration.sql',
);

describe('execution context migration safety contract', () => {
  it('fails unfinished legacy runs and conservatively settles stranded reservations', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain("jsonb_build_object('code', 'EXECUTION_CONTEXT_SNAPSHOT_MISSING')");
    expect(sql).toContain('THEN \'failed\'::"ExecutionRunState"');
    expect(sql).toContain('SET "spentCostUsd" = "spentCostUsd" + "reservedCostUsd"');
    expect(sql).toContain('"reservedCostUsd" = 0');
    expect(sql.indexOf('"reservedCostUsd" = 0')).toBeLessThan(
      sql.indexOf('ALTER TABLE "AuthorityGrant" ALTER COLUMN "contextDigest" SET NOT NULL'),
    );
  });

  it('installs database-level immutability for run summaries and grant digests', async () => {
    const sql = await readFile(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TRIGGER "AuthorityGrant_context_binding_immutable"');
    expect(sql).toContain('CREATE TRIGGER "ExecutionRun_context_binding_immutable"');
    expect(sql).toContain("RAISE EXCEPTION 'Authority context digest is immutable'");
    expect(sql).toContain("RAISE EXCEPTION 'Execution context summary is immutable'");
  });
});
