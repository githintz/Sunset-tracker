// Fails CI if line or statement coverage of src/engine drops below 90 %.
import { readFileSync } from 'node:fs';

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
let lines = { covered: 0, total: 0 };
let statements = { covered: 0, total: 0 };
for (const [file, s] of Object.entries(summary)) {
  if (file === 'total' || !file.includes('/src/engine/')) continue;
  lines.covered += s.lines.covered;
  lines.total += s.lines.total;
  statements.covered += s.statements.covered;
  statements.total += s.statements.total;
}
const pct = (x) => (x.total ? (100 * x.covered) / x.total : 100);
console.log(`src/engine coverage: lines ${pct(lines).toFixed(1)} %, statements ${pct(statements).toFixed(1)} %`);
if (pct(lines) < 90 || pct(statements) < 90) {
  console.error('Coverage gate failed: src/engine must stay ≥ 90 %');
  process.exit(1);
}
