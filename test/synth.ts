/**
 * Synthetic forecast builders for engine tests. Band covers are always derived from the pressure-level
 * covers (max over the levels inside each band), the way a consistent model would report them.
 */
import { PRESSURE_LEVELS, SAMPLE_POINTS } from '../src/engine/config';
import type { CorridorSeries, LevelSeries, Num, Observer, ObserverSeries, AirSeries, PointSeries } from '../src/engine/types';

/** Typical geopotential heights (km) of the requested pressure levels. */
export const STD_HEIGHT_KM: Record<number, number> = {
  1000: 0.11,
  950: 0.54,
  925: 0.76,
  900: 0.99,
  850: 1.46,
  800: 1.95,
  700: 3.01,
  600: 4.21,
  500: 5.57,
  400: 7.19,
  300: 9.16,
  250: 10.36,
  200: 11.78,
};

export interface Layer {
  fromKm: number;
  toKm: number;
  cover: number;
}

export interface PointSpec {
  layers?: Layer[];
  precipProb?: number;
  precip?: number;
  rh?: number;
  visibilityM?: number;
  groundM?: number;
}

export const ALL_DISTANCES = [...SAMPLE_POINTS.canvas, ...SAMPLE_POINTS.corridor, ...SAMPLE_POINTS.chartOnly].sort((a, b) => a - b);

export const T0 = Date.UTC(2026, 5, 21, 19, 30);
const HOUR = 3600000;

export function levelCover(layers: Layer[], zKm: number): number {
  return layers.reduce((m, l) => (zKm >= l.fromKm && zKm <= l.toKm ? Math.max(m, l.cover) : m), 0);
}

export function makePoint(d: number, spec: PointSpec, nTimes: number): PointSeries {
  const layers = spec.layers ?? [];
  const ground = (spec.groundM ?? 0) / 1000;
  const levels: LevelSeries[] = PRESSURE_LEVELS.map((hPa) => {
    const z = STD_HEIGHT_KM[hPa]!;
    return { hPa, cover: Array(nTimes).fill(levelCover(layers, z)), heightM: Array(nTimes).fill(z * 1000) };
  });
  const band = (lo: number, hi: number) =>
    PRESSURE_LEVELS.reduce((m, hPa) => {
      const agl = STD_HEIGHT_KM[hPa]! - ground;
      return agl >= lo && agl < hi ? Math.max(m, levelCover(layers, STD_HEIGHT_KM[hPa]!)) : m;
    }, 0);
  const low = band(-99, 3);
  const mid = band(3, 8);
  const high = band(8, 99);
  const total = Math.min(100, (1 - (1 - low / 100) * (1 - mid / 100) * (1 - high / 100)) * 100);
  const fill = (v: number) => Array(nTimes).fill(v) as Num[];
  return {
    distanceKm: d,
    role: (SAMPLE_POINTS.canvas as readonly number[]).includes(d) ? 'canvas' : (SAMPLE_POINTS.corridor as readonly number[]).includes(d) ? 'corridor' : 'chart',
    lat: 47,
    lon: 8 + d / 100,
    elevationM: spec.groundM ?? 0,
    cloudCover: fill(Math.max(total, low, mid, high)),
    low: fill(low),
    mid: fill(mid),
    high: fill(high),
    precip: fill(spec.precip ?? 0),
    precipProb: fill(spec.precipProb ?? 0),
    rh: fill(spec.rh ?? 70),
    visibilityM: fill(spec.visibilityM ?? 40000),
    levels,
  };
}

export function makeCorridor(specFor: (d: number) => PointSpec, opts: { model?: string; hasLevels?: boolean; t0?: number } = {}): CorridorSeries {
  const t0 = opts.t0 ?? T0;
  const times = [-2, -1, 0, 1, 2].map((h) => t0 + h * HOUR);
  return {
    model: opts.model ?? 'best_match',
    times,
    points: ALL_DISTANCES.map((d) => makePoint(d, specFor(d), times.length)),
    hasLevels: opts.hasLevels ?? true,
    fetchedAt: t0 - 3 * HOUR,
  };
}

