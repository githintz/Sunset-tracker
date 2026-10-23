/** Terrain classification from the elevation profile along the sun bearing. Illustrative only — never used for light blocking. */
import { TERRAIN } from './config';
import { RAD } from './geo';
import type { TerrainProfile } from './types';

export type TerrainClass = 'mountain' | 'valley' | 'coast' | 'open';

export interface TerrainInfo {
  kind: TerrainClass;
  reliefM: number | null;
  /** Highest elevation angle (deg) to terrain behind the observer (anti-solar side) within 30 km. */
  backAngleDeg: number | null;
  /** Highest elevation angle (deg) to terrain toward the sun within 30 km. */
  frontAngleDeg: number | null;
  /** Relief of the anti-solar side (m above the observer). */
  backReliefM: number | null;
  known: boolean;
}

export function elevationAngleDeg(observerM: number, targetM: number, distanceKm: number): number {
  const d = Math.abs(distanceKm) * 1000;
  if (d === 0) return 0;
  // include Earth curvature drop
  const drop = (d * d) / (2 * 6371000);
  return Math.atan2(targetM - observerM - drop, d) * RAD;
}

export function classifyTerrain(observerM: number, profile: TerrainProfile | null): TerrainInfo {
  const samples = (profile?.samples ?? []).filter((s) => s.elevationM != null && Math.abs(s.distanceKm) <= TERRAIN.coastKm);
  if (samples.length < 4) {
    return { kind: observerM >= TERRAIN.mountainObserverM ? 'mountain' : 'open', reliefM: null, backAngleDeg: null, frontAngleDeg: null, backReliefM: null, known: false };
  }
  const elev = samples.map((s) => s.elevationM!);
  const relief = Math.max(...elev, observerM) - Math.min(...elev, observerM);
  const near = samples.filter((s) => Math.abs(s.distanceKm) <= TERRAIN.nearKm && s.distanceKm !== 0);
  const ahead = near.filter((s) => s.distanceKm > 0).map((s) => s.elevationM!);
  const behind = near.filter((s) => s.distanceKm < 0).map((s) => s.elevationM!);
  const angle = (xs: typeof samples) =>
    xs.length ? Math.max(...xs.map((s) => elevationAngleDeg(observerM, s.elevationM!, s.distanceKm))) : null;
  const backSide = samples.filter((s) => s.distanceKm < 0);
  const frontSide = samples.filter((s) => s.distanceKm > 0);
  const backReliefM = backSide.length ? Math.max(...backSide.map((s) => s.elevationM!)) - observerM : null;
  const water = samples.some((s) => s.elevationM! <= 1);

  let kind: TerrainClass;
  const valley =
    ahead.length > 0 && behind.length > 0 && Math.max(...ahead) >= observerM + TERRAIN.valleyRiseM && Math.max(...behind) >= observerM + TERRAIN.valleyRiseM;
  if (observerM >= TERRAIN.mountainObserverM) kind = 'mountain';
  else if (valley) kind = 'valley';
  else if (relief >= TERRAIN.mountainReliefM) kind = 'mountain';
  else if (water) kind = 'coast';
  else kind = 'open';
  return { kind, reliefM: relief, backAngleDeg: angle(backSide), frontAngleDeg: angle(frontSide), backReliefM, known: true };
}

export const TERRAIN_LABEL: Record<TerrainClass, string> = {
  mountain: 'Mountain',
  valley: 'Valley',
  coast: 'Coast',
  open: 'Open country',
};

