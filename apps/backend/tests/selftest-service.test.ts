import type { Route } from 'playwright-core';
import {
  BrowserSelfTestService,
  type SelfTestBrowserLauncher,
} from '../src/services/selftest-service.js';

const report = {
  schemaVersion: 'paul-os.selftest/v1' as const,
  commit: 'abcdef1',
  generatedAt: '2026-08-21T12:00:00.000Z',
  widths: [390],
  summary: { pass: 1, fail: 0, skipped: 0 },
  results: [
    {
      id: 'kpi.count.all',
      width: 390,
      status: 'PASS' as const,
      description: 'All scope renders eight metrics.',
      expected: '8 KPI cards',
      actual: '8 KPI cards',
      route: '/',
    },
  ],
};

type RouteHandler = (route: Route) => Promise<void>;

function createHarness(serialized = JSON.stringify(report)) {
  let routeHandler: RouteHandler | undefined;
  const waitFor = jest.fn(() => Promise.resolve());
  const textContent = jest.fn(() => Promise.resolve(serialized));
  const goto = jest.fn(() => Promise.resolve());
  const page = {
    goto,
    locator: jest.fn((selector: string) =>
      selector === '[data-selftest-status="complete"]' ? { waitFor } : { textContent },
    ),
  };
  const closeContext = jest.fn(() => Promise.resolve());
  const context = {
    route: jest.fn((_pattern: string, handler: RouteHandler) => {
      routeHandler = handler;
      return Promise.resolve();
    }),
    newPage: jest.fn(() => Promise.resolve(page)),
    close: closeContext,
  };
  const closeBrowser = jest.fn(() => Promise.resolve());
  const browser = {
    newContext: jest.fn(() => Promise.resolve(context)),
    close: closeBrowser,
  };
  const launch = jest.fn(() => Promise.resolve(browser));

  return {
    launcher: { launch } as unknown as SelfTestBrowserLauncher,
    launch,
    browser,
    context,
    page,
    goto,
    waitFor,
    textContent,
    closeContext,
    closeBrowser,
    getRouteHandler: () => routeHandler,
  };
}

function fakeRoute(url: string) {
  return {
    request: () => ({ url: () => url }),
    continue: jest.fn(() => Promise.resolve()),
    abort: jest.fn(() => Promise.resolve()),
  };
}

describe('BrowserSelfTestService', () => {
  it('returns only schema-validated output from the configured same-origin self-test page', async () => {
    const harness = createHarness();
    const service = new BrowserSelfTestService(
      {
        frontendUrl: 'http://frontend:8080/selftest?machine=1',
        timeoutMs: 120_000,
        executablePath: '/usr/bin/chromium',
      },
      harness.launcher,
    );

    await expect(service.run('Bearer fixture')).resolves.toEqual(report);
    expect(harness.launch).toHaveBeenCalledWith({
      headless: true,
      executablePath: '/usr/bin/chromium',
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
    expect(harness.browser.newContext).toHaveBeenCalledWith({
      extraHTTPHeaders: { authorization: 'Bearer fixture' },
    });
    expect(harness.goto).toHaveBeenCalledWith('http://frontend:8080/selftest?machine=1', {
      timeout: 120_000,
      waitUntil: 'domcontentloaded',
    });
    expect(harness.waitFor).toHaveBeenCalledWith({ state: 'attached', timeout: 120_000 });
    expect(harness.closeContext).toHaveBeenCalledTimes(1);
    expect(harness.closeBrowser).toHaveBeenCalledTimes(1);

    const handler = harness.getRouteHandler();
    expect(handler).toBeDefined();
    const sameOrigin = fakeRoute('http://frontend:8080/v1/roadmaps');
    const dataAsset = fakeRoute('data:image/svg+xml;base64,AA==');
    const external = fakeRoute('https://example.invalid/collect');
    await handler?.(sameOrigin as unknown as Route);
    await handler?.(dataAsset as unknown as Route);
    await handler?.(external as unknown as Route);
    expect(sameOrigin.continue).toHaveBeenCalledTimes(1);
    expect(dataAsset.continue).toHaveBeenCalledTimes(1);
    expect(external.abort).toHaveBeenCalledWith('blockedbyclient');
  });

  it('fails closed and releases browser resources when the page emits an invalid report', async () => {
    const harness = createHarness('{"schemaVersion":"wrong"}');
    const service = new BrowserSelfTestService(
      { frontendUrl: 'http://frontend:8080/selftest', timeoutMs: 10_000 },
      harness.launcher,
    );

    await expect(service.run(undefined)).rejects.toThrow();
    expect(harness.browser.newContext).toHaveBeenCalledWith({});
    expect(harness.closeContext).toHaveBeenCalledTimes(1);
    expect(harness.closeBrowser).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent runs for the same authorization context', async () => {
    const harness = createHarness();
    let resolveReport!: (value: string) => void;
    const pendingReport = new Promise<string>((resolve) => {
      resolveReport = resolve;
    });
    harness.textContent.mockImplementation(() => pendingReport);
    const service = new BrowserSelfTestService(
      { frontendUrl: 'http://frontend:8080/selftest', timeoutMs: 10_000 },
      harness.launcher,
    );

    const first = service.run('Bearer same');
    const second = service.run('Bearer same');
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.launch).toHaveBeenCalledTimes(1);
    resolveReport(JSON.stringify(report));
    await expect(Promise.all([first, second])).resolves.toEqual([report, report]);
  });
});
