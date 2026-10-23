# Progress

Phases from the brief (§12). A phase starts only after the previous gate passes.

- [x] **1. Scaffold** — repo, CI skeleton, Pages deploy. Gate passed: https://githintz.github.io/Sunset-tracker/
  loads (verified externally 2026-10-23).
- [x] **2. Data layer + fixtures** — typed builders/parsers for all Open-Meteo requests, `estimateCalls()`,
  per-day counter, 60-min cache with stale fallback, retries/backoff. Fixtures recorded in GitHub Actions
  (`fixtures.yml`) for Zürich, Gornergrat (2770 m), Tokyo, mid-Atlantic, Tromsø + geocoding.
- [x] **3. Engines** (§4–6) — sunset/sunrise, golden hour, sky, phenomena, terrain, day/night regimes,
  blue hour. Gate passed: all §11 engine tests green, `src/engine` line coverage ≈ 99 % (CI gate ≥ 90 %).
- [x] **4. UI** (§7) — eight screens. Gate passed: Playwright e2e on fixtures (21 tests) and against the
  live API for 3 spots (`live.yml`).
- [x] **5. Maps workflow** (§8) — `maps.yml` every 3 h. A run succeeded and the deploy race that wiped the
  grids was fixed; re-verifying the grids on the live site.
- [x] **6. Android** (§10) — signed APK built in Actions, apksigner/aapt checks, API 34 emulator smoke test
  green with a live forecast, screenshots uploaded. Persistent signing key: secrets handed to the owner.
- [ ] **7. Independent verification** — two fresh-context reviews, `docs/VERIFICATION.md`; 7-day live
  comparison ran (74 rated events, 33 distinct ratings, SD 1.45).
- [ ] **8. Release** — tag `v1.0.0`, Release carries the APK.
