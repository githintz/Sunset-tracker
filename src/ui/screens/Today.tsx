import { useState } from 'react';
import { useApp } from '../state';
import { ForecastGate, StatusBar } from '../useForecast';
import { Countdown, fmt1, KV, ReasonList, Sheet, Stars, Time, VerdictPill } from '../components';
import { formatDayLabel, formatTime } from '../../engine/time';
import { bestWindow, type LocationForecast } from '../../engine/forecast';
import type { EventRating } from '../../engine/event';
import { VERDICT_LABELS } from '../../engine/config';
import { navigate } from '../App';

function EventCard({ ev, f, now, hero }: { ev: EventRating; f: LocationForecast; now: number; hero?: boolean }) {
  const [open, setOpen] = useState(false);
  const tz = f.observer.timezone;
  const main = ev.reasons.find((r) => r.kind === 'main');
  const word = ev.kind === 'sunset' ? 'Sunset' : 'Sunrise';
  const goldenStart = ev.kind === 'sunset' ? ev.golden.start : ev.golden.start;
  return (
    <section className={`card${hero ? ' hero' : ''}`} data-testid={hero ? 'next-event' : 'event-card'} aria-label={`${word} ${formatDayLabel(ev.official, tz, now)}`}>
      <div className="row wrap">
        <div style={{ minWidth: 0 }}>
          <div className="small muted">
            {word} · {formatDayLabel(ev.official, tz, now)}
          </div>
          <div style={{ fontSize: hero ? '1.6rem' : '1.2rem', fontWeight: 700 }} data-testid="event-time">
            <Time ms={ev.official} tz={tz} withZone />
          </div>
          <div className="small muted">
            <Countdown target={ev.official} now={now} />
          </div>
        </div>
        <span className="spacer" />
        <VerdictPill v={ev.verdict} big={hero} />
      </div>

      <div className="grid2" style={{ marginTop: 12 }}>
        <KV
          k={`${word} rating`}
          testId="sunset-rating"
          v={
            <>
              <Stars value={ev.rating} label={`${word} rating`} /> <span className="small">{fmt1(ev.rating)}</span>
            </>
          }
        />
        <KV
          k="Golden hour"
          testId="golden-rating"
          v={
            ev.golden.score == null ? (
              <span className="muted">{ev.golden.label}</span>
            ) : (
              <>
                <Stars value={ev.golden.score} label="Golden hour" /> <span className="small">{fmt1(ev.golden.score)}</span>
                <div className="tiny muted">
                  {ev.golden.label}
                  {goldenStart != null ? ` · from ${formatTime(goldenStart, tz)}` : ''}
                </div>
              </>
            )
          }
        />
        <KV k="Sky & clouds" testId="sky-rating" v={ev.sky.label} />
        <KV
          k="Models"
          testId="models"
          v={
            ev.modelB ? (
              ev.modelsDisagree ? (
                <span className="badge bad" data-testid="models-disagree">
                  disagree: {ev.event?.score.toFixed(1)} vs {ev.modelB.score.toFixed(1)}
                </span>
              ) : (
                <span>agree ({ev.event?.score.toFixed(1)} / {ev.modelB.score.toFixed(1)})</span>
              )
            ) : (
              <span className="badge warn">only one forecast</span>
            )
          }
        />
        <KV k="Confidence" testId="confidence" v={ev.confidence} />
        <KV k="Sun azimuth" v={`${Math.round(ev.azimuth)}°`} />
      </div>

      {main ? (
        <p style={{ marginTop: 12, marginBottom: 6 }} data-testid="top-reason">
          {main.text}
        </p>
      ) : null}
      <div className="row wrap">
        <button className="btn" onClick={() => setOpen(true)} data-testid="why">
          Why?
        </button>
        <button className="btn ghost" onClick={() => navigate(`path?e=${ev.official}`)}>
          Light path ⟋
        </button>
      </div>
      {open ? (
        <Sheet title={`${word} ${formatDayLabel(ev.official, tz, now)} — why`} onClose={() => setOpen(false)}>
          <ReasonList reasons={ev.reasons} />
          <h3 style={{ marginTop: 16 }}>Factors (primary model, event moment)</h3>
          {ev.event ? (
            <div className="grid2">
              <KV k="Canvas" v={ev.event.canvas.toFixed(2)} />
              <KV k="Reach" v={`${ev.event.reach.toFixed(2)} (blocking ${Math.round(ev.event.blocking * 100)} %)`} />
              <KV k="Lit" v={`${ev.event.lit.toFixed(2)} (${Math.round(ev.event.litShare * 100)} % of cloud)`} />
              <KV k="Air" v={ev.event.air.toFixed(2)} />
              <KV k="Rain" v={ev.event.rain.toFixed(2)} />
              <KV k="Best light (+10 min)" v={ev.best ? ev.best.score.toFixed(1) : '–'} />
              <KV k="1 h before / after" v={ev.shoulders.map((s) => (s.score == null ? '–' : s.score.toFixed(1))).join(' / ')} />
              <KV k="Engine" v={ev.engineVersion} />
            </div>
          ) : (
            <p className="muted">No data covers this event.</p>
          )}
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Score = 5 × canvas × reach × lit × air × rain, averaged over the event moment, the best-light moment and the second model.
          </p>
        </Sheet>
      ) : null}
    </section>
  );
}

