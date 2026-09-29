# MSIS — Satellite & AIS Data Acquisition Methods

**Problem Statement (SIH 2026 · PS 26143)**
> Leveraging satellite imagery to determine Oil spills at sea along with AIS data
> correlations to identify vessel responsible for the spill. — NTRO, Disaster Management

The app's three-column pipeline mirrors the PS:
**DETECT · CHARACTERIZE** (SAR/EO) → **TRACE** (ocean/meteo drift hindcast & forecast) →
**INVESTIGATE** (historic AIS reconstruction) · **PREDICT** (forward drift).

This note lists the real production datasets for each stage and the seam where the
current SDK/UI consumes them.

---

## 1. Slick Detection & Characterisation — SAR / EO Imagery

| Source | Sensor / Band | Notes |
|---|---|---|
| **Sentinel-1 A/B/C** (ESA, Copernicus) | C-band SAR (IW/EW) | Primary choice. 10 m, ~6–12 day revisit, dual-pol. Dark-slick contrast best at 5–25 kn wind. Open data, Sentinel Hub / Copernicus Data Space access. |
| **RISAT-1/RISAT-2** (ISRO) | X-band SAR | Relevant to NTRO/India. RISAT-2 C-SAR fine resolution; cryosat revisit 1–4 days. |
| **NovaSAR-S** (SSTL) | S-band SAR | S-band suppresses sea clutter; good false-alarm rejection, 20–30 m. |
| **ALOS-2 PALSAR-2** (JAXA) | L-band SAR | Works in higher wind/seas; polarimetry aids thick-slick discrimination. |
| **Capella / ICEYE** (commercial) | X-band SAR | Very-high-res spotlight for confirming and measuring a candidate slick. |

Decision logic to implement:
1. **Detect** candidates by dark-patch segmentation on VV (and HV) amplitude + wind-field
   masks (speckle filters → Otsu/adaptive threshold). Confidence from SNNR, backscatter
   ratio, and shape statistics (area, length/width, perimeter, orientation).
2. **Reject look-alikes** — biofilm/algae, wake, rain cells, natural seep, low-wind zones:
   cross-check against sea-surface temperature, wind (GFS/ERA5), and wave state.
3. **Characterise** slick class and approximate thickness/age from polarisation ratio,
   emulsification pattern, morphology, and drift-field backtracking.

_UI seam:_ the app ships a deterministic mock classifier (`src/lib/spill-upload.ts`,
`UploadAnalyze.tsx`) and the static event model (`src/lib/marine-spill.ts`) that the
`SpillPanel` and map `marine-spill` layer render. Replace the mock by pointing the
analyze stage at the SAR scene referenced in `location`/metadata output.

## 2. Origin Tracing — Oceanographic & Meteorological Drift

| Need | Dataset | Use |
|---|---|---|
| Surface currents (mixed-layer) | **CMEMS Global Ocean Physics** (`sea_current_velocity`, `sea_water_salinity`, `sea_surface_temperature`) | Eulerian advection of the slick; SOURCE_TRACKING = reverse advection. |
| Winds & waves | **NOAA GFS 0.25°** winds; **WAVEWATCH III / ERA5** waves | Windage fractions (≈1–4% of wind speed, separate for slick vs. emulsion), wave-induced shear. |
| Daily SST | **CMEMS OSTIA / NOAA** | Ageing/weathering (evaporation, dissolution, emulsification) and look-alike filtering. |
| Drift forecast | Euler integration over the above fields, Monte-Carlo perturbations | `PREDICT` stage: forward cone of the slick 12–72 h. |

_UI seam:_ `src/lib/marine-spill.ts` already models zones, drift tracklines, and origin
ellipses for the current event; `src/lib/ocean-metrics.ts` supplies the SST/wind/sea-state
readouts in the bottom badge. Swapping the analytic (climatology-based) fields for
CMEMS/GFS pulls is a pure data-source change behind the same interfaces.

## 3. Vessel Identification — Historic AIS Reconstruction

| Source | Coverage / Latency | Notes |
|---|---|---|
| **NOAA Automatic Identification System (AIS)** — `marinecadastre.gov/accessais` | US coastal waters; 2010–present archive | Official dataset explicitly cited in PS 26143. Bulk archive download + `https://marinecadastre.gov/ais/2024/accessais/` CSVs. |
| Synthetic AIS (PS allows) | N/A | Generate a plausible 30-day AIS stream around the incident time/box to exercise the attribution pipeline end-to-end. |
| **exactEarth / Spire / Orbcomm** | Global, near-real-time | Live feed for current-vessel overlay (`/api/maritime`); historic re-plays via their archives. |

Attribution algorithm (already scaffolded in `SpillPanel` "VESSELS OF INTEREST"):
1. Reconstruct vessel tracks inside the origin window (time-slice the AIS archive to
   ±t from the estimated spill time, clipped to the origin box + drift back-cone).
2. Score every vessel:
   - **Proximity** — minimum great-circle distance between vessel track and the
     reconstructed origin (age-adjusted back-tracked source).
   - **Trajectory** — heading/COG that leaves the source region moving away along the
     slick's backtrack path, consistent speed (reduced to ≤4 kn in the source cell).
   - **Behaviour** — SOG discontinuity to near-zero or dark hours at the origin time,
     missing-GPS gaps that could hide offloading, cargo type (tanker), last port.
3. Composite score → ranked suspect list; export CSV / GeoJSON report.

_UI seam:_ `SpillPanel` renders the ranked vessels; `exportScene` produces CSV Report +
GeoJSON. Live AIS vessels on the map come from `/api/maritime` (`maritime_ships`).

## 4. Reference / Benchmark Datasets

- **Sentinel-1 oil-spill catalogues** on Zenodo (e.g., the *S1-NRCS / dark-spot* labelled
  sets) — for training/validating the classifier confidence thresholds.
- **MarineCadastre Access AIS** samples and NOAA Marlin — for the attribution scoring test.
- **CMEMS** ocean analysis/forecast — for the drift rebuild.

## 5. Suggested Integration Order

1. Point `ocean-metrics.ts` at CMEMS + GFS (adds realistic current fields → better
   backtrack).
2. Add a SAR ingestion path behind `UploadAnalyze` (Sentinel-1 scene → containerised
   detection → returns a `SpillEvent`-shaped result).
3. Load the NOAA AIS archive (or synthetic stream) for the event time-box; feed the
   scoring numbers that `SpillPanel` already displays.
4. Optionally wire `/api/satellites` catalogue to real TLE propagation for the coverage
   monitor (already daily cached) — Sentinel-1 passes over the AOI then drive the
   "next acquisition window" readouts in `SatelliteMonitor`.