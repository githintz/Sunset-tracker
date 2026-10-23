# Glowcast

Sunset and sunrise quality forecasts for landscape photographers. It ships as a PWA on GitHub Pages and
as an Android app, both built from the same TypeScript code. All forecast maths runs on the device;
there is no backend. The only server-side work is a scheduled GitHub Action that precomputes the map
grids.

- **Live PWA:** https://githintz.github.io/Sunset-tracker/
- **Android APK:** attached to each GitHub Release (`v*` tags), built and signed by `android.yml`.
- **Shareable spot links:** `https://githintz.github.io/Sunset-tracker/#/today?spot=46.0,7.75&name=Gornergrat&alt=2770`
  (Android: `glowcast://spot?spot=…`).

Weather data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0). Aerosols: CAMS. Terrain: Copernicus DEM.
Map tiles © OpenStreetMap contributors. Non-commercial, personal use only.

## How the rating works

The app follows the sun's bearing from your spot out to 350 km and samples two weather models along it:

- **Canvas** — the cloud overhead that the light lands on
- **Reach** — cloud at the height of the observer's tangent ray (h = d²/2R) that would block the light
- **Lit** — which cloud bases get direct light while the sun sinks below the horizon
- **Air** and **rain** — modifiers for aerosols, visibility, humidity and rain

The rating is `5 × canvas × reach × lit × air × rain`, averaged over the event moment, a best-light moment
and the second model. Missing data always counts as the worst case and is shown as a gap. Every constant
is in `src/engine/config.ts`; every assumption is in `docs/DECISIONS.md`.

## Development

```bash
npm ci
npm run dev            # http://localhost:5173
npm test               # unit + property tests (offline, recorded fixtures)
npm run test:coverage  # CI gate: src/engine ≥ 90 % lines
npm run build:pages && npm run e2e   # Playwright against the Pages bundle (fixtures)
npm run build:android && npx cap sync android && (cd android && ./gradlew assembleRelease)
```

| Workflow | When | What |
|---|---|---|
| `pages.yml` | every push | typecheck, lint, unit tests + coverage gate, build, Playwright e2e, deploy (default branch) |
| `android.yml` | every push, `v*` tags | signed APK, apksigner/aapt checks, API 34 emulator smoke test, Release on tags |
| `maps.yml` | every 3 h | recompute map grids (Alps, 0.25°) and redeploy |
| `live.yml` | daily | Playwright against the live API (3 spots) and a 7-day, 5-spot model comparison |
| `fixtures.yml` | manual | re-record Open-Meteo fixtures and commit them |
| `keepalive.yml` | monthly | keeps the scheduled workflows enabled |

### Android signing

Releases are signed with a keystore held in four repository secrets: `ANDROID_KEYSTORE_BASE64`,
`KEYSTORE_PASSWORD`, `KEY_ALIAS` and `KEY_PASSWORD`. Create them once with
`bash scripts/create-keystore.sh` (needs a JDK and a logged-in `gh`). Never commit the keystore. Without
these secrets CI signs with a throwaway key and warns: the APK installs, but later builds will not
install over it.

### Scheduled workflows

GitHub disables scheduled workflows on public repositories after 60 days without activity.
`keepalive.yml` re-enables them every month. If they get disabled anyway, re-enable them under
**Actions → Maps → Enable workflow**.

### API budget

A full refresh of one spot costs about 160 Open-Meteo calls; results are cached for 60 minutes. A map run
costs about 1,170 calls, eight times a day. Both stay under the free tier's 10,000 calls/day; see
`docs/DECISIONS.md` for the breakdown.
