import type { JsonValue } from '@agent-builder/contracts';

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: JsonValue | undefined;

  constructor(status: number, code: string, message: string, details?: JsonValue) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
