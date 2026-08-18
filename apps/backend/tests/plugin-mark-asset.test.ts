import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResourceKind, type PrismaClient } from '@prisma/client';
import { compileResourceYaml } from '@paul-os/runtime';
import { assertPassivePluginSvg, loadPluginMarkAsset } from '../src/plugins/mark-asset.js';
import { PluginService } from '../src/services/plugin-service.js';

const safeSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 24 24"><title>Drafting registration mark</title><path fill="currentColor" d="M4 4h16v16H4z"/></svg>';

function manifest(mark = './mark.svg'): string {
  return JSON.stringify({
    apiVersion: 'paul-os/v1',
    kind: 'Plugin',
    metadata: {
      id: 'd0000000-0000-4000-8000-000000000099',
      slug: 'mark-test-http',
      version: '1.0.0',
      name: 'Mark Test HTTP',
      owner: 'test-owner',
      purpose: 'Exercise passive local Plugin mark delivery in a bounded fixture.',
      lifecycle: 'experimental',
      provenance: 'synthetic',
    },
    dependencies: [],
    spec: {
      transport: 'http',
      executionPlacement: 'control_plane',
      classification: 'public',
      brand: { mark, monogram: 'MT', accent: '#B9AAFF' },
      secretSlots: [],
      connection: {
        baseUrl: 'https://mark-test.example.invalid',
        allowedHosts: ['mark-test.example.invalid'],
        defaultHeaders: {},
      },
      health: {
        kind: 'http',
        intervalSeconds: 60,
        timeoutMs: 1000,
        method: 'HEAD',
        path: '/health',
        expectedStatuses: [200],
      },
      capabilities: [
        {
          tool: 'bounded_read',
          description: 'Read one bounded synthetic record.',
          effect: 'read',
          approval: 'not_required',
          scopeDescription: 'Read one synthetic record without writing to any source system.',
          inputSchema: { type: 'object', additionalProperties: false },
          outputSchema: { type: 'object', additionalProperties: false },
          limits: {
            timeoutMs: 1000,
            maxResponseBytes: 1000,
            maxRecords: 1,
            maxInvocationsPerRun: 1,
            maxEstimatedCostUsd: 0,
          },
          invocation: { method: 'GET', path: '/v1/record', headers: {} },
        },
      ],
    },
  });
}

