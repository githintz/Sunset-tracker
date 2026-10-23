import { useEffect, useState } from 'react';
import { AppProvider, useApp } from './state';
import { TodayScreen } from './screens/Today';
import { CrossSectionScreen } from './screens/CrossSection';
import { TimelineScreen } from './screens/Timeline';
import { OutlookScreen } from './screens/Outlook';
import { MapScreen } from './screens/MapScreen';
import { SpotsScreen } from './screens/Spots';
import { HistoryScreen } from './screens/History';
import { AboutScreen } from './screens/About';
import { WelcomeScreen } from './screens/Welcome';
import { tzAbbrev } from '../engine/time';

export type Route = 'today' | 'path' | 'timeline' | 'outlook' | 'maps' | 'spots' | 'history' | 'about';
const ROUTES: Route[] = ['today', 'path', 'timeline', 'outlook', 'maps', 'spots', 'history', 'about'];

function readRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0] as Route;
  return ROUTES.includes(h) ? h : 'today';
}

export function navigate(r: Route | `${Route}?${string}`) {
  window.location.hash = `#/${r}`;
}

const NAV: Array<[Route, string, string]> = [
  ['today', '☀', 'Today'],
  ['path', '⟋', 'Light path'],
  ['timeline', '◷', 'Timeline'],
  ['outlook', '☁', '48 h'],
  ['maps', '⌖', 'Maps'],
];

function Shell() {
  const app = useApp();
  const [route, setRoute] = useState<Route>(readRoute);
  useEffect(() => {
    const on = () => setRoute(readRoute());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  if (!app.ready) {
    return (
      <div className="shell" data-testid="booting">
        <main className="content muted">Loading…</main>
      </div>
    );
  }
  const noSpots = app.spots.length === 0;
  const f = app.forecast;
  const stored = f.phase === 'ready' ? f.stored : f.phase === 'loading' ? f.stored : null;
  const tz = stored?.forecast.observer.timezone ?? app.active?.timezone ?? null;
  const refreshing = f.phase === 'loading' || (f.phase === 'ready' && f.refreshing);

  return (
    <div className="shell" data-testid="app-ready">
      <header className="topbar">
        <button className="spot-button" onClick={() => navigate('spots')} aria-label="Change spot" data-testid="spot-button">
          <span className="name ellipsis" data-testid="spot-name">
            {app.active?.name ?? 'Glowcast'}
          </span>
          <span className="tiny muted ellipsis">
            {app.active ? (
              <>
                {app.active.lat.toFixed(3)}, {app.active.lon.toFixed(3)}
                {tz ? ` · times in ${tzAbbrev(app.now, tz)} (${tz})` : ''}
              </>
            ) : (
              'Sunset & sunrise forecasts'
            )}
          </span>
        </button>
        {app.active ? (
          <button className="icon-btn" onClick={() => app.refresh(true)} disabled={refreshing} aria-label="Refresh forecast" data-testid="refresh">
            {refreshing ? '…' : '⟳'}
          </button>
        ) : null}
        <button className="icon-btn" onClick={() => navigate(route === 'about' ? 'history' : 'about')} aria-label="More" data-testid="more">
          ⋯
        </button>
      </header>
      <main className="content">
        {noSpots && route !== 'about' && route !== 'spots' && route !== 'maps' ? (
          <WelcomeScreen />
        ) : route === 'today' ? (
          <TodayScreen />
        ) : route === 'path' ? (
          <CrossSectionScreen />
        ) : route === 'timeline' ? (
          <TimelineScreen />
        ) : route === 'outlook' ? (
          <OutlookScreen />
        ) : route === 'maps' ? (
          <MapScreen />
        ) : route === 'spots' ? (
          <SpotsScreen />
        ) : route === 'history' ? (
          <HistoryScreen />
        ) : (
          <AboutScreen />
        )}
      </main>
      <nav className="bottomnav" aria-label="Main">
        {NAV.map(([r, ico, label]) => (
          <button key={r} aria-current={route === r ? 'page' : undefined} onClick={() => navigate(r)} data-testid={`nav-${r}`}>
            <span className="ico" aria-hidden="true">
              {ico}
            </span>
            <span className="lbl">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
