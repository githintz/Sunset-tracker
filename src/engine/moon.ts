import { getMoonIllumination, getMoonPosition, getMoonTimes } from 'suncalc';

export interface MoonState {
  /** Apparent altitude, degrees. */
  altitude: number;
  azimuth: number;
  /** Illuminated fraction 0..1. */
  illumination: number;
  /** 0 new → 0.5 full → 1 new. */
  phase: number;
  waxing: boolean;
}

export function moonState(ms: number, lat: number, lon: number): MoonState {
  const d = new Date(ms);
  const pos = getMoonPosition(d, lat, lon);
  const ill = getMoonIllumination(d);
  return { altitude: pos.altitude, azimuth: pos.azimuth, illumination: ill.fraction, phase: ill.phase, waxing: ill.phase < 0.5 };
}

/**
 * Relative ground brightness from the moon, 0 (none) … 1 (full moon at zenith).
 * Used as the "equivalent ground brightness" criterion for dark-sky work.
 */
export function moonBrightness(m: MoonState): number {
  if (m.altitude <= 0) return 0;
  const sinAlt = Math.sin((m.altitude * Math.PI) / 180);
  // Lunar brightness falls much faster than the illuminated fraction (opposition surge); ^1.5 is a fair approximation.
  return Math.pow(m.illumination, 1.5) * Math.min(1, sinAlt * 1.4);
}

export interface MoonRiseSet {
  rise: number | null;
  set: number | null;
  alwaysUp: boolean;
  alwaysDown: boolean;
}

/** Moon rise/set within the civil day starting at dayStartMs, given the zone offset in minutes. */
export function moonRiseSet(dayStartMs: number, lat: number, lon: number, utcOffsetMin: number): MoonRiseSet {
  const t = getMoonTimes(new Date(dayStartMs + 12 * 3600000), lat, lon, utcOffsetMin);
  return {
    rise: t.rise ? t.rise.getTime() : null,
    set: t.set ? t.set.getTime() : null,
    alwaysUp: !!t.alwaysUp,
    alwaysDown: !!t.alwaysDown,
  };
}

export function moonPhaseName(phase: number): string {
  const names = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
  return names[Math.round(phase * 8) % 8]!;
}
