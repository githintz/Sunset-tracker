/**
 * Full location refresh: elevation profile → corridors (2 models × sunset/sunrise bearings) → observer
 * column → aerosols. Every request goes through the 60-minute cache; on failure we fall back to the last
 * cached copy (any age) and mark the result stale.
 */
import { BUDGET, PRESSURE_LEVELS } from '../engine/config';
import { sunEvents } from '../engine/solar';
import type { ForecastInputs, BearingData } from '../engine/forecast';
import type { Num, Observer } from '../engine/types';
import { isValidTimeZone } from '../engine/time';
import { recordCalls, callsToday } from './budget';
import { hashKey, readCache, type KV } from './cache';
import { corridorPoints, profilePoints, PROFILE_DISTANCES, type SamplePoint } from './geometry';
import { fetchJson, HttpError, type FetchOptions } from './http';
import {
  buildAirUrl,
  buildCorridorUrl,
  buildElevationUrl,
  buildObserverUrl,
  estimateUrl,
  MODEL_A,
  MODEL_B_CANDIDATES,
  MODEL_B_LEVELS,
  parseAir,
  parseCorridor,
  parseElevation,
  parseObserver,
  toProfile,
  type CorridorRequest,
} from './openmeteo';

export interface Spot {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** User-entered viewpoint altitude (m), overrides the DEM. */
  elevationOverrideM: number | null;
  timezone: string | null;
}

export type RequestKind = 'elevation' | 'corridorA-sunset' | 'corridorA-sunrise' | 'corridorB-sunset' | 'corridorB-sunrise' | 'observer' | 'air';

export interface RequestLog {
  kind: RequestKind;
  url: string;
  calls: number;
  source: 'network' | 'cache' | 'stale-cache' | 'failed';
  error?: string;
  savedAt?: number;
}

export interface LoadStatus {
  stale: boolean;
  /** Age of the oldest data used (minutes). */
  ageMin: number;
  errors: string[];
  /** Estimated calls spent on the network in this refresh. */
  calls: number;
  /** Estimated calls the full refresh would cost without any cache. */
  fullCost: number;
  callsToday: number;
  requests: RequestLog[];
  modelB: string | null;
}

export interface LoadResult {
  inputs: ForecastInputs;
  status: LoadStatus;
}

export interface PipelineDeps {
  kv: KV;
  fetchOptions?: FetchOptions;
  force?: boolean;
  pastDays?: number;
  /** Called with every raw response (fixture recorder). */
  onResponse?: (kind: RequestKind, url: string, json: unknown) => void;
  log?: (msg: string) => void;
}

const HOUR = 3600000;

/** Bearings for the next sunset and next sunrise (rounded to 0.5° so cache keys stay stable). */
export function eventBearings(lat: number, lon: number, now: number): { sunset: number | null; sunrise: number | null } {
  const evs = sunEvents(lat, lon, now - HOUR, now + 72 * HOUR);
  const r = (x: number | undefined) => (x == null ? null : Math.round(x * 2) / 2);
  return { sunset: r(evs.find((e) => e.kind === 'sunset')?.azimuth), sunrise: r(evs.find((e) => e.kind === 'sunrise')?.azimuth) };
}

async function cachedJson(kind: RequestKind, url: string, now: number, deps: PipelineDeps, logs: RequestLog[]): Promise<{ json: unknown; savedAt: number } | null> {
  const key = `om:${hashKey(url)}`;
  const est = estimateUrl(url).calls;
  const cached = await readCache(deps.kv, key);
  if (cached && cached.url === url && !deps.force && now - cached.savedAt < BUDGET.cacheMinutes * 60000) {
    logs.push({ kind, url, calls: 0, source: 'cache', savedAt: cached.savedAt });
    return { json: cached.data, savedAt: cached.savedAt };
  }
  try {
    const json = await fetchJson(url, deps.fetchOptions);
    deps.onResponse?.(kind, url, json);
    await deps.kv.set(key, { v: 1, savedAt: now, url, data: json }).catch(() => undefined);
    logs.push({ kind, url, calls: est, source: 'network', savedAt: now });
    deps.log?.(`[open-meteo] ${kind}: ~${est} calls`);
    return { json, savedAt: now };
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : String((e as Error).message ?? e);
    if (cached && cached.url === url) {
      logs.push({ kind, url, calls: 0, source: 'stale-cache', error: msg, savedAt: cached.savedAt });
      return { json: cached.data, savedAt: cached.savedAt };
    }
    logs.push({ kind, url, calls: 0, source: 'failed', error: msg });
    if (e instanceof HttpError && e.status === 400) throw e;
    return null;
  }
}

