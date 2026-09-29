/** MSIS — client-side image intake for the Upload-and-Analyze feature.
 *
 * Mirrors the problem statement's Upload stage:
 *   - Validate file type (PNG / JPG / GeoTIFF) and size.
 *   - Extract available metadata (filename, size, ext, and for `.tif`/
 *     `.tiff` a placeholder georeferencing status — the app has no GDAL
 *     backend, so geographic access is only available on georeferenced files
 *     the demo cannot fully decode in the browser).
 *   - Run a deterministic heuristic "AI" classifier returning the three spec
 *     classes (Oil Spill / Look-Alike / No Significant Spill) plus a
 *     confidence score, and a crude spill-area estimate.
 *
 * This is deliberately mock: it gives the hackathon a complete, presentable
 * Detect → Characterize → Export loop without a real model server. The
 * classifier is seeded from the image bytes so the same file always yields the
 * same verdict, which reads as a stable analysis during a demo.
 *
 * Oil-Spill verdicts are then matched to the nearest archived event in
 * `historic-spills` (`matchHistoricEvent`) — a stand-in for the in-training ML
 * model, so the panel can quote an estimated volume, cause and event day/time
 * from past incidents. Swap `matchHistoricEvent`'s body for the trained model
 * without touching the UI, which only reads the `historic` field.
 */

import type { SpillEvent } from './marine-spill';
import { HISTORIC_SPILLS, type HistoricSpill } from './historic-spills';

export type UploadKind = 'geotiff' | 'image';
export type SpillClass = 'Oil Spill' | 'Look-Alike' | 'No Significant Spill';

export interface UploadedImage {
  id: string;
  name: string;
  kind: UploadKind;
  sizeBytes: number;
  georeferenced: boolean;
  dataUrl?: string;
  width?: number;
  height?: number;
}

/**
 * Nearest archived incident the "model" matched the upload against. While the
 * production SAR model is under construction the pipeline quotes this match so
 * the operator still gets a volumetric / causal estimate from historic events.
 */
export interface HistoricMatch {
  event: HistoricSpill;
  /** 0-100 likeness with the uploaded slick. */
  similarity: number;
}

export interface UploadResult {
  classification: SpillClass;
  confidence: number;
  areaKm2: number | null;
  segmented: boolean;
  note: string;
  /** Present only for Oil Spill verdicts — the matched historic event. */
  historic?: HistoricMatch;
}

const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'tif', 'tiff']);
const MAX_BYTES = 25 * 1024 * 1024;

