/**
 * MSIS — live ocean-intelligence metrics.
 *
 * Mock telemetry provider for the Marine Intelligence panel and the bottom
 * status badge. Values are deterministic on (lat, lng, ten-minute bucket) so
 * the UI reads as "live" without flickering or a backend. The wiring is
 * structured so a real feed (e.g. GHRSST SST, ERA5 wind, OSCAR currents) can
 * drop into `oceanMetricsAt` later without touching the panels.
 */

/** Compass output, so the panel can render "SE / 12 kn" rather than a heading. */
export interface OceanMetrics {
  /** Sea-surface temperature, °C. */
  sstC: number;
  /** Wind speed at 10 m, knots. */
  windKts: number;
  /** Wind direction (compass: NE, SW, …). */
  windDir: string;
  /** Surface current speed, knots. */
  currentKts: number;
  /** Surface current direction. */
  currentDir: string;
  /** Significant wave height, m. */
  waveM: number;
  /** Salinity, PSU. */
  salinityPpt: number;
  /** Beaufort-like sea state label. */
  seaState: string;
}

/** A region preset for the ocean selector chart strip. */
export interface OceanRegion {
  id: string;
  label: string;
  sub: string;
  /** [lng, lat] centre for the monitor AOI and fly-to. */
  center: [number, number];
}

/** Indian-waters basins offered by the ocean selector. */
export const OCEAN_REGIONS: OceanRegion[] = [
  { id: 'arabian', label: 'ARABIAN SEA', sub: 'MSIS-2026-001', center: [70.55, 19.05] },
  { id: 'khambhat', label: 'GULF OF KHAMBHAT', sub: 'TAÑKS', center: [72.6, 21.7] },
  { id: 'bengal', label: 'BAY OF BENGAL', sub: 'CYCLONE WATCH', center: [87.5, 16.5] },
  { id: 'laccadive', label: 'LACCADIVE SEA', sub: 'BIODIVERSITY', center: [73.2, 9.5] },
  { id: 'andaman', label: 'ANDAMAN SEA', sub: 'SHIPPING LANES', center: [94.5, 10.0] },
];

/**
 * Every monitored ocean basin — the H I S T O R I C   A I S list. Clicking any
 * entry flies the map there and re-places the AOI box over that water, so the
 * Sentinel coverage engine and marine telemetry re-home to the picked sea.
 */
export const ALL_OCEAN_REGIONS: OceanRegion[] = [
  ...OCEAN_REGIONS,
  { id: 'indian', label: 'INDIAN OCEAN', sub: 'OPEN WATER', center: [78.0, -30.0] },
  { id: 'atlantic', label: 'ATLANTIC OCEAN', sub: 'OPEN WATER', center: [-35.0, 15.0] },
  { id: 'pacific', label: 'PACIFIC OCEAN', sub: 'OPEN WATER', center: [-150.0, 10.0] },
  { id: 'arctic', label: 'ARCTIC OCEAN', sub: 'POLAR ICE', center: [0.0, 75.0] },
  { id: 'southern', label: 'SOUTHERN OCEAN', sub: 'ANTARCTIC CIRCUMPOLAR', center: [0.0, -65.0] },
  { id: 'mediterranean', label: 'MEDITERRANEAN SEA', sub: 'CLOSED BASIN', center: [18.0, 36.0] },
  { id: 'red-sea', label: 'RED SEA', sub: 'SUEZ LANES', center: [39.0, 21.0] },
  { id: 'persian', label: 'PERSIAN GULF', sub: 'STRAIT OF HORMUZ', center: [51.5, 26.5] },
  { id: 'black-sea', label: 'BLACK SEA', sub: 'BOSPHORUS GATE', center: [34.0, 43.0] },
  { id: 'caspian', label: 'CASPIAN SEA', sub: 'ENCLOSED', center: [51.0, 40.0] },
  { id: 'baltic', label: 'BALTIC SEA', sub: 'SHALLOW BASIN', center: [20.0, 59.0] },
  { id: 'north-sea', label: 'NORTH SEA', sub: 'OFFSHORE PLATFORMS', center: [4.0, 56.0] },
  { id: 'norwegian', label: 'NORWEGIAN SEA', sub: 'BRENT PROVINCE', center: [5.0, 68.0] },
  { id: 'mexico', label: 'GULF OF MEXICO', sub: 'OIL FIELD', center: [-90.0, 26.0] },
  { id: 'caribbean', label: 'CARIBBEAN SEA', sub: 'TRANSIT LANES', center: [-75.0, 15.0] },
  { id: 'guinea', label: 'GULF OF GUINEA', sub: 'NIGER DELTA', center: [1.0, 3.0] },
  { id: 'china-south', label: 'SOUTH CHINA SEA', sub: 'CHOKEPOINT', center: [114.0, 12.0] },
  { id: 'china-east', label: 'EAST CHINA SEA', sub: 'TAIWAN STRAIT', center: [125.0, 28.0] },
  { id: 'philippine', label: 'PHILIPPINE SEA', sub: 'TRENCH', center: [133.0, 18.0] },
  { id: 'japan', label: 'SEA OF JAPAN', sub: 'HEAVY SHIPPING', center: [135.0, 40.0] },
  { id: 'bering', label: 'BERING SEA', sub: 'HIGH LATITUDE', center: [-176.0, 57.0] },
  { id: 'alaska', label: 'GULF OF ALASKA', sub: 'STORM CORRIDOR', center: [-148.0, 55.0] },
  { id: 'tasman', label: 'TASMAN SEA', sub: 'TRANS-TASMAN', center: [158.0, -38.0] },
  { id: 'coral', label: 'CORAL SEA', sub: 'REEF ZONE', center: [154.0, -18.0] },
  { id: 'argentine', label: 'ARGENTINE SEA', sub: 'FALKLAND PLATFORM', center: [-60.0, -42.0] },
  { id: 'weddell', label: 'WEDDELL SEA', sub: 'ANTARCTIC SHELF', center: [-45.0, -73.0] },
];

