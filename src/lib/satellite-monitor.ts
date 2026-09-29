/**
 * MSIS — satellite coverage monitor over the active spill region.
 *
 * Drives the Satellite Monitor panel and its map layer. The maths is local to
 * the browser save for one thing: TLEs. They live in the server's disk cache
 * (written by /api/satellites), and the monitor route propagates them forward
 * to tell the operator *when* any selected satellite will be overhead.
 */

import { propagateTLE } from '@/lib/orbit';

/** One row of the bulk satellite catalogue — the shape /api/satellites returns. */
export interface SatelliteRow {
  name: string;
  lat: number;
  lng: number;
  alt: number;
  mission?: string;
  color?: string;
  category?: string;
  noradId?: string;
}

/** Earth's mean radius, for the horizon footprint. */
export const EARTH_RADIUS_KM = 6371;

/**
 * The box the monitor watches. Deliberately larger than the slick itself:
 * a pass report is useful the moment a satellite can sense the surrounding
 * waters, not only when its ground track clips the spill polygon.
 */
/** An AOI box on the map: the region satellite coverage is measured against. */
export interface AoiBox {
  west: number;
  east: number;
  south: number;
  north: number;
  label: string;
}

export const MONITOR_AOI = {
  west: 69.8,
  east: 71.5,
  south: 18.4,
  north: 19.6,
  label: 'ARABIAN SEA SPILL REGION',
} as const;

export const MONITOR_AOI_CENTER = {
  lat: (MONITOR_AOI.south + MONITOR_AOI.north) / 2,
  lng: (MONITOR_AOI.west + MONITOR_AOI.east) / 2,
};

/** Box centre, derived so custom AOIs work the same as the default. */
export function aoiCenter(aoi: AoiBox) {
  return { lat: (aoi.south + aoi.north) / 2, lng: (aoi.west + aoi.east) / 2 };
}

/**
 * Earth-surface distance from an AOI centre to its furthest corner. A satellite
 * is said to "cover" the region when the region's box is inside its sensing
 * footprint disk; adding this span turns the point-centre check into a
 * box-overlap check without needing a fiddly polygon intersection.
 */
export function aoiSpan(aoi: AoiBox): number {
  const c = aoiCenter(aoi);
  const dLat = (aoi.north - aoi.south) / 2;
  const dLng = (aoi.east - aoi.west) / 2;
  return haversineKm(c.lat, c.lng, c.lat + dLat, c.lng + dLng);
}

/** Span of the default region — exported for panels that need it cheaply. */
export const AOI_SPAN_KM = aoiSpan(MONITOR_AOI);

/** Ground-track samples between two instants, from SGP4. */
export interface TrackSample {
  lat: number;
  lng: number;
  altKm: number;
  /** Epoch the sample was propagated to, in epoch ms. */
  time: number;
}

/** One pass of a satellite across the monitoring box. */
export interface MonitorPass {
  /** Epoch ms. */
  start: number;
  /** Epoch ms. */
  end: number;
  durationMin: number;
  /** Sub-satellite point closest to the AOI centre during the pass. */
  peakLat: number;
  peakLng: number;
  peakAltKm: number;
  peakTime: number;
  /** Distance from the AOI centre to the peak ground point, in km. */
  closestKm: number;
}

