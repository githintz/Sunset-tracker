/** Pure geometry for the cross-section chart (unit-tested separately from the SVG). */
import { SAMPLE_POINTS } from '../../engine/config';
import { columnAt, type Column } from '../../engine/column';
import { isLit } from '../../engine/sunset';
import { rayAltitudeKm } from '../../engine/geo';
import type { CorridorSeries, TerrainProfile } from '../../engine/types';

export const X_MIN = -5;
export const X_MAX = 350;
export const SPLIT_KM = 30;
export const SPLIT_FRAC = 0.45;
export const Y_MAX_KM = 12;

/** Compressed far range: −5…30 km gets 45 % of the width, 30…350 km the rest. */
export function xFrac(d: number): number {
  const c = Math.max(X_MIN, Math.min(X_MAX, d));
  if (c <= SPLIT_KM) return ((c - X_MIN) / (SPLIT_KM - X_MIN)) * SPLIT_FRAC;
  return SPLIT_FRAC + ((c - SPLIT_KM) / (X_MAX - SPLIT_KM)) * (1 - SPLIT_FRAC);
}

export interface Cell {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  cover: number;
  lit: boolean;
}

export interface ColumnView {
  distanceKm: number;
  role: 'canvas' | 'corridor' | 'chart';
  x0: number;
  x1: number;
  state: 'resolved' | 'bands' | 'missing';
  cells: Cell[];
  col: Column | null;
}

export interface CrossSectionView {
  columns: ColumnView[];
  ray: Array<{ x: number; z: number }>;
  terrain: Array<{ x: number; z: number }>;
  observerKm: number;
}

const CALC = [...SAMPLE_POINTS.canvas, ...SAMPLE_POINTS.corridor];

export function buildCrossSection(c: CorridorSeries | null, t: number, observerKm: number, profile: TerrainProfile | null): CrossSectionView {
  const pts = c ? [...c.points].sort((a, b) => a.distanceKm - b.distanceKm) : [];
  const cols = new Map<number, Column | null>();
  for (const d of CALC) {
    const p = pts.find((x) => x.distanceKm === d);
    cols.set(d, p && c ? columnAt(p, c.times, t, c.hasLevels) : null);
  }
  const xs = pts.map((p) => xFrac(p.distanceKm));
  const columns: ColumnView[] = pts.map((p, i) => {
    const x = xs[i]!;
    const x0 = i === 0 ? 0 : (xs[i - 1]! + x) / 2;
    const x1 = i === pts.length - 1 ? 1 : (x + xs[i + 1]!) / 2;
    const col = columnAt(p, c!.times, t, c!.hasLevels);
    const missing = col.total == null && col.low == null && col.mid == null && col.high == null && !col.levels.some((l) => l.cover != null);
    if (missing) return { distanceKm: p.distanceKm, role: p.role, x0, x1, state: 'missing', cells: [], col };
    const cells: Cell[] = [];
    if (col.levelsComplete) {
      const lv = col.levels.map((l) => ({ z: l.zKm!, cover: l.cover! })).sort((a, b) => a.z - b.z);
      lv.forEach((l, k) => {
        const z0 = k === 0 ? Math.max(0, l.z - 0.15) : (lv[k - 1]!.z + l.z) / 2;
        const z1 = k === lv.length - 1 ? Math.min(Y_MAX_KM, l.z + 0.6) : (l.z + lv[k + 1]!.z) / 2;
        if (l.cover >= 5) cells.push({ x0, x1, z0, z1, cover: l.cover / 100, lit: isLit(cols, p.distanceKm, l.z) });
      });
      return { distanceKm: p.distanceKm, role: p.role, x0, x1, state: 'resolved', cells, col };
    }
    const g = col.groundKm;
    const bands: Array<[number | null, number, number, number]> = [
      [col.low, g, g + 3, g + 1.5],
      [col.mid, g + 3, g + 8, g + 5],
      [col.high, g + 8, Y_MAX_KM, g + 9.5],
    ];
    for (const [cv, z0, z1, rep] of bands) if (cv != null && cv >= 5) cells.push({ x0, x1, z0, z1: Math.min(z1, Y_MAX_KM), cover: cv / 100, lit: isLit(cols, p.distanceKm, rep) });
    return { distanceKm: p.distanceKm, role: p.role, x0, x1, state: 'bands', cells, col };
  });
  const ray: CrossSectionView['ray'] = [];
  for (let d = 0; d <= X_MAX; d += d < 30 ? 2 : 10) ray.push({ x: xFrac(d), z: rayAltitudeKm(observerKm, d) });
  const terrain = (profile?.samples ?? [])
    .filter((s) => s.elevationM != null && s.distanceKm >= X_MIN && s.distanceKm <= X_MAX)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .map((s) => ({ x: xFrac(s.distanceKm), z: s.elevationM! / 1000 }));
  return { columns, ray, terrain, observerKm };
}

export function oktas(total: number | null): number | null {
  return total == null ? null : Math.round(total / 12.5);
}
