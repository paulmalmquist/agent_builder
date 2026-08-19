import request from 'supertest';
import { pino } from 'pino';
import { repositoryImportResponseSchema } from '@agent-builder/contracts';
import { compileResourceYaml } from '@paul-os/runtime';
import { stringify } from 'yaml';
import { createApp } from '../src/app.js';
import { AppError } from '../src/errors.js';
import type { ServiceBundle } from '../src/services/types.js';

const familyId = '10000000-0000-4000-8000-000000000001';
const resourceVersionId = '20000000-0000-4000-8000-000000000002';
const importId = '30000000-0000-4000-8000-000000000003';
const improvementCandidateId = '40000000-0000-4000-8000-000000000004';
const timestamp = '2026-08-16T12:00:00.000Z';

const manifestYaml = stringify({
  apiVersion: 'paul-os/v1',
  kind: 'Skill',
  metadata: {
    id: familyId,
    slug: 'lineage-skill',
    version: '1.0.0',
    owner: 'route-test',
    purpose: 'Verify governed candidate lineage through the repository import HTTP boundary.',
    lifecycle: 'candidate',
    provenance: 'synthetic',
  },
  dependencies: [],
  spec: {
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    tools: [],
    permissions: [],
    contextRequirements: [],
    successCriteria: ['Preserve the reviewed improvement candidate identifier.'],
  },
});
const compiled = compileResourceYaml(manifestYaml);
const imported = repositoryImportResponseSchema.parse({
  import: {
    id: importId,
    resourceVersionId,
    digest: compiled.digest,
    sourceCommit: 'a'.repeat(40),
    sourcePath: '02-skills/lineage-skill/manifest.yaml',
    improvementCandidateId,
    importedBy: 'human:route-test',
    importedAt: timestamp,
  },
  resource: {
    id: resourceVersionId,
    familyId,
    kind: 'Skill',
    slug: 'lineage-skill',
    name: 'lineage-skill',
    version: '1.0.0',
    owner: 'route-test',
    purpose: compiled.manifest.metadata.purpose,
    lifecycle: 'candidate',
    digest: compiled.digest,
    sourceCommit: 'a'.repeat(40),
    provenance: 'synthetic',
    dependencyPins: [],
    definition: compiled.manifest,
    revision: 1,
    frozenAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  idempotent: false,
});

function appFor(importResource: jest.Mock) {
  return createApp(
    {
      health: { check: jest.fn() },
      platform: {
        registry: { importResource },
        releaseGovernance: {},
        execution: {},
        automationLearning: {},
        executionDispatcher: { enqueue: jest.fn(), recoverAndResume: jest.fn() },
        dispatchMode: 'external',
      },
    } as unknown as ServiceBundle,
    pino({ level: 'silent' }),
  );
}

describe('repository import candidate-lineage route', () => {
  it('forwards a validated optional candidate identifier and returns it as provenance', async () => {
    const importResource = jest.fn().mockResolvedValue(imported);
    const response = await request(appFor(importResource))
      .post('/v1/repository-imports')
      .send({
        manifestYaml,
        sourcePath: '02-skills/lineage-skill/manifest.yaml',
        improvementCandidateId,
      })
      .expect(201);

    expect(importResource).toHaveBeenCalledWith({
      manifestYaml,
      sourcePath: '02-skills/lineage-skill/manifest.yaml',
      improvementCandidateId,
    });
    expect(response.body.import.improvementCandidateId).toBe(improvementCandidateId);
  });

  it('rejects malformed candidate identifiers before invoking the registry service', async () => {
    const importResource = jest.fn();
    await request(appFor(importResource))
      .post('/v1/repository-imports')
      .send({ manifestYaml, sourcePath: null, improvementCandidateId: 'not-a-uuid' })
      .expect(400);
    expect(importResource).not.toHaveBeenCalled();
  });

  it('returns the centralized typed error when the referenced candidate is absent', async () => {
    const importResource = jest
      .fn()
      .mockRejectedValue(
        new AppError(404, 'IMPROVEMENT_NOT_FOUND', 'Improvement candidate was not found'),
      );
    const response = await request(appFor(importResource))
      .post('/v1/repository-imports')
      .send({ manifestYaml, sourcePath: null, improvementCandidateId })
      .expect(404);
    expect(response.body).toMatchObject({
      error: {
        code: 'IMPROVEMENT_NOT_FOUND',
        message: 'Improvement candidate was not found',
      },
    });
  });
});
