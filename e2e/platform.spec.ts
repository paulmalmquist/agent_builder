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
    { path: '/build', heading: 'Build', active: 'BUILD' },
    { path: '/catalog', heading: 'Catalog', active: 'CATALOG' },
    { path: '/operate', heading: 'Operate', active: 'OPERATE' },
    { path: '/connections', heading: 'Connections', active: 'CONNECTIONS' },
    { path: '/evidence', heading: 'Evidence', active: 'EVIDENCE' },
    { path: '/incubator', heading: 'Incubator', active: 'INCUBATOR' },
    {
      path: '/roadmaps',
      heading: 'Two-fork roadmap demonstration',
      active: 'ROADMAPS',
    },
    { path: '/settings', heading: 'Settings', active: 'SETTINGS' },
    { path: '/registry', heading: 'Registry', active: 'CATALOG' },
    { path: '/library', heading: 'Agent Library', active: 'CATALOG' },
    { path: '/runs', heading: 'Operate', active: 'OPERATE' },
    { path: '/aim', heading: 'AIM Capability Map', active: 'AIM' },
  ] as const;

  for (const route of routes) {
    await page.goto(route.path);
    if (route.heading === null) {
      await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Are we on track' })).toBeVisible();
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
  await expect(navNumbers).toHaveText([
    '00',
    '01',
    '02',
    '03',
    '04',
    '05',
    '06',
    '07',
    '08',
    '09',
    '10',
    '—',
  ]);
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

test('one Factory Operations selection scopes all three Home bands without hiding Attention', async ({
  page,
}) => {
  const { unexpectedRequests } = await stubConsoleReadModels(page);
  await page.goto('/');

  const verticals = page.getByRole('navigation', { name: 'Program vertical' });
  const all = page.getByTestId('home-vertical-all');
  const factory = page.getByTestId('home-vertical-group_factory');
  const health = page.getByTestId('home-band-health');
  const plan = page.getByTestId('home-band-plan');
  const action = page.getByTestId('home-band-action');
  const needsHeading = action.getByRole('heading', { level: 3, name: 'Needs you' });

  await expect(verticals).toBeVisible();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(health).toBeVisible();
  await expect(plan).toBeVisible();
  await expect(action).toBeVisible();
  await expect(health.getByText('LIVE', { exact: true }).first()).toBeVisible();
  await expect(health.getByText('SYNTHETIC', { exact: true }).first()).toBeVisible();
  await expect(needsHeading.locator('..')).toContainText('GLOBAL · READ-ONLY PREVIEW');
  await expect(action.getByText('Daily Briefing wants authority for one run.')).toBeVisible();

  const allMetricCount = await health.locator('.today-metric').count();
  const allWorkstreamCount = await plan.getByTestId('home-gantt-row').count();
  await factory.click();

  await expect(page).toHaveURL(/\/?\?vertical=group_factory$/);
  await expect(factory).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('home-scope-summary')).toHaveText(
    /Factory operations · \d+ metrics · \d+ workstreams · \d+ next moves?/,
  );
  const factoryMetricCount = await health.locator('.today-metric').count();
  const factoryWorkstreamCount = await plan.getByTestId('home-gantt-row').count();
  expect(factoryMetricCount).toBeGreaterThan(0);
  expect(factoryMetricCount).toBeLessThan(allMetricCount);
  expect(factoryWorkstreamCount).toBeGreaterThan(0);
  expect(factoryWorkstreamCount).toBeLessThan(allWorkstreamCount);
  await expect(health.getByText('SYNTHETIC', { exact: true }).first()).toBeVisible();
  await expect(health.getByText('AWAITING TRANSFER', { exact: true })).toBeVisible();
  const awaitingTransferMetric = health.locator('.today-metric[data-source="awaiting_transfer"]');
  await expect(awaitingTransferMetric).toContainText('—');
  await expect(awaitingTransferMetric).toContainText('NOT MEASURED');
  await expect(awaitingTransferMetric.locator('progress')).toHaveCount(0);
  await expect(action.getByTestId('home-task-list')).toBeVisible();
  await expect(needsHeading.locator('..')).toContainText('GLOBAL · READ-ONLY PREVIEW');
  await expect(action.getByText('Daily Briefing wants authority for one run.')).toBeVisible();

  const metricCount = await health.locator('.today-metric').count();
  await expect(health.getByTestId('kpi-source')).toHaveCount(metricCount);

  const ganttViewport = plan.getByTestId('home-gantt-viewport');
  await expect(ganttViewport).toBeVisible();
  const pageWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(pageWidths.scroll).toBeLessThanOrEqual(pageWidths.client);
  expect(
    await ganttViewport.evaluate((element) => element.scrollWidth >= element.clientWidth),
  ).toBe(true);

  const factoryWorkstream = plan.getByTestId('home-workstream-workstream_print_cell_qualification');
  await expect(factoryWorkstream).toHaveAttribute('href', '/aim?group=group_factory&part=stargate');
  await factoryWorkstream.click();
  await expect(page).toHaveURL(/\/aim\?group=group_factory&part=stargate$/);
  await expect(page.getByRole('button', { name: /Factory operations/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.getByRole('heading', { level: 2, name: 'Agents on Additive manufacturing cell' }),
  ).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/?\?vertical=group_factory$/);
  await expect(factory).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 3, name: 'Needs you' })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  expect(unexpectedRequests).toEqual([]);
});

