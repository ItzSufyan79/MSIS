/**
 * MSIS — historic spillage gazetteer.
 *
 * Per-ocean historic oil-spill records used to (a) demonstrate spillage history
 * inside the HISTORIC AIS ocean list with an exact day + time, (b) seed the
 * upload-and-analyze model match: while the real SAR model is under
 * construction, a newly classified oil slick is matched to the nearest past
 * event in this corpus so the pipeline can quote volume / cause / day-time
 * estimates today and swap in the production model later.
 *
 * The corpus blends well-documented incidents (ITOPF classics) with synthetic
 * MSIS archive rows so every quick-basin region has a dated, time-stamped
 * record to demo.
 */

export type SpillSeverity = 'MAJOR' | 'MODERATE' | 'MINOR';

export interface HistoricSpill {
  id: string;
  /** Matches an OCEAN_REGIONS / ALL_OCEAN_REGIONS label. */
  region: string;
  name: string;
  /** Exact day + time (UTC), ISO-8601 — the "day and time" of the record. */
  datetime: string;
  cause: string;
  /** Estimated release, tonnes of oil. */
  volumeTonnes: number;
  /** Approximate total oiled area, km². */
  areaKm2: number;
  severity: SpillSeverity;
  source: string;
  lat: number;
  lng: number;
}

/** Severity colour tokens shared by the panels. Values are CSS var refs so
 *  they resolve to the active theme; the *_RGB maps give rgba()-able triplets
 *  for inline alpha work (e.g. `rgba(var(--sev-critical-rgb), 0.53)`). */
export const SEVERITY_COLOR: Record<SpillSeverity, string> = {
  MAJOR: 'var(--sev-critical)',
  MODERATE: 'var(--sev-warn)',
  MINOR: 'var(--sev-info)',
};

export const SEVERITY_COLOR_RGB: Record<SpillSeverity, string> = {
  MAJOR: 'var(--sev-critical-rgb)',
  MODERATE: 'var(--sev-warn-rgb)',
  MINOR: 'var(--sev-info-rgb)',
};

