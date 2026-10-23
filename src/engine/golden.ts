/**
 * Golden-hour rating: will direct, warm light reach the observer and the foreground?
 * Near field only (0–30 km toward the sun + the observer's own column); the far corridor is ignored.
 */
import { EARTH_RADIUS_KM, GOLDEN, SAMPLE_POINTS } from './config';
import { blockingAt, columnAt, sampleAt, type Column } from './column';
import { DEG } from './geo';
import { altitudeTimeNear } from './solar';
import { rainMultiplier } from './sunset';
import type { CorridorSeries, ObserverSeries } from './types';

export type GoldenLabel = 'warm direct light' | 'patchy direct light' | 'diffused muted light' | 'no golden hour' | 'no data';

export interface GoldenRating {
  /** 0..5, or null when there is no golden hour (polar day/night). */
  score: number | null;
  label: GoldenLabel;
  /** Share of sampled sun elevations with direct light (0..1). */
  directShare: number | null;
  /** Start and end of the golden-hour window (sun between +6° and −4°). */
  start: number | null;
  end: number | null;
  /** Unknown columns along the sight line (treated as blocking). */
  missing: boolean;
}

export interface GoldenInputs {
  lat: number;
  lon: number;
  observerElevKm: number;
  kind: 'sunrise' | 'sunset';
  /** Official event time. */
  eventMs: number;
  corridor: CorridorSeries | null;
  observer: ObserverSeries | null;
  /** Air modifier of the same event (warmth). */
  air: number;
}

const NEAR = SAMPLE_POINTS.canvas.filter((d) => d > 0 && d <= GOLDEN.maxDistanceKm);

export function goldenHour(g: GoldenInputs): GoldenRating {
  const dir = g.kind === 'sunset' ? 'before' : 'after';
  const away = g.kind === 'sunset' ? 'after' : 'before';
  const topT = altitudeTimeNear(g.lat, g.lon, g.eventMs, GOLDEN.topDeg, dir, 8);
  const bottomT = altitudeTimeNear(g.lat, g.lon, g.eventMs, GOLDEN.bottomDeg, away, 8);
  const [start, end] = g.kind === 'sunset' ? [topT, bottomT] : [bottomT, topT];

  const samples: number[] = [];
  let missing = false;
  for (const e of GOLDEN.sampleElevations) {
    const t = altitudeTimeNear(g.lat, g.lon, g.eventMs, e, dir, 8);
    if (t == null) continue;
    let transmission = 1;
    for (const d of NEAR) {
      const p = g.corridor?.points.find((x) => x.distanceKm === d);
      const col: Column | null = p && g.corridor ? columnAt(p, g.corridor.times, t, g.corridor.hasLevels) : null;
      const z = g.observerElevKm + d * Math.tan(e * DEG) + (d * d) / (2 * EARTH_RADIUS_KM);
      const b = blockingAt(col, z);
      if (!b.known) missing = true;
      transmission *= 1 - b.blocking;
    }
    // fog at the viewpoint kills direct light too
    const vis = g.observer ? sampleAt(g.observer.times, g.observer.visibilityM, t) : null;
    if (vis == null) missing = true;
    else if (vis < 1000) transmission = 0;
    samples.push(transmission);
  }

  if (samples.length === 0) {
    return { score: null, label: 'no golden hour', directShare: null, start, end, missing };
  }
  if (!g.corridor && !g.observer) return { score: null, label: 'no data', directShare: null, start, end, missing: true };
  const directShare = samples.reduce((a, b) => a + b, 0) / samples.length;
  // probability term off (0 %); precipitation amount at the viewpoint drives the penalty, unknown → worst
  const mm = g.observer ? sampleAt(g.observer.times, g.observer.precip, g.eventMs) : null;
  if (mm == null) missing = true;
  const rain = rainMultiplier(0, mm);
  const score = Math.max(0, Math.min(5, 5 * (0.1 + 0.9 * directShare) * g.air * rain));
  const label: GoldenLabel =
    directShare >= GOLDEN.warmDirect ? 'warm direct light' : directShare >= GOLDEN.patchy ? 'patchy direct light' : 'diffused muted light';
  return { score, label, directShare, start, end, missing };
}
