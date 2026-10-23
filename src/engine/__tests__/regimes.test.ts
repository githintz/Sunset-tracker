import { describe, expect, it } from 'vitest';
import { DAY_REGIMES, NIGHT_REGIMES, evaluateHour, blueHourVerdict, moonRayPoints, nightCloudBand, terrainStep, type HourCtx } from '../regimes';

const moon = (altitude: number, illumination: number) => ({ altitude, azimuth: 180, illumination, phase: 0.3, waxing: true });

function ctx(over: Partial<HourCtx> = {}): HourCtx {
  return {
    t: Date.UTC(2026, 5, 21, 12),
    sunAlt: 50,
    total: 40,
    low: 10,
    mid: 30,
    high: 20,
    precip: 0,
    showers: 0,
    cape: 50,
    li: 3,
    sunshineS: 2400,
    directWm2: 400,
    visKm: 30,
    dewPoint: 5,
    temp: 15,
    rh: 60,
    wind: 8,
    gusts: 15,
    snowM: 0,
    nextSunshineS: 2400,
    nextDirectWm2: 400,
    prevVisKm: [30, 30, 30],
    moon: moon(-10, 0.1),
    moonBrightness: 0,
    coreAltDeg: -10,
    aod: 0.1,
    aboveDeck: false,
    terrain: 'open',
    hoursSinceSunrise: 6,
    darkHoursAllClear: false,
    ...over,
  };
}
const day = (o: Partial<HourCtx>) => evaluateHour(ctx(o), DAY_REGIMES);
const night = (o: Partial<HourCtx>) => evaluateHour(ctx({ sunAlt: -25, ...o }), NIGHT_REGIMES);

describe('regime tables', () => {
  it('has ~10 day and ~12 night regimes; only 2 day and 1 night regime may produce Skip', () => {
    expect(DAY_REGIMES.length).toBeGreaterThanOrEqual(10);
    expect(NIGHT_REGIMES.length).toBe(12);
    expect(DAY_REGIMES.filter((r) => r.canSkip).map((r) => r.id)).toEqual(['steady-rain', 'clear-midday']);
    expect(NIGHT_REGIMES.filter((r) => r.canSkip).map((r) => r.id)).toEqual(['rain-night']);
  });
});

describe('day engine', () => {
  it('storm light: CAPE > 300, LI < 0, showers, direct sun', () => {
    const v = day({ cape: 900, li: -2, showers: 0.6, total: 70 });
    expect(v.regime).toBe('storm-light');
    expect(v.verdict).toBe(4);
  });
  it('storm light is refused without direct sun or under uniform rain', () => {
    const noSun = day({ cape: 900, li: -2, showers: 0.6, directWm2: 0, sunshineS: 0, nextDirectWm2: 0, nextSunshineS: 0, total: 90 });
    expect(noSun.regime).not.toBe('storm-light');
    expect(noSun.refused.some((r) => r.regime === 'storm-light' && /No direct sun/.test(r.reason))).toBe(true);
    const uniform = day({ cape: 900, li: -2, showers: 2, precip: 3, total: 100 });
    expect(uniform.refused.some((r) => /Uniform rain/.test(r.reason))).toBe(true);
    expect(uniform.regime).toBe('steady-rain');
    expect(uniform.verdict).toBe(0);
  });
  it('soft overcast is capped at Maybe', () => {
    const v = day({ total: 95, low: 90, mid: 50, high: 20, sunshineS: 0, directWm2: 20 });
    expect(v.regime).toBe('soft-overcast');
    expect(v.verdict).toBe(2);
  });
  it('clear midday is one step worse in the mountains', () => {
    expect(day({ total: 5, low: 0, mid: 0, high: 5 }).verdict).toBe(1);
    const m = day({ total: 5, low: 0, mid: 0, high: 5, terrain: 'mountain' });
    expect(m.regime).toBe('clear-midday');
    expect(m.verdict).toBe(0);
    expect(m.adjustments[0]).toMatch(/Mountains/);
  });
  it('clear with a low sun is better than clear midday', () => {
    expect(day({ total: 5, low: 0, mid: 0, high: 5, sunAlt: 12 }).regime).toBe('clear-low-sun');
  });
  it('inversion / sea of clouds when above the deck; refused under a lid', () => {
    expect(day({ aboveDeck: true, low: 95, total: 95, mid: 10, high: 10 }).regime).toBe('sea-of-clouds');
    expect(day({ aboveDeck: true, low: 95, total: 95, mid: 10, high: 10 }).verdict).toBe(4);
    const lid = day({ aboveDeck: true, low: 95, total: 100, mid: 95, high: 50 });
    expect(lid.regime).not.toBe('sea-of-clouds');
  });
  it('fog lifting in the morning', () => {
    const v = day({ prevVisKm: [0.3, 0.2, 0.2], visKm: 8, hoursSinceSunrise: 2, total: 40 });
    expect(v.regime).toBe('fog-lifting');
    expect(day({ prevVisKm: [0.3, 0.2, 0.2], visKm: 8, hoursSinceSunrise: 2, total: 98 }).regime).not.toBe('fog-lifting');
  });
  it('snow in the sun, broken sky, haze and the default', () => {
    expect(day({ snowM: 0.3, total: 20 }).regime).toBe('snow-sun');
    expect(day({ total: 50, mid: 50, high: 0, low: 0 }).regime).toBe('broken-sky');
    expect(day({ visKm: 4, total: 30, mid: 10, low: 10, high: 10, sunshineS: 500 }).regime).toBe('haze');
    expect(day({ total: 30, low: 10, mid: 10, high: 10, sunshineS: 600 }).regime).toBe('mixed-day');
  });
});

