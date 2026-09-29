import { describe, it, expect } from 'vitest';
import {
  validateUpload,
  reportToCSV,
  analysisReportFromEvent,
  eventToGeoJSON,
  classifyImage,
  matchHistoricEvent,
} from './spill-upload';
import { marineSpillEvents } from './marine-spill';
import { spillsForRegion } from './historic-spills';

const png = new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'scene.png', { type: 'image/png' });
const geotiff = new File([new Uint8Array([77, 77, 0, 42, 0, 0])], 'sar.tiff', { type: 'image/tiff' });
const exe = new File([new Uint8Array([1, 2, 3])], 'evil.exe', { type: 'application/octet-stream' });

describe('validateUpload', () => {
  it('accepts PNG and GeoTIFF uploads', () => {
    expect(validateUpload(png)).toMatchObject({ ok: true, image: { kind: 'image' } });
    expect(validateUpload(geotiff)).toMatchObject({ ok: true, image: { kind: 'geotiff', georeferenced: true } });
  });

  it('rejects unsupported file types', () => {
    expect(validateUpload(exe)).toMatchObject({ ok: false });
  });

  it('rejects oversized files', () => {
    const big = new File([new Uint8Array(26 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    expect(validateUpload(big)).toMatchObject({ ok: false });
  });
});

describe('classifyImage', () => {
  it('returns one of the three spec classes with a confidence', async () => {
    const r = await classifyImage(png, 'image');
    expect(['Oil Spill', 'Look-Alike', 'No Significant Spill']).toContain(r.classification);
    expect(r.confidence).toBeGreaterThanOrEqual(60);
    expect(r.confidence).toBeLessThanOrEqual(100);
  });

  it('only estimates area for georeferenced files', async () => {
    const r = await classifyImage(geotiff, 'geotiff');
    expect(r.areaKm2).not.toBeNull();
    const plain = await classifyImage(png, 'image');
    expect(plain.areaKm2).toBeNull();
  });
});

describe('matchHistoricEvent', () => {
  it('matches an oil slick to the nearest archived event by area', () => {
    const match = matchHistoricEvent({ areaKm2: 40, seed: 123 });
    expect(match).not.toBeNull();
    expect(match!.event.areaKm2).toBeCloseTo(40, 0);
    expect(match!.similarity).toBeGreaterThan(0);
    expect(match!.similarity).toBeLessThanOrEqual(100);
  });

  it('falls back to a seed-based estimate when no area is available', () => {
    const a = matchHistoricEvent({ areaKm2: null, seed: 5 });
    const b = matchHistoricEvent({ areaKm2: null, seed: 5 });
    expect(a!.event.id).toBe(b!.event.id);
    expect(a!.similarity).toBe(b!.similarity);
  });

  it('only surfaces a historic record on an Oil Spill verdict', async () => {
    const g = await classifyImage(new File([new Uint8Array(4096).fill(0)], 'dark.tiff', { type: 'image/tiff' }), 'geotiff');
    if (g.classification === 'Oil Spill') {
      expect(g.historic).toBeDefined();
      expect(typeof g.historic!.event.volumeTonnes).toBe('number');
    } else {
      expect(g.historic).toBeUndefined();
    }
  });
});

describe('reportToCSV / eventToGeoJSON', () => {
  const event = marineSpillEvents[0];

  it('builds a report with the vessel investigation rows', () => {
    const report = analysisReportFromEvent(event);
    const csv = reportToCSV(report);
    expect(csv).toContain('MSIS ANALYSIS REPORT');
    expect(csv).toContain('Oil Spill');
    expect(csv).toContain('MV AL NASRIYAH');
    expect(csv).toContain('Within origin zone, AIS gap of 47 min during window');
    expect(csv).toContain('FORECAST_HOURS,FORECAST_LNG,FORECAST_LAT');
  });

  it('exports the spill, drift, origin and vessel layers as GeoJSON', () => {
    const gj = eventToGeoJSON(event) as {
      type: 'FeatureCollection';
      features: { properties: { kind?: string } }[];
    };
    expect(gj.type).toBe('FeatureCollection');
    const kinds = gj.features.map((f) => f.properties.kind);
    expect(kinds).toContain('spill');
    expect(kinds).toContain('drift');
    expect(kinds).toContain('forecast');
    expect(kinds).toContain('origin');
    expect(kinds).toContain('vessel');
  });
});