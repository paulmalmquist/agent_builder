import request from 'supertest';
import { pino } from 'pino';
import {
  pluginCatalogItemSchema,
  pluginHealthCheckSchema,
  pluginInstallationSchema,
  pluginUsedByResponseSchema,
} from '@agent-builder/contracts';
import { createApp } from '../src/app.js';
import type { ServiceBundle } from '../src/services/types.js';

const pluginVersionId = '10000000-0000-4000-8000-000000000001';
const familyId = '20000000-0000-4000-8000-000000000002';
const installationId = '30000000-0000-4000-8000-000000000003';
const now = '2026-08-17T12:00:00.000Z';

const catalogItem = pluginCatalogItemSchema.parse({
  pluginVersionId,
  familyId,
  slug: 'synthetic-planning-http',
  name: 'Synthetic Planning API',
  version: '1.0.0',
  digest: 'a'.repeat(64),
  transport: 'http',
  executionPlacement: 'control_plane',
  classification: 'internal',
  capabilities: [
    {
      tool: 'record_lookup',
      description: 'Read one bounded synthetic planning record.',
      effect: 'read',
      approval: 'not_required',
      scopeDescription: 'Read synthetic planning records only; it cannot write or delete.',
      limits: {
        timeoutMs: 1000,
        maxResponseBytes: 1000,
        maxRecords: 1,
        maxInvocationsPerRun: 1,
      },
    },
  ],
  secretSlots: [
    {
      name: 'api_token',
      description: 'Credential used by the synthetic transport.',
      required: true,
    },
  ],
  activeScopeDescriptions: ['Read synthetic planning records only; it cannot write or delete.'],
  costThisWeekUsd: 0,
  installationId,
  installationState: 'installed',
  healthStatus: 'unknown',
  lastUsedAt: null,
});

const installation = pluginInstallationSchema.parse({
  id: installationId,
  pluginVersionId,
  pluginDigest: 'a'.repeat(64),
  state: 'installed',
  executionPlacement: 'control_plane',
  developmentOnly: true,
  secretBindings: [{ slot: 'api_token', configured: true }],
  installedBy: 'human:plugin-route-test',
  installedAt: now,
  configuredAt: now,
  disabledAt: null,
  updatedAt: now,
});

function appFor() {
  const plugins = {
    listCatalog: jest.fn().mockResolvedValue({ items: [catalogItem] }),
    getCatalogItem: jest.fn().mockResolvedValue(catalogItem),
    listInstallations: jest.fn().mockResolvedValue({ items: [installation] }),
    install: jest.fn().mockResolvedValue(installation),
    getInstallation: jest.fn().mockResolvedValue(installation),
    configure: jest.fn().mockResolvedValue(installation),
    checkHealth: jest.fn().mockResolvedValue(
      pluginHealthCheckSchema.parse({
        id: '40000000-0000-4000-8000-000000000004',
        installationId,
        status: 'healthy',
        probeKind: 'http',
        message: 'The Plugin health check passed.',
        latencyMs: 2,
        checkedAt: now,
      }),
    ),
    enable: jest.fn().mockResolvedValue({ ...installation, state: 'enabled' }),
    disable: jest.fn().mockResolvedValue({ ...installation, state: 'disabled', disabledAt: now }),
    usedBy: jest.fn().mockResolvedValue(
      pluginUsedByResponseSchema.parse({
        installationId,
        items: [],
        uninstallBlocked: false,
      }),
    ),
    uninstall: jest.fn().mockResolvedValue({ installationId, uninstalled: true }),
  };
  const services = {
    health: { check: jest.fn() },
    platform: {
      plugins,
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
        actorId: 'human:plugin-route-test',
        bearerToken: 'plugin-route-secret',
      },
    }),
    plugins,
  };
}

function authenticated(app: ReturnType<typeof appFor>['app']) {
  return {
    get: (path: string) =>
      request(app).get(path).set('authorization', 'Bearer plugin-route-secret'),
    post: (path: string) =>
      request(app).post(path).set('authorization', 'Bearer plugin-route-secret'),
  };
}

describe('Plugin operational routes', () => {
  it('returns sanitized catalog and installation resources', async () => {
    const { app } = appFor();
    const api = authenticated(app);
    const catalog = await api.get('/v1/plugins').expect(200);
    const installations = await api.get('/v1/plugin-installations').expect(200);
    for (const body of [catalog.body, installations.body]) {
      expect(JSON.stringify(body)).not.toContain('environmentVariable');
      expect(JSON.stringify(body)).not.toContain('env://');
      expect(JSON.stringify(body)).not.toContain('PRIVATE_TOKEN');
    }
  });

  it('accepts opaque secret references but never reflects them in install responses', async () => {
    const { app, plugins } = appFor();
    const body = {
      pluginVersionId,
      developmentOnly: true,
      secretBindings: [{ slot: 'api_token', reference: 'env://PRIVATE_TOKEN' }],
    };
    const response = await authenticated(app)
      .post('/v1/plugin-installations')
      .send(body)
      .expect(201);
    expect(plugins.install).toHaveBeenCalledWith(body);
    expect(JSON.stringify(response.body)).not.toContain('PRIVATE_TOKEN');
    expect(JSON.stringify(response.body)).not.toContain('env://');

    await authenticated(app)
      .post('/v1/plugin-installations')
      .send({ ...body, secretBindings: [{ slot: 'api_token', reference: 'cleartext-secret' }] })
      .expect(400);
    expect(plugins.install).toHaveBeenCalledTimes(1);
  });

  it('validates and forwards health, state, used-by, and uninstall operations', async () => {
    const { app, plugins } = appFor();
    const api = authenticated(app);
    await api.post(`/v1/plugin-installations/${installationId}/health-check`).expect(200);
    await api
      .post(`/v1/plugin-installations/${installationId}/disable`)
      .send({ rationale: 'Disable this Plugin while its configuration is reviewed.' })
      .expect(200);
    await api.get(`/v1/plugin-installations/${installationId}/used-by`).expect(200);
    await api
      .post(`/v1/plugin-installations/${installationId}/uninstall`)
      .send({ rationale: 'Remove the unused synthetic Plugin installation.' })
      .expect(204);
    expect(plugins.checkHealth).toHaveBeenCalledWith(installationId);
    expect(plugins.disable).toHaveBeenCalledWith(installationId, {
      rationale: 'Disable this Plugin while its configuration is reviewed.',
    });
    expect(plugins.usedBy).toHaveBeenCalledWith(installationId);
    expect(plugins.uninstall).toHaveBeenCalledWith(installationId, {
      rationale: 'Remove the unused synthetic Plugin installation.',
    });
  });
});
