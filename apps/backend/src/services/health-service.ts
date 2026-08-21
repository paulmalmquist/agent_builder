import { Prisma, type PrismaClient } from '@prisma/client';
import { healthResponseSchema } from '@agent-builder/contracts';
import { AppError } from '../errors.js';
import type { BuildIdentity } from '../build-identity.js';
import type { HealthApi } from './types.js';

export class HealthService implements HealthApi {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly buildIdentity: BuildIdentity = { commit: null, buildTimestamp: null },
  ) {}

  async check() {
    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
      return healthResponseSchema.parse({
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
        ...this.buildIdentity,
      });
    } catch {
      throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'PostgreSQL health check failed', {
        dependency: 'postgresql',
      });
    }
  }
}