function compass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

/** Pseudo-random-but-stable value in [lo, hi] from a seed. */
function wave(seed: number, lo: number, hi: number): number {
  // (sin+1)/2 is continuous on [0,1]. The old |sin| % 1 snapped to lo the
  // instant |sin| hit exactly 1.0 (1 % 1 === 0), so a slow cursor sweep could
  // flip a metric between its floor and ceiling — the "jitter".
  const t = (Math.sin(seed) + 1) / 2;
  return +(lo + t * (hi - lo)).toFixed(1);
}

/**
 * Ten-minute bucket: values change a little every ten minutes so the UI feels
 * alive, but not on every render or every panel poll.
 */
function bucket(date: Date = new Date()): number {
  return Math.floor(date.getTime() / 600_000);
}

/** Deterministic "now" telemetry for any point on the ocean. */
export function oceanMetricsAt(lat: number, lng: number, when: Date = new Date()): OceanMetrics {
  const b = bucket(when);
  const phase = (lat + lng) * 0.13 + b * 0.37;
  // Tropical-baseline SST with a small spatial + temporal component.
  const sst = 28.4 + Math.sin(phase) * 1.6 - (Math.abs(lat) - 20) * 0.08;
  const windDeg = (lng * 2.7 + b * 3.1) % 360;
  const windKts = wave(lat * 31 + lng * 7 + b, 4, 26);
  const curDeg = (lng * 1.4 + b * 1.9 + 90) % 360;
  const currentKts = wave(lat * 17 + lng * 13 - b, 0.8, 4.5);
  const waveM = wave(lng * 11 - b, 0.5, wave(ktsToSeed(windKts), 1.2, 4.2));
  const salinity = 35.0 + Math.sin(phase * 0.7) * 0.8;
  const seaState = windKts > 22 ? 'ROUGH' : windKts > 14 ? 'MODERATE' : windKts > 6 ? 'SLIGHT' : 'CALM';

  return {
    sstC: +sst.toFixed(1),
    windKts: Math.round(windKts),
    windDir: compass(windDeg),
    currentKts: +currentKts.toFixed(1),
    currentDir: compass(curDeg),
    waveM,
    salinityPpt: +salinity.toFixed(1),
    seaState,
  };
}

function ktsToSeed(kts: number): number {
  return kts * 1000.13;
}

/** AOI box (for satellite coverage calls) centred on a picked point. */
export function aoiBoxFromCenter(lat: number, lng: number, halfSpanDeg = 1.0) {
  return {
    west: +(lng - halfSpanDeg).toFixed(3),
    east: +(lng + halfSpanDeg).toFixed(3),
    south: +(lat - halfSpanDeg).toFixed(3),
    north: +(lat + halfSpanDeg).toFixed(3),
    label: 'CUSTOM AOI',
  };
}