import { expect, test, type Page } from '@playwright/test';

async function stubReadModels(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/attention') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: '2026-08-16T12:00:00.000Z',
          decide: [
            {
              id: 'execution_approval:14141414-1414-4141-8141-141414141414',
              kind: 'execution_approval',
              shelf: 'decide',
              headline: 'Daily Briefing asks for bounded authority',
              delta: 'One release · read-only calendar access · about $0.40 per run',
              status: 'decide',
              primaryAction: {
                kind: 'approve_run',
                label: 'Review and approve',
                consequence: 'Allows only matching work inside these limits.',
                undo: 'Revoke the grant to stop later matching work.',
                resourceId: '14141414-1414-4141-8141-141414141414',
                requiresRationale: true,
              },
              secondaryAction: {
                kind: 'reject_run',
                label: 'Reject request',
                consequence: 'Cancels this run and records your reason.',
                undo: 'Create a new request after its limits change.',
                resourceId: '14141414-1414-4141-8141-141414141414',
                requiresRationale: true,
              },
              cost: { period: 'run', usd: 0.4, budgetUsd: 0.5 },
              reason: 'The first run of a promoted release needs a human decision.',
              provenance: {
                sourceType: 'ApprovalRequest',
                sourceId: '27272727-2727-4272-8272-272727272727',
                actorId: 'local-user',
                requestId: null,
                explanation: 'No matching authority grant exists for this exact release.',
              },
              occurredAt: '2026-08-16T12:00:00.000Z',
              payload: {
                sourceType: 'ApprovalRequest',
                sourceId: '27272727-2727-4272-8272-272727272727',
                detailPath: '/runs',
                scopes: ['Calendar — read only'],
                runId: '14141414-1414-4141-8141-141414141414',
                candidateId: null,
                channelKey: null,
                releaseId: '16161616-1616-4161-8161-161616161616',
                evaluationId: null,
                expiresAt: null,
                reviewFacts: [
                  { label: 'Release', value: 'Daily Briefing production release' },
                  { label: 'Authority', value: 'Calendar — read only' },
                ],
                metadata: {},
              },
            },
          ],
          degraded: [],
          digest: {
            headline: '2 runs · $0.40 · 0 promotions since the last briefing',
            runCount: 2,
            totalCostUsd: 0.4,
            promotionCount: 0,
            observationCount: 0,
            windowStartedAt: null,
            windowEndedAt: '2026-08-16T12:00:00.000Z',
          },
          decideBadgeCount: 1,
          lastDeliveredBriefingAt: null,
        }),
      });
      return;
    }
    if (path.startsWith('/v1/production-channels/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          key: 'daily-operations',
          projectId: null,
          currentReleaseId: null,
          currentReleaseDigest: null,
          priorReleaseId: null,
          promotedBy: null,
          promotedAt: null,
          updatedAt: '2026-08-16T12:00:00.000Z',
        }),
      });
      return;
    }
    const emptyResponses: Record<string, object> = {
      '/v1/resources': {
        items: [],
        total: 0,
        countsByLifecycle: {
          experimental: 0,
          candidate: 0,
          evaluating: 0,
          evaluated: 0,
          certified: 0,
          production: 0,
          deprecated: 0,
        },
      },
      '/v1/plugins': { items: [] },
      '/v1/plugin-installations': { items: [] },
      '/v1/execution-runs': {
        items: [],
        total: 0,
        countsByState: {
          awaiting_approval: 0,
          queued: 0,
          running: 0,
          paused_budget: 0,
          paused_plugin: 0,
          succeeded: 0,
          failed: 0,
          cancelled: 0,
        },
      },
      '/v1/authority-grants': { items: [], total: 0, activeTotal: 0 },
      '/v1/automation-schedules': { items: [], total: 0, activeTotal: 0 },
      '/v1/outcomes': { items: [] },
      '/v1/metrics': { items: [] },
      '/v1/observations': { items: [] },
      '/v1/improvement-candidates': { items: [] },
      '/v1/memory-candidates': { items: [] },
    };
    const emptyResponse = emptyResponses[path];
    if (emptyResponse) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(emptyResponse),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' });
  });
}

test('direct routes render through the consolidated console', async ({ page }) => {
  await stubReadModels(page);
  const routes = [
    ['/', /Build, run, prove, and improve governed work/i],
    ['/attention', 'Attention'],
    ['/build', /Build or extend the right agent/i],
    ['/registry', 'Registry'],
    ['/runs', 'Runs & Approvals'],
    ['/evidence', 'Evidence'],
    ['/incubator', 'Incubator'],
    ['/aim', 'AIM Capability Vehicle'],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    if (path === '/registry') {
      await expect(page.getByText('No Plugin definitions are available.')).toBeVisible();
      await expect(page.getByText('No imported definitions match.')).toBeVisible();
    }
    if (path === '/evidence') {
      await expect(page.getByText('Current production release')).toBeVisible();
      await expect(page.getByText('No outcomes have been recorded.')).toBeVisible();
      await expect(page.getByText('No metrics have been observed.')).toBeVisible();
    }
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
});

test('Attention, Build, and Runs remain keyboard operable', async ({ page }) => {
  await stubReadModels(page);
  await page.route('**/agents*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"mode":"catalog","items":[],"nextCursor":null}',
    });
  });

  await page.goto('/attention');
  await expect(page.getByRole('heading', { level: 1, name: 'Attention' })).toBeVisible();
  await page.keyboard.press('j');
  await expect(page.getByRole('article').first()).toBeFocused();
  await page.keyboard.press('r');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: /Close Reject request/i })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Decision rationale')).toBeFocused();
  await page.keyboard.press('Escape');

  await page.goto('/build');
  await expect(page.getByRole('button', { name: 'Search governed agents' })).toBeVisible();
  await page.waitForTimeout(100);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Search governed agents' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Search governed agents' })).toBeFocused();

  await page.goto('/runs');
  await expect(page.getByRole('heading', { level: 1, name: 'Runs & Approvals' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
});

test('reduced motion renders a static sky', async ({ page }) => {
  await stubReadModels(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-starfield-fallback="true"]')).toBeVisible();
  await expect(page.locator('canvas.starfield-canvas')).toHaveCount(0);
});

test('Home presents the full platform and opens the lazy AIM capability map', async ({ page }) => {
  await stubReadModels(page);
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5173') externalRequests.push(request.url());
  });

  await page.goto('/');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /Build, run, prove, and improve governed work/i,
    }),
  ).toBeVisible();
  await expect(page.locator('.primary-button')).toHaveCount(1);
  await expect(page.getByRole('link', { name: /Build or reuse/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open registry/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Review runs/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Review evidence/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open incubator/i })).toBeVisible();

  await page.getByRole('link', { name: /Open capability map/i }).click();
  await expect(page).toHaveURL(/\/aim$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'AIM Capability Vehicle' }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByText(/conceptual capability proxy/i)).toBeVisible();
  expect(externalRequests).toEqual([]);
});
