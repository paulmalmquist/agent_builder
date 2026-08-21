import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import type { AppError } from '../src/errors.js';
import {
  currentActorId,
  currentRequestContext,
  currentRequestPrincipal,
  requestContextMiddleware,
  runAsSystem,
  runWithPrincipal,
} from '../src/request-context.js';
import {
  LOCAL_DEPARTMENT_ID,
  LOCAL_PRINCIPAL_ID,
  LOCAL_WORKSPACE_ID,
  SYSTEM_PRINCIPAL_ID,
} from '../src/scope-constants.js';

function testApp() {
  const app = express();
  app.use(
    requestContextMiddleware({
      enabled: true,
      actorId: 'authenticated-user@example.test',
      bearerToken: 'this-is-a-long-test-token',
    }),
  );
  app.get('/health', (_request, response) => response.json({ public: true }));
  app.get('/v1/health', (_request, response) => response.json({ public: true }));
  app.get('/agents', (_request, response) => response.json(currentRequestContext()));
  app.get('/agents/background', (_request, response) =>
    response.json(runAsSystem(() => currentRequestContext())),
  );
  const errors: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    void next;
    const appError = error as AppError;
    response.status(appError.status).json({ code: appError.code });
  };
  app.use(errors);
  return app;
}

describe('request identity context', () => {
  it('keeps health public while protecting governed API routes', async () => {
    const app = testApp();
    await request(app).get('/health').expect(200, { public: true });
    await request(app).get('/v1/health').expect(200, { public: true });
    const rejected = await request(app).get('/agents').expect(401);
    expect(rejected.headers['www-authenticate']).toBe('Bearer');
    expect(rejected.body).toEqual({ code: 'AUTHENTICATION_REQUIRED' });
  });

  it('threads the authenticated actor through async request context', async () => {
    const response = await request(testApp())
      .get('/agents')
      .set('authorization', 'Bearer this-is-a-long-test-token')
      .expect(200);
    expect(response.body.actor).toEqual({
      id: 'authenticated-user@example.test',
      authentication: 'bearer',
    });
    expect(response.body.principal).toEqual({
      principalId: LOCAL_PRINCIPAL_ID,
      actorId: 'authenticated-user@example.test',
      workspaceId: LOCAL_WORKSPACE_ID,
      departmentId: LOCAL_DEPARTMENT_ID,
      authentication: 'bearer',
      roles: ['admin'],
      requestId: null,
    });
  });

  it('can explicitly detach background lifecycle work from the requesting actor', async () => {
    const response = await request(testApp())
      .get('/agents/background')
      .set('authorization', 'Bearer this-is-a-long-test-token')
      .expect(200);
    expect(response.body).toEqual({
      requestId: null,
      principal: {
        principalId: SYSTEM_PRINCIPAL_ID,
        actorId: 'system:background',
        workspaceId: LOCAL_WORKSPACE_ID,
        departmentId: LOCAL_DEPARTMENT_ID,
        authentication: 'system',
        roles: ['admin'],
        requestId: null,
      },
      actor: { id: 'system:background', authentication: 'system' },
    });
  });

  it('preserves the compatibility actor view for an explicitly supplied principal', () => {
    const result = runWithPrincipal(
      {
        principalId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',
        actorId: 'human:scoped-test',
        workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        departmentId: null,
        authentication: 'local',
        roles: ['admin'],
        requestId: 'scope-test-request',
      },
      () => ({
        actorId: currentActorId(),
        principal: currentRequestPrincipal(),
        context: currentRequestContext(),
      }),
    );

    expect(result.actorId).toBe('human:scoped-test');
    expect(result.principal).toMatchObject({
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      departmentId: null,
      requestId: 'scope-test-request',
    });
    expect(result.context.actor).toEqual({ id: 'human:scoped-test', authentication: 'local' });
  });
});
