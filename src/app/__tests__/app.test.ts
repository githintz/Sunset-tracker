import { describe, expect, it } from 'vitest';
import { computeForecast } from '../../engine/forecast';
import { makeLongAir, makeLongCorridor, makeLongObserver, ZURICH, type PointSpec } from '../../../test/synth';
import { mergeForecast, rateEntry, exportJson, parseImport, mergeImported, entryFrom, isEntry, loadHistory, saveHistory } from '../history';
import { isSpot, makeSpot, spotFromLink, spotLink, loadSpots, saveSpots, loadActiveId, saveActiveId } from '../spots';
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../settings';
import { memoryKV } from '../../data/cache';
import { planAlerts } from '../../native/notifications';
import { buildCrossSection, xFrac, oktas } from '../../ui/charts/crossSection';

const H = 3600000;
const nice: PointSpec = { layers: [{ fromKm: 4, toKm: 6, cover: 50 }, { fromKm: 9, toKm: 10.5, cover: 35 }], rh: 70 };
function forecastAt(now: number) {
  const start = Math.floor(now / H) * H - 24 * H;
  const mk = (m: string) => makeLongCorridor(start, 120, (d) => (d <= 20 ? nice : {}), { model: m });
  return computeForecast({
    observer: ZURICH,
    now,
    sunset: { bearing: 300, A: mk('best_match'), B: mk('ecmwf_ifs025'), profile: null },
    sunrise: { bearing: 60, A: mk('best_match'), B: mk('ecmwf_ifs025'), profile: null },
    air: makeLongAir(start, 120),
    obs: makeLongObserver(start, 120, () => ({})),
    fetchedAt: now,
  });
}

describe('history', () => {
  const now = Date.parse('2026-06-21T10:00:00Z');
  const f = forecastAt(now);
  it('stores issued forecasts with the engine version', () => {
    const h = mergeForecast([], 'z', f, now);
    expect(h.length).toBe(f.events.filter((e) => e.rating != null).length);
    expect(h.every((e) => e.engineVersion === f.engineVersion && isEntry(e))).toBe(true);
  });
  it('replaces upcoming forecasts but freezes past ones (never re-scored)', () => {
    const h1 = mergeForecast([], 'z', f, now);
    const target = h1.find((e) => e.official > now)!;
    const frozen = { ...h1.find((e) => e.official > now)!, official: now - 1000, rating: 1.1 };
    const later = forecastAt(now + 2 * H);
    const h2 = mergeForecast(
      h1.map((e) => (e.id === target.id ? { ...e, rating: 0.1 } : e)).concat([{ ...frozen, id: 'z:sunset:1' }]),
      'z',
      later,
      now + 2 * H,
    );
    expect(h2.find((e) => e.id === target.id)!.issuedAt).toBe(now + 2 * H);
    expect(h2.find((e) => e.id === 'z:sunset:1')!.rating).toBe(1.1);
  });
  it('keeps user ratings, exports and imports', async () => {
    const h = rateEntry(mergeForecast([], 'z', f, now), mergeForecast([], 'z', f, now)[0]!.id, { sunset: 4, golden: 3, sky: 5, note: 'pink!' }, now);
    expect(h[0]!.user?.note).toBe('pink!');
    const json = exportJson([makeSpot('Z', 47, 8)], h, now);
    const back = parseImport(json);
    expect(back.history[0]!.user?.sunset).toBe(4);
    expect(mergeImported([], back.history)).toHaveLength(h.length);
    expect(mergeImported(h.map((e) => ({ ...e, user: null })), back.history)[0]!.user?.sky).toBe(5);
    expect(() => parseImport('nope')).toThrow(/not valid JSON/);
    expect(() => parseImport('{"app":"other"}')).toThrow(/Not a Glowcast/);
    const kv = memoryKV();
    await saveHistory(kv, h);
    expect(await loadHistory(kv)).toHaveLength(h.length);
    await kv.set('history:v1', 'garbage');
    expect(await loadHistory(kv)).toEqual([]);
    expect(entryFrom('z', f, f.events[0]!).spotName).toBe('Zurich');
  });
});

