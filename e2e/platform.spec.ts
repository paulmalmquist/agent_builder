import { expect, test, type Page } from '@playwright/test';

async function stubReadModels(page: Page): Promise<void> {
  await page.route('**/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' });
  });
}

test('direct routes render through the consolidated console', async ({ page }) => {
  await stubReadModels(page);
  const routes = [
    ['/', /Build or extend the right agent/i],
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

test('Build and Runs remain keyboard operable', async ({ page }) => {
  await stubReadModels(page);
  await page.route('**/agents*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"mode":"catalog","items":[],"nextCursor":null}',
    });
  });

  await page.goto('/');
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-starfield-fallback="true"]')).toBeVisible();
  await expect(page.locator('canvas.starfield-canvas')).toHaveCount(0);
});
