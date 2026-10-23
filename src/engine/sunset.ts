/**
 * Sunset / sunrise quality engine.
 *   raw = 5 × canvas × reach × lit × air × rain   (clamped to 0..5)
 * Missing data is never treated as clear sky: every unknown takes the worst case for its factor.
 */
import {
  AIR,
  CANVAS,
  CANVAS_WEIGHTS,
  EARTH_RADIUS_KM,
  LIT,
  OVERCAST_OPAQUE,
  RAIN,
  REACH,
  SAMPLE_POINTS,
} from './config';
import { blockingAt, bandsMissing, columnAt, overlap, sampleAt, type Column } from './column';
import { lightPathAltitudeKm, rayAltitudeKm, shadowAngleDeg } from './geo';
import type { AirSeries, CorridorSeries, Num } from './types';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;

// ---------------------------------------------------------------- canvas

/** Value of the mid+high canvas for combined cover u (0..1). */
export function upperValue(u: number): number {
  if (u <= 0) return 0;
  if (u < CANVAS.peakFrom) return u / CANVAS.peakFrom;
  if (u <= CANVAS.peakTo) return 1;
  return lerp(1, CANVAS.closedUpperValue, (u - CANVAS.peakTo) / (1 - CANVAS.peakTo));
}

/** Value contributed by low cloud seen from below (0..1). */
export function lowValue(L: number): number {
  if (L <= 0) return 0;
  if (L <= CANVAS.lowSparseAt) return (CANVAS.lowSparsePeak * L) / CANVAS.lowSparseAt;
  if (L <= 0.7) return lerp(CANVAS.lowSparsePeak, CANVAS.lowBrokenValue, (L - CANVAS.lowSparseAt) / (0.7 - CANVAS.lowSparseAt));
  return lerp(CANVAS.lowBrokenValue, CANVAS.lowClosedValue, (L - 0.7) / 0.3);
}

/** Canvas value of one column (fractions 0..1), observer below any low deck. */
export function canvasBelow(L: number, M: number, H: number): number {
  const u = overlap(M, H);
  const upper = upperValue(u) * (1 - CANVAS.lowHidesUpper * L);
  const low = lowValue(L);
  const clear = CANVAS.clearGlow * (1 - u) * (1 - L);
  return clamp01(Math.max(upper + 0.5 * low, low, clear));
}

/** Canvas value when the observer stands above the low deck (undercast / sea of clouds). */
export function canvasAbove(L: number, M: number, H: number): number {
  const up = upperValue(overlap(M, H));
  const U = CANVAS.undercastBase + CANVAS.undercastPerCover * L;
  return clamp01(Math.max(canvasBelow(L, M, H), Math.max(up, U) + 0.3 * Math.min(up, U)));
}

export interface DeckInfo {
  /** Low deck found (some level ≥ deckLevelCover near/below the observer). */
  deck: boolean;
  /** Deck top, km above sea level. */
  topKm: number | null;
  /** Observer is above the deck. Null when the heights can't be resolved. */
  observerAbove: boolean | null;
}

/**
 * Find the lowest contiguous cloudy layer from pressure levels and compare its top with the observer.
 * Unresolvable (no complete level data) → observerAbove = null, which the canvas treats as "below".
 */
export function lowDeck(col: Column, observerElevKm: number): DeckInfo {
  if (!col.levelsComplete) return { deck: false, topKm: null, observerAbove: null };
  const lv = col.levels.map((l) => ({ cover: l.cover!, z: l.zKm! })).sort((a, b) => a.z - b.z);
  let i = lv.findIndex((l) => l.cover >= CANVAS.deckLevelCover);
  if (i < 0) return { deck: false, topKm: null, observerAbove: false };
  if (lv[i]!.z > observerElevKm + 3) return { deck: false, topKm: null, observerAbove: false };
  let top = lv[i]!.z;
  while (i + 1 < lv.length && lv[i + 1]!.cover >= CANVAS.deckLevelCover) {
    i++;
    top = lv[i]!.z;
  }
  return { deck: true, topKm: top, observerAbove: observerElevKm > top + CANVAS.aboveDeckMarginKm };
}

// ---------------------------------------------------------------- air & rain

