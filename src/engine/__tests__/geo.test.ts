import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  destination,
  distanceKm,
  effectiveRadius,
  initialBearing,
  lightPathAltitudeKm,
  normBearing,
  normLon,
  rayAltitudeKm,
  rayHeightKm,
  shadowAngleDeg,
  shadowAngleRad,
} from '../geo';

const dms = (d: number, m: number, s: number) => d + m / 60 + s / 3600;

describe('tangent ray height h(d) = d²/2R (§4.1 sanity table)', () => {
  it.each([
    [50, 0.2],
    [100, 0.78],
    [150, 1.77],
    [200, 3.14],
    [300, 7.06],
    [350, 9.61],
  ])('%i km → %f km', (d, h) => {
    expect(rayHeightKm(d)).toBeCloseTo(h, 2);
  });

  it('adds the observer elevation and ignores the sign of the distance', () => {
    expect(rayAltitudeKm(2.77, 100)).toBeCloseTo(2.77 + 0.785, 3);
    expect(rayAltitudeKm(0, -5)).toBeCloseTo(rayHeightKm(5), 9);
  });

  it('refraction factor lowers the ray (larger effective radius)', () => {
    expect(effectiveRadius(0.13)).toBeGreaterThan(6371);
    expect(rayHeightKm(200, 0.13)).toBeLessThan(rayHeightKm(200, 0));
  });
});

describe('shadow angle δmax = sqrt(2h/R) (§4.2)', () => {
  it('≈1.8° at 3 km and ≈2.9° at 8 km', () => {
    expect(shadowAngleDeg(3)).toBeCloseTo(1.76, 2);
    expect(Math.round(shadowAngleDeg(3) * 10) / 10).toBe(1.8);
    expect(Math.round(shadowAngleDeg(8) * 10) / 10).toBe(2.9);
  });
  it('is zero at or below the ground', () => {
    expect(shadowAngleRad(0)).toBe(0);
    expect(shadowAngleRad(-1)).toBe(0);
  });
  it('the light path from a cloud at δmax just grazes the surface', () => {
    const h = 5;
    const dep = shadowAngleDeg(h);
    const sTangent = Math.sqrt(2 * h * 6371);
    expect(lightPathAltitudeKm(h, dep, sTangent)).toBeCloseTo(0, 1);
    expect(lightPathAltitudeKm(h, 0, 100)).toBeCloseTo(h + rayHeightKm(100), 9);
  });
});

describe('great-circle destination', () => {
  it('matches the Movable Type reference example within 50 m', () => {
    // 53°19′14″N 001°43′47″W, bearing 096°01′18″, 124.8 km → 53°11′18″N 000°08′00″E
    const p = destination({ lat: dms(53, 19, 14), lon: -dms(1, 43, 47) }, dms(96, 1, 18), 124.8);
    expect(distanceKm(p, { lat: dms(53, 11, 18), lon: dms(0, 8, 0) })).toBeLessThan(0.05);
  });

  it('crosses the antimeridian cleanly', () => {
    const start = { lat: 10, lon: 179.9 };
    const p = destination(start, 90, 50);
    expect(p.lon).toBeLessThan(-179);
    expect(p.lon).toBeGreaterThanOrEqual(-180);
    expect(distanceKm(start, p)).toBeCloseTo(50, 6);
    expect(initialBearing(p, start)).toBeCloseTo(270, 0);
    const q = destination({ lat: -20, lon: -179.95 }, 270, 30);
    expect(q.lon).toBeGreaterThan(179);
  });

  it('negative distances walk backwards', () => {
    const s = { lat: 46, lon: 7.75 };
    const a = destination(s, 300, -5);
    const b = destination(s, 120, 5);
    expect(distanceKm(a, b)).toBeLessThan(1e-6);
  });

  it('round-trips distance and bearing (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -80, max: 80, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: 0, max: 359.99, noNaN: true }),
        fc.double({ min: 1, max: 400, noNaN: true }),
        (lat, lon, brg, d) => {
          const p = destination({ lat, lon }, brg, d);
          expect(distanceKm({ lat, lon }, p)).toBeCloseTo(d, 6);
          const back = initialBearing({ lat, lon }, p);
          const diff = Math.abs(((back - brg + 540) % 360) - 180);
          expect(diff).toBeLessThan(1e-6);
        },
      ),
    );
  });

  it('normalises longitudes and bearings', () => {
    expect(normLon(190)).toBe(-170);
    expect(normLon(-190)).toBe(170);
    expect(normLon(-180)).toBe(-180);
    expect(normLon(0)).toBe(0);
    expect(normBearing(-10)).toBe(350);
    expect(normBearing(720)).toBe(0);
  });
});
