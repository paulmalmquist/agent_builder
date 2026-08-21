import { expect, test, type Locator, type Page } from '@playwright/test';
import { stubConsoleReadModels } from './console-stubs.js';

interface VerticalScope {
  groupId: 'group_factory' | 'group_structures';
  label: 'Factory operations' | 'Structures';
  metricId: `vertical-coverage:${VerticalScope['groupId']}`;
  outcomeLabel: 'Print first-pass yield' | 'As-built reconciled';
}

const factoryScope: VerticalScope = {
  groupId: 'group_factory',
  label: 'Factory operations',
  metricId: 'vertical-coverage:group_factory',
  outcomeLabel: 'Print first-pass yield',
};

const structuresScope: VerticalScope = {
  groupId: 'group_structures',
  label: 'Structures',
  metricId: 'vertical-coverage:group_structures',
  outcomeLabel: 'As-built reconciled',
};

async function expectQuery(page: Page, expected: Record<string, string>): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => Object.fromEntries(new URL(window.location.href).searchParams.entries())),
    )
    .toEqual(expected);
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}

async function expectMetricFooterSeparation(page: Page): Promise<void> {
  const cards = page.locator('.today-metric');
  for (let index = 0; index < (await cards.count()); index += 1) {
    const card = cards.nth(index);
    const status = card.locator('.today-metric-status');
    const inspect = card.locator('.today-metric-inspect-label');
    await expect(inspect).toHaveCount(1);
    if ((await status.count()) === 0) continue;
    const overlapArea = await card.evaluate((element) => {
      const statusRect = element.querySelector('.today-metric-status')?.getBoundingClientRect();
      const inspectRect = element
        .querySelector('.today-metric-inspect-label')
        ?.getBoundingClientRect();
      if (!statusRect || !inspectRect) return null;
      const width = Math.max(
        0,
        Math.min(statusRect.right, inspectRect.right) - Math.max(statusRect.left, inspectRect.left),
      );
      const height = Math.max(
        0,
        Math.min(statusRect.bottom, inspectRect.bottom) - Math.max(statusRect.top, inspectRect.top),
      );
      return width * height;
    });
    expect(overlapArea).toBe(0);
  }
}

async function expectMetricPressedState(page: Page, selectedCount: number): Promise<void> {
  const metricButtons = page.locator('.today-metric-select');
  await expect(metricButtons).not.toHaveCount(0);
  await expect(page.locator('.today-metric-select[aria-pressed="true"]')).toHaveCount(
    selectedCount,
  );
  await expect(page.locator('.today-metric-select[aria-pressed="false"]')).toHaveCount(
    (await metricButtons.count()) - selectedCount,
  );
}

async function expectMinimumTarget(locator: Locator): Promise<void> {
  for (let index = 0; index < (await locator.count()); index += 1) {
    const target = locator.nth(index);
    await target.evaluate((element) =>
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    );
    const visibleTarget = await target.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        height: rect.height,
        visibleWidth: Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)),
        width: rect.width,
      };
    });
    expect(visibleTarget.height).toBeGreaterThanOrEqual(44);
    expect(visibleTarget.width).toBeGreaterThanOrEqual(44);
    expect(visibleTarget.visibleWidth).toBeGreaterThanOrEqual(44);
  }
}

async function expectMobileHomeGeometry(page: Page): Promise<void> {
  expect(await page.evaluate(() => window.innerWidth)).toBe(390);
  await expectMinimumTarget(page.locator('.today-metric-select'));
  await expectMinimumTarget(page.locator('.today-vertical-filter button'));
  await expectMinimumTarget(page.locator('.today-gantt-row-link, .today-gantt-row-static'));
  await expectMinimumTarget(page.locator('.today-plan-view button'));
  await expectMinimumTarget(page.locator('.today-metric-detail button, .today-metric-detail a'));
  await expectMinimumTarget(
    page.locator(
      '.today-roadmap-strip a, .today-plan-links a, .today-task-list a, .today-attention-link',
    ),
  );
  const gantt = page.getByTestId('home-gantt-viewport');
  const containment = await gantt.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      clientWidth: element.clientWidth,
      left: rect.left,
      overflowX: style.overflowX,
      right: rect.right,
      scrollWidth: element.scrollWidth,
      viewportWidth: innerWidth,
    };
  });
  expect(containment.left).toBeGreaterThanOrEqual(0);
  expect(containment.right).toBeLessThanOrEqual(containment.viewportWidth);
  expect(containment.scrollWidth).toBeGreaterThan(containment.clientWidth);
  expect(['auto', 'scroll']).toContain(containment.overflowX);
  await expectNoDocumentOverflow(page);
}

async function clickWithRealPointer(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) throw new Error('Expected the KPI target to have a pointer box.');
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport === null) throw new Error('Expected the browser context to expose a viewport.');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function expectGlobalAttention(page: Page): Promise<void> {
  const action = page.getByTestId('home-band-action');
  const needsYou = action
    .getByRole('heading', { level: 3, name: 'Needs you' })
    .locator('..')
    .locator('..')
    .locator('..');
  await expect(needsYou).toContainText('GLOBAL · READ-ONLY PREVIEW');
  await expect(needsYou).toContainText('Daily Briefing wants authority for one run.');
}

