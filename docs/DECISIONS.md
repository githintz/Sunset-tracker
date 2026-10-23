# Decisions and assumptions

Every assumption made while building Glowcast, newest last. "Tunable" means the value lives in
`src/engine/config.ts`; changing a scoring value bumps `ENGINE_VERSION`.

## Environment

- **Repository / URLs.** `githintz/Sunset-tracker`; Pages base path `/Sunset-tracker/`; Android app id
  `io.github.githintz.glowcast`. The repo was made public so GitHub Pages works on the free plan.
- **Network.** The development sandbox cannot reach `api.open-meteo.com`, so fixture recording and live
  checks run in GitHub Actions (`fixtures.yml`, `live.yml`) — the fallback the brief allows.
- **Branches.** All work happens on the session branch; CI runs on every branch and deploys only from the
  repository's default branch (or a scheduled maps run).
- **Toolchain.** TypeScript is pinned to 6.0.x because `typescript-eslint` 8.x supports `<6.1`
  (TypeScript 7, the native compiler, is not yet supported by the linter). `npm audit` reports a moderate
  advisory in `uuid` via `@capacitor/cli` → `xcode` (iOS project tooling, build-time only, never shipped).

## Astronomy

- Solar position uses the NOAA (Meeus) algorithm; events are found by root-finding on altitude rather
  than the closed-form hour angle, so polar day/night simply yields "no sunset"/"no sunrise".
- **Two event times.** The *official* time (upper limb at −0.833°, what almanacs print) is displayed. The
  engine's *event moment* is the sun's centre on the geometric horizon (0°), consistent with the
  refraction-free ray geometry (δ = solar depression below that horizon). They differ by 2–5 minutes.
- Reference data for tests: US Naval Observatory API (`aa.usno.navy.mil/api/rstt/oneday`), 13 cases.
- Moon: `suncalc` 2.x (MIT; degrees, north-based azimuth). Ground brightness ≈ illumination^1.5 × sin(alt)
  is our own approximation.
- Galactic core: RA 17h45m40s, Dec −29° (J2000, precession ignored — < 0.5°).

## Sunset engine

- Canvas weights (−5, 0, +5, +20 km) = 0.15 / 0.30 / 0.30 / 0.25 (tunable).
- Canvas shape: mid+high combined by random overlap; full value 25–75 %; closed upper deck 0.45; clear sky
  pale glow 0.15; low cloud hides 90 % of the upper canvas; thick low deck ≈ 0.05; above the deck
  (undercast) 0.5 + 0.3 × low cover, never worse than the below-deck value.
- "Above the deck" needs complete pressure-level data: the deck is the lowest contiguous run of levels
  with ≥ 50 % cover; the observer must be ≥ 100 m above its top. Unresolvable → treated as below.
- Corridor blocking uses cover at the tangent ray's absolute altitude × opacity (low 1.0 / mid 0.8 /
  high 0.5 by height above that point's ground). Path-length weights: each corridor point represents
  the stretch halfway to its neighbours (50/50/50/75/75/50 km).
- Cloud at a height: linear interpolation between the two bracketing pressure levels using their real
  geopotential heights. Band fallback (low < 3 km, mid 3–8 km, high ≥ 8 km above ground) takes the
  larger of two bands within 1.6 km of a band boundary, because band data cannot say where in the band
  the cloud sits — the pessimistic choice keeps "missing data never raises a score".
- Lit test: each canvas cloud target (pressure level ≥ 10 % cover, or the band's representative height
  1.5/5/9.5 km in band-only mode) is lit if, at any 0.25° depression step up to δmax, no sampled point on
  its path toward the sun has cover × opacity ≥ 0.6. The path beyond 350 km is not sampled.
- Air modifier = 1 + AOD term (−0.05…+0.04) + visibility term (−0.05…+0.03) + humidity term
  (−0.05…+0.02), clamped 0.85–1.10. AOD 0.1–0.3 is "moderate" (bonus).
- Rain = 1 − 0.6 × max(probability ramp 40→90 %, amount ramp 0→2 mm/h) over the canvas; floor 0.4.
- Overcast = total cloud ≥ 97 %. Only when *every* one of the 10 calculation points is overcast (or
  unknown) is the score forced to 0.
- Best-light moment = 10 minutes after the event moment (before, for sunrise).
- **Missing data policy.** Every unknown takes the worst case for its factor: unknown canvas point → 0
  canvas and a full unlit target; unknown corridor cover → 100 %; unknown path point → blocking; unknown
  air inputs → component minimum; unknown rain → maximum penalty; unknown total cloud → "possibly
  overcast". Property tests null arbitrary inputs and assert the score never rises. Model B missing
  entirely is a separate, documented case ("only one forecast available").
