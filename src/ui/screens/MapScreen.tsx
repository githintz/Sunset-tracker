import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useApp } from '../state';
import { Sheet, Tabs } from '../components';
import { mapsBaseUrl } from '../../native/platform';
import { decodeBytes, NO_DATA, ramp, type MapIndex, type MapLayerFile, type LayerId } from '../../maps/format';
import { makeSpot } from '../../app/spots';
import { navigate } from '../App';
import { formatDayLabel, formatTime } from '../../engine/time';

type Group = 'underlight' | 'cloud' | 'darksky';

const GROUP_LAYERS: Record<Group, LayerId[]> = {
  underlight: ['underlight-sunset', 'underlight-sunrise'],
  cloud: ['cloud-low', 'cloud-mid', 'cloud-high', 'cloud-total'],
  darksky: ['darksky'],
};

const LAYER_NAME: Record<LayerId, string> = {
  'underlight-sunset': 'Sunset',
  'underlight-sunrise': 'Sunrise',
  'cloud-low': 'Low',
  'cloud-mid': 'Mid',
  'cloud-high': 'High',
  'cloud-total': 'Total',
  darksky: 'Dark sky',
};

export function MapScreen() {
  const app = useApp();
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const overlay = useRef<L.LayerGroup | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const [index, setIndex] = useState<MapIndex | null>(null);
  const [indexErr, setIndexErr] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>('underlight');
  const [layerId, setLayerId] = useState<LayerId>('underlight-sunset');
  const [layer, setLayer] = useState<MapLayerFile | null>(null);
  const [frame, setFrame] = useState(0);
  const [pending, setPending] = useState<{ lat: number; lon: number } | null>(null);
  const [pendingName, setPendingName] = useState('');
  const base = mapsBaseUrl();

  // map init
  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView(
      app.active ? [app.active.lat, app.active.lon] : [46.8, 10.2],
      app.active ? 8 : 6,
    );
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    overlay.current = L.layerGroup().addTo(m);
    markers.current = L.layerGroup().addTo(m);
    // Long-press (touch) or right-click (mouse) adds a spot.
    m.on('contextmenu', (e: L.LeafletMouseEvent) => {
      setPending({ lat: e.latlng.lat, lon: e.latlng.lng });
      setPendingName('');
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // spot markers
  useEffect(() => {
    const g = markers.current;
    if (!g) return;
    g.clearLayers();
    for (const s of app.spots) {
      L.circleMarker([s.lat, s.lon], { radius: 7, color: '#fff', weight: 2, fillColor: s.id === app.active?.id ? '#ff8a3d' : '#7d7396', fillOpacity: 1 })
        .bindTooltip(s.name)
        .on('click', () => {
          app.setActive(s.id);
          navigate('today');
        })
        .addTo(g);
    }
  }, [app.spots, app.active]); // eslint-disable-line react-hooks/exhaustive-deps

  // grid index
  useEffect(() => {
    let off = false;
    fetch(`${base}index.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? (r.json() as Promise<MapIndex>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => !off && setIndex(j))
      .catch((e: Error) => !off && setIndexErr(e.message));
    return () => {
      off = true;
    };
  }, [base]);

  // layer file
  useEffect(() => {
    const entry = index?.layers?.find((l) => l.id === layerId);
    if (!entry) {
      setLayer(null);
      return;
    }
    let off = false;
    fetch(`${base}${entry.file}`)
      .then((r) => (r.ok ? (r.json() as Promise<MapLayerFile>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => {
        if (off) return;
        setLayer(j);
        const now = Date.now();
        const i = j.frames.findIndex((f) => f.t >= now - 90 * 60000);
        setFrame(Math.max(0, i));
      })
      .catch(() => !off && setLayer(null));
    return () => {
      off = true;
    };
  }, [index, layerId, base]);

  // draw frame
  const values = useMemo(() => (layer?.frames[frame] ? decodeBytes(layer.frames[frame]!.data) : null), [layer, frame]);
  useEffect(() => {
    const g = overlay.current;
    if (!g) return;
    g.clearLayers();
    if (!index?.bbox || !index.step || !index.nLat || !index.nLon || !values || !layer) return;
    const { latMin, lonMin } = index.bbox;
    const h = index.step / 2;
    for (let i = 0; i < index.nLat; i++) {
      for (let j = 0; j < index.nLon; j++) {
        const b = values[i * index.nLon + j]!;
        const lat = latMin + i * index.step;
        const lon = lonMin + j * index.step;
        const rect: L.LatLngBoundsExpression = [
          [lat - h, lon - h],
          [lat + h, lon + h],
        ];
        if (b === NO_DATA) {
          L.rectangle(rect, { stroke: false, fillColor: '#ff7a7a', fillOpacity: 0.12, interactive: false }).addTo(g);
          continue;
        }
        const v = b / layer.scale / layer.max;
        const [r, gg, bb] = ramp(v);
        L.rectangle(rect, { stroke: false, fillColor: `rgb(${r},${gg},${bb})`, fillOpacity: 0.55, interactive: false }).addTo(g);
      }
    }
  }, [values, index, layer]);

  const tz = app.active?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const fr = layer?.frames[frame];
  return (
    <>
      <h2>Maps</h2>
      <Tabs
        label="Map layer group"
        value={group}
        onChange={(g) => {
          setGroup(g);
          setLayerId(GROUP_LAYERS[g][0]!);
        }}
        options={[
          ['underlight', 'Underlight'],
          ['cloud', 'Cloud layers'],
          ['darksky', 'Dark sky'],
        ]}
      />
      {GROUP_LAYERS[group].length > 1 ? (
        <Tabs label="Layer" value={layerId} onChange={setLayerId} options={GROUP_LAYERS[group].map((id) => [id, LAYER_NAME[id]])} />
      ) : null}
      <div className="map-box" ref={el} data-testid="map" />
      <div style={{ marginTop: 10 }}>
        {layer && layer.frames.length ? (
          <>
            <input
              type="range"
              min={0}
              max={layer.frames.length - 1}
              value={frame}
              onChange={(e) => setFrame(Number(e.target.value))}
              aria-label="Time"
              data-testid="map-slider"
            />
            <div className="row small">
              <span>{fr ? fr.label || `${formatDayLabel(fr.t, tz, Date.now())} ${formatTime(fr.t, tz)}` : ''}</span>
              <span className="spacer" />
              <span className="muted">
                {layer.label} ({layer.unit})
              </span>
            </div>
            <div className="timeline-bar" aria-hidden="true" style={{ height: 8 }}>
              {Array.from({ length: 10 }, (_, i) => {
                const [r, g, b] = ramp(i / 9);
                return <span key={i} style={{ width: '10%', background: `rgb(${r},${g},${b})` }} />;
              })}
            </div>
            <div className="row tiny muted">
              <span>low</span>
              <span className="spacer" />
              <span>high</span>
            </div>
          </>
        ) : (
          <p className="small muted" data-testid="map-nodata">
            {indexErr ? `Map grids unavailable (${indexErr}).` : index && !index.layers?.length ? 'Map grids have not been computed yet.' : 'Loading map grids…'} Long-press
            (or right-click) anywhere to add a spot.
          </p>
        )}
        <p className="tiny muted">
          Precomputed every 3 h for the Alps region with a simplified engine (band data, no aerosols). Red tint = no data.
          {index?.generatedAt ? ` Generated ${new Date(index.generatedAt).toLocaleString()}.` : ''} Long-press to add a spot.
        </p>
      </div>
      {pending ? (
        <Sheet title="Add a spot here?" onClose={() => setPending(null)}>
          <p className="small muted">
            {pending.lat.toFixed(4)}, {pending.lon.toFixed(4)}
          </p>
          <label className="field">
            Name
            <input type="text" value={pendingName} onChange={(e) => setPendingName(e.target.value)} placeholder="My viewpoint" data-testid="pending-name" />
          </label>
          <button
            className="btn primary"
            onClick={() => {
              app.addSpot(makeSpot(pendingName || `Spot ${pending.lat.toFixed(3)}, ${pending.lon.toFixed(3)}`, pending.lat, pending.lon));
              setPending(null);
              navigate('today');
            }}
            data-testid="add-pending"
          >
            Add spot
          </button>
        </Sheet>
      ) : null}
    </>
  );
}
