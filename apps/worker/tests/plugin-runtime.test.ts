/* eslint-disable @typescript-eslint/require-await */
import {
  EnvironmentPluginSecretResolver,
  HttpPluginTransportAdapter,
  PluginTransportRegistry,
  UnavailablePluginTransportAdapter,
  pluginRuntimeDefinitionFromSpec,
  type PluginAuthorityScopeRuntime,
  type PluginHttpRequester,
  type PluginInstallationRuntime,
  type PluginRuntimeError,
  type PluginRuntimeDefinition,
} from '@paul-os/runtime';
import type { PluginResourceSpec } from '@agent-builder/contracts';

const pluginVersionId = '10000000-0000-4000-8000-000000000001';
const installationId = '20000000-0000-4000-8000-000000000001';
const pluginDigest = 'a'.repeat(64);

function httpSpec(): PluginResourceSpec {
  return {
    transport: 'http',
    executionPlacement: 'control_plane',
    classification: 'internal',
    secretSlots: [
      {
        name: 'vendor-token',
        description: 'Token dedicated to this synthetic Plugin.',
        required: true,
        environmentVariable: 'PLUGIN_VENDOR_TOKEN',
      },
    ],
    connection: {
      baseUrl: 'https://api.example.com/',
      allowedHosts: ['api.example.com'],
      defaultHeaders: { authorization: { secretSlot: 'vendor-token' } },
    },
    health: {
      kind: 'http',
      intervalSeconds: 300,
      timeoutMs: 1_000,
      method: 'GET',
      path: '/health',
      expectedStatuses: [200],
    },
    capabilities: [
      {
        tool: 'lookup',
        description: 'Looks up one governed synthetic record.',
        effect: 'read',
        approval: 'not_required',
        scopeDescription: 'Read one synthetic record without modifying it.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string', minLength: 1, maxLength: 20 } },
          required: ['id'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value'],
          additionalProperties: false,
        },
        limits: {
          timeoutMs: 1_000,
          maxResponseBytes: 128,
          maxRecords: 1,
          maxInvocationsPerRun: 2,
          maxEstimatedCostUsd: 0.01,
        },
        invocation: { method: 'GET', path: '/records', headers: {} },
      },
    ],
  };
}

function definition(): PluginRuntimeDefinition {
  return pluginRuntimeDefinitionFromSpec(
    { pluginVersionId, pluginVersion: '1.0.0', pluginDigest },
    httpSpec(),
  );
}

function installation(
  overrides: Partial<PluginInstallationRuntime> = {},
): PluginInstallationRuntime {
  return {
    id: installationId,
    pluginVersionId,
    pluginDigest,
    transport: 'http',
    placement: 'control_plane',
    state: 'enabled',
    developmentOnly: false,
    secretBindings: { 'vendor-token': 'env://PLUGIN_VENDOR_TOKEN' },
    ...overrides,
  };
}

function scope(overrides: Partial<PluginAuthorityScopeRuntime> = {}): PluginAuthorityScopeRuntime {
  return {
    installationId,
    pluginVersionId,
    pluginDigest,
    tool: 'lookup',
    effect: 'read',
    scopeDescription: 'Read one synthetic record without modifying it.',
    limits: {
      timeoutMs: 500,
      maxResponseBytes: 128,
      maxRecords: 1,
      maxInvocationsPerRun: 1,
      maxEstimatedCostUsd: 0.01,
    },
    ...overrides,
  };
}

function registry(requester: PluginHttpRequester): PluginTransportRegistry {
  const secrets = new EnvironmentPluginSecretResolver({ PLUGIN_VENDOR_TOKEN: 'plugin-secret' });
  return new PluginTransportRegistry([
    new HttpPluginTransportAdapter(
      secrets,
      async () => [{ address: '93.184.216.34', family: 4 }],
      requester,
    ),
  ]);
}

function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject<Partial<PluginRuntimeError>>({ code });
}

