import { Prisma, type PrismaClient } from '@prisma/client';
import { healthResponseSchema } from '@agent-builder/contracts';
import { AppError } from '../errors.js';
import type { HealthApi } from './types.js';

export class HealthService implements HealthApi {
  constructor(private readonly prisma: PrismaClient) {}

  async check() {
    try {
      await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
      return healthResponseSchema.parse({
        status: 'ok',
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch {
      throw new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'PostgreSQL health check failed', {
        dependency: 'postgresql',
      });
    }
  }
}
