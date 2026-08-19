import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  pluginResourceSpecSchema,
  type JsonValue,
  type PluginResourceSpec,
} from '@agent-builder/contracts';

export type PluginTransport = 'mcp' | 'http' | 'cli' | 'db';
export type PluginExecutionPlacement = 'control_plane' | 'workstation';
export type PluginEffect = 'read' | 'write' | 'destructive';

export interface PluginLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRecords?: number | undefined;
  maxInvocationsPerRun: number;
  maximumBytesBilled?: number | undefined;
  maxEstimatedCostUsd?: number | undefined;
}

export interface PluginHttpRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  secretHeaders?: ReadonlyArray<{
    name: string;
    slot: string;
    prefix?: string;
  }>;
}

export interface PluginTool {
  name: string;
  description: string;
  effect: PluginEffect;
  inputSchema: Record<string, JsonValue>;
  outputSchema: Record<string, JsonValue>;
  limits: PluginLimits;
  http?: PluginHttpRoute;
}

export interface PluginRuntimeDefinition {
  pluginVersionId: string;
  pluginVersion: string;
  pluginDigest: string;
  transport: PluginTransport;
  placement: PluginExecutionPlacement;
  tools: readonly PluginTool[];
  secretSlots: readonly string[];
  /** Environment variables are usable only when the manifest assigns that exact variable to the slot. */
  secretEnvironmentVariables: Readonly<Record<string, string | null>>;
  http?: {
    baseUrl: string;
    allowedHosts: readonly string[];
    defaultSecretHeaders: ReadonlyArray<{ name: string; slot: string }>;
    health: {
      method: 'GET' | 'HEAD';
      path: string;
      expectedStatuses: readonly number[];
      timeoutMs: number;
    };
  };
}

export interface PluginInstallationRuntime {
  id: string;
  pluginVersionId: string;
  pluginDigest: string;
  transport: PluginTransport;
  placement: PluginExecutionPlacement;
  state: 'installed' | 'enabled' | 'disabled' | 'degraded';
  developmentOnly: boolean;
  secretBindings: Readonly<Record<string, string>>;
}

export function pluginRuntimeDefinitionFromSpec(
  identity: {
    pluginVersionId: string;
    pluginVersion: string;
    pluginDigest: string;
  },
  input: PluginResourceSpec,
): PluginRuntimeDefinition {
  const spec = pluginResourceSpecSchema.parse(input);
  const tools: PluginTool[] = spec.capabilities.map((capability) => {
    const common = {
      name: capability.tool,
      description: capability.description,
      effect: capability.effect,
      inputSchema: capability.inputSchema,
      outputSchema: capability.outputSchema,
      limits: capability.limits,
    } satisfies Omit<PluginTool, 'http'>;
    if (spec.transport !== 'http' || !('method' in capability.invocation)) return common;
    const combinedHeaders = new Map<string, string>();
    for (const [name, binding] of Object.entries(spec.connection.defaultHeaders)) {
      combinedHeaders.set(name.toLowerCase(), binding.secretSlot);
    }
    for (const [name, binding] of Object.entries(capability.invocation.headers)) {
      const normalized = name.toLowerCase();
      const existing = combinedHeaders.get(normalized);
      if (existing !== undefined && existing !== binding.secretSlot) {
        throw new PluginRuntimeError('PLUGIN_HTTP_SECRET_HEADER_CONFLICT', false);
      }
      combinedHeaders.set(normalized, binding.secretSlot);
    }
    return {
      ...common,
      http: {
        method: capability.invocation.method,
        path: capability.invocation.path,
        secretHeaders: [...combinedHeaders].map(([name, slot]) => ({ name, slot })),
      },
    };
  });
  return {
    ...identity,
    transport: spec.transport,
    placement: spec.executionPlacement,
    tools,
    secretSlots: spec.secretSlots.map(({ name }) => name),
    secretEnvironmentVariables: Object.fromEntries(
      spec.secretSlots.map(({ name, environmentVariable }) => [name, environmentVariable ?? null]),
    ),
    ...(spec.transport === 'http'
      ? {
          http: {
            baseUrl: spec.connection.baseUrl,
            allowedHosts: spec.connection.allowedHosts,
            defaultSecretHeaders: Object.entries(spec.connection.defaultHeaders).map(
              ([name, binding]) => ({ name: name.toLowerCase(), slot: binding.secretSlot }),
            ),
            health: {
              method: spec.health.method,
              path: spec.health.path,
              expectedStatuses: spec.health.expectedStatuses,
              timeoutMs: spec.health.timeoutMs,
            },
          },
        }
      : {}),
  };
}

export interface PluginAuthorityScopeRuntime {
  installationId: string;
  pluginVersionId: string;
  pluginDigest: string;
  tool: string;
  effect: PluginEffect;
  scopeDescription: string;
  limits: PluginLimits;
}

