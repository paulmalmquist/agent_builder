import { expect, test, type Page } from '@playwright/test';
import { stubConsoleReadModels } from './console-stubs.js';

async function capturedBrightPixelRatio(page: Page): Promise<number> {
  const screenshot = await page.screenshot({ scale: 'css' });
  const encoded = screenshot.toString('base64');

  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const sample = document.createElement('canvas');
    sample.width = 80;
    sample.height = 50;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (context === null) return 0;

    context.drawImage(bitmap, 0, 0, sample.width, sample.height);
    bitmap.close();
    const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
    let brightPixels = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (Math.max(pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0) > 40) {
        brightPixels += 1;
      }
    }
    return brightPixels / (pixels.length / 4);
  }, encoded);
}

test('ordinary console routes keep a static shell and survive repeated compositor captures', async ({
  page,
}) => {
  test.setTimeout(30_000);
  await stubConsoleReadModels(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();

  const background = page.locator('[data-starfield-mode="static"]');
  await expect(background).toBeVisible();
  await expect(background).toHaveCSS('position', 'absolute');
  await expect(page.locator('.platform-shell > canvas')).toHaveCount(0);

  const factory = page.getByTestId('home-vertical-group_factory');
  for (let capture = 0; capture < 3; capture += 1) {
    await factory.click();
    await expect(factory).toHaveAttribute('aria-pressed', 'true');
    const startedAt = Date.now();
    expect(await capturedBrightPixelRatio(page)).toBeGreaterThan(0.01);
    expect(Date.now() - startedAt).toBeLessThan(10_000);

    const all = page.getByTestId('home-vertical-all');
    await all.click();
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    const resetStartedAt = Date.now();
    expect(await capturedBrightPixelRatio(page)).toBeGreaterThan(0.01);
    expect(Date.now() - resetStartedAt).toBeLessThan(10_000);
  }

  await page.goto('/attention');
  await expect(page.getByRole('heading', { level: 1, name: 'Attention' })).toBeVisible();
  await page.getByRole('button', { name: 'Why am I seeing this?' }).click();
  expect(await capturedBrightPixelRatio(page)).toBeGreaterThan(0.01);
  await expect(page.locator('.platform-shell > canvas')).toHaveCount(0);
});