describe('night engine', () => {
  it('Milky Way needs darkness, a clear night, a dim moon and RH ≤ 90 %', () => {
    const v = night({ total: 5, darkHoursAllClear: true, rh: 70, coreAltDeg: 12 });
    expect(v.regime).toBe('milky-way');
    expect(v.verdict).toBe(4);
    expect(v.signals.join(' ')).toMatch(/galactic core 12° above/);
    expect(night({ total: 5, darkHoursAllClear: true, rh: 95 }).regime).not.toBe('milky-way');
    expect(night({ total: 5, darkHoursAllClear: true, moon: moon(40, 0.9), moonBrightness: 0.6 }).regime).not.toBe('milky-way');
    expect(night({ total: 5, darkHoursAllClear: true, moon: moon(5, 0.9) }).regime).toBe('milky-way');
    expect(night({ total: 5, darkHoursAllClear: true, coreAltDeg: -5 }).signals.join(' ')).toMatch(/below the horizon/);
  });
  it('cloud bands map to the ladder', () => {
    expect(nightCloudBand(10)).toBe('excellent');
    expect(nightCloudBand(25)).toBe('very good');
    expect(nightCloudBand(50)).toBe('fair');
    expect(nightCloudBand(75)).toBe('poor');
    expect(nightCloudBand(76)).toBe('unsuitable');
    expect(night({ total: 20 }).regime).toBe('star-trails');
    expect(night({ total: 45 }).verdict).toBe(2);
    expect(night({ total: 70 }).verdict).toBe(1);
    expect(night({ total: 95 }).regime).toBe('overcast-night');
    expect(night({ total: 95 }).verdict).toBe(1);
    expect(night({ total: null }).verdict).toBe(1);
  });
  it('only rain produces Skip at night', () => {
    expect(night({ total: 100, precip: 2 }).verdict).toBe(0);
    expect(night({ total: 100, precip: 2 }).regime).toBe('rain-night');
  });
  it('dew-point spread caps', () => {
    const worse = night({ total: 20, temp: 10, dewPoint: 8 });
    expect(worse.verdict).toBe(2);
    expect(worse.adjustments.join()).toMatch(/one step worse/);
    const capped = night({ total: 5, temp: 10, dewPoint: 9.5, darkHoursAllClear: true });
    expect(capped.verdict).toBe(1);
  });
  it('wind warns about long exposures', () => {
    expect(night({ total: 20, wind: 25 }).warnings[0]).toMatch(/long exposures/);
    expect(night({ total: 20, gusts: 40 }).warnings).toHaveLength(1);
  });
  it('moonlight rays: points system, never Go', () => {
    const c = ctx({ sunAlt: -25, moon: moon(30, 0.8), moonBrightness: 0.5, mid: 40, total: 60, rh: 80 });
    expect(moonRayPoints(c)).toBe(4);
    const v = evaluateHour(c, NIGHT_REGIMES);
    expect(v.regime).toBe('moonlight-rays');
    expect(v.verdict).toBe(3);
    expect(moonRayPoints(ctx({ moon: moon(30, 0.25), mid: 40, rh: 50, visKm: 50, aod: 0.02 }))).toBe(2);
    expect(evaluateHour(ctx({ sunAlt: -25, moon: moon(30, 0.25), mid: 40, total: 60, rh: 50, visKm: 50, aod: 0.02 }), NIGHT_REGIMES).verdict).toBe(2);
    expect(moonRayPoints(ctx({ moon: moon(-5, 0.9), mid: 10, rh: 40, visKm: 50, aod: 0.01 }))).toBe(0);
  });
  it('lightning, fog, moonlit snow and moonlit landscapes', () => {
    expect(night({ cape: 1500, li: -4, showers: 1, total: 80 }).regime).toBe('lightning');
    expect(night({ visKm: 0.3, rh: 99, total: 100 }).regime).toBe('fog-night');
    expect(night({ snowM: 0.2, moonBrightness: 0.5, moon: moon(30, 0.9), total: 15 }).regime).toBe('moonlit-snow');
    expect(night({ moonBrightness: 0.5, moon: moon(30, 0.9), total: 15, mid: 5 }).regime).toBe('moonlit-clear');
    expect(night({ total: 5, sunAlt: -14 }).regime).toBe('dark-clear');
    expect(night({ total: 5, sunAlt: -14 }).verdict).toBe(3);
  });
  it('terrain moves a verdict by at most one step', () => {
    expect(terrainStep('fog-night', 'valley').step).toBe(1);
    expect(terrainStep('storm-light', 'coast').step).toBe(1);
    expect(terrainStep('milky-way', 'mountain').step).toBe(1);
    expect(terrainStep('soft-overcast', 'open').step).toBe(0);
    expect(night({ visKm: 0.3, rh: 99, total: 100, terrain: 'valley' }).verdict).toBe(3);
  });
});

