/** Orchestrates all engines for one location into a single, versioned forecast result. Pure function. */
import { ENGINE_VERSION, PHASES } from './config';
import { columnAt, sampleAt, bracket } from './column';
import { rateEvent, type EventRating } from './event';
import { galacticCoreAltitude, sunAltitude, sunEvents, altitudeTimeNear, type SunEvent } from './solar';
import { moonBrightness, moonRiseSet, moonState, type MoonRiseSet } from './moon';
import { phaseSegments, photographersDayEnd, type PhaseSegment } from './phases';
import { blueHourVerdict, DAY_REGIMES, evaluateHour, NIGHT_REGIMES, type BlueHourResult, type HourCtx, type HourVerdict } from './regimes';
import { alpenglow, clarity, crepuscular, rainbows, valleyMist, type Phenomenon } from './phenomena';
import { classifyTerrain, type TerrainInfo } from './terrain';
import { lowDeck } from './sunset';
import { addLocalDays, localDayKey, startOfLocalDay, tzOffsetMinutes } from './time';
import type { AirSeries, CorridorSeries, Num, Observer, ObserverSeries, TerrainProfile, Verdict } from './types';

export interface BearingData {
  bearing: number;
  A: CorridorSeries | null;
  B: CorridorSeries | null;
  profile: TerrainProfile | null;
}

export interface ForecastInputs {
  observer: Observer;
  now: number;
  sunset: BearingData | null;
  sunrise: BearingData | null;
  air: AirSeries | null;
  obs: ObserverSeries | null;
  /** When the model data was fetched (ms). */
  fetchedAt: number;
  /** Data came from cache after a failed refresh. */
  staleRun?: boolean;
}

export interface RegimeWindow {
  regime: string;
  name: string;
  verdict: Verdict;
  start: number;
  end: number;
  signals: string[];
  warnings: string[];
  adjustments: string[];
  refused: Array<{ regime: string; reason: string }>;
  flags: string[];
}

export interface BlueWindow {
  start: number;
  end: number;
  evening: boolean;
  result: BlueHourResult;
}

export interface DayPlan {
  dayKey: string;
  dayStart: number;
  sunrise: EventRating | null;
  sunset: EventRating | null;
  daytime: RegimeWindow[];
  night: RegimeWindow[];
  blue: BlueWindow[];
  phases: PhaseSegment[];
  tempMin: Num;
  tempMax: Num;
  polar: 'day' | 'night' | null;
  moon: MoonRiseSet;
}

export interface LocationForecast {
  engineVersion: string;
  computedAt: number;
  fetchedAt: number;
  observer: Observer;
  events: EventRating[];
  nextEvent: EventRating | null;
  days: DayPlan[];
  photographersDay: { start: number; end: number; phases: PhaseSegment[]; daytime: RegimeWindow[]; night: RegimeWindow[]; blue: BlueWindow[] };
  phenomena: Phenomenon[];
  terrain: { sunset: TerrainInfo | null; sunrise: TerrainInfo | null };
  hours: HourCtx[];
  flags: string[];
}

const HOUR = 3600000;

function corridorFor(inp: ForecastInputs, kind: 'sunset' | 'sunrise'): BearingData | null {
  return kind === 'sunset' ? inp.sunset : inp.sunrise;
}