/** What the monitor route returns for one satellite, and the panel shows. */
export interface MonitorSnapshot {
  satellite: { name: string; noradId: string } | null;
  position: { lat: number; lng: number; altKm: number; time: number } | null;
  periodMinutes: number;
  /** Radius of the footprint circle drawn on the map. */
  footprintRadiusKm: number;
  /** Sub-satellite point is inside the AOI box right now. */
  overAOI: boolean;
  /** The AOI box is inside the satellite's sensing footprint right now. */
  covering: boolean;
  /** Coverage windows in the next 24h (footprint overlaps the AOI box). */
  passes: MonitorPass[];
  footprint: GeoJSON.Feature<GeoJSON.Polygon>;
  track: GeoJSON.Feature<GeoJSON.LineString>[];
  aoi: AoiBox;
  fetchedAt: number;
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = EARTH_RADIUS_KM;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Radius on Earth's surface from which the satellite is above the horizon. */
export function coverageRadiusKm(altKm: number): number {
  const h = Math.max(altKm, 10);
  return EARTH_RADIUS_KM * Math.acos(EARTH_RADIUS_KM / (EARTH_RADIUS_KM + h));
}

export function inAoi(lat: number, lng: number, aoi: AoiBox = MONITOR_AOI): boolean {
  return lat >= aoi.south && lat <= aoi.north && lng >= aoi.west && lng <= aoi.east;
}

/**
 * Whether the AOI box sits inside the satellite's sensing footprint — the
 * footprint is a horizon disk centred on the sub-satellite point, and rect
 * vs. circle overlap is approximated by the centre-to-spread test above.
 */
export function coversRegion(lat: number, lng: number, footprintRadiusKm: number, aoi: AoiBox = MONITOR_AOI): boolean {
  const c = aoiCenter(aoi);
  return haversineKm(lat, lng, c.lat, c.lng) <= footprintRadiusKm + aoiSpan(aoi);
}

/** SGP4 propagation of one TLE across a time window at a fixed step. */
export function sampleTrack(
  line1: string,
  line2: string,
  start: number,
  end: number,
  stepSeconds: number,
): TrackSample[] {
  const out: TrackSample[] = [];
  for (let t = start; t <= end; t += stepSeconds * 1000) {
    const p = propagateTLE(line1, line2, new Date(t));
    // A gap is better than a fabricated point — SGP4 declining to model a
    // moment is skipped rather than interpolated across.
    if (p) out.push({ ...p, time: t });
  }
  return out;
}

/** Groups contiguous samples where `inside` is true into passes, with each pass's peak. */
export function findPasses(
  samples: TrackSample[],
  inside: (s: TrackSample) => boolean,
  aoi: AoiBox = MONITOR_AOI,
): MonitorPass[] {
  const passes: MonitorPass[] = [];
  const centre = aoiCenter(aoi);
  let run: TrackSample[] = [];
  const flush = () => {
    if (run.length === 0) return;
    let peak = run[0];
    let best = Infinity;
    for (const s of run) {
      const d = haversineKm(s.lat, s.lng, centre.lat, centre.lng);
      if (d < best) { best = d; peak = s; }
    }
    passes.push({
      start: run[0].time,
      end: run[run.length - 1].time,
      durationMin: (run[run.length - 1].time - run[0].time) / 60_000,
      peakLat: peak.lat,
      peakLng: peak.lng,
      peakAltKm: peak.altKm,
      peakTime: peak.time,
      closestKm: Math.round(best),
    });
    run = [];
  };
  for (const s of samples) {
    if (inside(s)) run.push(s);
    else flush();
  }
  flush();
  return passes;
}

/** Ground-track of the samples as GeoJSON lines, split at the antimeridian. */
export function buildTrackGeoJSON(samples: TrackSample[]): GeoJSON.Feature<GeoJSON.LineString>[] {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  for (const s of samples) {
    const p: [number, number] = [s.lng, s.lat];
    if (run.length > 0 && Math.abs(p[0] - run[run.length - 1][0]) > 180) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
    run.push(p);
  }
  if (run.length > 1) runs.push(run);
  return runs.map(coords => ({
    type: 'Feature' as const,
    properties: { kind: 'track' },
    geometry: { type: 'LineString' as const, coordinates: coords },
  }));
}

/** A circle on Earth's surface for the satellite's sensing footprint. */
export function buildFootprintGeoJSON(
  lat: number,
  lng: number,
  radiusKm: number,
  steps = 48,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const dLat = radiusKm / 111.0;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  const dLng = cosLat === 0 ? 180 : radiusKm / (111.0 * cosLat);
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    pts.push([Math.round((lng + dLng * Math.cos(a)) * 10000) / 10000, Math.round((lat + dLat * Math.sin(a)) * 10000) / 10000]);
  }
  return {
    type: 'Feature',
    properties: { kind: 'footprint', radiusKm: Math.round(radiusKm), lat, lng },
    geometry: { type: 'Polygon', coordinates: [pts] },
  };
}

/**
 * The mission is Sentinel-only: MSIS observes oil slicks with C-band SAR and
 * its neighbourhood sensing, so the live feed surfaces nothing but the Sentinel
 * family. Sorted by name so SENTINEL-1A/1B/1C lead the picker.
 */
export function sentinelSatellites(rows: SatelliteRow[]): SatelliteRow[] {
  return rows
    .filter((r) => /SENTINEL-\d(?:[A-Z]|P)?/i.test(r.name))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Sentinel SAR birds specifically — the ones that actually image slicks. */
export function sentinelSarSatellites(rows: SatelliteRow[]): SatelliteRow[] {
  return sentinelSatellites(rows).filter((r) => /SENTINEL-1/i.test(r.name));
}

/** The map satellite list thinned to SAR / ocean-observation candidates worth quick-picking. */
export function pickHighlightSatellites(rows: SatelliteRow[]): SatelliteRow[] {
  const ordered = [
    /SENTINEL-1/i, /SENTINEL-3/i, /RADARSAT/i, /TERRASAR/i, /COSMO-SKYMED/i,
    /LANDSAT/i, /RESURS/i, /ALOS/i, /GF-1/i, /HJ-1/i, /GAOFEN/i, /AQUA/i, /TERRA/i,
  ];
  const seen = new Set<string>();
  const out: SatelliteRow[] = [];
  for (const rx of ordered) {
    const hit = rows.find((r: SatelliteRow) => rx.test(r.name) && !seen.has(r.noradId || r.name));
    if (hit) { seen.add(hit.noradId || hit.name); out.push(hit); }
  }
  return out.slice(0, 8);
}