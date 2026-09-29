import { NextResponse } from 'next/server';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { propagateTLE, orbitalPeriodMinutes } from '@/lib/orbit';
import {
  MONITOR_AOI,
  sampleTrack,
  findPasses,
  coverageRadiusKm,
  inAoi,
  coversRegion,
  buildFootprintGeoJSON,
  buildTrackGeoJSON,
} from '@/lib/satellite-monitor';

export const dynamic = 'force-dynamic';

/**
 * MSIS — satellite coverage monitor for one satellite.
 *
 * Answers the operator's standing question in an oil-spill hunt: which SAR /
 * imaging platforms can see the slick, and when? For a chosen satellite it
 * returns its live ground position, its horizon footprint over the spill
 * region, and every pass across the monitoring box in the next 24 hours —
 * predicted by propagating the same TLE the map's marker came from.
 *
 * The TLE catalogue is the disk cache /api/satellites already maintains, read
 * directly to avoid a second, rate-limited trip to CelesTrak.
 */

const CACHE_FILE = join(process.cwd(), '.next', 'cache', 'satellites-tle-cache.json');

interface Tle { name: string; line1: string; line2: string }

let cache: { at: number; byNorad: Map<string, Tle> } | null = null;
const CACHE_TTL_MS = 5 * 60_000;

function noradOf(line1: string): string {
  return line1.substring(2, 7).trim();
}

function catalogue(): Map<string, Tle> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.byNorad;
  const byNorad = new Map<string, Tle>();
  try {
    if (existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as { sats?: Tle[] };
      for (const sat of parsed.sats ?? []) {
        if (sat?.line1 && sat?.line2) byNorad.set(noradOf(sat.line1), sat);
      }
    }
  } catch {
    // Corrupt cache means no monitor, not a broken map.
  }
  cache = { at: Date.now(), byNorad };
  return byNorad;
}

const PASS_WINDOW_MS = 24 * 3600_000;
const PASS_STEP_S = 60;
const TRACK_WINDOW_MS = 120 * 60_000;
const TRACK_STEP_S = 30;

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = params.get('id')?.trim();
  const name = params.get('name')?.trim();

  // Optional custom AOI box (`w,e,s,n`) overrides the default spill region, so
  // the ocean selector can ask "does this satellite cover the region I'm
  // watching?" for any picked point.
  const num = (v: string | null) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const w = num(params.get('w'));
  const e = num(params.get('e'));
  const s = num(params.get('s'));
  const n = num(params.get('n'));
  const custom = w !== null && e !== null && s !== null && n !== null && w < e && s < n;
  const aoi = custom ? { west: w, east: e, south: s, north: n, label: 'CUSTOM AOI' } : MONITOR_AOI;

  const byNorad = catalogue();
  if (byNorad.size === 0) {
    return NextResponse.json(
      { error: 'catalogue empty — fetch /api/satellites once first', monitor: null },
      { status: 503 },
    );
  }

  let tle: Tle | undefined;
  if (id && /^\d{1,6}$/.test(id)) {
    tle = byNorad.get(id.padStart(5, '0'));
  } else if (name) {
    const want = name.toLowerCase();
    for (const cand of byNorad.values()) {
      if (cand.name.toLowerCase().includes(want)) { tle = cand; break; }
    }
  }
  if (!tle) {
    return NextResponse.json({ error: 'satellite not in catalogue', monitor: null }, { status: 404 });
  }

  const now = Date.now();
  const pos = propagateTLE(tle.line1, tle.line2, new Date(now));
  if (!pos) {
    return NextResponse.json({ error: 'could not propagate', monitor: null }, { status: 422 });
  }

  const periodMinutes = orbitalPeriodMinutes(tle.line2);
  const radiusKm = coverageRadiusKm(pos.altKm);

  // Coverage windows: the AOI box sitting inside the satellite's footprint
  // disk. Sampled coarsely (60 s over 24 h) — pass edges do not need precision,
  // and the horizon of a 700 km platform is many minutes wide.
  const passSamples = sampleTrack(tle.line1, tle.line2, now, now + PASS_WINDOW_MS, PASS_STEP_S);
  const passes = findPasses(passSamples, (samp) => coversRegion(samp.lat, samp.lng, radiusKm, aoi), aoi);
  // Keep the drawn track to ~one revolution so it stays readable.
  const track = buildTrackGeoJSON(sampleTrack(tle.line1, tle.line2, now, now + TRACK_WINDOW_MS, TRACK_STEP_S));

  const monitor = {
    satellite: { name: tle.name, noradId: noradOf(tle.line1) },
    position: {
      lat: Math.round(pos.lat * 10000) / 10000,
      lng: Math.round(pos.lng * 10000) / 10000,
      altKm: Math.round(pos.altKm),
      time: now,
    },
    periodMinutes,
    footprintRadiusKm: Math.round(radiusKm),
    overAOI: inAoi(pos.lat, pos.lng, aoi),
    covering: coversRegion(pos.lat, pos.lng, radiusKm, aoi),
    passes: passes.slice(0, 6),
    footprint: buildFootprintGeoJSON(pos.lat, pos.lng, radiusKm),
    track,
    aoi,
    fetchedAt: now,
  };

  return NextResponse.json(
    { monitor, error: null },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}