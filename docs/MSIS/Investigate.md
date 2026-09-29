# Investigate

Stage 4 of [[Spill Pipeline]].

## What

Ranks nearby vessels by suspicion score based on proximity, temporal, trajectory, and anomaly data.

## Vessels of Interest

| Priority | Vessel | Type | Score | Reason |
|----------|--------|------|-------|--------|
| P1 | MV AL NASRIYAH | Tanker | 87 | Within origin zone, AIS gap 47 min |
| P2 | MT OCEAN VENTURE | Crude Oil Tanker | 74 | Crossed origin zone, course reversal |
| P3 | IMO BHAVYA CONVEYANCE | General Cargo | 61 | Adjacent to spill trajectory |
| P4 | MV CIELO AZUL | Container Ship | 38 | Outside primary origin zone |

## Scoring

- proximityScore — distance to origin zone
- temporalScore — time overlap with spill
- trajectoryScore — alignment with drift path
- anomalyScore — unusual behavior (AIS gap, course reversal)

## Map

Vessel dots on [[3D Globe]]: red (P1), amber (P2), cyan (P3+). Click for full score breakdown.

## See Also

- [[Trace]]
- [[Predict]]
- [[SpillPanel]]
