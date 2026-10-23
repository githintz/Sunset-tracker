import { expect, test } from '@playwright/test';
import { meta, noHorizontalOverflow, openSpot, routeFixtures } from './helpers';

test.use({ serviceWorkers: 'block' });

test.describe('first launch', () => {
  test('welcome screen, place search, location denied', async ({ page, context }) => {
    await routeFixtures(context);
    // Simulate the user refusing the browser's location prompt.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        value: { getCurrentPosition: (_ok: unknown, err: (e: unknown) => void) => err({ code: 1, PERMISSION_DENIED: 1, TIMEOUT: 3, message: 'denied' }) },
      });
    });
    await page.goto('./');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await page.getByTestId('search-input').fill('Zurich');
    await expect(page.getByTestId('search-results').getByRole('button').first()).toContainText(/Z(ü|u)rich/);
    await page.getByTestId('gps-button').click();
    await expect(page.getByTestId('gps-message')).toContainText(/denied|unavailable|search for a place/i);
  });
});

test.describe('Zürich forecast from fixtures', () => {
  test.beforeEach(async ({ page, context }) => {
    const r = await routeFixtures(context);
    await openSpot(page, 'zurich');
    await expect(page.getByTestId('next-event')).toBeVisible();
    expect(r.unmatched).toEqual([]);
  });

  test('Today card shows verdict, time, ratings, models and reasons', async ({ page }) => {
    const card = page.getByTestId('next-event');
    await expect(card.getByTestId('verdict')).toHaveText(/Skip|Likely skip|Maybe|Probably go|Go/);
    await expect(card.getByTestId('event-time')).toContainText(/\d\d:\d\d/);
    await expect(card.getByTestId('event-time')).toContainText(/CEST|CET|GMT\+[12]/);
    await expect(card.getByTestId('sunset-rating')).toContainText(/\d\.\d/);
    await expect(card.getByTestId('golden-rating')).toBeVisible();
    await expect(card.getByTestId('sky-rating')).toContainText(/Flat|Plain|Scenic|Dramatic/);
    await expect(card.getByTestId('models')).toContainText(/agree|disagree|only one/);
    await expect(card.getByTestId('top-reason')).not.toBeEmpty();
    await card.getByTestId('why').click();
    await expect(page.getByRole('dialog').getByTestId('reasons').locator('li').first()).toBeVisible();
    await expect(page.getByTestId('spot-name')).toHaveText('Zürich');
    await expect(page.getByTestId('freshness')).toBeVisible();
  });

  test('light path cross-section and per-point table', async ({ page }) => {
    await page.getByTestId('nav-path').click();
    await expect(page.getByTestId('cross-section').locator('svg')).toBeVisible();
    await expect(page.getByTestId('point-table').locator('tbody tr')).toHaveCount(14);
    await page.getByRole('tab', { name: /Second/ }).click();
    await expect(page.getByTestId('point-table').locator('tbody tr')).toHaveCount(10);
    await page.getByRole('tab', { name: 'Best light' }).click();
    await expect(page.getByTestId('cross-section')).toBeVisible();
  });

  test('timeline, outlook, history and about', async ({ page }) => {
    await page.getByTestId('nav-timeline').click();
    await expect(page.getByTestId('timeline-overview')).toBeVisible();
    await page.getByRole('tab', { name: 'Night' }).click();
    await expect(page.getByTestId('regime-window').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Daytime' }).click();
    await expect(page.getByTestId('regime-window').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Tomorrow' }).click();
    await page.getByRole('tab', { name: 'Sunset' }).click();
    await expect(page.getByTestId('verdict').first()).toBeVisible();
    await page.getByTestId('nav-outlook').click();
    await expect(page.getByTestId('meteogram').locator('svg')).toBeVisible();
    await page.getByTestId('more').click();
    await expect(page.getByTestId('about')).toContainText('Open-Meteo.com');
    await expect(page.getByTestId('versions')).toContainText(/engine \d+\.\d+\.\d+/);
    await page.getByTestId('nav-history').click();
    await expect(page.getByTestId('history-list').locator('.list-item').first()).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('export').click();
    expect((await download).suggestedFilename()).toMatch(/glowcast-history-.*\.json/);
  });

  test('map screen renders without grids', async ({ page }) => {
    await page.getByTestId('nav-maps').click();
    await expect(page.getByTestId('map').locator('.leaflet-tile-pane')).toBeAttached();
    await expect(page.getByTestId('map-nodata')).toBeVisible();
  });

  test('offline refresh keeps the last forecast and says it is stale', async ({ page, context }) => {
    await context.setOffline(true);
    await page.getByTestId('refresh').click();
    await expect(page.getByTestId('refresh-error')).toContainText(/offline|unavailable|failed/i);
    await expect(page.getByTestId('freshness')).toContainText(/Stale/);
    await expect(page.getByTestId('next-event')).toBeVisible();
  });
});

test.describe('edge spots', () => {
  for (const spot of ['gornergrat', 'mid-atlantic', 'tromso']) {
    test(`${spot} loads a forecast`, async ({ page, context }) => {
      const r = await routeFixtures(context);
      await openSpot(page, spot);
      await expect(page.getByTestId('next-event').or(page.getByTestId('no-event'))).toBeVisible();
      await expect(page.getByTestId('photographers-day')).toBeVisible();
      expect(r.unmatched).toEqual([]);
    });
  }

  test('high-altitude spot keeps its viewpoint altitude', async ({ page, context }) => {
    await routeFixtures(context);
    await openSpot(page, 'gornergrat');
    await expect(page.getByTestId('next-event')).toBeVisible();
    await page.getByTestId('spot-button').click();
    await expect(page.getByTestId('spot-row').first()).toContainText('viewpoint 2770 m');
  });
});

test.describe('time zones', () => {
  test.use({ timezoneId: 'Europe/Zurich' });
  test('a phone in Zürich viewing Tokyo shows Tokyo local time with a label', async ({ page, context }) => {
    await routeFixtures(context);
    await openSpot(page, 'tokyo');
    const t = page.getByTestId('next-event').getByTestId('event-time');
    await expect(t).toContainText(/GMT\+9|JST/);
    const text = (await t.textContent()) ?? '';
    const hh = Number(text.slice(0, 2));
    // Tokyo sunrise ~05:5x or sunset ~16:5x local — never the Zürich clock (8 h earlier)
    expect([5, 6, 16, 17]).toContain(hh);
    await expect(page.locator('.topbar')).toContainText('Asia/Tokyo');
  });
});

test.describe('API failures', () => {
  test('500 from the primary model → second model stands in, clearly labelled', async ({ page, context }) => {
    await routeFixtures(context, { fail: (u) => (u.includes('models=best_match') ? 500 : null) });
    await openSpot(page, 'zurich');
    await expect(page.getByTestId('next-event')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('next-event').getByTestId('models')).toContainText('only one forecast');
    await page.getByTestId('next-event').getByTestId('why').click();
    await expect(page.getByRole('dialog')).toContainText('rated from the second model alone');
  });

  test('every model failing → error state, never a clear-sky verdict', async ({ page, context }) => {
    await routeFixtures(context, { fail: (u) => (u.includes('api.open-meteo.com/v1/forecast') ? 503 : null) });
    await openSpot(page, 'zurich');
    await expect(page.getByTestId('forecast-error').or(page.getByTestId('next-event'))).toBeVisible({ timeout: 30_000 });
    const v = page.getByTestId('next-event').getByTestId('verdict');
    if (await v.isVisible()) await expect(v).toHaveText('No data');
  });

  test('429 from the second model → only one forecast available', async ({ page, context }) => {
    await routeFixtures(context, { fail: (u) => (u.includes('models=ecmwf') ? 429 : null) });
    await openSpot(page, 'zurich');
    await expect(page.getByTestId('next-event')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('next-event').getByTestId('models')).toContainText('only one forecast');
  });
});

test.describe('layout', () => {
  test.describe('320 px', () => {
    test.use({ viewport: { width: 320, height: 640 } });
    test('no horizontal scroll on any screen, long names ellipsize', async ({ page, context }) => {
      await routeFixtures(context);
      await openSpot(page, 'zurich', 'Aussichtspunkt oberhalb des Zürichsees mit einem außerordentlich langen Namen, der nie aufhört');
      await expect(page.getByTestId('next-event')).toBeVisible();
      for (const nav of ['today', 'path', 'timeline', 'outlook', 'maps']) {
        await page.getByTestId(`nav-${nav}`).click();
        await page.waitForTimeout(150);
        expect(await noHorizontalOverflow(page), nav).toBeLessThanOrEqual(0);
      }
      await page.getByTestId('more').click();
      expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  });

  test.describe('landscape', () => {
    test.use({ viewport: { width: 800, height: 360 } });
    test('works in landscape', async ({ page, context }) => {
      await routeFixtures(context);
      await openSpot(page, 'zurich');
      await expect(page.getByTestId('next-event')).toBeVisible();
      expect(await noHorizontalOverflow(page)).toBeLessThanOrEqual(0);
      await expect(page.locator('.bottomnav')).toBeVisible();
    });
  });

  test.describe('light mode', () => {
    test.use({ colorScheme: 'light' });
    test('follows the system light theme', async ({ page, context }) => {
      await routeFixtures(context);
      await openSpot(page, 'zurich');
      await expect(page.getByTestId('next-event')).toBeVisible();
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe('rgb(247, 243, 238)');
    });
  });
});

test('fixture recording time is stable', () => {
  expect(meta('zurich').now).toBeGreaterThan(Date.parse('2026-01-01'));
});
