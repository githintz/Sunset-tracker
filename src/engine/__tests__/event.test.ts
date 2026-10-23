import { describe, expect, it } from 'vitest';
import { rateEvent, verdictFor, combine, verdictLabel } from '../event';
import { goldenHour } from '../golden';
import { skyRating } from '../sky';
import { scoreMoment } from '../sunset';
import { sunEvents } from '../solar';
import { makeAir, makeCorridor, makeObserverSeries, ZURICH, type Layer, type PointSpec } from '../../../test/synth';
import type { CorridorSeries } from '../types';

const day = Date.parse('2026-06-21T00:00:00Z');
const SUNSET = sunEvents(ZURICH.lat, ZURICH.lon, day, day + 86400000).find((e) => e.kind === 'sunset')!;
const SUNRISE = sunEvents(ZURICH.lat, ZURICH.lon, day, day + 86400000).find((e) => e.kind === 'sunrise')!;
const hours = (t0: number) => Array.from({ length: 13 }, (_, i) => t0 + (i - 6) * 3600000);
const MID50: Layer = { fromKm: 4, toKm: 6, cover: 50 };
const nice: PointSpec = { layers: [MID50, { fromKm: 9, toKm: 10.5, cover: 40 }], rh: 70 };
const clear: PointSpec = { layers: [], rh: 60 };

function corridor(spec: (d: number) => PointSpec, model = 'best_match', t0 = SUNSET.centre): CorridorSeries {
  const c = makeCorridor(spec, { model, t0 });
  // widen the time axis so best-light and ±1 h scenarios are covered
  const times = hours(Math.floor(t0 / 3600000) * 3600000);
  const n = times.length;
  c.times = times;
  for (const p of c.points) {
    for (const k of ['cloudCover', 'low', 'mid', 'high', 'precip', 'precipProb', 'rh', 'visibilityM'] as const) p[k] = Array(n).fill(p[k][0]);
    for (const l of p.levels) {
      l.cover = Array(n).fill(l.cover[0]);
      l.heightM = Array(n).fill(l.heightM[0]);
    }
  }
  return c;
}
const obsSeries = (over = {}) => makeObserverSeries(over, hours(Math.floor(SUNSET.centre / 3600000) * 3600000));
const airS = () => {
  const a = makeAir(0.15);
  a.times = hours(Math.floor(SUNSET.centre / 3600000) * 3600000);
  a.aod = a.times.map(() => 0.15);
  a.dust = a.times.map(() => 5);
  return a;
};