export async function loadForecast(spot: Spot, now: number, deps: PipelineDeps): Promise<LoadResult> {
  const logs: RequestLog[] = [];
  const errors: string[] = [];
  const bearings = eventBearings(spot.lat, spot.lon, now);
  const pastDays = deps.pastDays;

  // ---- elevation profile for both bearings (one request, ≤100 coordinates)
  const prof = (b: number | null) => (b == null ? [] : profilePoints(spot, b));
  const sunsetProf = prof(bearings.sunset);
  const sunriseProf = prof(bearings.sunrise);
  const coords = [{ lat: spot.lat, lon: spot.lon }, ...sunsetProf, ...sunriseProf];
  let elevations: Num[] = Array(coords.length).fill(null);
  try {
    const url = buildElevationUrl(coords);
    const r = await cachedJson('elevation', url, now, deps, logs);
    if (r) elevations = parseElevation(r.json, coords.length);
    else errors.push('Terrain elevation unavailable');
  } catch (e) {
    errors.push(`Terrain elevation: ${(e as Error).message}`);
  }
  const demM = elevations[0] ?? null;
  const sunsetElev = elevations.slice(1, 1 + sunsetProf.length);
  const sunriseElev = elevations.slice(1 + sunsetProf.length);
  const elevAt = (profElev: Num[], d: number) => profElev[PROFILE_DISTANCES.indexOf(d)] ?? null;

  // ---- corridor requests
  const withElev = (pts: SamplePoint[], profElev: Num[]) => pts.map((p) => ({ ...p, elevationM: elevAt(profElev, p.distanceKm) }));
  const corridorFor = async (kind: 'sunset' | 'sunrise', bearing: number | null, profElev: Num[]): Promise<BearingData | null> => {
    if (bearing == null) return null;
    const pts = withElev(corridorPoints(spot, bearing), profElev);
    const reqA: CorridorRequest = { points: pts, model: MODEL_A, levels: PRESSURE_LEVELS, pastDays };
    let A = null;
    try {
      const r = await cachedJson(`corridorA-${kind}`, buildCorridorUrl(reqA), now, deps, logs);
      if (r) A = parseCorridor(r.json, reqA, r.savedAt);
      else errors.push(`Primary model (${kind}) unavailable`);
    } catch (e) {
      errors.push(`Primary model (${kind}): ${(e as Error).message}`);
    }
    let B = null;
    for (const model of MODEL_B_CANDIDATES) {
      const reqB: CorridorRequest = { points: pts.filter((p) => p.role !== 'chart'), model, levels: MODEL_B_LEVELS, pastDays };
      try {
        const r = await cachedJson(`corridorB-${kind}`, buildCorridorUrl(reqB), now, deps, logs);
        if (r) B = parseCorridor(r.json, reqB, r.savedAt);
        break;
      } catch (e) {
        if (e instanceof HttpError && e.status === 400) continue; // model refused: try the fallback model
        errors.push(`Second model (${kind}): ${(e as Error).message}`);
        break;
      }
    }
    if (!B) errors.push(`Second model (${kind}) unavailable — only one forecast available`);
    return { bearing, A, B, profile: toProfile(bearing, PROFILE_DISTANCES, profElev) };
  };

  const [sunset, sunrise, obsR, airR] = await Promise.all([
    corridorFor('sunset', bearings.sunset, sunsetElev),
    corridorFor('sunrise', bearings.sunrise, sunriseElev),
    cachedJson('observer', buildObserverUrl(spot.lat, spot.lon, spot.elevationOverrideM ?? demM, { pastDays }), now, deps, logs).catch((e) => {
      errors.push(`Viewpoint forecast: ${(e as Error).message}`);
      return null;
    }),
    cachedJson('air', buildAirUrl(spot.lat, spot.lon, { pastDays }), now, deps, logs).catch((e) => {
      errors.push(`Air quality: ${(e as Error).message}`);
      return null;
    }),
  ]);

  let obs = null;
  let tzFromApi: string | null = null;
  let modelElev: number | null = null;
  if (obsR) {
    try {
      const p = parseObserver(obsR.json);
      obs = p.series;
      tzFromApi = p.timezone;
      modelElev = p.modelElevationM;
    } catch (e) {
      errors.push(`Viewpoint forecast: ${(e as Error).message}`);
    }
  } else errors.push('Viewpoint forecast unavailable');
  let air = null;
  if (airR) {
    try {
      air = parseAir(airR.json);
    } catch (e) {
      errors.push(`Air quality: ${(e as Error).message}`);
    }
  } else errors.push('Air-quality data unavailable');

  const tzCandidate = spot.timezone ?? tzFromApi ?? 'UTC';
  const timezone = isValidTimeZone(tzCandidate) ? tzCandidate : 'UTC';
  const elevationM = spot.elevationOverrideM ?? demM ?? modelElev ?? 0;
  const observer: Observer = {
    lat: spot.lat,
    lon: spot.lon,
    elevationM,
    elevationOverride: spot.elevationOverrideM != null,
    timezone,
    name: spot.name,
  };

  const used = logs.filter((l) => l.savedAt != null);
  const oldest = used.length ? Math.min(...used.map((l) => l.savedAt!)) : now;
  const stale = logs.some((l) => l.source === 'stale-cache');
  const calls = logs.reduce((a, l) => a + l.calls, 0);
  const fullCost = logs.filter((l) => l.source !== 'failed').reduce((a, l) => a + estimateUrl(l.url).calls, 0);
  const today = calls > 0 ? await recordCalls(deps.kv, calls, now) : await callsToday(deps.kv, now);
  deps.log?.(`[open-meteo] refresh used ~${Math.round(calls * 10) / 10} calls (full refresh ~${Math.round(fullCost * 10) / 10}); today ~${today}`);

  return {
    inputs: { observer, now, sunset, sunrise, air, obs, fetchedAt: oldest, staleRun: stale },
    status: {
      stale,
      ageMin: Math.round((now - oldest) / 60000),
      errors: [...new Set(errors)],
      calls,
      fullCost,
      callsToday: today,
      requests: logs,
      modelB: sunset?.B?.model ?? sunrise?.B?.model ?? null,
    },
  };
}
