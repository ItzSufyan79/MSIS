# MSIS → SIH'26 Winning Submission — Complete Roadmap

**PS 26143** (NTRO · Disaster Management): *"Leveraging satellite imagery to determine oil
spills at sea along with AIS data correlations to identify vessel responsible for the spill."*

**Grading target** (SIH 2026 rubric, 100 pts):
Problem Understanding 10 · Innovation 20 · Technical Feasibility 15 · Prototype Quality 15 ·
Technical Implementation 10 · Impact & Scalability 10 · UI/UX 5 · Presentation 10 · Q&A 5.

---

## Current state (audit verdict — Sept 2026)

| Area | Status |
|---|---|
| Map rendering (MapLibre + WebGL shaders) | 🟢 Real, impressive |
| Satellite tracking (SGP4, CelesTrak, pass prediction) | 🟢 Real, strong |
| Export (CSV/GeoJSON) | 🟢 Real |
| Docker / standalone build | 🟢 Production-grade |
| **Detect** (SAR classifier) | 🔴 Byte-hash mock (`spill-upload.ts`) |
| **Trace** (origin + drift) | 🔴 Hardcoded coords (`marine-spill.ts`) |
| **Investigate** (AIS attribution) | 🔴 4 hardcoded vessels, not connected to `/api/maritime` |
| **Predict** (6/12/24h) | 🔴 Data exists, **never rendered** (no `msis-forecast` layer) |
| Ocean metrics | 🔴 `sin()` of coordinates (`ocean-metrics.ts`) |
| ML / SAR ingestion / GeoTIFF parsing | 🔴 None |
| Auth / rate-limiting | 🔴 None |
| OSIRIS residue | 🔴 ~1,200 dead lines, misleading docs/SEO/env |

**The winning move:** the app already has the WOW (3D globe, WebGL, live satellites).
What's missing is that the *core problem answer* — detect the spill and name the vessel —
is fake. Fixing Detect/Trace/Investigate/Predict with real data turns a pretty demo into
a defensible national-level solution.

---

## PHASE 0 — Kill the lies, harden the base (2–3 days) · Feasibility 15/15 → safety net

Nothing scores if the demo crashes or a judge catches a mock.

1. **Fix the orbit 404 bug** — `src/app/api/satellites/orbit/route.ts:80`
   `String(Number(id))` breaks NORAD ids <10000 → use `id.padStart(5,'0')` like `monitor/route.ts:93`.
2. **Fix cold-cache 503** — `satellites/monitor/route.ts` reads only disk cache and never
   fetches CelesTrak; make `/orbit` + `/monitor` trigger a fetch when cache is empty/older than 1h.
3. **Delete the decayed ISS fallback** — `satellites/route.ts:282-283` (epoch 2024); return
   `satellites: []` + `error` instead of a wrong position.
4. **Purge OSIRIS dead code** (~1,200 lines, ~98 of 225 tests hitting dead code):
   - Delete: `CctvPreviews.tsx`, `LiveNewsPreviews.tsx`, `lib/malware-intel.ts`,
     `lib/draw.ts`, `lib/map-tile-layout.ts`, `lib/camera-preview.ts`, `stealthFetch.ts`.
   - Delete `intel/` service + its compose block + Dockerfile (776 orphaned lines, unauthenticated `/resolve`).
   - Delete `engine/__pycache__`, `runs/`, `scratch/`, `scripts/shot-design1.mjs`.
5. **Slash `MsisMap.tsx`** from 3,163 → ~600 lines by removing dead `sdk-*`/cyber layer ids,
   `arrivalBeacons`, `/api/aircraft` + `/api/flight-route` fetches (404s).
6. **Rewrite `.env.example`** — advertise only the 4 real vars (`AIS_API_KEY`, `MSIS_PORT`,
   `UMAMI_URL`, `UMAMI_WEBSITE_ID`); drop SCANNER/OSIRIS_*/FIRMS/OpenSky/N2YO fiction.
7. **Rotate `VERCEL_OIDC_TOKEN`** in `.env.local` (plaintext bearer cred).
8. **Correct the 13 stale `docs/MSIS/*.md`** — Mapbox→MapLibre, 19k sats not "2,000+",
   31 spills not 30, remove `msis-forecast` claims until Phase 4 renders it.

**Exit criteria:** clean build, 225 tests minus dead-code tests still green, no osiris refs,
every API route tested (add first Vitest route tests with mocked fetch/fs).

---

## PHASE 1 — Make DETECT real: containerised SAR engine (4–6 days) · Innovation 20/20 target

