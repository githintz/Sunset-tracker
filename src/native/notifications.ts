/**
 * Local notifications (Android). Background fetch on Android is unreliable without a foreground service,
 * so alerts are (re)scheduled from the latest forecast every time the app refreshes, plus an optional daily
 * reminder and a manual "check now". See docs/DECISIONS.md.
 */
import type { LocationForecast } from '../engine/forecast';
import { VERDICT_LABELS } from '../engine/config';
import { formatTime, localParts, zonedTimeToUtc } from '../engine/time';
import type { Settings } from '../app/settings';
import { isNative } from './platform';

export interface PlannedAlert {
  id: number;
  at: number;
  title: string;
  body: string;
}

/** Pure planning step (unit-tested): which alerts to schedule for one spot's forecast. */
export function planAlerts(spotIndex: number, f: LocationForecast, s: Settings['notify'], now: number): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  const [hh, mm] = s.time.split(':').map(Number);
  for (const ev of f.events) {
    if (ev.verdict == null || ev.verdict < s.threshold || ev.official <= now) continue;
    const tz = f.observer.timezone;
    const p = localParts(ev.official, tz);
    let at = zonedTimeToUtc(p.year, p.month, p.day, hh ?? 14, mm ?? 0, tz);
    // Sunrise alerts go out the evening before at the same clock time.
    if (ev.kind === 'sunrise' || at >= ev.official) at -= 24 * 3600000;
    if (at <= now) continue;
    out.push({
      id: 100000 + spotIndex * 1000 + (Math.floor(ev.official / 60000) % 1000),
      at,
      title: `${f.observer.name}: ${VERDICT_LABELS[ev.verdict]} for ${ev.kind}`,
      body: `${ev.kind === 'sunset' ? 'Sunset' : 'Sunrise'} at ${formatTime(ev.official, tz)} — rated ${ev.rating?.toFixed(1)}/5. ${ev.reasons[0]?.text ?? ''}`,
    });
  }
  return out;
}

export async function ensurePermission(): Promise<boolean> {
  if (!isNative()) return typeof Notification !== 'undefined' && (Notification.permission === 'granted' || (await Notification.requestPermission()) === 'granted');
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  let p = await LocalNotifications.checkPermissions();
  if (p.display !== 'granted') p = await LocalNotifications.requestPermissions();
  return p.display === 'granted';
}

export async function scheduleAlerts(alerts: PlannedAlert[], s: Settings['notify']): Promise<number> {
  if (!isNative()) return 0;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
  if (!s.enabled) return 0;
  const list = alerts.map((a) => ({ id: a.id, title: a.title, body: a.body, schedule: { at: new Date(a.at), allowWhileIdle: true } }));
  if (s.dailyReminder) {
    const [h, m] = s.time.split(':').map(Number);
    list.push({ id: 1, title: 'Glowcast', body: 'Open Glowcast to refresh tonight’s forecast for your spots.', schedule: { on: { hour: h ?? 14, minute: m ?? 0 }, allowWhileIdle: true } as never });
  }
  if (list.length) await LocalNotifications.schedule({ notifications: list });
  return list.length;
}