test('two neutral roadmap slots share one URL-backed comparison filter', async ({ page }) => {
  const { unexpectedRequests } = await stubConsoleReadModels(page, { attention: 'empty' });
  await page.goto('/roadmaps');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Two-fork roadmap demonstration' }),
  ).toBeVisible();
  await expect(
    page.getByText('PRIVATE ROADMAP IDENTITIES ARE NOT PRESENT ON THIS MACHINE'),
  ).toBeVisible();
  await expect(page.getByText('NO ISSUE POPULATION LOADED')).toHaveCount(2);

  await page.getByRole('button', { name: 'Roadmap fork 02' }).click();
  await expect(page).toHaveURL(/\/roadmaps\?fork=fork_alternate$/);

  const stateBand = page.locator('section[aria-labelledby="roadmap-state-title"]');
  const planBand = page.locator('section[aria-labelledby="roadmap-plan-title"]');
  const actionBand = page.locator('section[aria-labelledby="roadmap-action-title"]');
  await expect(stateBand.getByText('Roadmap fork 02').first()).toBeVisible();
  await expect(stateBand.getByText('Roadmap fork 01')).toHaveCount(0);
  await expect(planBand.getByRole('heading', { name: 'Roadmap fork 02' })).toBeVisible();
  await expect(planBand.getByRole('heading', { name: 'Roadmap fork 01' })).toHaveCount(0);
  await expect(actionBand.getByText('Roadmap fork 02')).toHaveCount(2);
  await expect(actionBand.getByText('Roadmap fork 01')).toHaveCount(0);

  await page.goBack();
  await expect(page.getByRole('button', { name: 'Compare both' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(unexpectedRequests).toEqual([]);
});

test('AIM owns a rail destination, preserves Catalog entry, and makes no external request', async ({
  page,
}) => {
  await stubConsoleReadModels(page, { attention: 'empty' });
  const externalRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:5173') externalRequests.push(request.url());
  });

  await page.goto('/catalog');
  await expect(page.getByRole('heading', { level: 1, name: 'Catalog' })).toBeVisible();
  const aimLink = page.getByRole('link', {
    name: /AIM.*Open the synthetic capability map/i,
  });
  await expect(aimLink).toBeVisible();
  await aimLink.click();
  await expect(page).toHaveURL(/\/aim$/);
  await expect(page.getByRole('heading', { level: 1, name: 'AIM Capability Map' })).toBeVisible();
  await expect(page.locator('.platform-rail-link[aria-current="page"]')).toContainText('AIM');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByText(/keeps hardware, ownership, manufacturing method/i)).toBeVisible();
  await expect(page.getByText(/synthetic seed contains no protected design data/i)).toBeVisible();
  const groups = page.getByRole('region', { name: /Choose a group/i });
  await expect(groups.getByRole('button')).toHaveCount(6);
  await groups.getByRole('button', { name: /Propulsion/ }).click();
  await expect(groups.getByRole('button', { name: /Propulsion/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const hardware = page.getByRole('group', { name: 'Propulsion hardware' });
  await hardware.getByRole('button', { name: /Stage 1 engine cluster/i }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Agents on Stage 1 engine cluster' }),
  ).toBeVisible();
  expect(externalRequests).toEqual([]);
});

test('reduced motion renders the shell with a static sky', async ({ page }) => {
  await stubConsoleReadModels(page, { attention: 'empty' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('[data-starfield-fallback="true"]')).toBeVisible();
  await expect(page.locator('canvas.starfield-canvas')).toHaveCount(0);
});
