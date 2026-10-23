import type { ReactNode } from 'react';
import { useApp } from './state';
import type { StoredForecast } from '../app/service';
import { formatDuration } from '../engine/time';

export function useStored(): { stored: StoredForecast | null; loading: boolean; error: string | null } {
  const { forecast } = useApp();
  if (forecast.phase === 'ready') return { stored: forecast.stored, loading: forecast.refreshing, error: forecast.error };
  if (forecast.phase === 'loading') return { stored: forecast.stored, loading: true, error: null };
  if (forecast.phase === 'error') return { stored: null, loading: false, error: forecast.error };
  return { stored: null, loading: false, error: null };
}

/** Renders children only when a forecast is available; otherwise a loading / error state. */
export function ForecastGate({ children }: { children: (s: StoredForecast) => ReactNode }) {
  const { stored, loading, error } = useStored();
  if (!stored) {
    if (error)
      return (
        <div className="notice bad" data-testid="forecast-error">
          <strong>Couldn’t load a forecast.</strong> {error}
          <div className="small muted" style={{ marginTop: 6 }}>
            Check your connection and pull ⟳ to try again. Missing data is never shown as clear sky.
          </div>
        </div>
      );
    return (
      <div className="card flat muted" data-testid="forecast-loading">
        {loading ? 'Fetching the forecast and computing the light path…' : 'No forecast yet.'}
      </div>
    );
  }
  return <>{children(stored)}</>;
}

export function StatusBar() {
  const { stored, loading, error } = useStored();
  const { now } = useApp();
  if (!stored) return null;
  const age = now - stored.forecast.fetchedAt;
  const staleReason = stored.status.requests.find((r) => r.source === 'stale-cache' || r.source === 'failed')?.error ?? null;
  const shownError = error ?? (stored.status.stale ? staleReason : null);
  const stale = stored.status.stale || !!error || stored.forecast.flags.includes('stale run') || age > 3 * 3600000;
  return (
    <div className="row wrap small" style={{ marginBottom: 10 }} data-testid="status-bar">
      <span className={`badge ${stale ? 'warn' : 'good'}`} data-testid="freshness">
        {stale ? 'Stale · ' : ''}updated {age < 60000 ? 'just now' : `${formatDuration(age)} ago`}
      </span>
      {loading ? <span className="badge">refreshing…</span> : null}
      {stored.status.modelB ? null : <span className="badge warn">only one forecast available</span>}
      {shownError ? (
        <span className="muted" data-testid="refresh-error">
          Refresh failed: {shownError}
          {stored.status.stale ? ' — showing the last data' : ''}
        </span>
      ) : null}
    </div>
  );
}
