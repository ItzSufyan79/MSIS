import { describe, it, expect } from 'vitest';
import {
  HISTORIC_SPILLS,
  spillsForRegion,
  spillDayTime,
  historicSpillsCSV,
  historicSpillsJSON,
  SEVERITY_COLOR,
  SEVERITY_COLOR_RGB,
} from './historic-spills';
import { ALL_OCEAN_REGIONS } from './ocean-metrics';

describe('historic-spills gazetteer', () => {
  it('filters events by ocean-region label', () => {
    const arabian = spillsForRegion('ARABIAN SEA');
    expect(arabian.length).toBeGreaterThanOrEqual(3);
    expect(arabian.every((s) => s.region === 'ARABIAN SEA')).toBe(true);
  });

  it('returns nothing for an unknown region', () => {
    expect(spillsForRegion('NOPE SEA')).toEqual([]);
  });

  it('formats day and time in UTC', () => {
    expect(spillDayTime('2026-08-28T06:45:00Z')).toMatch(/^\d{2} [A-Z]{3} \d{4} · \d{2}:\d{2}Z$/);
    expect(spillDayTime('not-a-date')).toBe('not-a-date');
  });

  it('every event region is one of the monitored oceans', () => {
    const labels = new Set(ALL_OCEAN_REGIONS.map((r) => r.label));
    for (const s of HISTORIC_SPILLS) {
      expect(labels.has(s.region), `${s.region} should be a monitored ocean`).toBe(true);
    }
  });

  it('all severities have a colour token', () => {
    for (const s of HISTORIC_SPILLS) {
      expect(SEVERITY_COLOR[s.severity]).toMatch(/^(#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})|var\(--[a-z0-9-]+\))$/);
      expect(SEVERITY_COLOR_RGB[s.severity]).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });

  it('CSV export quotes rows and escapes quotes', () => {
    const rows = spillsForRegion('ARABIAN SEA');
    const csv = historicSpillsCSV(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('#');
    expect(lines[1]).toContain('"REGION","EVENT_ID","EVENT"');
    expect(lines.length).toBe(rows.length + 2);
    expect(lines[2].startsWith('"ARABIAN SEA"')).toBe(true);
  });

  it('JSON export round-trips with a count', () => {
    const rows = spillsForRegion('BAY OF BENGAL');
    const parsed = JSON.parse(historicSpillsJSON(rows));
    expect(parsed.count).toBe(rows.length);
    expect(parsed.spills[0].region).toBe('BAY OF BENGAL');
    expect(parsed.exportedAt).toBeDefined();
  });
});