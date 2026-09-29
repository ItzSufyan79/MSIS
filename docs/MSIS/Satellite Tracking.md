# Satellite Tracking

Right panel of [[Screen Layout]].

## Source

- Celestrak TLE (Two-Line Element sets)
- SGP4 orbital propagation

## Satellites

2,000+ objects including:
- Sentinel-1A/B (SAR)
- ISS
- TerraSAR-X
- COSMO-SkyMed

## Data Shown

- Position (lat/lng)
- Sensor footprint (coverage area)
- Ground track (path)
- Next pass (coverage %)

## Updates

Every 15 seconds via `/api/satellites/monitor`.

Query params: `?w&e&s<n` (AOI bounding box from [[Marine Intel]]).

## See Also

- [[3D Globe]]
- [[Data Sources]]
- [[MSIS]]
