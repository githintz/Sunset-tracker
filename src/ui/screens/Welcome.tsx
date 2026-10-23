import { SpotSearch, GpsButton } from './Spots';
import { navigate } from '../App';

export function WelcomeScreen() {
  return (
    <div data-testid="welcome">
      <section className="card hero">
        <h1 style={{ fontSize: '1.5rem' }}>Will tonight’s sky light up?</h1>
        <p>
          Glowcast follows the sun’s last light along its path for 350 km, checks which clouds it reaches and how much colour they can
          catch, and turns that into a simple verdict for sunrise and sunset.
        </p>
        <p className="small muted">Add your first spot to get started. Everything is computed on this device.</p>
      </section>
      <section className="card">
        <SpotSearch onAdded={() => navigate('today')} />
        <div className="row wrap">
          <GpsButton onAdded={() => navigate('today')} />
          <button className="btn ghost" onClick={() => navigate('maps')}>
            ⌖ Pick on the map
          </button>
        </div>
      </section>
    </div>
  );
}
