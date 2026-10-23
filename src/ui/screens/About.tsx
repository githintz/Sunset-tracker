import { useEffect, useState } from 'react';
import { useApp } from '../state';
import { navigate } from '../App';
import { Tabs } from '../components';
import { ENGINE_VERSION, VERDICT_LABELS } from '../../engine/config';
import { callsToday } from '../../data/budget';
import { isNative } from '../../native/platform';
import { ensurePermission, planAlerts, scheduleAlerts } from '../../native/notifications';
import type { Theme } from '../../app/settings';
import { useStored } from '../useForecast';

function Notifications() {
  const app = useApp();
  const { stored } = useStored();
  const n = app.settings.notify;
  const [msg, setMsg] = useState<string | null>(null);
  const set = (patch: Partial<typeof n>) => app.setSettings({ ...app.settings, notify: { ...n, ...patch } });
  return (
    <section className="card" data-testid="notifications">
      <h2>Alerts</h2>
      {!isNative() ? (
        <p className="small muted">
          Scheduled alerts need the Android app. In the browser you can still use “Check now”.
        </p>
      ) : (
        <p className="small muted">
          Android may delay background work, so alerts are planned from the latest forecast each time Glowcast refreshes, plus an optional
          daily reminder to open the app.
        </p>
      )}
      <label className="row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={n.enabled} onChange={async (e) => {
          const on = e.target.checked;
          if (on && !(await ensurePermission())) {
            setMsg('Notification permission was not granted.');
            return;
          }
          set({ enabled: on });
        }} />
        Notify me
      </label>
      <div className="grid2">
        <label className="field">
          At (local time of each spot)
          <input type="time" value={n.time} onChange={(e) => set({ time: e.target.value || '14:00' })} />
        </label>
        <label className="field">
          When the verdict is at least
          <select value={n.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })}>
            {VERDICT_LABELS.map((l, i) => (i >= 2 ? <option key={l} value={i}>{l}</option> : null))}
          </select>
        </label>
      </div>
      <div className="small muted">Spots</div>
      <div className="list" style={{ marginBottom: 8 }}>
        {app.spots.map((s) => (
          <label key={s.id} className="row small">
            <input
              type="checkbox"
              checked={n.spotIds.length === 0 || n.spotIds.includes(s.id)}
              onChange={(e) => {
                const all = n.spotIds.length === 0 ? app.spots.map((x) => x.id) : n.spotIds;
                set({ spotIds: e.target.checked ? [...new Set([...all, s.id])] : all.filter((id) => id !== s.id) });
              }}
            />
            <span className="ellipsis">{s.name}</span>
          </label>
        ))}
      </div>
      <label className="row small" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={n.dailyReminder} onChange={(e) => set({ dailyReminder: e.target.checked })} />
        Daily reminder to check the forecast
      </label>
      <button
        className="btn"
        onClick={async () => {
          if (!stored || !app.active) {
            setMsg('Add a spot first.');
            return;
          }
          const alerts = planAlerts(0, stored.forecast, { ...n, enabled: true }, Date.now());
          const next = stored.forecast.events.find((e) => e.official > Date.now() && e.verdict != null && e.verdict >= n.threshold);
          if (isNative() && n.enabled) await scheduleAlerts(alerts, n);
          setMsg(next ? `${app.active.name}: ${next.kind} ${next.verdictLabel} (${next.rating?.toFixed(1)}). ${alerts.length} alert(s) planned.` : `Nothing at or above “${VERDICT_LABELS[n.threshold]}” in the next three days.`);
        }}
        data-testid="check-now"
      >
        Check now
      </button>
      {msg ? <p className="small" style={{ marginTop: 8 }}>{msg}</p> : null}
    </section>
  );
}

