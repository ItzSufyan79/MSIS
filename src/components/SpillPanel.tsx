'use client';

import { useState } from 'react';
import { X, Droplet, Ship, Anchor, Download, FileJson, ChevronUp, ChevronDown, LocateFixed } from 'lucide-react';
import { type SpillEvent, type SpillVessel } from '@/lib/marine-spill';
import { analysisReportFromEvent, reportToCSV, eventToGeoJSON } from '@/lib/spill-upload';

function download(filename: string, text: string, type: string) {
 const blob = new Blob([text], { type });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = filename;
 a.click();
 URL.revokeObjectURL(url);
}

function Field({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
 return (
 <div className="min-w-0">
 <div className="text-[7px] font-mono tracking-[0.12em] text-[var(--text-muted)]">{label}</div>
 <div className="truncate font-mono text-[11px] font-medium" style={{ color: color || 'var(--text-primary)' }}>
 {value}
 </div>
 </div>
 );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  const col = pct > 75 ? 'var(--sev-critical)' : pct > 50 ? 'var(--sev-warn)' : 'var(--sev-info)';
 return (
 <div>
 <div className="mb-0.5 flex items-center justify-between">
 <span className="text-[8px] text-[var(--text-muted)]">{label}</span>
 <span className="font-mono text-[8px] text-[var(--text-secondary)]">{pct}%</span>
 </div>
 <div className="h-[3px] overflow-hidden rounded-full bg-[var(--surface-2)]">
 <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col }} />
 </div>
 </div>
 );
}

function VesselRow({ v, onClick }: { v: SpillVessel; onClick: () => void }) {
  const col = v.priority === 1 ? 'var(--sev-critical)' : v.priority === 2 ? 'var(--sev-warn)' : 'var(--sev-info)';
  const colRgb = v.priority === 1 ? 'var(--sev-critical-rgb)' : v.priority === 2 ? 'var(--sev-warn-rgb)' : 'var(--sev-info-rgb)';
  const scoreCol = v.compositeScore > 75 ? 'var(--sev-critical)' : v.compositeScore > 50 ? 'var(--sev-warn)' : 'var(--sev-ok)';
  const scoreColRgb = v.compositeScore > 75 ? 'var(--sev-critical-rgb)' : v.compositeScore > 50 ? 'var(--sev-warn-rgb)' : 'var(--sev-ok-rgb)';
 return (
 <button
 onClick={onClick}
 className="w-full rounded-md border-[var(--surface-border)] bg-[var(--surface-1)] p-2 text-left transition-colors hover:bg-[var(--hover-surface)]"
 >
 <div className="flex items-center gap-2">
<span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: col, boxShadow: `0 0 6px rgba(${colRgb}, 0.67)` }} />
  <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-bold text-[var(--text-heading)]">{v.name}</span>
  <span className="rounded px-1.5 font-mono text-[9px] font-bold" style={{ color: scoreCol, background: `rgba(${scoreColRgb}, 0.1)` }}>
 {v.compositeScore}
 </span>
 </div>
<div className="mt-1 flex items-center gap-2 font-mono text-[8px] text-[var(--text-muted)]">
  <span>PRIO #{v.priority}</span>
  <span>·</span>
  <span>{v.type}</span>
  <span>·</span>
  <span>{v.speedKnots} kn</span>
  </div>
  <div className="mt-1.5 grid grid-cols-2 gap-x-2.5 gap-y-1.5">
  <ScoreBar label="PROXIMITY" value={v.proximityScore} />
  <ScoreBar label="TEMPORAL" value={v.temporalScore} />
  <ScoreBar label="TRAJECTORY" value={v.trajectoryScore} />
  <ScoreBar label="ANOMALY" value={v.anomalyScore} />
  </div>
  </button>
  );
}

