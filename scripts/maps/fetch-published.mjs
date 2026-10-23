// Copies the currently published map grids into a directory so a code-only deploy keeps them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [site, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
try {
  const res = await fetch(`${site}/maps/index.json`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const index = await res.json();
  writeFileSync(join(out, 'index.json'), JSON.stringify(index));
  let n = 0;
  for (const f of index.files ?? []) {
    const r = await fetch(`${site}/maps/${f}`);
    if (!r.ok) continue;
    writeFileSync(join(out, f), Buffer.from(await r.arrayBuffer()));
    n++;
  }
  console.log(`Reused ${n} published grid files`);
} catch (e) {
  console.log(`No published grids to reuse (${e.message}); the map will show "no data" until the next scheduled run.`);
  writeFileSync(join(out, 'index.json'), JSON.stringify({ version: 1, generatedAt: null, files: [] }));
}