export interface PluginCallRequest {
  definition: PluginRuntimeDefinition;
  installation: PluginInstallationRuntime;
  scope: PluginAuthorityScopeRuntime;
  tool: string;
  input: JsonValue;
  signal?: AbortSignal;
}

export interface PluginCallResult {
  output: JsonValue;
  latencyMs: number;
  costUsd: number | null;
  transport: PluginTransport;
}

export interface PluginHealthProbeRequest {
  definition: PluginRuntimeDefinition;
  installation: PluginInstallationRuntime;
  signal?: AbortSignal;
}

export interface PluginHealthProbeResult {
  status: 'healthy' | 'degraded' | 'unavailable';
  message: string;
  latencyMs: number;
}

export interface PluginHealthProbe {
  probe(input: PluginHealthProbeRequest): Promise<PluginHealthProbeResult>;
}

export interface PluginSecretResolution {
  installationId: string;
  pluginVersionId: string;
  slot: string;
  reference: string;
  allowedEnvironmentVariable: string | null;
  signal: AbortSignal;
}

export interface PluginSecretResolver {
  resolve(input: PluginSecretResolution): Promise<string>;
}

export interface PluginTransportAdapter {
  readonly transport: PluginTransport;
  listTools(
    definition: PluginRuntimeDefinition,
    installation: PluginInstallationRuntime,
  ): Promise<readonly PluginTool[]>;
  callTool(request: PluginCallRequest, tool: PluginTool, signal: AbortSignal): Promise<JsonValue>;
  probe?(
    definition: PluginRuntimeDefinition,
    installation: PluginInstallationRuntime,
    signal: AbortSignal,
  ): Promise<PluginHealthProbeResult>;
}

export class PluginRuntimeError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message = code,
  ) {
    super(message);
    this.name = 'PluginRuntimeError';
  }
}

const effectRank: Record<PluginEffect, number> = { read: 0, write: 1, destructive: 2 };
const limitKeys = [
  'timeoutMs',
  'maxResponseBytes',
  'maxRecords',
  'maxInvocationsPerRun',
  'maximumBytesBilled',
  'maxEstimatedCostUsd',
] as const;

function assertPositiveLimit(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new PluginRuntimeError('PLUGIN_LIMIT_INVALID', false, `${name} must be non-negative`);
  }
}

export function assertScopeNarrowsTool(
  tool: PluginTool,
  scope: PluginAuthorityScopeRuntime,
): PluginLimits {
  if (scope.tool !== tool.name || scope.effect !== tool.effect) {
    throw new PluginRuntimeError('PLUGIN_AUTHORITY_SCOPE_MISMATCH', false);
  }
  if (effectRank[scope.effect] < effectRank[tool.effect]) {
    throw new PluginRuntimeError('PLUGIN_EFFECT_ESCALATION', false);
  }
  const effective: PluginLimits = { ...tool.limits };
  for (const key of limitKeys) {
    const declared = tool.limits[key];
    const authorized = scope.limits[key];
    if (declared !== undefined) assertPositiveLimit(key, declared);
    if (authorized === undefined) continue;
    assertPositiveLimit(key, authorized);
    if (declared === undefined || authorized > declared) {
      throw new PluginRuntimeError('PLUGIN_LIMIT_ESCALATION', false, `${key} broadens the tool`);
    }
    Object.assign(effective, { [key]: authorized });
  }
  return effective;
}

const supportedSchemaKeywords = new Set([
  '$defs',
  'definitions',
  '$ref',
  '$schema',
  'title',
  'description',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'minItems',
  'maxItems',
]);

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function schemaObject(value: unknown, code: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new PluginRuntimeError(code, false, 'A JSON Schema node must be an object');
  }
  return value as Record<string, unknown>;
}