This is the heart of the PS. The `hashBytes()`/`darkDensity()` classifier must go.

**Build a Python engine (the missing `engine/`) as the standalone model backend:**
```
engine/
  Dockerfile            # python:3.11-slim, FastAPI + rasterio/opencv
  main.py               # POST /analyze (GeoTIFF/PNG) → SpillEvent JSON
  detect.py             # speckle filter → Otsu/adaptive threshold → dark-slick mask
  geotiff.py            # real ModelTiepoint/ModelPixelScale/GeoKey parsing
  segment.py            # connected components → polygon(s), area, L/W, perimeter
  lookalikes.py         # wind(wave) mask + SST checks to reject algae/wakes/rain cells
  classify.py           # CNN (tiny, ~30k params) OR decision tree on shape+backscatter stats
  fixtures/             # 10-15 labelled Sentinel-1 scenes (Zenodo S1 dark-spot catalogues)
```
- **Detect:** SAR amplitude → despeckle → dark-patch threshold → **real mask + contour**.
- **Characterize:** area from mask **georeferenced via real tie-points**, thickness proxy from
  polarisation ratio (VV/HV), age/morphology.
- **Reject look-alikes:** cross-check wind field (GFS/ERA5) + SST + wave state —
  this is the "out of the box" thinking judges reward; cite Chemical/biological false positives.
- **Fallback demo path:** bundle 5-8 GeoTIFF fixtures so the demo runs **offline** at the
  finale (network is guaranteed bad). "Upload" accepts: live Sentinel Hub URL **or** local file.

**Frontend:** `UploadAnalyze.tsx` POST → engine; render returned mask polygon via real
`msis-spill-fill` layer (not the static one). Label `confidence` + rejected-lookalike notices.

**Exit criteria:** uploading a real Sentinel-1 scene returns a measured slick polygon with
real area + confidence; false-positive rejection demo'd on a known clean-sea scene.

---

## PHASE 2 — Make TRACE + PREDICT real: drift physics (3–5 days) · Feasibility + Impact

Replace the hardcoded 5-point polygon/drift/forecast in `marine-spill.ts`.

- **Pull fields:** CMEMS ocean currents (0.25°, `sea_current_velocity`) + NOAA GFS winds (0.25°)
  in the engine, cached 6h. Fall back to bundled climatology for offline demo.
- **Backtrack (Trace):** Euler reverse-advection from detected polygon over the last 12–24h →
  origin zone ellipse **computed**, then rendered on `msis-origin`.
- **Forecast (Predict):** forward advection + windage (≈1–4% wind speed) + Monte-Carlo
  perturbations → probabilistic cone on `msis-forecast` layer (12h/24h/72h).
- **Aging:** evaporation/emulsification vs time (SST + wind), so the panel shows
  "weathered ~X%" not a frozen number.
