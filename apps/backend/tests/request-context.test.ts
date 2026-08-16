import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import type { AppError } from '../src/errors.js';
import {
  currentRequestContext,
  requestContextMiddleware,
  runAsSystem,
} from '../src/request-context.js';

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
  });

  it('can explicitly detach background lifecycle work from the requesting actor', async () => {
    const response = await request(testApp())
      .get('/agents/background')
      .set('authorization', 'Bearer this-is-a-long-test-token')
      .expect(200);
    expect(response.body).toEqual({
      requestId: null,
      actor: { id: 'system:background', authentication: 'system' },
    });
  });
});
