import { Prisma } from '@prisma/client';
import { parseOrThrow } from '@agent-builder/contracts';
import type { z } from 'zod';

export function parseJson<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed: unknown = parseOrThrow(schema, value, label);
  return parsed as T;
}

export function toPrismaJson<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): Prisma.InputJsonValue {
  const parsed = parseOrThrow(schema, value, label);
  if (parsed === null) {
    return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  }
  return parsed as Prisma.InputJsonValue;
}
