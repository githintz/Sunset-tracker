import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { scoreMoment, canvasAbove, canvasBelow, upperValue, lowValue, pathWeights, reachFromBlocking, airModifier, rainMultiplier, lowDeck, isLit } from '../sunset';
import { columnAt, coverAt, sampleAt, bandFallbackCover, blockingAt } from '../column';
import { makeAir, makeCorridor, T0, type Layer, type PointSpec } from '../../../test/synth';
import type { CorridorSeries } from '../types';
import { SAMPLE_POINTS } from '../config';

const ctx = (elevKm = 0.4, air = makeAir(0.15)) => ({ observerElevKm: elevKm, air });
const MID50: Layer = { fromKm: 4, toKm: 6, cover: 50 };
const HIGH40: Layer = { fromKm: 9, toKm: 10.5, cover: 40 };
const nice: PointSpec = { layers: [MID50, HIGH40], rh: 70, visibilityM: 40000 };
const clearSpec: PointSpec = { layers: [], rh: 60 };

describe('§11 scoring scenarios', () => {
  it('overcast at every sample point scores 0', () => {
    const c = makeCorridor(() => ({ layers: [{ fromKm: 0, toKm: 12, cover: 100 }] }));
    const m = scoreMoment(c, T0, ctx());
    expect(m.overcastAll).toBe(true);
    expect(m.score).toBe(0);
  });

  it('overcast everywhere except one point is not forced to 0 by the rule', () => {
    const c = makeCorridor((d) => (d === 350 ? clearSpec : { layers: [{ fromKm: 0, toKm: 12, cover: 100 }] }));
    expect(scoreMoment(c, T0, ctx()).overcastAll).toBe(false);
  });

  it('clear corridor + ~50 % mid/high canvas scores ≥ 3.5', () => {
    const c = makeCorridor((d) => (d <= 20 ? nice : clearSpec));
    const m = scoreMoment(c, T0, ctx());
    expect(m.reach).toBe(1);
    expect(m.lit).toBe(1);
    expect(m.score).toBeGreaterThanOrEqual(3.5);
  });

  it('a perfectly clear sky scores low (pale glow)', () => {
    const m = scoreMoment(makeCorridor(() => clearSpec), T0, ctx());
    expect(m.canvas).toBeCloseTo(0.15, 5);
    expect(m.score).toBeLessThan(1);
    expect(m.score).toBeGreaterThan(0);
  });

  it('observer above a low deck vs below it gives different canvas values', () => {
    const deck = { layers: [{ fromKm: 0.5, toKm: 1.6, cover: 100 }] };
    const c = makeCorridor((d) => (d <= 20 ? deck : clearSpec));
    const above = scoreMoment(c, T0, ctx(2.77));
    const below = scoreMoment(c, T0, ctx(0.3));
    expect(above.undercast).toBe(true);
    expect(below.undercast).toBe(false);
    expect(above.canvas).toBeGreaterThan(below.canvas + 0.4);
    expect(above.score).toBeGreaterThan(below.score);
  });

  it('a low wall from 50 km blocks; the same wall from 350 km does not', () => {
    const wall: Layer = { fromKm: 0, toKm: 4.5, cover: 100 };
    const withWallFrom = (start: number) => makeCorridor((d) => (d <= 20 ? nice : d >= start ? { layers: [wall] } : clearSpec));
    const none = scoreMoment(makeCorridor((d) => (d <= 20 ? nice : clearSpec)), T0, ctx());
    const near = scoreMoment(withWallFrom(50), T0, ctx());
    const far = scoreMoment(withWallFrom(350), T0, ctx());
    expect(near.reach).toBe(0);
    expect(near.score).toBeLessThan(0.5);
    expect(far.reach).toBe(1);
    expect(far.score).toBeCloseTo(none.score, 6);
    expect(near.blockedZone?.fromKm).toBe(50);
  });

  it('rain over the canvas is a strong penalty, not a zero', () => {
    const c = makeCorridor((d) => (d <= 20 ? { ...nice, precipProb: 100, precip: 3 } : clearSpec));
    const m = scoreMoment(c, T0, ctx());
    expect(m.rain).toBeCloseTo(0.4, 6);
    expect(m.score).toBeGreaterThan(1);
  });

  it('a closed low lid overhead is the worst canvas', () => {
    const lid = { layers: [{ fromKm: 0.3, toKm: 1.5, cover: 100 }, MID50] };
    const m = scoreMoment(makeCorridor((d) => (d <= 20 ? lid : clearSpec)), T0, ctx());
    expect(m.canvas).toBeLessThan(0.2);
  });

  it('band-only models still score (no pressure levels)', () => {
    const c = makeCorridor((d) => (d <= 20 ? nice : clearSpec), { hasLevels: false, model: 'ecmwf_ifs' });
    const m = scoreMoment(c, T0, ctx());
    expect(m.score).toBeGreaterThan(3);
    expect(m.points.every((p) => !p.resolved)).toBe(true);
  });

  it('no data at all → 0 with every point flagged missing', () => {
    const c: CorridorSeries = { model: 'x', times: [T0 - 3600000, T0 + 3600000], points: [], hasLevels: true, fetchedAt: 0 };
    const m = scoreMoment(c, T0, { observerElevKm: 0, air: null });
    expect(m.score).toBe(0);
    expect(m.missingPoints).toHaveLength(10);
    expect(m.missingAir).toEqual(['aerosol', 'visibility', 'humidity']);
  });
});

