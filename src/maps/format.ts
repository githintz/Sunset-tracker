/** Shared format of the precomputed map grids (written by scripts/maps/precompute.ts, read by the Maps screen). */

export type LayerId = 'underlight-sunset' | 'underlight-sunrise' | 'cloud-low' | 'cloud-mid' | 'cloud-high' | 'cloud-total' | 'darksky';

export interface MapFrame {
  /** Representative time (ms). For underlight frames: local-day noon of that day at the grid centre. */
  t: number;
  label: string;
  /** base64 of a Uint8Array, row-major from the southernmost row; 255 = no data. */
  data: string;
}

export interface MapLayerFile {
  id: LayerId;
  label: string;
  unit: string;
  /** value = byte / scale */
  scale: number;
  max: number;
  frames: MapFrame[];
}

export interface MapIndex {
  version: 1;
  generatedAt: string | null;
  engineVersion?: string;
  bbox?: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  step?: number;
  nLat?: number;
  nLon?: number;
  calls?: number;
  layers?: Array<{ id: LayerId; label: string; file: string; frames: number }>;
  files: string[];
}

export const NO_DATA = 255;

export function encodeBytes(a: Uint8Array): string {
  let s = '';
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s);
}

export function decodeBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function quantise(v: number | null, scale: number): number {
  if (v == null || !Number.isFinite(v)) return NO_DATA;
  return Math.max(0, Math.min(254, Math.round(v * scale)));
}

/** Colour ramp for a 0..1 value (dark purple → orange → pale yellow). */
export function ramp(f: number): [number, number, number] {
  const stops: Array<[number, [number, number, number]]> = [
    [0, [40, 30, 70]],
    [0.35, [120, 60, 140]],
    [0.6, [230, 90, 60]],
    [0.8, [255, 160, 60]],
    [1, [255, 236, 150]],
  ];
  const x = Math.max(0, Math.min(1, f));
  for (let i = 1; i < stops.length; i++) {
    const [b, cb] = stops[i]!;
    const [a, ca] = stops[i - 1]!;
    if (x <= b) {
      const t = (x - a) / (b - a);
      return [0, 1, 2].map((k) => Math.round(ca[k]! + (cb[k]! - ca[k]!) * t)) as [number, number, number];
    }
  }
  return stops[stops.length - 1]![1];
}
