<div align="center">

# ⬡ MSIS

### Marine Spill Intelligence System

[![Live Demo](https://img.shields.io/badge/marine-spill-intelligence-system.vercel.app-00E5FF?style=for-the-badge&logo=vercel&logoColor=white)](https://marine-spill-intelligence-system.vercel.app)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![MapLibre](https://img.shields.io/badge/MapLibre_GL-GPU_Rendered-396CB2?style=for-the-badge)](https://maplibre.org)

**A real-time marine oil spill intelligence platform: detect, trace and predict spills from SAR satellite imagery alongside live vessel traffic on a GPU-accelerated interactive globe.**

[Live Demo](https://marine-spill-intelligence-system.vercel.app) · [Report Bug](https://github.com/ItzSufyan79/MSIS/issues) · [Request Feature](https://github.com/ItzSufyan79/MSIS/issues)

</div>

---

## Overview

MSIS is a marine spill intelligence system built around a 5-stage analysis pipeline — **Upload → Detect → Trace → Investigate → Predict**. It combines SAR/EO image classification, ocean drift modeling, vessel investigation scoring, and satellite tracking, all rendered on an interactive 3D globe.

### The Spill Pipeline

```
Upload → Detect → Trace → Investigate → Predict
```

| Stage | What it does |
|-------|-------------|
| **Upload** | Drop a SAR/EO image — validated and checked before analysis |
| **Detect** | Classifies the image and identifies the spill type |
| **Trace** | Reconstructs the origin and drift path on the globe |
| **Investigate** | Ranks nearby vessels by likelihood of involvement |
| **Predict** | Forecasts spill movement 6h / 12h / 24h ahead |

---

## Features

### Spill Pipeline (top-right panel)
- Image **upload & classification** with live pipeline status
- **Vessel investigation scores** for nearby traffic
- **Export** results to CSV / GeoJSON

### 3D Globe
- Interactive MapLibre GL globe (drag to rotate, scroll to zoom)
- Dedicated overlay layers for spill polygon, origin, drift line, forecast path, and vessel dots
- **3D/2D projection** toggle
- **Dark / satellite** base map toggle

### Marine Intel (bottom-left bar)
- **Ocean regions** — Arabian Sea, Bay of Bengal, Indian Ocean, South China Sea, Atlantic, Pacific
- Click a preset to fly the viewport and set your **Area of Interest**
- **Ocean metrics** — sea surface temperature, wind, sea state (Beaufort scale)
- **Historic spills** — 30 reference incidents (Deepwater Horizon, Exxon Valdez, Prestige, FSO Safer, Sanchi, …) filterable by region

### Satellite Tracking (bottom-right panel)
- **2,000+ objects** from Celestrak TLE data with SGP4 propagation (Sentinel-1A/B SAR, ISS, TerraSAR-X, COSMO-SkyMed, …)
- Live **position, sensor footprint, and ground track** per satellite
- **Next-pass coverage** predictions for your AOI
- Refreshed every 15s via `/api/satellites/monitor`

### Data Sources

| Source | Provides | Endpoint |
|--------|----------|----------|
| Celestrak | Satellite TLE | `/api/satellites` |
| CARTO | Basemap tiles | — |
| ADS-B Exchange | Live flights | — |
| Open-Meteo | Marine weather | — |

---

## Quick Start

```bash
git clone https://github.com/ItzSufyan79/MSIS.git
cd msis
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Docker / Self-Hosting

```bash
git clone https://github.com/ItzSufyan79/MSIS.git
cd msis
cp .env.template .env     # optional — configure keys / port
docker compose up -d
```

The image is a multi-stage `node:22-alpine` standalone build (~220 MB, non-root). See **[DOCKER.md](DOCKER.md)** for the full guide.

### Environment Variables

MSIS works **without any API keys** — all core feeds use public, keyless sources. Copy [`.env.template`](.env.template) to `.env` and set only what you need:

```env
# Published host port (container always listens on 3000). Default: 3000
MSIS_PORT=3000

# Optional — aisstream.io maritime traffic
AIS_API_KEY=
```

> `.env` is gitignored — only the template is committed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Map Engine | MapLibre GL JS (WebGL) |
| Animations | Framer Motion |
| Icons | Lucide React |
| Styling | Custom CSS Design System |
| Satellite Propagation | Celestrak TLE + SGP4 |
| Deployment | Vercel Edge Network |

---

<div align="center">

**Built by [ItzSufyan79](https://github.com/ItzSufyan79)**

</div>