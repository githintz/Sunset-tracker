import { useState } from 'react';
import { useApp } from '../state';
import { ForecastGate, StatusBar } from '../useForecast';
import { KV, Stars, Tabs, Time, VerdictPill, fmt1, ReasonList } from '../components';
import { formatDayLabel, formatDuration, formatTime } from '../../engine/time';
import type { DayPlan, LocationForecast, RegimeWindow } from '../../engine/forecast';
import type { EventRating } from '../../engine/event';
import type { PhaseKind } from '../../engine/phases';
import { moonPhaseName, moonState } from '../../engine/moon';

type Tab = 'overview' | 'sunrise' | 'daytime' | 'sunset' | 'night';

const PHASE_NAME: Record<PhaseKind, string> = {
  day: 'Daytime',
  golden: 'Golden hour',
  blue: 'Blue hour',
  night: 'Night',
  astro: 'Astronomical darkness',
};

function PhaseBar({ d }: { d: DayPlan }) {
  const span = d.phases.length ? d.phases[d.phases.length - 1]!.end - d.phases[0]!.start : 1;
  return (
    <div className="timeline-bar" aria-hidden="true">
      {d.phases.map((p) => (
        <span key={p.start} className={`ph-${p.kind}`} style={{ width: `${((p.end - p.start) / span) * 100}%` }} title={PHASE_NAME[p.kind]} />
      ))}
    </div>
  );
}