- **Wire `ocean-metrics.ts`** to the same CMEMS/GFS fields so the bottom-bar SST/wind/sea-state
  badge and the simulation **agree** (today they're disconnected `sin()`s).

**Exit criteria:** given a spill polygon + time, the app draws a plausible origin ellipse and a
12/24/72h cone that visibly respects wind direction and current; numbers match exported CSV.

---

## PHASE 3 — Make INVESTIGATE real: AIS attribution (4–6 days) · THE differentiator

The PS explicitly wants the *responsible vessel*. This stage is arguably worth the most marks.

- **Data:** NOAA MarineCadastre AIS archive (`accessais`), or a **synthetic 30-day AIS stream**
  generated around the incident box/time (PS explicitly permits synthetic) — replayed so the
  demo shows a realistic replay of the event.
- **Attribution engine (in `engine/`, stage 3):**
  1. Reconstruct vessel tracks inside origin window (±t of estimated spill time, clipped to
     origin ellipse + drift back-cone).
  2. Score each vessel — all four bars `SpillPanel` currently renders:
     - **Proximity** — min great-circle distance track↔origin (0–1)
     - **Trajectory** — heading consistent with leaving the source region, speed ≤4kn in cell
     - **Behaviour/anomaly** — dark hours / SOG discontinuity / AIS gaps that hide offloading / cargo
     - **Composite** — weighted → ranked suspect list.
  3. Return ranked list + per-vessel reasoning strings (real, not authored).
- **Connect live AIS too:** join `/api/maritime` ship cache to the cone so ongoing events show
  live candidate vessels; known incident shows archive replay.

**Exit criteria:** demo with Deepwater Horizon-like fixture → picks the reported culprit vessel
in the top-3 with scores + reason; CSV/GeoJSON export includes the ranking.

---

## PHASE 4 — Close the product loop (2–3 days) · Prototype Quality 15/15

- Render `msis-forecast` dashed layer + a **12/24/72h timeline scrubber** in `SpillPanel`.
- Render **4 score bars** per vessel (component already exists; only proximity is shown).
- Show pipeline as the audited 5-module flow (Upload→Detect→Trace→Investigate→Predict) with
  per-stage status + time traceability, matching `docs/MSIS/*`.
- Multi-event support: remove `marineSpillEvents[0]`-only rendering.
- Reset / re-analyze flow with a different fixture → full teardown of old layers.

**Exit criteria:** one click on a fixture runs the entire pipeline visibly and the map
coherently shows mask, origin, drift, forecast, vessels, and ranked suspects.

---

## PHASE 5 — Production hygiene for the judges' repo read (2–3 days) · Impl. 10 → 10

Judges clone the GitHub repo. Make it clean and self-explanatory.

- Auth-lite + **rate limiting** on `/api/satellites` (protect the CelesTrak budget; one client
  shouldn't be able to exhaust it — with a one-line rate-limit header note in README).
- Move `middleware.ts` → `src/proxy.ts` (Next 16 deprecation warning).
- Wire `nginx.conf` to the **primary** service (today only `msis-cache` gets gzip; cold
  `/api/satellites` ~several MB goes out raw on `:3000`).
- Add API-route Vitest suite (mock fetch/fs) + **one component-render test** (React Testing
  Library / jsdom) + CI step (`npm test && npm run build`).
- Repoint README quick-start to the new engine compose profile (`docker compose up` brings up
  `app` + `engine` + optionally `cache`).
- Rename repo-facing leftovers so nothing says "osiris".

**Exit criteria:** fresh clone → `docker compose up` → full offline demo works.

---

## PHASE 6 — SIH submission package (2–3 days) · Presentation 10/10, Q&A 5/5

The 20 points nearly half of which are earned outside the code.

- **Demo video (3–5 min):** script = detect a **real** Sentinel-1 scene → origin backtrack →
  vessel ranked → export. Show the 3D globe + live satellites as the "wow".
- **PPT (10 min):** problem→approach→architecture diagram (app/engine/cache + data flow)→
  demo→impact (India's coastline, ICG/NTRO/ports)→future. Use the audited architecture, keep it honest.
- **Impact slide:** Indian context — Eastern Arabian Sea spill risk, ICG responders, port
  authorities, fisheries; market cost-reference (spill clean-up costs) for $ impact.
- **Q&A armor:** know CMEMS/GFS/CelesTrak/NOAA marinecadastre access mechanics, why SAR over
  optical (all-weather/night), why wind-field matters (look-alikes), how scores combine, cost of
  running (~free, all open data), and honest "if we had 6 months" wishlist.
- **Open-source packaging:** good README with architecture diagram, data-flow diagram,
  SECURITY.md honest.

---

## Suggested sprint plan (total ≈ 3.5–4 weeks, one dev-track + one data-track)

| Week | Track A (engine/ML) | Track B (app/API/data) |
|---|---|---|
| W1 | Engine skeleton + GeoTIFF parsing + real segmentation | Phase 0 cleanup + route tests + docs fix |
| W2 | Detect CNN + look-alike rejection + fixtures | Phase 1 wiring, `msis-spill-fill` real masks |
| W3 | CMEMS/GFS drift + backtrack + forecast cones | Phase 2+4: forecast layer, timeline, 4 score bars |
| W4 | AIS archive/synthetic replay + scoring | Phase 3 connect + Phase 5 hygiene + Phase 6 package |
| W5 | (buffer) offline demo hardening, video, PPT, Q&A | same |

**Risk notes**
- Network at finale: assume offline → everything must demo on bundled fixtures/cache.
- AIS archive is huge → pre-slice to incident box/time, not a live feed.
- Don't overscope Phase 1 (CNN): a strong threshold/statistical detector + 1 clearly-labelled
  "deep-learning extension" slide beats an under-trained CNN.

---

## Definition of "winning" for PS 26143

A judge should leave convinced that: you **detected a real slick from real satellite data**,
you **showed why the drift backtrack lands where it does**, you **named the most likely vessel
with scored, explainable reasons**, and you **did it on a gorgeous, native-speed 3D platform**
— on a laptop, offline, in 5 minutes.