function validateSchemaNode(
  schemaValue: unknown,
  value: unknown,
  path: string,
  state: { nodes: number },
  rootSchema: Record<string, unknown>,
): void {
  state.nodes += 1;
  if (state.nodes > 1_000 || path.split('.').length > 32) {
    throw new PluginRuntimeError('PLUGIN_SCHEMA_COMPLEXITY_EXCEEDED', false);
  }
  const schema = schemaObject(schemaValue, 'PLUGIN_SCHEMA_INVALID');
  for (const keyword of Object.keys(schema)) {
    if (!supportedSchemaKeywords.has(keyword)) {
      throw new PluginRuntimeError(
        'PLUGIN_SCHEMA_UNSUPPORTED',
        false,
        `Unsupported JSON Schema keyword: ${keyword}`,
      );
    }
  }
  const reference = schema['$ref'];
  if (reference !== undefined) {
    if (
      typeof reference !== 'string' ||
      !/^#\/(?:\$defs|definitions)\/[A-Za-z0-9._-]+$/.test(reference)
    ) {
      throw new PluginRuntimeError(
        'PLUGIN_SCHEMA_UNSUPPORTED',
        false,
        'Only simple local refs are supported',
      );
    }
    const [, containerName, definitionName] = reference.split('/');
    const container = rootSchema[containerName ?? ''];
    const definitions = schemaObject(container, 'PLUGIN_SCHEMA_INVALID');
    const resolved = definitions[definitionName ?? ''];
    if (resolved === undefined) {
      throw new PluginRuntimeError(
        'PLUGIN_SCHEMA_INVALID',
        false,
        `Unknown local ref: ${reference}`,
      );
    }
    validateSchemaNode(resolved, value, path, state, rootSchema);
    return;
  }
  const enumeration = schema['enum'];
  if (enumeration !== undefined) {
    if (
      !Array.isArray(enumeration) ||
      !enumeration.some((candidate) => sameJson(candidate, value))
    ) {
      throw new PluginRuntimeError(
        'PLUGIN_SCHEMA_VALIDATION_FAILED',
        false,
        `${path} is not allowed`,
      );
    }
  }
  if ('const' in schema && !sameJson(schema['const'], value)) {
    throw new PluginRuntimeError(
      'PLUGIN_SCHEMA_VALIDATION_FAILED',
      false,
      `${path} is not constant`,
    );
  }
  const type = schema['type'];
  if (typeof type !== 'string') {
    throw new PluginRuntimeError(
      'PLUGIN_SCHEMA_UNSUPPORTED',
      false,
      'Schema type must be explicit',
    );
  }
  const validType =
    (type === 'null' && value === null) ||
    (type === 'object' && value !== null && !Array.isArray(value) && typeof value === 'object') ||
    (type === 'array' && Array.isArray(value)) ||
    (type === 'string' && typeof value === 'string') ||
    (type === 'boolean' && typeof value === 'boolean') ||
    (type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (type === 'integer' && typeof value === 'number' && Number.isInteger(value));
  if (!validType) {
    throw new PluginRuntimeError(
      'PLUGIN_SCHEMA_VALIDATION_FAILED',
      false,
      `${path} must be ${type}`,
    );
  }
  if (typeof value === 'string') {
    const minimum = schema['minLength'];
    const maximum = schema['maxLength'];
    if (typeof minimum === 'number' && value.length < minimum) {
      throw new PluginRuntimeError(
        'PLUGIN_SCHEMA_VALIDATION_FAILED',
        false,
        `${path} is too short`,
      );
    }
    if (typeof maximum === 'number' && value.length > maximum) {
      throw new PluginRuntimeError('PLUGIN_SCHEMA_VALIDATION_FAILED', false, `${path} is too long`);
    }
  }
  if (typeof value === 'number') {
    const minimum = schema['minimum'];
    const maximum = schema['maximum'];
    if (typeof minimum === 'number' && value < minimum) {
      throw new PluginRuntimeError(
        'PLUGIN_SCHEMA_VALIDATION_FAILED',
        false,
        `${path} is too small`,
      );
    }
    if (typeof maximum === 'number' && value > maximum) {
      throw new PluginRuntimeError(
        'PLUGIN_SCHEMA_VALIDATION_FAILED',
        false,
        `${path} is too large`,
      );
    }
  }
  if (Array.isArray(value)) {
    const minimum = schema['minItems'];
    const maximum = schema['maxItems'];
    if (typeof minimum === 'number' && value.length < minimum) {
      throw new PluginRuntimeError(
        'PLUGIN_SCHEMA_VALIDATION_FAILED',
        false,
        `${path} has too few items`,
      );
    }
    if (typeof maximum === 'number' && value.length > maximum) {
      throw new PluginRuntimeError(
        'PLUGIN_SCHEMA_VALIDATION_FAILED',
        false,
        `${path} has too many items`,
      );
    }
    const items = schema['items'];
    if (items === undefined) {
      throw new PluginRuntimeError('PLUGIN_SCHEMA_UNSUPPORTED', false, 'Array schemas need items');
    }
    value.forEach((item, index) =>
      validateSchemaNode(items, item, `${path}[${index}]`, state, rootSchema),
    );
  }
  if (value !== null && !Array.isArray(value) && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const properties = schema['properties'];
    const propertySchemas =
      properties === undefined ? {} : schemaObject(properties, 'PLUGIN_SCHEMA_INVALID');
    const required = schema['required'];
    if (
      required !== undefined &&
      (!Array.isArray(required) || required.some((key) => typeof key !== 'string'))
    ) {
      throw new PluginRuntimeError('PLUGIN_SCHEMA_INVALID', false, 'required must be string keys');
    }
    for (const key of (required as string[] | undefined) ?? []) {
      if (!(key in record)) {
        throw new PluginRuntimeError(
          'PLUGIN_SCHEMA_VALIDATION_FAILED',
          false,
          `${path}.${key} is required`,
        );
      }
    }
    for (const [key, nested] of Object.entries(record)) {
      const nestedSchema = propertySchemas[key];
      if (nestedSchema !== undefined) {
        validateSchemaNode(nestedSchema, nested, `${path}.${key}`, state, rootSchema);
        continue;
      }
      const additional = schema['additionalProperties'];
      if (additional === false) {
        throw new PluginRuntimeError(
          'PLUGIN_SCHEMA_VALIDATION_FAILED',
          false,
          `${path}.${key} is not allowed`,
        );
      }
      if (additional !== undefined && additional !== true) {
        validateSchemaNode(additional, nested, `${path}.${key}`, state, rootSchema);
      }
    }
  }
}

export function assertPluginJsonSchema(
  schema: Record<string, JsonValue>,
  value: JsonValue,
  label: 'input' | 'output',
): void {
  try {
    validateSchemaNode(schema, value, '$', { nodes: 0 }, schema);
  } catch (error: unknown) {
    if (error instanceof PluginRuntimeError) {
      if (error.code === 'PLUGIN_SCHEMA_VALIDATION_FAILED') {
        throw new PluginRuntimeError(
          `PLUGIN_${label.toUpperCase()}_SCHEMA_INVALID`,
          false,
          error.message,
        );
      }
      throw error;
    }
    throw new PluginRuntimeError('PLUGIN_SCHEMA_INVALID', false);
  }
}

function assertPluginRecordLimit(value: JsonValue, maximum: number | undefined): void {
  if (maximum === undefined) return;
  let records = 0;
  const visit = (candidate: JsonValue): void => {
    if (Array.isArray(candidate)) {
      records += candidate.length;
      if (records > maximum) {
        throw new PluginRuntimeError('PLUGIN_RECORD_LIMIT_EXCEEDED', false);
      }
      candidate.forEach(visit);
      return;
    }
    if (candidate !== null && typeof candidate === 'object') {
      Object.values(candidate).forEach(visit);
    }
  };
  visit(value);
}

const forbiddenCoreEnvironmentNames = new Set([
  'DATABASE_URL',
  'AUTH_BEARER_TOKEN',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GCP_ACCESS_TOKEN',
  'NODE_OPTIONS',
]);

export class EnvironmentPluginSecretResolver implements PluginSecretResolver {
  constructor(private readonly environment: Readonly<NodeJS.ProcessEnv>) {}

  async resolve(input: PluginSecretResolution): Promise<string> {
    await Promise.resolve();
    if (input.signal.aborted) throw new PluginRuntimeError('PLUGIN_CALL_CANCELLED', false);
    if (!input.reference.startsWith('env://')) {
      throw new PluginRuntimeError('PLUGIN_SECRET_REFERENCE_UNSUPPORTED', false);
    }
    const name = input.reference.slice('env://'.length);
    if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(name)) {
      throw new PluginRuntimeError('PLUGIN_SECRET_REFERENCE_INVALID', false);
    }
    if (
      forbiddenCoreEnvironmentNames.has(name) ||
      /^(?:PAUL_OS|WORKER|MODEL|POSTGRES|PRISMA|AUTH|GCP|GOOGLE)_/.test(name)
    ) {
      throw new PluginRuntimeError('PLUGIN_CORE_SECRET_FORBIDDEN', false);
    }
    if (input.allowedEnvironmentVariable === null || name !== input.allowedEnvironmentVariable) {
      throw new PluginRuntimeError('PLUGIN_SECRET_REFERENCE_NOT_DECLARED', false);
    }
    const value = this.environment[name];
    if (value === undefined || value.length === 0) {
      throw new PluginRuntimeError('PLUGIN_SECRET_UNAVAILABLE', false);
    }
    return value;
  }
}

