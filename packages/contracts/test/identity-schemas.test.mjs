import assert from 'node:assert/strict';
import test from 'node:test';
import { entraGroupMappingConfigSchema } from '../dist/identity-schemas.js';

const base = {
  schemaVersion: 'entra-group-mapping/v1',
  issuer: 'https://login.example.test/tenant/v2.0',
  workspaceId: '10000000-0000-4000-8000-000000000001',
  mode: 'provisioning_only',
  authoritySource: 'database_role_bindings',
  mappings: [
    {
      groupObjectId: '20000000-0000-4000-8000-000000000002',
      role: 'builder',
      departmentId: '30000000-0000-4000-8000-000000000003',
    },
    {
      groupObjectId: '40000000-0000-4000-8000-000000000004',
      role: 'admin',
      departmentId: null,
    },
  ],
};

test('Entra group mappings are provisioning-only and DB-authoritative', () => {
  assert.equal(entraGroupMappingConfigSchema.safeParse(base).success, true);
  assert.equal(
    entraGroupMappingConfigSchema.safeParse({
      ...base,
      mode: 'token_authoritative',
    }).success,
    false,
  );
});

test('role scope and duplicate mapping rules fail closed', () => {
  assert.equal(
    entraGroupMappingConfigSchema.safeParse({
      ...base,
      mappings: [{ ...base.mappings[0], departmentId: null }],
    }).success,
    false,
  );
  assert.equal(
    entraGroupMappingConfigSchema.safeParse({
      ...base,
      mappings: [base.mappings[0], base.mappings[0]],
    }).success,
    false,
  );
});
