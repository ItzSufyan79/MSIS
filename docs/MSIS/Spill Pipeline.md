# Spill Pipeline

```mermaid
graph LR
    Upload --> Detect --> Trace --> Investigate --> Predict
```

## Stages

- [[Upload]] — Drop SAR/EO image
- [[Detect]] — Classify spill type
- [[Trace]] — Origin + drift on [[3D Globe]]
- [[Investigate]] — Rank vessels
- [[Predict]] — Forecast 6h/12h/24h

## Modules

- [[UploadAnalyze]] — File validation + classification trigger
- [[SpillPanel]] — Pipeline status + vessel scores + [[Export]]
- spill-upload.ts — Core classification logic

## Map Layers

All render on [[3D Globe]]:
- msis-spill-fill (spill polygon)
- msis-origin (origin circle)
- msis-drift (drift line)
- msis-forecast (forecast path)
- msis-vessel (vessel dots)

## See Also

- [[MSIS]]
- [[Data Sources]]
