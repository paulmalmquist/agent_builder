import type { Express } from 'express';
import request, { type Test } from 'supertest';
import { pino } from 'pino';
import type { PlatformRoleValue } from '@agent-builder/contracts';
import { createApp } from '../src/app.js';
import type { ServiceBundle } from '../src/services/types.js';

const token = 'route-permission-test-secret-00000001';
const specId = '10000000-0000-4000-8000-000000000001';
const agentId = '20000000-0000-4000-8000-000000000002';
const caseId = '30000000-0000-4000-8000-000000000003';
const intakeId = '40000000-0000-4000-8000-000000000004';
const publicationId = '50000000-0000-4000-8000-000000000005';

type MutationMethod = 'post' | 'put';
type MutationCase = readonly [label: string, method: MutationMethod, path: string];

const builderMutations: readonly MutationCase[] = [
  ['interpret a versioned Builder draft', 'post', '/v1/builder/specs/interpret'],
  ['create a versioned Builder draft', 'post', '/v1/builder/specs'],
  ['author versioned outcomes', 'put', `/v1/builder/specs/${specId}/outcomes`],
  ['author versioned knowledge', 'put', `/v1/builder/specs/${specId}/knowledge`],
  ['author versioned guardrails', 'put', `/v1/builder/specs/${specId}/guardrails`],
  ['author versioned outputs', 'put', `/v1/builder/specs/${specId}/outputs`],
  ['generate a versioned Builder candidate', 'post', `/v1/builder/specs/${specId}/generate`],
  ['recover a versioned Builder candidate', 'post', `/v1/builder/agents/${agentId}/recover`],
  [
    'shadow deploy a versioned Builder candidate',
    'post',
    `/v1/builder/agents/${agentId}/shadow-deploy`,
  ],
  ['record a Builder intake decision', 'post', `/v1/builder/intakes/${intakeId}/decisions`],
  ['import a governed resource', 'post', '/v1/repository-imports'],
  ['author an immutable release', 'post', '/v1/releases'],
  ['evaluate an immutable release', 'post', '/v1/release-evaluations'],
  ['interpret a legacy Builder draft', 'post', '/agents/specs/interpret'],
  ['create a legacy Builder draft', 'post', '/agents/specs'],
  ['author legacy outcomes', 'put', `/agents/specs/${specId}/outcomes`],
  ['author legacy knowledge', 'put', `/agents/specs/${specId}/knowledge`],
  ['author legacy guardrails', 'put', `/agents/specs/${specId}/guardrails`],
  ['author legacy outputs', 'put', `/agents/specs/${specId}/outputs`],
  ['generate a legacy candidate', 'post', `/agents/specs/${specId}/generate`],
  ['evaluate a legacy candidate', 'post', `/agents/${agentId}/certification-runs`],
  ['author a legacy evaluation case', 'post', '/agents/eval-cases'],
  ['recover a legacy candidate', 'post', `/agents/${agentId}/recover`],
  ['shadow deploy a legacy candidate', 'post', `/agents/${agentId}/shadow-deploy`],
];

const ownerMutations: readonly MutationCase[] = [
  ['retire a catalog publication', 'post', `/v1/catalog/publications/${publicationId}/retirement`],
  ['promote a release', 'post', '/v1/production-channels/default/promote'],
  ['decline a release', 'post', '/v1/production-channels/default/decline'],
  ['roll back a release', 'post', '/v1/production-channels/default/rollback'],
  ['publish legacy gate policy', 'post', '/agents/certification-gate-configs/publish'],
  ['deactivate a legacy evaluation case', 'post', `/agents/eval-cases/${caseId}/deactivate`],
  ['publish a legacy evaluation corpus', 'post', '/agents/eval-corpus/publish'],
  ['promote a legacy candidate', 'post', `/agents/${agentId}/promote`],
  ['retire a legacy candidate', 'post', `/agents/${agentId}/retire`],
];

function skeletalServices(): ServiceBundle {
  return {
    health: { check: jest.fn() },
    platform: {
      reuse: {},
      plugins: {},
      attention: {},
      registry: {},
      releaseGovernance: {},
      execution: {},
      automationLearning: {},
      executionDispatcher: { enqueue: jest.fn(), recoverAndResume: jest.fn() },
      dispatchMode: 'external',
    },
  } as unknown as ServiceBundle;
}

function appForRole(role: PlatformRoleValue): Express {
  return createApp(skeletalServices(), pino({ level: 'silent' }), {
    auth: {
      enabled: true,
      actorId: `human:${role}-route-test`,
      bearerToken: token,
      roles: [role],
    },
  });
}

function mutation(app: Express, method: MutationMethod, path: string): Test {
  const pending = method === 'post' ? request(app).post(path) : request(app).put(path);
  return pending.set('authorization', `Bearer ${token}`).send({});
}

function expectRoleError(response: request.Response, requiredRole: PlatformRoleValue): void {
  expect(response.body).toMatchObject({
    error: {
      code: 'AUTHORIZATION_REQUIRED',
      details: { requiredRole },
    },
  });
}

describe('control-plane route permission matrix', () => {
  it.each(builderMutations)('keeps consumer principals out of %s', async (_label, method, path) => {
    const response = await mutation(appForRole('consumer'), method, path).expect(403);
    expectRoleError(response, 'builder');
  });

  it.each(ownerMutations)('keeps builder principals out of %s', async (_label, method, path) => {
    const response = await mutation(appForRole('builder'), method, path).expect(403);
    expectRoleError(response, 'owner');
  });

  it('lets each minimum role reach its intended operation without over-guarding consumers', async () => {
    await mutation(appForRole('consumer'), 'post', '/v1/execution-runs').expect(400);
    await mutation(appForRole('builder'), 'post', '/v1/builder/specs').expect(400);
    await mutation(appForRole('owner'), 'post', `/agents/${agentId}/promote`).expect(400);
    await mutation(appForRole('admin'), 'post', '/v1/plugin-installations').expect(400);
  });

  it('keeps malformed protected resource paths as 404 route misses before authorization', async () => {
    const app = appForRole('consumer');
    const versioned = await mutation(app, 'post', '/v1/builder/specs/not-a-uuid/generate').expect(
      404,
    );
    const legacy = await mutation(app, 'post', '/agents/not-a-uuid/promote').expect(404);
    expect(versioned.body.error.code).toBe('ROUTE_NOT_FOUND');
    expect(legacy.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