function ipv4Number(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  if (octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return null;
  return (((octets[0]! * 256 + octets[1]!) * 256 + octets[2]!) * 256 + octets[3]!) >>> 0;
}

function inIpv4Range(value: number, base: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (base & mask);
}

function publicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;
  const denied: ReadonlyArray<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  return !denied.some(([base, prefix]) => inIpv4Range(value, ipv4Number(base)!, prefix));
}

function ipv6Value(address: string): bigint | null {
  const normalized = address.toLowerCase();
  if (normalized.includes('%')) return null;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1] !== undefined) {
    const ipv4 = ipv4Number(mapped[1]);
    return ipv4 === null ? null : (0xffffn << 32n) | BigInt(ipv4);
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] === '' ? [] : halves[0]!.split(':');
  const right = halves.length === 1 || halves[1] === '' ? [] : halves[1]!.split(':');
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((total, group) => (total << 16n) | BigInt(`0x${group}`), 0n);
}

function publicIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1] !== undefined) return publicIpv4(mapped[1]);
  const value = ipv6Value(normalized);
  if (value === null) return false;
  // Public unicast is currently allocated from 2000::/3. Documentation space is never callable.
  const publicUnicast = value >> 125n === 1n;
  const documentation = value >> 96n === 0x20010db8n;
  return publicUnicast && !documentation;
}