async function fixture(markPath = './mark.svg') {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), 'paul-os-mark-'));
  const pluginDirectory = path.join(repositoryRoot, '00-core', 'plugins', 'mark-test-http');
  await mkdir(pluginDirectory, { recursive: true });
  const manifestYaml = manifest(markPath);
  await writeFile(path.join(pluginDirectory, 'manifest.yaml'), manifestYaml, 'utf8');
  return {
    expectedManifestDigest: compileResourceYaml(manifestYaml).digest,
    manifestYaml,
    markPath,
    markFile: path.join(pluginDirectory, markPath.replace(/^\.\//u, '')),
    pluginDirectory,
    repositoryRoot,
    sourcePath: '00-core/plugins/mark-test-http/manifest.yaml',
  };
}

const notFound = { code: 'PLUGIN_MARK_NOT_FOUND', status: 404 };

function expectSynchronousRejection(operation: () => void): void {
  let error: unknown;
  try {
    operation();
  } catch (caught) {
    error = caught;
  }
  expect(error).toMatchObject(notFound);
}

describe('Plugin mark asset boundary', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it('serves only a passive SVG beside the exact imported manifest', async () => {
    const input = await fixture();
    roots.push(input.repositoryRoot);
    await writeFile(input.markFile, safeSvg, 'utf8');

    const asset = await loadPluginMarkAsset(input);
    expect(asset.bytes.toString('utf8')).toBe(safeSvg);
    expect(asset.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('projects a content-addressed route into the catalog without exposing repository paths', async () => {
    const input = await fixture();
    roots.push(input.repositoryRoot);
    await writeFile(input.markFile, safeSvg, 'utf8');
    const compiled = compileResourceYaml(input.manifestYaml);
    const pluginVersionId = 'd0000000-0000-4000-8000-000000000098';
    const prisma = {
      resourceVersion: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: pluginVersionId,
            familyId: compiled.manifest.metadata.id,
            version: compiled.manifest.metadata.version,
            digest: compiled.digest,
            sourceCommit: 'fixture-commit',
            definition: compiled.manifest,
            family: {
              id: compiled.manifest.metadata.id,
              kind: ResourceKind.PLUGIN,
              slug: compiled.manifest.metadata.slug,
              name: compiled.manifest.metadata.name,
            },
            pluginInstallations: [],
          },
        ]),
      },
      authorityGrant: { findMany: jest.fn().mockResolvedValue([]) },
      pluginInvocation: { findMany: jest.fn().mockResolvedValue([]) },
      repositoryImport: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ sourceCommit: 'fixture-commit', sourcePath: input.sourcePath }),
      },
    } as unknown as PrismaClient;
    const service = new PluginService(
      prisma,
      { environment: 'test', repositoryRoot: input.repositoryRoot },
      { probe: jest.fn() },
    );

    const catalog = await service.listCatalog({ includeDisabled: false, limit: 50 });
    expect(catalog.items[0]?.brand.assetSrc).toMatch(
      new RegExp(`^/v1/plugins/${pluginVersionId}/mark/[a-f0-9]{64}\\.svg$`, 'u'),
    );
    expect(JSON.stringify(catalog)).not.toContain(input.markPath);
    expect(JSON.stringify(catalog)).not.toContain(input.sourcePath);
  });

  it.each([
    ['script', '<script>alert(1)</script>'],
    ['foreign object', '<foreignObject><div>unsafe</div></foreignObject>'],
    ['event handler', '<path onload="alert(1)" d="M0 0"/>'],
    ['external href', '<path href="https://assets.example.invalid/x" d="M0 0"/>'],
    ['external CSS URL', '<path fill="url(https://assets.example.invalid/x)" d="M0 0"/>'],
    ['style attribute', '<path style="fill:red" d="M0 0"/>'],
  ])('rejects %s content instead of attempting a partial sanitization', (_label, body) => {
    expectSynchronousRejection(() =>
      assertPassivePluginSvg(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`),
    );
  });

  it('rejects doctypes, entities, processing instructions, comments, and CDATA', () => {
    for (const candidate of [
      '<!DOCTYPE svg [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><title>&xxe;</title></svg>',
      '<?unsafe value?><svg xmlns="http://www.w3.org/2000/svg"/>',
      '<svg xmlns="http://www.w3.org/2000/svg"><!-- hidden --></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg"><title><![CDATA[value]]></title></svg>',
    ]) {
      expectSynchronousRejection(() => assertPassivePluginSvg(candidate));
    }
  });

  it('rejects traversal, absolute paths, wrong extensions, and missing files', async () => {
    const input = await fixture();
    roots.push(input.repositoryRoot);
    await writeFile(input.markFile, safeSvg, 'utf8');

    for (const override of [
      { sourcePath: '../manifest.yaml' },
      { sourcePath: 'apps/backend/package.json' },
      { markPath: '../mark.svg' },
      { markPath: '/tmp/mark.svg' },
      { markPath: './mark.png' },
      { markPath: './missing.svg' },
    ]) {
      await expect(loadPluginMarkAsset({ ...input, ...override })).rejects.toMatchObject(notFound);
    }
  });

  it('rejects symlinked asset directories even when their targets contain a valid SVG', async () => {
    const input = await fixture('./linked/mark.svg');
    roots.push(input.repositoryRoot);
    const outside = await mkdtemp(path.join(tmpdir(), 'paul-os-mark-outside-'));
    roots.push(outside);
    await writeFile(path.join(outside, 'mark.svg'), safeSvg, 'utf8');
    await symlink(outside, path.join(input.pluginDirectory, 'linked'), 'junction');

    await expect(loadPluginMarkAsset(input)).rejects.toMatchObject(notFound);
  });

  it('rejects oversized SVGs and source files that no longer match the imported digest', async () => {
    const oversized = await fixture();
    roots.push(oversized.repositoryRoot);
    await writeFile(oversized.markFile, `<svg>${' '.repeat(128 * 1024)}</svg>`, 'utf8');
    await expect(loadPluginMarkAsset(oversized)).rejects.toMatchObject(notFound);

    const drifted = await fixture();
    roots.push(drifted.repositoryRoot);
    await writeFile(drifted.markFile, safeSvg, 'utf8');
    await writeFile(
      path.join(drifted.pluginDirectory, 'manifest.yaml'),
      manifest('./different.svg'),
      'utf8',
    );
    await expect(loadPluginMarkAsset(drifted)).rejects.toMatchObject(notFound);
  });
});