describe('event rating', () => {
  it('averages event, best-light and second-model scenarios; models agree → high confidence', () => {
    const A = corridor((d) => (d <= 20 ? nice : clear));
    const B = corridor((d) => (d <= 20 ? nice : clear), 'ecmwf_ifs');
    const r = rateEvent({ observer: ZURICH, event: SUNSET, corridorA: A, corridorB: B, air: airS(), obs: obsSeries() });
    expect(r.event && r.best && r.modelB).toBeTruthy();
    expect(r.raw).toBeCloseTo((r.event!.score + r.best!.score + r.modelB!.score) / 3, 9);
    expect(r.rating).toBe(Math.round(r.raw! * 10) / 10);
    expect(r.modelsDisagree).toBe(false);
    expect(r.singleModel).toBe(false);
    expect(r.confidence).toBe('high');
    expect(r.verdict).toBeGreaterThanOrEqual(3);
    expect(r.reasons[0]!.kind).toBe('main');
    expect(r.shoulders).toHaveLength(2);
    expect(r.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('flags model disagreement and shows both scores', () => {
    const A = corridor((d) => (d <= 20 ? nice : clear));
    const B = corridor(() => ({ layers: [{ fromKm: 0, toKm: 12, cover: 100 }] }), 'ecmwf_ifs');
    const r = rateEvent({ observer: ZURICH, event: SUNSET, corridorA: A, corridorB: B, air: airS(), obs: obsSeries() });
    expect(r.modelsDisagree).toBe(true);
    expect(r.confidence).toBe('low');
    expect(r.reasons.some((x) => x.code === 'disagree')).toBe(true);
  });

  it('model B missing entirely → "only one forecast available"', () => {
    const A = corridor((d) => (d <= 20 ? nice : clear));
    const r = rateEvent({ observer: ZURICH, event: SUNSET, corridorA: A, corridorB: null, air: airS(), obs: obsSeries() });
    expect(r.singleModel).toBe(true);
    expect(r.modelB).toBeNull();
    expect(r.reasons.find((x) => x.code === 'single-model')?.text).toMatch(/Only one forecast available/);
    expect(r.confidence).toBe('medium');
  });

  it('primary model missing → the second model stands in and says so', () => {
    const B = corridor((d) => (d <= 20 ? nice : clear), 'ecmwf_ifs025');
    const r = rateEvent({ observer: ZURICH, event: SUNSET, corridorA: null, corridorB: B, air: airS(), obs: obsSeries() });
    expect(r.primaryIsB).toBe(true);
    expect(r.singleModel).toBe(true);
    expect(r.event?.model).toBe('ecmwf_ifs025');
    expect(r.reasons.some((x) => x.code === 'primary-missing')).toBe(true);
    expect(r.rating).not.toBeNull();
  });

  it('no data covering the event → null rating and an honest reason', () => {
    const A = corridor((d) => (d <= 20 ? nice : clear), 'best_match', SUNSET.centre + 3 * 86400000);
    const r = rateEvent({ observer: ZURICH, event: SUNSET, corridorA: A, corridorB: null, air: null, obs: null });
    expect(r.rating).toBeNull();
    expect(r.verdict).toBeNull();
    expect(r.verdictLabel).toBe('No data');
    expect(r.reasons[0]!.code).toBe('no-data');
  });

  it('explains a blocked light path with distances', () => {
    const A = corridor((d) => (d <= 20 ? nice : { layers: [{ fromKm: 0, toKm: 4.5, cover: 100 }] }));
    const r = rateEvent({ observer: ZURICH, event: SUNSET, corridorA: A, corridorB: null, air: airS(), obs: obsSeries() });
    const main = r.reasons.find((x) => x.kind === 'main')!;
    expect(main.code).toBe('reach');
    expect(main.text).toMatch(/Light path blocked: \d+ % blocking cloud at the ray's height around 50–\d+ km/);
  });

  it('explains being above the low cloud under a mid-level lid', () => {
    const spec = (d: number): PointSpec =>
      d <= 20 ? { layers: [{ fromKm: 0.4, toKm: 1.6, cover: 100 }, { fromKm: 4, toKm: 6, cover: 100 }] } : clear;
    const A = corridor(spec);
    const obs = { ...ZURICH, elevationM: 2770, name: 'Gornergrat' };
    const r = rateEvent({ observer: obs, event: SUNSET, corridorA: A, corridorB: null, air: airS(), obs: obsSeries() });
    expect(r.event!.undercast).toBe(true);
    expect(r.reasons.some((x) => /above the low cloud.*mid-level deck/.test(x.text))).toBe(true);
  });

  it('reports missing data honestly', () => {
    const A = corridor((d) => (d <= 20 ? nice : clear));
    A.points = A.points.filter((p) => p.distanceKm !== 100);
    const r = rateEvent({ observer: ZURICH, event: SUNSET, corridorA: A, corridorB: null, air: null, obs: null });
    expect(r.reasons.some((x) => x.code === 'missing-points' && /100 km/.test(x.text))).toBe(true);
    expect(r.reasons.some((x) => x.code === 'missing-air')).toBe(true);
    expect(r.confidence).not.toBe('high');
  });

  it('works for sunrise (best light before the event)', () => {
    const A = corridor((d) => (d <= 20 ? nice : clear), 'best_match', SUNRISE.centre);
    const r = rateEvent({ observer: ZURICH, event: SUNRISE, corridorA: A, corridorB: null, air: null, obs: null });
    expect(r.bestLight).toBeLessThan(r.centre);
    expect(r.kind).toBe('sunrise');
    expect(r.rating).not.toBeNull();
  });

  it('verdict bands and combination', () => {
    expect([0, 0.99, 1, 2.5, 3.99, 4, 5].map(verdictFor)).toEqual([0, 0, 1, 2, 3, 4, 4]);
    expect(verdictFor(3.5)).toBe(3);
    expect(combine(4, 1)).toBeCloseTo(3.4, 9);
    expect(combine(4, null)).toBe(4);
    expect(verdictLabel(4)).toBe('Go');
    expect(verdictLabel(null)).toBe('No data');
  });
});

describe('golden hour', () => {
  const base = { lat: ZURICH.lat, lon: ZURICH.lon, observerElevKm: 0.4, kind: 'sunset' as const, eventMs: SUNSET.official, air: 1 };
  it('clear near field → warm direct light', () => {
    const g = goldenHour({ ...base, corridor: corridor(() => clear), observer: obsSeries() });
    expect(g.label).toBe('warm direct light');
    expect(g.score).toBeGreaterThan(4);
    expect(g.start).toBeLessThan(SUNSET.official);
    expect(g.end).toBeGreaterThan(SUNSET.official);
  });
  it('low cloud toward the sun → diffused muted light', () => {
    const g = goldenHour({ ...base, corridor: corridor(() => ({ layers: [{ fromKm: 0, toKm: 3, cover: 100 }] })), observer: obsSeries() });
    expect(g.label).toBe('diffused muted light');
    expect(g.score).toBeLessThan(1);
  });
  it('fog at the viewpoint blocks direct light; missing data is flagged', () => {
    const g = goldenHour({ ...base, corridor: corridor(() => clear), observer: obsSeries({ visibilityM: 300 }) });
    expect(g.directShare).toBe(0);
    const m = goldenHour({ ...base, corridor: null, observer: null });
    expect(m.missing).toBe(true);
    expect(m.score).toBeNull();
    expect(m.label).toBe('no data');
    const partial = goldenHour({ ...base, corridor: null, observer: obsSeries() });
    expect(partial.directShare).toBe(0);
  });
  it('polar night has no golden hour', () => {
    const t = Date.parse('2026-12-21T11:00:00Z');
    const g = goldenHour({ lat: 78.2, lon: 15.6, observerElevKm: 0, kind: 'sunset', eventMs: t, air: 1, corridor: null, observer: null });
    expect(g.label).toBe('no golden hour');
    expect(g.score).toBeNull();
  });
  it('sunrise samples after the event', () => {
    const g = goldenHour({ ...base, kind: 'sunrise', eventMs: SUNRISE.official, corridor: corridor(() => clear, 'best_match', SUNRISE.centre), observer: makeObserverSeries({}, hours(Math.floor(SUNRISE.centre / 3600000) * 3600000)) });
    expect(g.start).toBeLessThan(SUNRISE.official);
    expect(g.end).toBeGreaterThan(SUNRISE.official);
  });
});

describe('sky & clouds', () => {
  const at = (spec: (d: number) => PointSpec, elev = 0.4) => scoreMoment(corridor(spec), SUNSET.centre, { observerElevKm: elev, air: null });
  it('clear and uniform overcast are Flat', () => {
    expect(skyRating(at(() => clear), null).label).toBe('Flat');
    expect(skyRating(at(() => ({ layers: [{ fromKm: 0, toKm: 12, cover: 100 }] })), null).label).toBe('Flat');
    expect(skyRating(null, null).label).toBe('Flat');
  });
  it('layered, broken sky over a sea of clouds is Dramatic', () => {
    const s = skyRating(at((d) => (d <= 20 ? { layers: [{ fromKm: 0.4, toKm: 1.6, cover: 90 }, MID50, { fromKm: 9, toKm: 10, cover: 30 }] } : clear), 2.77), 800);
    expect(s.label).toBe('Dramatic');
  });
  it('single broken layer is Scenic or Plain', () => {
    const s = skyRating(at(() => ({ layers: [MID50] })), null);
    expect(['Plain', 'Scenic']).toContain(s.label);
  });
});
