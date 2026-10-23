/**
 * Daytime and night engines: words, not numbers. Each regime has deciding signals, refusing signals and a
 * verdict ceiling; output is on the same 5-step ladder as the sunset verdict. Skip is deliberately hard to
 * reach: only two day regimes (steady rain, clear midday in the mountains) and one night regime (rain) can
 * produce it.
 */
import { BLUE_HOUR, DAY, NIGHT } from './config';
import { overlap } from './column';
import type { MoonState } from './moon';
import type { TerrainClass } from './terrain';
import type { Num, Verdict } from './types';

export interface HourCtx {
  t: number;
  sunAlt: number;
  total: Num;
  low: Num;
  mid: Num;
  high: Num;
  precip: Num;
  showers: Num;
  cape: Num;
  li: Num;
  sunshineS: Num;
  directWm2: Num;
  visKm: Num;
  dewPoint: Num;
  temp: Num;
  rh: Num;
  wind: Num;
  gusts: Num;
  snowM: Num;
  nextSunshineS: Num;
  nextDirectWm2: Num;
  prevVisKm: Num[];
  moon: MoonState;
  moonBrightness: number;
  coreAltDeg: number;
  aod: Num;
  /** Observer above the low deck (from pressure levels). Null = unknown. */
  aboveDeck: boolean | null;
  terrain: TerrainClass;
  /** Hours since the latest sunrise (null if none in the last 24 h). */
  hoursSinceSunrise: number | null;
  /** Every astronomically dark hour of this night has ≤ 10 % cloud. */
  darkHoursAllClear: boolean;
}

export interface RegimeResult {
  verdict: Verdict;
  signals: string[];
}

export interface Regime {
  id: string;
  name: string;
  phase: 'day' | 'night';
  ceiling: Verdict;
  canSkip: boolean;
  /** Deciding signals: returns a result if the regime applies. */
  decide(c: HourCtx): RegimeResult | null;
  /** Refusing signal: a reason this regime must not be used even though it was decided. */
  refuse?(c: HourCtx): string | null;
}

const n = (x: Num, d = 0) => (x == null ? d : x);
const has = (x: Num) => x != null;
const directSun = (c: HourCtx) => n(c.directWm2) >= DAY.storm.directWm2 || n(c.sunshineS) >= DAY.storm.sunshineS;
const directSunSoon = (c: HourCtx) => directSun(c) || n(c.nextDirectWm2) >= DAY.storm.directWm2 || n(c.nextSunshineS) >= DAY.storm.sunshineS;
const pct = (x: Num) => `${Math.round(n(x))} %`;

// ------------------------------------------------------------------- day regimes

