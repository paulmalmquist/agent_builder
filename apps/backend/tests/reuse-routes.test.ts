import request from 'supertest';
import { pino } from 'pino';
import {
  builderDecisionSchema,
  builderIntakeResultsSchema,
  builderIntakeSchema,
  type CapabilityProfile,
} from '@agent-builder/contracts';
import { createApp } from '../src/app.js';
import type { ServiceBundle } from '../src/services/types.js';

const intakeId = '10000000-0000-4000-8000-000000000001';
const now = '2026-08-17T12:00:00.000Z';
const requestText = 'Prepare a bounded daily plan from my synthetic tasks and priorities.';
const profile: CapabilityProfile = {
  schemaVersion: 1,
  intendedUsers: ['Operations planners'],
  businessDomain: 'personal productivity',
  triggers: ['daily planning'],
  tasks: ['prioritize work'],
  inputs: ['tasks'],
  outputs: ['daily brief'],
  knowledgeClasses: [],
  tools: [],
  potentialActions: [],
  successCriteria: ['Priorities are ordered'],
  riskLevel: 'low',
};
const intake = builderIntakeSchema.parse({
  id: intakeId,
  request: requestText,
  requestedBy: 'human:reuse-route-test',
  department: 'Personal Productivity',
  state: 'confirmed',
  capabilityProfile: profile,
  confirmedAt: now,
  specificationId: null,
  createdAt: now,
});
const results = builderIntakeResultsSchema.parse({
  intakeId,
  referredChoices: [],
  compositionSuggestions: [],
  generatedAt: now,
});
const decision = builderDecisionSchema.parse({
  id: '20000000-0000-4000-8000-000000000002',
  intakeId,
  action: 'build_new',
  selectedPublicationId: null,
  buildNewReason: null,
  demandObservationId: null,
  highestReferredMatchScore: null,
  decidedBy: 'human:reuse-route-test',
  decidedAt: now,
});

function appFor() {
  const reuse = {
    listPublications: jest.fn().mockResolvedValue({ items: [] }),
    getPublication: jest.fn(),
    retirePublication: jest.fn(),
    createIntake: jest.fn().mockResolvedValue(intake),
    getIntake: jest.fn().mockResolvedValue(intake),
    referredChoices: jest.fn().mockResolvedValue(results),
    createDecision: jest.fn().mockResolvedValue(decision),
    getDraft: jest.fn(),
    createDeployment: jest.fn(),
    getDeployment: jest.fn(),
    appendConfigurationRevision: jest.fn(),
    getResourceLineage: jest.fn(),
  };
  const services = {
    health: { check: jest.fn() },
    platform: {
      reuse,
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
  return {
    app: createApp(services, pino({ level: 'silent' }), {
      auth: {
        enabled: true,
        actorId: 'human:reuse-route-test',
        bearerToken: 'reuse-route-secret',
      },
    }),
    reuse,
  };
}

function authenticated(app: ReturnType<typeof appFor>['app']) {
  return {
    get: (path: string) => request(app).get(path).set('authorization', 'Bearer reuse-route-secret'),
    post: (path: string) =>
      request(app).post(path).set('authorization', 'Bearer reuse-route-secret'),
  };
}

describe('Builder reuse routes', () => {
  it('keeps publication query values in their wire form for service-boundary validation', async () => {
    const { app, reuse } = appFor();

    await authenticated(app)
      .get('/v1/catalog/publications?includeRetired=false&limit=100')
      .expect(200);

    expect(reuse.listPublications).toHaveBeenCalledWith(
      expect.objectContaining({ includeRetired: 'false', limit: '100' }),
    );
  });

  it('creates a confirmed intake before any specification exists and returns referred choices', async () => {
    const { app, reuse } = appFor();
    const api = authenticated(app);
    const body = {
      request: requestText,
      department: 'Personal Productivity',
      capabilityProfile: profile,
      confirmed: true,
    };
    const created = await api.post('/v1/builder/intakes').send(body).expect(201);
    expect(created.body).toEqual(intake);
    expect(created.body.specificationId).toBeNull();
    expect(reuse.createIntake).toHaveBeenCalledWith(body);

    const choices = await api.get(`/v1/builder/intakes/${intakeId}/referred-choices`).expect(200);
    expect(choices.body).toEqual(results);
    expect(reuse.referredChoices).toHaveBeenCalledWith(intakeId);
  });

  it('requires and forwards a validated Idempotency-Key for Builder decisions', async () => {
    const { app, reuse } = appFor();
    const api = authenticated(app);
    const body = {
      action: 'build_new',
      selectedPublicationId: null,
      buildNewReason: null,
    };
    await api.post(`/v1/builder/intakes/${intakeId}/decisions`).send(body).expect(400);
    expect(reuse.createDecision).not.toHaveBeenCalled();

    const response = await api
      .post(`/v1/builder/intakes/${intakeId}/decisions`)
      .set('Idempotency-Key', 'reuse-route-decision-1')
      .send(body)
      .expect(201);
    expect(response.body).toEqual(decision);
    expect(reuse.createDecision).toHaveBeenCalledWith(intakeId, body, 'reuse-route-decision-1');
  });
});
