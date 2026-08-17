import { timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, RequestHandler } from 'express';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID } from './scope-constants.js';

export interface RequestActor {
  id: string;
  authentication: 'bearer' | 'local' | 'system';
}

export interface RequestPrincipal {
  actorId: string;
  workspaceId: string;
  departmentId: string | null;
  authentication: RequestActor['authentication'];
  requestId: string | null;
}

export interface RequestContext {
  requestId: string | null;
  principal: RequestPrincipal;
  /** Compatibility view for existing actor-attributed services. */
  actor: RequestActor;
}

const storage = new AsyncLocalStorage<RequestContext>();
const systemPrincipal: RequestPrincipal = {
  actorId: 'system:background',
  workspaceId: LOCAL_WORKSPACE_ID,
  departmentId: LOCAL_DEPARTMENT_ID,
  authentication: 'system',
  requestId: null,
};
const systemContext: RequestContext = {
  requestId: systemPrincipal.requestId,
  principal: systemPrincipal,
  actor: { id: systemPrincipal.actorId, authentication: systemPrincipal.authentication },
};

function contextFromPrincipal(principal: RequestPrincipal): RequestContext {
  return {
    requestId: principal.requestId,
    principal,
    actor: { id: principal.actorId, authentication: principal.authentication },
  };
}

function safeTokenMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}

function bearerToken(request: Request): string | null {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length);
  return token.length > 0 ? token : null;
}

export function requestContextMiddleware(
  auth: AppConfig['auth'] = { enabled: false, actorId: 'local-user' },
): RequestHandler {
  return (request, response, next) => {
    const isPublicRoute = request.path === '/health' || request.path === '/openapi.json';
    const expectedToken = auth.bearerToken;
    if (auth.enabled && !isPublicRoute) {
      const providedToken = bearerToken(request);
      if (
        expectedToken === undefined ||
        providedToken === null ||
        !safeTokenMatch(providedToken, expectedToken)
      ) {
        response.setHeader('www-authenticate', 'Bearer');
        next(
          new AppError(
            401,
            'AUTHENTICATION_REQUIRED',
            'A valid bearer token is required for this route',
          ),
        );
        return;
      }
    }

    const requestId =
      typeof (request as Request & { id?: unknown }).id === 'string'
        ? ((request as Request & { id: string }).id ?? null)
        : null;
    const context = contextFromPrincipal({
      actorId: isPublicRoute ? 'anonymous' : auth.actorId,
      workspaceId: LOCAL_WORKSPACE_ID,
      departmentId: LOCAL_DEPARTMENT_ID,
      authentication: auth.enabled && !isPublicRoute ? 'bearer' : 'local',
      requestId,
    });
    storage.run(context, next);
  };
}

export function currentRequestContext(): RequestContext {
  return storage.getStore() ?? systemContext;
}

export function currentActorId(): string {
  return currentRequestPrincipal().actorId;
}

export function currentRequestPrincipal(): RequestPrincipal {
  return currentRequestContext().principal;
}

export function runWithPrincipal<T>(principal: RequestPrincipal, operation: () => T): T {
  return storage.run(contextFromPrincipal(principal), operation);
}

export function runAsSystem<T>(operation: () => T): T {
  return storage.run(systemContext, operation);
}
