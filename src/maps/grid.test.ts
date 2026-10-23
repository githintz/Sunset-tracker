import { describe, expect, it } from 'vitest';
import { bilinear, cellCoords, cellUnderlight, computeLayers, darkSky, gridDims, ALPS, type GridData } from './grid';
import { decodeBytes, encodeBytes, quantise, ramp, NO_DATA } from './format';
import type { Num } from '../engine/types';

const spec = { latMin: 45, latMax: 47, lonMin: 6, lonMax: 10, step: 0.5 };
const H = 3600000;
const T0 = Date.parse('2026-06-21T00:00:00Z');

function grid(
  f: (lat: number, lon: number, t: number) => Partial<Record<'total' | 'low' | 'mid' | 'high' | 'precipProb', Num>>,
  sp = spec,
): GridData {
  const spec = sp;
  const times = Array.from({ length: 48 }, (_, i) => T0 + i * H);
  const cells = cellCoords(spec);
  const values = { total: [], low: [], mid: [], high: [], precipProb: [] } as GridData['values'];
  for (const c of cells)
    for (const k of Object.keys(values) as Array<keyof GridData['values']>)
      values[k].push(times.map((t) => {
        const v = f(c.lat, c.lon, t)[k];
        return v === undefined ? 0 : v;
      }));
  return { spec, times, values };
}

describe('map grid', () => {
  it('dimensions of the default Alps grid', () => {
    expect(gridDims(ALPS)).toEqual({ nLat: 23, nLon: 51 });
    expect(cellCoords(ALPS)).toHaveLength(1173);
  });

  it('bilinear interpolation is exact on linear fields and null outside or next to gaps', () => {
    const g = grid((lat, lon) => ({ total: 10 * lat + lon }));
    expect(bilinear(g, 'total', 0, 45.25, 6.75)).toBeCloseTo(10 * 45.25 + 6.75, 9);
    expect(bilinear(g, 'total', 0, 47, 10)).toBeCloseTo(480, 9);
    expect(bilinear(g, 'total', 0, 44.9, 7)).toBeNull();
    const gap = grid((lat, lon) => ({ total: lat === 46 && lon === 8 ? null : 1 }));
    expect(bilinear(gap, 'total', 0, 46.1, 8.1)).toBeNull();
    expect(bilinear(gap, 'total', 0, 45.1, 6.1)).toBe(1);
  });

  it('underlight: broken mid cloud scores well, overcast scores 0, leaving the grid is never optimistic', () => {
    const wide = { latMin: 42, latMax: 51, lonMin: 0, lonMax: 14, step: 0.5 };
    const nice = grid(() => ({ total: 50, mid: 50, high: 20 }), wide);
    const t = Date.parse('2026-06-21T19:30:00Z');
    expect(cellUnderlight(nice, 46, 8, t, 300)).toBeGreaterThan(2);
    const oc = grid(() => ({ total: 100, low: 100, mid: 100 }), wide);
    expect(cellUnderlight(oc, 46, 8, t, 300)).toBe(0);
    // from the western edge, most of the corridor is outside the grid → worst case
    expect(cellUnderlight(nice, 46, 0.5, t, 270)).toBeLessThan(cellUnderlight(nice, 46, 13, t, 270));
  });

  it('dark sky needs night, no moon and no cloud', () => {
    const night = Date.parse('2026-06-21T23:30:00Z');
    const day = Date.parse('2026-06-21T12:00:00Z');
    expect(darkSky(46, 8, day, 0)).toBe(0);
    expect(darkSky(46, 8, night, null)).toBeNull();
    expect(darkSky(46, 8, night, 0)!).toBeGreaterThan(darkSky(46, 8, night, 80)!);
  });

  it('computes and encodes every layer', () => {
    const g = grid(() => ({ total: 40, low: 10, mid: 30, high: 10, precipProb: 10 }));
    const layers = computeLayers(g, [T0, T0 + 24 * H], (t) => new Date(t).toISOString());
    expect(layers.map((l) => l.id)).toEqual(['underlight-sunset', 'underlight-sunrise', 'cloud-low', 'cloud-mid', 'cloud-high', 'cloud-total', 'darksky']);
    const low = layers.find((l) => l.id === 'cloud-low')!;
    expect(low.frames).toHaveLength(16);
    expect(decodeBytes(low.frames[0]!.data)[0]).toBe(25);
    const sunset = layers[0]!;
    expect(sunset.frames).toHaveLength(2);
    expect(decodeBytes(sunset.frames[0]!.data).length).toBe(cellCoords(spec).length);
  });

  it('format helpers', () => {
    expect(quantise(null, 2)).toBe(NO_DATA);
    expect(quantise(1000, 1)).toBe(254);
    expect(decodeBytes(encodeBytes(Uint8Array.from([0, 7, 255])))).toEqual(Uint8Array.from([0, 7, 255]));
    expect(ramp(0)).toEqual([40, 30, 70]);
    expect(ramp(2)).toEqual([255, 236, 150]);
  });
});
