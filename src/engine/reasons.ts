/** Plain-language explanations generated from factor values. Every rating carries a main reason. */
import type { EventRating } from './event';
import type { MomentScore } from './sunset';
import type { Observer, Reason } from './types';

const pct = (x: number) => `${Math.round(x * 100)} %`;
const km = (x: number) => `${Math.round(x)} km`;

/** Mean of a band over the known canvas points (null if none known). */
function canvasMean(m: MomentScore, k: 'low' | 'mid' | 'high'): number | null {
  const xs = m.points.filter((p) => p.role === 'canvas' && p[k] != null).map((p) => p[k]!);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function canvasStory(m: MomentScore): { code: string; text: string } {
  const L = canvasMean(m, 'low');
  const M = canvasMean(m, 'mid');
  const H = canvasMean(m, 'high');
  if (m.undercast) {
    if (M != null && M >= 85) return { code: 'undercast-mid-lid', text: `You are above the low cloud but a solid mid-level deck (${Math.round(M)} %) sits overhead and will hold back the colour` };
    return { code: 'undercast', text: `You stand above the low cloud — a sea of clouds below the viewpoint can catch the light` };
  }
  if (L != null && L >= 85) return { code: 'low-lid', text: `A thick low deck overhead (${Math.round(L)} %) leaves little for the light to paint` };
  if (L != null && M != null && H != null && L < 10 && M < 10 && H < 10 && m.canvas < 0.3) return { code: 'clear', text: 'Almost no cloud overhead to catch the colour — expect a clean but pale glow' };
  if (M != null && H != null && Math.max(M, H) >= 90) return { code: 'upper-lid', text: 'A closed mid/high deck overhead — colour will mostly stay on its edges and gaps' };
  if (L != null && L > 0 && L <= 30 && (M ?? 0) < 15 && (H ?? 0) < 15) return { code: 'low-sparse', text: 'Only scattered low cloud overhead — a pale glow rather than fire' };
  if (m.canvas >= 0.7) return { code: 'canvas-good', text: 'Broken mid and high cloud overhead — a good canvas for colour' };
  if (L != null && L >= 40) return { code: 'low-hides', text: `Low cloud overhead (${Math.round(L)} %) hides much of the higher canvas` };
  if (M != null && H != null && Math.max(M, H) < 25) return { code: 'thin-canvas', text: 'Only thin, patchy cloud overhead — not much for the light to paint' };
  return { code: 'canvas-mixed', text: 'A mixed sky overhead — some cloud to catch colour, but not ideal' };
}

function lightPathStory(m: MomentScore): string {
  if (m.blockedZone) {
    const z = m.blockedZone;
    const span = z.fromKm === z.toKm ? `around ${km(z.fromKm)}` : `around ${z.fromKm}–${km(z.toKm)}`;
    return `Light path blocked: ${pct(m.blocking)} blocking cloud at the ray's height ${span} toward the sun`;
  }
  return `Light path blocked: ${pct(m.blocking)} blocking cloud along the corridor toward the sun`;
}

export function buildSunsetReasons(r: EventRating, observer: Observer): Reason[] {
  const out: Reason[] = [];
  const m = r.event;
  const word = r.kind === 'sunset' ? 'sunset' : 'sunrise';
  if (!m) {
    out.push({ kind: 'main', code: 'no-data', text: `No forecast data covers this ${word} yet` });
    return out;
  }

  // ---- main reason: the factor that costs the most, or the best feature on a good day
  const losses: Array<{ code: string; loss: number; text: string }> = [
    { code: 'canvas', loss: 1 - m.canvas, text: canvasStory(m).text },
    { code: 'reach', loss: 1 - m.reach, text: lightPathStory(m) },
    {
      code: 'lit',
      loss: 1 - m.lit,
      text: `Only ${pct(m.litShare)} of the cloud overhead is likely to catch direct light before it fades`,
    },
    {
      code: 'rain',
      loss: 1 - m.rain,
      text: m.meanPrecipProb == null ? 'Rain over the viewpoint could not be ruled out (no data)' : `Rain likely over the viewpoint (${Math.round(m.meanPrecipProb)} % chance) — the show could be washed out`,
    },
  ];
  if (m.overcastAll) {
    out.push({ kind: 'main', code: 'overcast-all', text: 'A solid low/mid-level deck at every sample point — the sun has no way in under it' });
  } else if ((r.raw ?? 0) >= 3.5) {
    const c = canvasStory(m);
    const text =
      c.code === 'upper-lid'
        ? 'A thick mid/high deck overhead with an open path toward the sun beneath it — its underside can light up'
        : m.reach >= 0.99
          ? `${c.text}, with a clear path toward the sun`
          : c.text;
    out.push({ kind: 'main', code: `good-${c.code}`, text });
  } else {
    losses.sort((a, b) => b.loss - a.loss);
    const top = losses[0]!;
    out.push({ kind: 'main', code: top.code === 'canvas' ? canvasStory(m).code : top.code, text: top.text });
  }

  // ---- supporting factors
  if (m.reach >= 0.99 && !m.overcastAll) out.push({ kind: 'support', code: 'clear-path', text: 'The corridor toward the sun is open out to 350 km' });
  if (m.lit >= 0.99 && m.canvas > 0.3) out.push({ kind: 'support', code: 'lit', text: 'Most of the cloud overhead should catch the low sun' });
  if (m.canvas >= 0.8 && !m.undercast) out.push({ kind: 'support', code: 'canvas', text: 'Plenty of mid/high cloud at the right density to light up' });
  if (m.air > 1.02) out.push({ kind: 'support', code: 'air', text: 'A moderate aerosol load and decent visibility should deepen the colours' });
  if (m.undercast && !out.some((x) => x.code.includes('undercast')))
    out.push({ kind: 'support', code: 'undercast', text: `You are above the low cloud (${Math.round(observer.elevationM)} m) — expect a sea of clouds` });
  if (r.golden.label === 'warm direct light') out.push({ kind: 'support', code: 'golden', text: 'Warm direct light should reach the viewpoint before the sun goes' });
  if (r.best && r.best.score > m.score + 0.5) out.push({ kind: 'support', code: 'after-glow', text: `The sky improves a few minutes after ${word === 'sunset' ? 'sunset' : 'before sunrise'} — stay for the afterglow` });

  // ---- risks
  if (r.modelsDisagree && r.modelB) out.push({ kind: 'risk', code: 'disagree', text: `The two models disagree (${m.score.toFixed(1)} vs ${r.modelB.score.toFixed(1)}) — check again closer to the time` });
  if (r.primaryIsB) out.push({ kind: 'risk', code: 'primary-missing', text: `The primary model has no data for this ${word}; rated from the second model alone` });
  if (r.singleModel) out.push({ kind: 'risk', code: 'single-model', text: 'Only one forecast available — no second model to cross-check' });
  if (m.rain < 0.9 && !out.some((x) => x.code === 'rain')) out.push({ kind: 'risk', code: 'rain', text: 'Some rain risk over the viewpoint' });
  if (m.air < 0.95 && m.missingAir.length === 0) out.push({ kind: 'risk', code: 'haze', text: 'Hazy or very humid air will mute the colours' });
  if (m.reach < 0.99 && m.reach > 0 && !out.some((x) => x.code === 'reach')) out.push({ kind: 'risk', code: 'reach-partial', text: lightPathStory(m) });
  const lowMid = m.points.filter((p) => p.role === 'canvas' && (p.mid ?? 0) >= 85);
  if (m.undercast && lowMid.length > 0 && !out.some((x) => x.code === 'undercast-mid-lid'))
    out.push({ kind: 'risk', code: 'undercast-mid-lid', text: `You are above the low cloud (${Math.round(observer.elevationM)} m) but a solid mid-level deck sits overhead` });

  // ---- honesty about data gaps
  if (m.missingPoints.length > 0)
    out.push({
      kind: 'info',
      code: 'missing-points',
      text: `No data at ${m.missingPoints.map((d) => `${d} km`).join(', ')} — counted as the worst case, so the score can only be too low, not too high`,
    });
  if (m.missingAir.length > 0) out.push({ kind: 'info', code: 'missing-air', text: `Missing ${m.missingAir.join(' and ')} data — air quality counted as poor` });
  if (m.rainUnknown) out.push({ kind: 'info', code: 'missing-rain', text: 'Rain data missing — counted as likely rain' });
  if (r.golden.missing) out.push({ kind: 'info', code: 'missing-golden', text: 'Some near-field data for the golden hour is missing — counted as blocked' });
  return out;
}
