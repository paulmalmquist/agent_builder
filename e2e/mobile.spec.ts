import { expect, test, type Page } from '@playwright/test';
import { stubConsoleReadModels } from './console-stubs.js';

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
}

test('mobile IA pages keep the fixed rail outside their content', async ({ page }) => {
  test.setTimeout(45_000);
  const { unexpectedRequests } = await stubConsoleReadModels(page, { attention: 'empty' });
  const routes = [
    { path: '/', heading: 'Work around now', level: 2 },
    { path: '/knowledge', heading: 'Knowledge', level: 1 },
    { path: '/catalog', heading: 'Catalog', level: 1 },
    { path: '/operate', heading: 'Operate', level: 1 },
    { path: '/connections', heading: 'Connections', level: 1 },
    { path: '/settings', heading: 'Settings', level: 1 },
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    await expect(
      page.getByRole('heading', { level: route.level, name: route.heading }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    const overlap = await page.evaluate(() => {
      const rail = document.querySelector<HTMLElement>('.platform-rail')?.getBoundingClientRect();
      const workspace = document
        .querySelector<HTMLElement>('.platform-workspace')
        ?.getBoundingClientRect();
      if (!rail || !workspace) return Number.POSITIVE_INFINITY;
      return Math.max(
        0,
        Math.min(rail.right, workspace.right) - Math.max(rail.left, workspace.left),
      );
    });
    expect(overlap).toBeLessThanOrEqual(0.5);
  }

  expect(unexpectedRequests).toEqual([]);
});

test('mobile Today keeps its timeline, disclosure, and decision handoff inside the viewport', async ({
  page,
}) => {
  await stubConsoleReadModels(page);
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 2, name: 'Work around now' })).toBeVisible();
  await expect(page.getByTestId('timeline-now')).toContainText('NOW');
  await expect(page.getByText('Meetings Not connected on this machine.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Needs you' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  const primary = page.getByRole('link', { name: /Open Attention/i });
  const primaryBox = await primary.boundingBox();
  expect(primaryBox?.height ?? 0).toBeGreaterThanOrEqual(42);
  await primary.click();
  await expect(page).toHaveURL(/\/attention$/);
});

test('mobile Registry and Connections distinguish definitions from installations', async ({
  page,
}) => {
  await stubConsoleReadModels(page, { attention: 'empty' });

  await page.goto('/registry');
  await expect(page.getByRole('heading', { level: 1, name: 'Registry' })).toBeVisible();
  await expect(page.getByText('No imported definitions match.')).toBeVisible();
  await expect(page.getByText('No Plugin definitions are available.')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  await page.goto('/connections');
  await expect(page.getByRole('heading', { level: 1, name: 'Connections' })).toBeVisible();
  await expect(page.getByText('No Plugin definitions are available.')).toBeVisible();
  await expect(page.getByText('No imported definitions match.')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
