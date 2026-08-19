import { expect, test, type Page } from '@playwright/test';
import { stubConsoleReadModels } from './console-stubs.js';

async function searchCenterOffset(page: Page): Promise<number> {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>('.platform-workspace-header');
    const search = document.querySelector<HTMLElement>('.platform-workspace-header .global-search');
    if (!header || !search) return Number.POSITIVE_INFINITY;

    const headerBox = header.getBoundingClientRect();
    const searchBox = search.getBoundingClientRect();
    return Math.abs(searchBox.left + searchBox.width / 2 - (headerBox.left + headerBox.width / 2));
  });
}

test('desktop search stays centered and the main surface has no outer frame', async ({ page }) => {
  await stubConsoleReadModels(page, { attention: 'empty' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/catalog');

  await expect(page.getByRole('button', { name: 'Search governed entities' })).toBeVisible();
  await expect.poll(() => searchCenterOffset(page)).toBeLessThanOrEqual(0.5);

  const surface = page.locator('.os-surface');
  await expect(surface).toHaveCSS('border-top-width', '0px');
  await expect(surface).toHaveCSS('border-radius', '0px');
  await expect(surface).toHaveCSS('background-image', 'none');
  await expect(surface).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(surface).toHaveCSS('box-shadow', 'none');

  await page.keyboard.press('[');
  await expect(page.locator('.platform-shell')).toHaveAttribute('data-rail-collapsed', 'true');
  await expect.poll(() => searchCenterOffset(page)).toBeLessThanOrEqual(0.5);
});
