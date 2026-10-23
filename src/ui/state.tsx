/** App state: spots, settings, history and the active spot's forecast. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { idbKV, memoryKV, type KV } from '../data/cache';
import type { Spot } from '../data/pipeline';
import { loadSpots, saveSpots, loadActiveId, saveActiveId, spotFromLink } from '../app/spots';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, type Settings } from '../app/settings';
import { loadHistory, saveHistory, type HistoryEntry } from '../app/history';
import { loadLast, refresh as doRefresh, type StoredForecast } from '../app/service';
import { planAlerts, scheduleAlerts } from '../native/notifications';
import { initNative } from '../native/platform';

export type ForecastState =
  | { phase: 'idle' }
  | { phase: 'loading'; stored: StoredForecast | null }
  | { phase: 'ready'; stored: StoredForecast; refreshing: boolean; error: string | null }
  | { phase: 'error'; error: string };

interface AppState {
  kv: KV;
  ready: boolean;
  now: number;
  spots: Spot[];
  active: Spot | null;
  settings: Settings;
  history: HistoryEntry[];
  forecast: ForecastState;
  setActive(id: string): void;
  addSpot(s: Spot): void;
  updateSpot(s: Spot): void;
  removeSpot(id: string): void;
  setSettings(s: Settings): void;
  setHistory(h: HistoryEntry[]): void;
  refresh(force?: boolean): void;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

function openKV(): KV {
  try {
    if (typeof indexedDB !== 'undefined') return idbKV();
  } catch {
    /* private mode */
  }
  return memoryKV();
}

