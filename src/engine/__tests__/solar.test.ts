import { describe, expect, it } from 'vitest';
import { findCrossings, galacticCoreAltitude, refractionDeg, sunEvents, sunPosition, altitudeTimeNear } from '../solar';
import { formatTime } from '../time';
import { moonRiseSet, moonState, moonBrightness, moonPhaseName } from '../moon';

/**
 * Reference: US Naval Observatory Astronomical Applications API (aa.usno.navy.mil/api/rstt/oneday, tz=0),
 * fetched 2026-10-23. USNO reports to the minute; requirement is agreement within 1 minute.
 */
interface Ref {
  name: string;
  lat: number;
  lon: number;
  date: string;
  rise?: string;
  set?: string;
  polar?: 'day' | 'night';
}
const REFS: Ref[] = [
  { name: 'Zurich solstice', lat: 47.3769, lon: 8.5417, date: '2026-06-21', rise: '03:29', set: '19:26' },
  { name: 'Zurich DST start', lat: 47.3769, lon: 8.5417, date: '2026-03-29', rise: '05:11', set: '17:51' },
  { name: 'Zurich DST end', lat: 47.3769, lon: 8.5417, date: '2026-10-25', rise: '05:59', set: '16:20' },
  { name: 'Chennai equinox', lat: 13.0827, lon: 80.2707, date: '2026-03-20', rise: '00:43', set: '12:50' },
  { name: 'Tokyo equinox', lat: 35.6762, lon: 139.6503, date: '2026-09-23', set: '08:38', rise: '20:31' },
  { name: 'Reykjavík midsummer', lat: 64.1466, lon: -21.9426, date: '2026-06-21', set: '00:04', rise: '02:55' },
  { name: 'Reykjavík midwinter', lat: 64.1466, lon: -21.9426, date: '2026-12-21', rise: '11:22', set: '15:29' },
  { name: 'Sydney DST end', lat: -33.8688, lon: 151.2093, date: '2026-04-05', set: '07:45', rise: '20:11' },
  { name: 'Quito', lat: -0.1807, lon: -78.4678, date: '2026-07-01', rise: '11:14', set: '23:21' },
  { name: 'New York DST start', lat: 40.7128, lon: -74.006, date: '2026-03-08', rise: '11:19', set: '22:55' },
  { name: 'New York DST end', lat: 40.7128, lon: -74.006, date: '2026-11-01', rise: '11:26', set: '21:52' },
  { name: 'Tromsø polar day', lat: 69.6492, lon: 18.9553, date: '2026-06-21', polar: 'day' },
  { name: 'Tromsø polar night', lat: 69.6492, lon: 18.9553, date: '2026-12-21', polar: 'night' },
];

const utc = (date: string, hm: string) => Date.parse(`${date}T${hm}:00Z`);

describe('sunrise/sunset vs USNO within 1 minute', () => {
  for (const r of REFS) {
    it(r.name, () => {
      const start = Date.parse(`${r.date}T00:00:00Z`);
      const evs = sunEvents(r.lat, r.lon, start, start + 86400000);
      if (r.polar) {
        expect(evs).toHaveLength(0);
        return;
      }
      for (const [kind, hm] of [
        ['sunrise', r.rise],
        ['sunset', r.set],
      ] as const) {
        if (!hm) continue;
        const ref = utc(r.date, hm);
        const ev = evs.find((e) => e.kind === kind && Math.abs(e.official - ref) < 3600000);
        expect(ev, `${kind} found`).toBeDefined();
        expect(Math.abs(ev!.official - ref)).toBeLessThanOrEqual(60000);
      }
    });
  }

  it('engine moment (centre on geometric horizon) is a few minutes inside official times', () => {
    const start = Date.parse('2026-06-21T00:00:00Z');
    const evs = sunEvents(47.3769, 8.5417, start, start + 86400000);
    const set = evs.find((e) => e.kind === 'sunset')!;
    const rise = evs.find((e) => e.kind === 'sunrise')!;
    expect(set.centre).toBeLessThan(set.official);
    expect(set.official - set.centre).toBeLessThan(10 * 60000);
    expect(rise.centre).toBeGreaterThan(rise.official);
    expect(set.azimuth).toBeGreaterThan(295);
    expect(set.azimuth).toBeLessThan(310);
  });
});

