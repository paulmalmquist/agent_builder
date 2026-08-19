import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertAcyclicDependencies,
  compileContentTree,
  compileResourceYaml,
  discoverResourceManifestPaths,
} from '@paul-os/runtime';
import { createOpenApiDocument, pluginCatalogItemSchema } from '@agent-builder/contracts';

const workspaceRoot = process.cwd().endsWith(path.join('apps', 'backend'))
  ? path.resolve(process.cwd(), '..', '..')
  : process.cwd();

const pluginPath = path.join(
  workspaceRoot,
  '00-core',
  'plugins',
  'synthetic-planning-http',
  'manifest.yaml',
);
const packPath = path.join(
  workspaceRoot,
  '06-business-domains',
  'personal-productivity',
  'plugins',
  'manifest.yaml',
);

async function validPlugin(): Promise<Record<string, unknown>> {
  return structuredClone(compileResourceYaml(await readFile(pluginPath, 'utf8')).manifest);
}

describe('Plugin resource contracts', () => {
  it('recursively discovers and deterministically compiles manifest-only Plugins and packs', async () => {
    const paths = await discoverResourceManifestPaths(workspaceRoot);
    expect(paths).toEqual(expect.arrayContaining([pluginPath, packPath]));
    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)));

    const first = await compileContentTree(workspaceRoot);
    const second = await compileContentTree(workspaceRoot);
    expect(first.map(({ sourcePath, digest }) => ({ sourcePath, digest }))).toEqual(
      second.map(({ sourcePath, digest }) => ({ sourcePath, digest })),
    );
    expect(first).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourcePath: '00-core/plugins/synthetic-planning-http/manifest.yaml',
          manifest: expect.objectContaining({ kind: 'Plugin' }),
        }),
        expect.objectContaining({
          sourcePath: '06-business-domains/personal-productivity/plugins/manifest.yaml',
          manifest: expect.objectContaining({ kind: 'PluginPack' }),
        }),
      ]),
    );
    const canonical = first.find(
      ({ sourcePath }) => sourcePath === '00-core/plugins/synthetic-planning-http/manifest.yaml',
    );
    expect(canonical?.manifest.spec).toEqual(
      expect.objectContaining({
        health: expect.objectContaining({ intervalSeconds: 60 }),
        capabilities: expect.arrayContaining([
          expect.objectContaining({ invocation: expect.objectContaining({ path: '/v1/records' }) }),
        ]),
      }),
    );
  });

  it('rejects credential values disguised as environment-variable declarations', async () => {
    const candidate = await validPlugin();
    const spec = candidate['spec'] as Record<string, unknown>;
    spec['secretSlots'] = [
      {
        name: 'api_token',
        description: 'A synthetic API token supplied by the environment.',
        required: true,
        environmentVariable: 'API_TOKEN=not-a-reference',
      },
    ];
    expect(() => compileResourceYaml(JSON.stringify(candidate))).toThrow();
  });

  it.each([
    ['cleartext URL', 'http://planning.example.invalid'],
    ['credential-bearing URL', 'https://user:password@planning.example.invalid'],
    ['URL with injected query', 'https://planning.example.invalid?redirect=attacker.invalid'],
  ])('rejects a %s', async (_label, baseUrl) => {
    const candidate = await validPlugin();
    const spec = candidate['spec'] as { connection: Record<string, unknown> };
    spec.connection['baseUrl'] = baseUrl;
    expect(() => compileResourceYaml(JSON.stringify(candidate))).toThrow();
  });

  it('rejects shell fragments and any CLI request for shell execution', async () => {
    const candidate = await validPlugin();
    candidate['kind'] = 'Plugin';
    candidate['spec'] = {
      transport: 'cli',
      executionPlacement: 'workstation',
      classification: 'internal',
      secretSlots: [],
      connection: {
        executable: 'tool.exe',
        args: ['status; remove-all'],
        shell: true,
        env: {},
      },
      health: {
        kind: 'cli',
        intervalSeconds: 300,
        timeoutMs: 3000,
        args: ['status'],
      },
      capabilities: [],
    };
    expect(() => compileResourceYaml(JSON.stringify(candidate))).toThrow();
  });

  it('rejects open or remotely-referenced tool schemas', async () => {
    const candidate = await validPlugin();
    const spec = candidate['spec'] as { capabilities: Array<Record<string, unknown>> };
    spec.capabilities[0]!['inputSchema'] = {
      type: 'object',
      additionalProperties: true,
      $ref: 'https://attacker.invalid/schema.json',
    };
    expect(() => compileResourceYaml(JSON.stringify(candidate))).toThrow();
  });

  it('rejects effects weaker than transport semantics', async () => {
    const candidate = await validPlugin();
    const spec = candidate['spec'] as { capabilities: Array<Record<string, unknown>> };
    const capability = spec.capabilities[0]!;
    capability['effect'] = 'read';
    capability['approval'] = 'not_required';
    capability['invocation'] = { method: 'DELETE', path: '/v1/records', headers: {} };
    expect(() => compileResourceYaml(JSON.stringify(candidate))).toThrow(/destructive effect/);
  });

  it.each([
    ['remote URL', 'https://assets.example.invalid/mark.svg'],
    ['protocol-relative URL', '//assets.example.invalid/mark.svg'],
    ['absolute path', '/assets/mark.svg'],
    ['Windows path', 'C:\\assets\\mark.svg'],
    ['parent traversal', '../mark.svg'],
    ['non-SVG asset', './mark.png'],
  ])('rejects a %s for a Plugin mark', async (_label, mark) => {
    const candidate = await validPlugin();
    const spec = candidate['spec'] as Record<string, unknown>;
    spec['brand'] = { monogram: 'SP', accent: '#B9AAFF', mark };
    expect(() => compileResourceYaml(JSON.stringify(candidate))).toThrow();
  });

  it('accepts a local SVG mark only with its monogram and accent fallback', async () => {
    const candidate = await validPlugin();
    const spec = candidate['spec'] as Record<string, unknown>;
    spec['brand'] = { monogram: 'SP', accent: '#B9AAFF', mark: './mark.svg' };
    expect(() => compileResourceYaml(JSON.stringify(candidate))).not.toThrow();
    spec['brand'] = { mark: './mark.svg' };
    expect(() => compileResourceYaml(JSON.stringify(candidate))).toThrow();
  });

  it('rejects path templates that the HTTP runtime cannot interpolate', async () => {
    const candidate = await validPlugin();
    const spec = candidate['spec'] as { capabilities: Array<Record<string, unknown>> };
    const capability = spec.capabilities[0]!;
    capability['invocation'] = {
      ...(capability['invocation'] as Record<string, unknown>),
      path: '/v1/records/{descriptor}',
    };
    expect(() => compileResourceYaml(JSON.stringify(candidate))).toThrow(/path templates/);
  });

  it('rejects unresolved exact pins and PluginPack scopes broader than declarations', async () => {
    const plugin = compileResourceYaml(await readFile(pluginPath, 'utf8')).manifest;
    const pack = compileResourceYaml(await readFile(packPath, 'utf8')).manifest;
    const broadened = structuredClone(pack);
    const packSpec = broadened.spec as {
      plugins: Array<{ defaultScopes: Array<{ limits: { maxRecords?: number } }> }>;
    };
    packSpec.plugins[0]!.defaultScopes[0]!.limits.maxRecords = 101;
    expect(() => assertAcyclicDependencies([plugin, broadened])).toThrow(/broadens/);

    const unresolved = structuredClone(pack);
    unresolved.dependencies[0]!.version = '2.0.0';
    expect(() => assertAcyclicDependencies([plugin, unresolved])).toThrow(
      /Unresolved exact resource dependency/,
    );
  });

  it('publishes stable operation identifiers for every Plugin operation', () => {
    const paths = createOpenApiDocument().paths;
    const operationIds: string[] = [];
    for (const item of Object.values(paths) as unknown[]) {
      if (item === undefined || item === null || typeof item !== 'object') continue;
      for (const operation of Object.values(item as Record<string, unknown>)) {
        if (
          operation !== null &&
          typeof operation === 'object' &&
          'operationId' in operation &&
          typeof operation.operationId === 'string'
        ) {
          operationIds.push(operation.operationId);
        }
      }
    }
    expect(operationIds).toEqual(
      expect.arrayContaining([
        'listPlugins',
        'getPlugin',
        'getPluginMark',
        'listPluginInstallations',
        'installPlugin',
        'getPluginInstallation',
        'configurePluginInstallation',
        'checkPluginHealth',
        'enablePluginInstallation',
        'disablePluginInstallation',
        'getPluginUsedBy',
        'uninstallPlugin',
      ]),
    );
  });

  it('exposes only sanitized secret-slot declarations in Plugin catalog cards', () => {
    const catalogItem = {
      pluginVersionId: 'd0000000-0000-4000-8000-000000000001',
      familyId: 'd0000000-0000-4000-8000-000000000001',
      slug: 'synthetic-planning-http',
      name: 'Synthetic Planning API',
      version: '1.0.0',
      digest: 'a'.repeat(64),
      transport: 'http',
      executionPlacement: 'control_plane',
      classification: 'public',
      brand: { monogram: 'SP', accent: '#B9AAFF' },
      capabilities: [],
      secretSlots: [
        {
          name: 'api_token',
          description: 'Credential used to authenticate the synthetic connector.',
          required: true,
        },
      ],
      activeScopeDescriptions: ['Read bounded synthetic planning records only.'],
      costThisWeekUsd: 0,
      installationId: null,
      installationState: null,
      healthStatus: 'unknown',
      lastUsedAt: null,
    };
    const parsed = pluginCatalogItemSchema.parse(catalogItem);
    expect(parsed.brand).toEqual({ monogram: 'SP', accent: '#B9AAFF', assetSrc: null });
    expect(
      pluginCatalogItemSchema.safeParse({
        ...catalogItem,
        brand: { ...catalogItem.brand, mark: './private/repository/path.svg' },
      }).success,
    ).toBe(false);
    expect(
      pluginCatalogItemSchema.safeParse({
        ...catalogItem,
        secretSlots: [
          {
            ...catalogItem.secretSlots[0],
            environmentVariable: 'PRIVATE_TOKEN',
          },
        ],
      }).success,
    ).toBe(false);
  });
});