function DayPlanCard({ f, now }: { f: LocationForecast; now: number }) {
  const tz = f.observer.timezone;
  const pd = f.photographersDay;
  const bestDay = bestWindow(pd.daytime.filter((w) => w.end > now));
  const bestNight = bestWindow(pd.night);
  return (
    <section className="card" data-testid="photographers-day">
      <h2>Your photographer’s day</h2>
      <p className="tiny muted">From now until the end of the next morning’s blue hour ({formatTime(pd.end, tz)}).</p>
      <div className="list">
        {bestDay ? (
          <div className="row">
            <span className="small" style={{ width: 70 }}>
              Daytime
            </span>
            <VerdictPill v={bestDay.verdict} />
            <span className="small ellipsis">
              {bestDay.name} · {formatTime(bestDay.start, tz)}–{formatTime(bestDay.end, tz)}
            </span>
          </div>
        ) : null}
        {pd.blue.map((b) => (
          <div className="row" key={b.start}>
            <span className="small" style={{ width: 70 }}>
              Blue hour
            </span>
            <VerdictPill v={b.result.verdict} />
            <span className="small ellipsis">
              {b.evening ? 'evening' : 'morning'} · {formatTime(b.start, tz)}–{formatTime(b.end, tz)} · {b.result.label}
            </span>
          </div>
        ))}
        {bestNight ? (
          <div className="row">
            <span className="small" style={{ width: 70 }}>
              Night
            </span>
            <VerdictPill v={bestNight.verdict} />
            <span className="small ellipsis">
              {bestNight.name} · {formatTime(bestNight.start, tz)}–{formatTime(bestNight.end, tz)}
              {bestNight.warnings.length ? ' · windy' : ''}
            </span>
          </div>
        ) : (
          <div className="small muted">No dark night in this window{f.days[0]?.polar === 'day' ? ' (midnight sun)' : ''}.</div>
        )}
      </div>
    </section>
  );
}

export function TodayScreen() {
  const { now } = useApp();
  return (
    <ForecastGate>
      {(stored) => {
        const f = stored.forecast;
        const tz = f.observer.timezone;
        const upcoming = f.events.filter((e) => e.official >= now - 10 * 60000);
        const next = upcoming[0] ?? null;
        const rest = upcoming.slice(1);
        const polar = f.days[0]?.polar;
        return (
          <>
            <StatusBar />
            {next ? (
              <EventCard ev={next} f={f} now={now} hero />
            ) : (
              <div className="card hero" data-testid="no-event">
                <h2>{polar === 'day' ? 'Midnight sun — no sunset' : polar === 'night' ? 'Polar night — no sunrise' : 'No sunrise or sunset ahead'}</h2>
                <p className="muted">
                  The sun does not cross the horizon here in the next three days. The day and night engines below still apply.
                </p>
              </div>
            )}
            <DayPlanCard f={f} now={now} />
            {f.phenomena.filter((p) => p.end >= now).length ? (
              <section className="card" data-testid="phenomena">
                <h2>Possible phenomena</h2>
                <div className="list">
                  {f.phenomena
                    .filter((p) => p.end >= now)
                    .slice(0, 6)
                    .map((p) => (
                      <div key={`${p.id}-${p.start}`}>
                        <div className="row">
                          <strong>{p.name}</strong>
                          <span className={`badge ${p.likelihood === 'likely' ? 'good' : ''}`}>{p.likelihood}</span>
                          <span className="spacer" />
                          <span className="small muted nowrap">
                            {formatDayLabel(p.start, tz, now)} {formatTime(p.start, tz)}–{formatTime(p.end, tz)}
                          </span>
                        </div>
                        <div className="small">{p.what}</div>
                        <div className="tiny muted">{p.why.join(' · ')}</div>
                      </div>
                    ))}
                </div>
              </section>
            ) : null}
            {rest.length ? (
              <>
                <div className="section-title">
                  <h2>Next three days</h2>
                </div>
                {rest.map((e) => (
                  <EventCard key={e.official} ev={e} f={f} now={now} />
                ))}
              </>
            ) : null}
            <p className="tiny muted">
              Verdict = 0.8 × {VERDICT_LABELS.length ? 'sunset/sunrise' : ''} rating + 0.2 × golden hour. Engine {f.engineVersion}. Not a safety
              forecast — check routes and conditions yourself.
            </p>
          </>
        );
      }}
    </ForecastGate>
  );
}
