import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceVersionDetailSchema, resourceVersionSchema } from '../dist/platform-schemas.js';

const resource = {
  id: '10000000-0000-4000-8000-000000000001',
  familyId: '20000000-0000-4000-8000-000000000002',
  kind: 'Agent',
  slug: 'governed-agent',
  name: 'Governed Agent',
  version: '1.0.0',
  owner: 'Operations',
  purpose: 'Exercise the exact governed Agent detail response contract.',
  lifecycle: 'candidate',
  digest: 'a'.repeat(64),
  sourceCommit: 'b'.repeat(40),
  provenance: { source: 'contract-test' },
  dependencyPins: [],
  definition: {
    apiVersion: 'paul-os/v1',
    kind: 'Agent',
    metadata: {
      id: '20000000-0000-4000-8000-000000000002',
      slug: 'governed-agent',
      version: '1.0.0',
      name: 'Governed Agent',
      owner: 'Operations',
      purpose: 'Exercise the exact governed Agent detail response contract.',
      lifecycle: 'candidate',
      provenance: { source: 'contract-test' },
    },
    dependencies: [],
    spec: {},
  },
  revision: 1,
  frozenAt: '2026-08-20T12:00:00.000Z',
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z',
};

const guardrails = {
  workflowStages: ['Read governed evidence'],
  prohibitedActions: ['Change a source record'],
  approvalRequirements: ['An owner approves every external write'],
  failClosedConditions: ['Stop when governed evidence is unavailable'],
  responseRequirements: { citations: true, confidence: true, unresolvedConflicts: true },
};

test('exact resource detail carries a bounded digest-verified Agent governance projection', () => {
  const detail = resourceVersionDetailSchema.parse({
    ...resource,
    agentGovernance: {
      state: 'available',
      source: 'legacy_spec_snapshot',
      sourceRevision: 4,
      guardrails,
    },
  });

  assert.deepEqual(detail.agentGovernance, {
    state: 'available',
    source: 'legacy_spec_snapshot',
    sourceRevision: 4,
    guardrails,
  });
  assert.equal('agentGovernance' in resourceVersionSchema.parse(detail), false);
});

test('exact resource detail fails closed with a typed reason and defaults absent projections to null', () => {
  assert.equal(resourceVersionDetailSchema.parse(resource).agentGovernance, null);
  assert.deepEqual(
    resourceVersionDetailSchema.parse({
      ...resource,
      agentGovernance: { state: 'unavailable', reason: 'snapshot_integrity_failed' },
    }).agentGovernance,
    { state: 'unavailable', reason: 'snapshot_integrity_failed' },
  );
  assert.equal(
    resourceVersionDetailSchema.safeParse({
      ...resource,
      agentGovernance: { state: 'available', source: 'legacy_manifest_snapshot', guardrails },
    }).success,
    false,
  );
});
