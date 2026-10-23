import { ENGINE_VERSION } from '../engine/config';

export function App() {
  return (
    <main className="app" data-testid="app-ready">
      <h1>Glowcast</h1>
      <p>Sunset &amp; sunrise forecasts for photographers.</p>
      <p className="muted">
        App {__APP_VERSION__} · engine {ENGINE_VERSION}
      </p>
    </main>
  );
}
