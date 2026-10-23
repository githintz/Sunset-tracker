import { expect, test } from '@playwright/test';

// Runs against the real Open-Meteo API (GitHub Actions: live.yml). No fixtures, no fixed clock.
const SPOTS = [
  { name: 'Zürich', q: 'spot=47.3769,8.5417&name=Z%C3%BCrich' },
  { name: 'Gornergrat', q: 'spot=46.0,7.75&name=Gornergrat&alt=2770' },
  { name: 'Tokyo', q: 'spot=35.6762,139.6503&name=Tokyo' },
];

test.use({ serviceWorkers: 'block' });

for (const s of SPOTS) {
  test(`live forecast: ${s.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`./#/today?${s.q}`);
    await expect(page.getByTestId('next-event').or(page.getByTestId('no-event'))).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('freshness')).toBeVisible();
    const card = page.getByTestId('next-event');
    if (await card.isVisible()) {
      await expect(card.getByTestId('verdict')).not.toHaveText('No data');
      await expect(card.getByTestId('models')).toContainText(/agree|disagree/);
    }
    await page.getByTestId('nav-path').click();
    await expect(page.getByTestId('point-table').locator('tbody tr')).toHaveCount(14);
    expect(errors).toEqual([]);
  });
}

test('live place search', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('search-input').fill('Gornergrat');
  await expect(page.getByTestId('search-results').getByRole('button').first()).toContainText('Gornergrat', { timeout: 30_000 });
});
