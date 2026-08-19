import { expect, test, type Page } from '@playwright/test';
import { stubConsoleReadModels } from './console-stubs.js';

const benchAgentId = '11111111-1111-4111-8111-111111111111';
const benchResourceId = '22222222-2222-4222-8222-222222222222';
const benchPluginVersionId = '33333333-3333-4333-8333-333333333333';
const benchPluginFamilyId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const fixtureTime = '2026-08-18T13:00:00.000Z';

const benchAgent = {
  id: benchAgentId,
  familyId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'synthetic-inspector-v1',
  versionNumber: 1,
  predecessorAgentId: null,
  derivationMode: 'new',
  name: 'Synthetic inspector',
  department: 'Manufacturing Operations',
  purpose: 'Inspect synthetic records and produce a bounded cited report.',
  owner: 'Manufacturing Operations',
  status: 'ready',
  capabilities: ['inspect records'],
  manifest: null,
  manifestHash: null,
  certificationHealth: 'not_certified',
  degradedAt: null,
  degradationReason: null,
  createdAt: fixtureTime,
  updatedAt: fixtureTime,
};

const benchResource = {
  id: benchResourceId,
  familyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  kind: 'Agent',
  slug: 'synthetic-inspector',
  name: 'Synthetic inspector',
  version: '1.0.0',
  owner: 'Manufacturing Operations',
  purpose: 'Inspect synthetic records and produce a bounded cited report.',
  lifecycle: 'candidate',
  digest: 'b'.repeat(64),
  sourceCommit: 'synthetic-e2e-commit',
  provenance: { source: 'synthetic-e2e' },
  dependencyPins: [],
  definition: {
    apiVersion: 'paul-os/v1',
    kind: 'Agent',
    metadata: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      slug: 'synthetic-inspector',
      version: '1.0.0',
      name: 'Synthetic inspector',
      owner: 'Manufacturing Operations',
      purpose: 'Inspect synthetic records and produce a bounded cited report.',
      lifecycle: 'candidate',
      provenance: { source: 'synthetic-e2e' },
    },
    dependencies: [],
    spec: {
      objective: 'Inspect synthetic records and produce a bounded cited report.',
      skills: ['record-inspection@1.0.0'],
      protocols: [],
      contextPolicy: 'default-context@1.0.0',
      knowledgeSources: [],
      tools: [
        {
          plugin: { familyId: benchPluginFamilyId, version: '1.0.0' },
          tool: 'inspect_records',
        },
      ],
      triggers: [],
      executionLoop: {
        maximumSteps: 8,
        onUnresolved: 'fail_closed',
        outputContract: 'inspection-report@1.0.0',
      },
      memoryPolicy: { reads: 'none', writes: 'disabled' },
      production: { requiresImmutableRelease: true, authorityClass: 'R2' },
      legacyCompatibility: {
        agentId: benchAgentId,
        department: 'Manufacturing Operations',
        specificationRevision: null,
        sectionDigests: { outcomes: null, knowledge: null, guardrails: null, outputs: null },
        capabilitiesDigest: 'c'.repeat(64),
        manifestDigest: null,
      },
    },
  },
  revision: 1,
  frozenAt: null,
  createdAt: fixtureTime,
  updatedAt: fixtureTime,
};

const benchPlugin = {
  pluginVersionId: benchPluginVersionId,
  familyId: benchPluginFamilyId,
  slug: 'records',
  name: 'Records warehouse',
  version: '1.0.0',
  digest: 'a'.repeat(64),
  transport: 'db',
  executionPlacement: 'control_plane',
  classification: 'internal',
  brand: { monogram: 'RW', accent: '#2f9d82', assetSrc: null },
  capabilities: [
    {
      tool: 'inspect_records',
      description: 'Inspect bounded records through a typed schema.',
      effect: 'read',
      approval: 'not_required',
      scopeDescription: 'Read the requested bounded synthetic records only',
      limits: {
        timeoutMs: 5_000,
        maxResponseBytes: 250_000,
        maxRecords: 100,
        maxInvocationsPerRun: 5,
        maxEstimatedCostUsd: 0.05,
      },
    },
  ],
  secretSlots: [],
  activeScopeDescriptions: [],
  costThisWeekUsd: 0,
  installationId: null,
  installationState: null,
  healthStatus: 'unknown',
  lastUsedAt: null,
};

