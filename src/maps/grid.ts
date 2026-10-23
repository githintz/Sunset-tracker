/**
 * Map-grid computation (pure). The scheduled workflow fetches a regular lat/lon grid of band cloud cover and
 * precipitation probability, then scores every cell with the same engine as the app, in band-only mode, by
 * interpolating the grid along each cell's own sun bearing.
 */
import { SAMPLE_POINTS } from '../engine/config';
import { destination } from '../engine/geo';
import { sunAltitude, sunEvents } from '../engine/solar';
import { moonBrightness, moonState } from '../engine/moon';
import { scoreMoment } from '../engine/sunset';
import type { CorridorSeries, Num, PointSeries } from '../engine/types';
import { encodeBytes, quantise, type LayerId, type MapFrame, type MapLayerFile } from './format';

export interface GridSpec {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  step: number;
}

export const ALPS: GridSpec = { latMin: 44, latMax: 49.5, lonMin: 4, lonMax: 16.5, step: 0.25 };

export function gridDims(g: GridSpec): { nLat: number; nLon: number } {
  return { nLat: Math.round((g.latMax - g.latMin) / g.step) + 1, nLon: Math.round((g.lonMax - g.lonMin) / g.step) + 1 };
}

export function cellCoords(g: GridSpec): Array<{ lat: number; lon: number }> {
  const { nLat, nLon } = gridDims(g);
  const out: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < nLat; i++) for (let j = 0; j < nLon; j++) out.push({ lat: g.latMin + i * g.step, lon: g.lonMin + j * g.step });
  return out;
}

export type GridVar = 'total' | 'low' | 'mid' | 'high' | 'precipProb';

export interface GridData {
  spec: GridSpec;
  times: number[];
  /** values[var][cell][timeIndex] */
  values: Record<GridVar, Num[][]>;
}

/** Bilinear interpolation of one variable at one time; null outside the grid or next to a missing value. */
export function bilinear(d: GridData, v: GridVar, k: number, lat: number, lon: number): Num {
  const { nLat, nLon } = gridDims(d.spec);
  const fi = (lat - d.spec.latMin) / d.spec.step;
  const fj = (lon - d.spec.lonMin) / d.spec.step;
  if (fi < 0 || fj < 0 || fi > nLat - 1 || fj > nLon - 1) return null;
  const i0 = Math.min(Math.floor(fi), nLat - 2);
  const j0 = Math.min(Math.floor(fj), nLon - 2);
  const ti = fi - i0;
  const tj = fj - j0;
  const at = (i: number, j: number) => d.values[v][i * nLon + j]?.[k] ?? null;
  const a = at(i0, j0);
  const b = at(i0, j0 + 1);
  const c = at(i0 + 1, j0);
  const e = at(i0 + 1, j0 + 1);
  if (a == null || b == null || c == null || e == null) return null;
  return a * (1 - ti) * (1 - tj) + b * (1 - ti) * tj + c * ti * (1 - tj) + e * ti * tj;
}

/** Band-only corridor for one cell along a bearing, interpolated from the grid. */
export function cellCorridor(d: GridData, lat: number, lon: number, bearing: number): CorridorSeries {
  const n = d.times.length;
  const dists = [...SAMPLE_POINTS.canvas, ...SAMPLE_POINTS.corridor];
  const points: PointSeries[] = dists.map((dist) => {
    const p = destination({ lat, lon }, bearing, dist);
    const series = (v: GridVar) => Array.from({ length: n }, (_, k) => bilinear(d, v, k, p.lat, p.lon));
    const nul = () => Array<Num>(n).fill(null);
    return {
      distanceKm: dist,
      role: (SAMPLE_POINTS.canvas as readonly number[]).includes(dist) ? 'canvas' : 'corridor',
      lat: p.lat,
      lon: p.lon,
      elevationM: null,
      cloudCover: series('total'),
      low: series('low'),
      mid: series('mid'),
      high: series('high'),
      precip: Array<Num>(n).fill(0),
      precipProb: series('precipProb'),
      rh: nul(),
      visibilityM: nul(),
      levels: [],
    };
  });
  return { model: 'grid', times: d.times, points, hasLevels: false, fetchedAt: d.times[0] ?? 0 };
}

