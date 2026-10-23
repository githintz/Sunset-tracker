/** Writes a small synthetic map-grid set to test/fixtures/maps for the e2e test (no network). */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellCoords, computeLayers, gridDims, type GridData } from '../../src/maps/grid';

const spec = { latMin: 45, latMax: 48, lonMin: 6, lonMax: 11, step: 1 };
const t0 = Date.parse('2026-10-23T00:00:00Z');
const times = Array.from({ length: 72 }, (_, i) => t0 + i * 3600000);
const cells = cellCoords(spec);
const v = (f: (lat: number, lon: number, k: number) => number) => cells.map((c) => times.map((_, k) => f(c.lat, c.lon, k)));
const data: GridData = {
  spec,
  times,
  values: {
    total: v((la, lo, k) => (50 + 40 * Math.sin(la + lo + k / 6)) | 0),
    low: v((la, lo, k) => (20 + 20 * Math.sin(lo + k / 5)) | 0),
    mid: v((la, lo, k) => (40 + 30 * Math.cos(la + k / 7)) | 0),
    high: v(() => 25),
    precipProb: v(() => 10),
  },
};
const out = join(process.cwd(), 'test', 'fixtures', 'maps');
mkdirSync(out, { recursive: true });
const layers = computeLayers(data, [t0, t0 + 86400000], (t) => new Date(t).toISOString().slice(5, 16).replace('T', ' '));
for (const l of layers) writeFileSync(join(out, `${l.id}.json`), JSON.stringify(l));
const { nLat, nLon } = gridDims(spec);
writeFileSync(
  join(out, 'index.json'),
  JSON.stringify({
    version: 1,
    generatedAt: new Date(t0).toISOString(),
    bbox: { latMin: spec.latMin, latMax: spec.latMax, lonMin: spec.lonMin, lonMax: spec.lonMax },
    step: spec.step,
    nLat,
    nLon,
    calls: 0,
    layers: layers.map((l) => ({ id: l.id, label: l.label, file: `${l.id}.json`, frames: l.frames.length })),
    files: layers.map((l) => `${l.id}.json`),
  }),
);
console.log('maps fixture written');
