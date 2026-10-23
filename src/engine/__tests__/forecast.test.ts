import { describe, expect, it } from 'vitest';
import { computeForecast, bestWindow, type ForecastInputs } from '../forecast';
import { rainbows, clarity, valleyMist, alpenglow, crepuscular } from '../phenomena';
import { makeLongAir, makeLongCorridor, makeLongObserver, ZURICH, type PointSpec } from '../../../test/synth';
import type { Observer, TerrainProfile } from '../types';
import type { HourCtx } from '../regimes';
import type { EventRating } from '../event';
import { ENGINE_VERSION } from '../config';

const H = 3600000;
const nice: PointSpec = { layers: [{ fromKm: 4, toKm: 6, cover: 50 }, { fromKm: 9, toKm: 10.5, cover: 35 }], rh: 70 };
const clear: PointSpec = { layers: [] };
const profile = (bearing: number, f: (d: number) => number): TerrainProfile => ({
  bearing,
  samples: [-30, -20, -10, -5, -2, 0, 2, 5, 10, 20, 30, 50, 100].map((d) => ({ distanceKm: d, elevationM: f(d) })),
});

function inputs(observer: Observer, now: number, opts: { withB?: boolean; obs?: boolean; spec?: (d: number) => PointSpec } = {}): ForecastInputs {
  const start = Math.floor(now / H) * H - 24 * H;
  const n = 24 * 5;
  const spec = opts.spec ?? ((d: number) => (d <= 20 ? nice : clear));
  const mk = (model: string) => makeLongCorridor(start, n, (d) => spec(d), { model });
  return {
    observer,
    now,
    sunset: { bearing: 300, A: mk('best_match'), B: opts.withB === false ? null : mk('ecmwf_ifs'), profile: profile(300, () => observer.elevationM) },
    sunrise: { bearing: 60, A: mk('best_match'), B: opts.withB === false ? null : mk('ecmwf_ifs'), profile: profile(60, () => observer.elevationM) },
    air: makeLongAir(start, n),
    obs: opts.obs === false ? null : makeLongObserver(start, n, () => ({ cloudCover: 30, low: 5, mid: 25, high: 10 })),
    fetchedAt: now - 30 * 60000,
  };
}

describe('computeForecast', () => {
  it('Zurich: events for three local days, a next event, plans and a versioned result', () => {
    const now = Date.parse('2026-06-21T10:00:00Z');
    const f = computeForecast(inputs(ZURICH, now));
    expect(f.engineVersion).toBe(ENGINE_VERSION);
    expect(f.events.filter((e) => e.kind === 'sunset')).toHaveLength(3);
    expect(f.events.filter((e) => e.kind === 'sunrise')).toHaveLength(3);
    expect(f.nextEvent?.kind).toBe('sunset');
    expect(f.nextEvent!.rating).toBeGreaterThan(3);
    expect(f.days).toHaveLength(3);
    expect(f.days[0]!.daytime.length).toBeGreaterThan(0);
    expect(f.days[0]!.night.length).toBeGreaterThan(0);
    expect(f.days[0]!.blue).toHaveLength(2);
    expect(f.days[0]!.tempMax).not.toBeNull();
    expect(f.photographersDay.end).toBeGreaterThan(now);
    expect(f.flags).toEqual([]);
    expect(bestWindow(f.days[0]!.daytime)).not.toBeNull();
    expect(bestWindow([])).toBeNull();
  });

  it('flags stale runs and a missing second model', () => {
    const now = Date.parse('2026-06-21T10:00:00Z');
    const inp = inputs(ZURICH, now, { withB: false });
    inp.fetchedAt = now - 8 * H;
    const f = computeForecast(inp);
    expect(f.flags).toContain('stale run');
    expect(f.flags).toContain('only one forecast available');
  });

  it('Tromsø polar day: valid answers without sunsets', () => {
    const tromso: Observer = { lat: 69.6492, lon: 18.9553, elevationM: 10, elevationOverride: false, timezone: 'Europe/Oslo', name: 'Tromsø' };
    const f = computeForecast(inputs(tromso, Date.parse('2026-06-21T10:00:00Z')));
    expect(f.events).toHaveLength(0);
    expect(f.nextEvent).toBeNull();
    expect(f.days[0]!.polar).toBe('day');
    expect(f.days[0]!.sunset).toBeNull();
    expect(f.days[0]!.night).toHaveLength(0);
  });

  it('Tromsø polar night: valid answers without sunrises', () => {
    const tromso: Observer = { lat: 69.6492, lon: 18.9553, elevationM: 10, elevationOverride: false, timezone: 'Europe/Oslo', name: 'Tromsø' };
    const f = computeForecast(inputs(tromso, Date.parse('2026-12-21T10:00:00Z')));
    expect(f.events).toHaveLength(0);
    expect(f.days[0]!.polar).toBe('night');
    expect(f.days[0]!.daytime).toHaveLength(0);
    expect(f.days[0]!.night.length).toBeGreaterThan(0);
  });

  it('no data at all still produces a forecast object with honest nulls', () => {
    const now = Date.parse('2026-06-21T10:00:00Z');
    const f = computeForecast({ observer: ZURICH, now, sunset: null, sunrise: null, air: null, obs: null, fetchedAt: now });
    expect(f.events.every((e) => e.rating == null)).toBe(true);
    expect(f.hours).toHaveLength(0);
  });

  it('a clear, dark, moonless night gives the Milky Way regime somewhere in June/July', () => {
    // New moon around 2026-07-14; pick a southern-hemisphere winter spot with long astro darkness.
    const obs: Observer = { lat: -24.6, lon: -70.4, elevationM: 2600, elevationOverride: true, timezone: 'America/Santiago', name: 'Atacama' };
    const now = Date.parse('2026-07-14T18:00:00Z');
    const inp = inputs(obs, now, { spec: () => clear });
    inp.obs = makeLongObserver(Math.floor(now / H) * H - 24 * H, 120, () => ({ cloudCover: 0, low: 0, mid: 0, high: 0, rh: 30, temp: 5, dewPoint: -15 }));
    const f = computeForecast(inp);
    const regimes = f.days.flatMap((d) => d.night.map((w) => w.regime));
    expect(regimes).toContain('milky-way');
  });
});

