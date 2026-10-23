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

- Second model: ECMWF IFS HRES 9 km (`ecmwf_ifs`) is on the free API; if refused (HTTP 400) we fall back
  to `ecmwf_ifs025`. ECMWF's pressure-level cloud cover is derived from relative humidity (Sundqvist) and
  only levels 1000/925/850/700/600/500/400/300/250/200 hPa exist, so model B requests those ten.
- Model B is requested only at the 10 calculation points (chart-only points are drawn from model A).
- Call cost: per location max(1, vars/10) × max(1, days/14). Elevation requests are assumed to cost one
  call each (Open-Meteo does not document it). See README for the per-refresh figure.
