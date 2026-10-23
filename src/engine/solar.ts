/**
 * NOAA solar position (Meeus-based, as in the NOAA Solar Calculator spreadsheet) plus robust
 * altitude-crossing search. Root finding on altitude, instead of the closed-form hour-angle formula,
 * keeps it valid near the poles: polar day/night simply yield no crossing.
 */
import { DEG, RAD, normBearing } from './geo';
import { NIGHT, PHASES } from './config';

export interface SunPosition {
  /** Geometric (true) altitude, degrees. */
  altitude: number;
  /** Altitude including standard atmospheric refraction, degrees. */
  apparentAltitude: number;
  /** Azimuth, degrees clockwise from north. */
  azimuth: number;
  declination: number;
}

const MS_PER_DAY = 86400000;

export function julianDay(ms: number): number {
  return ms / MS_PER_DAY + 2440587.5;
}

function sunCore(ms: number) {
  const T = (julianDay(ms) - 2451545) / 36525;
  const L0 = normBearing(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * DEG;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * DEG);
  const decl = Math.asin(Math.sin(eps * DEG) * Math.sin(appLong * DEG)) * RAD;
  const y = Math.tan((eps / 2) * DEG) ** 2;
  const L0r = L0 * DEG;
  const eqTime =
    4 *
    RAD *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr));
  return { decl, eqTime };
}

/** Standard refraction correction (degrees) for a geometric elevation, NOAA formula. */
export function refractionDeg(elevDeg: number): number {
  if (elevDeg > 85) return 0;
  const te = Math.tan(elevDeg * DEG);
  let arcsec: number;
  if (elevDeg > 5) arcsec = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (elevDeg > -0.575) arcsec = 1735 + elevDeg * (-518.2 + elevDeg * (103.4 + elevDeg * (-12.79 + elevDeg * 0.711)));
  else arcsec = -20.774 / te;
  return arcsec / 3600;
}

export function sunPosition(ms: number, lat: number, lon: number): SunPosition {
  const { decl, eqTime } = sunCore(ms);
  const dayFrac = (((ms % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY) / 60000;
  const tst = (((dayFrac + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const φ = lat * DEG;
  const δ = decl * DEG;
  const H = ha * DEG;
  const cosZ = Math.max(-1, Math.min(1, Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H)));
  const altitude = 90 - Math.acos(cosZ) * RAD;
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(φ) - Math.tan(δ) * Math.cos(φ)) * RAD + 180;
  return { altitude, apparentAltitude: altitude + refractionDeg(altitude), azimuth: normBearing(az), declination: decl };
}

export function sunAltitude(ms: number, lat: number, lon: number): number {
  return sunPosition(ms, lat, lon).altitude;
}

export interface Crossing {
  t: number;
  /** true = altitude increasing through the threshold (rise), false = decreasing (set). */
  rising: boolean;
}

/**
 * All instants in [startMs, endMs] where the sun's geometric altitude crosses `thresholdDeg`.
 * Scans in `stepMin` steps then bisects to ~1 s.
 */
export function findCrossings(
  lat: number,
  lon: number,
  startMs: number,
  endMs: number,
  thresholdDeg: number,
  stepMin = 10,
): Crossing[] {
  const out: Crossing[] = [];
  const step = stepMin * 60000;
  let t0 = startMs;
  let f0 = sunAltitude(t0, lat, lon) - thresholdDeg;
  while (t0 < endMs) {
    const t1 = Math.min(t0 + step, endMs);
    const f1 = sunAltitude(t1, lat, lon) - thresholdDeg;
    if (f0 === 0) {
      // exact hit on a grid point: classify by next sample
      if (f1 !== 0) out.push({ t: t0, rising: f1 > 0 });
    } else if (f0 * f1 < 0) {
      let a = t0;
      let b = t1;
      let fa = f0;
      while (b - a > 1000) {
        const m = (a + b) / 2;
        const fm = sunAltitude(m, lat, lon) - thresholdDeg;
        if (fa * fm <= 0) b = m;
        else {
          a = m;
          fa = fm;
        }
      }
      out.push({ t: Math.round((a + b) / 2), rising: f1 > 0 });
    }
    t0 = t1;
    f0 = f1;
  }
  return out;
}

export interface SunEvent {
  kind: 'sunrise' | 'sunset';
  /** Official time: upper limb on the horizon with standard refraction (−0.833°). */
  official: number;
  /** Engine moment: sun centre on the geometric horizon (0°). */
  centre: number;
  /** Sun azimuth at the centre crossing (deg). */
  azimuth: number;
}

/** Sunrise/sunset events between start and end. Polar day/night yields an empty list. */
export function sunEvents(lat: number, lon: number, startMs: number, endMs: number): SunEvent[] {
  const pad = 3 * 3600000;
  const official = findCrossings(lat, lon, startMs, endMs, PHASES.officialHorizon);
  const centre = findCrossings(lat, lon, startMs - pad, endMs + pad, 0);
  const events: SunEvent[] = [];
  for (const o of official) {
    // pair with the nearest centre crossing of the same direction (minutes apart)
    let best: Crossing | undefined;
    for (const c of centre) {
      if (c.rising !== o.rising) continue;
      if (!best || Math.abs(c.t - o.t) < Math.abs(best.t - o.t)) best = c;
    }
    // Grazing at high latitude: the centre may never reach 0° even though the upper limb does.
    const centreT = best && Math.abs(best.t - o.t) < 2 * 3600000 ? best.t : o.t;
    events.push({
      kind: o.rising ? 'sunrise' : 'sunset',
      official: o.t,
      centre: centreT,
      azimuth: sunPosition(centreT, lat, lon).azimuth,
    });
  }
  return events;
}

/** Instant (ms) when the altitude reaches `deg` near a reference event, searching in a window after (or before) it. */
export function altitudeTimeNear(
  lat: number,
  lon: number,
  refMs: number,
  deg: number,
  direction: 'after' | 'before',
  windowH = 6,
): number | null {
  const span = windowH * 3600000;
  const [a, b] = direction === 'after' ? [refMs, refMs + span] : [refMs - span, refMs];
  const xs = findCrossings(lat, lon, a, b, deg, 5);
  if (xs.length === 0) return null;
  return direction === 'after' ? xs[0]!.t : xs[xs.length - 1]!.t;
}

/** Greenwich mean sidereal time (degrees). */
export function gmstDeg(ms: number): number {
  const jd = julianDay(ms);
  const T = (jd - 2451545) / 36525;
  return normBearing(280.46061837 + 360.98564736629 * (jd - 2451545) + T * T * (0.000387933 - T / 38710000));
}

/** Altitude (deg) of a fixed RA/Dec object. */
export function fixedObjectAltitude(ms: number, lat: number, lon: number, raHours: number, decDeg: number): number {
  const lst = gmstDeg(ms) + lon;
  const H = (lst - raHours * 15) * DEG;
  const φ = lat * DEG;
  const δ = decDeg * DEG;
  return Math.asin(Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H)) * RAD;
}

export function galacticCoreAltitude(ms: number, lat: number, lon: number): number {
  return fixedObjectAltitude(ms, lat, lon, NIGHT.galacticCore.raHours, NIGHT.galacticCore.decDeg);
}