- One corridor per bearing (next sunset, next sunrise) serves all three days; the sun's azimuth drifts
  ≲ 1.5°/day, i.e. a few km at the far end of the corridor by day 3.

## Data

- Second model: `ecmwf_ifs025` (ECMWF IFS 0.25°). Checked on recorded responses: the 9 km HRES run
  (`ecmwf_ifs`) returns every pressure-level variable as null on the free API, so it is only the fallback
  (used if `ecmwf_ifs025` is refused with HTTP 400). ECMWF's pressure-level cloud cover is derived from
  relative humidity (Sundqvist) and only levels 1000/925/850/700/600/500/400/300/250/200 hPa exist, so
  model B requests those ten. Because of the RH derivation, ECMWF often shows more upper cloud than the
  primary model; in the first 7-day live comparison the two agreed within 1 point on 39 of 74 events. The
  "models disagree" badge and lower confidence surface this.
- A model may not publish every requested level (e.g. `best_match` has no 950/900/800 hPa at Tromsø).
  Levels that are null at every point and time are dropped at parse time (not "missing"); fewer than 5
  published levels → band-only mode.
- Corridors request `surface_pressure`; levels with a higher pressure (+5 hPa tolerance) are below the
  model's ground and are ignored. Found via the live comparison, where extrapolated sub-surface fog at
  1000 hPa made a 409 m spot look "above the low cloud".
- One past day is requested with every forecast (no extra cost: ≤ 14 days per call) so today's earlier
  sunrise/sunset is rated too.
- If the primary model has no data for an event, the second model stands in and the reasons say so.
- Overcast for the zero rule means opaque low+mid cloud (random overlap) ≥ 97 %; cirrostratus alone does
  not count (ECMWF reports ~98 % total cloud under thin cirrus).
- Model B is requested only at the 10 calculation points (chart-only points are drawn from model A).
- Call cost: per location max(1, vars/10) × max(1, days/14). Elevation requests are assumed to cost one
  call each (Open-Meteo does not document it). See README for the per-refresh figure.

## Cost per refresh (estimated, Open-Meteo's counting rules)

| Request | Locations | Variables | Calls |
|---|---|---|---|
| Elevation profile (both bearings, 91 coords) | 91 | – | 1 (assumed) |
| Primary model, sunset corridor | 14 | 35 | 49 |
| Primary model, sunrise corridor | 14 | 35 | 49 |
| ECMWF, sunset corridor | 10 | 29 | 29 |
| ECMWF, sunrise corridor | 10 | 29 | 29 |
| Viewpoint column | 1 | 18 | 1.8 |
| Aerosols | 1 | 2 | 1 |
| **Total** | | | **≈ 160** |

This is above the brief's "≤ ~120" target. The extra comes from the second model (58 calls). The cheaper
alternatives were dropping pressure levels from model B (it then scores from coarse bands, which the
first fixture run showed is systematically pessimistic) or rating sunrise only on demand. We kept both
models for both events, because the comparison is what makes the "models disagree" flag useful. With
the 60-minute cache, the free tier allows ~60 full refreshes a day.

Map run (default Alps box, 0.25°): 23 × 51 = 1,173 cells, 5 variables → 1,173 calls per run, 12 batched
requests spaced 12 s apart (< 600 calls/min). 8 runs a day ≈ 9,400 calls, under the 10,000/day limit but
close to it. Shrink the box or use 0.5° (≈ 300 calls/run) for more headroom.

## Maps

- Grid cells are scored with the same engine in band-only mode (no pressure levels, no aerosols,
  observer at 0 m) by bilinear interpolation of the grid along each cell's own sun bearing. Corridor
  points outside the grid are unknown → worst case, so cells near the sunward edge read low.
- Frames: cloud layers and dark sky every 3 h; underlight per local day (Europe/Zurich) for sunset and
  sunrise. Bytes 0–254, 255 = no data, base64 in one JSON per layer.
- Code-only deploys keep the live grids by fetching them inside the serialized deploy job.

## Android

- Capacitor 8: minSdk 24, compile/targetSdk 36, AGP 8.13, Gradle 8.14.3, JDK 21.
- Background fetch on Android needs a foreground service or WorkManager plugin to be reliable; we do
  not ship one. Alerts are planned from the latest forecast each time the app refreshes (opening the app
  or "Check now"), plus an optional daily reminder notification. If the app is not opened, alerts use the
  last forecast, which may be up to a day old.
- Signing: a persistent keystore in repository secrets; without them CI signs with a throwaway key and
  warns (the APK installs, but later builds won't install over it).
- WebView console output is forwarded to logcat in release builds (`loggingBehavior: 'production'`) so
  the emulator smoke test can fail on console errors.
- Deep links `glowcast://spot?spot=lat,lon&name=…&alt=…` open a spot (used by the smoke test).
