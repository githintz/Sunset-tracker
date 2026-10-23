import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state';
import { navigate } from '../App';
import { Sheet } from '../components';
import { buildGeocodeUrl, parseGeocode, type GeoResult } from '../../data/openmeteo';
import { fetchJson } from '../../data/http';
import { makeSpot } from '../../app/spots';
import { currentPosition, isNative, LocationError } from '../../native/platform';
import type { Spot } from '../../data/pipeline';

export function SpotSearch({ onAdded }: { onAdded?: () => void }) {
  const app = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeoResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        setResults(parseGeocode(await fetchJson(buildGeocodeUrl(term), { retries: 1 })));
      } catch (e) {
        setErr((e as Error).message);
        setResults(null);
      } finally {
        setBusy(false);
      }
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q]);

  const add = (r: GeoResult) => {
    app.addSpot(makeSpot(r.name, r.lat, r.lon, r.timezone));
    setQ('');
    setResults(null);
    onAdded?.();
  };

  return (
    <div>
      <label className="field">
        Search a place
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Gornergrat, Isle of Skye…"
          aria-label="Search a place"
          data-testid="search-input"
          autoComplete="off"
        />
      </label>
      {busy ? <p className="small muted">Searching…</p> : null}
      {err ? (
        <p className="small" style={{ color: 'var(--bad)' }}>
          Search failed: {err}
        </p>
      ) : null}
      {results && results.length === 0 ? <p className="small muted">No places found.</p> : null}
      {results && results.length ? (
        <div className="list" data-testid="search-results">
          {results.map((r) => (
            <button key={`${r.id}-${r.lat}`} className="list-item" onClick={() => add(r)}>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="ellipsis" style={{ display: 'block', fontWeight: 600 }}>
                  {r.name}
                </span>
                <span className="tiny muted ellipsis" style={{ display: 'block' }}>
                  {[r.admin1, r.country].filter(Boolean).join(', ')} · {r.lat.toFixed(3)}, {r.lon.toFixed(3)}
                  {r.elevationM != null ? ` · ${Math.round(r.elevationM)} m` : ''}
                </span>
              </span>
              <span aria-hidden="true">＋</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function GpsButton({ onAdded }: { onAdded?: () => void }) {
  const app = useApp();
  const [state, setState] = useState<'idle' | 'rationale' | 'busy'>('idle');
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    setState('busy');
    setMsg(null);
    try {
      const p = await currentPosition();
      app.addSpot(makeSpot(`My location (${p.lat.toFixed(3)}, ${p.lon.toFixed(3)})`, p.lat, p.lon, null, null));
      onAdded?.();
      setState('idle');
    } catch (e) {
      const le = e as LocationError;
      setMsg(
        le.kind === 'denied'
          ? 'Location permission denied — no problem, search for a place instead.'
          : le.kind === 'timeout'
            ? 'Finding your location took too long — try again or search for a place.'
            : `Location unavailable (${le.message}) — search for a place instead.`,
      );
      setState('idle');
    }
  };
  return (
    <div>
      <button className="btn" onClick={() => (isNative() ? setState('rationale') : void go())} disabled={state === 'busy'} data-testid="gps-button">
        {state === 'busy' ? 'Locating…' : '◎ Use my location'}
      </button>
      {msg ? (
        <p className="small" style={{ color: 'var(--warn)', marginTop: 6 }} data-testid="gps-message">
          {msg}
        </p>
      ) : null}
      {state === 'rationale' ? (
        <Sheet title="Use your location?" onClose={() => setState('idle')}>
          <p>Glowcast uses your position once to add a spot and compute the light path from where you stand. It is stored only on this device.</p>
          <div className="row">
            <button className="btn primary" onClick={() => void go()}>
              Continue
            </button>
            <button className="btn ghost" onClick={() => setState('idle')}>
              Not now
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}

function SpotRow({ s }: { s: Spot }) {
  const app = useApp();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(s.name);
  const [alt, setAlt] = useState(s.elevationOverrideM == null ? '' : String(s.elevationOverrideM));
  const active = app.active?.id === s.id;
  const save = () => {
    const a = alt.trim() === '' ? null : Number(alt);
    app.updateSpot({ ...s, name: name.trim() || s.name, elevationOverrideM: a != null && Number.isFinite(a) && a > -500 && a < 9000 ? a : null });
    setEditing(false);
  };
  return (
    <div className={`list-item${active ? ' active' : ''}`} style={{ flexDirection: 'column', alignItems: 'stretch' }} data-testid="spot-row">
      <div className="row">
        <button
          className="ellipsis"
          style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', flex: 1, fontWeight: 600 }}
          onClick={() => {
            app.setActive(s.id);
            navigate('today');
          }}
        >
          {active ? '● ' : ''}
          {s.name}
        </button>
        <button className="btn ghost" onClick={() => setEditing((x) => !x)} aria-label={`Edit ${s.name}`}>
          ✎
        </button>
      </div>
      <div className="tiny muted ellipsis">
        {s.lat.toFixed(4)}, {s.lon.toFixed(4)}
        {s.elevationOverrideM != null ? ` · viewpoint ${Math.round(s.elevationOverrideM)} m (your value)` : ' · altitude from terrain model'}
      </div>
      {editing ? (
        <div style={{ marginTop: 8 }}>
          <label className="field">
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} data-testid="spot-name-input" />
          </label>
          <label className="field">
            Viewpoint altitude (m) — overrides the terrain model; decides whether you are above a low cloud deck
            <input type="number" inputMode="numeric" value={alt} onChange={(e) => setAlt(e.target.value)} placeholder="from terrain model" data-testid="spot-alt-input" />
          </label>
          <div className="row">
            <button className="btn primary" onClick={save} data-testid="spot-save">
              Save
            </button>
            <button className="btn danger" onClick={() => app.removeSpot(s.id)}>
              Delete
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function SpotsScreen() {
  const app = useApp();
  return (
    <>
      <h2>Spots</h2>
      <section className="card">
        <SpotSearch onAdded={() => navigate('today')} />
        <div className="row wrap">
          <GpsButton onAdded={() => navigate('today')} />
          <button className="btn ghost" onClick={() => navigate('maps')}>
            ⌖ Long-press on the map
          </button>
        </div>
      </section>
      <div className="section-title">
        <h2>Saved spots</h2>
        <span className="muted small">{app.spots.length}</span>
      </div>
      {app.spots.length === 0 ? <p className="muted">No spots yet.</p> : null}
      <div className="list">
        {app.spots.map((s) => (
          <SpotRow key={s.id} s={s} />
        ))}
      </div>
    </>
  );
}
