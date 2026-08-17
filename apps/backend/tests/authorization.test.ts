import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import request from 'supertest';
import {
  effectiveRoles,
  hasMinimumRole,
  requireMinimumRole,
  sessionForPrincipal,
} from '../src/authorization.js';
import type { AppError } from '../src/errors.js';
import type { RequestPrincipal } from '../src/request-context.js';
import { requestContextMiddleware } from '../src/request-context.js';

const principal = (roles: RequestPrincipal['roles']): RequestPrincipal => ({
  principalId: '10000000-0000-4000-8000-000000000001',
  actorId: 'human:authorization-test',
  workspaceId: '20000000-0000-4000-8000-000000000002',
  departmentId: null,
  authentication: 'local',
  roles,
  requestId: 'authorization-test',
});

describe('four-role authorization', () => {
  it.each([
    ['consumer', ['consumer']],
    ['builder', ['consumer', 'builder']],
    ['owner', ['consumer', 'builder', 'owner']],
    ['admin', ['consumer', 'builder', 'owner', 'admin']],
  ] as const)('expands %s into its inherited effective roles', (assigned, expected) => {
    expect(effectiveRoles([assigned])).toEqual(expected);
  });

  it('does not allow a lower role to satisfy a higher-role operation', () => {
    expect(hasMinimumRole(principal(['consumer']), 'builder')).toBe(false);
    expect(hasMinimumRole(principal(['builder']), 'consumer')).toBe(true);
    expect(hasMinimumRole(principal(['owner']), 'owner')).toBe(true);
    expect(hasMinimumRole(principal(['admin']), 'owner')).toBe(true);
  });

  it('renders a stable session authorization contract', () => {
    expect(sessionForPrincipal(principal(['owner']))).toMatchObject({
      effectiveRoles: ['consumer', 'builder', 'owner'],
      permissions: [
        'catalog:read',
        'runs:execute',
        'builder:author',
        'evidence:review',
        'release:govern',
      ],
      authorizationModel: 'workspace-role-v1',
    });
  });

  it('rejects a governed route before its handler when the principal role is too low', async () => {
    const app = express();
    app.use(
      requestContextMiddleware({
        enabled: false,
        actorId: 'human:consumer-only',
        roles: ['consumer'],
      }),
    );
    const governedHandler: RequestHandler = (_request, response) => response.status(204).end();
    const handler = jest.fn(governedHandler);
    app.post('/governed', requireMinimumRole('owner'), handler);
    const errors: ErrorRequestHandler = (error: unknown, _request, response, next) => {
      void next;
      const appError = error as AppError;
      response.status(appError.status).json({ code: appError.code });
    };
    app.use(errors);
    await request(app).post('/governed').expect(403, { code: 'AUTHORIZATION_REQUIRED' });
    expect(handler).not.toHaveBeenCalled();
  });
});