export function isPublicPluginAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? publicIpv4(address) : family === 6 ? publicIpv6(address) : false;
}

export type PluginDnsResolver = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string; family: 4 | 6 }>>;

const defaultDnsResolver: PluginDnsResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.flatMap(({ address, family }) =>
    family === 4 || family === 6 ? [{ address, family }] : [],
  );
};

interface RawHttpResponse {
  status: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: Buffer;
}

export type PluginHttpRequester = (
  url: URL,
  request: { method: string; headers: Readonly<Record<string, string>>; body: Buffer | null },
  maximumBytes: number,
  signal: AbortSignal,
) => Promise<RawHttpResponse>;

function defaultHttpRequester(dns: PluginDnsResolver): PluginHttpRequester {
  return async (url, input, maximumBytes, signal) => {
    const records = await dns(url.hostname);
    if (records.length === 0 || records.some(({ address }) => !isPublicPluginAddress(address))) {
      throw new PluginRuntimeError('PLUGIN_HTTP_ADDRESS_FORBIDDEN', false);
    }
    const destination = records[0];
    if (destination === undefined) throw new PluginRuntimeError('PLUGIN_HTTP_DNS_EMPTY', true);
    return new Promise<RawHttpResponse>((resolve, reject) => {
      const request = httpsRequest(
        {
          protocol: 'https:',
          hostname: destination.address,
          family: destination.family,
          port: url.port === '' ? 443 : Number(url.port),
          servername: url.hostname,
          path: `${url.pathname}${url.search}`,
          method: input.method,
          headers: { ...input.headers, host: url.host },
          rejectUnauthorized: true,
          signal,
        },
        (response) => {
          const contentLength = Number(response.headers['content-length'] ?? 0);
          if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
            response.destroy();
            reject(new PluginRuntimeError('PLUGIN_OUTPUT_LIMIT_EXCEEDED', false));
            return;
          }
          const encoding = response.headers['content-encoding'];
          if (encoding !== undefined && encoding !== 'identity') {
            response.destroy();
            reject(new PluginRuntimeError('PLUGIN_HTTP_CONTENT_ENCODING_FORBIDDEN', false));
            return;
          }
          const chunks: Buffer[] = [];
          let length = 0;
          response.on('data', (chunk: Buffer | string) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            length += bytes.length;
            if (length > maximumBytes) {
              response.destroy(new PluginRuntimeError('PLUGIN_OUTPUT_LIMIT_EXCEEDED', false));
              return;
            }
            chunks.push(bytes);
          });
          response.on('error', reject);
          response.on('end', () => {
            const headers = Object.fromEntries(
              Object.entries(response.headers).map(([key, value]) => [key, value]),
            );
            resolve({ status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) });
          });
        },
      );
      request.on('error', reject);
      if (input.body !== null) request.write(input.body);
      request.end();
    });
  };
}

const forbiddenHeaders = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function assertSafeSecretHeaderName(input: string): string {
  const name = input.toLowerCase();
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name) || forbiddenHeaders.has(name)) {
    throw new PluginRuntimeError('PLUGIN_HTTP_SECRET_HEADER_FORBIDDEN', false);
  }
  return name;
}

function fixedRouteUrl(baseUrl: string, routePath: string): URL {
  if (
    !routePath.startsWith('/') ||
    routePath.startsWith('//') ||
    routePath.includes('#') ||
    routePath.includes('?')
  ) {
    throw new PluginRuntimeError('PLUGIN_HTTP_ROUTE_INVALID', false);
  }
  for (const segment of routePath.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new PluginRuntimeError('PLUGIN_HTTP_ROUTE_INVALID', false);
    }
    if (
      decoded === '.' ||
      decoded === '..' ||
      decoded.includes('/') ||
      decoded.includes('\\') ||
      decoded.includes('\0')
    ) {
      throw new PluginRuntimeError('PLUGIN_HTTP_ROUTE_INVALID', false);
    }
  }
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || base.username !== '' || base.password !== '') {
    throw new PluginRuntimeError('PLUGIN_HTTP_BASE_URL_FORBIDDEN', false);
  }
  if (base.pathname !== '/' || base.search !== '' || base.hash !== '') {
    throw new PluginRuntimeError('PLUGIN_HTTP_BASE_URL_FORBIDDEN', false);
  }
  if (base.port !== '' && base.port !== '443') {
    throw new PluginRuntimeError('PLUGIN_HTTP_PORT_FORBIDDEN', false);
  }
  const result = new URL(routePath, `${base.origin}/`);
  if (result.origin !== base.origin) {
    throw new PluginRuntimeError('PLUGIN_HTTP_ROUTE_INVALID', false);
  }
  return result;
}

