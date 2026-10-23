/**
 * Forecast history. Each sunrise/sunset keeps the forecast as issued (with the engine version that produced
 * it). While the event is in the future a newer forecast replaces the stored one; once the event has passed
 * the entry is frozen — stored forecasts are never re-scored. The user can rate what actually happened.
 */
import type { KV } from '../data/cache';
import type { EventRating } from '../engine/event';
import type { LocationForecast } from '../engine/forecast';

export interface UserRating {
  sunset: number | null;
  golden: number | null;
  sky: number | null;
  note: string;
  ratedAt: number;
}

export interface HistoryEntry {
  id: string;
  spotId: string;
  spotName: string;
  timezone: string;
  kind: 'sunrise' | 'sunset';
  official: number;
  issuedAt: number;
  engineVersion: string;
  rating: number | null;
  modelBScore: number | null;
  golden: number | null;
  goldenLabel: string;
  sky: string;
  verdict: string;
  confidence: string;
  mainReason: string;
  user: UserRating | null;
}

const KEY = 'history:v1';
const MAX = 500;

export function entryFrom(spotId: string, f: LocationForecast, r: EventRating): HistoryEntry {
  return {
    id: `${spotId}:${r.kind}:${r.official}`,
    spotId,
    spotName: f.observer.name,
    timezone: f.observer.timezone,
    kind: r.kind,
    official: r.official,
    issuedAt: f.computedAt,
    engineVersion: r.engineVersion,
    rating: r.rating,
    modelBScore: r.modelB ? Math.round(r.modelB.score * 10) / 10 : null,
    golden: r.golden.score == null ? null : Math.round(r.golden.score * 10) / 10,
    goldenLabel: r.golden.label,
    sky: r.sky.label,
    verdict: r.verdictLabel,
    confidence: r.confidence,
    mainReason: r.reasons.find((x) => x.kind === 'main')?.text ?? '',
    user: null,
  };
}

export function isEntry(x: unknown): x is HistoryEntry {
  const e = x as HistoryEntry;
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof e.id === 'string' &&
    typeof e.spotId === 'string' &&
    (e.kind === 'sunrise' || e.kind === 'sunset') &&
    Number.isFinite(e.official) &&
    typeof e.engineVersion === 'string'
  );
}

export async function loadHistory(kv: KV): Promise<HistoryEntry[]> {
  try {
    const raw = await kv.get(KEY);
    return Array.isArray(raw) ? raw.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** Merge newly issued forecasts into history, respecting the freeze rule. */
export function mergeForecast(history: HistoryEntry[], spotId: string, f: LocationForecast, now: number): HistoryEntry[] {
  const byId = new Map(history.map((h) => [h.id, h]));
  for (const r of f.events) {
    if (r.rating == null) continue;
    const e = entryFrom(spotId, f, r);
    const prev = byId.get(e.id);
    if (prev && prev.official <= now) continue; // frozen: the event has happened
    if (prev && prev.issuedAt > e.issuedAt) continue;
    byId.set(e.id, { ...e, user: prev?.user ?? null });
  }
  return [...byId.values()].sort((a, b) => b.official - a.official).slice(0, MAX);
}

export async function saveHistory(kv: KV, h: HistoryEntry[]): Promise<void> {
  await kv.set(KEY, h);
}

export function rateEntry(history: HistoryEntry[], id: string, user: Omit<UserRating, 'ratedAt'>, now: number): HistoryEntry[] {
  return history.map((h) => (h.id === id ? { ...h, user: { ...user, ratedAt: now } } : h));
}

export interface ExportFile {
  app: 'glowcast';
  version: 1;
  exportedAt: string;
  spots: unknown[];
  history: HistoryEntry[];
}

export function exportJson(spots: unknown[], history: HistoryEntry[], now: number): string {
  const f: ExportFile = { app: 'glowcast', version: 1, exportedAt: new Date(now).toISOString(), spots, history };
  return JSON.stringify(f, null, 2);
}

export function parseImport(text: string): { spots: unknown[]; history: HistoryEntry[] } {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON');
  }
  const f = j as Partial<ExportFile>;
  if (!f || f.app !== 'glowcast' || f.version !== 1) throw new Error('Not a Glowcast export file');
  return { spots: Array.isArray(f.spots) ? f.spots : [], history: Array.isArray(f.history) ? f.history.filter(isEntry) : [] };
}

export function mergeImported(current: HistoryEntry[], incoming: HistoryEntry[]): HistoryEntry[] {
  const byId = new Map(current.map((h) => [h.id, h]));
  for (const h of incoming) {
    const prev = byId.get(h.id);
    byId.set(h.id, prev ? { ...prev, user: h.user ?? prev.user } : h);
  }
  return [...byId.values()].sort((a, b) => b.official - a.official).slice(0, MAX);
}
