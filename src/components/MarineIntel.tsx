'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Waves, Wind, Droplets, Thermometer, Crosshair, ChevronUp, ChevronDown, MapPin, History, Download, FileJson, Flame } from 'lucide-react';
import { oceanMetricsAt, OCEAN_REGIONS, ALL_OCEAN_REGIONS, type OceanMetrics, type OceanRegion } from '@/lib/ocean-metrics';
import {
 spillsForRegion,
 spillDayTime,
 historicSpillsCSV,
 historicSpillsJSON,
 SEVERITY_COLOR,
 SEVERITY_COLOR_RGB,
} from '@/lib/historic-spills';

/**
 * MSIS — Live Marine Intelligence.
 *
 * The bottom-right panel of the wireframe layout: ocean-state telemetry
 * "according to data from the satellites" for the monitored AOI. Values come
 * from the deterministic mock provider in `ocean-metrics` so the panel reads
 * live without a backend; a real feed (GHRSST SST, ERA5 wind, OSCAR currents)
 * drops into `oceanMetricsAt` without touching this UI.
 *
 * The feature bar on its bottom is the ocean selector: quick preset basins, a
 * custom pick on the map, and the current AOI centre readout. Above it sits
 * the HISTORIC AIS list — expand it to see every monitored ocean; picking one
 * flags the map there and re-places the AOI box over that water, both here
 * ("according to the satellites") and in the Sentinel coverage engine.
 */

export interface MarineIntelProps {
 /** AOI centre the telemetry is sampled at. */
 center: { lat: number; lng: number } | null;
 /** AOI label — preset name or CUSTOM AOI. */
 regionLabel: string;
 /** Whether "pick AOI on map" mode is armed in the app. */
 picking: boolean;
 /** Fired when a preset basin is chosen. */
 onSelectPreset: (region: OceanRegion) => void;
 /** Arms the map-click picker. */
 onPickAoi: () => void;
 /** Holds the panel open (`false`) or folds it to a slim header bar (`true`). */
 collapsed?: boolean;
 onToggle?: () => void;
}

function Metric({ icon: Icon, label, value, unit, color }: {
 icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
 label: string;
 value: React.ReactNode;
 unit?: string;
 color?: string;
}) {
 return (
 <div className="min-w-0 rounded-md border-[var(--surface-border)] bg-[var(--surface-1)] px-2 py-1.5">
 <div className="mb-0.5 flex items-center gap-1 text-[7px] font-mono tracking-[0.12em] text-[var(--text-muted)]">
 <Icon className="h-2.5 w-2.5" style={{ color: color || 'var(--cyan-primary)' }} />
 {label}
 </div>
 <div className="truncate font-mono text-[12px] font-semibold leading-tight" style={{ color: color || 'var(--text-primary)' }}>
 {value}
 {unit && <span className="ml-0.5 text-[8px] font-normal text-[var(--text-muted)]">{unit}</span>}
 </div>
 </div>
 );
}

