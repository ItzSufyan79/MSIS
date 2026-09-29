'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Satellite, Search, Radar, Crosshair, MapPin, ChevronUp, ChevronDown } from 'lucide-react';
import {
 type SatelliteRow,
 type MonitorSnapshot,
 type AoiBox,
 aoiCenter,
 sentinelSatellites,
 sentinelSarSatellites,
} from '@/lib/satellite-monitor';

/**
 * MSIS — Live Satellite Feed (Sentinel family only).
 *
 * "Which Sentinel can see the AOI, and when?" — the mission observes slicks
 * with C-band SAR, so the catalogue is filtered to Sentinel platforms
 * (SENTINEL-1 A/B/C first). Pick any Sentinel and this panel tracks its live
 * position, draws its sensing footprint and upcoming ground track on the
 * globe, and reports every pass across the monitored region box in the next
 * 24 hours. The region box is the default spill region unless the operator
 * hands one in from the ocean selector / historic AIS list.
 */

export interface SatelliteMonitorProps {
 satellites: SatelliteRow[];
 flyTo: (coords: [number, number], zoom: number) => void;
 /** Fired with each fresh snapshot so the map can draw footprint + track. */
 onSnapshot: (snapshot: MonitorSnapshot | null) => void;
 /** Custom AOI box to monitor; `null` falls back to the default spill region. */
 aoi?: AoiBox | null;
 /** Holds the panel open (`false`) or folds it to a slim header bar (`true`). */
 collapsed?: boolean;
 onToggle?: () => void;
}

const EARTH_RADIUS_KM = 6371;

function colorSafe(value: string | undefined): string {
  return /^#[0-9a-fA-F]{3,8}$/.test(String(value ?? '')) ? String(value) : 'var(--sev-cyan)';
}

function regime(altKm: number): string {
 if (altKm < 2000) return 'LEO';
 if (altKm < 35000) return 'MEO';
 if (altKm <= 36500) return 'GEO';
 return 'HEO';
}

function speedKmS(altKm: number, periodMinutes: number): number {
 return (2 * Math.PI * (EARTH_RADIUS_KM + altKm)) / (periodMinutes * 60);
}

