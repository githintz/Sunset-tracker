/**
 * Records real Open-Meteo responses for a set of test spots into test/fixtures/<spot>/.
 * Unit and e2e tests replay these offline. Run where open-meteo.com is reachable (GitHub Actions does it
 * via .github/workflows/fixtures.yml when the dev sandbox can't).
 *
 *   npx tsx scripts/record-fixtures.ts [--now <ISO>]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { memoryKV } from '../src/data/cache';
import { loadForecast, type RequestKind, type Spot } from '../src/data/pipeline';
import { buildGeocodeUrl, estimateUrl } from '../src/data/openmeteo';
import { fetchJson } from '../src/data/http';

export const FIXTURE_SPOTS: Spot[] = [
  { id: 'zurich', name: 'Zürich', lat: 47.3769, lon: 8.5417, elevationOverrideM: null, timezone: null },
  { id: 'gornergrat', name: 'Gornergrat', lat: 46.0, lon: 7.75, elevationOverrideM: 2770, timezone: null },
  { id: 'tokyo', name: 'Tokyo', lat: 35.6762, lon: 139.6503, elevationOverrideM: null, timezone: null },
  { id: 'mid-atlantic', name: 'Mid-Atlantic', lat: 30.0, lon: -40.0, elevationOverrideM: null, timezone: null },
  { id: 'tromso', name: 'Tromsø', lat: 69.6492, lon: 18.9553, elevationOverrideM: null, timezone: null },
];

const root = join(process.cwd(), 'test', 'fixtures');

async function main() {
  const nowArg = process.argv.indexOf('--now');
  // Round to the hour so fixtures are reproducible.
  const now = nowArg > 0 ? Date.parse(process.argv[nowArg + 1]!) : Math.floor(Date.now() / 3600000) * 3600000;
  let total = 0;
  for (const spot of FIXTURE_SPOTS) {
    const dir = join(root, spot.id);
    mkdirSync(dir, { recursive: true });
    const requests: Array<{ kind: RequestKind; url: string; file: string; calls: number }> = [];
    const counts: Record<string, number> = {};
    const res = await loadForecast(spot, now, {
      kv: memoryKV(),
      fetchOptions: { retries: 4, baseDelayMs: 2000 },
      onResponse: (kind, url, json) => {
        counts[kind] = (counts[kind] ?? 0) + 1;
        const file = `${kind}${counts[kind]! > 1 ? `-${counts[kind]}` : ''}.json`;
        writeFileSync(join(dir, file), JSON.stringify(json));
        requests.push({ kind, url, file, calls: estimateUrl(url).calls });
      },
      log: (m) => console.log(`  ${spot.id} ${m}`),
    });
    total += res.status.calls;
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({ spot, now, recordedAt: new Date().toISOString(), errors: res.status.errors, modelB: res.status.modelB, requests }, null, 2),
    );
    console.log(`${spot.id}: ${requests.length} responses, ~${res.status.calls} calls, errors: ${res.status.errors.join('; ') || 'none'}`);
    // be polite to the free API (600 calls/min)
    await new Promise((r) => setTimeout(r, 15000));
  }
  const geoDir = join(root, 'geocoding');
  mkdirSync(geoDir, { recursive: true });
  for (const q of ['Zurich', 'Gornergrat', 'xqzv-no-such-place']) {
    const url = buildGeocodeUrl(q);
    writeFileSync(join(geoDir, `${q}.json`), JSON.stringify({ url, json: await fetchJson(url) }));
  }
  console.log(`Total ~${Math.round(total)} calls`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