export function validateUpload(file: File): { ok: true; image: UploadedImage } | { ok: false; error: string } {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (!ALLOWED_EXT.has(ext)) {
    return { ok: false, error: `Unsupported file type ".${ext}". Use PNG, JPG or GeoTIFF.` };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, error: 'File too large (max 25 MB).' };
  }
  const kind: UploadKind = ext === 'tif' || ext === 'tiff' ? 'geotiff' : 'image';
  return {
    ok: true,
    image: {
      id: `UPL-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      name: file.name,
      kind,
      sizeBytes: file.size,
      georeferenced: kind === 'geotiff',
    },
  };
}

export function readPreview(file: File): Promise<UploadedImage> {
  return new Promise((resolve, reject) => {
    const base = validateUpload(file);
    if (!base.ok) return reject(new Error(base.error));
    if (base.image.kind === 'geotiff') {
      // GeoTIFF previews can't be decoded in-browser without a raster lib;
      // keep metadata only.
      return resolve(base.image);
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve({ ...base.image, dataUrl: reader.result as string, width: img.width, height: img.height });
      img.onerror = () => resolve(base.image);
      img.src = reader.result as string;
    };
    reader.onerror = () => resolve(base.image);
    reader.readAsDataURL(file);
  });
}

/** Deterministic pseudo-random hash of the image bytes (FNV-1a). */
function hashBytes(bytes: Uint8Array, samples = 64): number {
  let h = 0x811c9dc5;
  const stride = Math.max(1, Math.floor(bytes.length / samples));
  for (let i = 0; i < bytes.length; i += stride) h = ((h ^ bytes[i]) * 0x01000193) >>> 0;
  return h;
}

/** Deterministic FNV-1a hash of a string (used to seed uploaded-slick geometry). */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 0x01000193) >>> 0;
  return h;
}

/** Offset a coordinate by `km` along a compass bearing (0 = north). */
function offsetCoord(center: { lat: number; lng: number }, bearingDeg: number, km: number): [number, number] {
  const rad = (bearingDeg * Math.PI) / 180;
  const dx = (Math.sin(rad) * km) / 111.32;
  const dy = (Math.cos(rad) * km) / 111.32;
  return [+(center.lng + dx).toFixed(4), +(center.lat + dy).toFixed(4)];
}

const PLACED_VESSEL_POOL = [
  { name: 'MT VARUNA PRIDE', type: 'Crude Oil Tanker' },
  { name: 'MV BHARAT MARITIME', type: 'General Cargo' },
  { name: 'MT NILA VISION', type: 'Crude Oil Tanker' },
  { name: 'MV ANDAMAN TRADER', type: 'Container Ship' },
] as const;

/**
 * Turn a completed upload analysis into a placed {@link SpillEvent}, so the
 * Detect → Characterize → Trace → Investigate → Predict pipeline continues on
 * the map and the spill panel after the classifier returns. Seeded from the
 * image id, so re-analysing the same file reproduces the same geometry.
 *
 * Returns `null` for any verdict that is not an Oil Spill — nothing to place.
 */
export function eventFromUpload(input: {
  result: UploadResult;
  image: UploadedImage;
  /** The AOI centre the placed slick should be dropped at. */
  center: { lat: number; lng: number };
  at?: Date;
}): SpillEvent | null {
  const { result, image, center } = input;
  if (result.classification !== 'Oil Spill') return null;
  const seed = hashString(image.id);
  const areaKm2 = result.areaKm2 ?? 10 + (seed % 25);
  const lengthKm = +Math.round(Math.sqrt(areaKm2) * 1.6 * 10) / 10;
  const widthKm = +Math.round((areaKm2 / lengthKm) * 10) / 10;
  const bearing = 40 + (seed % 60);
  const id = `UPL-${image.id}`;

  // Elliptical slick, elongated along `bearing`.
  const polygon: [number, number][] = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const rot = (bearing * Math.PI) / 180;
    const x = (Math.cos(a) * lengthKm) / 2;
    const y = (Math.sin(a) * widthKm) / 2;
    polygon.push([
      +(center.lng + (x * Math.cos(rot) - y * Math.sin(rot)) / 111.32).toFixed(4),
      +(center.lat + (x * Math.sin(rot) + y * Math.cos(rot)) / 111.32).toFixed(4),
    ]);
  }
  polygon.push(polygon[0]);

  const stepKm = 8 + (seed % 6);
  const driftBr = bearing + 18;
  const driftTrajectory: [number, number][] = [0, 1, 2, 3, 4].map((k) => offsetCoord(center, driftBr, k * stepKm));
  const forecastPositions: [number, number][] = [2, 3, 4].map((k) => driftTrajectory[k]);

  const originZone = {
    center: offsetCoord(center, driftBr - 140, 6) as [number, number],
    radiusKm: 14 + (seed % 18),
  };

  const confidence = result.confidence;
  const vessels: SpillEvent['vessels'] = [0, 1, 2].map((j) => {
    const base = PLACED_VESSEL_POOL[(seed + j * 3) % PLACED_VESSEL_POOL.length];
    const prox = +(0.38 + ((seed >> (j + 1)) % 46) / 100 + confidence / 300).toFixed(2);
    return {
      id: `AIS-${String(300000000 + ((seed * (j + 7)) % 399999999)).slice(0, 9)}`,
      name: base.name,
      type: base.type,
      mmsi: String(300000000 + ((seed * (j + 7)) % 399999999)),
      course: (bearing + j * 37) % 360,
      speedKnots: +(7 + ((seed + j * 5) % 9)).toFixed(1),
      position: offsetCoord(center, bearing + ((seed % 70) - 35) + j * 28, 5 + ((seed + j) % 8)) as [number, number],
      proximityScore: Math.min(1, prox),
      temporalScore: Math.min(1, +(prox * 0.94).toFixed(2)),
      trajectoryScore: Math.min(1, +(prox * 0.88).toFixed(2)),
      anomalyScore: Math.min(1, +(prox * 0.68).toFixed(2)),
      compositeScore: Math.min(99, Math.round(prox * 100)),
      reason: j === 0 ? 'Within origin zone, matched uploaded slick geometry' : 'Transit route intersects predicted drift corridor',
      priority: j + 1,
    };
  });

  return {
    id,
    name: `Uploaded Slick — ${image.name}`,
    datetime: (input.at ?? new Date()).toISOString(),
    status: 'active',
    classification: 'Oil Spill',
    confidence,
    areaKm2: +areaKm2.toFixed(1),
    lengthKm,
    widthKm,
    orientationDeg: bearing,
    shape: 'Elliptical slick (upload)',
    polygon,
    driftTrajectory,
    originZone,
    forecastHours: [6, 12, 24],
    forecastPositions,
    vessels,
  };
}

/** Deterministic "oil-dark" density estimate from raw bytes (mock of SAR backscatter). */
function darkDensity(bytes: Uint8Array): number {
  let dark = 0;
  const stride = Math.max(1, Math.floor(bytes.length / 2000));
  for (let i = 0; i < bytes.length; i += stride) if (bytes[i] < 40) dark++;
  return dark / (bytes.length / stride || 1);
}

export async function classifyImage(file: File, kind: UploadKind): Promise<UploadResult> {
  // Read a sample of bytes for a stable seed.
  let bytes = new Uint8Array(0);
  try {
    bytes = new Uint8Array((await file.slice(0, 1 << 16).arrayBuffer()));
  } catch {
    /* keep zero bytes */
  }
  const h = hashBytes(bytes);
  const density = darkDensity(bytes);
  const r = (h % 100) / 100;

  let classification: SpillClass;
  let confidence: number;
  if (density > 0.18 && r < 0.7) {
    classification = 'Oil Spill';
    confidence = Math.min(97, 82 + Math.round(density * 60));
  } else if (density > 0.06 || r >= 0.7) {
    classification = 'Look-Alike';
    confidence = Math.min(90, 66 + Math.round(r * 22));
  } else {
    classification = 'No Significant Spill';
    confidence = 74 + Math.round(r * 16);
  }

  const segmented = classification === 'Oil Spill';
  const areaKm2 = georeferencedArea(kind, density, h);

  return {
    classification,
    confidence,
    areaKm2,
    segmented,
    note: kind === 'geotiff'
      ? 'GeoTIFF — geographic analysis available (area & map placement estimated).'
      : 'Non-georeferenced image — classification only; area is estimated, no map placement.',
    historic: classification === 'Oil Spill' ? (matchHistoricEvent({ areaKm2, seed: h }) ?? undefined) : undefined,
  };
}

/**
 * Deterministic "model match": find the archived historic spill closest to the
 * uploaded slick (by oiled area, or a seed-derived estimate when the image was
 * not georeferenced so no area is available). Pluggable — the future ML model
 * replaces this body while keeping the same return type.
 */
export function matchHistoricEvent(opts: { areaKm2: number | null; seed: number }): HistoricMatch | null {
  const rows = HISTORIC_SPILLS;
  if (rows.length === 0) return null;
  let best: HistoricSpill | null = null;
  let bestSim = -1;
  for (const s of rows) {
    let sim: number;
    if (opts.areaKm2 !== null) {
      const diff = Math.abs(s.areaKm2 - opts.areaKm2);
      sim = Math.round(Math.max(0, Math.min(100, 100 - (diff / (s.areaKm2 + 20)) * 40)));
    } else {
      sim = Math.min(100, 55 + ((opts.seed + s.id.length * 7) % 36));
    }
    if (sim > bestSim) {
      bestSim = sim;
      best = s;
    }
  }
  return best ? { event: best, similarity: bestSim } : null;
}

/** Crude area estimate (km²) — mocked from a georeferenced raster's dark region. */
function georeferencedArea(kind: UploadKind, density: number, h: number): number | null {
  if (kind !== 'geotiff') return null;
  const base = 8 + (h % 48) + density * 60;
  return Math.round(base * 10) / 10;
}

export interface AnalysisReport {
  eventId: string;
  eventName: string;
  source: string;
  datetime: string;
  classification: SpillClass;
  confidence: number;
  areaKm2: number | null;
  originZone?: { center: [number, number]; radiusKm: number };
  forecastHours?: number[];
  forecastPositions?: [number, number][];
  vessels: { name: string; type: string; mmsi: string; priority: number; score: number; reason: string }[];
}

export function reportToCSV(r: AnalysisReport): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push(`# MSIS ANALYSIS REPORT — ${r.eventName} (${r.eventId})`);
  lines.push(`SOURCE,${esc(r.source)},DATETIME,${esc(r.datetime)},CLASSIFICATION,${esc(r.classification)},CONFIDENCE,${r.confidence}%`);
  lines.push(`AREA_KM2,${r.areaKm2 ?? 'N/A'}`);
  lines.push('');
  lines.push('VESSEL,NAME,TYPE,MMSI,PRIORITY,SCORE,REASON'.split(',').map(esc).join(','));
  for (const v of r.vessels) {
    lines.push([v.name, v.type, v.mmsi, v.priority, v.score, v.reason].map(esc).join(','));
  }
  lines.push('');
  lines.push('FORECAST_HOURS,FORECAST_LNG,FORECAST_LAT');
  const hours = r.forecastHours;
  const positions = r.forecastPositions;
  if (hours && positions) {
    hours.forEach((hr, i) => {
      const p = positions[i];
      if (p) lines.push(`${hr},${p[0]},${p[1]}`);
    });
  }
  return lines.join('\n');
}

export function analysisReportFromEvent(e: SpillEvent): AnalysisReport {
  return {
    eventId: e.id,
    eventName: e.name,
    source: 'Sentinel-1 SAR (archive)',
    datetime: e.datetime,
    classification: e.classification,
    confidence: e.confidence,
    areaKm2: e.areaKm2,
    originZone: e.originZone,
    forecastHours: e.forecastHours,
    forecastPositions: e.forecastPositions,
    vessels: e.vessels.map((v) => ({
      name: v.name,
      type: v.type,
      mmsi: v.mmsi,
      priority: v.priority,
      score: v.compositeScore,
      reason: v.reason,
    })),
  };
}

export function eventToGeoJSON(e: SpillEvent): object {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { kind: 'spill', name: e.name, id: e.id, classification: e.classification, confidence: e.confidence, areaKm2: e.areaKm2 },
        geometry: { type: 'Polygon', coordinates: [e.polygon] },
      },
      {
        type: 'Feature',
        properties: { kind: 'drift', forecastHours: e.forecastHours },
        geometry: { type: 'LineString', coordinates: e.driftTrajectory },
      },
      {
        type: 'Feature',
        properties: { kind: 'forecast', hours: e.forecastHours },
        geometry: { type: 'LineString', coordinates: e.forecastPositions },
      },
      {
        type: 'Feature',
        properties: { kind: 'origin', radiusKm: e.originZone.radiusKm },
        geometry: {
          type: 'Polygon',
          coordinates: [spillCircle(e.originZone.center, e.originZone.radiusKm)],
        },
      },
      ...e.vessels.map((v) => ({
        type: 'Feature',
        properties: { kind: 'vessel', name: v.name, type: v.type, mmsi: v.mmsi, priority: v.priority, compositeScore: v.compositeScore, reason: v.reason },
        geometry: { type: 'Point', coordinates: v.position },
      })),
    ],
  };
}

function spillCircle(center: [number, number], radiusKm: number): [number, number][] {
  const ring: [number, number][] = [];
  const degPerKm = 1 / 111.32;
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ring.push([
      center[0] + Math.cos(a) * radiusKm * degPerKm,
      center[1] + Math.sin(a) * radiusKm * degPerKm,
    ]);
  }
  return ring;
}
