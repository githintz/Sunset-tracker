# Glowcast

Sunset and sunrise quality forecasts for landscape photographers — a PWA on GitHub Pages and an Android
app built from the same TypeScript code. All forecast maths runs on the device; there is no backend.

- **Live PWA:** https://githintz.github.io/Sunset-tracker/
- **Android APK:** attached to each GitHub Release (`v*` tags).

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). Map tiles © OpenStreetMap
contributors. Non-commercial, personal use only.

## Development

```bash
npm ci
npm run dev            # http://localhost:5173
npm test               # unit + property tests (offline, fixtures)
npm run e2e            # Playwright against the built Pages bundle (fixtures)
npm run build:pages    # base /Sunset-tracker/
npm run build:android  # base /
```

See `docs/DECISIONS.md` for every modelling assumption and `docs/PROGRESS.md` for status.

## Scheduled workflows

`maps.yml` recomputes the map grids every 3 hours. GitHub disables scheduled workflows on public
repositories after 60 days without activity; `keepalive.yml` re-enables them monthly. If they were
disabled anyway, re-enable them under **Actions → Maps → Enable workflow**.