function assertAllowedHttpUrl(url: URL, allowedHosts: readonly string[]): void {
  const normalizedHosts = new Set(
    allowedHosts.map((host) => {
      if (!/^[a-z0-9.-]+$/i.test(host) || host.includes('*')) {
        throw new PluginRuntimeError('PLUGIN_HTTP_HOST_ALLOWLIST_INVALID', false);
      }
      return host.toLowerCase().replace(/\.$/, '');
    }),
  );
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!normalizedHosts.has(hostname)) {
    throw new PluginRuntimeError('PLUGIN_HTTP_HOST_NOT_ALLOWED', false);
  }
}

function queryInput(url: URL, input: JsonValue): void {
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new PluginRuntimeError('PLUGIN_HTTP_QUERY_INPUT_INVALID', false);
  }
  for (const [key, value] of Object.entries(input).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(key)) {
      throw new PluginRuntimeError('PLUGIN_HTTP_QUERY_INPUT_INVALID', false);
    }
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
        throw new PluginRuntimeError('PLUGIN_HTTP_QUERY_INPUT_INVALID', false);
      }
      const serialized =
        typeof item === 'string'
          ? item
          : typeof item === 'number'
            ? item.toString()
            : item
              ? 'true'
              : 'false';
      url.searchParams.append(key, serialized);
    }
  }
}

export class HttpPluginTransportAdapter implements PluginTransportAdapter {
  readonly transport = 'http' as const;
  private readonly requester: PluginHttpRequester;

  constructor(
    private readonly secrets: PluginSecretResolver,
    dns: PluginDnsResolver = defaultDnsResolver,
    requester?: PluginHttpRequester,
  ) {
    this.requester = requester ?? defaultHttpRequester(dns);
  }

  listTools(
    definition: PluginRuntimeDefinition,
    installation: PluginInstallationRuntime,
  ): Promise<readonly PluginTool[]> {
    this.assertDefinition(definition, installation);
    return Promise.resolve(definition.tools);
  }

  async callTool(
    request: PluginCallRequest,
    tool: PluginTool,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    this.assertDefinition(request.definition, request.installation);
    const configuration = request.definition.http;
    const route = tool.http;
    if (configuration === undefined || route === undefined) {
      throw new PluginRuntimeError('PLUGIN_HTTP_CONFIGURATION_MISSING', false);
    }
    const limits = assertScopeNarrowsTool(tool, request.scope);
    assertPluginJsonSchema(tool.inputSchema, request.input, 'input');
    let url = fixedRouteUrl(configuration.baseUrl, route.path);
    assertAllowedHttpUrl(url, configuration.allowedHosts);
    const headers: Record<string, string> = { accept: 'application/json' };
    let body: Buffer | null = null;
    const serializedInput = Buffer.from(JSON.stringify(request.input));
    const maximumRequestBytes = Math.min(limits.maxResponseBytes, 1_000_000);
    if (serializedInput.byteLength > maximumRequestBytes) {
      throw new PluginRuntimeError('PLUGIN_INPUT_LIMIT_EXCEEDED', false);
    }
    if (route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH') {
      body = serializedInput;
      headers['content-type'] = 'application/json';
    } else {
      queryInput(url, request.input);
    }
    const declaredSlots = new Set(request.definition.secretSlots);
    for (const binding of route.secretHeaders ?? []) {
      const name = assertSafeSecretHeaderName(binding.name);
      if (!declaredSlots.has(binding.slot)) {
        throw new PluginRuntimeError('PLUGIN_SECRET_SLOT_UNDECLARED', false);
      }
      const reference = request.installation.secretBindings[binding.slot];
      if (reference === undefined)
        throw new PluginRuntimeError('PLUGIN_SECRET_BINDING_MISSING', false);
      const secret = await this.secrets.resolve({
        installationId: request.installation.id,
        pluginVersionId: request.definition.pluginVersionId,
        slot: binding.slot,
        reference,
        allowedEnvironmentVariable:
          request.definition.secretEnvironmentVariables[binding.slot] ?? null,
        signal,
      });
      headers[name] = `${binding.prefix ?? ''}${secret}`;
    }

    let redirects = 0;
    const originalOrigin = url.origin;
    while (true) {
      if (signal.aborted) throw new PluginRuntimeError('PLUGIN_CALL_CANCELLED', false);
      const response = await this.requester(
        url,
        { method: route.method, headers, body },
        limits.maxResponseBytes,
        signal,
      );
      // Custom requesters must honor the same cap as the built-in requester.
      if (response.body.byteLength > limits.maxResponseBytes) {
        throw new PluginRuntimeError('PLUGIN_OUTPUT_LIMIT_EXCEEDED', false);
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const locationValue = response.headers['location'];
        const location: unknown = Array.isArray(locationValue)
          ? (locationValue as readonly unknown[])[0]
          : locationValue;
        if (typeof location !== 'string') {
          throw new PluginRuntimeError('PLUGIN_HTTP_REDIRECT_INVALID', false);
        }
        redirects += 1;
        if (redirects > 3) {
          throw new PluginRuntimeError('PLUGIN_HTTP_REDIRECT_LIMIT_EXCEEDED', false);
        }
        const redirected = new URL(location, url);
        if (redirected.protocol !== 'https:' || redirected.origin !== originalOrigin) {
          throw new PluginRuntimeError('PLUGIN_HTTP_REDIRECT_FORBIDDEN', false);
        }
        assertAllowedHttpUrl(redirected, configuration.allowedHosts);
        url = redirected;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new PluginRuntimeError(
          response.status === 408 || response.status === 429 || response.status >= 500
            ? 'PLUGIN_HTTP_DEPENDENCY_UNAVAILABLE'
            : 'PLUGIN_HTTP_REQUEST_REJECTED',
          response.status === 408 || response.status === 429 || response.status >= 500,
        );
      }
      let output: unknown;
      try {
        output = JSON.parse(response.body.toString('utf8')) as unknown;
      } catch {
        throw new PluginRuntimeError('PLUGIN_OUTPUT_INVALID_JSON', false);
      }
      assertPluginJsonSchema(tool.outputSchema, output as JsonValue, 'output');
      assertPluginRecordLimit(output as JsonValue, limits.maxRecords);
      return output as JsonValue;
    }
  }