describe('phenomena', () => {
  const hc = (o: Partial<HourCtx>): HourCtx =>
    ({
      t: Date.parse('2026-06-21T16:00:00Z'),
      sunAlt: 25,
      total: 50,
      low: 30,
      mid: 20,
      high: 10,
      precip: 0.5,
      showers: 0.8,
      cape: 500,
      li: -1,
      sunshineS: 1800,
      directWm2: 300,
      visKm: 30,
      dewPoint: 10,
      temp: 15,
      rh: 70,
      wind: 5,
      gusts: 10,
      snowM: 0,
      nextSunshineS: 1800,
      nextDirectWm2: 300,
      prevVisKm: [30, 30, 30],
      moon: { altitude: -10, azimuth: 0, illumination: 0.1, phase: 0.1, waxing: true },
      moonBrightness: 0,
      coreAltDeg: -20,
      aod: 0.05,
      aboveDeck: false,
      terrain: 'open',
      hoursSinceSunrise: 10,
      darkHoursAllClear: false,
      ...o,
    }) as HourCtx;

  it('rainbow needs showers, direct sun, a low sun and rain opposite the sun', () => {
    expect(rainbows([hc({}), hc({ t: Date.parse('2026-06-21T17:00:00Z') })], () => 70)).toHaveLength(1);
    expect(rainbows([hc({})], () => 70)[0]!.likelihood).toBe('likely');
    expect(rainbows([hc({ sunAlt: 50 })], () => 70)).toHaveLength(0);
    expect(rainbows([hc({})], () => 10)).toHaveLength(0);
    expect(rainbows([hc({})], () => null)).toHaveLength(0);
  });
  it('exceptional clarity and valley mist', () => {
    expect(clarity([hc({ visKm: 70, aod: 0.03 })])).toHaveLength(1);
    expect(clarity([hc({ visKm: 20, aod: 0.03 })])).toHaveLength(0);
    const valley = { kind: 'valley' as const, reliefM: 800, backAngleDeg: 5, frontAngleDeg: 5, backReliefM: 600, known: true };
    const mist = valleyMist([hc({ sunAlt: -5, temp: 4, dewPoint: 3.2, total: 5, wind: 2, rh: 96, hoursSinceSunrise: null })], valley);
    expect(mist).toHaveLength(1);
    expect(mist[0]!.likelihood).toBe('likely');
    expect(valleyMist([hc({ sunAlt: -5 })], { ...valley, kind: 'open' })).toHaveLength(0);
  });
  it('alpenglow and crepuscular rays depend on terrain and the event', () => {
    const now = Date.parse('2026-06-21T10:00:00Z');
    const f = computeForecast(inputs(ZURICH, now));
    const ev = f.events.find((e) => e.kind === 'sunset')! as EventRating;
    const mountains = { kind: 'valley' as const, reliefM: 2000, backAngleDeg: 6, frontAngleDeg: 1, backReliefM: 1800, known: true };
    const ag = alpenglow(ev, mountains, ev.centre, ev.centre + 20 * 60000);
    expect(ag?.id).toBe('alpenglow');
    expect(alpenglow(ev, { ...mountains, backReliefM: 100 }, ev.centre, ev.centre + 1)).toBeNull();
    expect(alpenglow(ev, mountains, null, null)).toBeNull();
    const cr = crepuscular(ev, 0.2, 80);
    expect(cr?.id).toBe('crepuscular');
    expect(crepuscular(ev, 0.01, 30)).toBeNull();
  });
});