async function expectScopedHome(
  page: Page,
  scope: VerticalScope,
  planView: 'list' | 'timeline',
): Promise<void> {
  const expectedQuery: Record<string, string> = {
    vertical: scope.groupId,
    metric: scope.metricId,
  };
  if (planView === 'list') expectedQuery['plan'] = 'list';
  await expectQuery(page, expectedQuery);

  const targetVertical = page.getByTestId(`home-vertical-${scope.groupId}`);
  await expect(targetVertical).toBeFocused();
  await expect(targetVertical).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('home-scope-summary')).toHaveText(
    new RegExp(`${scope.label} · 4 metrics · 2 workstreams · 1 next move`, 'u'),
  );

  const health = page.getByLabel(`${scope.label} health metrics`);
  await expect(health.getByRole('article')).toHaveCount(4);
  for (const label of [
    'Agent coverage',
    'Certified fleet ratio',
    'Evidence freshness',
    scope.outcomeLabel,
  ]) {
    await expect(health.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(health.getByTestId('home-metric-digest-runs')).toHaveCount(0);
  await expect(
    health.getByRole('button', { name: /Inspect Agent coverage: 100%, SYNTHETIC/i }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expectMetricPressedState(page, 1);
  await expectMetricFooterSeparation(page);
  await expect(page.getByRole('region', { name: 'Agent coverage' })).toContainText(
    'OBJECTIVE BINDING',
  );
  await expect(page.getByRole('region', { name: 'Agent coverage' })).toContainText('Not declared');

  const plan = page.getByTestId('home-band-plan');
  const rows =
    planView === 'timeline'
      ? plan.getByTestId('home-gantt-row')
      : plan.getByTestId('home-workstream-list').getByRole('listitem');
  await expect(rows).toHaveCount(2);
  for (const row of await rows.all()) await expect(row).toContainText(scope.label);

  const nextMoves = page.getByTestId('home-task-list');
  await expect(nextMoves.getByRole('listitem')).toHaveCount(1);
  await expect(nextMoves.getByRole('link')).toHaveAttribute(
    'href',
    new RegExp(`(?:\\?|&)group=${scope.groupId}(?:&|$)`, 'u'),
  );
  await expectGlobalAttention(page);
  await expectNoDocumentOverflow(page);
}

async function expectAllRestored(page: Page, planView: 'list' | 'timeline'): Promise<void> {
  await expectQuery(page, planView === 'list' ? { plan: 'list' } : {});
  await expect(page.getByTestId('home-vertical-all')).toHaveAttribute('aria-pressed', 'true');
  const health = page.getByLabel('All health metrics');
  await expect(health.getByRole('article')).toHaveCount(8);
  await expect(health.getByTestId('home-metric-digest-runs')).toBeVisible();
  const plan = page.getByTestId('home-band-plan');
  if (planView === 'timeline') {
    await expect(plan.getByTestId('home-gantt-row')).toHaveCount(10);
  } else {
    await expect(plan.getByTestId('home-workstream-list').getByRole('listitem')).toHaveCount(10);
  }
  await expect(page.getByRole('region', { name: 'Agent coverage' })).toHaveCount(0);
  await expectMetricPressedState(page, 0);
  await expectMetricFooterSeparation(page);
  await expectGlobalAttention(page);
  await expectNoDocumentOverflow(page);
}

async function exerciseKpiScopeStory(page: Page, expectedViewport: [number, number]) {
  const { unexpectedRequests } = await stubConsoleReadModels(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual(
    expectedViewport,
  );
  await expectAllRestored(page, 'timeline');
  if (expectedViewport[0] === 390) await expectMobileHomeGeometry(page);

  const lastRoadmapFork = page
    .getByTestId('home-roadmap-strip')
    .getByRole('link', { name: /^Open /i })
    .last();
  await lastRoadmapFork.focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.today-metric-select').first()).toBeFocused();

  const factoryMetric = page.getByRole('button', {
    name: /Inspect Factory operations: 100%, SYNTHETIC/i,
  });
  await clickWithRealPointer(page, factoryMetric);
  await expectScopedHome(page, factoryScope, 'timeline');
  if (expectedViewport[0] === 390) await expectMobileHomeGeometry(page);

  await page.goBack();
  await expectAllRestored(page, 'timeline');

  for (const key of ['Enter', 'Space']) {
    const keyboardFactoryMetric = page.getByRole('button', {
      name: /Inspect Factory operations: 100%, SYNTHETIC/i,
    });
    await keyboardFactoryMetric.focus();
    await page.keyboard.press(key);
    await expectScopedHome(page, factoryScope, 'timeline');
    await page.goBack();
    await expectAllRestored(page, 'timeline');
  }

  const listView = page.getByRole('button', { name: 'DATED LIST' });
  await listView.focus();
  await page.keyboard.press('Enter');
  await expectQuery(page, { plan: 'list' });

  const structuresMetric = page.getByRole('button', {
    name: /Inspect Structures: 100%, SYNTHETIC/i,
  });
  await structuresMetric.focus();
  await page.keyboard.press('Enter');
  await expectScopedHome(page, structuresScope, 'list');

  await page.goBack();
  await expectAllRestored(page, 'list');

  await page.goForward();
  await expectScopedHome(page, structuresScope, 'list');

  await page.getByTestId('home-vertical-group_factory').click();
  await expectQuery(page, { plan: 'list', vertical: factoryScope.groupId });
  await expect(page.getByRole('region', { name: 'Agent coverage' })).toHaveCount(0);
  await expectMetricPressedState(page, 0);
  await expect(page.getByTestId('home-vertical-group_factory')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expectNoDocumentOverflow(page);
  expect(unexpectedRequests).toEqual([]);
}

test.describe('desktop Home KPI scope story', () => {
  test.use({ viewport: { width: 2048, height: 926 } });

  test('one pointer or keyboard gesture scopes state, plan, and action', async ({ page }) => {
    await exerciseKpiScopeStory(page, [2048, 926]);
  });
});

test.describe('390px Home KPI scope story', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('one pointer or keyboard gesture scopes state, plan, and action', async ({ page }) => {
    await exerciseKpiScopeStory(page, [390, 844]);
  });
});
