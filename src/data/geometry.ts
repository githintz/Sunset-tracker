/** Where we sample: corridor points and terrain-profile points along a bearing. */
import { SAMPLE_POINTS } from '../engine/config';
import { destination, type LatLon } from '../engine/geo';
import type { PointRole } from '../engine/types';

export interface SamplePoint extends LatLon {
  distanceKm: number;
  role: PointRole;
  label: string;
}

const LABELS: Record<number, string> = {
  [-5]: 'Behind you',
  [-2.5]: 'Behind you',
  0: 'Overhead',
  2.5: 'Near',
  5: 'Near',
  10: 'Near',
  20: 'Canvas edge',
  30: 'Mid-field',
  50: 'Corridor',
  100: 'Corridor',
  150: 'Corridor',
  200: 'Corridor',
  300: 'Far corridor',
  350: 'Far corridor',
};

export function corridorPoints(observer: LatLon, bearingDeg: number): SamplePoint[] {
  const pts: SamplePoint[] = [];
  const add = (ds: readonly number[], role: PointRole) => {
    for (const d of ds) {
      const p = destination(observer, bearingDeg, d);
      pts.push({ lat: round4(p.lat), lon: round4(p.lon), distanceKm: d, role, label: LABELS[d] ?? `${d} km` });
    }
  };
  add(SAMPLE_POINTS.canvas, 'canvas');
  add(SAMPLE_POINTS.corridor, 'corridor');
  add(SAMPLE_POINTS.chartOnly, 'chart');
  return pts.sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Terrain profile distances: fine near the observer, coarse far away, a little behind (anti-solar side). */
export const PROFILE_DISTANCES = [
  -30, -20, -15, -10, -7, -5, -4, -3, -2.5, -2, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80,
  100, 120, 150, 175, 200, 225, 250, 275, 300, 325, 350,
];

export function profilePoints(observer: LatLon, bearingDeg: number): Array<LatLon & { distanceKm: number }> {
  return PROFILE_DISTANCES.map((d) => {
    const p = d === 0 ? observer : destination(observer, bearingDeg, d);
    return { lat: round4(p.lat), lon: round4(p.lon), distanceKm: d };
  });
}

export function round4(x: number): number {
  return Math.round(x * 1e4) / 1e4;
}
