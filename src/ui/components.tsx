import type { ReactNode } from 'react';
import { VERDICT_LABELS } from '../engine/config';
import { formatDuration, formatTime, tzAbbrev } from '../engine/time';
import type { Reason, Verdict } from '../engine/types';

export function VerdictPill({ v, big }: { v: Verdict | null; big?: boolean }) {
  return (
    <span className={`verdict v${v ?? 'null'}${big ? ' big' : ''}`} data-testid="verdict">
      {v == null ? 'No data' : VERDICT_LABELS[v]}
    </span>
  );
}

export function Stars({ value, label }: { value: number | null; label?: string }) {
  if (value == null) return <span className="muted">–</span>;
  const n = Math.round(value);
  return (
    <span className="stars" aria-label={`${label ?? 'Rating'} ${value.toFixed(1)} of 5`} title={`${value.toFixed(1)} / 5`}>
      {'★'.repeat(n)}
      <span className="off">{'★'.repeat(5 - n)}</span>
    </span>
  );
}

export function Time({ ms, tz, withZone }: { ms: number | null; tz: string; withZone?: boolean }) {
  if (ms == null) return <span className="muted">–</span>;
  return (
    <span className="nowrap">
      {formatTime(ms, tz)}
      {withZone ? <span className="muted tiny"> {tzAbbrev(ms, tz)}</span> : null}
    </span>
  );
}

export function Countdown({ target, now }: { target: number; now: number }) {
  const d = target - now;
  if (Math.abs(d) < 60000) return <span>now</span>;
  return <span className="nowrap">{d > 0 ? `in ${formatDuration(d)}` : `${formatDuration(d)} ago`}</span>;
}

const ICON: Record<Reason['kind'], string> = { main: '◆', support: '＋', risk: '！', info: 'ⓘ' };

export function ReasonList({ reasons, limit }: { reasons: Reason[]; limit?: number }) {
  const list = limit ? reasons.slice(0, limit) : reasons;
  return (
    <ul className="reasons" data-testid="reasons">
      {list.map((r, i) => (
        <li key={`${r.code}-${i}`} className={`reason-${r.kind}`}>
          <span className="dot" aria-hidden="true">
            {ICON[r.kind]}
          </span>
          <span>
            <span className="sr-only">{r.kind}: </span>
            {r.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function KV({ k, v, testId }: { k: string; v: ReactNode; testId?: string }) {
  return (
    <div className="kv" data-testid={testId}>
      <span className="k">{k}</span>
      <span className="v">{v}</span>
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map(([k, name]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}>
          {name}
        </button>
      ))}
    </div>
  );
}

export function Sheet({ onClose, children, title }: { onClose: () => void; children: ReactNode; title: string }) {
  return (
    <div className="backdrop" role="presentation" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function fmt1(x: number | null | undefined): string {
  return x == null ? '–' : x.toFixed(1);
}

export function pct(x: number | null | undefined): string {
  return x == null ? '–' : `${Math.round(x)} %`;
}