function Windows({ ws, tz, empty }: { ws: RegimeWindow[]; tz: string; empty: string }) {
  if (!ws.length) return <p className="muted">{empty}</p>;
  return (
    <div className="list">
      {ws.map((w) => (
        <div key={`${w.start}-${w.regime}`} className="card flat" style={{ marginBottom: 0 }} data-testid="regime-window">
          <div className="row wrap">
            <strong>{w.name}</strong>
            <span className="spacer" />
            <VerdictPill v={w.verdict} />
          </div>
          <div className="small muted">
            {formatTime(w.start, tz)}–{formatTime(w.end, tz)} · {formatDuration(w.end - w.start)}
            {w.flags.length ? ` · ${w.flags.join(', ')}` : ''}
          </div>
          <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {w.signals.map((s) => (
              <li key={s}>{s}</li>
            ))}
            {w.adjustments.map((s) => (
              <li key={s} className="muted">
                {s}
              </li>
            ))}
            {w.warnings.map((s) => (
              <li key={s} style={{ color: 'var(--warn)' }}>
                {s}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EventDetail({ ev, d, f, now }: { ev: EventRating | null; d: DayPlan; f: LocationForecast; now: number }) {
  const tz = f.observer.timezone;
  if (!ev)
    return (
      <p className="muted">
        {d.polar === 'day' ? 'Midnight sun — the sun stays up all day.' : d.polar === 'night' ? 'Polar night — the sun stays down all day.' : 'No event this day.'}
      </p>
    );
  const blue = d.blue.find((b) => (ev.kind === 'sunset' ? b.evening : !b.evening));
  return (
    <div className="card flat">
      <div className="row wrap">
        <div>
          <div className="small muted">{ev.kind === 'sunset' ? 'Sunset' : 'Sunrise'}</div>
          <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>
            <Time ms={ev.official} tz={tz} withZone />
          </div>
          {ev.official < now ? <div className="tiny muted">passed</div> : null}
        </div>
        <span className="spacer" />
        <VerdictPill v={ev.verdict} big />
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        <KV k="Rating" v={<><Stars value={ev.rating} /> {fmt1(ev.rating)}</>} />
        <KV k="Golden hour" v={`${fmt1(ev.golden.score)} · ${ev.golden.label}`} />
        <KV
          k="Golden window"
          v={ev.golden.start != null && ev.golden.end != null ? `${formatTime(ev.golden.start, tz)}–${formatTime(ev.golden.end, tz)} (${formatDuration(ev.golden.end - ev.golden.start)})` : '–'}
        />
        <KV k="Blue hour" v={blue ? `${formatTime(blue.start, tz)}–${formatTime(blue.end, tz)} · ${blue.result.label}` : '–'} />
        <KV k="Sky & clouds" v={ev.sky.label} />
        <KV k="Temperature" v={d.tempMin == null ? '–' : `${Math.round(d.tempMin)}…${Math.round(d.tempMax ?? d.tempMin)} °C`} />
      </div>
      {blue ? (
        <div className="row small" style={{ marginTop: 8 }}>
          Blue hour: <VerdictPill v={blue.result.verdict} /> <span className="muted">{blue.result.signals.join(' · ')}</span>
        </div>
      ) : null}
      <ReasonList reasons={ev.reasons} limit={5} />
    </div>
  );
}

export function TimelineScreen() {
  const { now } = useApp();
  const [dayIdx, setDayIdx] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <ForecastGate>
      {(stored) => {
        const f = stored.forecast;
        const tz = f.observer.timezone;
        const d = f.days[dayIdx] ?? f.days[0];
        if (!d) return <p className="muted">No days to show.</p>;
        const moonNow = moonState(d.dayStart + 22 * 3600000, f.observer.lat, f.observer.lon);
        const astro = d.phases.filter((p) => p.kind === 'astro').reduce((a, p) => a + (p.end - p.start), 0);
        return (
          <>
            <StatusBar />
            <Tabs
              label="Day"
              value={String(dayIdx)}
              onChange={(v) => setDayIdx(Number(v))}
              options={f.days.map((x, i) => [String(i), formatDayLabel(x.dayStart + 12 * 3600000, tz, now)])}
            />
            <Tabs
              label="Part of the day"
              value={tab}
              onChange={setTab}
              options={[
                ['overview', 'Overview'],
                ['sunrise', 'Sunrise'],
                ['daytime', 'Daytime'],
                ['sunset', 'Sunset'],
                ['night', 'Night'],
              ]}
            />
            {tab === 'overview' ? (
              <section className="card" data-testid="timeline-overview">
                <PhaseBar d={d} />
                <div className="legend">
                  {(['day', 'golden', 'blue', 'night', 'astro'] as PhaseKind[]).map((k) => (
                    <span key={k}>
                      <i className={`ph-${k}`} />
                      {PHASE_NAME[k]}
                    </span>
                  ))}
                </div>
                <div className="list" style={{ marginTop: 10 }}>
                  {d.phases.map((p) => (
                    <div className="row small" key={p.start}>
                      <span className="nowrap" style={{ width: 96 }}>
                        {formatTime(p.start, tz)}–{formatTime(p.end, tz)}
                      </span>
                      <span className="ellipsis">
                        {PHASE_NAME[p.kind]}
                        {p.evening != null ? (p.evening ? ' (evening)' : ' (morning)') : ''}
                      </span>
                      <span className="spacer" />
                      <span className="muted nowrap">{formatDuration(p.end - p.start)}</span>
                    </div>
                  ))}
                </div>
                <div className="grid2" style={{ marginTop: 10 }}>
                  <KV k="Sunrise" v={d.sunrise ? <>{formatTime(d.sunrise.official, tz)} · {d.sunrise.verdictLabel}</> : d.polar ? 'none' : '–'} />
                  <KV k="Sunset" v={d.sunset ? <>{formatTime(d.sunset.official, tz)} · {d.sunset.verdictLabel}</> : d.polar ? 'none' : '–'} />
                  <KV k="Temperature" v={d.tempMin == null ? '–' : `${Math.round(d.tempMin)}…${Math.round(d.tempMax ?? d.tempMin)} °C`} />
                  <KV
                    k="Moon"
                    v={`${moonPhaseName(moonNow.phase)} · ${Math.round(moonNow.illumination * 100)} %${d.moon.rise ? ` · rises ${formatTime(d.moon.rise, tz)}` : ''}${d.moon.set ? ` · sets ${formatTime(d.moon.set, tz)}` : ''}`}
                  />
                  <KV k="Astro darkness" v={astro ? formatDuration(astro) : 'none'} />
                  <KV k="Polar" v={d.polar === 'day' ? 'midnight sun' : d.polar === 'night' ? 'polar night' : 'no'} />
                </div>
              </section>
            ) : tab === 'sunrise' ? (
              <EventDetail ev={d.sunrise} d={d} f={f} now={now} />
            ) : tab === 'sunset' ? (
              <EventDetail ev={d.sunset} d={d} f={f} now={now} />
            ) : tab === 'daytime' ? (
              <Windows ws={d.daytime} tz={tz} empty={d.polar === 'night' ? 'Polar night — no daytime.' : 'No daytime hours with data.'} />
            ) : (
              <Windows ws={d.night} tz={tz} empty={d.polar === 'day' ? 'Midnight sun — no dark night.' : 'No night hours with data.'} />
            )}
          </>
        );
      }}
    </ForecastGate>
  );
}
