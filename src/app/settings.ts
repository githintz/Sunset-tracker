import type { KV } from '../data/cache';

export type Theme = 'system' | 'dark' | 'light';

export interface Settings {
  theme: Theme;
  notify: {
    enabled: boolean;
    /** Local time of day "HH:MM" to send the alert. */
    time: string;
    /** Minimum verdict index (0..4) that triggers an alert. */
    threshold: number;
    spotIds: string[];
    dailyReminder: boolean;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  notify: { enabled: false, time: '14:00', threshold: 3, spotIds: [], dailyReminder: false },
};

const KEY = 'settings:v1';

export async function loadSettings(kv: KV): Promise<Settings> {
  try {
    const raw = (await kv.get(KEY)) as Partial<Settings> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
    return {
      theme: raw.theme === 'dark' || raw.theme === 'light' ? raw.theme : 'system',
      notify: { ...DEFAULT_SETTINGS.notify, ...(raw.notify ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(kv: KV, s: Settings): Promise<void> {
  await kv.set(KEY, s);
}