/** Simplified underlight score: 5 × canvas × reach × lit × rain (no aerosols / humidity in the grid). */
export function cellUnderlight(d: GridData, lat: number, lon: number, t: number, bearing: number): number {
  const m = scoreMoment(cellCorridor(d, lat, lon, bearing), t, { observerElevKm: 0, air: null });
  if (m.overcastAll) return 0;
  return Math.max(0, Math.min(5, 5 * m.canvas * m.reach * m.lit * m.rain));
}

/** Darkness × clear sky for the dark-sky map (0..1). */
export function darkSky(lat: number, lon: number, t: number, total: Num): Num {
  if (total == null) return null;
  const alt = sunAltitude(t, lat, lon);
  const darkness = Math.max(0, Math.min(1, (-alt - 12) / 6));
  const moon = 1 - Math.min(1, moonBrightness(moonState(t, lat, lon)));
  return darkness * moon * (1 - total / 100);
}

const LAYER_META: Record<LayerId, { label: string; unit: string; scale: number; max: number }> = {
  'underlight-sunset': { label: 'Sunset underlight potential', unit: '0–5', scale: 50, max: 5 },
  'underlight-sunrise': { label: 'Sunrise underlight potential', unit: '0–5', scale: 50, max: 5 },
  'cloud-low': { label: 'Low cloud', unit: '%', scale: 2.5, max: 100 },
  'cloud-mid': { label: 'Mid cloud', unit: '%', scale: 2.5, max: 100 },
  'cloud-high': { label: 'High cloud', unit: '%', scale: 2.5, max: 100 },
  'cloud-total': { label: 'Total cloud', unit: '%', scale: 2.5, max: 100 },
  darksky: { label: 'Dark sky (darkness × clear sky)', unit: '0–1', scale: 250, max: 1 },
};

export function layerFile(id: LayerId, frames: Array<{ t: number; label: string; values: Num[] }>): MapLayerFile {
  const m = LAYER_META[id];
  const fr: MapFrame[] = frames.map((f) => ({ t: f.t, label: f.label, data: encodeBytes(Uint8Array.from(f.values.map((v) => quantise(v, m.scale)))) }));
  return { id, label: m.label, unit: m.unit, scale: m.scale, max: m.max, frames: fr };
}

/** All layers from fetched grid data. `dayStarts` are the UTC instants of local midnights for the day frames. */
export function computeLayers(d: GridData, dayStarts: number[], label: (t: number) => string, everyH = 3): MapLayerFile[] {
  const cells = cellCoords(d.spec);
  const frameIdx = d.times.map((t, k) => ({ t, k })).filter(({ t }) => Math.round(t / 3600000) % everyH === 0);
  const cloud = (id: LayerId, v: GridVar) =>
    layerFile(
      id,
      frameIdx.map(({ t, k }) => ({ t, label: label(t), values: cells.map((_, c) => d.values[v][c]?.[k] ?? null) })),
    );
  const dark = layerFile(
    'darksky',
    frameIdx.map(({ t, k }) => ({ t, label: label(t), values: cells.map((c, ci) => darkSky(c.lat, c.lon, t, d.values.total[ci]?.[k] ?? null)) })),
  );
  const underlight = (kind: 'sunset' | 'sunrise'): MapLayerFile =>
    layerFile(
      kind === 'sunset' ? 'underlight-sunset' : 'underlight-sunrise',
      dayStarts.map((ds) => {
        const values = cells.map((c) => {
          const ev = sunEvents(c.lat, c.lon, ds, ds + 86400000).find((e) => e.kind === kind);
          if (!ev || ev.centre < d.times[0]! || ev.centre > d.times[d.times.length - 1]!) return null;
          return cellUnderlight(d, c.lat, c.lon, ev.centre, ev.azimuth);
        });
        const mid = cells[Math.floor(cells.length / 2)]!;
        const ev = sunEvents(mid.lat, mid.lon, ds, ds + 86400000).find((e) => e.kind === kind);
        return { t: ev?.official ?? ds + 12 * 3600000, label: `${label(ds + 12 * 3600000).split(' ')[0]} ${kind}`, values };
      }),
    );
  return [
    underlight('sunset'),
    underlight('sunrise'),
    cloud('cloud-low', 'low'),
    cloud('cloud-mid', 'mid'),
    cloud('cloud-high', 'high'),
    cloud('cloud-total', 'total'),
    dark,
  ];
}
