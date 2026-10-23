import { expect, test } from '@playwright/test';

test('installable PWA: manifest, service worker and offline shell', async ({ page, context }) => {
  await page.goto('./');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href');
    return href ? ((await (await fetch(href)).json()) as { name: string; icons: unknown[]; start_url: string }) : null;
  });
  expect(manifest?.name).toContain('Glowcast');
  expect(manifest?.icons.length).toBeGreaterThanOrEqual(3);
  expect(manifest?.start_url).toBe('/Sunset-tracker/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('app-ready')).toBeVisible();
});