describe('factor shapes', () => {
  it('upper canvas peaks between 25 and 75 %', () => {
    expect(upperValue(0)).toBe(0);
    expect(upperValue(0.1)).toBeCloseTo(0.4, 6);
    expect(upperValue(0.5)).toBe(1);
    expect(upperValue(1)).toBeCloseTo(0.45, 6);
  });
  it('low cloud: sparse glow > closed lid', () => {
    expect(lowValue(0.25)).toBeGreaterThan(lowValue(1));
    expect(lowValue(0.5)).toBeGreaterThan(lowValue(0.9));
    expect(lowValue(0)).toBe(0);
  });
  it('canvas above a deck is never worse than below it', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (L, M, H) => {
        expect(canvasAbove(L, M, H)).toBeGreaterThanOrEqual(canvasBelow(L, M, H));
        expect(canvasBelow(L, M, H)).toBeGreaterThanOrEqual(0);
        expect(canvasAbove(L, M, H)).toBeLessThanOrEqual(1);
      }),
    );
  });
  it('path weights are path lengths and adding samples keeps a uniform answer', () => {
    expect(pathWeights([50, 100, 150, 200, 300, 350])).toEqual([50, 50, 50, 75, 75, 50]);
    expect(reachFromBlocking(0.3)).toBe(1);
    expect(reachFromBlocking(0.55)).toBe(0);
    expect(reachFromBlocking(0.425)).toBeCloseTo(0.5, 6);
  });
  it('air modifier stays within 0.85–1.10 and missing inputs take the minimum', () => {
    expect(airModifier({ aod: null, dust: null, visKm: null, rh: null }).value).toBeCloseTo(0.85, 6);
    const good = airModifier({ aod: 0.2, dust: 5, visKm: 50, rh: 70 }).value;
    expect(good).toBeCloseTo(1.09, 6);
    expect(airModifier({ aod: 0.9, dust: 5, visKm: 5, rh: 98 }).value).toBe(0.85);
    expect(airModifier({ aod: 0.4, dust: 150, visKm: 20, rh: 87 }).value).toBeLessThan(1);
    expect(airModifier({ aod: 0.07, dust: 1, visKm: 20, rh: 40 }).value).toBeGreaterThan(0.99);
    expect(airModifier({ aod: 0.4, dust: 1, visKm: 20, rh: 87 }).value).toBeGreaterThan(0.9);
  });
  it('rain multiplier is never zero', () => {
    expect(rainMultiplier(100, 10)).toBeCloseTo(0.4, 6);
    expect(rainMultiplier(0, 0)).toBe(1);
    expect(rainMultiplier(null, 0)).toBeCloseTo(0.4, 6);
  });
});