  async probe(
    definition: PluginRuntimeDefinition,
    installation: PluginInstallationRuntime,
    signal: AbortSignal,
  ): Promise<PluginHealthProbeResult> {
    this.assertDefinition(definition, installation, true);
    const configuration = definition.http;
    if (configuration === undefined) {
      throw new PluginRuntimeError('PLUGIN_HTTP_CONFIGURATION_MISSING', false);
    }
    const url = fixedRouteUrl(configuration.baseUrl, configuration.health.path);
    assertAllowedHttpUrl(url, configuration.allowedHosts);
    const headers: Record<string, string> = { accept: 'application/json' };
    const declaredSlots = new Set(definition.secretSlots);
    for (const binding of configuration.defaultSecretHeaders) {
      const name = assertSafeSecretHeaderName(binding.name);
      if (!declaredSlots.has(binding.slot)) {
        throw new PluginRuntimeError('PLUGIN_SECRET_SLOT_UNDECLARED', false);
      }
      const reference = installation.secretBindings[binding.slot];
      if (reference === undefined)
        throw new PluginRuntimeError('PLUGIN_SECRET_BINDING_MISSING', false);
      const secret = await this.secrets.resolve({
        installationId: installation.id,
        pluginVersionId: definition.pluginVersionId,
        slot: binding.slot,
        reference,
        allowedEnvironmentVariable: definition.secretEnvironmentVariables[binding.slot] ?? null,
        signal,
      });
      headers[name] = secret;
    }
    const started = performance.now();
    try {
      const response = await this.requester(
        url,
        { method: configuration.health.method, headers, body: null },
        4_096,
        signal,
      );
      if (response.body.byteLength > 4_096) {
        throw new PluginRuntimeError('PLUGIN_OUTPUT_LIMIT_EXCEEDED', false);
      }
      const healthy = configuration.health.expectedStatuses.includes(response.status);
      return {
        status: healthy ? 'healthy' : 'degraded',
        message: healthy
          ? 'The Plugin health probe completed successfully.'
          : 'The Plugin health probe returned an unexpected status.',
        latencyMs: performance.now() - started,
      };
    } catch (error: unknown) {
      if (signal.aborted) throw error;
      return {
        status: 'unavailable',
        message: 'The Plugin health probe could not reach its governed endpoint.',
        latencyMs: performance.now() - started,
      };
    }
  }

  private assertDefinition(
    definition: PluginRuntimeDefinition,
    installation: PluginInstallationRuntime,
    healthProbe = false,
  ): void {
    if (definition.transport !== 'http' || installation.transport !== 'http') {
      throw new PluginRuntimeError('PLUGIN_TRANSPORT_MISMATCH', false);
    }
    if (definition.placement !== 'control_plane' || installation.placement !== 'control_plane') {
      throw new PluginRuntimeError('PLUGIN_WORKSTATION_UNAVAILABLE', false);
    }
    if (
      (healthProbe && installation.state === 'disabled') ||
      (!healthProbe && installation.state !== 'enabled')
    ) {
      throw new PluginRuntimeError('PLUGIN_DISABLED', false);
    }
    if (
      definition.pluginVersionId !== installation.pluginVersionId ||
      definition.pluginDigest !== installation.pluginDigest
    ) {
      throw new PluginRuntimeError('PLUGIN_INSTALLATION_SNAPSHOT_MISMATCH', false);
    }
  }
}

