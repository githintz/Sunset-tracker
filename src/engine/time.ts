/**
 * IANA time-zone helpers built on Intl. All engine times are UTC milliseconds; we only convert
 * for display and for "local day" boundaries, always in the spot's zone (never the device's).
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localParts(ms: number, tz: string): LocalParts {
  const parts = partsFormatter(tz).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') % 24, minute: get('minute'), second: get('second') };
}

/** Offset of the zone from UTC at an instant, minutes (e.g. +120 for CEST). */
export function tzOffsetMinutes(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** UTC instant of a local wall-clock time in the zone (first occurrence on DST overlaps, shifted on gaps). */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  let guess = naive - tzOffsetMinutes(naive, tz) * 60000;
  for (let i = 0; i < 3; i++) {
    const next = naive - tzOffsetMinutes(guess, tz) * 60000;
    if (next === guess) break;
    guess = next;
  }
  return guess;
}

/** UTC instant of local midnight starting the local day containing `ms`. */
export function startOfLocalDay(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, tz);
}

/** Local day key "YYYY-MM-DD" in the zone. */
export function localDayKey(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function addLocalDays(dayStartMs: number, days: number, tz: string): number {
  const p = localParts(dayStartMs + 12 * 3600000, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0, tz);
}

export function formatTime(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function formatDayLabel(ms: number, tz: string, nowMs: number): string {
  const key = localDayKey(ms, tz);
  const today = localDayKey(nowMs, tz);
  const tomorrow = localDayKey(addLocalDays(startOfLocalDay(nowMs, tz), 1, tz) + 3600000, tz);
  if (key === today) return 'Today';
  if (key === tomorrow) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms));
}

/** Short zone label such as "CEST" or "GMT+9", for showing which clock times are in. */
export function tzAbbrev(ms: number, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(ms));
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

export function formatDuration(ms: number): string {
  const totalMin = Math.round(Math.abs(ms) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