export function buildHourContexts(inp: ForecastInputs, events: SunEvent[], terrainKind: TerrainInfo['kind']): HourCtx[] {
  const o = inp.obs;
  if (!o) return [];
  const { lat, lon } = inp.observer;
  const obsKm = inp.observer.elevationM / 1000;
  const s = (v: Num[], t: number) => sampleAt(o.times, v, t);
  const hours: HourCtx[] = o.times.map((t, i) => {
    const moon = moonState(t, lat, lon);
    const vis = o.visibilityM[i] ?? null;
    const nextT = o.times[i + 1];
    const deckCorr = [inp.sunset?.A, inp.sunrise?.A].find((c) => c && bracket(c.times, t) >= 0) ?? null;
    let aboveDeck: boolean | null = null;
    if (deckCorr) {
      const p0 = deckCorr.points.find((p) => p.distanceKm === 0);
      if (p0) aboveDeck = lowDeck(columnAt(p0, deckCorr.times, t, deckCorr.hasLevels), obsKm).observerAbove;
    }
    const lastRise = [...events].reverse().find((e) => e.kind === 'sunrise' && e.official <= t && t - e.official < 24 * HOUR);
    return {
      t,
      sunAlt: sunAltitude(t, lat, lon),
      total: o.cloudCover[i] ?? null,
      low: o.low[i] ?? null,
      mid: o.mid[i] ?? null,
      high: o.high[i] ?? null,
      precip: o.precip[i] ?? null,
      showers: o.showers[i] ?? null,
      cape: o.cape[i] ?? null,
      li: o.liftedIndex[i] ?? null,
      sunshineS: o.sunshineS[i] ?? null,
      directWm2: o.directRad[i] ?? null,
      visKm: vis == null ? null : vis / 1000,
      dewPoint: o.dewPoint[i] ?? null,
      temp: o.temp[i] ?? null,
      rh: o.rh[i] ?? null,
      wind: o.wind[i] ?? null,
      gusts: o.gusts[i] ?? null,
      snowM: o.snowDepth[i] ?? null,
      nextSunshineS: nextT == null ? null : s(o.sunshineS, nextT),
      nextDirectWm2: nextT == null ? null : s(o.directRad, nextT),
      prevVisKm: [1, 2, 3].map((k) => {
        const v = o.visibilityM[i - k];
        return v == null ? null : v / 1000;
      }),
      moon,
      moonBrightness: moonBrightness(moon),
      coreAltDeg: galacticCoreAltitude(t, lat, lon),
      aod: inp.air ? sampleAt(inp.air.times, inp.air.aod, t) : null,
      aboveDeck,
      terrain: terrainKind,
      hoursSinceSunrise: lastRise ? (t - lastRise.official) / HOUR : null,
      darkHoursAllClear: false,
    };
  });
  // Every astronomically dark hour of the same night must be ≤ 10 % cloud for the Milky Way regime.
  let i = 0;
  while (i < hours.length) {
    if (hours[i]!.sunAlt >= PHASES.astroDark) {
      i++;
      continue;
    }
    let j = i;
    while (j < hours.length && hours[j]!.sunAlt < PHASES.astroDark) j++;
    const allClear = hours.slice(i, j).every((h) => h.total != null && h.total <= 10);
    for (let k = i; k < j; k++) hours[k]!.darkHoursAllClear = allClear;
    i = j;
  }
  return hours;
}

function windowsFor(hours: HourCtx[], seg: { start: number; end: number }, phase: 'day' | 'night'): RegimeWindow[] {
  const inSeg = hours.filter((h) => h.t >= seg.start - HOUR / 2 && h.t < seg.end + HOUR / 2);
  const table = phase === 'day' ? DAY_REGIMES : NIGHT_REGIMES;
  const hv: HourVerdict[] = inSeg
    .filter((h) => (phase === 'day' ? h.sunAlt > PHASES.daytimeAbove : h.sunAlt < PHASES.blueBottom))
    .map((h) => evaluateHour(h, table));
  const out: RegimeWindow[] = [];
  for (const v of hv) {
    const last = out[out.length - 1];
    const start = Math.max(seg.start, v.t - HOUR / 2);
    const end = Math.min(seg.end, v.t + HOUR / 2);
    if (last && last.regime === v.regime && last.verdict === v.verdict && start - last.end <= 1000) {
      last.end = end;
      for (const w of v.warnings) if (!last.warnings.includes(w)) last.warnings.push(w);
    } else {
      out.push({
        regime: v.regime,
        name: v.name,
        verdict: v.verdict,
        start,
        end,
        signals: v.signals,
        warnings: [...v.warnings],
        adjustments: v.adjustments,
        refused: v.refused,
        flags: [],
      });
    }
  }
  const natural = seg.end - seg.start;
  for (const w of out) if (out.length > 1 && w.end - w.start < natural - HOUR) w.flags.push('shortened window');
  return out;
}