export class UnavailablePluginTransportAdapter implements PluginTransportAdapter {
  constructor(readonly transport: 'mcp' | 'cli' | 'db') {}

  listTools(): Promise<readonly PluginTool[]> {
    return Promise.reject(
      new PluginRuntimeError(`PLUGIN_${this.transport.toUpperCase()}_UNAVAILABLE`, false),
    );
  }

  callTool(): Promise<JsonValue> {
    return Promise.reject(
      new PluginRuntimeError(`PLUGIN_${this.transport.toUpperCase()}_UNAVAILABLE`, false),
    );
  }
}

export class PluginTransportRegistry {
  private readonly adapters = new Map<PluginTransport, PluginTransportAdapter>();

  constructor(adapters: readonly PluginTransportAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: PluginTransportAdapter): void {
    if (this.adapters.has(adapter.transport)) {
      throw new PluginRuntimeError('PLUGIN_TRANSPORT_ALREADY_REGISTERED', false);
    }
    this.adapters.set(adapter.transport, adapter);
  }

  async listTools(
    definition: PluginRuntimeDefinition,
    installation: PluginInstallationRuntime,
  ): Promise<readonly PluginTool[]> {
    return this.adapter(definition.transport).listTools(definition, installation);
  }

  async callTool(request: PluginCallRequest): Promise<PluginCallResult> {
    const adapter = this.adapter(request.definition.transport);
    const tool = request.definition.tools.find(({ name }) => name === request.tool);
    if (tool === undefined) throw new PluginRuntimeError('PLUGIN_TOOL_NOT_FOUND', false);
    if (
      request.scope.installationId !== request.installation.id ||
      request.scope.pluginVersionId !== request.definition.pluginVersionId ||
      request.scope.pluginDigest !== request.definition.pluginDigest
    ) {
      throw new PluginRuntimeError('PLUGIN_AUTHORITY_SCOPE_MISMATCH', false);
    }
    const limits = assertScopeNarrowsTool(tool, request.scope);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new PluginRuntimeError('PLUGIN_TIMEOUT', true)),
      limits.timeoutMs,
    );
    const signal =
      request.signal === undefined
        ? controller.signal
        : AbortSignal.any([request.signal, controller.signal]);
    const started = performance.now();
    try {
      const output = await adapter.callTool(request, tool, signal);
      return {
        output,
        latencyMs: performance.now() - started,
        costUsd: null,
        transport: adapter.transport,
      };
    } catch (error: unknown) {
      if (signal.aborted) {
        const reason: unknown = signal.reason as unknown;
        throw reason instanceof PluginRuntimeError
          ? reason
          : new PluginRuntimeError('PLUGIN_CALL_CANCELLED', false);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async probe(input: PluginHealthProbeRequest): Promise<PluginHealthProbeResult> {
    const adapter = this.adapter(input.definition.transport);
    if (adapter.probe === undefined) {
      throw new PluginRuntimeError(
        `PLUGIN_${input.definition.transport.toUpperCase()}_UNAVAILABLE`,
        false,
      );
    }
    const controller = new AbortController();
    const timeoutMs = input.definition.http?.health.timeoutMs ?? 1_000;
    const timeout = setTimeout(
      () => controller.abort(new PluginRuntimeError('PLUGIN_HEALTH_TIMEOUT', true)),
      timeoutMs,
    );
    const signal =
      input.signal === undefined
        ? controller.signal
        : AbortSignal.any([input.signal, controller.signal]);
    try {
      return await adapter.probe(input.definition, input.installation, signal);
    } finally {
      clearTimeout(timeout);
    }
  }

  private adapter(transport: PluginTransport): PluginTransportAdapter {
    const adapter = this.adapters.get(transport);
    if (adapter === undefined) {
      throw new PluginRuntimeError(`PLUGIN_${transport.toUpperCase()}_UNAVAILABLE`, false);
    }
    return adapter;
  }
}

export function pluginPayloadDigest(value: JsonValue): string {
  const canonical = (input: JsonValue): string => {
    if (input === null || typeof input !== 'object') return JSON.stringify(input);
    if (Array.isArray(input)) return `[${input.map(canonical).join(',')}]`;
    return `{${Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonical(nested)}`)
      .join(',')}}`;
  };
  return createHash('sha256').update(canonical(value)).digest('hex');
}
