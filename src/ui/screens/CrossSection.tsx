import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { ForecastGate, StatusBar } from '../useForecast';
import { Tabs } from '../components';
import { buildCrossSection, oktas, xFrac, Y_MAX_KM, X_MAX } from '../charts/crossSection';
import { formatDayLabel, formatTime } from '../../engine/time';
import type { StoredForecast } from '../../app/service';
import type { EventRating } from '../../engine/event';
import { shadowAngleDeg } from '../../engine/geo';

const W = 720;
const H = 360;
const PAD_L = 34;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 34;
const px = (f: number) => PAD_L + f * (W - PAD_L - PAD_R);
const py = (z: number) => PAD_T + (1 - Math.max(0, Math.min(Y_MAX_KM, z)) / Y_MAX_KM) * (H - PAD_T - PAD_B);

type Moment = 'event' | 'best' | 'minus' | 'plus';

function eventFromHash(events: EventRating[]): EventRating | null {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const e = Number(q.get('e'));
  return events.find((x) => x.official === e) ?? null;
}

function Chart({ stored, ev, model, moment }: { stored: StoredForecast; ev: EventRating; model: 'A' | 'B'; moment: Moment }) {
  const f = stored.forecast;
  // The stored forecast does not keep raw series; the cross-section is rebuilt from the cached inputs.
  const inputs = stored.inputs;
  const bd = ev.kind === 'sunset' ? inputs?.sunset : inputs?.sunrise;
  const corridor = model === 'A' ? (bd?.A ?? null) : (bd?.B ?? null);
  const t = moment === 'event' ? ev.centre : moment === 'best' ? ev.bestLight : ev.centre + (moment === 'minus' ? -1 : 1) * 3600000;
  const obsKm = f.observer.elevationM / 1000;
  const view = useMemo(() => buildCrossSection(corridor, t, obsKm, bd?.profile ?? null), [corridor, t, obsKm, bd]);
  const ticks = [-5, 0, 5, 10, 20, 30, 50, 100, 150, 200, 300, 350];
  const dep = Math.max(0.5, shadowAngleDeg(3));
  if (!corridor) return <p className="muted">No {model === 'B' ? 'second-model' : ''} data for this event.</p>;
  return (
    <>
      <div className="chart-wrap" data-testid="cross-section">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cross-section of cloud along the sun's bearing">
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
            </pattern>
            <pattern id="gap" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <line x1="0" y1="0" x2="0" y2="8" stroke="#ff7a7a" strokeWidth="1" opacity="0.5" />
            </pattern>
          </defs>
          {/* grid */}
          {[0, 2, 4, 6, 8, 10, 12].map((z) => (
            <g key={z}>
              <line x1={PAD_L} x2={W - PAD_R} y1={py(z)} y2={py(z)} stroke="currentColor" opacity="0.08" />
              <text x={PAD_L - 4} y={py(z) + 4} fontSize="10" textAnchor="end" fill="currentColor" opacity="0.6">
                {z}
              </text>
            </g>
          ))}
          {ticks.map((d) => (
            <g key={d}>
              <line x1={px(xFrac(d))} x2={px(xFrac(d))} y1={py(0)} y2={py(0) + 4} stroke="currentColor" opacity="0.5" />
              <text x={px(xFrac(d))} y={H - PAD_B + 16} fontSize="10" textAnchor="middle" fill="currentColor" opacity="0.7">
                {d}
              </text>
            </g>
          ))}
          <text x={W - PAD_R} y={H - 4} fontSize="10" textAnchor="end" fill="currentColor" opacity="0.6">
            km toward the sun (compressed beyond 30 km)
          </text>
          <text x={4} y={PAD_T + 2} fontSize="10" fill="currentColor" opacity="0.6" transform={`rotate(-90 10 ${PAD_T + 60})`}>
            km
          </text>
          {/* cloud cells */}
          {view.columns.map((c) => (
            <g key={c.distanceKm} data-state={c.state}>
              {c.state === 'missing' ? (
                <>
                  <rect x={px(c.x0)} y={py(Y_MAX_KM)} width={px(c.x1) - px(c.x0)} height={py(0) - py(Y_MAX_KM)} fill="url(#gap)" />
                  <text x={(px(c.x0) + px(c.x1)) / 2} y={py(6)} fontSize="9" textAnchor="middle" fill="#ff7a7a" transform={`rotate(-90 ${(px(c.x0) + px(c.x1)) / 2} ${py(6)})`}>
                    no data
                  </text>
                </>
              ) : (
                c.cells.map((cell, i) => (
                  <g key={i}>
                    <rect
                      x={px(cell.x0)}
                      y={py(cell.z1)}
                      width={Math.max(1, px(cell.x1) - px(cell.x0))}
                      height={Math.max(1, py(cell.z0) - py(cell.z1))}
                      fill={cell.lit ? '#ff7a2e' : '#c9c3d9'}
                      opacity={0.15 + 0.75 * cell.cover}
                    />
                    {c.state === 'bands' ? (
                      <rect x={px(cell.x0)} y={py(cell.z1)} width={Math.max(1, px(cell.x1) - px(cell.x0))} height={Math.max(1, py(cell.z0) - py(cell.z1))} fill="url(#hatch)" />
                    ) : null}
                  </g>
                ))
              )}
            </g>
          ))}
          {/* terrain (illustration only) */}
          {view.terrain.length > 1 ? (
            <g>
              <polyline
                points={view.terrain.map((p) => `${px(p.x)},${py(p.z)}`).join(' ')}
                fill="none"
                stroke="#7ad39b"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
              <text x={px(0.02)} y={py(0) - 6} fontSize="9" fill="#7ad39b">
                terrain — illustration only
              </text>
            </g>
          ) : null}
          {/* near-ground humidity strip */}
          {view.columns.map((c) => {
            const rh = c.col?.rh;
            return (
              <rect
                key={`rh-${c.distanceKm}`}
                x={px(c.x0)}
                y={py(0) + 1}
                width={Math.max(1, px(c.x1) - px(c.x0))}
                height={5}
                fill={rh == null ? 'url(#gap)' : `hsl(200 70% ${85 - rh * 0.5}%)`}
                opacity={rh == null ? 1 : 0.4 + rh / 200}
              >
                <title>RH {rh == null ? 'n/a' : `${Math.round(rh)} %`}</title>
              </rect>
            );
          })}
          {/* tangent ray */}
          <polyline points={view.ray.map((p) => `${px(p.x)},${py(p.z)}`).join(' ')} fill="none" stroke="#ffc45e" strokeWidth="2" />
          <text x={px(xFrac(250))} y={py(view.ray.find((p) => p.x >= xFrac(250))?.z ?? 4) - 6} fontSize="10" fill="#ffc45e">
            tangent ray
          </text>
          {/* observer */}
          <circle cx={px(xFrac(0))} cy={py(view.observerKm)} r="4" fill="#f3eef9" />
          {/* sun direction */}
          <g transform={`translate(${W - PAD_R - 18}, ${py(1.2)})`}>
            <circle r="9" fill="#ffc45e" />
            <line x1="-26" y1={-26 * Math.tan((dep * Math.PI) / 180)} x2="-11" y2="0" stroke="#ffc45e" strokeWidth="2" markerEnd="" />
            <text x="-12" y="22" fontSize="9" textAnchor="middle" fill="#ffc45e">
              sun {Math.round(ev.azimuth)}°
            </text>
          </g>
        </svg>
      </div>
      <div className="legend">
        <span>
          <i style={{ background: '#ff7a2e' }} />
          cloud lit from below
        </span>
        <span>
          <i style={{ background: '#c9c3d9' }} />
          cloud in shadow
        </span>
        <span>
          <i style={{ background: 'repeating-linear-gradient(45deg,#888 0 2px,transparent 2px 5px)' }} />
          height unresolved (band data)
        </span>
        <span>
          <i style={{ background: 'repeating-linear-gradient(-45deg,#ff7a7a 0 1px,transparent 1px 5px)' }} />
          no data
        </span>
        <span>
          <i style={{ background: '#ffc45e' }} />
          observer’s tangent ray
        </span>
        <span>
          <i style={{ background: 'hsl(200 70% 50%)' }} />
          near-ground humidity
        </span>
      </div>
      <h3 style={{ marginTop: 14 }}>Sample points</h3>
      <div className="table-scroll">
        <table className="data" data-testid="point-table">
          <thead>
            <tr>
              <th className="left">km</th>
              <th className="left">Point</th>
              <th>Oktas</th>
              <th>L/M/H %</th>
              <th>RH</th>
              <th>Rain mm</th>
              <th>Vis km</th>
            </tr>
          </thead>
          <tbody>
            {view.columns.map((c) => {
              const col = c.col;
              const missing = c.state === 'missing';
              const r = (x: number | null | undefined) => (x == null ? '–' : String(Math.round(x)));
              return (
                <tr key={c.distanceKm} className={missing ? 'missing' : ''}>
                  <td>{c.distanceKm}</td>
                  <td className="left">
                    {c.role === 'chart' ? 'chart only' : c.role}
                    {missing ? ' · no data' : c.state === 'bands' ? ' · bands' : ''}
                  </td>
                  <td>{missing ? '–' : (oktas(col?.total ?? null) ?? '–')}</td>
                  <td>
                    {r(col?.low)}/{r(col?.mid)}/{r(col?.high)}
                  </td>
                  <td>{r(col?.rh)}</td>
                  <td>{col?.precip == null ? '–' : col.precip.toFixed(1)}</td>
                  <td>{col?.visKm == null ? '–' : col.visKm >= 10 ? Math.round(col.visKm) : col.visKm.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="tiny muted" style={{ marginTop: 8 }}>
        Cloud drawn at real geopotential heights from pressure-level data. Clouds off the bearing are not sampled; cover is not opacity;
        terrain does not block light in the model. Range shown: −5 to {X_MAX} km.
      </p>
    </>
  );
}

export function CrossSectionScreen() {
  const { now } = useApp();
  const [sel, setSel] = useState<number | null>(null);
  const [model, setModel] = useState<'A' | 'B'>('A');
  const [moment, setMoment] = useState<Moment>('event');
  return (
    <ForecastGate>
      {(stored) => {
        const f = stored.forecast;
        const tz = f.observer.timezone;
        const evs = f.events.filter((e) => e.rating != null);
        const fromHash = eventFromHash(evs);
        const ev = evs.find((e) => e.official === sel) ?? fromHash ?? evs.find((e) => e.official >= now - 600000) ?? evs[0] ?? null;
        return (
          <>
            <StatusBar />
            <h2>Light path</h2>
            {!ev ? (
              <p className="muted">No sunrise or sunset with data to show.</p>
            ) : (
              <>
                <label className="field">
                  Event
                  <select value={ev.official} onChange={(e) => setSel(Number(e.target.value))} data-testid="event-select">
                    {evs.map((e) => (
                      <option key={e.official} value={e.official}>
                        {formatDayLabel(e.official, tz, now)} · {e.kind} {formatTime(e.official, tz)} · {e.rating?.toFixed(1)}
                      </option>
                    ))}
                  </select>
                </label>
                <Tabs
                  label="Moment"
                  value={moment}
                  onChange={setMoment}
                  options={[
                    ['event', 'Event'],
                    ['best', 'Best light'],
                    ['minus', '−1 h'],
                    ['plus', '+1 h'],
                  ]}
                />
                <Tabs
                  label="Model"
                  value={model}
                  onChange={setModel}
                  options={[
                    ['A', 'Primary model'],
                    ['B', stored.status.modelB ? `Second (${stored.status.modelB})` : 'Second model'],
                  ]}
                />
                <Chart stored={stored} ev={ev} model={model} moment={moment} />
              </>
            )}
          </>
        );
      }}
    </ForecastGate>
  );
}