describe('columns and interpolation', () => {
  it('interpolates in time and refuses to bridge gaps', () => {
    const times = [0, 3600000, 7200000];
    expect(sampleAt(times, [0, 10, null], 1800000)).toBe(5);
    expect(sampleAt(times, [0, 10, null], 5400000)).toBeNull();
    expect(sampleAt(times, [0, 10, null], 3600000)).toBe(10);
    expect(sampleAt(times, [0, 10, 20], 7200000)).toBe(20);
    expect(sampleAt(times, [0, 10, 20], 9000000)).toBeNull();
    expect(sampleAt([], [], 0)).toBeNull();
  });
  it('cover at height uses real geopotential heights, else the pessimistic band', () => {
    const c = makeCorridor(() => ({ layers: [{ fromKm: 4, toKm: 6, cover: 80 }] }));
    const col = columnAt(c.points.find((p) => p.distanceKm === 0)!, c.times, T0, true);
    expect(coverAt(col, 5).cover).toBe(80);
    expect(coverAt(col, 5).resolved).toBe(true);
    expect(coverAt(col, 1).cover).toBe(0);
    expect(coverAt(col, 14).resolved).toBe(false);
    const bandOnly = { ...col, levelsComplete: false };
    expect(coverAt(bandOnly, 5).resolved).toBe(false);
    expect(bandFallbackCover(bandOnly, 2.5)).toBe(80); // near the low/mid boundary: worse of the two
    expect(blockingAt(null, 1).blocking).toBe(1);
  });
  it('deck detection needs complete level data', () => {
    const c = makeCorridor(() => ({ layers: [{ fromKm: 0.5, toKm: 1.6, cover: 90 }] }));
    const col = columnAt(c.points[0]!, c.times, T0, true);
    expect(lowDeck(col, 2.5).observerAbove).toBe(true);
    expect(lowDeck(col, 1.0).observerAbove).toBe(false);
    expect(lowDeck({ ...col, levelsComplete: false }, 2.5).observerAbove).toBeNull();
  });
  it('clouds high up stay lit longer than low ones behind a wall', () => {
    const c = makeCorridor((d) => (d >= 100 ? { layers: [{ fromKm: 0, toKm: 3.5, cover: 100 }] } : {}));
    const cols = new Map(SAMPLE_POINTS.canvas.concat(SAMPLE_POINTS.corridor).map((d) => [d, columnAt(c.points.find((p) => p.distanceKm === d)!, c.times, T0, true)] as const));
    expect(isLit(cols, 0, 9)).toBe(true);
    expect(isLit(cols, 0, 1.0)).toBe(false);
  });
});

// ------------------------------------------------------------------ properties

const layerArb = fc.record({
  fromKm: fc.double({ min: 0, max: 11, noNaN: true }),
  thick: fc.double({ min: 0.2, max: 4, noNaN: true }),
  cover: fc.integer({ min: 0, max: 100 }),
}).map((l) => ({ fromKm: l.fromKm, toKm: l.fromKm + l.thick, cover: l.cover }));

const pointArb = fc.record({
  layers: fc.array(layerArb, { maxLength: 3 }),
  precipProb: fc.integer({ min: 0, max: 100 }),
  precip: fc.double({ min: 0, max: 4, noNaN: true }),
  rh: fc.integer({ min: 20, max: 100 }),
  visibilityM: fc.integer({ min: 500, max: 60000 }),
});

const ALL = [...SAMPLE_POINTS.canvas, ...SAMPLE_POINTS.corridor, ...SAMPLE_POINTS.chartOnly];
const specsArb = fc.array(pointArb, { minLength: ALL.length, maxLength: ALL.length });
const corridorFrom = (specs: PointSpec[]) => makeCorridor((d) => specs[ALL.indexOf(d)]!);

type NullTarget =
  | { kind: 'point'; i: number }
  | { kind: 'band'; i: number; band: 'low' | 'mid' | 'high' | 'cloudCover' }
  | { kind: 'levels'; i: number }
  | { kind: 'level'; i: number; l: number; what: 'cover' | 'heightM' }
  | { kind: 'precip'; i: number; what: 'precip' | 'precipProb' }
  | { kind: 'airvar'; i: number; what: 'rh' | 'visibilityM' }
  | { kind: 'aod' }
  | { kind: 'hour'; i: number; h: number };

const nullArb: fc.Arbitrary<NullTarget> = fc.oneof(
  fc.record({ kind: fc.constant('point' as const), i: fc.nat(13) }),
  fc.record({ kind: fc.constant('band' as const), i: fc.nat(13), band: fc.constantFrom('low' as const, 'mid' as const, 'high' as const, 'cloudCover' as const) }),
  fc.record({ kind: fc.constant('levels' as const), i: fc.nat(13) }),
  fc.record({ kind: fc.constant('level' as const), i: fc.nat(13), l: fc.nat(12), what: fc.constantFrom('cover' as const, 'heightM' as const) }),
  fc.record({ kind: fc.constant('precip' as const), i: fc.nat(13), what: fc.constantFrom('precip' as const, 'precipProb' as const) }),
  fc.record({ kind: fc.constant('airvar' as const), i: fc.nat(13), what: fc.constantFrom('rh' as const, 'visibilityM' as const) }),
  fc.record({ kind: fc.constant('aod' as const) }),
  fc.record({ kind: fc.constant('hour' as const), i: fc.nat(13), h: fc.nat(4) }),
);

