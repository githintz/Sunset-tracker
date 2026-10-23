/**
 * Vertical cloud columns at a sample point and time, and "how much cloud is at height z".
 * Interpolation never invents data: if either neighbouring hour is null the value is null.
 */
import { BANDS, OPACITY } from './config';
import type { Num, PointSeries } from './types';

/** Index i such that times[i] <= t <= times[i+1], or -1 if outside. */
export function bracket(times: number[], t: number): number {
  if (times.length === 0 || t < times[0]! || t > times[times.length - 1]!) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (times[m]! <= t) lo = m;
    else hi = m;
  }
  return lo;
}

/** Linear interpolation in time; null if t is outside the series or a neighbour is null. */
export function sampleAt(times: number[], values: Num[], t: number): Num {
  const i = bracket(times, t);
  if (i < 0) return null;
  const a = values[i];
  if (times.length === 1 || i === times.length - 1) return a ?? null;
  const b = values[i + 1];
  const ta = times[i]!;
  const tb = times[i + 1]!;
  if (t === ta) return a ?? null;
  if (t === tb) return b ?? null;
  if (a == null || b == null) return null;
  return a + ((b - a) * (t - ta)) / (tb - ta);
}

export type Band = 'low' | 'mid' | 'high';

export interface LevelSample {
  hPa: number;
  cover: Num;
  /** km above sea level */
  zKm: Num;
}

export interface Column {
  distanceKm: number;
  /** Ground elevation, km (0 if unknown). */
  groundKm: number;
  total: Num;
  low: Num;
  mid: Num;
  high: Num;
  precip: Num;
  precipProb: Num;
  rh: Num;
  visKm: Num;
  levels: LevelSample[];
  /** Model delivers level data and every level at this time is complete. */
  levelsComplete: boolean;
  /** Model delivers level data at all (otherwise band mode). */
  modelHasLevels: boolean;
}

export function columnAt(p: PointSeries, times: number[], t: number, modelHasLevels: boolean): Column {
  const s = (v: Num[]) => sampleAt(times, v, t);
  const levels: LevelSample[] = p.levels.map((l) => {
    const h = s(l.heightM);
    return { hPa: l.hPa, cover: s(l.cover), zKm: h == null ? null : h / 1000 };
  });
  const vis = s(p.visibilityM);
  return {
    distanceKm: p.distanceKm,
    groundKm: (p.elevationM ?? 0) / 1000,
    total: s(p.cloudCover),
    low: s(p.low),
    mid: s(p.mid),
    high: s(p.high),
    precip: s(p.precip),
    precipProb: s(p.precipProb),
    rh: s(p.rh),
    visKm: vis == null ? null : vis / 1000,
    levels,
    levelsComplete: modelHasLevels && levels.length > 0 && levels.every((l) => l.cover != null && l.zKm != null),
    modelHasLevels,
  };
}

export function bandOfHeight(col: Pick<Column, 'groundKm'>, zAbsKm: number): Band {
  const agl = zAbsKm - col.groundKm;
  if (agl < BANDS.lowTopKm) return 'low';
  if (agl < BANDS.midTopKm) return 'mid';
  return 'high';
}

export function bandCover(col: Column, band: Band): Num {
  return band === 'low' ? col.low : band === 'mid' ? col.mid : col.high;
}

/** Margin (km) within which band-only data cannot tell which side of a band boundary cloud sits. */
export const BAND_AMBIGUITY_KM = 1.6;

export interface CoverAtHeight {
  /** Cloud cover 0..100 at that height; null if unknown. */
  cover: Num;
  band: Band;
  /** True if the height was resolved from pressure levels with real geopotential heights. */
  resolved: boolean;
}

/**
 * Cloud cover at absolute height z.
 * - Resolved: linear interpolation in height between the two bracketing pressure levels.
 * - Band fallback: band cover; near a band boundary the larger of the two bands (we can't tell where in
 *   the band the cloud is, so assume the worse case for light getting through).
 */
export function coverAt(col: Column, zAbsKm: number): CoverAtHeight {
  const band = bandOfHeight(col, zAbsKm);
  if (col.levelsComplete) {
    const lv = col.levels
      .filter((l): l is { hPa: number; cover: number; zKm: number } => l.cover != null && l.zKm != null)
      .sort((a, b) => a.zKm - b.zKm);
    const first = lv[0];
    const last = lv[lv.length - 1];
    if (first && last) {
      if (zAbsKm <= first.zKm) return { cover: first.cover, band, resolved: true };
      if (zAbsKm <= last.zKm) {
        for (let i = 0; i < lv.length - 1; i++) {
          const a = lv[i]!;
          const b = lv[i + 1]!;
          if (zAbsKm >= a.zKm && zAbsKm <= b.zKm) {
            const f = b.zKm === a.zKm ? 0 : (zAbsKm - a.zKm) / (b.zKm - a.zKm);
            return { cover: a.cover + f * (b.cover - a.cover), band, resolved: true };
          }
        }
      }
      // above the highest level: fall through to the band value
    }
  }
  return { cover: bandFallbackCover(col, zAbsKm), band, resolved: false };
}

/**
 * Band cover at a height. For a model that publishes pressure levels but has a gap here, we can't tell where
 * in the band the cloud sits, so near a band boundary the worse of the two bands is used. A model that has no
 * level data at all is judged on the plain band containing the height.
 */
export function bandFallbackCover(col: Column, zAbsKm: number): Num {
  const agl = zAbsKm - col.groundKm;
  const bands: Band[] = [bandOfHeight(col, zAbsKm)];
  if (!col.modelHasLevels) return bandCover(col, bands[0]!);
  if (Math.abs(agl - BANDS.lowTopKm) < BAND_AMBIGUITY_KM) bands.push(agl < BANDS.lowTopKm ? 'mid' : 'low');
  if (Math.abs(agl - BANDS.midTopKm) < BAND_AMBIGUITY_KM) bands.push(agl < BANDS.midTopKm ? 'high' : 'mid');
  let worst = 0;
  for (const b of bands) {
    const c = bandCover(col, b);
    if (c == null) return null;
    worst = Math.max(worst, c);
  }
  return worst;
}

export function opacityOf(band: Band): number {
  return OPACITY[band];
}

/** Light-blocking fraction (0..1) at height z; unknown cloud is assumed fully cloudy (worst case). */
export function blockingAt(col: Column | null, zAbsKm: number): { blocking: number; known: boolean; resolved: boolean } {
  if (!col) return { blocking: opacityOf('low'), known: false, resolved: false };
  const c = coverAt(col, zAbsKm);
  const cover = c.cover == null ? 100 : Math.max(0, Math.min(100, c.cover));
  return { blocking: (cover / 100) * opacityOf(c.band), known: c.cover != null, resolved: c.resolved };
}

/** Is a column missing the band data needed to judge it? */
export function bandsMissing(col: Column): boolean {
  return col.low == null || col.mid == null || col.high == null;
}

/** Random-overlap combination of cover fractions (0..1). */
export function overlap(...fr: number[]): number {
  return 1 - fr.reduce((acc, f) => acc * (1 - Math.max(0, Math.min(1, f))), 1);
}
