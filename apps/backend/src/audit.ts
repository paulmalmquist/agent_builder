import { jsonObjectSchema, type JsonValue } from '@agent-builder/contracts';
import type { Prisma } from '@prisma/client';
import { toPrismaJson } from './json-boundary.js';
import { currentRequestContext } from './request-context.js';

export interface AuditRecord {
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, JsonValue>;
}

export async function appendAuditEvent(
  transaction: Prisma.TransactionClient,
  record: AuditRecord,
): Promise<string> {
  const context = currentRequestContext();
  const event = await transaction.auditEvent.create({
    data: {
      actorId: context.actor.id,
      requestId: context.requestId,
      action: record.action,
      entityType: record.entityType,
      entityId: record.entityId,
      details: toPrismaJson(
        jsonObjectSchema,
        record.details ?? {},
        `AuditEvent(${record.action}).details`,
      ),
    },
  });
  return event.id;
}
