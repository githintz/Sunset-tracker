/** "Sky & clouds" rating: visual interest of the sky itself. Displayed only — never changes the verdict. */
import type { MomentScore } from './sunset';
import type { Num } from './types';

export type SkyLabel = 'Flat' | 'Plain' | 'Scenic' | 'Dramatic';

export interface SkyRating {
  label: SkyLabel;
  points: number;
  notes: string[];
}

const isLayer = (c: Num) => c != null && c >= 15 && c <= 85;
const textured = (c: Num) => c != null && c >= 20 && c <= 80;

export function skyRating(m: MomentScore | null, cape: Num): SkyRating {
  if (!m) return { label: 'Flat', points: 0, notes: ['No cloud data'] };
  const canvas = m.points.filter((p) => p.role === 'canvas' && !p.missing);
  const all = m.points.filter((p) => p.total != null);
  if (canvas.length === 0) return { label: 'Flat', points: 0, notes: ['No cloud data overhead'] };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const totals = all.map((p) => p.total!);
  const meanTotal = mean(totals);
  const notes: string[] = [];
  if (meanTotal < 10) return { label: 'Flat', points: 0, notes: ['Clear sky — no clouds to add structure'] };
  if (totals.every((t) => t >= 95)) return { label: 'Flat', points: 0, notes: ['Uniform grey overcast'] };

  const avg = (k: 'low' | 'mid' | 'high') => mean(canvas.map((p) => p[k] ?? 0));
  const layers = (['low', 'mid', 'high'] as const).filter((k) => isLayer(avg(k)));
  let pts = layers.length;
  if (layers.length >= 2) notes.push(`${layers.length} cloud layers stacked (${layers.join(', ')})`);
  if ((['low', 'mid', 'high'] as const).some((k) => textured(avg(k)))) {
    pts += 1;
    notes.push('Broken cover gives texture');
  }
  const sd = Math.sqrt(mean(totals.map((t) => (t - meanTotal) ** 2)));
  if (sd > 20) {
    pts += 1;
    notes.push('Cover changes a lot along the view — depth and contrast');
  }
  if (m.undercast) {
    pts += 2;
    notes.push('Sea of clouds below the viewpoint');
  }
  if (cape != null && cape > 500) {
    pts += 1;
    notes.push('Convective air — towering clouds possible');
  }
  const label: SkyLabel = pts >= 4 ? 'Dramatic' : pts >= 2 ? 'Scenic' : 'Plain';
  return { label, points: pts, notes };
}