export function AboutScreen() {
  const app = useApp();
  const [used, setUsed] = useState<number | null>(null);
  useEffect(() => {
    void callsToday(app.kv, Date.now()).then(setUsed);
  }, [app.kv, app.forecast]);
  const { stored } = useStored();
  return (
    <div data-testid="about">
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn ghost" onClick={() => navigate('spots')}>Spots</button>
        <button className="btn ghost" onClick={() => navigate('history')} data-testid="nav-history">History</button>
      </div>
      <section className="card">
        <h2>How it works</h2>
        <p>
          A colourful sunset needs two things: cloud overhead for the light to land on, and a clear way in for the last sunlight. Glowcast
          follows the sun’s bearing from your spot and samples the forecast at points out to 350 km. Near you it asks what kind of cloud is
          overhead (the <em>canvas</em>); further out it checks whether cloud sits exactly at the height where the low sun’s rays pass (the{' '}
          <em>reach</em>). It then follows rays from each overhead cloud back toward the sun as it sinks below the horizon to see which cloud
          bases get <em>lit</em>, and adjusts for haze, humidity and rain.
        </p>
        <p>
          The rating is 5 × canvas × reach × lit × air × rain, averaged over the moment of sunset, a few minutes later, and a second weather
          model. Golden hour, sky character and optical phenomena are judged separately; daytime and night light are described in words.
        </p>
        <p>Missing data is never treated as clear sky: any gap counts as the worst case and is shown as a gap.</p>
      </section>
      <section className="card">
        <h2>Limitations</h2>
        <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
          <li>Terrain is drawn but does not shade the light — a ridge between you and the sun is not modelled.</li>
          <li>Cloud thickness is unknown: cover is not opacity, so a thin veil and a dense deck can look alike.</li>
          <li>Weather models resolve kilometres, not individual clouds or valleys.</li>
          <li>Only clouds along the sun’s bearing are sampled; clouds off to the side are not.</li>
          <li>The app says nothing about route safety, avalanche risk or access. Check conditions yourself.</li>
          <li>Map grids use a simplified version of the engine (band data, no aerosols) and cover the Alps only.</li>
        </ul>
      </section>
      <section className="card">
        <h2>Appearance</h2>
        <Tabs<Theme>
          label="Theme"
          value={app.settings.theme}
          onChange={(t) => app.setSettings({ ...app.settings, theme: t })}
          options={[
            ['system', 'System'],
            ['dark', 'Dark'],
            ['light', 'Light'],
          ]}
        />
      </section>
      <Notifications />
      <section className="card small">
        <h2>Data & attributions</h2>
        <p>
          Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0) — models from
          DWD, NOAA, Météo-France, ECMWF and others via Open-Meteo’s best-match blend, plus ECMWF IFS as the second model.
        </p>
        <p>
          Aerosol optical depth and dust: Copernicus Atmosphere Monitoring Service (CAMS) via Open-Meteo’s air-quality API. Terrain:
          Copernicus DEM GLO-90 via Open-Meteo’s elevation API (© DLR / Airbus, provided under COPERNICUS by the EU and ESA).
        </p>
        <p>
          Map tiles © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors.
          Moon calculations: suncalc (BSD-2-Clause). Non-commercial, personal use.
        </p>
      </section>
      <section className="card small" data-testid="versions">
        <h2>Versions</h2>
        <p>
          App {__APP_VERSION__} ({__BUILD_TARGET__}) · engine {ENGINE_VERSION}
          {stored ? ` · current forecast computed with engine ${stored.forecast.engineVersion}` : ''}
        </p>
        <p className="muted">
          Open-Meteo usage today (estimate): {used == null ? '…' : `${Math.round(used)} calls`} of the 10,000/day free tier.
          {stored ? ` A full refresh costs about ${Math.round(stored.status.fullCost)} calls; results are cached for 60 min.` : ''}
        </p>
        <button
          className="btn ghost"
          onClick={async () => {
            const keys = await app.kv.keys();
            await Promise.all(keys.filter((k) => k.startsWith('om:') || k.startsWith('last:')).map((k) => app.kv.del(k)));
            app.refresh(true);
          }}
        >
          Clear cached forecasts
        </button>
      </section>
    </div>
  );
}
