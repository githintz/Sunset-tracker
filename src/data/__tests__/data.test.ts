import { describe, expect, it, vi } from 'vitest';
import { fixtureFetch, fixtureSpots, loadMeta, loadResponse } from '../../../test/fixtureFetch';
import { loadForecast, eventBearings } from '../pipeline';
import { memoryKV, hashKey, readCache, isCacheEntry } from '../cache';
import { fetchJson, HttpError } from '../http';
import { recordCalls, callsToday, budgetKey } from '../budget';
import {
  buildCorridorUrl,
  buildElevationUrl,
  buildGeocodeUrl,
  estimateCalls,
  estimateUrl,
  parseAir,
  parseCorridor,
  parseElevation,
  parseGeocode,
  parseObserver,
  DataError,
  MIN_LEVELS,
} from '../openmeteo';
import { corridorPoints, profilePoints, PROFILE_DISTANCES } from '../geometry';
import { computeForecast } from '../../engine/forecast';
import { distanceKm } from '../../engine/geo';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FIXTURE_ROOT } from '../../../test/fixtureFetch';

const SPOTS = fixtureSpots();
const noSleep = { sleep: async () => undefined, baseDelayMs: 1 };

async function load(spot: string, opts: { override?: (url: string) => Response | null; kv?: ReturnType<typeof memoryKV>; now?: number; force?: boolean } = {}) {
  const meta = loadMeta(spot);
  return loadForecast(meta.spot, opts.now ?? meta.now, {
    kv: opts.kv ?? memoryKV(),
    force: opts.force,
    fetchOptions: { fetchImpl: fixtureFetch(spot, opts.override), retries: 2, ...noSleep, isOnline: () => true },
  });
}

describe('recorded fixtures', () => {
  it('cover the required test spots', () => {
    expect(SPOTS).toEqual(expect.arrayContaining(['zurich', 'gornergrat', 'mid-atlantic', 'tokyo', 'tromso']));
  });

  for (const spot of SPOTS) {
    it(`${spot}: every request parses and the forecast computes`, async () => {
      const meta = loadMeta(spot);
      const r = await load(spot);
      expect(r.status.errors).toEqual([]);
      expect(r.inputs.sunset?.A?.points).toHaveLength(14);
      expect(r.inputs.sunset?.B?.points).toHaveLength(10);
      expect(r.inputs.sunset?.A?.hasLevels).toBe(true);
      expect(r.inputs.obs?.times.length).toBeGreaterThanOrEqual(72);
      expect(r.inputs.air?.aod.some((v) => v != null)).toBe(true);
      const f = computeForecast(r.inputs);
      expect(f.events.length).toBeGreaterThan(0);
      for (const e of f.events) if (e.raw != null) expect(e.raw).toBeGreaterThanOrEqual(0);
      expect(r.status.fullCost).toBeGreaterThan(100);
      expect(r.status.fullCost).toBeLessThan(170);
      expect(meta.requests.length).toBe(7);
    });
  }

  it('high-altitude spot keeps the user viewpoint altitude (2770 m)', async () => {
    const r = await load('gornergrat');
    expect(r.inputs.observer.elevationM).toBe(2770);
    expect(r.inputs.observer.elevationOverride).toBe(true);
    expect(r.inputs.observer.timezone).toBe('Europe/Zurich');
  });

  it('mid-ocean spot still gets data and a fixed-offset zone', async () => {
    const r = await load('mid-atlantic');
    expect(r.inputs.observer.timezone).toMatch(/^Etc\/GMT/);
    expect(computeForecast(r.inputs).terrain.sunset?.kind).toBe('coast');
  });

  it('a level a model never publishes is dropped, not treated as missing', async () => {
    const r = await load('tromso');
    const lv = r.inputs.sunset!.A!.points[0]!.levels.map((l) => l.hPa);
    expect(lv.length).toBeGreaterThanOrEqual(MIN_LEVELS);
    for (const l of r.inputs.sunset!.A!.points[0]!.levels) expect(l.cover.some((v) => v != null)).toBe(true);
  });
});

