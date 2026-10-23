/**
 * Generates the original Glowcast icon set (a sun setting over a horizon) as PNGs + SVG.
 *   npx tsx scripts/gen-icons.ts
 * Writes public/icons/* and, when an Android project exists, its launcher/notification icons.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

type RGBA = [number, number, number, number];

const BG: RGBA = [20, 18, 31, 255];
const SUN_TOP: RGBA = [255, 196, 94, 255];
const SUN_BOTTOM: RGBA = [255, 107, 61, 255];
const LAND: RGBA = [59, 42, 92, 255];
const LAND2: RGBA = [38, 28, 64, 255];

const mix = (a: RGBA, b: RGBA, t: number): RGBA => [0, 1, 2, 3].map((i) => a[i]! + (b[i]! - a[i]!) * t) as RGBA;

/** Colour of the glyph at unit coordinates (0..1), `pad` = safe-zone padding for maskable icons. */
function shade(x: number, y: number, opts: { pad: number; transparentBg: boolean; mono: boolean }): RGBA {
  const { pad } = opts;
  const u = (x - pad) / (1 - 2 * pad);
  const v = (y - pad) / (1 - 2 * pad);
  const bg: RGBA = opts.transparentBg ? [0, 0, 0, 0] : BG;
  const horizon = 0.62;
  const cx = 0.5;
  const r = 0.27;
  const dx = u - cx;
  const dy = v - horizon;
  const d = Math.hypot(dx, dy);
  if (opts.mono) {
    // notification icon: white silhouette on transparent
    if (v >= horizon && v <= horizon + 0.06 && u > 0.1 && u < 0.9) return [255, 255, 255, 255];
    if (v < horizon && d <= r) return [255, 255, 255, 255];
    const ang = Math.atan2(-dy, dx);
    if (v < horizon && d > r + 0.06 && d < r + 0.16 && Math.abs(Math.sin(ang * 4.5)) > 0.82) return [255, 255, 255, 255];
    return [0, 0, 0, 0];
  }
  if (v >= horizon) {
    // two layered hills
    const hill = horizon + 0.08 + 0.05 * Math.sin(u * 7.5 + 0.6);
    return v > hill ? LAND2 : LAND;
  }
  if (d <= r) return mix(SUN_TOP, SUN_BOTTOM, Math.max(0, Math.min(1, (v - (horizon - r)) / r)));
  // rays
  const ang = Math.atan2(-dy, dx);
  if (d > r + 0.05 && d < r + 0.15 && Math.abs(Math.sin(ang * 4.5)) > 0.82) return mix(SUN_TOP, bg, 0.15);
  // glow
  const glow = Math.max(0, 1 - (d - r) / 0.3);
  return mix(bg, SUN_BOTTOM, glow * 0.25 * (opts.transparentBg ? 0 : 1));
}

export function renderIcon(size: number, opts: { pad?: number; transparentBg?: boolean; mono?: boolean } = {}): Buffer {
  const png = new PNG({ width: size, height: size });
  const ss = 4;
  const o = { pad: opts.pad ?? 0.06, transparentBg: !!opts.transparentBg, mono: !!opts.mono };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size, o);
          for (let i = 0; i < 4; i++) acc[i]! += c[i]!;
        }
      const idx = (y * size + x) * 4;
      for (let i = 0; i < 4; i++) png.data[idx + i] = Math.round(acc[i]! / (ss * ss));
    }
  }
  return PNG.sync.write(png);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="12" fill="#14121f"/>
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffc45e"/><stop offset="1" stop-color="#ff6b3d"/></linearGradient></defs>
<path d="M14 40a18 18 0 0 1 36 0z" fill="url(#s)"/>
<rect x="6" y="40" width="52" height="18" fill="#3b2a5c"/>
</svg>
`;

function main() {
  const out = join(process.cwd(), 'public', 'icons');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'icon-192.png'), renderIcon(192));
  writeFileSync(join(out, 'icon-512.png'), renderIcon(512));
  writeFileSync(join(out, 'icon-maskable-512.png'), renderIcon(512, { pad: 0.14 }));
  writeFileSync(join(out, 'apple-touch-icon.png'), renderIcon(180));
  writeFileSync(join(out, 'favicon.svg'), SVG);

  const res = join(process.cwd(), 'android', 'app', 'src', 'main', 'res');
  if (existsSync(res)) {
    const dens: Array<[string, number]> = [
      ['mdpi', 1],
      ['hdpi', 1.5],
      ['xhdpi', 2],
      ['xxhdpi', 3],
      ['xxxhdpi', 4],
    ];
    for (const [d, f] of dens) {
      const dir = join(res, `mipmap-${d}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'ic_launcher.png'), renderIcon(Math.round(48 * f)));
      writeFileSync(join(dir, 'ic_launcher_round.png'), renderIcon(Math.round(48 * f)));
      // adaptive-icon foreground: 108dp canvas with the glyph inside the 72dp safe zone
      writeFileSync(join(dir, 'ic_launcher_foreground.png'), renderIcon(Math.round(108 * f), { pad: 0.2 }));
      const ddir = join(res, `drawable-${d}`);
      mkdirSync(ddir, { recursive: true });
      writeFileSync(join(ddir, 'ic_stat_glowcast.png'), renderIcon(Math.round(24 * f), { mono: true, transparentBg: true, pad: 0.04 }));
    }
    console.log('Android icons written');
  }
  console.log('Icons written to public/icons');
}

main();
