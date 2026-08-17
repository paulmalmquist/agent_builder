import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type Express, type Request } from 'express';
import { pinoHttp } from 'pino-http';
import { apiErrorSchema, type JsonValue } from '@agent-builder/contracts';
import { Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import { ZodError } from 'zod';
import { AppError } from './errors.js';
import type { AppConfig } from './config.js';
import { currentRequestPrincipal, requestContextMiddleware } from './request-context.js';
import { registerRoutes } from './routes.js';
import type { ServiceBundle } from './services/types.js';

type RequestWithId = Request & { id?: string };

const getRequestId = (request: Request): string => {
  const id = (request as RequestWithId).id;
  return typeof id === 'string' && id.length > 0 ? id : randomUUID();
};

export function createApp(
  services: ServiceBundle,
  logger: Logger,
  config: Pick<AppConfig, 'auth'> = {
    auth: { enabled: false, actorId: 'local-user' },
  },
): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger,
      genReqId(request, response) {
        const incoming = request.headers['x-request-id'];
        const requestId =
          typeof incoming === 'string' && incoming.length <= 200 ? incoming : randomUUID();
        response.setHeader('x-request-id', requestId);
        return requestId;
      },
    }),
  );
  app.use(requestContextMiddleware(config.auth));
  app.use(express.json({ limit: '1mb', strict: true }));

  registerRoutes(app, services);

  app.use((request, _response, next) => {
    next(
      new AppError(404, 'ROUTE_NOT_FOUND', 'Route was not found', {
        method: request.method,
        path: request.path,
      }),
    );
  });

  const errorMiddleware: ErrorRequestHandler = (rawError, request, response, next) => {
    const error: unknown = rawError;
    void next;
    const requestId = getRequestId(request);
    let appError: AppError;
    if (error instanceof AppError) {
      appError = error;
    } else if (error instanceof ZodError) {
      appError = new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', {
        issues: error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    } else if (
      error instanceof SyntaxError &&
      typeof (error as SyntaxError & { status?: unknown }).status === 'number' &&
      (error as SyntaxError & { status: number }).status === 400
    ) {
      appError = new AppError(400, 'VALIDATION_ERROR', 'Request body is not valid JSON');
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      appError = new AppError(409, 'RESOURCE_CONFLICT', 'A unique resource already exists');
    } else {
      appError = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    }

    if (appError.status >= 500) {
      const principal = currentRequestPrincipal();
      logger.error(
        {
          error,
          requestId,
          actorId: principal.actorId,
          workspaceId: principal.workspaceId,
          departmentId: principal.departmentId,
        },
        'Request failed',
      );
    } else {
      const principal = currentRequestPrincipal();
      logger.info(
        {
          code: appError.code,
          requestId,
          actorId: principal.actorId,
          workspaceId: principal.workspaceId,
          departmentId: principal.departmentId,
          status: appError.status,
        },
        'Request rejected',
      );
    }
    const errorBody: {
      error: {
        code: string;
        message: string;
        requestId: string;
        details?: JsonValue;
      };
    } = {
      error: {
        code: appError.code,
        message: appError.message,
        requestId,
      },
    };
    if (appError.details !== undefined) {
      errorBody.error.details = appError.details;
    }
    response.status(appError.status).json(apiErrorSchema.parse(errorBody));
  };
  app.use(errorMiddleware);

  return app;
}