export interface AirInputs {
  aod: Num;
  dust: Num;
  visKm: Num;
  rh: Num;
}

export function airModifier(a: AirInputs): { value: number; missing: string[]; aodTerm: number; visTerm: number; rhTerm: number } {
  const missing: string[] = [];
  let aodTerm: number;
  if (a.aod == null) {
    missing.push('aerosol');
    aodTerm = AIR.aod.penalty;
  } else if (a.aod >= AIR.aod.heavy || (a.dust != null && a.dust >= AIR.dustHeavy)) aodTerm = AIR.aod.penalty;
  else if (a.aod >= AIR.aod.moderateLo && a.aod <= AIR.aod.moderateHi) aodTerm = AIR.aod.bonus;
  else if (a.aod > AIR.aod.moderateHi) aodTerm = lerp(AIR.aod.bonus, AIR.aod.penalty, (a.aod - AIR.aod.moderateHi) / (AIR.aod.heavy - AIR.aod.moderateHi));
  else if (a.aod > AIR.aod.clean) aodTerm = (AIR.aod.bonus * (a.aod - AIR.aod.clean)) / (AIR.aod.moderateLo - AIR.aod.clean);
  else aodTerm = 0;

  let visTerm: number;
  if (a.visKm == null) {
    missing.push('visibility');
    visTerm = AIR.visibility.penalty;
  } else if (a.visKm >= AIR.visibility.goodKm) visTerm = AIR.visibility.bonus;
  else if (a.visKm <= AIR.visibility.poorKm) visTerm = AIR.visibility.penalty;
  else visTerm = lerp(AIR.visibility.penalty, AIR.visibility.bonus, (a.visKm - AIR.visibility.poorKm) / (AIR.visibility.goodKm - AIR.visibility.poorKm));

  let rhTerm: number;
  if (a.rh == null) {
    missing.push('humidity');
    rhTerm = AIR.humidity.penalty;
  } else if (a.rh >= AIR.humidity.veryHumid) rhTerm = AIR.humidity.penalty;
  else if (a.rh >= AIR.humidity.niceLo && a.rh <= AIR.humidity.niceHi) rhTerm = AIR.humidity.bonus;
  else if (a.rh > AIR.humidity.niceHi) rhTerm = lerp(AIR.humidity.bonus, AIR.humidity.penalty, (a.rh - AIR.humidity.niceHi) / (AIR.humidity.veryHumid - AIR.humidity.niceHi));
  else rhTerm = 0;

  const value = Math.max(AIR.min, Math.min(AIR.max, 1 + aodTerm + visTerm + rhTerm));
  return { value, missing, aodTerm, visTerm, rhTerm };
}

/** Rain multiplier from mean precipitation probability (%) and max precipitation (mm/h). Unknown → worst. */
export function rainMultiplier(meanProb: Num, maxMm: Num): number {
  const pf = meanProb == null ? 1 : clamp01((meanProb - RAIN.probFrom) / (RAIN.probTo - RAIN.probFrom));
  const mf = maxMm == null ? 1 : clamp01(maxMm / RAIN.mmFull);
  return 1 - RAIN.maxPenalty * Math.max(pf, mf);
}

// ---------------------------------------------------------------- reach

/** Path-length weights for corridor points: each point stands for the stretch halfway to its neighbours. */
export function pathWeights(distances: readonly number[]): number[] {
  const n = distances.length;
  return distances.map((d, i) => {
    const prev = i > 0 ? distances[i - 1]! : d - (distances[1]! - d);
    const next = i < n - 1 ? distances[i + 1]! : d + (d - distances[n - 2]!);
    return (next - prev) / 2;
  });
}

export function reachFromBlocking(b: number): number {
  if (b <= REACH.clearBelow) return 1;
  if (b >= REACH.blockedAbove) return 0;
  return 1 - (b - REACH.clearBelow) / (REACH.blockedAbove - REACH.clearBelow);
}

// ---------------------------------------------------------------- moment scoring

export interface PointDiag {
  distanceKm: number;
  role: 'canvas' | 'corridor';
  /** Altitude of the observer's tangent ray here (km asl). */
  rayKm: number;
  /** Cover at the ray height (%), null if unknown. */
  rayCover: Num;
  blocking: number;
  resolved: boolean;
  missing: boolean;
  canvasValue: number | null;
  aboveDeck: boolean | null;
  deckTopKm: number | null;
  total: Num;
  low: Num;
  mid: Num;
  high: Num;
  precipProb: Num;
}

