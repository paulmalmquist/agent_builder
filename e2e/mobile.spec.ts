import { expect, test, type Page } from '@playwright/test';

async function stubMobileReadModels(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/v1/attention') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          generatedAt: '2026-08-17T12:00:00.000Z',
          decide: [],
          degraded: [],
          digest: {
            headline: 'No new platform activity',
            runCount: 0,
            totalCostUsd: 0,
            promotionCount: 0,
            observationCount: 0,
            windowStartedAt: null,
            windowEndedAt: '2026-08-17T12:00:00.000Z',
          },
          decideBadgeCount: 0,
          lastDeliveredBriefingAt: '2026-08-17T11:00:00.000Z',
        }),
      });
      return;
    }
    if (path === '/v1/resources') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
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

test('mobile Registry has no horizontal document overflow', async ({ page }) => {
  await stubMobileReadModels(page);
  await page.goto('/registry');
  await expect(page.getByRole('heading', { level: 1, name: 'Registry' })).toBeVisible();
  await expect(page.getByText('No Plugin definitions are available.')).toBeVisible();
  await expect(page.getByText('No imported definitions match.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test('mobile Home keeps its hierarchy and controls inside the viewport', async ({ page }) => {
  await stubMobileReadModels(page);
  await page.goto('/');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /Build, run, prove, and improve governed work/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByText('Attention is the only place that interrupts you.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);

  const primary = page.getByRole('link', { name: /Open Attention/i });
  const primaryBox = await primary.boundingBox();
  expect(primaryBox?.height ?? 0).toBeGreaterThanOrEqual(44);
});
