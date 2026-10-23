/**
 * Scheduled map precompute (run by .github/workflows/maps.yml every 3 h).
 *   npx tsx scripts/maps/precompute.ts --out maps-out [--bbox latMin,latMax,lonMin,lonMax] [--step 0.25] [--max-calls 3000]
 * Fetches the grid in multi-coordinate batches, logs the call cost, aborts above the budget, and writes
 * index.json plus one JSON file per layer.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALPS, cellCoords, computeLayers, gridDims, type GridData, type GridSpec, type GridVar } from '../../src/maps/grid';
import type { MapIndex } from '../../src/maps/format';
import { ENDPOINTS, estimateUrl } from '../../src/data/openmeteo';
import { fetchJson } from '../../src/data/http';
import { ENGINE_VERSION } from '../../src/engine/config';
import { addLocalDays, formatTime, localParts, startOfLocalDay } from '../../src/engine/time';
import type { Num } from '../../src/engine/types';

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const VARS: Array<[GridVar, string]> = [
  ['total', 'cloud_cover'],
  ['low', 'cloud_cover_low'],
  ['mid', 'cloud_cover_mid'],
  ['high', 'cloud_cover_high'],
  ['precipProb', 'precipitation_probability'],
];
const BATCH = 100;
const TZ = 'Europe/Zurich';

export function gridUrl(cells: Array<{ lat: number; lon: number }>): string {
  const u = new URL(ENDPOINTS.forecast);
  u.searchParams.set('latitude', cells.map((c) => c.lat.toFixed(3)).join(','));
  u.searchParams.set('longitude', cells.map((c) => c.lon.toFixed(3)).join(','));
  u.searchParams.set('hourly', VARS.map((v) => v[1]).join(','));
  u.searchParams.set('models', 'best_match');
  u.searchParams.set('timeformat', 'unixtime');
  u.searchParams.set('forecast_days', '3');
  return u.toString();
}

async function main() {
  const out = arg('out') ?? 'maps-out';
  const bbox = arg('bbox')?.split(',').map(Number);
  const spec: GridSpec = bbox && bbox.length === 4 ? { latMin: bbox[0]!, latMax: bbox[1]!, lonMin: bbox[2]!, lonMax: bbox[3]!, step: Number(arg('step') ?? 0.25) } : { ...ALPS, step: Number(arg('step') ?? ALPS.step) };
  const maxCalls = Number(arg('max-calls') ?? 3000);
  const cells = cellCoords(spec);
  const batches: Array<typeof cells> = [];
  for (let i = 0; i < cells.length; i += BATCH) batches.push(cells.slice(i, i + BATCH));
  const urls = batches.map(gridUrl);
  const cost = urls.reduce((a, u) => a + estimateUrl(u).calls, 0);
  console.log(`Grid ${gridDims(spec).nLat}×${gridDims(spec).nLon} = ${cells.length} cells in ${urls.length} requests, estimated ${cost} calls`);
  if (cost > maxCalls) {
    console.error(`Aborting: estimated ${cost} calls exceeds the ${maxCalls}-call budget per run`);
    process.exit(2);
  }

  const values = Object.fromEntries(VARS.map(([k]) => [k, [] as Num[][]])) as GridData['values'];
  let times: number[] = [];
  for (let b = 0; b < urls.length; b++) {
    const json = (await fetchJson(urls[b]!, { retries: 5, baseDelayMs: 5000, timeoutMs: 60000 })) as Array<{ hourly: Record<string, unknown[]> }>;
    const locs = Array.isArray(json) ? json : [json];
    if (locs.length !== batches[b]!.length) throw new Error(`Batch ${b}: expected ${batches[b]!.length} locations, got ${locs.length}`);
    for (const loc of locs) {
      const h = loc.hourly;
      const t = (h.time as number[]).map((x) => x * 1000);
      if (!times.length) times = t;
      for (const [k, name] of VARS) values[k].push(times.map((_, i) => (typeof h[name]?.[i] === 'number' ? (h[name]![i] as number) : null)));
    }
    console.log(`  batch ${b + 1}/${urls.length} ok`);
    // stay well under 600 calls/minute
    if (b < urls.length - 1) await new Promise((r) => setTimeout(r, 12000));
  }

  const data: GridData = { spec, times, values };
  const first = startOfLocalDay(times[0]!, TZ);
  const dayStarts = [0, 1, 2, 3].map((k) => addLocalDays(first, k, TZ)).filter((d) => d < times[times.length - 1]!);
  const label = (t: number) => {
    const p = localParts(t, TZ);
    return `${p.day}.${p.month}. ${formatTime(t, TZ)}`;
  };
  const layers = computeLayers(data, dayStarts, label);
  mkdirSync(out, { recursive: true });
  const files: string[] = [];
  for (const l of layers) {
    const f = `${l.id}.json`;
    writeFileSync(join(out, f), JSON.stringify(l));
    files.push(f);
  }
  const { nLat, nLon } = gridDims(spec);
  const index: MapIndex = {
    version: 1,
    generatedAt: new Date().toISOString(),
    engineVersion: ENGINE_VERSION,
    bbox: { latMin: spec.latMin, latMax: spec.latMax, lonMin: spec.lonMin, lonMax: spec.lonMax },
    step: spec.step,
    nLat,
    nLon,
    calls: cost,
    layers: layers.map((l) => ({ id: l.id, label: l.label, file: `${l.id}.json`, frames: l.frames.length })),
    files,
  };
  writeFileSync(join(out, 'index.json'), JSON.stringify(index));
  console.log(`Wrote ${files.length} layers (${layers.reduce((a, l) => a + l.frames.length, 0)} frames) to ${out}; cost ~${cost} calls`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
