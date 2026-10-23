import { useRef, useState } from 'react';
import { useApp } from '../state';
import { Sheet, fmt1 } from '../components';
import { exportJson, mergeImported, parseImport, rateEntry, type HistoryEntry } from '../../app/history';
import { isSpot } from '../../app/spots';
import { formatDayLabel, formatTime } from '../../engine/time';

function RateForm({ e, onDone }: { e: HistoryEntry; onDone: () => void }) {
  const app = useApp();
  const [sunset, setSunset] = useState<number | null>(e.user?.sunset ?? null);
  const [golden, setGolden] = useState<number | null>(e.user?.golden ?? null);
  const [sky, setSky] = useState<number | null>(e.user?.sky ?? null);
  const [note, setNote] = useState(e.user?.note ?? '');
  const Pick = ({ label, v, set }: { label: string; v: number | null; set: (n: number) => void }) => (
    <div style={{ marginBottom: 10 }}>
      <div className="small muted">{label}</div>
      <div className="row" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={v === n} className={`btn${v === n ? ' primary' : ''}`} style={{ minWidth: 44 }} onClick={() => set(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <div>
      <Pick label={e.kind === 'sunset' ? 'Sunset' : 'Sunrise'} v={sunset} set={setSunset} />
      <Pick label="Golden hour" v={golden} set={setGolden} />
      <Pick label="Sky" v={sky} set={setSky} />
      <label className="field">
        Note
        <textarea value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="What happened?" />
      </label>
      <button
        className="btn primary"
        onClick={() => {
          app.setHistory(rateEntry(app.history, e.id, { sunset, golden, sky, note }, Date.now()));
          onDone();
        }}
        data-testid="save-rating"
      >
        Save rating
      </button>
    </div>
  );
}

export function HistoryScreen() {
  const app = useApp();
  const [rating, setRating] = useState<HistoryEntry | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const now = app.now;

  const doExport = () => {
    const text = exportJson(app.spots, app.history, Date.now());
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `glowcast-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg(`Exported ${app.history.length} forecasts and ${app.spots.length} spots.`);
  };

  const doImport = async (f: File) => {
    try {
      const { spots, history } = parseImport(await f.text());
      app.setHistory(mergeImported(app.history, history));
      const known = new Set(app.spots.map((s) => s.id));
      spots.filter(isSpot).filter((s) => !known.has(s.id)).forEach((s) => app.addSpot(s));
      setMsg(`Imported ${history.length} forecasts.`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <>
      <h2>History</h2>
      <p className="small muted">
        Forecasts are stored as issued, with the engine version that produced them, and are never re-scored. After the event, rate what you
        saw.
      </p>
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={doExport} data-testid="export">
          Export JSON
        </button>
        <button className="btn" onClick={() => file.current?.click()}>
          Import JSON
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = '';
          }}
          data-testid="import-input"
        />
      </div>
      {msg ? <p className="notice">{msg}</p> : null}
      {app.history.length === 0 ? <p className="muted">No forecasts stored yet.</p> : null}
      <div className="list" data-testid="history-list">
        {app.history.map((e) => {
          const past = e.official <= now;
          return (
            <div key={e.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
              <div className="row">
                <strong className="ellipsis">{e.spotName}</strong>
                <span className="spacer" />
                <span className="small muted nowrap">
                  {formatDayLabel(e.official, e.timezone, now)} · {e.kind} {formatTime(e.official, e.timezone)}
                </span>
              </div>
              <div className="small">
                Forecast {fmt1(e.rating)} · golden {fmt1(e.golden)} · sky {e.sky} · <strong>{e.verdict}</strong>
                {e.modelBScore != null ? ` · model B ${fmt1(e.modelBScore)}` : ''}
              </div>
              <div className="tiny muted ellipsis">
                {e.mainReason} · engine {e.engineVersion} · issued {formatDayLabel(e.issuedAt, e.timezone, now)} {formatTime(e.issuedAt, e.timezone)}
              </div>
              {e.user ? (
                <div className="small" style={{ color: 'var(--good)' }}>
                  You rated: {e.kind} {e.user.sunset ?? '–'} · golden {e.user.golden ?? '–'} · sky {e.user.sky ?? '–'}
                  {e.user.note ? ` — “${e.user.note}”` : ''}
                </div>
              ) : null}
              {past ? (
                <div>
                  <button className="btn ghost" onClick={() => setRating(e)}>
                    {e.user ? 'Edit rating' : 'Rate what you saw'}
                  </button>
                </div>
              ) : (
                <div className="tiny muted">Upcoming — the stored forecast is replaced until the event happens.</div>
              )}
            </div>
          );
        })}
      </div>
      {rating ? (
        <Sheet title={`Rate ${rating.kind} — ${rating.spotName}`} onClose={() => setRating(null)}>
          <RateForm e={rating} onDone={() => setRating(null)} />
        </Sheet>
      ) : null}
    </>
  );
}
