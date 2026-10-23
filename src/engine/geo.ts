import { EARTH_RADIUS_KM, REFRACTION_K } from './config';

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Normalise a longitude to [-180, 180). */
export function normLon(lon: number): number {
  const x = (((lon + 180) % 360) + 360) % 360 - 180;
  return Object.is(x, -0) ? 0 : x;
}

/** Normalise a bearing to [0, 360). */
export function normBearing(b: number): number {
  return ((b % 360) + 360) % 360;
}

/** Spherical destination point: start, initial bearing (deg), distance (km). Negative distance walks backwards. */
export function destination(start: LatLon, bearingDeg: number, distanceKm: number, radiusKm = EARTH_RADIUS_KM): LatLon {
  const δ = distanceKm / radiusKm;
  const θ = bearingDeg * DEG;
  const φ1 = start.lat * DEG;
  const λ1 = start.lon * DEG;
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(Math.max(-1, Math.min(1, sinφ2)));
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return { lat: φ2 * RAD, lon: normLon(λ2 * RAD) };
}

/** Great-circle distance (km), haversine. */
export function distanceKm(a: LatLon, b: LatLon, radiusKm = EARTH_RADIUS_KM): number {
  const φ1 = a.lat * DEG;
  const φ2 = b.lat * DEG;
  const dφ = φ2 - φ1;
  const dλ = (b.lon - a.lon) * DEG;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * radiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from a to b (degrees, 0..360). */
export function initialBearing(a: LatLon, b: LatLon): number {
  const φ1 = a.lat * DEG;
  const φ2 = b.lat * DEG;
  const dλ = (b.lon - a.lon) * DEG;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return normBearing(Math.atan2(y, x) * RAD);
}

/** Effective Earth radius with the optional refraction factor. */
export function effectiveRadius(k = REFRACTION_K): number {
  return EARTH_RADIUS_KM / (1 - k);
}

/** Height of the observer's tangent ray above the observer's horizon plane at distance d (km): h = d² / 2R. */
export function rayHeightKm(dKm: number, k = REFRACTION_K): number {
  return (dKm * dKm) / (2 * effectiveRadius(k));
}

/** Absolute (above sea level) altitude of the tangent ray at distance d for an observer at elevation e (km). */
export function rayAltitudeKm(observerElevKm: number, dKm: number, k = REFRACTION_K): number {
  return observerElevKm + rayHeightKm(Math.abs(dKm), k);
}

/** Maximum solar depression (radians) at which a cloud at height h (km) is still lit: δmax = sqrt(2h/R). */
export function shadowAngleRad(hKm: number, k = REFRACTION_K): number {
  return hKm <= 0 ? 0 : Math.sqrt((2 * hKm) / effectiveRadius(k));
}

export function shadowAngleDeg(hKm: number, k = REFRACTION_K): number {
  return shadowAngleRad(hKm, k) * RAD;
}

/** Altitude along the light path from a cloud at height h toward a sun depressed by δ (deg), after s km: z = h − s·tanδ + s²/2R. */
export function lightPathAltitudeKm(hKm: number, depressionDeg: number, sKm: number, k = REFRACTION_K): number {
  return hKm - sKm * Math.tan(depressionDeg * DEG) + (sKm * sKm) / (2 * effectiveRadius(k));
}
