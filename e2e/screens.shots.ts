// Ad-hoc screenshot helper (not part of the suite): npx playwright test e2e/screens.shots.ts --project=shots
import { test } from '@playwright/test';
import { openSpot, routeFixtures } from './helpers';

test.use({ serviceWorkers: 'block' });
test('screens', async ({ page, context }) => {
  await routeFixtures(context);
  await openSpot(page, process.env.SPOT ?? 'zurich');
  await page.getByTestId('next-event').waitFor();
  const out = process.env.SHOT_DIR ?? 'test-results/shots';
  await page.screenshot({ path: `${out}/today.png`, fullPage: true });
  for (const n of ['path', 'timeline', 'outlook', 'maps']) {
    await page.getByTestId(`nav-${n}`).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/${n}.png`, fullPage: true });
  }
  await page.getByTestId('more').click();
  await page.screenshot({ path: `${out}/about.png`, fullPage: true });
});