describe('failures and fallbacks', () => {
  const status = (code: number) => () => new Response(JSON.stringify({ error: true, reason: `boom ${code}` }), { status: code });

  it('HTTP 429 and 500 are retried with backoff and then reported', async () => {
    let n = 0;
    const r = await load('zurich', {
      override: (u) => {
        if (u.includes('air-quality')) {
          n++;
          return status(n % 2 ? 429 : 500)();
        }
        return null;
      },
    });
    expect(n).toBe(3); // first try + 2 retries
    expect(r.inputs.air).toBeNull();
    expect(r.status.errors.join()).toMatch(/Air-quality data unavailable/);
    const f = computeForecast(r.inputs);
    expect(f.events.find((e) => e.event)!.event!.missingAir).toContain('aerosol');
  });

  it('second model missing entirely → only one forecast available', async () => {
    const r = await load('zurich', { override: (u) => (u.includes('models=ecmwf') ? status(503)() : null) });
    expect(r.inputs.sunset!.B).toBeNull();
    expect(r.status.modelB).toBeNull();
    const f = computeForecast(r.inputs);
    expect(f.flags).toContain('only one forecast available');
    expect(f.events.every((e) => e.singleModel)).toBe(true);
  });

  it('HTTP 400 for the preferred second model falls back to the next candidate', async () => {
    const seen: string[] = [];
    const r = await load('zurich', {
      override: (u) => {
        if (u.includes('models=ecmwf_ifs025')) {
          seen.push('025');
          return status(400)();
        }
        if (u.includes('models=ecmwf_ifs&')) {
          seen.push('hres');
          return new Response(JSON.stringify(loadResponse('zurich', 'corridorB-sunset.json')), { status: 200 });
        }
        return null;
      },
    });
    expect(seen).toContain('025');
    expect(seen).toContain('hres');
    expect(r.status.modelB).toBe('ecmwf_ifs');
  });

  it('serves a fresh cache without network and a stale cache when the network fails', async () => {
    const kv = memoryKV();
    const meta = loadMeta('zurich');
    await load('zurich', { kv });
    const fresh = await load('zurich', { kv, override: () => status(500)(), now: meta.now + 10 * 60000 });
    expect(fresh.status.requests.every((r) => r.source === 'cache')).toBe(true);
    expect(fresh.status.stale).toBe(false);
    expect(fresh.status.calls).toBe(0);
    const stale = await load('zurich', { kv, override: () => status(500)(), now: meta.now + 3 * 3600000, force: false });
    // URLs change with the hour? no — bearings are rounded, so the same URLs hit the stale cache
    expect(stale.status.stale).toBe(true);
    expect(stale.status.ageMin).toBeGreaterThanOrEqual(180);
    expect(stale.inputs.sunset?.A).not.toBeNull();
    expect(computeForecast(stale.inputs).flags).toContain('stale run');
  });

  it('a corrupt cache entry is discarded and refetched', async () => {
    const kv = memoryKV();
    const meta = loadMeta('zurich');
    for (const r of meta.requests) await kv.set(`om:${hashKey(r.url)}`, { garbage: true });
    const r = await load('zurich', { kv });
    expect(r.status.requests.every((x) => x.source === 'network')).toBe(true);
    expect(r.status.errors).toEqual([]);
  });

  it('offline with no cache → honest empty forecast, not clear sky', async () => {
    const meta = loadMeta('zurich');
    const r = await loadForecast(meta.spot, meta.now, { kv: memoryKV(), fetchOptions: { isOnline: () => false } });
    expect(r.inputs.sunset?.A).toBeNull();
    expect(r.status.errors.length).toBeGreaterThan(0);
    const f = computeForecast(r.inputs);
    expect(f.events.every((e) => e.rating == null)).toBe(true);
  });

  it('timeouts abort and are retried', async () => {
    const slow = (async (_u: string, init?: RequestInit) =>
      new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch;
    const p = fetchJson('https://example.test/x', { fetchImpl: slow, timeoutMs: 5, retries: 1, ...noSleep, isOnline: () => true });
    await expect(p).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('network errors, bad JSON and retry-after are handled', async () => {
    const boom = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(fetchJson('https://x.test', { fetchImpl: boom, retries: 0, isOnline: () => true })).rejects.toMatchObject({ kind: 'network' });
    const bad = (async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchJson('https://x.test', { fetchImpl: bad, retries: 0, isOnline: () => true })).rejects.toMatchObject({ kind: 'parse' });
    const sleeps: number[] = [];
    let n = 0;
    const ra = (async () => (n++ === 0 ? new Response('{}', { status: 429, headers: { 'retry-after': '2' } }) : new Response('{"ok":1}'))) as unknown as typeof fetch;
    await expect(fetchJson('https://x.test', { fetchImpl: ra, retries: 1, sleep: async (ms) => void sleeps.push(ms), isOnline: () => true })).resolves.toEqual({ ok: 1 });
    expect(sleeps).toEqual([2000]);
    const e400 = (async () => new Response('{"error":true,"reason":"Cannot initialize"}', { status: 400 })) as unknown as typeof fetch;
    await expect(fetchJson('https://x.test', { fetchImpl: e400, retries: 3, isOnline: () => true })).rejects.toBeInstanceOf(HttpError);
    await expect(fetchJson('https://x.test', { isOnline: () => false })).rejects.toMatchObject({ kind: 'offline' });
  });
});

describe('request building, cost and parsing', () => {
  it('estimates call cost per Open-Meteo rules', () => {
    expect(estimateCalls(14, 34, 4).calls).toBeCloseTo(47.6, 6);
    expect(estimateCalls(1, 5, 3).calls).toBe(1);
    expect(estimateCalls(1, 10, 28).calls).toBe(2);
    const meta = loadMeta('zurich');
    const total = meta.requests.reduce((a, r) => a + estimateUrl(r.url).calls, 0);
    expect(total).toBeCloseTo(meta.requests.reduce((a, r) => a + r.calls, 0), 6);
    expect(estimateUrl(buildGeocodeUrl('Zurich')).calls).toBe(1);
    expect(estimateUrl(buildElevationUrl([{ lat: 1, lon: 2 }])).calls).toBe(1);
  });

  it('builds unixtime multi-coordinate requests', () => {
    const pts = corridorPoints({ lat: 47, lon: 8 }, 250).map((p) => ({ ...p, elevationM: 400 }));
    const u = new URL(buildCorridorUrl({ points: pts, model: 'best_match', levels: [850, 700], pastDays: 1 }));
    expect(u.searchParams.get('timeformat')).toBe('unixtime');
    expect(u.searchParams.get('latitude')!.split(',')).toHaveLength(14);
    expect(u.searchParams.get('hourly')).toContain('geopotential_height_850hPa');
    expect(u.searchParams.get('past_days')).toBe('1');
    expect(() => buildElevationUrl(Array(101).fill({ lat: 0, lon: 0 }))).toThrow();
  });

  it('corridor and profile geometry follow the bearing', () => {
    const o = { lat: 46, lon: 7.75 };
    const pts = corridorPoints(o, 270);
    expect(pts.map((p) => p.distanceKm)).toEqual([-5, -2.5, 0, 2.5, 5, 10, 20, 30, 50, 100, 150, 200, 300, 350]);
    expect(distanceKm(o, pts.find((p) => p.distanceKm === 350)!)).toBeCloseTo(350, 0);
    expect(pts.find((p) => p.distanceKm === 350)!.lon).toBeLessThan(o.lon);
    expect(profilePoints(o, 270)).toHaveLength(PROFILE_DISTANCES.length);
    expect(PROFILE_DISTANCES.length * 2 + 1).toBeLessThanOrEqual(100);
    const b = eventBearings(47.37, 8.54, Date.parse('2026-06-21T12:00:00Z'));
    expect(b.sunset).toBeGreaterThan(295);
    expect(b.sunrise).toBeLessThan(65);
    expect(eventBearings(69.65, 18.96, Date.parse('2026-06-21T12:00:00Z')).sunset).toBeNull();
  });

  it('parsers reject malformed payloads and keep nulls as nulls', () => {
    expect(() => parseObserver({ error: true, reason: 'nope' })).toThrow(DataError);
    expect(() => parseAir('x')).toThrow(DataError);
    expect(() => parseObserver({ hourly: { time: ['2026-01-01T00:00'] } })).toThrow(/unixtime/);
    expect(() => parseObserver({})).toThrow(/hourly/);
    expect(() => parseElevation({ elevation: [1] }, 2)).toThrow(/Expected 2/);
    expect(() => parseElevation({ error: true, reason: 'x' }, 1)).toThrow();
    expect(() => parseElevation([], 1)).toThrow();
    expect(() => parseElevation({}, 1)).toThrow();
    expect(parseElevation({ elevation: [1, null] }, 2)).toEqual([1, null]);
    const o = parseObserver({ hourly: { time: [0, 3600], cloud_cover: [10, 'x'] } });
    expect(o.series.cloudCover).toEqual([10, null]);
    expect(o.series.cape).toEqual([null, null]);
    expect(() =>
      parseCorridor([{ hourly: { time: [0] } }], { points: [], model: 'm', levels: [] }, 0),
    ).toThrow(/Expected 0/);
  });

  it('geocoding results are parsed defensively', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'geocoding', 'Zurich.json'), 'utf8')) as { json: unknown };
    const res = parseGeocode(raw.json);
    expect(res[0]!.name).toMatch(/Zürich|Zurich/);
    expect(res[0]!.timezone).toBe('Europe/Zurich');
    const none = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'geocoding', 'xqzv-no-such-place.json'), 'utf8')) as { json: unknown };
    expect(parseGeocode(none.json)).toEqual([]);
    expect(parseGeocode({ results: [{ name: 1 }, { name: 'x', latitude: 1, longitude: 2 }] })).toHaveLength(1);
    expect(() => parseGeocode({ error: true })).toThrow();
    expect(() => parseGeocode(null)).toThrow();
  });
});

describe('cache and budget', () => {
  it('validates entries and counts calls per UTC day', async () => {
    const kv = memoryKV();
    expect(isCacheEntry({ v: 1, savedAt: 1, url: 'u', data: null })).toBe(true);
    expect(await readCache(kv, 'missing')).toBeNull();
    await kv.set('bad', 42);
    expect(await readCache(kv, 'bad')).toBeNull();
    expect(await kv.keys()).not.toContain('bad');
    const t = Date.parse('2026-10-23T10:00:00Z');
    await recordCalls(kv, 47.6, t);
    await recordCalls(kv, 28, t);
    expect(await callsToday(kv, t)).toBeCloseTo(75.6, 6);
    expect(await callsToday(kv, t + 86400000)).toBe(0);
    expect(budgetKey(t)).toBe('budget:2026-10-23');
    expect(hashKey('a')).not.toBe(hashKey('b'));
    const throwing = { ...kv, get: vi.fn(async () => Promise.reject(new Error('x'))) };
    expect(await readCache(throwing, 'k')).toBeNull();
    await kv.clear();
    expect(await kv.keys()).toEqual([]);
  });
});
