# Progress

Phases from the brief (§12). A phase starts only after the previous gate passes.

- [ ] **1. Scaffold** — repo, CI skeleton, Pages deploy of a hello-world PWA. Gate: live URL loads.
- [ ] **2. Data layer + fixtures** — Gate: recorder works; all requests typed and parsed; budget estimator tested.
- [ ] **3. Engines** (§4–6) — Gate: §11 engine tests pass; coverage ≥ 90 % on `src/engine/`.
- [ ] **4. UI** (§7) — Gate: Playwright e2e passes on fixtures and against the live API for 3 spots.
- [ ] **5. Maps workflow** (§8) — Gate: one scheduled run succeeds and the map renders on the live site.
- [ ] **6. Android** (§10) — Gate: signed APK built in Actions, emulator smoke test green, screenshots uploaded.
- [ ] **7. Independent verification** — two fresh-context reviews, `docs/VERIFICATION.md`, 7-day live comparison.
- [ ] **8. Release** — tag `v1.0.0`, Release carries the APK.