function applyNulls(c: CorridorSeries, air: ReturnType<typeof makeAir>, targets: NullTarget[]) {
  const cc: CorridorSeries = structuredClone(c);
  const aa = structuredClone(air);
  const removed = new Set<number>();
  for (const t of targets) {
    if (t.kind === 'aod') {
      aa.aod = aa.aod.map(() => null);
      continue;
    }
    const p = cc.points[t.i]!;
    const nul = (arr: (number | null)[]) => arr.fill(null);
    if (t.kind === 'point') removed.add(p.distanceKm);
    else if (t.kind === 'band') nul(p[t.band]);
    else if (t.kind === 'levels') p.levels.forEach((l) => (nul(l.cover), nul(l.heightM)));
    else if (t.kind === 'level') nul(p.levels[t.l]![t.what]);
    else if (t.kind === 'precip') nul(p[t.what]);
    else if (t.kind === 'airvar') nul(p[t.what]);
    else if (t.kind === 'hour') {
      for (const k of ['cloudCover', 'low', 'mid', 'high', 'precip', 'precipProb', 'rh', 'visibilityM'] as const) p[k][t.h] = null;
      p.levels.forEach((l) => (l.cover[t.h] = null));
    }
  }
  cc.points = cc.points.filter((p) => !removed.has(p.distanceKm));
  return { cc, aa };
}

describe('§11 scoring properties (fast-check)', () => {
  it('scores always lie within [0, 5]', () => {
    fc.assert(
      fc.property(specsArb, fc.double({ min: 0, max: 4.5, noNaN: true }), (specs, elev) => {
        const m = scoreMoment(corridorFrom(specs), T0 + 1234567 % 3600000, ctx(elev));
        expect(m.score).toBeGreaterThanOrEqual(0);
        expect(m.score).toBeLessThanOrEqual(5);
        for (const k of ['canvas', 'reach', 'lit', 'litShare', 'rain'] as const) {
          expect(m[k]).toBeGreaterThanOrEqual(0);
          expect(m[k]).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('any null input never increases the score (missing data is never clear sky)', () => {
    fc.assert(
      fc.property(specsArb, fc.array(nullArb, { minLength: 1, maxLength: 6 }), fc.double({ min: 0, max: 3, noNaN: true }), (specs, targets, elev) => {
        const c = corridorFrom(specs);
        const air = makeAir(0.15);
        const full = scoreMoment(c, T0, ctx(elev, air)).score;
        const { cc, aa } = applyNulls(c, air, targets);
        const partial = scoreMoment(cc, T0, ctx(elev, aa)).score;
        expect(partial).toBeLessThanOrEqual(full + 1e-9);
      }),
      { numRuns: 300 },
    );
  });

  it('is monotonic in corridor blocking (more corridor cloud never helps)', () => {
    fc.assert(
      fc.property(specsArb, fc.nat(5), layerArb, (specs, which, extra) => {
        const base = corridorFrom(specs);
        const d = SAMPLE_POINTS.corridor[which]!;
        const i = ALL.indexOf(d);
        const more = specs.map((s, k) => (k === i ? { ...s, layers: [...(s.layers ?? []), extra] } : s));
        const a = scoreMoment(base, T0, ctx()).score;
        const b = scoreMoment(corridorFrom(more), T0, ctx()).score;
        expect(b).toBeLessThanOrEqual(a + 1e-9);
      }),
      { numRuns: 200 },
    );
  });

  it('chart-only points never influence the score', () => {
    fc.assert(
      fc.property(specsArb, pointArb, (specs, other) => {
        const changed = specs.map((s, k) => ((SAMPLE_POINTS.chartOnly as readonly number[]).includes(ALL[k]!) ? other : s));
        expect(scoreMoment(corridorFrom(changed), T0, ctx()).score).toBeCloseTo(scoreMoment(corridorFrom(specs), T0, ctx()).score, 12);
      }),
      { numRuns: 60 },
    );
  });
});

describe('underground pressure levels', () => {
  it('a "deck" below the model surface does not make a low observer stand above the cloud', () => {
    // fog reported at 1000 hPa (110 m) although the surface is at 965 hPa (~400 m)
    const c = makeCorridor(() => ({ layers: [{ fromKm: 0, toKm: 0.2, cover: 100 }, MID50] }));
    for (const p of c.points) p.surfacePressure = c.times.map(() => 965);
    const withSp = scoreMoment(c, T0, ctx(0.41));
    expect(withSp.undercast).toBe(false);
    for (const p of c.points) p.surfacePressure = undefined;
    expect(scoreMoment(c, T0, ctx(0.41)).undercast).toBe(true);
  });
});