export const DAY_REGIMES: Regime[] = [
  {
    id: 'storm-light',
    name: 'Storm light',
    phase: 'day',
    ceiling: 4,
    canSkip: false,
    decide: (c) =>
      n(c.cape) > DAY.storm.cape && has(c.li) && c.li! < DAY.storm.liftedIndex && n(c.showers) > 0 && directSunSoon(c)
        ? { verdict: 4, signals: [`Unstable air (CAPE ${Math.round(n(c.cape))} J/kg, lifted index ${n(c.li).toFixed(1)})`, 'Showers around with sun breaking through'] }
        : null,
    refuse: (c) =>
      !directSunSoon(c)
        ? 'No direct sun this hour or next'
        : n(c.precip) >= DAY.storm.uniformRainMm && n(c.total) >= DAY.storm.uniformRainCloud
          ? 'Uniform rain under a closed sky'
          : null,
  },
  {
    id: 'sea-of-clouds',
    name: 'Inversion / sea of clouds',
    phase: 'day',
    ceiling: 4,
    canSkip: false,
    decide: (c) =>
      c.aboveDeck === true && n(c.low) >= DAY.inversionLowCover
        ? { verdict: n(c.mid) >= 50 ? 3 : 4, signals: ['You are above the low cloud deck', `Low cloud ${pct(c.low)} below the viewpoint`] }
        : null,
    refuse: (c) => (overlap(n(c.mid) / 100, n(c.high) / 100) >= 0.85 ? 'A closed deck above the viewpoint too' : null),
  },
  {
    id: 'fog-lifting',
    name: 'Fog lifting',
    phase: 'day',
    ceiling: 3,
    canSkip: false,
    decide: (c) => {
      const foggyBefore = c.prevVisKm.some((v) => v != null && v < 1);
      return c.hoursSinceSunrise != null && c.hoursSinceSunrise <= 4 && foggyBefore && n(c.visKm, 0) >= 2
        ? { verdict: 3, signals: ['Fog earlier this morning', 'Visibility is improving'] }
        : null;
    },
    refuse: (c) => (n(c.total) >= 95 ? 'The fog has lifted into a grey stratus lid' : null),
  },
  {
    id: 'steady-rain',
    name: 'Steady rain',
    phase: 'day',
    ceiling: 0,
    canSkip: true,
    decide: (c) =>
      n(c.precip) >= DAY.steadyRainMm && n(c.total) >= DAY.steadyRainCloud
        ? { verdict: 0, signals: [`${n(c.precip).toFixed(1)} mm/h of rain under ${pct(c.total)} cloud`] }
        : null,
  },
  {
    id: 'snow-sun',
    name: 'Fresh snow in the sun',
    phase: 'day',
    ceiling: 3,
    canSkip: false,
    decide: (c) =>
      n(c.snowM) >= DAY.snowDepthM && n(c.sunshineS) >= 1800 && n(c.total) < 60
        ? { verdict: 3, signals: [`${Math.round(n(c.snowM) * 100)} cm of snow on the ground`, 'Sunshine on it'] }
        : null,
  },
  {
    id: 'broken-sky',
    name: 'Broken, textured sky',
    phase: 'day',
    ceiling: 3,
    canSkip: false,
    decide: (c) => {
      const upper = overlap(n(c.mid) / 100, n(c.high) / 100) * 100;
      const textured = (upper >= 30 && upper <= 70) || (n(c.low) >= 25 && n(c.low) <= 60);
      return textured && n(c.sunshineS) >= 1200 ? { verdict: 3, signals: ['Broken cloud with sun between — light and shadow on the land'] } : null;
    },
  },
  {
    id: 'soft-overcast',
    name: 'Soft overcast',
    phase: 'day',
    ceiling: 2,
    canSkip: false,
    decide: (c) =>
      n(c.total) >= DAY.softOvercast && n(c.precip) < 0.2 && n(c.visKm, 99) >= 10
        ? { verdict: 2, signals: ['Even, shadowless light — good for forests, waterfalls and close-ups'] }
        : null,
  },
  {
    id: 'haze',
    name: 'Hazy and flat',
    phase: 'day',
    ceiling: 1,
    canSkip: false,
    decide: (c) => (has(c.visKm) && c.visKm! < DAY.hazeVisKm ? { verdict: 1, signals: [`Visibility only ${Math.round(c.visKm!)} km`] } : null),
  },
  {
    id: 'clear-low-sun',
    name: 'Clear, low sun',
    phase: 'day',
    ceiling: 2,
    canSkip: false,
    decide: (c) => (n(c.total, 100) < DAY.clearMidday && c.sunAlt < 20 ? { verdict: 2, signals: ['Clear sky with the sun still low — long shadows'] } : null),
  },
  {
    id: 'clear-midday',
    name: 'Clear midday',
    phase: 'day',
    ceiling: 1,
    canSkip: true,
    decide: (c) => (n(c.total, 100) < DAY.clearMidday ? { verdict: 1, signals: ['Cloudless sky with a high sun — hard light, flat colours'] } : null),
  },
  {
    id: 'mixed-day',
    name: 'Mixed sky',
    phase: 'day',
    ceiling: 2,
    canSkip: false,
    decide: () => ({ verdict: 2, signals: ['Nothing special forecast — look for local opportunities'] }),
  },
];

// ------------------------------------------------------------------- night regimes

