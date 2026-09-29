# Detect

Stage 2 of [[Spill Pipeline]].

## What

AI classifies the uploaded image as:
- Oil Spill (confidence 82-97%)
- Look-Alike (66-90%)
- No Significant Spill (74-90%)

## How

- Function: `classifyImage()` in spill-upload.ts
- Uses pixel density heuristics
- High density dark pixels = oil spill
- Computes area (km2) for GeoTIFF
- Matches against [[30 Historic Spills]]

## Output

- Classification label
- Confidence percentage
- Area in km2
- Historic match (if any)

## See Also

- [[Upload]]
- [[Trace]]
- [[MSIS]]