export const HISTORIC_SPILLS: HistoricSpill[] = [
  // ── MSIS Sentinel-1 SAR archive (synthetic) ──
  {
    id: 'MSI-2026-001', region: 'ARABIAN SEA', name: 'Arabian Sea Oil Spill',
    datetime: '2026-08-28T06:45:00Z', cause: 'Tanker transfer / bunkering — AIS gap of 47 min',
    volumeTonnes: 4100, areaKm2: 41.2, severity: 'MAJOR', source: 'MSIS SENTINEL-1 ARCHIVE',
    lat: 19.05, lng: 70.55,
  },
  {
    id: 'MSI-2025-089', region: 'GULF OF KHAMBHAT', name: 'Gulf of Khambhat Slick',
    datetime: '2025-11-04T12:20:00Z', cause: 'Shallow-channel bilge discharge',
    volumeTonnes: 2100, areaKm2: 28.7, severity: 'MODERATE', source: 'MSIS SENTINEL-1 ARCHIVE',
    lat: 21.7, lng: 72.6,
  },
  {
    id: 'MSI-2024-032', region: 'BAY OF BENGAL', name: 'Visakhapatnam Channel Slick',
    datetime: '2024-09-17T11:10:00Z', cause: 'Vessel fuel transfer anomaly near anchorage',
    volumeTonnes: 980, areaKm2: 12.4, severity: 'MODERATE', source: 'MSIS SENTINEL-1 ARCHIVE',
    lat: 17.7, lng: 83.3,
  },
  {
    id: 'MSI-2026-003', region: 'LACCADIVE SEA', name: 'Laccadive Sheen Event',
    datetime: '2026-03-14T08:05:00Z', cause: 'Undetermined — odourless thin sheen',
    volumeTonnes: 120, areaKm2: 1.8, severity: 'MINOR', source: 'MSIS SENTINEL-1 ARCHIVE',
    lat: 9.5, lng: 73.2,
  },
  {
    id: 'MSI-2025-141', region: 'ANDAMAN SEA', name: 'Andaman Transit Slick',
    datetime: '2025-12-19T17:35:00Z', cause: 'Vessel exhaust / fuel oil discharge in shipping lane',
    volumeTonnes: 340, areaKm2: 5.6, severity: 'MINOR', source: 'MSIS SENTINEL-1 ARCHIVE',
    lat: 10.0, lng: 94.5,
  },

  // ── Indian waters (documented) ──
  {
    id: 'RAK-CARRIER-2011', region: 'ARABIAN SEA', name: 'MV Rak Carrier Collision',
    datetime: '2011-08-07T04:30:00Z', cause: 'Bunker tank rupture in collision off Mumbai anchorage',
    volumeTonnes: 410, areaKm2: 4.9, severity: 'MINOR', source: 'INDIAN COAST GUARD',
    lat: 18.98, lng: 72.83,
  },
  {
    id: 'MUMBAI-HIGH-2005', region: 'ARABIAN SEA', name: 'Mumbai High North Fire',
    datetime: '2005-07-27T20:00:00Z', cause: 'Platform fire — drilling rig collision (Mumbai High North)',
    volumeTonnes: 225, areaKm2: 6.2, severity: 'MODERATE', source: 'MOT / INDIAN COAST GUARD',
    lat: 19.4, lng: 72.1,
  },
  {
    id: 'DAWN-KANCHEEPURAM-2017', region: 'BAY OF BENGAL', name: 'MT Dawn Kancheepuram',
    datetime: '2017-01-28T02:40:00Z', cause: 'Sinking 36 km off Chennai — fuel + engine oil release',
    volumeTonnes: 260, areaKm2: 3.1, severity: 'MINOR', source: 'INDIAN COAST GUARD',
    lat: 13.3, lng: 80.6,
  },

  // ── Atlantic Ocean ──
  {
    id: 'TORREY-CANYON-1967', region: 'ATLANTIC OCEAN', name: 'Torrey Canyon',
    datetime: '1967-03-18T09:00:00Z', cause: 'Tanker grounding — Seven Stones reef, Scilly Isles',
    volumeTonnes: 119000, areaKm2: 700, severity: 'MAJOR', source: 'ITOPF',
    lat: 49.8, lng: -6.1,
  },
  {
    id: 'AMOCO-CADIZ-1978', region: 'ATLANTIC OCEAN', name: 'Amoco Cadiz',
    datetime: '1978-03-16T09:45:00Z', cause: 'Tanker wreck — Portsall rocks, Brittany',
    volumeTonnes: 223000, areaKm2: 300, severity: 'MAJOR', source: 'ITOPF',
    lat: 48.6, lng: -4.7,
  },
  {
    id: 'PRESTIGE-2002', region: 'ATLANTIC OCEAN', name: 'Prestige',
    datetime: '2002-11-13T15:15:00Z', cause: 'Tanker hull failure — Galicia coast',
    volumeTonnes: 63000, areaKm2: 150, severity: 'MAJOR', source: 'ITOPF',
    lat: 42.2, lng: -9.9,
  },
  {
    id: 'ERIKA-1999', region: 'ATLANTIC OCEAN', name: 'Erika',
    datetime: '1999-12-12T07:00:00Z', cause: 'Tanker breakup — Bay of Biscay',
    volumeTonnes: 20000, areaKm2: 80, severity: 'MODERATE', source: 'ITOPF',
    lat: 47.0, lng: -4.0,
  },
  {
    id: 'ODYSSEY-1988', region: 'ATLANTIC OCEAN', name: 'Odyssey',
    datetime: '1988-11-10T16:00:00Z', cause: 'Tanker explosion — Nova Scotia shelf',
    volumeTonnes: 132000, areaKm2: 250, severity: 'MAJOR', source: 'ITOPF',
    lat: 44.0, lng: -59.0,
  },
  {
    id: 'ABT-SUMMER-1991', region: 'ATLANTIC OCEAN', name: 'ABT Summer',
    datetime: '1991-05-28T12:00:00Z', cause: 'Tanker explosion off Angola coast',
    volumeTonnes: 260000, areaKm2: 400, severity: 'MAJOR', source: 'ITOPF',
    lat: -8.0, lng: 9.0,
  },
  {
    id: 'CASTILLO-BELLVER-1983', region: 'ATLANTIC OCEAN', name: 'Castillo de Bellver',
    datetime: '1983-08-06T02:00:00Z', cause: 'Tanker fire — Saldanha Bay',
    volumeTonnes: 252000, areaKm2: 350, severity: 'MAJOR', source: 'ITOPF',
    lat: -33.0, lng: 17.9,
  },

  // ── Pacific Ocean ──
  {
    id: 'EXXON-VALDEZ-1989', region: 'PACIFIC OCEAN', name: 'Exxon Valdez',
    datetime: '1989-03-24T09:04:00Z', cause: 'Tanker grounding — Prince William Sound, Alaska',
    volumeTonnes: 37000, areaKm2: 200, severity: 'MAJOR', source: 'ITOPF',
    lat: 60.8, lng: -146.4,
  },

  // ── Gulf of Mexico ──
  {
    id: 'DEEPWATER-2010', region: 'GULF OF MEXICO', name: 'Deepwater Horizon',
    datetime: '2010-04-20T21:53:00Z', cause: 'Blowout — Macondo wellhead, Mississippi Canyon',
    volumeTonnes: 780000, areaKm2: 1490, severity: 'MAJOR', source: 'ITOPF',
    lat: 28.74, lng: -88.4,
  },
  {
    id: 'IXTOC-1979', region: 'GULF OF MEXICO', name: 'Ixtoc I',
    datetime: '1979-06-03T02:00:00Z', cause: 'Well blowout — Bay of Campeche',
    volumeTonnes: 476000, areaKm2: 900, severity: 'MAJOR', source: 'ITOPF',
    lat: 19.4, lng: -92.5,
  },

  // ── Persian Gulf ──
  {
    id: 'GULF-WAR-1991', region: 'PERSIAN GULF', name: 'Gulf War Spill',
    datetime: '1991-01-19T06:00:00Z', cause: 'Deliberate release — Nowruz field, Persian Gulf',
    volumeTonnes: 1500000, areaKm2: 1700, severity: 'MAJOR', source: 'ITOPF',
    lat: 29.5, lng: 50.8,
  },

  // ── Mediterranean Sea ──
  {
    id: 'HAVEN-1991', region: 'MEDITERRANEAN SEA', name: 'MV Haven',
    datetime: '1991-04-11T12:00:00Z', cause: 'Tanker explosion — Genoa approaches',
    volumeTonnes: 144000, areaKm2: 800, severity: 'MAJOR', source: 'ITOPF',
    lat: 44.2, lng: 8.8,
  },
  {
    id: 'JIYEH-2006', region: 'MEDITERRANEAN SEA', name: 'Jiyeh Power-Plant Spill',
    datetime: '2006-07-15T05:00:00Z', cause: 'Coastal fuel tanks damaged — eastern Mediterranean',
    volumeTonnes: 15000, areaKm2: 100, severity: 'MODERATE', source: 'UNEP',
    lat: 33.67, lng: 35.5,
  },

  // ── Red Sea ──
  {
    id: 'RED-SEA-2021', region: 'RED SEA', name: 'FSO Safer Threat Assessment',
    datetime: '2021-05-09T14:00:00Z', cause: 'Abandoned FSO Safer hull deterioration — Ras Isa terminal',
    volumeTonnes: 110000, areaKm2: 0, severity: 'MODERATE', source: 'UN OCHA',
    lat: 15.2, lng: 42.7,
  },

  // ── East China Sea ──
  {
    id: 'SANCHI-2018', region: 'EAST CHINA SEA', name: 'MT Sanchi',
    datetime: '2018-01-06T12:00:00Z', cause: 'Collision + fire — crude/condensate release',
    volumeTonnes: 113000, areaKm2: 160, severity: 'MODERATE', source: 'ITOPF',
    lat: 30.4, lng: 125.8,
  },
  {
    id: 'HEBEI-SPIRIT-2007', region: 'EAST CHINA SEA', name: 'Hebei Spirit',
    datetime: '2007-12-07T07:50:00Z', cause: 'Collision with crane barge — Yellow Sea (Taean coast)',
    volumeTonnes: 10900, areaKm2: 40, severity: 'MODERATE', source: 'ITOPF',
    lat: 36.8, lng: 126.1,
  },

  // ── North Sea ──
  {
    id: 'BRAER-1993', region: 'NORTH SEA', name: 'Braer',
    datetime: '1993-01-05T11:00:00Z', cause: 'Tanker wreck in storm — Shetland Is.',
    volumeTonnes: 85000, areaKm2: 130, severity: 'MAJOR', source: 'ITOPF',
    lat: 59.87, lng: -1.3,
  },
  {
    id: 'EKOFISK-1977', region: 'NORTH SEA', name: 'Ekofisk Bravo',
    datetime: '1977-04-22T02:00:00Z', cause: 'Platform blowout — Ekofisk field',
    volumeTonnes: 81000, areaKm2: 90, severity: 'MODERATE', source: 'ITOPF',
    lat: 56.5, lng: 2.3,
  },

  // ── Baltic Sea ──
  {
    id: 'GLOBE-ASIMI-1981', region: 'BALTIC SEA', name: 'Globe Asimi',
    datetime: '1981-11-13T22:00:00Z', cause: 'Tanker grounding — Klaipèda approaches',
    volumeTonnes: 16000, areaKm2: 60, severity: 'MODERATE', source: 'ITOPF',
    lat: 55.7, lng: 21.1,
  },

  // ── Caribbean Sea ──
  {
    id: 'ATLANTIC-EMPRESS-1979', region: 'CARIBBEAN SEA', name: 'Atlantic Empress',
    datetime: '1979-07-19T02:00:00Z', cause: 'Tanker collision — off Trinidad',
    volumeTonnes: 287000, areaKm2: 500, severity: 'MAJOR', source: 'ITOPF',
    lat: 10.6, lng: -61.0,
  },

  // ── Gulf of Guinea ──
  {
    id: 'BONGA-2011', region: 'GULF OF GUINEA', name: 'Bonga Field Leak',
    datetime: '2011-12-20T15:00:00Z', cause: 'Offshore subsea leak — Niger Delta shelf',
    volumeTonnes: 9000, areaKm2: 40, severity: 'MODERATE', source: 'NOSDRA',
    lat: 4.2, lng: 4.6,
  },

  // ── Philippine Sea ──
  {
    id: 'SOLAR1-2006', region: 'PHILIPPINE SEA', name: 'Solar I',
    datetime: '2006-08-11T07:00:00Z', cause: 'Tanker sinking — Guimaras Strait',
    volumeTonnes: 2100, areaKm2: 12, severity: 'MODERATE', source: 'ITOPF',
    lat: 10.3, lng: 122.6,
  },

  // ── Black Sea ──
  {
    id: 'VOLGONEFT-2007', region: 'BLACK SEA', name: 'Volgoneft-139',
    datetime: '2007-11-11T09:00:00Z', cause: 'Tanker breakup in storm — Kerch Strait',
    volumeTonnes: 1300, areaKm2: 8, severity: 'MINOR', source: 'ITOPF',
    lat: 45.2, lng: 36.9,
  },
];