export function AppProvider({ children }: { children: ReactNode }) {
  const kv = useMemo(openKV, []);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [spots, setSpots] = useState<Spot[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [history, setHistoryState] = useState<HistoryEntry[]>([]);
  const [forecast, setForecast] = useState<ForecastState>({ phase: 'idle' });
  const loadSeq = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    (async () => {
      const [loaded, a, st, h] = await Promise.all([loadSpots(kv), loadActiveId(kv), loadSettings(kv), loadHistory(kv)]);
      let s = loaded;
      let act = a && s.some((x) => x.id === a) ? a : (s[0]?.id ?? null);
      // Shared spot link: #/today?spot=lat,lon&name=…&alt=…
      const linked = spotFromLink(window.location.hash);
      if (linked) {
        const same = s.find((x) => Math.abs(x.lat - linked.lat) < 1e-4 && Math.abs(x.lon - linked.lon) < 1e-4 && x.elevationOverrideM === linked.elevationOverrideM);
        if (same) act = same.id;
        else {
          s = [...s, linked];
          act = linked.id;
          await saveSpots(kv, s);
        }
        await saveActiveId(kv, act);
        window.history.replaceState(null, '', window.location.pathname + window.location.search + window.location.hash.split('?')[0]);
      }
      setSpots(s);
      setActiveId(act);
      setSettingsState(st);
      setHistoryState(h);
      setReady(true);
    })().catch(() => setReady(true));
  }, [kv]);

  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);

  const active = spots.find((s) => s.id === activeId) ?? null;

  // Android: spot deep links and back button.
  const spotsRef = useRef(spots);
  spotsRef.current = spots;
  useEffect(() => {
    if (!ready) return;
    void initNative((query) => {
      const linked = spotFromLink(`#/today?${query}`);
      if (!linked) return;
      const same = spotsRef.current.find((x) => Math.abs(x.lat - linked.lat) < 1e-4 && Math.abs(x.lon - linked.lon) < 1e-4);
      const next = same ? spotsRef.current : [...spotsRef.current, linked];
      const id = same ? same.id : linked.id;
      setSpots(next);
      setActiveId(id);
      void saveSpots(kv, next);
      void saveActiveId(kv, id);
      console.info(`[glowcast] spot-link ${linked.name} ${linked.lat},${linked.lon}`);
    }).catch((e) => console.warn('[glowcast] native init failed', e));
  }, [ready, kv]);

  // A stable, greppable line for the Android smoke test and for debugging.
  useEffect(() => {
    if (forecast.phase !== 'ready' || forecast.refreshing) return;
    const f = forecast.stored.forecast;
    const n = f.nextEvent;
    console.info(
      `[glowcast] forecast-ready spot="${f.observer.name}" events=${f.events.length} next=${n ? `${n.kind}:${n.verdictLabel}:${n.rating}` : 'none'} engine=${f.engineVersion}`,
    );
  }, [forecast]);

  const runRefresh = useCallback(
    async (spot: Spot, force: boolean) => {
      const seq = ++loadSeq.current;
      const last = await loadLast(kv, spot.id);
      if (seq !== loadSeq.current) return;
      setForecast(last ? { phase: 'ready', stored: last, refreshing: true, error: null } : { phase: 'loading', stored: null });
      try {
        const stored = await doRefresh(kv, spot, Date.now(), { force });
        if (seq !== loadSeq.current) return;
        const hasData = !!(stored.forecast.events.some((e) => e.rating != null) || stored.forecast.hours.length);
        if (!hasData && last) {
          setForecast({ phase: 'ready', stored: last, refreshing: false, error: stored.status.errors[0] ?? 'Refresh failed — showing the last forecast' });
        } else if (!hasData) {
          setForecast({ phase: 'error', error: stored.status.errors[0] ?? 'No forecast data available' });
        } else {
          setForecast({ phase: 'ready', stored, refreshing: false, error: null });
        }
        setHistoryState(await loadHistory(kv));
      } catch (e) {
        if (seq !== loadSeq.current) return;
        const msg = (e as Error).message || 'Refresh failed';
        setForecast(last ? { phase: 'ready', stored: last, refreshing: false, error: msg } : { phase: 'error', error: msg });
      }
    },
    [kv],
  );

  useEffect(() => {
    if (!ready) return;
    if (!active) {
      setForecast({ phase: 'idle' });
      return;
    }
    void runRefresh(active, false);
    // re-run when the spot itself (incl. its altitude override) changes
  }, [ready, active?.id, active?.lat, active?.lon, active?.elevationOverrideM, runRefresh]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reschedule local alerts whenever a fresh forecast arrives.
  useEffect(() => {
    if (forecast.phase !== 'ready' || !settings.notify.enabled || !active) return;
    if (settings.notify.spotIds.length && !settings.notify.spotIds.includes(active.id)) return;
    const alerts = planAlerts(Math.max(0, spots.indexOf(active)), forecast.stored.forecast, settings.notify, Date.now());
    void scheduleAlerts(alerts, settings.notify).catch(() => undefined);
  }, [forecast, settings.notify, active, spots]);

  const value: AppState = {
    kv,
    ready,
    now,
    spots,
    active,
    settings,
    history,
    forecast,
    setActive: (id) => {
      setActiveId(id);
      void saveActiveId(kv, id);
    },
    addSpot: (s) => {
      const next = [...spots.filter((x) => x.id !== s.id), s];
      setSpots(next);
      setActiveId(s.id);
      void saveSpots(kv, next);
      void saveActiveId(kv, s.id);
    },
    updateSpot: (s) => {
      const next = spots.map((x) => (x.id === s.id ? s : x));
      setSpots(next);
      void saveSpots(kv, next);
    },
    removeSpot: (id) => {
      const next = spots.filter((x) => x.id !== id);
      setSpots(next);
      void saveSpots(kv, next);
      if (activeId === id) {
        const n = next[0]?.id ?? null;
        setActiveId(n);
        void saveActiveId(kv, n);
      }
    },
    setSettings: (s) => {
      setSettingsState(s);
      void saveSettings(kv, s);
    },
    setHistory: (h) => {
      setHistoryState(h);
      void saveHistory(kv, h);
    },
    refresh: (force = true) => {
      if (active) void runRefresh(active, force);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
