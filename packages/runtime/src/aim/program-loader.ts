import { aimProgramManifestSchema, type AimProgramManifest } from '@agent-builder/contracts/aim';
import type { ZodIssue } from 'zod';
import { normalizeAimProgram } from './program-normalizer.js';

const DEFAULT_MAX_MANIFEST_BYTES = 2_000_000;
const MAX_MANIFEST_DEPTH = 100;
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);

export interface AimManifestIssue {
  code: string;
  path: Array<string | number>;
  message: string;
}

export type AimProgramLoadResult =
  | { ok: true; manifest: AimProgramManifest; issues: [] }
  | { ok: false; manifest: null; issues: AimManifestIssue[] };

export interface AimProgramLoadOptions {
  maxBytes?: number;
}

export class AimManifestValidationError extends Error {
  readonly issues: AimManifestIssue[];

  constructor(issues: AimManifestIssue[]) {
    super('AIM program manifest validation failed');
    this.name = 'AimManifestValidationError';
    this.issues = issues;
  }
}

function issue(code: string, path: Array<string | number>, message: string): AimManifestIssue {
  return { code, path, message };
}

function safeIssue({ code, path, message }: ZodIssue): AimManifestIssue {
  return issue(code, path, message);
}

function findForbiddenKey(
  value: unknown,
  path: Array<string | number> = [],
  visited = new WeakSet<object>(),
): AimManifestIssue | null {
  if (path.length > MAX_MANIFEST_DEPTH) {
    return issue(
      'manifest_too_deep',
      path,
      `Manifest nesting exceeds ${MAX_MANIFEST_DEPTH} levels`,
    );
  }
  if (Array.isArray(value)) {
    if (visited.has(value)) return issue('cyclic_input', path, 'Manifest input must be acyclic');
    visited.add(value);
    for (let index = 0; index < value.length; index += 1) {
      const nested = findForbiddenKey(value[index], [...path, index], visited);
      if (nested !== null) return nested;
    }
    visited.delete(value);
    return null;
  }
  if (value === null || typeof value !== 'object') return null;
  if (visited.has(value)) return issue('cyclic_input', path, 'Manifest input must be acyclic');
  visited.add(value);
  const prototype = Reflect.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return issue('forbidden_prototype', path, 'Manifest objects must use a plain prototype');
  }
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKeys.has(key))
      return issue('forbidden_key', [...path, key], 'Prototype-mutating keys are forbidden');
    const nested = findForbiddenKey(nestedValue, [...path, key], visited);
    if (nested !== null) return nested;
  }
  visited.delete(value);
  return null;
}

/** Browser-safe, offline-only parser. It never logs, fetches, or resolves evidence URIs. */
export function loadAimProgram(
  input: unknown,
  options: AimProgramLoadOptions = {},
): AimProgramLoadResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_MANIFEST_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    return {
      ok: false,
      manifest: null,
      issues: [issue('invalid_loader_option', [], 'maxBytes must be a positive safe integer')],
    };
  }
  let candidate: unknown = input;
  if (typeof input === 'string') {
    if (new TextEncoder().encode(input).byteLength > maxBytes) {
      return {
        ok: false,
        manifest: null,
        issues: [issue('manifest_too_large', [], `Manifest exceeds ${maxBytes} bytes`)],
      };
    }
    try {
      candidate = JSON.parse(input) as unknown;
    } catch {
      return {
        ok: false,
        manifest: null,
        issues: [issue('invalid_json', [], 'Manifest is not valid JSON')],
      };
    }
  }
  const forbidden = findForbiddenKey(candidate);
  if (forbidden !== null) return { ok: false, manifest: null, issues: [forbidden] };
  if (typeof input !== 'string') {
    let encodedBytes: number;
    try {
      encodedBytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
    } catch {
      return {
        ok: false,
        manifest: null,
        issues: [issue('unserializable_input', [], 'Manifest input must be JSON serializable')],
      };
    }
    if (encodedBytes > maxBytes) {
      return {
        ok: false,
        manifest: null,
        issues: [issue('manifest_too_large', [], `Manifest exceeds ${maxBytes} bytes`)],
      };
    }
  }
  const parsed = aimProgramManifestSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, manifest: null, issues: parsed.error.issues.map(safeIssue) };
  }
  return { ok: true, manifest: normalizeAimProgram(parsed.data), issues: [] };
}

export function loadAimProgramOrThrow(
  input: unknown,
  options?: AimProgramLoadOptions,
): AimProgramManifest {
  const result = loadAimProgram(input, options);
  if (!result.ok) throw new AimManifestValidationError(result.issues);
  return result.manifest;
}

export function serializeAimProgram(manifest: AimProgramManifest): string {
  return `${JSON.stringify(normalizeAimProgram(aimProgramManifestSchema.parse(manifest)), null, 2)}\n`;
}