/** Historic events filed against one ocean-region label. */
export function spillsForRegion(regionLabel: string): HistoricSpill[] {
  return HISTORIC_SPILLS.filter((s) => s.region === regionLabel);
}

/** "28 AUG 2026 · 06:45Z" — the day and time of a historic record. */
export function spillDayTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  const time = d.toISOString().slice(11, 16);
  return `${day} · ${time}Z`;
}

/** Header row + one CSV line per spill, for the downloadable record. */
export function historicSpillsCSV(rows: HistoricSpill[]): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push('# MSIS HISTORIC SPILLAGE — exported from ocean gazetteer');
  lines.push(['REGION', 'EVENT_ID', 'EVENT', 'DAY_UTC', 'TIME_UTC', 'VOLUME_TONNES', 'AREA_KM2', 'SEVERITY', 'CAUSE', 'SOURCE', 'LAT', 'LNG'].map(esc).join(','));
  for (const s of rows) {
    lines.push([
      s.region, s.id, s.name,
      spillDayTime(s.datetime).split(' · ')[0] ?? s.datetime,
      spillDayTime(s.datetime).split(' · ')[1]?.replace('Z', '') ?? '',
      String(s.volumeTonnes), String(s.areaKm2), s.severity,
      s.cause, s.source, String(s.lat), String(s.lng),
    ].map(esc).join(','));
  }
  return lines.join('\n');
}

export function historicSpillsJSON(rows: HistoricSpill[]): string {
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, spills: rows }, null, 2);
}