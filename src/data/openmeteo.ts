/**
 * Open-Meteo request builders, cost estimates and response parsers.
 * Always timeformat=unixtime: we convert with the spot's IANA zone ourselves (ISO strings ignore DST
 * changes inside the range).
 */
import { BUDGET, PRESSURE_LEVELS } from '../engine/config';
import type { AirSeries, CorridorSeries, LevelSeries, Num, ObserverSeries, PointSeries, TerrainProfile } from '../engine/types';
import type { SamplePoint } from './geometry';

export const ENDPOINTS = {
  forecast: 'https://api.open-meteo.com/v1/forecast',
  airQuality: 'https://air-quality-api.open-meteo.com/v1/air-quality',
  elevation: 'https://api.open-meteo.com/v1/elevation',
  geocoding: 'https://geocoding-api.open-meteo.com/v1/search',
} as const;

export const MODEL_A = 'best_match';
/** ECMWF IFS HRES 9 km is on the free API; the 0.25° open-data run is the fallback if it is refused. */
export const MODEL_B_CANDIDATES = ['ecmwf_ifs', 'ecmwf_ifs025'] as const;
/** ECMWF publishes these levels only (no 950/900/800 hPa). */
export const MODEL_B_LEVELS = [1000, 925, 850, 700, 600, 500, 400, 300, 250, 200] as const;

export const CORRIDOR_SURFACE_VARS = [
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'precipitation',
  'precipitation_probability',
  'relative_humidity_2m',
  'visibility',
] as const;

export const OBSERVER_VARS = [
  'cloud_cover',
  'cloud_cover_low',
  'cloud_cover_mid',
  'cloud_cover_high',
  'precipitation',
  'showers',
  'cape',
  'lifted_index',
  'sunshine_duration',
  'direct_radiation',
  'visibility',
  'dew_point_2m',
  'temperature_2m',
  'relative_humidity_2m',
  'wind_speed_10m',
  'wind_gusts_10m',
  'snow_depth',
  'weather_code',
] as const;

export const AIR_VARS = ['aerosol_optical_depth', 'dust'] as const;

export function levelVars(levels: readonly number[]): string[] {
  return levels.flatMap((l) => [`cloud_cover_${l}hPa`, `geopotential_height_${l}hPa`]);
}

export const FORECAST_DAYS = 3;

export interface CallEstimate {
  locations: number;
  variables: number;
  days: number;
  calls: number;
}

/**
 * Open-Meteo counts each location as one call, scaled up fractionally beyond 10 variables or 14 days
 * (e.g. 34 variables = 3.4 calls per location).
 */
export function estimateCalls(locations: number, variables: number, days: number): CallEstimate {
  const perLoc = Math.max(1, variables / BUDGET.varsPerCall) * Math.max(1, days / BUDGET.daysPerCall);
  return { locations, variables, days, calls: Math.round(locations * perLoc * 100) / 100 };
}

/** Estimate from a built URL (used for logging every request). */
export function estimateUrl(url: string): CallEstimate {
  const u = new URL(url);
  if (u.pathname.endsWith('/elevation')) {
    // Assumption (documented): an elevation request costs one call regardless of its ≤100 coordinates.
    return { locations: (u.searchParams.get('latitude') ?? '').split(',').length, variables: 1, days: 0, calls: 1 };
  }
  if (u.hostname.startsWith('geocoding')) return { locations: 1, variables: 1, days: 0, calls: 1 };
  const locations = (u.searchParams.get('latitude') ?? '').split(',').filter(Boolean).length;
  const variables = (u.searchParams.get('hourly') ?? '').split(',').filter(Boolean).length;
  const days = Number(u.searchParams.get('forecast_days') ?? FORECAST_DAYS) + Number(u.searchParams.get('past_days') ?? 0);
  return estimateCalls(locations, variables, days);
}

const fmt = (x: number) => String(Math.round(x * 1e4) / 1e4);

export interface CorridorRequest {
  points: Array<SamplePoint & { elevationM: Num }>;
  model: string;
  levels: readonly number[];
  pastDays?: number;
  forecastDays?: number;
}

export function buildCorridorUrl(r: CorridorRequest): string {
  const u = new URL(ENDPOINTS.forecast);
  u.searchParams.set('latitude', r.points.map((p) => fmt(p.lat)).join(','));
  u.searchParams.set('longitude', r.points.map((p) => fmt(p.lon)).join(','));
  if (r.points.every((p) => p.elevationM != null)) u.searchParams.set('elevation', r.points.map((p) => String(Math.round(p.elevationM!))).join(','));
  u.searchParams.set('hourly', [...CORRIDOR_SURFACE_VARS, ...levelVars(r.levels)].join(','));
  u.searchParams.set('models', r.model);
  u.searchParams.set('timeformat', 'unixtime');
  u.searchParams.set('forecast_days', String(r.forecastDays ?? FORECAST_DAYS));
  if (r.pastDays) u.searchParams.set('past_days', String(r.pastDays));
  return u.toString();
}

