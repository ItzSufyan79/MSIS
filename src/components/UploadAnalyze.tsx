'use client';

import { useRef, useState } from 'react';
import { X, UploadCloud, FileImage, FileStack, Image as ImageIcon, ScanSearch, Download, History } from 'lucide-react';
import {
  validateUpload,
  readPreview,
  classifyImage,
  type UploadedImage,
  type UploadResult,
  type UploadKind,
} from '@/lib/spill-upload';
import { spillDayTime, SEVERITY_COLOR } from '@/lib/historic-spills';

type Stage = 'idle' | 'analyzing' | 'done';

export default function UploadAnalyze({
  onClose,
  flyTo,
  onAnalyzed,
  onReset,
}: {
  onClose: () => void;
  flyTo: (coords: [number, number], zoom: number) => void;
  /** Fired with a completed analysis so the page can place an Oil Spill
   *  verdict as a live pipeline event on the map. */
  onAnalyzed?: (result: UploadResult, image: UploadedImage) => void;
  /** Fired when the operator resets (or re-analyses) the current upload, so
   *  the placed pipeline event is torn back down. */
  onReset?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<UploadedImage | null>(null);
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleFile(f: File) {
    setError(null);
    const check = validateUpload(f);
    if (!check.ok) {
      setError(check.error);
      setFile(null);
      setStage('idle');
      setResult(null);
      return;
    }
    const preview = await readPreview(f);
    setFile(preview);
    setStage('analyzing');
    setResult(null);
    // A beat of "computation" so the pipeline reads — then classify.
    await new Promise((r) => setTimeout(r, 700));
    const res = await classifyImage(f, preview.kind);
    setResult(res);
    setStage('done');
    onAnalyzed?.(res, preview);
  }

  function reset() {
    setFile(null);
    setStage('idle');
    setResult(null);
    setError(null);
    onReset?.();
    if (inputRef.current) inputRef.current.value = '';
  }

  function download(filename: string, text: string, type: string) {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportResult() {
    if (!file || !result) return;
    const evId = file.id;
    const rows = [
      ['eventId', evId],
      ['eventName', `Uploaded ${file.name}`],
      ['source', file.name],
      ['datetime', new Date().toISOString()],
      ['kind', file.kind],
      ['georeferenced', String(file.georeferenced)],
      ['classification', result.classification],
      ['confidence', String(result.confidence)],
      ['areaKm2', String(result.areaKm2 ?? 'N/A')],
    ];
    if (result.historic) {
      rows.push(['matchedHistoricEvent', result.historic.event.name]);
      rows.push(['matchedHistoricDay', result.historic.event.datetime]);
      rows.push(['matchedHistoricSimilarity', `${result.historic.similarity}%`]);
      rows.push(['estimatedVolumeTonnes', String(result.historic.event.volumeTonnes)]);
      rows.push(['estimatedCause', result.historic.event.cause]);
    }
    download(`${evId}-analysis.csv`, rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  }

  const resultColor =
    result?.classification === 'Oil Spill' ? 'var(--sev-alert)' : result?.classification === 'Look-Alike' ? 'var(--sev-warn)' : 'var(--sev-ok)';
  const resultColorRgb =
    result?.classification === 'Oil Spill' ? 'var(--sev-alert-rgb)' : result?.classification === 'Look-Alike' ? 'var(--sev-warn-rgb)' : 'var(--sev-ok-rgb)';
  const StageIcon = file?.kind === 'geotiff' ? FileStack : ImageIcon;

  return (
    <div className="shadow-around theme-fixed-dark pointer-events-auto w-[min(92vw,360px)] overflow-hidden rounded-lg border border-white/10 bg-[var(--panel-glass)] backdrop-blur-lg">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[var(--sev-gold)] to-transparent" />

      <div className="flex items-start gap-2 px-3 pt-3">
        <UploadCloud className="mt-[2px] h-4 w-4 flex-shrink-0 text-[var(--sev-gold)]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-bold tracking-wide text-[var(--text-heading)]">UPLOAD &amp; ANALYZE</div>
          <div className="truncate font-mono text-[8px] tracking-[0.1em] text-[var(--text-muted)]">
            Sentinel-1 / GeoTIFF / PNG / JPG
          </div>
        </div>
        <button
          onClick={onClose}
          className="-mr-1 -mt-1 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-white focus:outline-none"
          aria-label="Close upload panel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-3 py-2.5">
        {error && (
          <div className="mb-2 rounded-md border border-[rgba(var(--sev-alert-rgb),0.33)] bg-[rgba(var(--sev-alert-rgb),0.1)] px-2 py-1.5 font-mono text-[9px] text-[var(--sev-alert)]">
            {error}
          </div>
        )}

        {stage === 'idle' && (
          <button
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-1.5 rounded-md border border-dashed border-white/15 bg-white/[0.02] px-3 py-5 text-center transition-colors hover:border-[rgba(var(--sev-gold-rgb),0.5)] hover:bg-white/[0.04]"
          >
            <FileImage className="h-6 w-6 text-[var(--text-secondary)]" />
            <span className="font-mono text-[9px] text-[var(--text-secondary)]">
              Drop or click to choose a satellite image
            </span>
            <span className="font-mono text-[7px] text-[var(--text-muted)]">
              PNG · JPG · GeoTIFF — max 25 MB
            </span>
          </button>
        )}

        {file && stage !== 'idle' && (
          <div className="mb-2 flex items-center gap-2 rounded-md border border-white/5 bg-white/[0.02] p-2">
            <StageIcon className="h-8 w-8 flex-shrink-0 text-[rgba(var(--sev-gold-rgb),0.7)]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[10px] font-bold text-[var(--text-heading)]">{file.name}</div>
              <div className="font-mono text-[8px] text-[var(--text-muted)]">
                {(file.sizeBytes / 1024).toFixed(1)} KB · {file.kind.toUpperCase()}
                {file.width ? ` · ${file.width}×${file.height}` : ''}
              </div>
            </div>
            {stage === 'done' && (
              <button
                onClick={reset}
                className="rounded px-1.5 py-1 font-mono text-[8px] text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-white"
              >
                RESET
              </button>
            )}
          </div>
        )}

        {stage === 'analyzing' && (
          <div className="flex flex-col items-center gap-1.5 py-3">
            <ScanSearch className="h-5 w-5 animate-pulse text-[var(--sev-gold)]" />
            <div className="font-mono text-[9px] text-[var(--text-secondary)]">VALIDATE → DETECT → CLASSIFY…</div>
            <div className="font-mono text-[7px] text-[var(--text-muted)]">
              {file?.kind === 'geotiff' ? 'Georeferencing available — estimating geographic extent' : 'Non-georeferenced — classification only'}
            </div>
          </div>
        )}

        {stage === 'done' && result && (
          <div className="flex flex-col gap-2">
            <div
              className="flex items-center gap-2 rounded-md px-2.5 py-2"
              style={{ background: `rgba(${resultColorRgb}, 0.08)`, border: `1px solid rgba(${resultColorRgb}, 0.27)` }}
            >
              <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ background: resultColor, boxShadow: `0 0 8px rgba(${resultColorRgb}, 0.67)` }} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold" style={{ color: resultColor }}>
                  {result.classification}
                </div>
                <div className="font-mono text-[8px] text-[var(--text-muted)]">
                  CONFIDENCE {result.confidence}% · {result.segmented ? 'SEGMENTED' : 'CLASSIFICATION ONLY'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-md border border-white/5 bg-white/[0.02] p-2">
                <div className="text-[7px] font-mono tracking-[0.12em] text-[var(--text-muted)]">AREA</div>
                <div className="font-mono text-[11px] font-medium text-[var(--text-heading)]">
                  {result.areaKm2 !== null ? `${result.areaKm2.toFixed(1)} km²` : 'N/A'}
                </div>
              </div>
              <div className="rounded-md border border-white/5 bg-white/[0.02] p-2">
                <div className="text-[7px] font-mono tracking-[0.12em] text-[var(--text-muted)]">GEO</div>
                <div className="font-mono text-[11px] font-medium" style={{ color: file?.georeferenced ? 'var(--sev-ok)' : 'var(--sev-warn)' }}>
                  {file?.georeferenced ? 'GEOREFERENCED' : 'UNPROJECTED'}
                </div>
              </div>
            </div>

            {result.historic && (
              <div className="rounded-md border border-white/10 bg-black/20 p-2">
                <div className="mb-1 flex items-center gap-1.5">
                  <History className="h-3 w-3 flex-shrink-0" style={{ color: 'var(--gold-primary)' }} />
                  <span className="flex-1 font-mono text-[8px] font-bold tracking-[0.14em] text-[var(--gold-primary)]">
                    MATCHED HISTORIC EVENT
                  </span>
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: SEVERITY_COLOR[result.historic.event.severity] }}
                    title={`${result.historic.event.severity} — ${result.historic.event.source}`}
                  />
                </div>
                <div className="text-[10px] font-bold text-[var(--text-heading)]">
                  {result.historic.event.name}
                </div>
                <div className="mt-0.5 font-mono text-[8px] text-[var(--text-secondary)]">
                  {spillDayTime(result.historic.event.datetime)} · {result.historic.event.volumeTonnes.toLocaleString()} t
                  · {result.historic.event.cause}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1">
                    <div className="mb-0.5 flex justify-between font-mono text-[7px] text-[var(--text-muted)]">
                      <span>LIKENESS</span>
                      <span style={{ color: 'var(--gold-primary)' }}>{result.historic.similarity}%</span>
                    </div>
                    <div className="h-1 overflow-hidden rounded bg-white/10">
                      <div
                        className="h-full rounded"
                        style={{ width: `${result.historic.similarity}%`, background: 'linear-gradient(90deg,var(--sev-gold),var(--sev-flame))' }}
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-1 font-mono text-[7px] leading-relaxed text-[var(--text-muted)]">
                  MODEL UNDER CONSTRUCTION — matched against the historic archive; production weights will auto-update.
                </div>
              </div>
            )}

            <div className="font-mono text-[7px] leading-relaxed text-[var(--text-muted)]">{result.note}</div>

            <div className="flex flex-col gap-1.5 pt-0.5">
              <div className="flex flex-col gap-1 pt-1">
                <div className="text-center font-mono text-[7px] tracking-[0.2em] text-[var(--text-muted)]">
                  DETECT → CHARACTERIZE → TRACE → INVESTIGATE → PREDICT
                </div>
                <button
                  onClick={exportResult}
                  className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 font-mono text-[9px] font-bold tracking-wider text-[var(--gold-primary)] transition-colors hover:bg-white/10"
                >
                  <Download className="h-3 w-3" /> EXPORT ANALYSIS (.CSV)
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.tif,.tiff,image/png,image/jpeg,image/tiff"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
    </div>
  );
}