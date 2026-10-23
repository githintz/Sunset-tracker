/** Per-day Open-Meteo call counter (estimated, see estimateCalls). */
import type { KV } from './cache';

export const budgetKey = (now: number) => `budget:${new Date(now).toISOString().slice(0, 10)}`;

export async function recordCalls(kv: KV, calls: number, now: number): Promise<number> {
  const key = budgetKey(now);
  const prev = Number(await kv.get(key).catch(() => 0)) || 0;
  const next = Math.round((prev + calls) * 100) / 100;
  await kv.set(key, next).catch(() => undefined);
  return next;
}

export async function callsToday(kv: KV, now: number): Promise<number> {
  return Number(await kv.get(budgetKey(now)).catch(() => 0)) || 0;
}