export function buildObserverUrl(lat: number, lon: number, elevationM: Num, opts: { pastDays?: number; forecastDays?: number } = {}): string {
  const u = new URL(ENDPOINTS.forecast);
  u.searchParams.set('latitude', fmt(lat));
  u.searchParams.set('longitude', fmt(lon));
  if (elevationM != null) u.searchParams.set('elevation', String(Math.round(elevationM)));
  u.searchParams.set('hourly', OBSERVER_VARS.join(','));
  u.searchParams.set('models', MODEL_A);
  u.searchParams.set('timeformat', 'unixtime');
  u.searchParams.set('timezone', 'auto');
  u.searchParams.set('forecast_days', String(opts.forecastDays ?? FORECAST_DAYS));
  if (opts.pastDays) u.searchParams.set('past_days', String(opts.pastDays));
  return u.toString();
}

export function buildAirUrl(lat: number, lon: number, opts: { pastDays?: number; forecastDays?: number } = {}): string {
  const u = new URL(ENDPOINTS.airQuality);
  u.searchParams.set('latitude', fmt(lat));
  u.searchParams.set('longitude', fmt(lon));
  u.searchParams.set('hourly', AIR_VARS.join(','));
  u.searchParams.set('timeformat', 'unixtime');
  u.searchParams.set('forecast_days', String(opts.forecastDays ?? FORECAST_DAYS));
  if (opts.pastDays) u.searchParams.set('past_days', String(opts.pastDays));
  return u.toString();
}

export function buildElevationUrl(coords: Array<{ lat: number; lon: number }>): string {
  if (coords.length > 100) throw new Error('Elevation API accepts at most 100 coordinates per request');
  const u = new URL(ENDPOINTS.elevation);
  u.searchParams.set('latitude', coords.map((c) => fmt(c.lat)).join(','));
  u.searchParams.set('longitude', coords.map((c) => fmt(c.lon)).join(','));
  return u.toString();
}

export function buildGeocodeUrl(name: string, count = 8): string {
  const u = new URL(ENDPOINTS.geocoding);
  u.searchParams.set('name', name);
  u.searchParams.set('count', String(count));
  u.searchParams.set('language', 'en');
  u.searchParams.set('format', 'json');
  return u.toString();
}

// ------------------------------------------------------------------ parsing

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}

type Json = Record<string, unknown>;

const isObj = (x: unknown): x is Json => typeof x === 'object' && x !== null && !Array.isArray(x);

