import { SourceRole, type PrismaClient } from '@prisma/client';
import type { SourceDescriptor } from '@agent-builder/contracts';
import { toSourceDescriptor } from '../mappers.js';
import type { SourceApi } from './types.js';

const databaseRoles = {
  knowledge: SourceRole.KNOWLEDGE,
  signal: SourceRole.SIGNAL,
  telemetry: SourceRole.TELEMETRY,
  evaluation: SourceRole.EVALUATION,
} as const;

export class SourceService implements SourceApi {
  constructor(private readonly prisma: PrismaClient) {}

  async list(role: keyof typeof databaseRoles | null): Promise<SourceDescriptor[]> {
    const records =
      role === null
        ? await this.prisma.knowledgeSource.findMany({
            orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
          })
        : await this.prisma.knowledgeSource.findMany({
            where: { role: databaseRoles[role] },
            orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
          });
    return records.map(toSourceDescriptor);
  }
}
