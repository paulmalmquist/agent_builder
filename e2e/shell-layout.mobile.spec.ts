import { expect, test } from '@playwright/test';
import { stubConsoleReadModels } from './console-stubs.js';

test('mobile entity search remains a focused overlay', async ({ page }) => {
  await stubConsoleReadModels(page, { attention: 'empty' });
  await page.goto('/catalog');

  const trigger = page.getByRole('button', { name: 'Search governed entities' });
  await trigger.click();

  const search = page.getByRole('combobox', { name: 'Search governed entities' });
  await expect(search).toBeFocused();
  await expect(page.locator('.global-search-expanded')).toHaveCSS('position', 'fixed');

  await search.press('Escape');
  await expect(trigger).toBeFocused();
});
