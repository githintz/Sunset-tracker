import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';

const ROOT = fileURLToPath(new URL('../test/fixtures', import.meta.url));

interface Meta {
  spot: { name: string; lat: number; lon: number; elevationOverrideM: number | null };
  now: number;
  requests: Array<{ url: string; file: string }>;
}

export function meta(spot: string): Meta {
  return JSON.parse(readFileSync(join(ROOT, spot, 'meta.json'), 'utf8')) as Meta;
}

/** Every recorded Open-Meteo response, by exact URL. */
function allFixtures(): Map<string, string> {
  const m = new Map<string, string>();
  for (const d of readdirSync(ROOT)) {
    const mp = join(ROOT, d, 'meta.json');
    if (existsSync(mp)) for (const r of meta(d).requests) m.set(r.url, join(ROOT, d, r.file));
  }
  const geo = join(ROOT, 'geocoding');
  if (existsSync(geo))
    for (const f of readdirSync(geo)) {
      const { url } = JSON.parse(readFileSync(join(geo, f), 'utf8')) as { url: string };
      m.set(url, join(geo, f));
    }
  return m;
}

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export interface RouteOptions {
  /** Return a status code to fail matching requests. */
  fail?: (url: string) => number | null;
}

/** Serve Open-Meteo from fixtures, blank map tiles, and count unmatched requests. */
export async function routeFixtures(ctx: BrowserContext, opts: RouteOptions = {}): Promise<{ unmatched: string[] }> {
  const fx = allFixtures();
  const unmatched: string[] = [];
  await ctx.route(/open-meteo\.com/, async (route) => {
    const url = route.request().url();
    const code = opts.fail?.(url);
    if (code) return route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify({ error: true, reason: `test ${code}` }) });
    const file = fx.get(url);
    if (!file) {
      unmatched.push(url);
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: true, reason: 'no fixture' }) });
    }
    const body = readFileSync(file, 'utf8');
    return route.fulfill({ status: 200, contentType: 'application/json', body: file.includes('geocoding') ? JSON.stringify((JSON.parse(body) as { json: unknown }).json) : body });
  });
  await ctx.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1x1 }));
  return { unmatched };
}

export function spotHash(spot: string, name?: string): string {
  const m = meta(spot);
  const q = new URLSearchParams({ spot: `${m.spot.lat},${m.spot.lon}`, name: name ?? m.spot.name });
  if (m.spot.elevationOverrideM != null) q.set('alt', String(m.spot.elevationOverrideM));
  return `#/today?${q.toString()}`;
}

/** Freeze the page clock at the fixture's recording time and open the spot. */
export async function openSpot(page: Page, spot: string, name?: string): Promise<void> {
  await page.clock.setFixedTime(meta(spot).now);
  await page.goto(`./${spotHash(spot, name)}`);
}

export async function noHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}