export interface MomentScore {
  t: number;
  model: string;
  score: number;
  canvas: number;
  reach: number;
  lit: number;
  litShare: number;
  air: number;
  rain: number;
  blocking: number;
  overcastAll: boolean;
  points: PointDiag[];
  missingPoints: number[];
  missingAir: string[];
  rainUnknown: boolean;
  undercast: boolean;
  /** Distance span where the ray meets significant blocking cloud. */
  blockedZone: { fromKm: number; toKm: number; meanBlocking: number } | null;
  meanPrecipProb: Num;
}

export interface MomentContext {
  observerElevKm: number;
  air: AirSeries | null;
}

const CALC_DISTANCES = [...SAMPLE_POINTS.canvas, ...SAMPLE_POINTS.corridor];

/** Stretch of path (km) each calculation point stands for: halfway to its neighbours. */
const SEGMENTS: Array<{ d: number; from: number; to: number }> = CALC_DISTANCES.map((d, i, a) => {
  const prev = a[i - 1];
  const next = a[i + 1];
  return { d, from: prev == null ? d : (prev + d) / 2, to: next == null ? d + (d - a[i - 1]!) / 2 : (d + next) / 2 };
});

/** Fraction of light that survives the path from a cloud at (d, h) toward the sun at depression δ. */
export function pathTransmission(cols: Map<number, Column | null>, dKm: number, hKm: number, depDeg: number): number {
  let t = 1;
  for (const seg of SEGMENTS) {
    if (seg.to <= dKm) continue;
    const len = seg.to - Math.max(seg.from, dKm);
    if (len <= 0) continue;
    const z = lightPathAltitudeKm(hKm, depDeg, Math.max(0, seg.d - dKm));
    if (z < 0) return 0;
    const b = blockingAt(cols.get(seg.d) ?? null, z).blocking;
    t *= Math.pow(Math.max(0, 1 - b), len / LIT.cloudScaleKm);
  }
  return t;
}


/**
 * How well a cloud surface at (d, h) gets lit during the window: the best transmission (0..1) over the
 * steps. Undersides catch light while the sun is 0…δmax below the horizon; the top of cloud below the
 * viewpoint (undercast) catches it from a sun up to LIT.topSunDeg above the horizon down to δmax.
 */
export function litFraction(cols: Map<number, Column | null>, dKm: number, hKm: number, surface: 'base' | 'top' = 'base'): number {
  const maxDep = shadowAngleDeg(Math.max(0, hKm));
  const start = surface === 'top' ? -LIT.topSunDeg : 0;
  let best = 0;
  for (let dep = start; dep <= maxDep + 1e-9; dep += LIT.stepDeg) {
    best = Math.max(best, pathTransmission(cols, dKm, hKm, dep));
    if (best >= 0.999) break;
  }
  return best;
}

/** A surface counts as lit when at least LIT.minTransmission of the light reaches it (chart colouring). */
export function isLit(cols: Map<number, Column | null>, dKm: number, hKm: number, surface: 'base' | 'top' = 'base'): boolean {
  return litFraction(cols, dKm, hKm, surface) >= LIT.minTransmission;
}

interface Target {
  zKm: number;
  weight: number;
  surface: 'base' | 'top';
}

/**
 * Cloud surfaces that can catch the light. Wherever cover steps up with height there is a cloud underside
 * (placed halfway down to the level below), weighted by the newly appearing cover; wherever it steps down
 * there is a cloud top. Undersides above the viewpoint and tops below it (undercast) are targets.
 */