describe('spots and settings', () => {
  it('validates, links and persists spots', async () => {
    const s = makeSpot('  ', 46, 7.75, null, 2770);
    expect(s.name).toBe('46.000, 7.750');
    expect(isSpot(s)).toBe(true);
    expect(isSpot({ ...s, lat: 120 })).toBe(false);
    const link = spotLink('https://x/', { ...s, name: 'Gornergrat' });
    const back = spotFromLink(link.slice(link.indexOf('#')))!;
    expect(back.name).toBe('Gornergrat');
    expect(back.elevationOverrideM).toBe(2770);
    expect(spotFromLink('#/today?spot=999,1')).toBeNull();
    expect(spotFromLink('#/today')).toBeNull();
    const kv = memoryKV();
    await saveSpots(kv, [s, { bad: true } as never]);
    expect(await loadSpots(kv)).toHaveLength(1);
    await saveActiveId(kv, s.id);
    expect(await loadActiveId(kv)).toBe(s.id);
  });
  it('settings fall back to defaults', async () => {
    const kv = memoryKV();
    expect(await loadSettings(kv)).toEqual(DEFAULT_SETTINGS);
    await saveSettings(kv, { ...DEFAULT_SETTINGS, theme: 'light' });
    expect((await loadSettings(kv)).theme).toBe('light');
    await kv.set('settings:v1', { theme: 'pink' });
    expect((await loadSettings(kv)).theme).toBe('system');
  });
});

describe('alerts', () => {
  it('plans alerts at the chosen local time for events at or above the threshold', () => {
    const now = Date.parse('2026-06-21T06:00:00Z');
    const f = forecastAt(now);
    const alerts = planAlerts(0, f, { enabled: true, time: '14:00', threshold: 0, spotIds: [], dailyReminder: false }, now);
    expect(alerts.length).toBeGreaterThan(0);
    for (const a of alerts) {
      expect(a.at).toBeGreaterThan(now);
      expect(new Date(a.at).getUTCHours()).toBe(12); // 14:00 CEST
    }
    expect(planAlerts(0, f, { enabled: true, time: '14:00', threshold: 4, spotIds: [], dailyReminder: false }, now).length).toBeLessThan(alerts.length + 1);
    expect(alerts[0]!.title).toMatch(/Zurich: .* for (sunset|sunrise)/);
  });
});

describe('cross-section geometry', () => {
  it('compresses the far range and maps cells', () => {
    expect(xFrac(-5)).toBe(0);
    expect(xFrac(30)).toBeCloseTo(0.45, 9);
    expect(xFrac(350)).toBe(1);
    expect(xFrac(1000)).toBe(1);
    expect(oktas(100)).toBe(8);
    expect(oktas(null)).toBeNull();
    const now = Date.parse('2026-06-21T10:00:00Z');
    const c = makeLongCorridor(now - 24 * H, 48, (d) => (d <= 20 ? nice : {}));
    const v = buildCrossSection(c, now, 0.4, { bearing: 300, samples: [{ distanceKm: 0, elevationM: 400 }, { distanceKm: 50, elevationM: 900 }] });
    expect(v.columns).toHaveLength(14);
    expect(v.columns.every((col) => col.state === 'resolved')).toBe(true);
    expect(v.columns.find((col) => col.distanceKm === 0)!.cells.length).toBeGreaterThan(0);
    expect(v.terrain).toHaveLength(2);
    expect(v.ray[0]!.z).toBeCloseTo(0.4, 9);
    c.points[0]!.cloudCover.fill(null);
    c.points[0]!.low.fill(null);
    c.points[0]!.mid.fill(null);
    c.points[0]!.high.fill(null);
    c.points[0]!.levels.forEach((l) => l.cover.fill(null));
    expect(buildCrossSection(c, now, 0.4, null).columns[0]!.state).toBe('missing');
    const bands = buildCrossSection({ ...c, hasLevels: false, points: c.points.map((p) => ({ ...p, levels: [] })) }, now, 0.4, null);
    expect(bands.columns[1]!.state).toBe('bands');
    expect(buildCrossSection(null, now, 0, null).columns).toEqual([]);
  });
});
