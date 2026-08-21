import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { selfTestReportSchema, type SelfTestReport } from '@agent-builder/contracts';

const COMPLETION_SELECTOR = '[data-selftest-status="complete"]';
const REPORT_SELECTOR = '#paul-os-selftest-report';

export type SelfTestRunnerOptions = {
  frontendUrl: string;
  timeoutMs: number;
  executablePath?: string;
};

export interface SelfTestApi {
  run(authorization: string | undefined): Promise<SelfTestReport>;
}

export type SelfTestBrowserLauncher = Pick<typeof chromium, 'launch'>;

/**
 * Runs the same client-owned acceptance matrix that a human sees at /selftest.
 *
 * The browser may only request the configured frontend origin. This keeps the
 * runner from becoming a caller-controlled browsing or credential-forwarding
 * surface while still allowing same-origin API requests through the frontend
 * proxy.
 */
export class BrowserSelfTestService implements SelfTestApi {
  private readonly inFlightByPrincipal = new Map<string, Promise<SelfTestReport>>();

  constructor(
    private readonly options: SelfTestRunnerOptions,
    private readonly browserLauncher: SelfTestBrowserLauncher = chromium,
  ) {}

  run(authorization: string | undefined): Promise<SelfTestReport> {
    const principalKey = createHash('sha256')
      .update(authorization ?? 'anonymous')
      .digest('hex');
    const existing = this.inFlightByPrincipal.get(principalKey);
    if (existing !== undefined) return existing;

    const pending = this.runOnce(authorization).finally(() => {
      this.inFlightByPrincipal.delete(principalKey);
    });
    this.inFlightByPrincipal.set(principalKey, pending);
    return pending;
  }

  private async runOnce(authorization: string | undefined): Promise<SelfTestReport> {
    const frontendUrl = new URL(this.options.frontendUrl);
    if (!['http:', 'https:'].includes(frontendUrl.protocol)) {
      throw new Error('Self-test frontend URL must use HTTP or HTTPS.');
    }
    const browser = await this.browserLauncher.launch({
      headless: true,
      ...(this.options.executablePath === undefined
        ? {}
        : { executablePath: this.options.executablePath }),
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    });
    try {
      const context = await browser.newContext({
        ...(authorization === undefined ? {} : { extraHTTPHeaders: { authorization } }),
      });
      try {
        await context.route('**/*', async (route) => {
          const requestUrl = new URL(route.request().url());
          if (requestUrl.origin === frontendUrl.origin || requestUrl.protocol === 'data:') {
            await route.continue();
            return;
          }
          await route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        await page.goto(frontendUrl.href, {
          timeout: this.options.timeoutMs,
          waitUntil: 'domcontentloaded',
        });
        await page.locator(COMPLETION_SELECTOR).waitFor({
          state: 'attached',
          timeout: this.options.timeoutMs,
        });
        const serialized = await page.locator(REPORT_SELECTOR).textContent({
          timeout: this.options.timeoutMs,
        });
        if (serialized === null || serialized.trim().length === 0) {
          throw new Error('Self-test page completed without a serialized report.');
        }
        return selfTestReportSchema.parse(JSON.parse(serialized) as unknown);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
}
