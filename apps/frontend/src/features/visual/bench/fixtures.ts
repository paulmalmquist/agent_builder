import type { ResourceManifest } from '@agent-builder/contracts';
import { serializeBenchManifest } from './bench-model';
import type { AssemblyBenchModel } from './types';

export const ASSEMBLY_BENCH_FIXTURE_MANIFEST: ResourceManifest = {
  apiVersion: 'paul-os/v1',
  kind: 'Agent',
  metadata: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    slug: 'build-anomaly-investigator',
    version: '0.3.0',
    name: 'Build anomaly investigator',
    owner: 'Manufacturing Operations',
    purpose: 'Investigate anomalous synthetic build telemetry and draft a cited escalation.',
    lifecycle: 'candidate',
    provenance: { source: 'synthetic-assembly-bench-fixture' },
  },
  dependencies: [],
  spec: {
    objective: 'Investigate anomalous synthetic build telemetry and draft a cited escalation.',
    skills: ['telemetry-investigation@1.0.0'],
    protocols: ['console-grammar@1.3.0'],
    contextPolicy: 'default-context@1.0.0',
    knowledgeSources: ['build-telemetry@1.0.0'],
    tools: [
      {
        plugin: {
          familyId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          version: '1.0.0',
        },
        tool: 'query_telemetry',
      },
      {
        plugin: {
          familyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          version: '1.0.0',
        },
        tool: 'create_hold_request',
      },
    ],
    triggers: [],
    executionLoop: {
      maximumSteps: 12,
      onUnresolved: 'fail_closed',
      outputContract: 'escalation-package@1.0.0',
    },
    memoryPolicy: { reads: 'accepted_only', writes: 'staged_for_human_acceptance' },
    production: { requiresImmutableRelease: true, authorityClass: 'R3' },
  },
};

export const ASSEMBLY_BENCH_FIXTURE_MODEL: AssemblyBenchModel = {
  agentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  agentName: 'Build anomaly investigator',
  authorityClass: 'R3',
  capabilities: [
    {
      approvalRequired: false,
      authority: 'granted',
      brand: { monogram: 'BQ', accent: '#2f9d82', assetSrc: null },
      connectorState: 'healthy',
      detail: 'Read bounded synthetic telemetry rows.',
      effect: 'read',
      executionPlacement: 'control_plane',
      id: 'fixture:query-telemetry',
      name: 'Telemetry warehouse · Query telemetry',
      tool: 'query_telemetry',
    },
    {
      approvalRequired: true,
      authority: 'declared',
      brand: { monogram: 'QM', accent: '#e8b34b', assetSrc: null },
      connectorState: 'healthy',
      detail: 'Draft a synthetic hold request after human approval.',
      effect: 'write',
      executionPlacement: 'workstation',
      id: 'fixture:create-hold-request',
      name: 'Quality system · Create hold request',
      tool: 'create_hold_request',
    },
  ],
  certificationHealth: 'not_certified',
  department: 'Manufacturing Operations',
  issues: [],
  manifest: ASSEMBLY_BENCH_FIXTURE_MANIFEST,
  manifestSource: 'fixture',
  manifestText: serializeBenchManifest(ASSEMBLY_BENCH_FIXTURE_MANIFEST),
  provenance: 'synthetic',
  purpose: 'Investigate anomalous synthetic build telemetry and draft a cited escalation.',
  readOnlyReason:
    'This fixture demonstrates the read-only bench. It cannot grant, revoke, or execute tools.',
  resourceVersionId: null,
};