function blueWindows(hours: HourCtx[], segs: PhaseSegment[]): BlueWindow[] {
  return segs
    .filter((s) => s.kind === 'blue')
    .map((s) => {
      const mid = (s.start + s.end) / 2;
      const h = hours.reduce<HourCtx | null>((best, x) => (!best || Math.abs(x.t - mid) < Math.abs(best.t - mid) ? x : best), null);
      const result = h && Math.abs(h.t - mid) <= HOUR ? blueHourVerdict(h) : blueHourVerdict({ low: null, mid: null, high: null, visKm: null, rh: null, snowM: null });
      return { start: s.start, end: s.end, evening: !!s.evening, result };
    });
}

export function bestWindow(ws: RegimeWindow[]): RegimeWindow | null {
  return ws.reduce<RegimeWindow | null>((b, w) => (!b || w.verdict > b.verdict || (w.verdict === b.verdict && w.end - w.start > b.end - b.start) ? w : b), null);
}

export function computeForecast(inp: ForecastInputs): LocationForecast {
  const { observer, now } = inp;
  const { lat, lon, timezone: tz } = observer;
  const today = startOfLocalDay(now, tz);
  const rangeEnd = addLocalDays(today, 3, tz);
  const allEvents = sunEvents(lat, lon, today - 6 * HOUR, rangeEnd + 6 * HOUR);
  const events = allEvents.filter((e) => e.official >= today && e.official < rangeEnd);

  const terrainSunset = inp.sunset ? classifyTerrain(observer.elevationM, inp.sunset.profile) : null;
  const terrainSunrise = inp.sunrise ? classifyTerrain(observer.elevationM, inp.sunrise.profile) : null;
  const terrainKind = (terrainSunset ?? terrainSunrise)?.kind ?? (observer.elevationM >= 1500 ? 'mountain' : 'open');

  const ratings: EventRating[] = events.map((e) => {
    const bd = corridorFor(inp, e.kind);
    return rateEvent({ observer, event: e, corridorA: bd?.A ?? null, corridorB: bd?.B ?? null, air: inp.air, obs: inp.obs });
  });
  const nextEvent = ratings.find((r) => r.official >= now - 10 * 60000) ?? null;

  const hours = buildHourContexts(inp, allEvents, terrainKind);

  // three local days
  const days: DayPlan[] = [];
  for (let k = 0; k < 3; k++) {
    const ds = addLocalDays(today, k, tz);
    const de = addLocalDays(today, k + 1, tz);
    const phases = phaseSegments(lat, lon, ds, de);
    const dayHours = hours.filter((h) => h.t >= ds && h.t < de);
    const temps = dayHours.map((h) => h.temp).filter((x): x is number => x != null);
    const daytime = phases.filter((p) => p.kind === 'day').flatMap((p) => windowsFor(hours, p, 'day'));
    // the night that follows this day: from this day's evening to the next morning
    const nightSegs = phaseSegments(lat, lon, ds + 12 * HOUR, de + 12 * HOUR).filter((p) => p.kind === 'night' || p.kind === 'astro');
    const nightSpan = nightSegs.length ? { start: nightSegs[0]!.start, end: nightSegs[nightSegs.length - 1]!.end } : null;
    const night = nightSpan ? windowsFor(hours, nightSpan, 'night') : [];
    const maxAlt = Math.max(...Array.from({ length: 49 }, (_, i) => sunAltitude(ds + i * 1800000, lat, lon)));
    const minAlt = Math.min(...Array.from({ length: 49 }, (_, i) => sunAltitude(ds + i * 1800000, lat, lon)));
    days.push({
      dayKey: localDayKey(ds + HOUR, tz),
      dayStart: ds,
      sunrise: ratings.find((r) => r.kind === 'sunrise' && r.official >= ds && r.official < de) ?? null,
      sunset: ratings.find((r) => r.kind === 'sunset' && r.official >= ds && r.official < de) ?? null,
      daytime,
      night,
      blue: blueWindows(hours, phases),
      phases,
      tempMin: temps.length ? Math.min(...temps) : null,
      tempMax: temps.length ? Math.max(...temps) : null,
      polar: minAlt > PHASES.officialHorizon ? 'day' : maxAlt < PHASES.officialHorizon ? 'night' : null,
      moon: moonRiseSet(ds, lat, lon, tzOffsetMinutes(ds + 12 * HOUR, tz)),
    });
  }

  // photographer's day: now → end of next morning blue hour
  const pdEnd = photographersDayEnd(lat, lon, now);
  const pdPhases = phaseSegments(lat, lon, now, pdEnd);
  const pdDay = pdPhases.filter((p) => p.kind === 'day').flatMap((p) => windowsFor(hours, p, 'day'));
  const pdNightSegs = pdPhases.filter((p) => p.kind === 'night' || p.kind === 'astro');
  const pdNight = pdNightSegs.length
    ? windowsFor(hours, { start: pdNightSegs[0]!.start, end: pdNightSegs[pdNightSegs.length - 1]!.end }, 'night')
    : [];

  // phenomena
  const phenomena: Phenomenon[] = [];
  const dayHours = hours.filter((h) => h.t >= now - HOUR && h.t < rangeEnd);
  const antiSolarRain = (t: number): Num => {
    // Morning sun is on the sunrise side, so the anti-solar side is along the sunset bearing, and vice versa.
    const morning = sunAltitude(t + HOUR, lat, lon) > sunAltitude(t, lat, lon);
    const bd = morning ? inp.sunset : inp.sunrise;
    const c = bd?.A;
    if (!c) return null;
    const p = c.points.find((x) => x.distanceKm === 5);
    return p ? sampleAt(c.times, p.precipProb, t) : null;
  };
  phenomena.push(...rainbows(dayHours, antiSolarRain));
  for (const r of ratings.filter((x) => x.official >= now - HOUR)) {
    const ter = r.kind === 'sunset' ? terrainSunset : terrainSunrise;
    if (ter) {
      const a = altitudeTimeNear(lat, lon, r.centre, -4, r.kind === 'sunset' ? 'after' : 'before', 3);
      const ag = alpenglow(r, ter, r.centre, a);
      if (ag) phenomena.push(ag);
    }
    const aod = inp.air ? sampleAt(inp.air.times, inp.air.aod, r.centre) : null;
    const rh = inp.obs ? sampleAt(inp.obs.times, inp.obs.rh, r.centre) : null;
    const cr = crepuscular(r, aod, rh);
    if (cr) phenomena.push(cr);
  }
  if (terrainSunset) phenomena.push(...valleyMist(dayHours, terrainSunset));
  phenomena.push(...clarity(dayHours));
  phenomena.sort((a, b) => a.start - b.start);

  const flags: string[] = [];
  if (inp.staleRun || now - inp.fetchedAt > 6 * HOUR) flags.push('stale run');
  if (!inp.sunset?.B && !inp.sunrise?.B) flags.push('only one forecast available');

  return {
    engineVersion: ENGINE_VERSION,
    computedAt: now,
    fetchedAt: inp.fetchedAt,
    observer,
    events: ratings,
    nextEvent,
    days,
    photographersDay: { start: now, end: pdEnd, phases: pdPhases, daytime: pdDay, night: pdNight, blue: blueWindows(hours, pdPhases) },
    phenomena,
    terrain: { sunset: terrainSunset, sunrise: terrainSunrise },
    hours,
    flags,
  };
}
