import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, RequestHandler } from 'express';
import type { RequestPrincipalContract } from '@agent-builder/contracts';
import type { AppConfig } from './config.js';
import {
  anonymousPrincipal,
  createAuthenticationAdapter,
  type AuthenticationAdapterOptions,
} from './identity-auth.js';
import { LOCAL_DEPARTMENT_ID, LOCAL_WORKSPACE_ID, SYSTEM_PRINCIPAL_ID } from './scope-constants.js';

export interface RequestActor {
  id: string;
  authentication: RequestPrincipalContract['authentication'];
}

export type RequestPrincipal = RequestPrincipalContract;

export interface RequestContext {
  requestId: string | null;
  principal: RequestPrincipal;
  /** Compatibility view for existing actor-attributed services. */
  actor: RequestActor;
}

const storage = new AsyncLocalStorage<RequestContext>();
const systemPrincipal: RequestPrincipal = {
  principalId: SYSTEM_PRINCIPAL_ID,
  actorId: 'system:background',
  workspaceId: LOCAL_WORKSPACE_ID,
  departmentId: LOCAL_DEPARTMENT_ID,
  authentication: 'system',
  roles: ['admin'],
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

export function requestContextMiddleware(
  auth: AppConfig['auth'] = { enabled: false, actorId: 'local-user' },
  options: AuthenticationAdapterOptions = {},
): RequestHandler {
  const adapter = createAuthenticationAdapter(auth, options);
  return (request, response, next) => {
    const isPublicRoute = ['/health', '/live', '/ready', '/openapi.json'].includes(request.path);
    const requestId =
      typeof (request as Request & { id?: unknown }).id === 'string'
        ? ((request as Request & { id: string }).id ?? null)
        : null;
    if (isPublicRoute) {
      storage.run(contextFromPrincipal({ ...anonymousPrincipal(), requestId }), next);
      return;
    }
    void adapter
      .authenticate(request)
      .then((principal) => storage.run(contextFromPrincipal({ ...principal, requestId }), next))
      .catch((error: unknown) => {
        response.setHeader('www-authenticate', 'Bearer');
        next(error);
      });
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