export function moonRayPoints(c: HourCtx): number {
  const r = NIGHT.moonRays;
  let p = 0;
  if (c.moon.altitude > 0) {
    if (c.moon.illumination >= r.brightTwo) p += 2;
    else if (c.moon.illumination >= r.brightOne) p += 1;
  }
  if (n(c.mid) >= r.midCloud) p += 1;
  const air =
    (has(c.aod) && c.aod! >= r.aodLo && c.aod! <= r.aodHi) || n(c.rh) >= r.rh || (has(c.visKm) && c.visKm! >= r.visLoKm && c.visKm! <= r.visHiKm);
  if (air) p += 1;
  return p;
}

export function nightCloudBand(total: number): 'excellent' | 'very good' | 'fair' | 'poor' | 'unsuitable' {
  const b = NIGHT.cloudBands;
  if (total <= b[0]) return 'excellent';
  if (total <= b[1]) return 'very good';
  if (total <= b[2]) return 'fair';
  if (total <= b[3]) return 'poor';
  return 'unsuitable';
}

const moonDim = (c: HourCtx) => c.moon.altitude < NIGHT.milkyWay.moonMaxAltDeg || c.moon.illumination < NIGHT.milkyWay.moonMaxIllum;

export const NIGHT_REGIMES: Regime[] = [
  {
    id: 'rain-night',
    name: 'Rainy night',
    phase: 'night',
    ceiling: 0,
    canSkip: true,
    decide: (c) => (n(c.precip) >= 0.5 && n(c.total) >= 90 ? { verdict: 0, signals: [`${n(c.precip).toFixed(1)} mm/h of rain under a closed sky`] } : null),
  },
  {
    id: 'lightning',
    name: 'Night thunderstorms',
    phase: 'night',
    ceiling: 3,
    canSkip: false,
    decide: (c) =>
      n(c.cape) > 800 && has(c.li) && c.li! < -2 && n(c.showers) > 0
        ? { verdict: 3, signals: [`Very unstable air (CAPE ${Math.round(n(c.cape))} J/kg) — lightning possible`] }
        : null,
  },
  {
    id: 'fog-night',
    name: 'Fog night',
    phase: 'night',
    ceiling: 2,
    canSkip: false,
    decide: (c) => (has(c.visKm) && c.visKm! < 1 && n(c.rh) > 95 ? { verdict: 2, signals: ['Fog — lights will glow, stars hidden'] } : null),
  },
  {
    id: 'milky-way',
    name: 'Astronomical darkness / Milky Way',
    phase: 'night',
    ceiling: 4,
    canSkip: false,
    decide: (c) => {
      const m = NIGHT.milkyWay;
      if (c.sunAlt >= -18 || n(c.total, 100) > m.maxCloud || !c.darkHoursAllClear || !moonDim(c) || n(c.rh, 100) > m.maxRh) return null;
      const core = c.coreAltDeg > 0 ? `galactic core ${Math.round(c.coreAltDeg)}° above the horizon` : 'galactic core below the horizon';
      return { verdict: 4, signals: ['Sun below −18°, sky clear all night', moonDimText(c), core] };
    },
  },
  {
    id: 'moonlit-snow',
    name: 'Moonlit snow',
    phase: 'night',
    ceiling: 3,
    canSkip: false,
    decide: (c) =>
      n(c.snowM) >= 0.05 && c.moonBrightness >= 0.3 && n(c.total, 100) <= 25 ? { verdict: 3, signals: ['Snow cover lit by a bright moon'] } : null,
  },
  {
    id: 'moonlight-rays',
    name: 'Moonlight rays',
    phase: 'night',
    ceiling: 3,
    canSkip: false,
    decide: (c) => {
      if (!(c.moon.altitude > 0 && c.moon.illumination >= NIGHT.moonRays.brightOne && n(c.mid) >= NIGHT.moonRays.midCloud)) return null;
      const p = moonRayPoints(c);
      const v: Verdict = p >= 4 ? 3 : p >= 2 ? 2 : 1;
      return { verdict: v, signals: [`Moon ${Math.round(c.moon.illumination * 100)} % lit behind ${pct(c.mid)} mid-level cloud (${p}/4 points)`] };
    },
  },
  {
    id: 'dark-clear',
    name: 'Dark, clear night',
    phase: 'night',
    ceiling: 4,
    canSkip: false,
    decide: (c) =>
      n(c.total, 100) <= NIGHT.cloudBands[0] && moonDim(c)
        ? { verdict: c.sunAlt < -18 ? 4 : 3, signals: [`Cloud ${pct(c.total)} (excellent)`, moonDimText(c)] }
        : null,
  },
  {
    id: 'moonlit-clear',
    name: 'Moonlit landscape',
    phase: 'night',
    ceiling: 3,
    canSkip: false,
    decide: (c) =>
      n(c.total, 100) <= NIGHT.cloudBands[1] && c.moonBrightness >= 0.15
        ? { verdict: 3, signals: [`Cloud ${pct(c.total)}`, `Moon ${Math.round(c.moon.illumination * 100)} % lit lights the landscape`] }
        : null,
  },
  {
    id: 'star-trails',
    name: 'Stars and trails',
    phase: 'night',
    ceiling: 3,
    canSkip: false,
    decide: (c) => (n(c.total, 100) <= NIGHT.cloudBands[1] ? { verdict: 3, signals: [`Cloud ${pct(c.total)} (${nightCloudBand(n(c.total))})`] } : null),
  },
  {
    id: 'broken-night',
    name: 'Broken cloud',
    phase: 'night',
    ceiling: 2,
    canSkip: false,
    decide: (c) => (n(c.total, 100) <= NIGHT.cloudBands[2] ? { verdict: 2, signals: [`Cloud ${pct(c.total)} (fair) — gaps for stars`] } : null),
  },
  {
    id: 'poor-night',
    name: 'Mostly cloudy',
    phase: 'night',
    ceiling: 1,
    canSkip: false,
    decide: (c) => (n(c.total, 100) <= NIGHT.cloudBands[3] ? { verdict: 1, signals: [`Cloud ${pct(c.total)} (poor)`] } : null),
  },
  {
    id: 'overcast-night',
    name: 'Overcast night',
    phase: 'night',
    ceiling: 1,
    canSkip: false,
    decide: (c) => ({ verdict: 1, signals: [c.total == null ? 'No cloud data — assume the worst' : `Cloud ${pct(c.total)} (unsuitable)`] }),
  },
];

