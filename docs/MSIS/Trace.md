# Trace

Stage 3 of [[Spill Pipeline]].

## What

Draws the origin uncertainty circle and drift trajectory on [[3D Globe]].

## Map Layers

- **msis-origin**: Red dashed circle, 22km radius around hardcoded origin
- **msis-drift**: Blue dashed 5-point LineString from origin northeast
- **msis-spill-fill**: Orange-red fill of classified spill polygon

## Data

- Origin: center [70.48, 18.92], radius 22km
- Drift: 5-point LineString heading NE (~285 degree bearing)
- Forecast positions at 6h, 12h, 24h

## See Also

- [[Detect]]
- [[Investigate]]
- [[3D Globe]]
