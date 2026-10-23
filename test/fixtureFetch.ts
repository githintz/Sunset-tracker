/** Replays recorded Open-Meteo responses: a fetch() that serves test/fixtures/<spot>/ by exact URL. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Spot } from '../src/data/pipeline';

export interface FixtureMeta {
  spot: Spot;
  now: number;
  recordedAt: string;
  errors: string[];
  modelB: string | null;
  requests: Array<{ kind: string; url: string; file: string; calls: number }>;
}

export const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures', import.meta.url));

export function fixtureSpots(): string[] {
  return readdirSync(FIXTURE_ROOT).filter((d) => existsSync(join(FIXTURE_ROOT, d, 'meta.json')));
}

export function loadMeta(spot: string): FixtureMeta {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, spot, 'meta.json'), 'utf8')) as FixtureMeta;
}

export function loadResponse(spot: string, file: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, spot, file), 'utf8'));
}

type Override = (url: string) => Response | null | undefined;

/** fetch() replaying one spot's fixtures; unknown URLs → 404. `override` can inject failures. */
export function fixtureFetch(spot: string, override?: Override): typeof fetch {
  const meta = loadMeta(spot);
  const byUrl = new Map(meta.requests.map((r) => [r.url, r.file]));
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const o = override?.(url);
    if (o) return o;
    const file = byUrl.get(url);
    if (!file) return new Response(JSON.stringify({ error: true, reason: `No fixture for ${url}` }), { status: 404 });
    return new Response(readFileSync(join(FIXTURE_ROOT, spot, file), 'utf8'), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}