describe('local display across DST changes (spot zone, not device zone)', () => {
  const cases: Array<[string, number, number, string, string, string]> = [
    ['Europe/Zurich', 47.3769, 8.5417, '2026-03-29', '07:11', '19:51'],
    ['Europe/Zurich', 47.3769, 8.5417, '2026-10-25', '06:59', '17:20'],
    ['America/New_York', 40.7128, -74.006, '2026-03-08', '07:19', '18:55'],
    ['America/New_York', 40.7128, -74.006, '2026-11-01', '06:26', '16:52'],
  ];
  it.each(cases)('%s %s', (tz, lat, lon, date, rise, set) => {
    const start = Date.parse(`${date}T00:00:00Z`);
    const evs = sunEvents(lat, lon, start, start + 86400000);
    const near = (a: string, b: string) => {
      const m = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
      return Math.abs(m(a) - m(b)) <= 1;
    };
    expect(near(formatTime(evs.find((e) => e.kind === 'sunrise')!.official, tz), rise)).toBe(true);
    expect(near(formatTime(evs.find((e) => e.kind === 'sunset')!.official, tz), set)).toBe(true);
  });
});

describe('solar helpers', () => {
  it('sun is high at Quito noon and refraction is standard', () => {
    const p = sunPosition(Date.parse('2026-03-20T17:18:00Z'), -0.1807, -78.4678);
    expect(p.altitude).toBeGreaterThan(88);
    expect(refractionDeg(0)).toBeCloseTo(0.48, 1);
    expect(refractionDeg(89)).toBe(0);
    expect(refractionDeg(-2)).toBeLessThan(0.2);
    expect(refractionDeg(10)).toBeCloseTo(0.09, 1);
  });

  it('finds no crossings when the threshold is never reached', () => {
    const s = Date.parse('2026-06-21T00:00:00Z');
    expect(findCrossings(69.6492, 18.9553, s, s + 86400000, 0)).toHaveLength(0);
    expect(altitudeTimeNear(69.6492, 18.9553, s, -4, 'after', 6)).toBeNull();
  });

  it('galactic core peaks near 90 − lat − 29 at Zurich in June', () => {
    const s = Date.parse('2026-06-21T18:00:00Z');
    let max = -90;
    for (let i = 0; i < 12 * 12; i++) max = Math.max(max, galacticCoreAltitude(s + i * 300000, 47.3769, 8.5417));
    expect(max).toBeCloseTo(90 - 47.3769 - 29, 0);
  });
});

describe('moon vs USNO', () => {
  it('illuminated fraction and rise time at Zurich, 21 Jun 2026', () => {
    const m = moonState(Date.parse('2026-06-21T12:00:00Z'), 47.3769, 8.5417);
    expect(Math.abs(m.illumination - 0.45)).toBeLessThan(0.05);
    expect(m.waxing).toBe(true);
    const day = Date.parse('2026-06-20T22:00:00Z'); // local midnight CEST
    const rs = moonRiseSet(day, 47.3769, 8.5417, 120);
    expect(Math.abs(rs.rise! - Date.parse('2026-06-21T11:04:00Z'))).toBeLessThan(5 * 60000);
    expect(moonPhaseName(m.phase)).toMatch(/Waxing crescent|First quarter/);
  });
  it('brightness is zero below the horizon and grows with phase', () => {
    expect(moonBrightness({ altitude: -5, azimuth: 0, illumination: 1, phase: 0.5, waxing: false })).toBe(0);
    const a = moonBrightness({ altitude: 40, azimuth: 0, illumination: 0.3, phase: 0.2, waxing: true });
    const b = moonBrightness({ altitude: 40, azimuth: 0, illumination: 0.9, phase: 0.45, waxing: true });
    expect(b).toBeGreaterThan(a);
  });
  it('polar night moon is always up at Tromsø 21 Dec 2026', () => {
    const rs = moonRiseSet(Date.parse('2026-12-20T23:00:00Z'), 69.6492, 18.9553, 60);
    expect(rs.alwaysUp).toBe(true);
  });
});