export function cloudSurfaces(col: Column, observerElevKm: number): Target[] {
  const lv = col.levels.map((l) => ({ z: l.zKm!, c: l.cover! / 100 })).sort((a, b) => a.z - b.z);
  const out: Target[] = [];
  const step = LIT.layerStep;
  lv.forEach((l, i) => {
    if (l.c < LIT.minTargetCover) return;
    const below = lv[i - 1];
    const above = lv[i + 1];
    const rise = l.c - (below?.c ?? 0);
    const fall = l.c - (above?.c ?? 0);
    const baseZ = below ? (below.z + l.z) / 2 : Math.max(0.05, l.z - 0.3);
    const topZ = above ? (l.z + above.z) / 2 : l.z + 0.3;
    if (rise >= step && baseZ >= observerElevKm) out.push({ zKm: Math.max(0.05, baseZ), weight: rise, surface: 'base' });
    if (fall >= step && topZ < observerElevKm) out.push({ zKm: topZ, weight: fall, surface: 'top' });
  });
  return out;
}

function litTargets(col: Column, observerElevKm: number): Target[] | null {
  // Unknown band totals make the band-consistent level profile unknown too: worst case (full, unlit).
  if (bandsMissing(col)) return null;
  if (col.modelHasLevels) {
    if (!col.levelsComplete) return null;
    return cloudSurfaces(col, observerElevKm);
  }
  const g = col.groundKm;
  const t: Target[] = [];
  if (col.low! / 100 >= LIT.minTargetCover) t.push({ zKm: g + 1.5, weight: col.low! / 100, surface: 'base' });
  if (col.mid! / 100 >= LIT.minTargetCover) t.push({ zKm: g + 5, weight: col.mid! / 100, surface: 'base' });
  if (col.high! / 100 >= LIT.minTargetCover) t.push({ zKm: g + 9.5, weight: col.high! / 100, surface: 'base' });
  return t;
}

export function scoreMoment(corridor: CorridorSeries, t: number, ctx: MomentContext): MomentScore {
  const cols = new Map<number, Column | null>();
  for (const d of CALC_DISTANCES) {
    const p = corridor.points.find((x) => x.distanceKm === d);
    cols.set(d, p ? columnAt(p, corridor.times, t, corridor.hasLevels) : null);
  }
  const obsKm = ctx.observerElevKm;
  const points: PointDiag[] = [];
  const missingPoints: number[] = [];

  // canvas
  let canvas = 0;
  let undercast = false;
  SAMPLE_POINTS.canvas.forEach((d, i) => {
    const col = cols.get(d) ?? null;
    const w = CANVAS_WEIGHTS[i]!;
    const ray = rayAltitudeKm(obsKm, d);
    const blk = blockingAt(col, ray);
    if (!col || bandsMissing(col)) {
      missingPoints.push(d);
      points.push(diag(d, 'canvas', ray, col, blk, true, null, null, null));
      return;
    }
    const deck = lowDeck(col, obsKm);
    const L = col.low! / 100;
    const M = col.mid! / 100;
    const H = col.high! / 100;
    const v = deck.observerAbove ? canvasAbove(L, M, H) : canvasBelow(L, M, H);
    if (deck.observerAbove && d === 0) undercast = true;
    canvas += w * v;
    points.push(diag(d, 'canvas', ray, col, blk, false, v, deck.observerAbove, deck.topKm));
  });

  // reach
  const weights = pathWeights(SAMPLE_POINTS.corridor);
  let wSum = 0;
  let bSum = 0;
  SAMPLE_POINTS.corridor.forEach((d, i) => {
    const col = cols.get(d) ?? null;
    const ray = rayAltitudeKm(obsKm, d);
    const blk = blockingAt(col, ray);
    const missing = !col || (blk.known === false);
    if (missing) missingPoints.push(d);
    wSum += weights[i]!;
    bSum += weights[i]! * blk.blocking;
    points.push(diag(d, 'corridor', ray, col, blk, missing, null, null, null));
  });
  const blocking = wSum > 0 ? bSum / wSum : 1;
  const reach = reachFromBlocking(blocking);

  // lit
  let litNum = 0;
  let litDen = 0;
  SAMPLE_POINTS.canvas.forEach((d, i) => {
    const col = cols.get(d) ?? null;
    const w = CANVAS_WEIGHTS[i]!;
    const targets = col ? litTargets(col, obsKm) : null;
    if (!targets) {
      // unknown cloud here: count it as a full, unlit target (worst case)
      litDen += w;
      return;
    }
    if (targets.length === 0) return;
    const mass = Math.min(1, targets.reduce((a, x) => a + x.weight, 0));
    const tw = targets.reduce((a, x) => a + x.weight, 0);
    const litW = targets.reduce((a, x) => a + (x.weight * litFraction(cols, d, x.zKm, x.surface)), 0);
    litNum += w * mass * (litW / tw);
    litDen += w * mass;
  });
  const litShare = litDen > 0 ? litNum / litDen : 1;
  const lit = Math.min(1, litShare / LIT.saturation);

  // air
  const c0 = cols.get(0) ?? null;
  const airIn: AirInputs = {
    aod: ctx.air ? sampleAt(ctx.air.times, ctx.air.aod, t) : null,
    dust: ctx.air ? sampleAt(ctx.air.times, ctx.air.dust, t) : null,
    visKm: c0?.visKm ?? null,
    rh: c0?.rh ?? null,
  };
  const airRes = airModifier(airIn);

  // rain over the canvas
  let probSum = 0;
  let maxMm: number | null = 0;
  let rainUnknown = false;
  for (const d of SAMPLE_POINTS.canvas) {
    const col = cols.get(d) ?? null;
    const pp = col?.precipProb ?? null;
    const mm = col?.precip ?? null;
    if (pp == null) rainUnknown = true;
    probSum += pp ?? 100;
    if (mm == null) {
      rainUnknown = true;
      maxMm = null;
    } else if (maxMm != null) maxMm = Math.max(maxMm, mm);
  }
  const meanProb = probSum / SAMPLE_POINTS.canvas.length;
  const rain = rainMultiplier(meanProb, maxMm);

  // opaque overcast everywhere (unknown counts as possibly overcast)
  const overcastAll = CALC_DISTANCES.every((d) => {
    const col = cols.get(d) ?? null;
    if (!col || col.low == null || col.mid == null) return true;
    return overlap(col.low / 100, col.mid / 100) * 100 >= OVERCAST_OPAQUE;
  });

  const raw = overcastAll ? 0 : 5 * canvas * reach * lit * airRes.value * rain;
  const score = Math.max(0, Math.min(5, raw));

  return {
    t,
    model: corridor.model,
    score,
    canvas,
    reach,
    lit,
    litShare,
    air: airRes.value,
    rain,
    blocking,
    overcastAll,
    points,
    missingPoints: [...new Set(missingPoints)].sort((a, b) => a - b),
    missingAir: airRes.missing,
    rainUnknown,
    undercast,
    blockedZone: blockedZone(points),
    meanPrecipProb: rainUnknown ? null : meanProb,
  };
}

