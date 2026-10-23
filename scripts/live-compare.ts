/**
 * Live comparison: rates the last 7 sunsets and sunrises at 5 spots with both models, using Open-Meteo's
 * archived past-days data, and checks the pipeline produces sane, varying results (not constant scores).
 *   npx tsx scripts/live-compare.ts [--out live-compare-output]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryKV } from '../src/data/cache';
import { loadForecast, type Spot } from '../src/data/pipeline';
import { computeForecast } from '../src/engine/forecast';
import { formatTime, localDayKey } from '../src/engine/time';
import { ENGINE_VERSION } from '../src/engine/config';

const SPOTS: Spot[] = [
  { id: 'zurich', name: 'Zürich', lat: 47.3769, lon: 8.5417, elevationOverrideM: null, timezone: null },
  { id: 'gornergrat', name: 'Gornergrat', lat: 46.0, lon: 7.75, elevationOverrideM: 2770, timezone: null },
  { id: 'tokyo', name: 'Tokyo', lat: 35.6762, lon: 139.6503, elevationOverrideM: null, timezone: null },
  { id: 'cape-town', name: 'Cape Town', lat: -33.9249, lon: 18.4241, elevationOverrideM: null, timezone: null },
  { id: 'denver', name: 'Denver', lat: 39.7392, lon: -104.9903, elevationOverrideM: null, timezone: null },
];

interface Row {
  spot: string;
  day: string;
  kind: string;
  time: string;
  modelA: number | null;
  modelB: number | null;
  rating: number | null;
  verdict: string;
  reason: string;
}

async function main() {
  const outI = process.argv.indexOf('--out');
  const out = outI > 0 ? process.argv[outI + 1]! : 'live-compare-output';
  const now = Math.floor(Date.now() / 3600000) * 3600000;
  const rows: Row[] = [];
  let calls = 0;
  for (const spot of SPOTS) {
    const r = await loadForecast(spot, now - 7 * 86400000, { kv: memoryKV(), pastDays: 7, fetchOptions: { retries: 4, baseDelayMs: 3000 } });
    calls += r.status.calls;
    if (r.status.errors.length) console.log(`${spot.id}: ${r.status.errors.join('; ')}`);
    const seen = new Set<string>();
    for (let k = 7; k >= 1; k--) {
      const inputs = { ...r.inputs, now: now - k * 86400000 };
      const f = computeForecast(inputs);
      for (const e of f.events) {
        const key = `${e.kind}-${e.official}`;
        if (seen.has(key) || e.official > now) continue;
        seen.add(key);
        rows.push({
          spot: spot.name,
          day: localDayKey(e.official, f.observer.timezone),
          kind: e.kind,
          time: formatTime(e.official, f.observer.timezone),
          modelA: e.event ? Math.round(e.event.score * 10) / 10 : null,
          modelB: e.modelB ? Math.round(e.modelB.score * 10) / 10 : null,
          rating: e.rating,
          verdict: e.verdictLabel,
          reason: e.reasons[0]?.text ?? '',
        });
      }
    }
    await new Promise((res) => setTimeout(res, 15000));
  }
  rows.sort((a, b) => a.spot.localeCompare(b.spot) || a.day.localeCompare(b.day) || a.kind.localeCompare(b.kind));
  const rated = rows.filter((r) => r.rating != null).map((r) => r.rating!);
  const distinct = new Set(rated.map((x) => x.toFixed(1))).size;
  const mean = rated.reduce((a, b) => a + b, 0) / Math.max(1, rated.length);
  const sd = Math.sqrt(rated.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rated.length));
  const both = rows.filter((r) => r.modelA != null && r.modelB != null);
  const agree = both.filter((r) => Math.abs(r.modelA! - r.modelB!) < 1).length;
  const summary = {
    engineVersion: ENGINE_VERSION,
    generatedAt: new Date(now).toISOString(),
    events: rows.length,
    rated: rated.length,
    distinctRatings: distinct,
    mean: Math.round(mean * 100) / 100,
    sd: Math.round(sd * 100) / 100,
    modelsAgreeWithin1: `${agree}/${both.length}`,
    estimatedCalls: Math.round(calls),
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'live-compare.json'), JSON.stringify({ summary, rows }, null, 2));
  const md = [
    `# Live comparison — last 7 days, ${SPOTS.length} spots`,
    '',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
    '',
    '| Spot | Day | Event | Time | Model A | Model B | Rating | Verdict | Main reason |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.spot} | ${r.day} | ${r.kind} | ${r.time} | ${r.modelA ?? '–'} | ${r.modelB ?? '–'} | ${r.rating ?? '–'} | ${r.verdict} | ${r.reason} |`),
  ].join('\n');
  writeFileSync(join(out, 'live-compare.md'), md);
  console.log(md);
  // Sanity: results must vary and stay in range
  if (rated.length < 30 || distinct < 8 || sd < 0.3) {
    console.error('Live comparison looks degenerate (too few or near-constant ratings)');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
