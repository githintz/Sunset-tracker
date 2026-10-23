/** Refresh = load data (cache/network) → compute forecast → persist last result + history. */
import type { KV } from '../data/cache';
import { loadForecast, type LoadStatus, type Spot } from '../data/pipeline';
import { computeForecast, type ForecastInputs, type LocationForecast } from '../engine/forecast';
import { ENGINE_VERSION } from '../engine/config';
import { loadHistory, mergeForecast, saveHistory } from './history';

export interface StoredForecast {
  engineVersion: string;
  forecast: LocationForecast;
  /** Raw model series behind the forecast (cross-section chart, offline use). */
  inputs: ForecastInputs | null;
  status: LoadStatus;
  savedAt: number;
}

const lastKey = (spotId: string) => `last:${spotId}`;

export async function loadLast(kv: KV, spotId: string): Promise<StoredForecast | null> {
  try {
    const v = (await kv.get(lastKey(spotId))) as StoredForecast | null;
    if (!v || typeof v !== 'object' || !v.forecast || !Array.isArray(v.forecast.events)) return null;
    return v;
  } catch {
    return null;
  }
}

export async function refresh(kv: KV, spot: Spot, now: number, opts: { force?: boolean } = {}): Promise<StoredForecast> {
  const { inputs, status } = await loadForecast(spot, now, { kv, force: opts.force, log: (m) => console.info(m) });
  const forecast = computeForecast(inputs);
  const stored: StoredForecast = { engineVersion: ENGINE_VERSION, forecast, inputs, status, savedAt: now };
  // Only persist forecasts that contain real data.
  if (inputs.sunset?.A || inputs.sunrise?.A || inputs.obs) {
    await kv.set(lastKey(spot.id), stored).catch(() => undefined);
    const h = await loadHistory(kv);
    await saveHistory(kv, mergeForecast(h, spot.id, forecast, now)).catch(() => undefined);
  }
  return stored;
}
