/** Saved spots (name, coordinates, optional viewpoint altitude) persisted in the KV store. */
import type { KV } from '../data/cache';
import type { Spot } from '../data/pipeline';

const KEY = 'spots:v1';
const ACTIVE = 'spots:active';

export function isSpot(x: unknown): x is Spot {
  const s = x as Spot;
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    Number.isFinite(s.lat) &&
    Number.isFinite(s.lon) &&
    Math.abs(s.lat) <= 90 &&
    Math.abs(s.lon) <= 180 &&
    (s.elevationOverrideM === null || Number.isFinite(s.elevationOverrideM)) &&
    (s.timezone === null || typeof s.timezone === 'string')
  );
}

export async function loadSpots(kv: KV): Promise<Spot[]> {
  try {
    const raw = await kv.get(KEY);
    return Array.isArray(raw) ? raw.filter(isSpot) : [];
  } catch {
    return [];
  }
}

export async function saveSpots(kv: KV, spots: Spot[]): Promise<void> {
  await kv.set(KEY, spots);
}

export async function loadActiveId(kv: KV): Promise<string | null> {
  const v = await kv.get(ACTIVE).catch(() => null);
  return typeof v === 'string' ? v : null;
}

export async function saveActiveId(kv: KV, id: string | null): Promise<void> {
  await kv.set(ACTIVE, id);
}

export function newSpotId(lat: number, lon: number): string {
  return `s-${lat.toFixed(4)}-${lon.toFixed(4)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeSpot(name: string, lat: number, lon: number, timezone: string | null = null, elevationOverrideM: number | null = null): Spot {
  return { id: newSpotId(lat, lon), name: name.trim() || `${lat.toFixed(3)}, ${lon.toFixed(3)}`, lat, lon, timezone, elevationOverrideM };
}

/** Parse a shared spot link: "#/today?spot=47.37,8.54&name=Zürich&alt=2770&tz=Europe/Zurich". */
export function spotFromLink(hash: string): Spot | null {
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  const raw = q.get('spot');
  if (!raw) return null;
  const [la, lo] = raw.split(',').map(Number);
  if (la == null || lo == null || !Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
  const alt = q.get('alt');
  const a = alt == null || alt === '' ? null : Number(alt);
  const tz = q.get('tz');
  return makeSpot(q.get('name') ?? '', la, lo, tz && tz.length < 64 ? tz : null, a != null && Number.isFinite(a) ? a : null);
}

export function spotLink(base: string, s: Spot): string {
  const q = new URLSearchParams({ spot: `${s.lat.toFixed(4)},${s.lon.toFixed(4)}`, name: s.name });
  if (s.elevationOverrideM != null) q.set('alt', String(Math.round(s.elevationOverrideM)));
  return `${base}#/today?${q.toString()}`;
}