function moonDimText(c: HourCtx): string {
  if (c.moon.altitude < 0) return 'Moon below the horizon';
  if (c.moon.altitude < NIGHT.milkyWay.moonMaxAltDeg) return `Moon low (${Math.round(c.moon.altitude)}°)`;
  return `Moon only ${Math.round(c.moon.illumination * 100)} % lit`;
}

// ------------------------------------------------------------------- evaluation

export interface HourVerdict {
  t: number;
  regime: string;
  name: string;
  verdict: Verdict;
  signals: string[];
  refused: Array<{ regime: string; reason: string }>;
  warnings: string[];
  adjustments: string[];
}

const clampV = (v: number) => Math.max(0, Math.min(4, v)) as Verdict;

/** Terrain may move a day/night verdict by at most one step (never the sunset score). */
export function terrainStep(regime: string, terrain: TerrainClass): { step: number; note: string | null } {
  if (terrain === 'mountain') {
    if (regime === 'clear-midday') return { step: -1, note: 'Mountains: hard midday light flattens relief even more' };
    if (regime === 'sea-of-clouds' || regime === 'fog-lifting') return { step: 1, note: 'Mountains: high viewpoints make the most of low cloud' };
    if (regime === 'milky-way' || regime === 'dark-clear') return { step: 1, note: 'Mountains: little light pollution and clean air' };
  }
  if (terrain === 'valley' && regime === 'fog-night') return { step: 1, note: 'Valley: fog pools make good subjects' };
  if (terrain === 'coast' && (regime === 'storm-light' || regime === 'broken-sky')) return { step: 1, note: 'Coast: open horizon for passing showers' };
  return { step: 0, note: null };
}

