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
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' });
  });
}

test('direct routes render through the consolidated console', async ({ page }) => {
  await stubReadModels(page);
  const routes = [
    ['/', 'Attention'],
    ['/build', /Build or extend the right agent/i],
    ['/registry', 'Registry'],
    ['/runs', 'Runs & Approvals'],
    ['/evidence', 'Evidence'],
    ['/incubator', 'Incubator'],
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
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

  await page.goto('/');
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
