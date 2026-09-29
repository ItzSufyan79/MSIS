/**
 * MSIS — Marine Spill Intelligence System
 * Mock marine oil-spill intelligence data + GeoJSON builders.
 *
 * Self-contained and static so the MSIS map can render the spill pipeline
 * (Detect → Characterize → Trace → Investigate → Predict) without a backend.
 */

export interface SpillVessel {
  id: string;
  name: string;
  type: string;
  mmsi: string;
  course: number;
  speedKnots: number;
  position: [number, number];
  proximityScore: number;
  temporalScore: number;
  trajectoryScore: number;
  anomalyScore: number;
  compositeScore: number;
  reason: string;
  priority: number;
}

export interface SpillEvent {
  id: string;
  name: string;
  datetime: string;
  status: 'active' | 'resolved';
  classification: 'Oil Spill' | 'Look-Alike' | 'No Significant Spill';
  confidence: number;
  areaKm2: number;
  lengthKm: number;
  widthKm: number;
  orientationDeg: number;
  shape: string;
  polygon: [number, number][];
  driftTrajectory: [number, number][];
  originZone: { center: [number, number]; radiusKm: number };
  forecastHours: number[];
  forecastPositions: [number, number][];
  vessels: SpillVessel[];
}

/** Example spill in the Arabian Sea, off India's west coast. */
export const marineSpillEvents: SpillEvent[] = [
  {
    id: 'MSI-2026-001',
    name: 'Arabian Sea Oil Spill',
    datetime: '2026-08-28T06:45:00Z',
    status: 'active',
    classification: 'Oil Spill',
    confidence: 96,
    areaKm2: 41.2,
    lengthKm: 14.6,
    widthKm: 3.8,
    orientationDeg: 285,
    shape: 'Elongated streak',
    polygon: [
      [70.55, 19.05],
      [70.68, 19.18],
      [70.82, 19.14],
      [70.72, 19.02],
      [70.55, 19.05],
    ],
    driftTrajectory: [
      [70.55, 19.05],
      [70.62, 19.12],
      [70.7, 19.17],
      [70.8, 19.22],
      [70.92, 19.25],
    ],
    originZone: { center: [70.48, 18.92], radiusKm: 22 },
    forecastHours: [6, 12, 24],
    forecastPositions: [
      [70.62, 19.12],
      [70.72, 19.2],
      [70.9, 19.3],
    ],
    vessels: [
      {
        id: 'AIS-334511207',
        name: 'MV AL NASRIYAH',
        type: 'Tanker',
        mmsi: '334511207',
        course: 287,
        speedKnots: 11.4,
        position: [70.44, 18.88],
        proximityScore: 0.94,
        temporalScore: 0.89,
        trajectoryScore: 0.86,
        anomalyScore: 0.72,
        compositeScore: 87,
        reason: 'Within origin zone, AIS gap of 47 min during window',
        priority: 1,
      },
      {
        id: 'AIS-563049122',
        name: 'MT OCEAN VENTURE',
        type: 'Crude Oil Tanker',
        mmsi: '563049122',
        course: 92,
        speedKnots: 9.8,
        position: [70.61, 19.05],
        proximityScore: 0.81,
        temporalScore: 0.84,
        trajectoryScore: 0.78,
        anomalyScore: 0.55,
        compositeScore: 74,
        reason: 'Crossed origin zone, course reversal detected',
        priority: 2,
      },
      {
        id: 'AIS-372004188',
        name: 'IMO BHAVYA CONVEYANCE',
        type: 'General Cargo',
        mmsi: '372004188',
        course: 178,
        speedKnots: 7.2,
        position: [70.55, 19.18],
        proximityScore: 0.68,
        temporalScore: 0.71,
        trajectoryScore: 0.65,
        anomalyScore: 0.41,
        compositeScore: 61,
        reason: 'Adjacent to spill trajectory, low anomaly indicators',
        priority: 3,
      },
      {
        id: 'AIS-225443099',
        name: 'MV CIELO AZUL',
        type: 'Container Ship',
        mmsi: '225443099',
        course: 314,
        speedKnots: 14.1,
        position: [70.77, 19.31],
        proximityScore: 0.42,
        temporalScore: 0.38,
        trajectoryScore: 0.5,
        anomalyScore: 0.22,
        compositeScore: 38,
        reason: 'Outside primary origin zone, routine transit route',
        priority: 4,
      },
    ],
  },
  {
    id: 'MSI-2025-089',
    name: 'Gulf of Khambhat Slick',
    datetime: '2025-11-04T12:20:00Z',
    status: 'resolved',
    classification: 'Oil Spill',
    confidence: 91,
    areaKm2: 28.7,
    lengthKm: 11.2,
    widthKm: 2.9,
    orientationDeg: 32,
    shape: 'Irregular patch',
    polygon: [
      [72.5, 21.65],
      [72.6, 21.72],
      [72.7, 21.7],
      [72.61, 21.63],
      [72.5, 21.65],
    ],
    driftTrajectory: [
      [72.5, 21.65],
      [72.57, 21.73],
      [72.66, 21.8],
      [72.77, 21.85],
    ],
    originZone: { center: [72.44, 21.58], radiusKm: 18 },
    forecastHours: [6, 12, 24],
    forecastPositions: [
      [72.57, 21.73],
      [72.67, 21.82],
      [72.84, 21.92],
    ],
    vessels: [],
  },
];

export const marineSpillSource = (e: SpillEvent) => ({
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [e.polygon] },
      properties: { kind: 'spill', eventId: e.id, eventName: e.name, areaKm2: e.areaKm2, confidence: e.confidence, classification: e.classification },
    },
    {
      type: 'Feature' as const,
      geometry: { type: 'LineString' as const, coordinates: e.driftTrajectory },
      properties: { kind: 'drift', eventId: e.id },
    },
    {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: e.originZone.center },
      properties: { kind: 'origin', eventId: e.id, radiusKm: e.originZone.radiusKm },
    },
    ...e.vessels.map((v: SpillVessel) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: v.position },
      properties: { kind: 'vessel', eventId: e.id, ...v },
    })),
    // Predicted drift — the forecast line plus a marker per horizon, so the
    // map can both trace the +6/+12/+24 path and highlight a selected hour.
    ...(e.forecastPositions.length >= 2
      ? [{
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: e.forecastPositions },
          properties: { kind: 'forecast', eventId: e.id, hours: e.forecastHours },
        }]
      : []),
    ...e.forecastHours.map((hour, i) => {
      const pos = e.forecastPositions[i];
      return pos ? {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: pos },
        properties: { kind: 'forecast-point', eventId: e.id, hour },
      } : null;
    }).filter((f): f is NonNullable<typeof f> => !!f),
  ],
});
