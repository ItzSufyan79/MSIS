# UploadAnalyze

Component in [[Screen Layout]] top bar.

## What

Drag-drop or file picker for [[Upload]] stage of [[Spill Pipeline]].

## Flow

1. Validate file type (GeoTIFF, JPEG, PNG)
2. Read preview
3. Run [[Detect]] classification
4. Match against [[Marine Intel|30 Historic Spills]]
5. Auto-place result on [[3D Globe]]
6. Trigger [[Export]]

## See Also

- [[Spill Pipeline]]
- [[SpillPanel]]
- [[MSIS]]