function numArray(x: unknown, n: number): Num[] {
  if (!Array.isArray(x)) return Array(n).fill(null);
  const out: Num[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = x[i];
    out[i] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return out;
}

function locations(json: unknown): Json[] {
  if (Array.isArray(json)) return json.filter(isObj);
  if (isObj(json)) {
    if (json.error === true) throw new DataError(String(json.reason ?? 'Open-Meteo error'));
    return [json];
  }
  throw new DataError('Unexpected response shape');
}

function hourlyBlock(loc: Json): { times: number[]; get: (name: string) => unknown } {
  const h = loc.hourly;
  if (!isObj(h) || !Array.isArray(h.time)) throw new DataError('Response has no hourly block');
  const times = (h.time as unknown[]).map((t) => (typeof t === 'number' ? t * 1000 : NaN));
  if (times.some((t) => !Number.isFinite(t))) throw new DataError('Hourly times must be unixtime numbers');
  const keys = Object.keys(h);
  return {
    times,
    // Single-model requests return plain names; multi-model ones suffix the model id.
    get: (name: string) => h[name] ?? h[keys.find((k) => k.startsWith(`${name}_`) && !/^\d/.test(k.slice(name.length + 1))) ?? ''],
  };
}

export function parseCorridor(json: unknown, req: CorridorRequest, fetchedAt: number): CorridorSeries {
  const locs = locations(json);
  if (locs.length !== req.points.length) throw new DataError(`Expected ${req.points.length} locations, got ${locs.length}`);
  let times: number[] | null = null;
  let anyLevel = false;
  const points: PointSeries[] = locs.map((loc, i) => {
    const meta = req.points[i]!;
    const hb = hourlyBlock(loc);
    if (!times) times = hb.times;
    const n = times.length;
    const levels: LevelSeries[] = req.levels.map((hPa) => {
      const cover = numArray(hb.get(`cloud_cover_${hPa}hPa`), n);
      const heightM = numArray(hb.get(`geopotential_height_${hPa}hPa`), n);
      if (cover.some((v) => v != null) && heightM.some((v) => v != null)) anyLevel = true;
      return { hPa, cover, heightM };
    });
    return {
      distanceKm: meta.distanceKm,
      role: meta.role,
      lat: meta.lat,
      lon: meta.lon,
      elevationM: meta.elevationM ?? (typeof loc.elevation === 'number' ? loc.elevation : null),
      cloudCover: numArray(hb.get('cloud_cover'), n),
      low: numArray(hb.get('cloud_cover_low'), n),
      mid: numArray(hb.get('cloud_cover_mid'), n),
      high: numArray(hb.get('cloud_cover_high'), n),
      precip: numArray(hb.get('precipitation'), n),
      precipProb: numArray(hb.get('precipitation_probability'), n),
      rh: numArray(hb.get('relative_humidity_2m'), n),
      visibilityM: numArray(hb.get('visibility'), n),
      levels,
    };
  });
  return { model: req.model, times: times ?? [], points, hasLevels: anyLevel, fetchedAt };
}

export interface ObserverParsed {
  series: ObserverSeries;
  timezone: string | null;
  modelElevationM: number | null;
}

export function parseObserver(json: unknown): ObserverParsed {
  const loc = locations(json)[0];
  if (!loc) throw new DataError('Empty observer response');
  const hb = hourlyBlock(loc);
  const n = hb.times.length;
  const g = (k: string) => numArray(hb.get(k), n);
  return {
    series: {
      times: hb.times,
      cloudCover: g('cloud_cover'),
      low: g('cloud_cover_low'),
      mid: g('cloud_cover_mid'),
      high: g('cloud_cover_high'),
      precip: g('precipitation'),
      showers: g('showers'),
      cape: g('cape'),
      liftedIndex: g('lifted_index'),
      sunshineS: g('sunshine_duration'),
      directRad: g('direct_radiation'),
      visibilityM: g('visibility'),
      dewPoint: g('dew_point_2m'),
      temp: g('temperature_2m'),
      rh: g('relative_humidity_2m'),
      wind: g('wind_speed_10m'),
      gusts: g('wind_gusts_10m'),
      snowDepth: g('snow_depth'),
      weatherCode: g('weather_code'),
    },
    timezone: typeof loc.timezone === 'string' ? loc.timezone : null,
    modelElevationM: typeof loc.elevation === 'number' ? loc.elevation : null,
  };
}

export function parseAir(json: unknown): AirSeries {
  const loc = locations(json)[0];
  if (!loc) throw new DataError('Empty air-quality response');
  const hb = hourlyBlock(loc);
  return { times: hb.times, aod: numArray(hb.get('aerosol_optical_depth'), hb.times.length), dust: numArray(hb.get('dust'), hb.times.length) };
}

export function parseElevation(json: unknown, expected: number): Num[] {
  if (!isObj(json)) throw new DataError('Unexpected elevation response');
  if (json.error === true) throw new DataError(String(json.reason ?? 'Elevation error'));
  if (!Array.isArray(json.elevation)) throw new DataError('Elevation response has no elevation array');
  if (json.elevation.length !== expected) throw new DataError(`Expected ${expected} elevations, got ${json.elevation.length}`);
  // The DEM reports NaN for missing tiles; sea is 0.
  return numArray(json.elevation, expected);
}

export interface GeoResult {
  id: number;
  name: string;
  lat: number;
  lon: number;
  elevationM: number | null;
  timezone: string | null;
  country: string | null;
  admin1: string | null;
}

export function parseGeocode(json: unknown): GeoResult[] {
  if (!isObj(json)) throw new DataError('Unexpected geocoding response');
  if (json.error === true) throw new DataError(String(json.reason ?? 'Geocoding error'));
  if (!Array.isArray(json.results)) return [];
  return json.results.filter(isObj).flatMap((r) => {
    if (typeof r.latitude !== 'number' || typeof r.longitude !== 'number' || typeof r.name !== 'string') return [];
    return [
      {
        id: typeof r.id === 'number' ? r.id : 0,
        name: r.name,
        lat: r.latitude,
        lon: r.longitude,
        elevationM: typeof r.elevation === 'number' ? r.elevation : null,
        timezone: typeof r.timezone === 'string' ? r.timezone : null,
        country: typeof r.country === 'string' ? r.country : null,
        admin1: typeof r.admin1 === 'string' ? r.admin1 : null,
      },
    ];
  });
}

export function toProfile(bearing: number, distances: number[], elevations: Num[]): TerrainProfile {
  return { bearing, samples: distances.map((d, i) => ({ distanceKm: d, elevationM: elevations[i] ?? null })) };
}

export const DEFAULT_LEVELS = PRESSURE_LEVELS;