function diag(
  d: number,
  role: 'canvas' | 'corridor',
  ray: number,
  col: Column | null,
  blk: { blocking: number; known: boolean; resolved: boolean },
  missing: boolean,
  canvasValue: number | null,
  aboveDeck: boolean | null,
  deckTopKm: number | null,
): PointDiag {
  return {
    distanceKm: d,
    role,
    rayKm: ray,
    rayCover: blk.known ? Math.round((blk.blocking / opacityForDiag(col, ray)) * 100) : null,
    blocking: blk.blocking,
    resolved: blk.resolved,
    missing,
    canvasValue,
    aboveDeck,
    deckTopKm,
    total: col?.total ?? null,
    low: col?.low ?? null,
    mid: col?.mid ?? null,
    high: col?.high ?? null,
    precipProb: col?.precipProb ?? null,
  };
}

function opacityForDiag(col: Column | null, z: number): number {
  if (!col) return 1;
  const agl = z - col.groundKm;
  return agl < 3 ? 1 : agl < 8 ? 0.8 : 0.5;
}

function blockedZone(points: PointDiag[]): MomentScore['blockedZone'] {
  const hits = points.filter((p) => p.role === 'corridor' && p.blocking >= REACH.clearBelow);
  if (hits.length === 0) return null;
  return {
    fromKm: Math.min(...hits.map((h) => h.distanceKm)),
    toKm: Math.max(...hits.map((h) => h.distanceKm)),
    meanBlocking: hits.reduce((a, h) => a + h.blocking, 0) / hits.length,
  };
}

/** Exposed for tests: the tangent-ray table in §4.1. */
export function rayHeightTable(): Array<{ d: number; h: number }> {
  return SAMPLE_POINTS.corridor.map((d) => ({ d, h: (d * d) / (2 * EARTH_RADIUS_KM) }));
}
