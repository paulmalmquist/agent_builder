import { expect, test } from '@playwright/test';

test('mobile Registry has no horizontal document overflow', async ({ page }) => {
  await page.route('**/v1/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' });
  });
  await page.goto('/registry');
  await expect(page.getByRole('heading', { level: 1, name: 'Registry' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});
