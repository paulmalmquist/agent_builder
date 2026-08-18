import { expect, test, type Page } from '@playwright/test';
import { stubConsoleReadModels } from './console-stubs.js';

async function expectSettledWithoutAlerts(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByText('Loading review queue…')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function expectRailDoesNotOverlapWorkspace(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const rail = document.querySelector<HTMLElement>('.platform-rail');
        const workspace = document.querySelector<HTMLElement>('.platform-workspace');
        if (!rail || !workspace) return Number.POSITIVE_INFINITY;
        const railBox = rail.getBoundingClientRect();
        const workspaceBox = workspace.getBoundingClientRect();
        return Math.max(
          0,
          Math.min(railBox.right, workspaceBox.right) - Math.max(railBox.left, workspaceBox.left),
        );
      }),
    )
    .toBeLessThanOrEqual(0.5);
}

test('canonical and compatibility routes settle through the numbered console', async ({ page }) => {
  test.setTimeout(60_000);
  const { unexpectedRequests } = await stubConsoleReadModels(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const routes = [
    { path: '/', heading: null, active: 'TODAY' },
    { path: '/attention', heading: 'Attention', active: 'ATTENTION' },
    { path: '/knowledge', heading: 'Knowledge', active: 'KNOWLEDGE' },
    { path: '/build', heading: /Build or extend the right agent/i, active: 'BUILD' },
    { path: '/catalog', heading: 'Catalog', active: 'CATALOG' },
    { path: '/operate', heading: 'Operate', active: 'OPERATE' },
    { path: '/connections', heading: 'Connections', active: 'CONNECTIONS' },
    { path: '/evidence', heading: 'Evidence', active: 'EVIDENCE' },
    { path: '/incubator', heading: 'Incubator', active: 'INCUBATOR' },
    { path: '/settings', heading: 'Settings', active: 'SETTINGS' },
    { path: '/registry', heading: 'Registry', active: 'CATALOG' },
    { path: '/library', heading: 'Agent Library', active: 'CATALOG' },
    { path: '/runs', heading: 'Operate', active: 'OPERATE' },
    { path: '/aim', heading: 'AIM Capability Vehicle', active: 'CATALOG' },
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    if (route.heading === null) {
      await expect(page.locator('.today-heading h1')).toHaveText(
        /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), .+ \d{1,2}, \d{4}$/,
      );
      await expect(page.getByRole('heading', { level: 2, name: 'Work around now' })).toBeVisible();
    } else {
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
    }
    await expect(page.locator('.platform-rail-link[aria-current="page"]')).toContainText(
      route.active,
    );
    await expectSettledWithoutAlerts(page);
  }

  expect(unexpectedRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('the fixed numbered rail collapses, persists, and never covers workspace content', async ({
  page,
}) => {
  await stubConsoleReadModels(page, { attention: 'empty' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const shell = page.locator('.platform-shell');
  const navNumbers = page.locator('.platform-rail-number');
  await expect(navNumbers).toHaveText(['00', '01', '02', '03', '04', '05', '06', '07', '08', '—']);
  await expect(shell).toHaveAttribute('data-rail-collapsed', 'false');
  await expectRailDoesNotOverlapWorkspace(page);

  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
  await expect(page.locator('.platform-rail')).toHaveCSS('position', 'fixed');
  await expectRailDoesNotOverlapWorkspace(page);

  await page.keyboard.press('[');
  await expect(shell).toHaveAttribute('data-rail-collapsed', 'true');
  await expect(page.getByRole('button', { name: 'Expand navigation' })).toBeVisible();
  await expectRailDoesNotOverlapWorkspace(page);
  expect(await page.evaluate(() => window.localStorage.getItem('paul-os:rail-collapsed:v1'))).toBe(
    'true',
  );

  await page.reload();
  await expect(shell).toHaveAttribute('data-rail-collapsed', 'true');
  await expect(page.locator('.platform-rail-link[aria-current="page"]')).toHaveAccessibleName(
    'TODAY',
  );
  await expectRailDoesNotOverlapWorkspace(page);

  await page.getByRole('button', { name: 'Expand navigation' }).click();
  await expect(shell).toHaveAttribute('data-rail-collapsed', 'false');
  await expectRailDoesNotOverlapWorkspace(page);
});

test('Attention and entity search shortcuts stay isolated while people type', async ({ page }) => {
  const { unexpectedRequests } = await stubConsoleReadModels(page);
  await page.goto('/attention');
  await expect(page.getByRole('heading', { level: 1, name: 'Attention' })).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);

  await page.keyboard.press('j');
  await expect(page.getByRole('article')).toBeFocused();
  await page.keyboard.press('r');
  await expect(page.getByRole('dialog')).toBeVisible();

  const rationale = page.getByLabel('Decision rationale');
  await rationale.fill('Keep the request bounded ');
  await rationale.press('[');
  await rationale.press('j');
  await expect(rationale).toHaveValue('Keep the request bounded [j');
  await expect(page.locator('.platform-shell')).toHaveAttribute('data-rail-collapsed', 'false');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.keyboard.press('Control+k');
  const search = page.getByRole('combobox', { name: 'Search governed entities' });
  await expect(search).toBeFocused();
  await search.fill('[knowledge');
  await expect(page.locator('.platform-shell')).toHaveAttribute('data-rail-collapsed', 'false');
  await search.press('Escape');
  await expect(page.getByRole('button', { name: 'Search governed entities' })).toBeFocused();

  expect(unexpectedRequests).toEqual([]);
});

test('Today exposes connected ledger facts and names unavailable sources', async ({ page }) => {
  const { unexpectedRequests } = await stubConsoleReadModels(page);
  await page.goto('/');

  await expect(page.getByTestId('timeline-now')).toContainText('NOW');
  await expect(page.getByTestId('timeline-event')).toHaveAttribute('data-source', 'attention');
  await expect(page.getByText('Meetings Not connected on this machine.')).toBeVisible();
  await expect(page.getByText('Project deadlines Not connected on this machine.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Needs you' })).toBeVisible();
  await expect(
    page.locator('.today-needs-you').getByText('Daily Briefing asks for bounded authority'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'History contract needed' }),
  ).toBeVisible();
  await expect(page.locator('.today-home .primary-button')).toHaveCount(1);

  await page.getByRole('link', { name: /Open Attention/i }).click();
  await expect(page).toHaveURL(/\/attention$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Attention' })).toBeVisible();
  expect(unexpectedRequests).toEqual([]);
});

test('AIM remains a local Catalog capability and makes no external request', async ({ page }) => {
  await stubConsoleReadModels(page, { attention: 'empty' });
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5173') externalRequests.push(request.url());
  });

  await page.goto('/catalog');
  await page.getByRole('link', { name: /AIM.*Open the synthetic capability vehicle/i }).click();
  await expect(page).toHaveURL(/\/aim$/);
  await expect(
    page.getByRole('heading', { level: 1, name: 'AIM Capability Vehicle' }),
  ).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByText(/conceptual capability proxy/i)).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test('reduced motion renders the shell with a static sky', async ({ page }) => {
  await stubConsoleReadModels(page, { attention: 'empty' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-starfield-fallback="true"]')).toBeVisible();
  await expect(page.locator('canvas.starfield-canvas')).toHaveCount(0);
});