export const uniform = (spec: PointSpec) => () => spec;

export function makeAir(aod: number | null = 0.15, t0 = T0): AirSeries {
  const times = [-2, -1, 0, 1, 2].map((h) => t0 + h * HOUR);
  return { times, aod: times.map(() => aod), dust: times.map(() => 5) };
}

export function makeObserverSeries(over: Partial<Record<keyof Omit<ObserverSeries, 'times'>, number | null>> = {}, times?: number[]): ObserverSeries {
  const ts = times ?? [-2, -1, 0, 1, 2].map((h) => T0 + h * HOUR);
  const f = (k: keyof Omit<ObserverSeries, 'times'>, d: number | null) => ts.map(() => (k in over ? over[k]! : d));
  return {
    times: ts,
    cloudCover: f('cloudCover', 40),
    low: f('low', 10),
    mid: f('mid', 30),
    high: f('high', 20),
    precip: f('precip', 0),
    showers: f('showers', 0),
    cape: f('cape', 50),
    liftedIndex: f('liftedIndex', 3),
    sunshineS: f('sunshineS', 2400),
    directRad: f('directRad', 300),
    visibilityM: f('visibilityM', 40000),
    dewPoint: f('dewPoint', 8),
    temp: f('temp', 16),
    rh: f('rh', 60),
    wind: f('wind', 8),
    gusts: f('gusts', 15),
    snowDepth: f('snowDepth', 0),
    weatherCode: f('weatherCode', 2),
  };
}

export const ZURICH: Observer = { lat: 47.3769, lon: 8.5417, elevationM: 408, elevationOverride: false, timezone: 'Europe/Zurich', name: 'Zurich' };

/** Hourly series covering [start, start + hours) with a spec per point and per hour. */
export function makeLongCorridor(
  start: number,
  hours: number,
  specFor: (d: number, t: number) => PointSpec,
  opts: { model?: string; hasLevels?: boolean } = {},
): CorridorSeries {
  const times = Array.from({ length: hours }, (_, i) => start + i * HOUR);
  const points = ALL_DISTANCES.map((d) => {
    const per = times.map((t) => makePoint(d, specFor(d, t), 1));
    const first = per[0]!;
    const cat = (k: 'cloudCover' | 'low' | 'mid' | 'high' | 'precip' | 'precipProb' | 'rh' | 'visibilityM') => per.map((p) => p[k][0] ?? null);
    return {
      ...first,
      cloudCover: cat('cloudCover'),
      low: cat('low'),
      mid: cat('mid'),
      high: cat('high'),
      precip: cat('precip'),
      precipProb: cat('precipProb'),
      rh: cat('rh'),
      visibilityM: cat('visibilityM'),
      levels: first.levels.map((l, li) => ({ hPa: l.hPa, cover: per.map((p) => p.levels[li]!.cover[0] ?? null), heightM: per.map((p) => p.levels[li]!.heightM[0] ?? null) })),
    };
  });
  return { model: opts.model ?? 'best_match', times, points, hasLevels: opts.hasLevels ?? true, fetchedAt: start };
}

export function makeLongObserver(start: number, hours: number, f: (t: number) => Partial<Record<keyof Omit<ObserverSeries, 'times'>, number | null>>): ObserverSeries {
  const times = Array.from({ length: hours }, (_, i) => start + i * HOUR);
  const rows = times.map((t) => makeObserverSeries(f(t), [t]));
  const keys = Object.keys(rows[0]!).filter((k) => k !== 'times') as Array<keyof Omit<ObserverSeries, 'times'>>;
  const out = { times } as ObserverSeries;
  for (const k of keys) out[k] = rows.map((r) => r[k][0] ?? null);
  return out;
}

export function makeLongAir(start: number, hours: number, aod: number | null = 0.12): AirSeries {
  const times = Array.from({ length: hours }, (_, i) => start + i * HOUR);
  return { times, aod: times.map(() => aod), dust: times.map(() => 3) };
}
