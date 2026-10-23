import { useState } from 'react';
import { useApp } from '../state';
import { ForecastGate, StatusBar } from '../useForecast';
import { Tabs } from '../components';
import { formatDayLabel, localParts } from '../../engine/time';
import type { HourCtx } from '../../engine/regimes';

const W = 760;
const ROW = 22;
const PAD_L = 46;
const PAD_R = 8;

function cloudFill(v: number | null): string {
  if (v == null) return 'url(#nodata)';
  return `rgba(200, 195, 220, ${0.08 + (0.9 * v) / 100})`;
}

function Meteogram({ hours, tz, start }: { hours: HourCtx[]; tz: string; start: number }) {
  const end = start + 48 * 3600000;
  const hs = hours.filter((h) => h.t >= start && h.t < end);
  if (!hs.length) return <p className="muted">No hourly data for this period.</p>;
  const n = 48;
  const cw = (W - PAD_L - PAD_R) / n;
  const x = (t: number) => PAD_L + ((t - start) / 3600000) * cw;
  const rows: Array<[string, (h: HourCtx) => number | null]> = [
    ['High', (h) => h.high],
    ['Mid', (h) => h.mid],
    ['Low', (h) => h.low],
    ['Total', (h) => h.total],
  ];
  const yRain = rows.length * ROW + 10;
  const rainH = 40;
  const yLine = yRain + rainH + 16;
  const lineH = 90;
  const H = yLine + lineH + 26;
  const temps = hs.map((h) => h.temp).filter((v): v is number => v != null);
  const winds = hs.map((h) => h.gusts ?? h.wind).filter((v): v is number => v != null);
  const tMin = temps.length ? Math.floor(Math.min(...temps) - 1) : 0;
  const tMax = temps.length ? Math.ceil(Math.max(...temps) + 1) : 10;
  const wMax = Math.max(20, ...winds);
  const ty = (v: number) => yLine + lineH - ((v - tMin) / (tMax - tMin || 1)) * lineH;
  const wy = (v: number) => yLine + lineH - (v / wMax) * lineH;
  const maxRain = Math.max(2, ...hs.map((h) => h.precip ?? 0));
  const path = (vals: Array<[number, number | null]>, y: (v: number) => number) => {
    let d = '';
    let pen = false;
    for (const [t, v] of vals) {
      if (v == null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(t) + cw / 2},${y(v)} `;
      pen = true;
    }
    return d;
  };
  return (
    <div className="chart-wrap" data-testid="meteogram">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="48 hour meteogram">
        <defs>
          <pattern id="nodata" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#ff7a7a" strokeWidth="1" opacity="0.5" />
          </pattern>
        </defs>
        {/* night shading */}
        {hs.map((h) => (h.sunAlt < -6 ? <rect key={`n${h.t}`} x={x(h.t)} y={0} width={cw} height={H - 22} fill="#000" opacity="0.18" /> : null))}
        {rows.map(([name, get], r) => (
          <g key={name}>
            <text x={PAD_L - 6} y={r * ROW + 15} fontSize="11" textAnchor="end" fill="currentColor" opacity="0.75">
              {name}
            </text>
            {hs.map((h) => (
              <rect key={h.t} x={x(h.t)} y={r * ROW + 2} width={cw - 0.5} height={ROW - 4} fill={cloudFill(get(h))}>
                <title>{`${name} ${get(h) == null ? 'n/a' : Math.round(get(h)!) + ' %'}`}</title>
              </rect>
            ))}
          </g>
        ))}
        <text x={PAD_L - 6} y={yRain + 14} fontSize="11" textAnchor="end" fill="currentColor" opacity="0.75">
          Rain
        </text>
        {hs.map((h) =>
          h.precip == null ? (
            <rect key={`r${h.t}`} x={x(h.t)} y={yRain} width={cw - 0.5} height={rainH} fill="url(#nodata)" />
          ) : h.precip > 0 ? (
            <rect key={`r${h.t}`} x={x(h.t) + 1} y={yRain + rainH - (h.precip / maxRain) * rainH} width={cw - 2} height={(h.precip / maxRain) * rainH} fill="#5aa9e6" />
          ) : null,
        )}
        <text x={PAD_L - 6} y={yLine + 10} fontSize="11" textAnchor="end" fill="#ff9f4a">
          {tMax}°
        </text>
        <text x={PAD_L - 6} y={yLine + lineH} fontSize="11" textAnchor="end" fill="#ff9f4a">
          {tMin}°
        </text>
        <path d={path(hs.map((h) => [h.t, h.temp]), ty)} fill="none" stroke="#ff9f4a" strokeWidth="2" />
        <path d={path(hs.map((h) => [h.t, h.wind]), wy)} fill="none" stroke="#7ad39b" strokeWidth="1.5" />
        <path d={path(hs.map((h) => [h.t, h.gusts]), wy)} fill="none" stroke="#7ad39b" strokeWidth="1" strokeDasharray="3 3" />
        <text x={W - PAD_R} y={yLine + 10} fontSize="10" textAnchor="end" fill="#7ad39b">
          wind/gusts ≤ {Math.round(wMax)} km/h
        </text>
        {hs.map((h) => {
          const p = localParts(h.t, tz);
          if (p.hour % 6 !== 0) return null;
          return (
            <g key={`t${h.t}`}>
              <line x1={x(h.t)} x2={x(h.t)} y1={0} y2={H - 20} stroke="currentColor" opacity={p.hour === 0 ? 0.35 : 0.1} />
              <text x={x(h.t) + 2} y={H - 6} fontSize="10" fill="currentColor" opacity="0.7">
                {p.hour === 0 ? `${p.day}.${p.month}.` : `${String(p.hour).padStart(2, '0')}h`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function OutlookScreen() {
  const { now } = useApp();
  const [day, setDay] = useState(0);
  return (
    <ForecastGate>
      {(stored) => {
        const f = stored.forecast;
        const tz = f.observer.timezone;
        const start = f.days[day]?.dayStart ?? f.days[0]?.dayStart ?? now;
        return (
          <>
            <StatusBar />
            <h2>48 h outlook</h2>
            <Tabs
              label="Start day"
              value={String(day)}
              onChange={(v) => setDay(Number(v))}
              options={f.days.map((d, i) => [String(i), formatDayLabel(d.dayStart + 12 * 3600000, tz, now)])}
            />
            <Meteogram hours={f.hours} tz={tz} start={start} />
            <div className="legend">
              <span>
                <i style={{ background: 'rgba(200,195,220,0.9)' }} />
                cloud cover (darker = more)
              </span>
              <span>
                <i style={{ background: '#5aa9e6' }} />
                rain mm/h
              </span>
              <span>
                <i style={{ background: '#ff9f4a' }} />
                temperature
              </span>
              <span>
                <i style={{ background: '#7ad39b' }} />
                wind (dashed: gusts)
              </span>
              <span>
                <i style={{ background: '#000', opacity: 0.4 }} />
                night
              </span>
            </div>
            <p className="tiny muted" style={{ marginTop: 8 }}>
              Hours in {tz}. Viewpoint column from the primary model; hatched cells have no data.
            </p>
          </>
        );
      }}
    </ForecastGate>
  );
}
