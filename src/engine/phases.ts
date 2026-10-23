/** Light phases by solar altitude (never by clock), robust to polar day and night. */
import { PHASES } from './config';
import { findCrossings, sunAltitude } from './solar';

export type PhaseKind = 'day' | 'golden' | 'blue' | 'night' | 'astro';

export interface PhaseSegment {
  kind: PhaseKind;
  start: number;
  end: number;
  /** For golden/blue: evening (sun going down) or morning. */
  evening: boolean | null;
}

export function phaseOfAltitude(alt: number): PhaseKind {
  if (alt > PHASES.daytimeAbove) return 'day';
  if (alt >= PHASES.goldenBottom) return 'golden';
  if (alt >= PHASES.blueBottom) return 'blue';
  if (alt >= PHASES.astroDark) return 'night';
  return 'astro';
}

const THRESHOLDS = [PHASES.daytimeAbove, PHASES.goldenBottom, PHASES.blueBottom, PHASES.astroDark];

export function phaseSegments(lat: number, lon: number, start: number, end: number): PhaseSegment[] {
  const cuts = new Set<number>([start, end]);
  for (const th of THRESHOLDS) for (const c of findCrossings(lat, lon, start, end, th)) cuts.add(c.t);
  const ts = [...cuts].sort((a, b) => a - b);
  const segs: PhaseSegment[] = [];
  for (let i = 0; i < ts.length - 1; i++) {
    const a = ts[i]!;
    const b = ts[i + 1]!;
    if (b - a < 1000) continue;
    const mid = (a + b) / 2;
    const kind = phaseOfAltitude(sunAltitude(mid, lat, lon));
    const evening =
      kind === 'golden' || kind === 'blue' ? sunAltitude(mid + 300000, lat, lon) < sunAltitude(mid - 300000, lat, lon) : null;
    const prev = segs[segs.length - 1];
    if (prev && prev.kind === kind && prev.evening === evening) prev.end = b;
    else segs.push({ kind, start: a, end: b, evening });
  }
  return segs;
}

/**
 * End of a "photographer's day": the end of the next morning blue hour after now
 * (sun rising through −4° after having been below −6°). Falls back to now + 24 h (polar day/night).
 */
export function photographersDayEnd(lat: number, lon: number, now: number): number {
  const horizon = now + 48 * 3600000;
  const blueStarts = findCrossings(lat, lon, now, horizon, PHASES.blueBottom).filter((c) => c.rising);
  for (const bs of blueStarts) {
    const end = findCrossings(lat, lon, bs.t, bs.t + 6 * 3600000, PHASES.goldenBottom).find((c) => c.rising);
    if (end) return end.t;
  }
  return now + 24 * 3600000;
}
