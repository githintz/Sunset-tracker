/** Engine-facing data model. The data layer converts Open-Meteo responses into these shapes. */

export type Num = number | null;

export interface LevelSeries {
  hPa: number;
  /** Cloud cover at the level, %. */
  cover: Num[];
  /** Geopotential height, m above sea level. */
  heightM: Num[];
}

export type PointRole = 'canvas' | 'corridor' | 'chart';

export interface PointSeries {
  distanceKm: number;
  role: PointRole;
  lat: number;
  lon: number;
  /** Ground elevation (DEM), m. Null if unknown. */
  elevationM: Num;
  cloudCover: Num[];
  low: Num[];
  mid: Num[];
  high: Num[];
  precip: Num[];
  precipProb: Num[];
  rh: Num[];
  visibilityM: Num[];
  levels: LevelSeries[];
  /** Surface pressure (hPa); levels with higher pressure are below the model's ground. Optional. */
  surfacePressure?: Num[];
}

export interface CorridorSeries {
  model: string;
  /** Unix ms, hourly. */
  times: number[];
  points: PointSeries[];
  /** True if the model delivered pressure-level cloud data at all. */
  hasLevels: boolean;
  fetchedAt: number;
}

export interface ObserverSeries {
  times: number[];
  cloudCover: Num[];
  low: Num[];
  mid: Num[];
  high: Num[];
  precip: Num[];
  showers: Num[];
  cape: Num[];
  liftedIndex: Num[];
  sunshineS: Num[];
  directRad: Num[];
  visibilityM: Num[];
  dewPoint: Num[];
  temp: Num[];
  rh: Num[];
  wind: Num[];
  gusts: Num[];
  snowDepth: Num[];
  weatherCode: Num[];
}

export interface AirSeries {
  times: number[];
  aod: Num[];
  dust: Num[];
}

export interface TerrainSample {
  distanceKm: number;
  elevationM: Num;
}

export interface TerrainProfile {
  /** Bearing the profile was sampled along (deg). Negative distances are behind the observer. */
  bearing: number;
  samples: TerrainSample[];
}

export interface Observer {
  lat: number;
  lon: number;
  /** Effective viewpoint altitude, m (user override > DEM > 0). */
  elevationM: number;
  /** True if the elevation came from a user override. */
  elevationOverride: boolean;
  timezone: string;
  name: string;
}

export type Verdict = 0 | 1 | 2 | 3 | 4;

export type ReasonKind = 'main' | 'support' | 'risk' | 'info';

export interface Reason {
  kind: ReasonKind;
  /** Stable machine code for tests/analytics. */
  code: string;
  text: string;
}