export default function MarineIntel({
 center,
 regionLabel,
 picking,
 onSelectPreset,
 onPickAoi,
 collapsed = false,
 onToggle,
}: MarineIntelProps) {
 // Re-compute the ten-minute buckets so the panel visibly ticks over.
 const [now, setNow] = useState(() => Date.now());
 useEffect(() => {
 const iv = setInterval(() => setNow(Date.now()), 10_000);
 return () => clearInterval(iv);
 }, []);

 // HISTORIC AIS drawer: closed shows just the toggle, open reveals every
 // currently-monitored ocean. Picking one flies the map there via
 // `onSelectPreset`, which also re-places the AOI over that water.
 const [showHistAis, setShowHistAis] = useState(false);
 const [showHistSpill, setShowHistSpill] = useState(true);
 const [showMetrics, setShowMetrics] = useState(true);

 const metrics = useMemo<OceanMetrics | null>(
 () => (center ? oceanMetricsAt(center.lat, center.lng, new Date(now)) : null),
 [center, now],
 );

const seaColor = !metrics ? 'var(--text-muted)'
  : metrics.seaState === 'ROUGH' ? 'var(--sev-critical)'
  : metrics.seaState === 'MODERATE' ? 'var(--sev-warn)'
  : metrics.seaState === 'SLIGHT' ? 'var(--sev-info)'
  : 'var(--sev-ok)';

 // Historic spillage for the selected region — the downloadable gazetteer.
 const historicSpills = useMemo(() => spillsForRegion(regionLabel || ''), [regionLabel]);

 function download(filename: string, text: string, type: string) {
 const blob = new Blob([text], { type });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = filename;
 a.click();
 URL.revokeObjectURL(url);
 }

 function exportHistoric(kind: 'csv' | 'json') {
 const rows = historicSpills;
 if (rows.length === 0) return;
 const slug = (regionLabel || 'all').replace(/[^A-Z0-9]+/gi, '-').toLowerCase();
 download(
 `msis-historic-${slug}.${kind === 'csv' ? 'csv' : 'json'}`,
 kind === 'csv' ? historicSpillsCSV(rows) : historicSpillsJSON(rows),
 kind === 'csv' ? 'text/csv' : 'application/json',
 );
 }

 const header = (
 <div className="flex items-start gap-2 px-2.5 pt-2.5">
 <Waves className="mt-[2px] h-3.5 w-3.5 flex-shrink-0" style={{ color: 'var(--cyan-primary)' }} />
 <div className="min-w-0 flex-1">
 <div className="truncate text-[12px] font-bold leading-tight tracking-wide text-[var(--text-heading)]">
 LIVE MARINE INTELLIGENCE
 </div>
 <div className="truncate font-mono text-[9px] tracking-[0.12em] text-[var(--text-secondary)]">
 {regionLabel || 'NO REGION'} · SATELLITE-DERIVED
 </div>
 </div>
 {onToggle && (
 <button
 onClick={onToggle}
 title={collapsed ? 'Expand marine data' : 'Fold marine data'}
 aria-label={collapsed ? 'Expand marine data' : 'Fold marine data'}
 className="-mr-1 -mt-1 flex-shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-surface)] hover:text-[var(--text-heading)] focus:outline-none"
 >
 {collapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
 </button>
 )}
 </div>
 );

 if (collapsed) {
 return (
 <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg bg-[var(--panel-glass)] shadow-[0_6px_20px_rgba(0,0,0,0.45)] backdrop-blur-lg">
 <div className="h-px w-full" style={{ background: 'rgba(0,229,255,0.8)' }} />
 <div className="pb-2">{header}</div>
 </div>
 );
 }

 return (
 <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg bg-[var(--panel-glass)] shadow-[0_6px_20px_rgba(0,0,0,0.45)] backdrop-blur-lg">
 <div className="h-px w-full" style={{ background: 'rgba(0,229,255,0.8)' }} />
 {header}

 {/* ── Scrollable telemetry body ── */}
 <div className="styled-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 py-2">
 {/* HISTORIC AIS ocean gazetteer — expand to name every monitored sea. */}
 <div className="mb-2">
 <button
 onClick={() => setShowHistAis((v) => !v)}
 title="Historic AIS — all monitored oceans"
className="flex w-full items-center gap-1.5 rounded-md bg-[var(--surface-1)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--hover-surface)]"
  >
  <History className="h-3 w-3 flex-shrink-0" style={{ color: 'var(--gold-primary)' }} />
 <span className="flex-1 truncate text-[9px] font-mono font-bold tracking-[0.15em] text-[var(--text-heading)]">
 HISTORIC AIS
 </span>
<span className="font-mono text-[8px] text-[var(--text-muted)]">{ALL_OCEAN_REGIONS.length} OCEANS</span>
  {showHistAis ? <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
 </button>
 {showHistAis && (
 <div className="styled-scrollbar mt-1 grid max-h-32 grid-cols-2 gap-1 overflow-y-auto pr-0.5">
 {ALL_OCEAN_REGIONS.map((r) => {
 const active = regionLabel === r.label;
 const count = spillsForRegion(r.label).length;
 return (
 <button
 key={r.id}
 onClick={() => onSelectPreset(r)}
 title={`${r.label} — ${r.sub}`}
 className={`rounded-md px-1.5 py-1 text-left transition-colors ${
 active
? 'bg-[var(--gold-primary)]/15'
  : ' bg-[var(--surface-1)] hover:bg-[var(--hover-surface)]'
 }`}
 >
 <div className={`flex items-center gap-1 truncate font-mono text-[8px] font-bold tracking-wider ${active ? 'text-[var(--gold-primary)]' : 'text-[var(--text-primary)]'}`}>
 {active && <MapPin className="h-2.5 w-2.5 flex-shrink-0" />}
 {r.label}
 </div>
 <div className="flex items-center justify-between gap-1">
 <span className="truncate font-mono text-[7px] text-[var(--text-muted)]">{r.sub}</span>
 {count > 0 && (
 <span style={{ color: active ? 'var(--gold-primary)' : 'var(--cyan-primary)' }} className="font-mono text-[7px]">
 {count} {count === 1 ? 'EVENT' : 'EVENTS'}
 </span>
 )}
 </div>
 </button>
 );
 })}
 </div>
 )}
 </div>

 {/* HISTORIC SPILLAGE — dated incidents for the selected region + export */}
 <div className="mb-2">
 <button
 onClick={() => setShowHistSpill(v => !v)}
className="flex w-full items-center gap-1.5 rounded-md bg-[var(--surface-1)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--hover-surface)]"
  >
  <Flame className="h-3 w-3 flex-shrink-0" style={{ color: 'var(--sev-flame)' }} />
 <div className="min-w-0 flex-1">
 <div className="truncate text-[9px] font-mono font-bold tracking-[0.15em] text-[var(--text-heading)]">
 HISTORIC SPILLAGE
 </div>
 <div className="truncate font-mono text-[7px] text-[var(--text-muted)]">
 {regionLabel || 'NO REGION'} · {historicSpills.length} RECORDS
 </div>
 </div>
 <button
 onClick={(e) => { e.stopPropagation(); exportHistoric('csv'); }}
 disabled={historicSpills.length === 0}
 title="Download CSV"
 aria-label="Download historic spills as CSV"
 className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-surface)] hover:text-[var(--gold-primary)] disabled:opacity-30"
 >
 <Download className="h-3 w-3" />
 </button>
 <button
 onClick={(e) => { e.stopPropagation(); exportHistoric('json'); }}
 disabled={historicSpills.length === 0}
 title="Download JSON"
 aria-label="Download historic spills as JSON"
 className="rounded p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-surface)] hover:text-[var(--gold-primary)] disabled:opacity-30"
 >
 <FileJson className="h-3 w-3" />
 </button>
 {showHistSpill ? <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
 </button>
 {showHistSpill && historicSpills.length > 0 ? (
  <div className="styled-scrollbar mt-1 flex max-h-28 flex-col gap-1 overflow-y-auto pr-0.5">
   {historicSpills.map((s) => (
    <div
     key={s.id}
     className="flex items-center gap-1.5 rounded-md border-[var(--surface-border)] bg-[var(--surface-1)] px-1.5 py-1"
     title={`${s.cause} · ${s.source}`}
    >
     <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[s.severity], boxShadow: `0 0 6px rgba(${SEVERITY_COLOR_RGB[s.severity]}, 0.53)` }} />
     <div className="min-w-0 flex-1">
      <div className="truncate font-mono text-[8px] font-bold tracking-wide text-[var(--text-primary)]">{s.name}</div>
      <div className="truncate font-mono text-[7px] text-[var(--text-muted)]">
       {spillDayTime(s.datetime)} · {s.volumeTonnes.toLocaleString()} t · {s.areaKm2.toFixed(1)} km²
      </div>
     </div>
    </div>
   ))}
  </div>
 ) : (
  <div className="mt-1 rounded-md border-[var(--surface-border)] bg-[var(--surface-1)] px-2 py-1.5 text-[8px] font-mono text-[var(--text-muted)]">
   {regionLabel ? `No historic events on file for ${regionLabel}.` : 'Select an ocean to view its spill history.'}
  </div>
 )}
 </div>

 {metrics ? (
 <>
 <button
 onClick={() => setShowMetrics(v => !v)}
 className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-[var(--hover-surface)]"
 style={{ background: `${seaColor}0d` }}
 >
 <div>
 <div className="text-[7px] font-mono tracking-[0.12em] text-[var(--text-muted)]">SEA STATE</div>
 <div className="font-mono text-[13px] font-bold tracking-wider" style={{ color: seaColor }}>{metrics.seaState}</div>
 </div>
 <div className="flex items-center gap-2">
 <span className="font-mono text-[8px] text-[var(--text-muted)]">
 {center ? `${center.lat.toFixed(2)}° ${center.lng.toFixed(2)}°` : '—'}
 </span>
 {showMetrics ? <ChevronUp className="h-3.5 w-3.5 text-[var(--text-muted)]" /> : <ChevronDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />}
 </div>
 </button>
 {showMetrics && (
 <div className="grid grid-cols-2 gap-x-2.5 gap-y-2">
 <Metric icon={Thermometer} label="SST" value={metrics.sstC} unit="°C" color="var(--gold-primary)" />
 <Metric icon={Wind} label="WIND" value={`${metrics.windDir} · ${metrics.windKts}`} unit="kn" color="var(--cyan-primary)" />
 <Metric icon={Waves} label="WAVE" value={metrics.waveM} unit="m" />
 <Metric icon={Droplets} label="SALINITY" value={metrics.salinityPpt} unit="PSU" />
 <Metric icon={Crosshair} label="CURRENT" value={`${metrics.currentDir} · ${metrics.currentKts}`} unit="kn" />
 </div>
 )}
 <div className="mt-2 flex items-center justify-between rounded-md bg-[var(--surface-1)] px-2 py-1">
 <span className="font-mono text-[7px] tracking-[0.15em] text-[var(--text-muted)]">SYNC</span>
 <span className="font-mono text-[8px] text-[var(--alert-green)]">● {regionLabel || 'REGION'} READING LIVE</span>
 </div>
 </>
 ) : (
 <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
 <Waves className="h-5 w-5 text-[var(--text-muted)]" />
 <div className="text-[9px] font-mono tracking-widest text-[var(--text-muted)]">WAITING FOR A REGION</div>
 <div className="text-[8px] font-mono text-[var(--text-secondary)]">Open HISTORIC AIS, pick a basin below, or drop a custom AOI on the map.</div>
 </div>
 )}
 </div>

 {/* ── Ocean selector feature bar ── */}
 <div className=" bg-[var(--surface-1)] px-2.5 py-2">
 <div className="flex items-center gap-1.5 overflow-x-auto styled-scrollbar">
 {OCEAN_REGIONS.map((r) => {
 const active = regionLabel === r.label;
 return (
 <button
 key={r.id}
 onClick={() => onSelectPreset(r)}
 title={`${r.label} — ${r.sub}`}
 className={`flex-shrink-0 rounded-md px-2 py-1 font-mono text-[8px] font-bold tracking-wider transition-colors ${
 active
 ? 'border-[var(--cyan-primary)]/50 bg-[var(--cyan-primary)]/15 text-[var(--cyan-primary)]'
 : ' text-[var(--text-secondary)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-primary)]'
 }`}
 >
 {r.label}
 </button>
 );
 })}
 <button
 onClick={onPickAoi}
 title="Click a point on the map to set a custom AOI"
 className={`flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 font-mono text-[8px] font-bold tracking-wider transition-colors ${
 picking
 ? 'animate-pulse bg-[var(--gold-primary)]/20 text-[var(--gold-primary)]'
 : 'bg-[var(--gold-primary)]/10 text-[var(--gold-primary)] hover:bg-[var(--gold-primary)]/20'
 }`}
 >
 {picking ? 'CLICK MAP…' : <>PICK AOI</>}
 </button>
 </div>
 </div>
 </div>
 );
}