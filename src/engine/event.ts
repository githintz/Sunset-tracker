/** One sunset or sunrise: scenarios, averaged rating, golden hour, sky, verdict and reasons. */
import { COMBINE_WEIGHTS, ENGINE_VERSION, SCENARIOS, VERDICT_BANDS, VERDICT_LABELS } from './config';
import { bracket, sampleAt } from './column';
import { goldenHour, type GoldenRating } from './golden';
import { buildSunsetReasons } from './reasons';
import { skyRating, type SkyRating } from './sky';
import { scoreMoment, type MomentScore } from './sunset';
import type { SunEvent } from './solar';
import type { AirSeries, CorridorSeries, Observer, ObserverSeries, Reason, Verdict } from './types';

export interface EventInputs {
  observer: Observer;
  event: SunEvent;
  corridorA: CorridorSeries | null;
  corridorB: CorridorSeries | null;
  air: AirSeries | null;
  obs: ObserverSeries | null;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface EventRating {
  engineVersion: string;
  kind: 'sunrise' | 'sunset';
  official: number;
  centre: number;
  bestLight: number;
  azimuth: number;
  event: MomentScore | null;
  best: MomentScore | null;
  modelB: MomentScore | null;
  shoulders: Array<{ t: number; score: number | null }>;
  /** Averaged scenario score 0..5 (unrounded), null if no data covers the event. */
  raw: number | null;
  /** One decimal for display. */
  rating: number | null;
  stars: number | null;
  modelsDisagree: boolean;
  singleModel: boolean;
  /** The primary model had no data; the second model was used alone. */
  primaryIsB: boolean;
  golden: GoldenRating;
  sky: SkyRating;
  combined: number | null;
  verdict: Verdict | null;
  verdictLabel: string;
  confidence: Confidence;
  reasons: Reason[];
}

export function covers(c: CorridorSeries | null, t: number): c is CorridorSeries {
  return !!c && bracket(c.times, t) >= 0;
}

export function verdictFor(combined: number): Verdict {
  let v = 0;
  while (v < VERDICT_BANDS.length && combined >= VERDICT_BANDS[v]!) v++;
  return v as Verdict;
}

export function verdictLabel(v: Verdict | null): string {
  return v == null ? 'No data' : VERDICT_LABELS[v];
}

export function combine(sunset: number, golden: number | null): number {
  return golden == null ? sunset : COMBINE_WEIGHTS.sunset * sunset + COMBINE_WEIGHTS.golden * golden;
}

export function rateEvent(inp: EventInputs): EventRating {
  const { observer, event } = inp;
  const obsKm = observer.elevationM / 1000;
  const ctx = { observerElevKm: obsKm, air: inp.air };
  const offset = SCENARIOS.bestLightOffsetMin * 60000 * (event.kind === 'sunset' ? 1 : -1);
  const bestT = event.centre + offset;

  // If the primary model has no data for this event, the second model stands in (and is reported as such).
  const aOk = covers(inp.corridorA, event.centre);
  const primary = aOk ? inp.corridorA : covers(inp.corridorB, event.centre) ? inp.corridorB : null;
  const secondary = aOk ? inp.corridorB : null;
  const primaryIsB = !aOk && primary != null;

  const ev = primary && covers(primary, event.centre) ? scoreMoment(primary, event.centre, ctx) : null;
  const best = primary && covers(primary, bestT) ? scoreMoment(primary, bestT, ctx) : null;
  const mb = covers(secondary, event.centre) ? scoreMoment(secondary, event.centre, ctx) : null;

  const shoulders = [-SCENARIOS.shoulderHours, SCENARIOS.shoulderHours].map((h) => {
    const t = event.centre + h * 3600000;
    return { t, score: primary && covers(primary, t) ? scoreMoment(primary, t, ctx).score : null };
  });

  const scen = [ev, best, mb].filter((x): x is MomentScore => x != null);
  const raw = scen.length ? scen.reduce((a, m) => a + m.score, 0) / scen.length : null;
  const modelsDisagree = !!(ev && mb && Math.abs(ev.score - mb.score) >= SCENARIOS.disagreeAt);
  const singleModel = !mb;

  const golden = goldenHour({
    lat: observer.lat,
    lon: observer.lon,
    observerElevKm: obsKm,
    kind: event.kind,
    eventMs: event.official,
    corridor: primary,
    observer: inp.obs,
    air: ev?.air ?? 1,
  });
  const cape = inp.obs ? sampleAt(inp.obs.times, inp.obs.cape, event.centre) : null;
  const sky = skyRating(ev, cape);

  const combined = raw == null ? null : combine(raw, golden.score);
  const verdict = combined == null ? null : verdictFor(combined);

  const missingCount = ev ? ev.missingPoints.length + ev.missingAir.length + (ev.rainUnknown ? 1 : 0) : 99;
  let confidence: Confidence = 'high';
  if (singleModel || missingCount > 0 || golden.missing) confidence = 'medium';
  if (modelsDisagree || missingCount >= 3 || !ev) confidence = 'low';

  const rating: EventRating = {
    engineVersion: ENGINE_VERSION,
    kind: event.kind,
    official: event.official,
    centre: event.centre,
    bestLight: bestT,
    azimuth: event.azimuth,
    event: ev,
    best,
    modelB: mb,
    shoulders,
    raw,
    rating: raw == null ? null : Math.round(raw * 10) / 10,
    stars: raw == null ? null : Math.round(raw),
    modelsDisagree,
    singleModel,
    golden,
    sky,
    primaryIsB,
    combined,
    verdict,
    verdictLabel: verdictLabel(verdict),
    confidence,
    reasons: [],
  };
  rating.reasons = buildSunsetReasons(rating, observer);
  return rating;
}