async function stubBenchReadModels(page: Page): Promise<void> {
  await page.route(`**/agents/${benchAgentId}`, async (route) => {
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(benchAgent) });
  });
  await page.route('**/v1/resources?*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        items: [benchResource],
        total: 1,
        countsByLifecycle: {
          experimental: 0,
          candidate: 1,
          evaluating: 0,
          evaluated: 0,
          certified: 0,
          production: 0,
          deprecated: 0,
        },
      }),
    });
  });
  await page.route('**/v1/plugins?*', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ items: [benchPlugin] }),
    });
  });
}

test('Observatory renders fixture flow with a truthful ledger timing overlay', async ({ page }) => {
  const { unexpectedRequests } = await stubConsoleReadModels(page, { attention: 'empty' });
  await page.goto('/observatory');

  await expect(
    page.getByRole('heading', { level: 1, name: 'One day through the factory' }),
  ).toBeVisible();
  await expect(page.getByText('FIXTURE DATA')).toBeVisible();
  await expect(
    page.getByText('LEDGER TIMING OVERLAY · LATEST PAGE · NO RUNS RETURNED'),
  ).toBeVisible();
  await page.getByRole('slider', { name: 'Time in the fixture day' }).fill('12');
  await expect(page.locator('.observatory-scrubber output')).toContainText('12:00');
  expect(unexpectedRequests).toEqual([]);
});

test('History Terrain renders its six-month fixture and scrubber', async ({ page }) => {
  const { unexpectedRequests } = await stubConsoleReadModels(page, { attention: 'empty' });
  await page.goto('/history');

  await expect(
    page.getByRole('heading', { level: 1, name: 'The last six months, as terrain' }),
  ).toBeVisible();
  await expect(page.getByText('FIXTURE DATA')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'History week' })).toBeVisible();
  expect(unexpectedRequests).toEqual([]);
});

test('Signal Wall is a fullscreen fixture route with no console rail', async ({ page }) => {
  await page.goto('/wall');

  await expect(
    page.getByRole('heading', { level: 1, name: 'The wall triages itself' }),
  ).toBeVisible();
  await expect(page.getByText('FIXTURE DATA')).toBeVisible();
  await expect(page.locator('.platform-rail')).toHaveCount(0);
  await page.getByRole('button', { name: 'SORT · GROUPED' }).click();
  await expect(page.getByRole('button', { name: 'SORT · GROUPED' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const group of ['AGENTS', 'CONNECTORS', 'STREAMS', 'PROGRAM', 'YOU']) {
    await expect(page.locator(`[data-signal-group="${group}"]`)).toBeVisible();
  }
  const representatives = page.locator('.signal-wall-row-name--representative');
  await expect(representatives).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) {
    await expect(representatives.nth(index)).toBeVisible();
    await expect(representatives.nth(index)).toHaveText(/\S/u);
  }

  await page.getByRole('button', { name: 'REPLAYING' }).click();
  const replayPosition = page.getByLabel('Replay position');
  const pausedSample = await replayPosition.getAttribute('data-sample-index');
  await page.waitForTimeout(900);
  await expect(replayPosition).toHaveAttribute('data-sample-index', pausedSample ?? '');
  await page.getByRole('button', { name: 'PAUSED' }).click();
  await expect.poll(() => replayPosition.getAttribute('data-sample-index')).not.toBe(pausedSample);
});

test('Assembly Bench reads the exact fixture manifest and remains read-only', async ({ page }) => {
  const { unexpectedRequests } = await stubConsoleReadModels(page, { attention: 'empty' });
  await stubBenchReadModels(page);
  await page.goto(`/bench/${benchAgentId}`);

  await expect(
    page.getByRole('heading', { level: 1, name: 'See what this agent knows and can do.' }),
  ).toBeVisible();
  await expect(page.getByText('SYNTHETIC MANIFEST').first()).toBeVisible();
  await expect(page.getByText('NO DIRECT MUTATIONS')).toBeVisible();
  await expect(page.getByTestId('assembly-bench-webgl')).toBeVisible();
  await expect(page.getByTestId('assembly-bench-manifest')).toContainText('inspect_records');
  expect(unexpectedRequests).toEqual([]);
});
