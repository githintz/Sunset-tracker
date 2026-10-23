/** Optical phenomena — offered only when terrain and conditions allow, each with what / when / likelihood. */
import { PHENOMENA } from './config';
import type { EventRating } from './event';
import type { HourCtx } from './regimes';
import type { TerrainInfo } from './terrain';
import type { Num } from './types';

export type PhenomenonId = 'rainbow' | 'alpenglow' | 'crepuscular' | 'valley-mist' | 'clarity';

export interface Phenomenon {
  id: PhenomenonId;
  name: string;
  what: string;
  start: number;
  end: number;
  likelihood: 'possible' | 'likely';
  why: string[];
}

const n = (x: Num, d = 0) => (x == null ? d : x);
const HOUR = 3600000;

function mergeHours(id: PhenomenonId, name: string, what: string, hits: Array<{ t: number; likely: boolean; why: string[] }>): Phenomenon[] {
  const out: Phenomenon[] = [];
  for (const h of hits.sort((a, b) => a.t - b.t)) {
    const last = out[out.length - 1];
    if (last && h.t - last.end <= HOUR / 2) {
      last.end = h.t + HOUR / 2;
      if (h.likely) last.likelihood = 'likely';
    } else {
      out.push({ id, name, what, start: h.t - HOUR / 2, end: h.t + HOUR / 2, likelihood: h.likely ? 'likely' : 'possible', why: h.why });
    }
  }
  return out;
}

/**
 * Rainbow: showers + direct sun, sun below 42°, rain on the anti-solar side.
 * `antiSolarRain(t)` returns the rain probability (%) on the side facing away from the sun, or null if unknown.
 */
export function rainbows(hours: HourCtx[], antiSolarRain: (t: number) => Num): Phenomenon[] {
  const hits = hours
    .filter((c) => c.sunAlt > 0 && c.sunAlt < PHENOMENA.rainbowMaxSunDeg)
    .filter((c) => n(c.showers) >= PHENOMENA.rainbowShowersMm && n(c.directWm2) >= PHENOMENA.rainbowDirectWm2)
    .map((c) => ({ c, anti: antiSolarRain(c.t) }))
    .filter(({ anti }) => anti != null && anti >= 40)
    .map(({ c, anti }) => ({
      t: c.t,
      likely: n(c.showers) >= 0.5 && anti! >= 60,
      why: [`Showers (${n(c.showers).toFixed(1)} mm) with direct sun`, `Sun at ${Math.round(c.sunAlt)}°`, `Rain likely opposite the sun (${Math.round(anti!)} %)`],
    }));
  return mergeHours('rainbow', 'Rainbow', 'Face away from the sun — look for the bow in the falling rain.', hits);
}

/** Alpenglow on mountain faces opposite the sun, sun between 0° and −4°, with an open corridor toward the sun. */
export function alpenglow(ev: EventRating, terrain: TerrainInfo, windowStart: number | null, windowEnd: number | null): Phenomenon | null {
  if (!ev.event || windowStart == null || windowEnd == null) return null;
  if (terrain.backAngleDeg == null || terrain.backReliefM == null) return null;
  if (terrain.backAngleDeg < PHENOMENA.alpenglowMinAngleDeg || terrain.backReliefM < PHENOMENA.alpenglowReliefM) return null;
  if (ev.event.reach < PHENOMENA.alpenglowReach) return null;
  return {
    id: 'alpenglow',
    name: 'Alpenglow',
    what: `Turn around after ${ev.kind === 'sunset' ? 'sunset' : 'before sunrise'}: the mountain faces opposite the sun can glow pink.`,
    start: Math.min(windowStart, windowEnd),
    end: Math.max(windowStart, windowEnd),
    likelihood: ev.event.reach >= 0.95 ? 'likely' : 'possible',
    why: [`Terrain rises ${Math.round(terrain.backReliefM)} m on the side facing away from the sun`, `Corridor toward the sun ${Math.round(ev.event.reach * 100)} % open`],
  };
}

/** Crepuscular rays: broken cloud toward the sun + something in the air. */
export function crepuscular(ev: EventRating, aod: Num, rh: Num): Phenomenon | null {
  const m = ev.event;
  if (!m) return null;
  const toward = m.points.filter((p) => p.distanceKm > 0 && p.distanceKm <= 50 && p.total != null);
  const broken = toward.some((p) => p.total! >= PHENOMENA.crepuscularBrokenLo && p.total! <= PHENOMENA.crepuscularBrokenHi);
  const air = (aod != null && aod >= 0.1 && aod <= 0.4) || n(rh) >= 70;
  if (!broken || !air) return null;
  const t = ev.official;
  return {
    id: 'crepuscular',
    name: 'Crepuscular rays',
    what: 'Beams of light and shadow fanning out from behind the clouds toward the sun.',
    start: t - 45 * 60000,
    end: t + 20 * 60000,
    likelihood: m.reach >= 0.5 ? 'likely' : 'possible',
    why: ['Broken cloud toward the sun', aod != null && aod >= 0.1 ? `Aerosol optical depth ${aod.toFixed(2)}` : 'Humid air to catch the beams'],
  };
}

/** Valley mist: valley terrain, clear sky, light wind, tiny dew-point spread, high humidity, overnight/morning. */
export function valleyMist(hours: HourCtx[], terrain: TerrainInfo): Phenomenon[] {
  if (terrain.kind !== 'valley') return [];
  const hits = hours
    .filter((c) => c.sunAlt < 10 && (c.hoursSinceSunrise == null || c.hoursSinceSunrise <= 3))
    .filter((c) => c.temp != null && c.dewPoint != null && c.total != null && c.wind != null && c.rh != null)
    .map((c) => ({ c, spread: c.temp! - c.dewPoint! }))
    .filter(({ c, spread }) => spread < PHENOMENA.mistDewSpread + 1 && c.total! <= PHENOMENA.mistMaxCloud && c.wind! <= PHENOMENA.mistWindKmh && c.rh! >= PHENOMENA.mistRh - 5)
    .map(({ c, spread }) => ({
      t: c.t,
      likely: spread < PHENOMENA.mistDewSpread && c.rh! >= PHENOMENA.mistRh,
      why: [`Dew-point spread ${spread.toFixed(1)} °C`, `Wind ${Math.round(c.wind!)} km/h`, `Cloud ${Math.round(c.total!)} %`],
    }));
  return mergeHours('valley-mist', 'Valley mist', 'Get above the valley floor at first light — mist may fill it.', hits);
}

/** Exceptional clarity: long visibility and very clean air (typically behind a cold front). */
export function clarity(hours: HourCtx[]): Phenomenon[] {
  const hits = hours
    .filter((c) => c.sunAlt > 0 && c.visKm != null && c.visKm >= PHENOMENA.clarityVisKm && c.aod != null && c.aod < PHENOMENA.clarityAod)
    .map((c) => ({ t: c.t, likely: true, why: [`Visibility ${Math.round(c.visKm!)} km`, `Aerosol optical depth ${c.aod!.toFixed(2)}`] }));
  return mergeHours('clarity', 'Exceptional clarity', 'Distant ranges will look close — a day for long lenses and panoramas.', hits);
}