export default function SpillPanel({
  event,
  onClose,
  flyTo,
  collapsed = false,
  onToggle,
  events = [event],
  selectedIndex = 0,
  onSelectIndex,
  forecastHour = null,
  onSelectForecast,
}: {
  event: SpillEvent;
  onClose: () => void;
  flyTo: (coords: [number, number], zoom: number) => void;
  collapsed?: boolean;
  onToggle?: () => void;
  /** Archive + upload pipeline events; renders a switcher when there are more
   *  than one, so the operator can move between slicks. Defaults to the single
   *  handed-in event. */
  events?: SpillEvent[];
  selectedIndex?: number;
  onSelectIndex?: (i: number) => void;
  /** Active forecast horizon (T+N), emphasised on the map. */
  forecastHour?: number | null;
  onSelectForecast?: (hour: number) => void;
}) {
  const isActive = event.status === 'active';
  const showSwitcher = events.length > 1 && !!onSelectIndex;
  const [showVessels, setShowVessels] = useState(true);
 return (
 <div
 className="pointer-events-auto flex h-full w-full min-h-0 flex-col overflow-hidden rounded-lg bg-[var(--panel-glass)] shadow-[0_6px_20px_rgba(0,0,0,0.45)] backdrop-blur-lg"
 role="dialog"
 aria-label={event.name}
 >
<div className="h-px w-full" style={{ background: 'rgba(var(--sev-alert-rgb), 0.8)' }} />

  <div className="flex shrink-0 items-center gap-2 px-2.5 py-1.5">
  <Droplet className="h-3.5 w-3.5 flex-shrink-0" style={{ color: 'var(--sev-alert)' }} />
 <div className="min-w-0 flex-1">
 <div className="truncate text-[11px] font-bold leading-tight tracking-wide text-[var(--text-heading)]">
 {event.name}
 </div>
 <div className="truncate font-mono text-[8px] tracking-[0.12em] text-[var(--text-secondary)]">
 {event.id} · {event.classification}
 </div>
 </div>
 <span
 className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-wider"
style={{
  color: isActive ? 'var(--sev-critical)' : 'var(--sev-ok)',
  background: isActive ? 'rgba(var(--sev-critical-rgb), 0.13)' : 'rgba(var(--sev-ok-rgb), 0.13)',
  }}
 >
 {event.status.toUpperCase()}
 </span>
 {onToggle && (
 <button
 onClick={onToggle}
 title={collapsed ? 'Expand spill intel' : 'Fold spill intel'}
 aria-label={collapsed ? 'Expand spill intel' : 'Fold spill intel'}
 className="flex-shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-surface)] hover:text-[var(--text-heading)] focus:outline-none"
 >
 {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
 </button>
 )}
 <button
 onClick={onClose}
 className="-mr-1 flex-shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-surface)] hover:text-[var(--text-heading)] focus:outline-none"
aria-label="Close spill panel"
  >
  <X className="h-3 w-3" />
  </button>
  </div>

  {showSwitcher && (
  <div className="flex shrink-0 flex-wrap items-center gap-1 px-2.5 pb-1.5">
  {events.map((ev, i) => (
  <button
  key={ev.id}
  onClick={() => onSelectIndex?.(i)}
  aria-pressed={i === selectedIndex}
  title={ev.name}
  className={`rounded px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-wider transition-colors ${
  i === selectedIndex
  ? 'bg-[rgba(var(--sev-cyan-rgb),0.16)] text-[var(--sev-cyan)]'
  : 'text-[var(--text-muted)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-secondary)]'
  }`}
  >
  {ev.id}
  </button>
  ))}
  </div>
  )}

  {!collapsed && (<>
 <div className="min-h-0 flex-1 overflow-y-auto styled-scrollbar px-2.5 pb-1">
 <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 py-2">
 <Field label="CONFIDENCE" value={`${event.confidence}%`} color="var(--sev-alert)" />
 <Field label="AREA" value={`${event.areaKm2} km²`} />
 <Field label="LENGTH" value={`${event.lengthKm} km`} />
 <Field label="WIDTH" value={`${event.widthKm} km`} />
 <Field label="BEARING" value={`${event.orientationDeg}°`} />
 <Field label="SHAPE" value={event.shape} />
 </div>

 <div className=" pt-2">
  <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[0.15em] text-[var(--text-heading)]">
   <Anchor className="h-3 w-3 text-[var(--sev-critical)]" /> ORIGIN ANALYSIS
  </div>
 <button
 onClick={() => flyTo(event.originZone.center, 8)}
 className="w-full rounded-md border-[var(--surface-border)] bg-[var(--surface-1)] p-2 text-left transition-colors hover:bg-[var(--hover-surface)]"
 >
 <div className="font-mono text-[10px] text-[var(--text-secondary)]">
 Zone radius <span className="text-[var(--text-heading)]">{event.originZone.radiusKm} km</span> @{' '}
 {event.originZone.center[1].toFixed(2)}°N {event.originZone.center[0].toFixed(2)}°E
 </div>
 <div className="mt-0.5 text-[8px] text-[var(--text-muted)]">Click to fly to possible origin</div>
 </button>
 </div>

 <div className="mt-2 pt-2">
<button
  onClick={() => setShowVessels(v => !v)}
  title={showVessels ? 'Hide vessel list' : 'Show vessel list'}
  aria-expanded={showVessels}
  className="mb-1.5 flex w-full items-center justify-between text-left transition-colors hover:bg-[var(--hover-surface)] rounded-md px-1 py-0.5"
  >
  <div className="flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[0.15em] text-[var(--text-heading)]">
   <Ship className="h-3 w-3 text-[var(--sev-cyan)]" /> VESSELS OF INTEREST
  </div>
  <div className="flex items-center gap-1.5">
  <span className="rounded bg-[rgba(var(--sev-cyan-rgb),0.15)] px-1.5 py-0.5 font-mono text-[9px] font-bold text-[var(--sev-cyan)]">{event.vessels.length}</span>
  {showVessels ? <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
  </div>
  </button>
  {showVessels && (
  <div className="flex flex-col gap-1.5">
   {event.vessels.length === 0 && (
   <div className="rounded-md border-[var(--surface-border)] p-2 text-[9px] text-[var(--text-muted)]">
    No vessels flagged for investigation.
   </div>
   )}
{event.vessels.map((v: SpillVessel) => (
    <VesselRow key={v.id} v={v} onClick={() => flyTo([v.position[0], v.position[1]], 9)} />
    ))}
   </div>
   )}
   </div>

  <div className="mt-2 pt-2">
  <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[9px] font-bold tracking-[0.15em] text-[var(--text-heading)]">
   <LocateFixed className="h-3 w-3 text-[var(--sev-gold)]" /> PREDICTED DRIFT
  </div>
  {event.forecastHours.length > 0 ? (
  <>
  <div className="flex items-center gap-1">
   {event.forecastHours.map((h, i) => (
   <button
   key={h}
   onClick={() => onSelectForecast?.(h)}
   aria-pressed={forecastHour === h}
   title={`Highlight the T+${h} predicted position on the map`}
   className={`relative flex-1 rounded-md py-1.5 font-mono text-[9px] font-bold tracking-wider transition-colors ${
   forecastHour === h
   ? 'bg-[rgba(var(--sev-gold-rgb),0.16)] text-[var(--gold-primary)]'
   : 'bg-[var(--surface-1)] text-[var(--text-muted)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-secondary)]'
   }`}
   >
   T+{h}H
   </button>
   ))}
  </div>
  <button
  onClick={() => event.forecastPositions[event.forecastHours.length - 1] && flyTo(event.forecastPositions[event.forecastHours.length - 1], 8)}
  className="mt-1.5 w-full rounded-md border-[var(--surface-border)] bg-[var(--surface-1)] p-2 text-left transition-colors hover:bg-[var(--hover-surface)]"
  >
  <div className="font-mono text-[9px] text-[var(--text-secondary)]">
  Horizon rings: <span className="text-[var(--gold-primary)]">{event.forecastHours.map(h => `T+${h}h`).join(' · ')}</span>
  </div>
  <div className="mt-0.5 text-[8px] text-[var(--text-muted)]">Tap a horizon to highlight it on the map — click to fly to the 24h position</div>
  </button>
  </>
  ) : (
  <div className="rounded-md border-[var(--surface-border)] p-2 text-[9px] text-[var(--text-muted)]">
  No forecast available for this event.
  </div>
  )}
  </div>

  <div className="mt-2 pt-2">
  <div className="mb-1.5 font-mono text-[9px] font-bold tracking-[0.15em] text-[var(--text-heading)]">REPORTS & EXPORT</div>
 <div className="flex gap-1.5">
 <button
 onClick={() => download(`${event.id}-report.csv`, reportToCSV(analysisReportFromEvent(event)), 'text/csv')}
 className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--surface-1)] px-2 font-mono text-[8px] font-bold tracking-wider text-[var(--gold-primary)] transition-colors hover:bg-[var(--hover-surface)]"
 >
 <Download className="h-3 w-3" /> CSV REPORT
 </button>
 <button
 onClick={() => download(`${event.id}.geojson`, JSON.stringify(eventToGeoJSON(event), null, 2), 'application/geo+json')}
 className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md bg-[var(--surface-1)] px-2 font-mono text-[8px] font-bold tracking-wider text-[var(--sev-cyan)] transition-colors hover:bg-[var(--hover-surface)]"
 >
<FileJson className="h-3 w-3" /> GEOJSON
  </button>
  </div>
   </div>
  </div>

 </>)}
 <div className="shrink-0 px-2.5 py-1 text-center font-mono text-[7px] tracking-[0.15em] text-[var(--text-muted)]">
 DETECT → CHARACTERIZE → TRACE → INVESTIGATE → PREDICT
 </div>
 </div>
 );
}
