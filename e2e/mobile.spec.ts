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
    { path: '/', heading: 'Today', level: 1 },
    { path: '/knowledge', heading: 'Knowledge', level: 1 },
    { path: '/aim', heading: 'AIM Capability Map', level: 1 },
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

test('mobile Today scopes Factory Operations while containing the wide plan', async ({ page }) => {
  await stubConsoleReadModels(page);
  await page.goto('/?vertical=group_factory');

  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByTestId('home-vertical-group_factory')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const health = page.getByTestId('home-band-health');
  const plan = page.getByTestId('home-band-plan');
  const action = page.getByTestId('home-band-action');
  await expect(health).toBeVisible();
  await expect(plan).toBeVisible();
  await expect(action).toBeVisible();

  const metricCount = await health.locator('.today-metric').count();
  expect(metricCount).toBeGreaterThan(0);
  await expect(health.locator('.today-metric [data-testid="kpi-source"]')).toHaveCount(metricCount);
  await expect(health.getByText('SYNTHETIC', { exact: true }).first()).toBeVisible();
  await expect(health.getByText('AWAITING TRANSFER', { exact: true })).toBeVisible();
  await expect(action.getByText('GLOBAL · READ-ONLY PREVIEW')).toBeVisible();
  await expect(action.getByText('Daily Briefing wants authority for one run.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);

  const ganttViewport = plan.getByTestId('home-gantt-viewport');
  await expect(ganttViewport).toBeVisible();
  expect(await ganttViewport.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(
    true,
  );
  await ganttViewport.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(await ganttViewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page);

  const primary = page.getByRole('link', { name: /Open Attention/i });
  const primaryBox = await primary.boundingBox();
  expect(primaryBox?.height ?? 0).toBeGreaterThanOrEqual(42);
  await primary.click();
  await expect(page).toHaveURL(/\/attention$/);
});

test('mobile Roadmaps contains the two-fork plan without widening the document', async ({
  page,
}) => {
  await stubConsoleReadModels(page, { attention: 'empty' });
  await page.goto('/roadmaps');

  await expect(page.getByRole('heading', { level: 1, name: 'Roadmaps' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare both' })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        timelineClientWidth:
          document.querySelector<HTMLElement>('.roadmap-band:has(.roadmap-timeline)')
            ?.clientWidth ?? 0,
        timelineScrollWidth:
          document.querySelector<HTMLElement>('.roadmap-band:has(.roadmap-timeline)')
            ?.scrollWidth ?? 0,
      })),
    )
    .toMatchObject({ documentWidth: 412, viewportWidth: 412 });

  const overflow = await page.evaluate(() => {
    const band = document.querySelector<HTMLElement>('.roadmap-band:has(.roadmap-timeline)');
    return band ? band.scrollWidth > band.clientWidth : false;
  });
  expect(overflow).toBe(true);
});

test('the console reflows at a 320 CSS-pixel viewport without obscuring keyboard focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const { unexpectedRequests } = await stubConsoleReadModels(page, { attention: 'empty' });

  for (const path of ['/', '/knowledge', '/aim'] as const) {
    await page.goto(path);
    await expectNoHorizontalOverflow(page);
  }

  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await page.keyboard.press('Tab');
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  const skipBox = await skipLink.boundingBox();
  expect(skipBox).not.toBeNull();
  expect(skipBox?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((skipBox?.x ?? 0) + (skipBox?.width ?? 0)).toBeLessThanOrEqual(320);
  await skipLink.press('Enter');
  await expect(page.locator('#platform-main')).toBeFocused();

  expect(unexpectedRequests).toEqual([]);
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