export function evaluateHour(c: HourCtx, table: Regime[]): HourVerdict {
  const refused: HourVerdict['refused'] = [];
  for (const r of table) {
    const res = r.decide(c);
    if (!res) continue;
    const why = r.refuse?.(c) ?? null;
    if (why) {
      refused.push({ regime: r.id, reason: why });
      continue;
    }
    let v = Math.min(res.verdict, r.ceiling);
    const adjustments: string[] = [];
    const ts = terrainStep(r.id, c.terrain);
    if (ts.step !== 0) {
      const before = v;
      v = clampV(v + Math.sign(ts.step));
      if (v !== before && ts.note) adjustments.push(ts.note);
    }
    const warnings: string[] = [];
    if (r.phase === 'night') {
      if (has(c.temp) && has(c.dewPoint)) {
        const spread = c.temp! - c.dewPoint!;
        if (spread < NIGHT.dewSpreadCap) {
          if (v > 1) adjustments.push(`Dew/frost almost certain (spread ${spread.toFixed(1)} °C) — capped`);
          v = Math.min(v, 1);
        } else if (spread < NIGHT.dewSpreadWorse) {
          v = clampV(v - 1);
          adjustments.push(`Dew risk (spread ${spread.toFixed(1)} °C) — one step worse`);
        }
      }
      if (n(c.wind) > NIGHT.windWarnKmh || n(c.gusts) > NIGHT.gustWarnKmh)
        warnings.push(`Wind ${Math.round(n(c.wind))} km/h, gusts ${Math.round(n(c.gusts))} km/h — long exposures will suffer`);
    }
    // Skip is reserved for the regimes allowed to produce it.
    if (v === 0 && !r.canSkip) v = 1;
    return { t: c.t, regime: r.id, name: r.name, verdict: v as Verdict, signals: res.signals, refused, warnings, adjustments };
  }
  /* c8 ignore next */
  return { t: c.t, regime: 'none', name: 'Unknown', verdict: 2, signals: [], refused, warnings: [], adjustments: [] };
}

// ------------------------------------------------------------------- blue hour

export interface BlueHourResult {
  verdict: Verdict;
  label: 'open' | 'broken' | 'mostly cloudy' | 'cloudy';
  opaque: number | null;
  signals: string[];
}

export function blueHourVerdict(c: Pick<HourCtx, 'low' | 'mid' | 'high' | 'visKm' | 'rh' | 'snowM'>): BlueHourResult {
  const signals: string[] = [];
  if (c.low == null || c.mid == null) return { verdict: 1, label: 'cloudy', opaque: null, signals: ['No cloud data — assume the worst'] };
  const opaque = overlap(c.low / 100, c.mid / 100) * 100;
  const high = n(c.high);
  const b = BLUE_HOUR;
  let label: BlueHourResult['label'];
  let v: number;
  if (opaque <= b.open) {
    label = 'open';
    v = 3;
  } else if (opaque <= b.broken) {
    label = 'broken';
    v = 2;
  } else if (opaque <= b.cloudy) {
    label = 'mostly cloudy';
    v = 1;
  } else {
    label = 'cloudy';
    v = 1;
  }
  signals.push(`Opaque low+mid cloud ${Math.round(opaque)} % (${label})`);
  if (opaque <= b.goOpaqueMax && high >= b.goHighMin && high <= b.goHighMax) {
    v = 4;
    signals.push(`Thin high cloud (${Math.round(high)} %) to hold the last colour`);
  }
  if (high > b.highCap) {
    v = Math.min(v, 2);
    signals.push(`High cloud ${Math.round(high)} % dims the blue — capped at Maybe`);
  }
  const fog = c.visKm != null && c.visKm < b.fogVisKm && n(c.rh) > b.fogRh;
  const haze = c.visKm != null && c.visKm < b.hazeVisKm;
  if (fog) {
    v -= 1;
    signals.push('Fog risk holds it back');
  } else if (haze) {
    v -= 1;
    signals.push('Haze holds it back');
  }
  if (n(c.snowM) >= b.snowLiftM) {
    v += 1;
    signals.push('Snow on the ground reflects the blue light');
  }
  return { verdict: Math.max(1, Math.min(4, v)) as Verdict, label, opaque, signals };
}