describe('HTTP Plugin runtime security boundary', () => {
  it('uses only the manifest route and the exact declared Plugin secret', async () => {
    const seen: Array<{ url: string; headers: Readonly<Record<string, string>> }> = [];
    const runtime = registry(async (url, request) => {
      seen.push({ url: url.toString(), headers: request.headers });
      return { status: 200, headers: {}, body: Buffer.from('{"value":"ok"}') };
    });

    await expect(
      runtime.callTool({
        definition: definition(),
        installation: installation(),
        scope: scope(),
        tool: 'lookup',
        input: { id: 'abc' },
      }),
    ).resolves.toMatchObject({ output: { value: 'ok' }, transport: 'http' });
    expect(seen).toEqual([
      {
        url: 'https://api.example.com/records?id=abc',
        headers: { accept: 'application/json', authorization: 'plugin-secret' },
      },
    ]);
  });

  it('rejects non-root base paths rather than silently discarding them', async () => {
    const governed = definition();
    const unsafe: PluginRuntimeDefinition = {
      ...governed,
      http: { ...governed.http!, baseUrl: 'https://api.example.com/vendor/v1/' },
    };
    await expectCode(
      registry(async () => ({ status: 200, headers: {}, body: Buffer.from('{}') })).callTool({
        definition: unsafe,
        installation: installation(),
        scope: scope(),
        tool: 'lookup',
        input: { id: 'abc' },
      }),
      'PLUGIN_HTTP_BASE_URL_FORBIDDEN',
    );
  });

  it('rejects encoded traversal and network-path routes', async () => {
    const governed = definition();
    for (const path of ['/%2e%2e/admin', '//api.example.com/admin']) {
      const unsafe: PluginRuntimeDefinition = {
        ...governed,
        tools: [{ ...governed.tools[0]!, http: { method: 'GET', path } }],
      };
      await expectCode(
        registry(async () => ({ status: 200, headers: {}, body: Buffer.from('{}') })).callTool({
          definition: unsafe,
          installation: installation(),
          scope: scope(),
          tool: 'lookup',
          input: { id: 'abc' },
        }),
        'PLUGIN_HTTP_ROUTE_INVALID',
      );
    }
  });

  it('blocks private or mixed DNS answers before opening a socket', async () => {
    const adapter = new HttpPluginTransportAdapter(
      new EnvironmentPluginSecretResolver({ PLUGIN_VENDOR_TOKEN: 'plugin-secret' }),
      async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    );
    const runtime = new PluginTransportRegistry([adapter]);
    await expectCode(
      runtime.callTool({
        definition: definition(),
        installation: installation(),
        scope: scope(),
        tool: 'lookup',
        input: { id: 'abc' },
      }),
      'PLUGIN_HTTP_ADDRESS_FORBIDDEN',
    );
  });

  it('rejects redirects that change origin', async () => {
    const runtime = registry(async () => ({
      status: 302,
      headers: { location: 'https://attacker.example/steal' },
      body: Buffer.alloc(0),
    }));
    await expectCode(
      runtime.callTool({
        definition: definition(),
        installation: installation(),
        scope: scope(),
        tool: 'lookup',
        input: { id: 'abc' },
      }),
      'PLUGIN_HTTP_REDIRECT_FORBIDDEN',
    );
  });

  it('applies forbidden-header checks to health probes too', async () => {
    const governed = definition();
    const unsafe: PluginRuntimeDefinition = {
      ...governed,
      http: {
        ...governed.http!,
        defaultSecretHeaders: [{ name: 'host', slot: 'vendor-token' }],
      },
    };
    await expectCode(
      registry(async () => ({ status: 200, headers: {}, body: Buffer.alloc(0) })).probe({
        definition: unsafe,
        installation: installation(),
      }),
      'PLUGIN_HTTP_SECRET_HEADER_FORBIDDEN',
    );
  });

  it('allows an installed Plugin to be health-checked before enablement', async () => {
    const runtime = registry(async () => ({ status: 200, headers: {}, body: Buffer.alloc(0) }));
    await expect(
      runtime.probe({
        definition: definition(),
        installation: installation({ state: 'installed' }),
      }),
    ).resolves.toMatchObject({ status: 'healthy' });
    await expectCode(
      runtime.probe({
        definition: definition(),
        installation: installation({ state: 'disabled' }),
      }),
      'PLUGIN_DISABLED',
    );
  });

  it('does not let a Plugin read an undeclared or core process secret', async () => {
    const resolver = new EnvironmentPluginSecretResolver({
      OTHER_VENDOR_TOKEN: 'other',
      DATABASE_URL: 'postgres://private',
    });
    const signal = new AbortController().signal;
    await expectCode(
      resolver.resolve({
        installationId,
        pluginVersionId,
        slot: 'vendor-token',
        reference: 'env://OTHER_VENDOR_TOKEN',
        allowedEnvironmentVariable: 'PLUGIN_VENDOR_TOKEN',
        signal,
      }),
      'PLUGIN_SECRET_REFERENCE_NOT_DECLARED',
    );
    await expectCode(
      resolver.resolve({
        installationId,
        pluginVersionId,
        slot: 'vendor-token',
        reference: 'env://DATABASE_URL',
        allowedEnvironmentVariable: 'DATABASE_URL',
        signal,
      }),
      'PLUGIN_CORE_SECRET_FORBIDDEN',
    );
  });

  it('validates closed input and output schemas', async () => {
    const runtime = registry(async () => ({
      status: 200,
      headers: {},
      body: Buffer.from('{"unexpected":true}'),
    }));
    await expectCode(
      runtime.callTool({
        definition: definition(),
        installation: installation(),
        scope: scope(),
        tool: 'lookup',
        input: { id: 'abc', injected: true },
      }),
      'PLUGIN_INPUT_SCHEMA_INVALID',
    );
    await expectCode(
      runtime.callTool({
        definition: definition(),
        installation: installation(),
        scope: scope(),
        tool: 'lookup',
        input: { id: 'abc' },
      }),
      'PLUGIN_OUTPUT_SCHEMA_INVALID',
    );
  });

  it('enforces response caps even for an injected requester', async () => {
    const runtime = registry(async () => ({
      status: 200,
      headers: {},
      body: Buffer.alloc(129, 0x20),
    }));
    await expectCode(
      runtime.callTool({
        definition: definition(),
        installation: installation(),
        scope: scope(),
        tool: 'lookup',
        input: { id: 'abc' },
      }),
      'PLUGIN_OUTPUT_LIMIT_EXCEEDED',
    );
  });

  it('enforces the request cap for query-based tools', async () => {
    const governed = definition();
    const lookup = governed.tools[0]!;
    const widenedInput: PluginRuntimeDefinition = {
      ...governed,
      tools: [
        {
          ...lookup,
          inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', maxLength: 1_000 } },
            required: ['id'],
            additionalProperties: false,
          },
        },
      ],
    };
    await expectCode(
      registry(async () => ({
        status: 200,
        headers: {},
        body: Buffer.from('{"value":"ok"}'),
      })).callTool({
        definition: widenedInput,
        installation: installation(),
        scope: scope(),
        tool: 'lookup',
        input: { id: 'x'.repeat(200) },
      }),
      'PLUGIN_INPUT_LIMIT_EXCEEDED',
    );
  });

  it('enforces the authorized record count across collection output', async () => {
    const governed = definition();
    const lookup = governed.tools[0]!;
    const collectionDefinition: PluginRuntimeDefinition = {
      ...governed,
      tools: [
        {
          ...lookup,
          outputSchema: {
            type: 'object',
            properties: {
              records: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { value: { type: 'string' } },
                  required: ['value'],
                  additionalProperties: false,
                },
              },
            },
            required: ['records'],
            additionalProperties: false,
          },
        },
      ],
    };
    await expectCode(
      registry(async () => ({
        status: 200,
        headers: {},
        body: Buffer.from('{"records":[{"value":"one"},{"value":"two"}]}'),
      })).callTool({
        definition: collectionDefinition,
        installation: installation(),
        scope: scope(),
        tool: 'lookup',
        input: { id: 'abc' },
      }),
      'PLUGIN_RECORD_LIMIT_EXCEEDED',
    );
  });

  it('rejects effect and limit escalation', async () => {
    const runtime = registry(async () => ({
      status: 200,
      headers: {},
      body: Buffer.from('{"value":"ok"}'),
    }));
    await expectCode(
      runtime.callTool({
        definition: definition(),
        installation: installation(),
        scope: scope({ effect: 'write' }),
        tool: 'lookup',
        input: { id: 'abc' },
      }),
      'PLUGIN_AUTHORITY_SCOPE_MISMATCH',
    );
    await expectCode(
      runtime.callTool({
        definition: definition(),
        installation: installation(),
        scope: scope({ limits: { ...scope().limits, maxResponseBytes: 129 } }),
        tool: 'lookup',
        input: { id: 'abc' },
      }),
      'PLUGIN_LIMIT_ESCALATION',
    );
  });

  it('fails closed for workstation and unimplemented transports', async () => {
    const runtime = registry(async () => ({
      status: 200,
      headers: {},
      body: Buffer.from('{"value":"ok"}'),
    }));
    await expectCode(
      runtime.callTool({
        definition: { ...definition(), placement: 'workstation' },
        installation: installation({ placement: 'workstation' }),
        scope: scope(),
        tool: 'lookup',
        input: { id: 'abc' },
      }),
      'PLUGIN_WORKSTATION_UNAVAILABLE',
    );

    const unavailable = new PluginTransportRegistry([
      new UnavailablePluginTransportAdapter('mcp'),
      new UnavailablePluginTransportAdapter('cli'),
      new UnavailablePluginTransportAdapter('db'),
    ]);
    for (const transport of ['mcp', 'cli', 'db'] as const) {
      const baseDefinition = { ...definition() };
      delete baseDefinition.http;
      await expectCode(
        unavailable.listTools({ ...baseDefinition, transport }, { ...installation(), transport }),
        `PLUGIN_${transport.toUpperCase()}_UNAVAILABLE`,
      );
    }
  });
});