function period(minutes: number | null): string {
 if (!minutes || !Number.isFinite(minutes)) return '—';
 if (minutes < 100) return `${minutes.toFixed(1)} min`;
 const h = Math.floor(minutes / 60);
 const m = Math.round(minutes - h * 60);
 return `${h}h ${String(m).padStart(2, '0')}m`;
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

/** "1h 12m" or "3m 05s" — compact countdown that can dip under a minute. */
function durationLabel(ms: number): string {
 const s = Math.max(0, Math.floor(ms / 1000));
 if (s >= 3600) {
 const h = Math.floor(s / 3600);
 const m = Math.floor((s % 3600) / 60);
 return `${h}h ${String(m).padStart(2, '0')}m`;
 }
 return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

function timeLabel(epochMs: number): string {
 return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function SatelliteMonitor({ satellites, flyTo, onSnapshot, aoi = null, collapsed = false, onToggle }: SatelliteMonitorProps) {
 const [query, setQuery] = useState('');
 const [selected, setSelected] = useState<SatelliteRow | null>(null);
 const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [now, setNow] = useState(() => Date.now());
 const [focused, setFocused] = useState(false);

 // Ticking clock so pass countdowns move without needing a refetch.
 useEffect(() => {
 const iv = setInterval(() => setNow(Date.now()), 1000);
 return () => clearInterval(iv);
 }, []);

 // On open, pre-pick the lead Sentinel SAR platform (SENTINEL-1* first),
 // so the panel opens onto a *useful* satellite rather than an empty form.
 // Runs once the catalogue has actually arrived — data may load after mount.
 const highlights = useMemo(() => {
 const rows = satellites || [];
 const sar = sentinelSarSatellites(rows);
 return sar.length > 0 ? sar : sentinelSatellites(rows);
 }, [satellites]);
 const autoPickedRef = useRef(false);
 useEffect(() => {
 if (autoPickedRef.current) return;
 if (!selected && highlights.length > 0) {
 setSelected(highlights[0]);
 autoPickedRef.current = true;
 }
 }, [highlights, selected]);

 // Default matched set when nothing is typed — the whole Sentinel family.
 const matches = useMemo(() => {
 const rows = sentinelSatellites(satellites || []);
 const q = query.trim().toLowerCase();
 if (!q) return rows;
 return rows
 .filter((r) => r.name.toLowerCase().includes(q) || (r.noradId || '').includes(q))
 .slice(0, 40);
 }, [satellites, query]);

 // Poll the monitor endpoint while a satellite is selected. The AOI box rides
 // along so coverage is measured against whatever region the operator picked.
 const load = useCallback(
 async (sat: SatelliteRow, box: AoiBox | null) => {
 setLoading(true);
 setError(null);
 try {
 const qs = new URLSearchParams();
 if (sat.noradId) qs.set('id', sat.noradId);
 else qs.set('name', sat.name);
 if (box) {
 qs.set('w', String(box.west));
 qs.set('e', String(box.east));
 qs.set('s', String(box.south));
 qs.set('n', String(box.north));
 }
 const res = await fetch(`/api/satellites/monitor?${qs.toString()}`);
 if (!res.ok) {
 const body = await res.json().catch(() => ({}));
 setError(body?.error || `Monitor error (${res.status})`);
 setSnapshot(null);
 return;
 }
 const body = await res.json();
 const snap: MonitorSnapshot = body.monitor;
 setSnapshot(snap);
 onSnapshot(snap);
 } catch {
 setError('Live monitor unreachable');
 } finally {
 setLoading(false);
 }
 },
 [onSnapshot],
 );

 useEffect(() => {
 if (!selected) {
 setSnapshot(null);
 onSnapshot(null);
 return;
 }
 load(selected, aoi);
 const iv = setInterval(() => load(selected, aoi), 15_000);
 return () => clearInterval(iv);
 }, [selected, aoi, load, onSnapshot]);

 useEffect(() => () => onSnapshot(null), [onSnapshot]);

 const accent = snapshot?.position ? colorSafe(selected?.color) : 'var(--sev-cyan)';
 const nextPass = snapshot?.passes?.[0] ?? null;
 const covering = snapshot?.covering ?? false;
 const isCustomAoi = snapshot?.aoi?.label === 'CUSTOM AOI';

 const aoiLngLat: [number, number] | null = useMemo(() => {
 const box = snapshot?.aoi ?? aoi;
 if (!box) return null;
 const c = aoiCenter(box);
 return [c.lng, c.lat];
 }, [snapshot?.aoi, aoi]);

 const header = (
 <div className="flex items-start gap-2 px-2.5 pt-2.5">
 <Satellite className="mt-[2px] h-3.5 w-3.5 flex-shrink-0" style={{ color: accent }} />
 <div className="min-w-0 flex-1">
 <div className="truncate text-[12px] font-bold leading-tight tracking-wide text-[var(--text-heading)]">
 LIVE SATELLITE FEED
 </div>
 <div className="truncate font-mono text-[9px] tracking-[0.12em] text-[var(--text-secondary)]">
 {snapshot?.satellite?.name || 'SELECT A SENTINEL PLATFORM'}
 </div>
 </div>
 {loading && <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full" style={{ background: accent, marginTop: 6 }} />}
 {onToggle && (
 <button
 onClick={onToggle}
 title={collapsed ? 'Expand feed' : 'Fold feed'}
 aria-label={collapsed ? 'Expand feed' : 'Fold feed'}
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
 <div className="h-px w-full" style={{ background: `${accent}99` }} />
 <div className="pb-2">{header}</div>
 </div>
 );
 }

 return (
 <div
 className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg bg-[var(--panel-glass)] shadow-[0_6px_20px_rgba(0,0,0,0.45)] backdrop-blur-lg"
 role="dialog"
 aria-label="Satellite coverage monitor"
 >
 <div className="h-px w-full" style={{ background: `${accent}99` }} />
 {header}

 {/* ── Scrollable body ── */}
 <div className="styled-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
 {/* Coverage status */}
 {snapshot && (
 <div className="px-2.5 pt-2">
 <div
 className="flex items-center justify-between rounded-md px-2 py-1.5"
style={{
  borderColor: covering ? 'rgba(var(--sev-ok-rgb), 0.33)' : 'rgba(var(--sev-gold-rgb), 0.33)',
  background: covering ? 'rgba(var(--sev-ok-rgb), 0.07)' : 'rgba(var(--sev-gold-rgb), 0.06)',
  }}
 >
 <div className="flex items-center gap-1.5">
<Radar className="h-3 w-3" style={{ color: covering ? 'var(--sev-ok)' : 'var(--sev-gold)' }} />
  <span
  className="text-[9px] font-mono font-bold tracking-wider"
  style={{ color: covering ? 'var(--sev-ok)' : 'var(--sev-gold)' }}
  >
 {covering ? (isCustomAoi ? 'COVERING CUSTOM AOI' : 'COVERING SPILL REGION') : nextPass ? 'COVERAGE IN' : 'NO COVERAGE IN 24H'}
 </span>
 </div>
 {!covering && nextPass && (
  <span className={`font-mono text-[12px] font-bold tabular-nums ${nextPass.start - now < 300000 ? 'animate-pulse' : ''}`} style={{ color: 'var(--sev-gold)' }}>
   {durationLabel(nextPass.start - now)}
  </span>
 )}
 </div>
 </div>
 )}

 {error && (
 <div className="px-2.5 pt-1.5 text-[9px] font-mono text-[var(--sev-critical)]">
 {error} — hit /api/satellites once, then reload.
 </div>
 )}

 {/* Position readout */}
 {snapshot?.position && (
 <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 px-2.5 py-2.5">
 <Field label="ALTITUDE" value={`${snapshot.position.altKm.toLocaleString()} km`} color="var(--cyan-primary)" />
 <Field label="ORBIT" value={regime(snapshot.position.altKm)} color={accent} />
 <Field label="PERIOD" value={period(snapshot.periodMinutes)} />
 <Field label="SPEED" value={snapshot.periodMinutes ? `${speedKmS(snapshot.position.altKm, snapshot.periodMinutes).toFixed(2)} km/s` : '—'} />
 <Field label="LATITUDE" value={`${snapshot.position.lat.toFixed(3)}°`} />
 <Field label="LONGITUDE" value={`${snapshot.position.lng.toFixed(3)}°`} />
 <Field label="FOOTPRINT" value={`${snapshot.footprintRadiusKm.toLocaleString()} km`} color="var(--gold-primary)" />
<Field label="REGION COV." value={covering ? 'YES' : 'NO'} color={covering ? 'var(--sev-ok)' : 'var(--sev-critical)'} />
  <Field label="SUB-POINT IN AOI" value={snapshot.overAOI ? 'YES' : 'NO'} color={snapshot.overAOI ? 'var(--sev-ok)' : 'var(--text-muted)'} />
 </div>
 )}

 {/* Upcoming passes */}
 {snapshot && snapshot.passes.length > 0 && (
 <div className="mx-2.5 pt-2">
 <div className="mb-1.5 text-[9px] font-bold tracking-wider text-[var(--text-muted)]">
 NEXT COVERAGE WINDOWS
 </div>
 <div className="flex flex-col gap-1 pb-1">
 {snapshot.passes.slice(0, 4).map((p, i) => (
 <div
 key={`${p.peakTime}-${i}`}
 className="flex items-center justify-between rounded-md border-[var(--surface-border)] bg-[var(--surface-1)] px-2 py-1"
 >
 <div>
 <div className="font-mono text-[10px] tabular-nums text-[var(--text-heading)]">
 {timeLabel(p.start)}
 {p.end - p.start > 60_000 && <span className="text-[var(--text-muted)]"> – {timeLabel(p.end)}</span>}
 </div>
 <div className="font-mono text-[8px] text-[var(--text-muted)]">
 {p.durationMin.toFixed(1)} min · {Math.round(p.peakAltKm).toLocaleString()} km · {p.closestKm} km to centre
 </div>
 </div>
 {i === 0 && !covering && (
 <span className="font-mono text-[9px] text-[var(--gold-primary)]">{durationLabel(p.start - now)}</span>
 )}
 </div>
 ))}
 </div>
 </div>
 )}

 {snapshot && snapshot.passes.length === 0 && (
 <div className="px-2.5 pb-2 pt-1 text-[9px] font-mono text-[var(--text-muted)]">
 No sub-footprint pass crosses this region in the next 24h.
 </div>
 )}

 {/* Actions */}
 {snapshot?.position && (
 <div className="flex items-center gap-1.5 px-2.5 py-2.5">
 <button
 onClick={() => flyTo([snapshot.position!.lng, snapshot.position!.lat], snapshot.position!.altKm > 1000 ? 4 : 6)}
 className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[var(--border-active)] bg-[var(--surface-2)] px-2 py-1.5 text-[9px] font-mono font-bold tracking-wider text-[var(--cyan-primary)] transition-colors hover:bg-[var(--hover-surface)]"
 >
 <MapPin className="h-3 w-3" /> FLY TO SAT
 </button>
 <button
 onClick={() => aoiLngLat && flyTo(aoiLngLat, 7)}
 className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[var(--surface-border)] bg-[var(--surface-1)] px-2 py-1.5 text-[9px] font-mono font-bold tracking-wider text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-surface)] hover:text-[var(--text-heading)]"
 >
 <Crosshair className="h-3 w-3" /> FLY TO AOI
 </button>
 </div>
 )}

 <div className="px-2.5 pb-2 text-center font-mono text-[7px] tracking-[0.15em] text-[var(--text-muted)]">
 SENTINEL-1 C-BAND SAR · SGP4 · 24H PASS WINDOW
 </div>
 </div>

 {/* ── Satellite selector feature bar (pinned) ── */}
<div className=" bg-[var(--surface-1)] px-2.5 py-2">
  <div className="flex items-center gap-1.5 rounded-md bg-[var(--surface-2)] px-2 py-1.5">
 <Search className="h-3 w-3 flex-shrink-0 text-[var(--text-muted)]" />
 <input
 value={query}
 onChange={(e) => { setQuery(e.target.value); setFocused(true); }}
 onFocus={() => setFocused(true)}
 onBlur={() => { setTimeout(() => setFocused(false), 150); }}
 onKeyDown={(e) => {
 if (e.key === 'Enter' && matches[0]) {
 e.preventDefault();
 setSelected(matches[0]);
 setQuery('');
 setFocused(false);
 }
 }}
 placeholder="Search Sentinel (name / NORAD)…"
 className="w-full bg-transparent text-[10px] font-mono text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
 aria-label="Search satellites"
 />
 {selected && !focused && (
 <span className="flex-shrink-0 font-mono text-[8px] text-[var(--text-secondary)]">
 <span className="inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: accent }} /> TRACKING
 </span>
 )}
 </div>
 {/* In-flow result list — sits directly under the box so it can never be
 clipped by the panel, unlike an absolutely-positioned popup. */}
 {focused && (
 <div className="styled-scrollbar mt-1 max-h-40 overflow-y-auto rounded-md bg-[var(--bg-panel)] shadow-lg">
 {matches.map((r) => (
 <button
 key={r.noradId || r.name}
 onMouseDown={(e) => {
 e.preventDefault();
 setSelected(r);
 setQuery('');
 setFocused(false);
 }}
 className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-[var(--hover-surface)]"
 >
 <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: colorSafe(r.color) }} />
 <span className="min-w-0 flex-1 truncate text-[10px] font-mono text-[var(--text-primary)]">{r.name}</span>
 <span className="font-mono text-[8px] text-[var(--text-muted)]">{r.noradId || ''}</span>
 </button>
 ))}
 {matches.length === 0 && (
 <div className="px-2 py-2 text-[9px] text-[var(--text-muted)]">No Sentinel matches “{query}”</div>
 )}
 {matches.length === 1 && (
 <div className=" px-2 py-1 text-[8px] font-mono text-[var(--gold-primary)]">
 ENTER TO TRACK · OR CLICK ROW
 </div>
 )}
 </div>
 )}
 </div>
 </div>
 );
}