import { expect, test } from '@playwright/test';
import type { SelfTestReport } from '@agent-builder/contracts';
import { stubConsoleReadModels } from './console-stubs.js';

const requiredAssertionIds = [
  'viewport.achieved',
  'kpi.count.all',
  'kpi.count.scoped',
  'kpi.footer.nooverlap',
  'kpi.ariapressed',
  'kpi.activate.pointer',
  'kpi.activate.keyboard',
  'kpi.focus.transfer',
  'nav.back.onestep',
  'plan.list.persists',
  'metric.incompatible.cleared',
  'metric.global.noscope',
  'url.restore.notransient',
  'truth.nozero',
  'truth.badges',
  'a11y.hittarget',
  'a11y.focusvisible',
  'layout.nooverflow',
  'gantt.pointer.activates',
  'search.enter.activates',
] as const;

test('the in-app harness measures a real 390×844 iframe and publishes honest JSON', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const { unexpectedRequests } = await stubConsoleReadModels(page);
  await page.goto('/selftest?w=390');
  const frameElement = await page.getByTestId('selftest-frame').elementHandle();
  expect(frameElement).not.toBeNull();
  if (!frameElement) throw new Error('Self-test iframe element did not render.');
  const childFrame = await frameElement.contentFrame();
  expect(childFrame).not.toBeNull();
  if (!childFrame) throw new Error('Self-test iframe document did not load.');

  await expect(page.locator('[data-selftest-status="complete"]')).toBeVisible({
    timeout: 80_000,
  });
  expect(await childFrame.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([
    390, 844,
  ]);

  const serialized = await page.locator('#paul-os-selftest-report').textContent();
  expect(serialized).toBeTruthy();
  if (!serialized) throw new Error('Self-test report JSON was empty.');
  const report = JSON.parse(serialized) as SelfTestReport;
  expect(report.widths).toEqual([390]);
  expect(report.results).toHaveLength(requiredAssertionIds.length);
  expect(new Set(report.results.map(({ id }) => id))).toEqual(new Set(requiredAssertionIds));
  expect(
    report.summary.fail,
    JSON.stringify(report.results.filter(({ status }) => status === 'FAIL')),
  ).toBe(0);
  expect(
    report.summary.skipped,
    JSON.stringify(report.results.filter(({ status }) => status === 'SKIPPED')),
  ).toBe(1);
  expect(report.results.find(({ id }) => id === 'viewport.achieved')?.status).toBe('PASS');
  expect(report.results.find(({ id }) => id === 'search.enter.activates')?.status).toBe('SKIPPED');
  expect(unexpectedRequests).toEqual([]);
});

test('the default harness runs every assertion at all three exact matrix widths', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { unexpectedRequests } = await stubConsoleReadModels(page);
  await page.goto('/selftest');
  await expect(page.locator('[data-selftest-status="complete"]')).toBeVisible({
    timeout: 170_000,
  });

  const serialized = await page.locator('#paul-os-selftest-report').textContent();
  expect(serialized).toBeTruthy();
  if (!serialized) throw new Error('Self-test report JSON was empty.');
  const report = JSON.parse(serialized) as SelfTestReport;
  expect(report.widths).toEqual([390, 768, 1440]);
  expect(report.results).toHaveLength(requiredAssertionIds.length * 3);
  expect(
    report.summary.fail,
    JSON.stringify(report.results.filter(({ status }) => status === 'FAIL')),
  ).toBe(0);
  expect(
    report.summary.skipped,
    JSON.stringify(report.results.filter(({ status }) => status === 'SKIPPED')),
  ).toBe(3);
  expect(
    report.results
      .filter(({ id }) => id === 'viewport.achieved')
      .map(({ status, width }) => [width, status]),
  ).toEqual([
    [390, 'PASS'],
    [768, 'PASS'],
    [1440, 'PASS'],
  ]);
  expect(unexpectedRequests).toEqual([]);
});