describe('blue hour', () => {
  it('open sky with thin high cloud is Go', () => {
    expect(blueHourVerdict({ low: 0, mid: 5, high: 30, visKm: 40, rh: 60, snowM: 0 }).verdict).toBe(4);
  });
  it('bands: open / broken / cloudy', () => {
    expect(blueHourVerdict({ low: 10, mid: 10, high: 0, visKm: 40, rh: 60, snowM: 0 }).label).toBe('open');
    expect(blueHourVerdict({ low: 30, mid: 10, high: 0, visKm: 40, rh: 60, snowM: 0 }).verdict).toBe(2);
    expect(blueHourVerdict({ low: 90, mid: 50, high: 0, visKm: 40, rh: 60, snowM: 0 }).label).toBe('cloudy');
    expect(blueHourVerdict({ low: 50, mid: 30, high: 0, visKm: 40, rh: 60, snowM: 0 }).label).toBe('mostly cloudy');
  });
  it('high cloud > 50 % caps at Maybe; fog/haze hold back; snow lifts', () => {
    expect(blueHourVerdict({ low: 0, mid: 0, high: 80, visKm: 40, rh: 60, snowM: 0 }).verdict).toBe(2);
    expect(blueHourVerdict({ low: 0, mid: 0, high: 0, visKm: 5, rh: 95, snowM: 0 }).verdict).toBe(2);
    expect(blueHourVerdict({ low: 0, mid: 0, high: 0, visKm: 15, rh: 60, snowM: 0 }).signals.join()).toMatch(/Haze/);
    expect(blueHourVerdict({ low: 30, mid: 10, high: 0, visKm: 40, rh: 60, snowM: 0.1 }).verdict).toBe(3);
    expect(blueHourVerdict({ low: null, mid: null, high: null, visKm: null, rh: null, snowM: null }).verdict).toBe(1);
  });
});
