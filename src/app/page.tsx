'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Globe, MapPinned, Moon, Sun, Satellite, Layers, X, Droplet } from 'lucide-react';
import ScaleBar from '@/components/ScaleBar';
import ErrorBoundary from '@/components/ErrorBoundary';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import SpillPanel from '@/components/SpillPanel';
import UploadAnalyze from '@/components/UploadAnalyze';
import { marineSpillEvents, type SpillEvent } from '@/lib/marine-spill';
import { eventFromUpload, type UploadedImage, type UploadResult } from '@/lib/spill-upload';
import SatelliteMonitor from '@/components/SatelliteMonitor';
import MarineIntel from '@/components/MarineIntel';
import type { MonitorSnapshot, AoiBox } from '@/lib/satellite-monitor';
import { MONITOR_AOI } from '@/lib/satellite-monitor';
import { aoiBoxFromCenter, oceanMetricsAt, type OceanRegion } from '@/lib/ocean-metrics';
import { useResizable } from '@/lib/useResizable';

const MsisMap = dynamic(() => import('@/components/MsisMap'), { ssr: false });
const LayerPanel = dynamic(() => import('@/components/LayerPanel'));

function useIsMobile() {
 const [isMobile, setIsMobile] = useState(false);
 useEffect(() => {
 const check = () => {
 const w = window.innerWidth;
 const h = window.innerHeight;
 setIsMobile(w < 768 || (h < 500 && w < 1024));
 };
 check();
 window.addEventListener('resize', check);
 window.addEventListener('orientationchange', check);
 return () => {
 window.removeEventListener('resize', check);
 window.removeEventListener('orientationchange', check);
 };
 }, []);
 return isMobile;
}

const ZuluClock = () => {
 const [time, setTime] = useState('');
 const [blink, setBlink] = useState(true);
 useEffect(() => {
  const iv = setInterval(() => {
   const now = new Date();
   const s = now.getUTCSeconds();
   setBlink(s % 2 === 0);
   setTime(`ZULU ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}Z`);
  }, 1000);
  return () => clearInterval(iv);
 }, []);
 const colon = blink ? ':' : ' ';
 return <span className="text-[var(--cyan-primary)] font-bold tabular-nums">{time ? time.replace(/:/g, colon) : 'ZULU --(--)--(--)--Z'}</span>;
};

const ActiveEntityCount = ({ data }: { data: Record<string, unknown[]> }) => {
 const count = useMemo(() => {
 if (!data) return 0;
 return Object.values(data).reduce((sum, v) => sum + (Array.isArray(v) ? v.length : 0), 0);
 }, [data]);
 return <span className="text-[var(--alert-green)] font-bold tabular-nums">{count.toLocaleString()}</span>;
};

function ViewSegment({ active, onClick, title, icon: Icon, label, layoutId }: {
 active: boolean;
 onClick: () => void;
 title: string;
 icon: React.ComponentType<{ className?: string }>;
 label: string;
 layoutId: string;
}) {
 return (
 <button
 onClick={onClick}
 title={title}
 aria-pressed={active}
 className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-mono font-medium tracking-[0.18em] transition-colors duration-200 ${
 active ? 'text-[var(--gold-light)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
 }`}
 >
 {active && (
 <motion.span
 layoutId={layoutId}
 transition={{ type: 'spring', stiffness: 420, damping: 34 }}
 className="absolute inset-0 rounded-md bg-[var(--gold-primary)]/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_14px_var(--gold-glow)]"
 />
 )}
 <Icon className="w-3.5 h-3.5 relative z-10" />
 <span className="hidden md:inline relative z-10">{label}</span>
 </button>
 );
}

export default function Dashboard() {
 const dataRef = useRef<any>({});
 const [dataVersion, setDataVersion] = useState(0);
 const data = dataRef.current;

 const [backendStatus, setBackendStatus] = useState<'connecting' | 'connected' | 'error'>('connecting');
 const [failedEndpoints, setFailedEndpoints] = useState<string[]>([]);
 const [mapView, setMapView] = useState({ zoom: 2.5, latitude: 20 });
 const [mapStyle, setMapStyle] = useState<'dark' | 'satellite'>('dark');
 const [mapProjection, setMapProjection] = useState<'globe' | 'mercator'>('globe');
 const [flyToLocation, setFlyToLocation] = useState<{ lat: number; lng: number; zoom?: number; ts: number } | null>(null);
 const [theme, setTheme] = useState<'dark' | 'light'>('dark');

 // Apply theme class to body
 useEffect(() => {
  document.body.classList.remove('theme-light', 'theme-ghost');
  if (theme === 'light') document.body.classList.add('theme-light');
 }, [theme]);

 // Docked right column — three equal, independently foldable panels.
 const [marineClosed, setMarineClosed] = useState(false);
 const [toolMenuOpen, setToolMenuOpen] = useState(false);
 const [showUpload, setShowUpload] = useState(false);

 /** Custom AOI box the satellites + marine data monitor; `null` = default spill region. */
 const [monitorAoi, setMonitorAoi] = useState<AoiBox | null>(null);
 /** While armed, the next bare-ground map click sets the AOI. */
 const [pickAoiMode, setPickAoiMode] = useState(false);
 const [satMonitorSnap, setSatMonitorSnap] = useState<MonitorSnapshot | null>(null);

 // Resizable panel sizes
 const bottomPanel = useResizable({ initial: 232, min: 100, max: 500, invert: true });
 const rightArmWidth = useResizable({ initial: 360, min: 240, max: 600, direction: 'horizontal', invert: true });
 const [coordsOpen, setCoordsOpen] = useState(true);
 // Right arm: toggle between spill and satellite (one at a time, or neither)
 const [rightArmPanel, setRightArmPanel] = useState<'spill' | 'satellite' | null>('spill');

 const coordsDisplayRef = useRef<HTMLDivElement>(null);
 const hoverSstRef = useRef<HTMLSpanElement>(null);
 const hoverWindRef = useRef<HTMLSpanElement>(null);
 const hoverSeaRef = useRef<HTMLSpanElement>(null);

const [showSplash, setShowSplash] = useState(true);
  const [showLayers, setShowLayers] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<'layers' | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

 // MSIS layer set — satellites (detection), AIS/vessels (correlation), spill profile.
 const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>({
 maritime: true,
 oil_spill: true,
 satellites: true,
 sat_comms: true,
 sat_military: false,
 sat_navigation: false,
 sat_earth: false,
 sat_science: false,
 });

 const isMobile = useIsMobile();

 useEffect(() => {
  const t = setTimeout(() => setShowSplash(false), 3500);
  return () => clearTimeout(t);
 }, []);

 // ── KEYBOARD SHORTCUTS ──
 useEffect(() => {
  const handler = (e: KeyboardEvent) => {
   if (['INPUT', 'TEXTAREA'].includes((e.target as Element)?.tagName)) return;
   switch (e.key.toLowerCase()) {
    case 'f':
     e.preventDefault();
     if (document.fullscreenElement) document.exitFullscreen();
     else document.documentElement.requestFullscreen();
     break;
    case 'l':
     e.preventDefault();
     setShowLayers(v => !v);
     break;
    case 'r':
     e.preventDefault();
     setFlyToLocation({ lat: 20, lng: 0, zoom: 2.5, ts: Date.now() });
     break;
    case 'escape':
     if (showUpload) { setShowUpload(false); setToolMenuOpen(false); }
     else if (rightArmPanel) setRightArmPanel(null);
     else if (showLayers) setShowLayers(false);
     break;
   }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
 }, [showUpload, rightArmPanel, showLayers]);

 // ── SHARED FETCH UTILITY ──
 const fetchEndpoint = useCallback(async (
  url: string,
  transform?: (d: any) => any,
  options?: RequestInit,
  { skipWhenHidden = false }: { skipWhenHidden?: boolean } = {},
 ): Promise<boolean> => {
  if (skipWhenHidden && typeof document !== 'undefined' && document.hidden) return false;
  try {
   const res = await fetch(url, { ...options, cache: 'no-store' });
   if (res.ok) {
    const json = await res.json();
    const d = transform ? transform(json) : json;
    dataRef.current = { ...dataRef.current, ...d };
    setDataVersion(v => v + 1);
    setBackendStatus('connected');
    setFailedEndpoints(prev => prev.filter(e => e !== url));
    return true;
   }
   setFailedEndpoints(prev => prev.includes(url) ? prev : [...prev, url]);
   setBackendStatus('error');
   return false;
  } catch (e) {
   console.warn('[MSIS] Suppressed error:', e instanceof Error ? e.message : e);
   setFailedEndpoints(prev => prev.includes(url) ? prev : [...prev, url]);
   setBackendStatus('error');
   return false;
  }
 }, []);

 // Retry all failed endpoints
 const retryAll = useCallback(() => {
  setBackendStatus('connecting');
  setFailedEndpoints([]);
  layerFetchedRef.current.clear();
 }, []);

 // ── LAYER-AWARE DATA LOADING — fetch only what the active panels consume ──
 const layerFetchedRef = useRef<Set<string>>(new Set());
 useEffect(() => {
 const anySatLayer = activeLayers.satellites || activeLayers.sat_comms || activeLayers.sat_military || activeLayers.sat_navigation || activeLayers.sat_earth || activeLayers.sat_science;
 if (anySatLayer && !layerFetchedRef.current.has('satellites')) {
 // Keep the moment positions were propagated so the orbit route can draw a
 // track that passes through each marker's epoch.
 fetchEndpoint('/api/satellites', d => ({ ...d, satellites_at: d.timestamp }));
 layerFetchedRef.current.add('satellites');
 }
 if (activeLayers.maritime && !layerFetchedRef.current.has('maritime')) {
 fetchEndpoint('/api/maritime', d => ({ maritime_ports: d.ports, maritime_chokepoints: d.chokepoints, maritime_ships: d.ships }));
 layerFetchedRef.current.add('maritime');
 }
 }, [activeLayers, fetchEndpoint]);

 // AIS vessels refresh every 10s while the maritime layer is live.
 useEffect(() => {
 const iv = setInterval(() => {
 fetchEndpoint('/api/maritime', d => ({ maritime_ports: d.ports, maritime_chokepoints: d.chokepoints, maritime_ships: d.ships }), undefined, { skipWhenHidden: true });
 }, 10000);
 return () => clearInterval(iv);
 }, [fetchEndpoint]);

 // ── CURSOR TELEMETRY — badge lat/lng + SST + wind + sea, no re-render per move ──
 const handleMouseCoords = useCallback((coords: { lat: number; lng: number }) => {
 if (coordsDisplayRef.current) {
 coordsDisplayRef.current.innerText = `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`;
 }
 const m = oceanMetricsAt(coords.lat, coords.lng);
 if (hoverSstRef.current) hoverSstRef.current.innerText = `${m.sstC}°C`;
 if (hoverWindRef.current) hoverWindRef.current.innerText = `${m.windDir} ${m.windKts}kn`;
 if (hoverSeaRef.current) hoverSeaRef.current.innerText = m.seaState;
 }, []);

 // MSIS custom-AOI picker: while armed, clicking bare ground re-centres the
 // monitored box on that point and flies there.
 const handleGroundClick = useCallback((coords: { lat: number; lng: number }) => {
 if (!pickAoiMode) return;
 const box = aoiBoxFromCenter(coords.lat, coords.lng);
 setMonitorAoi(box);
 setPickAoiMode(false);
 setFlyToLocation({ lat: coords.lat, lng: coords.lng, zoom: 8, ts: Date.now() });
 }, [pickAoiMode]);

 const handleSelectOceanRegion = useCallback((region: OceanRegion) => {
 const box = { ...aoiBoxFromCenter(region.center[1], region.center[0]), label: region.label };
 setMonitorAoi(box);
 setPickAoiMode(false);
 setFlyToLocation({ lat: region.center[1], lng: region.center[0], zoom: 7, ts: Date.now() });
 }, []);

// MSIS spill pipeline state — the archive plus any slick placed from the
  // Upload & Analyze flow, the event the right-arm panel is showing, and the
  // PREDICT horizon highlighted on the map.
  const [spillEvents, setSpillEvents] = useState<SpillEvent[]>(() => marineSpillEvents);
  const [spillIndex, setSpillIndex] = useState(0);
  const [forecastHour, setForecastHour] = useState<number | null>(null);

  const resolvedAoi: AoiBox = monitorAoi ?? MONITOR_AOI;
  const aoiCenterPt = {
  lat: (resolvedAoi.south + resolvedAoi.north) / 2,
  lng: (resolvedAoi.west + resolvedAoi.east) / 2,
  };

  const spillEvent = spillEvents[Math.min(spillIndex, spillEvents.length - 1)] ?? spillEvents[0];

  /** Upload & Analyze → place an Oil Spill verdict as a live pipeline event. */
  const handleUploadAnalyzed = useCallback((result: UploadResult, image: UploadedImage) => {
  if (result.classification !== 'Oil Spill') return;
  const ev = eventFromUpload({ result, image, center: aoiCenterPt });
  if (!ev) return;
  const base = spillEvents.filter(e => !e.id.startsWith('UPL-'));
  setSpillEvents([...base, ev]);
  setSpillIndex(base.length);
  setForecastHour(null);
  setRightArmPanel('spill');
  setFlyToLocation({ lat: ev.polygon[0][1], lng: ev.polygon[0][0], zoom: 8, ts: Date.now() });
  }, [spillEvents, aoiCenterPt]);

  /** Upload & Analyze RESET / re-analyse — tear the placed pipeline event down. */
  const handlePipelineReset = useCallback(() => {
  setSpillEvents(prev => prev.filter(e => !e.id.startsWith('UPL-')));
  setSpillIndex(0);
  setForecastHour(null);
  }, []);

 const flyTo = useCallback((coords: [number, number], zoom: number) => {
 setFlyToLocation({ lat: coords[1], lng: coords[0], zoom, ts: Date.now() });
 }, []);

 return (
 <main data-design1 className="fixed inset-0 w-full h-full bg-[#0C0E10] overflow-hidden">

 {/* ── SPLASH ── */}
 <AnimatePresence>
 {showSplash && (
 <motion.div
 initial={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 1, ease: 'easeInOut' }}
className="theme-fixed-dark absolute inset-0 z-[999] flex flex-col items-center justify-center overflow-hidden cursor-pointer"
  style={{ background: 'radial-gradient(ellipse at center, #0a0a14 0%, #0C0E10 70%)' }}
 onClick={() => setShowSplash(false)}
 >
 {/* Scanlines */}
 <div className="absolute inset-0 pointer-events-none z-[1]" style={{
  backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(212,175,55,0.015) 2px, rgba(212,175,55,0.015) 4px)',
  animation: 'splashScanDrift 8s linear infinite',
 }} />

 {/* Radial pulse behind logo */}
 <motion.div
  className="absolute z-[1] w-[400px] h-[400px] rounded-full"
  style={{ background: 'radial-gradient(circle, rgba(var(--gold-rgb),0.08) 0%, transparent 70%)' }}
  animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.6, 0.3] }}
  transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
 />

 <div className="relative z-[2] flex flex-col items-center gap-5 px-6 text-center">
  {/* Logo with glow pulse */}
  <motion.div
   initial={{ scale: 0.8, opacity: 0 }}
   animate={{ scale: 1, opacity: 1 }}
   transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
  >
   <svg viewBox="0 0 650 500" className="w-24 h-24 md:w-28 md:h-28 text-[var(--gold-primary)] drop-shadow-[0_0_18px_rgba(var(--gold-rgb),0.45)]" fill="currentColor">
    <path d="m620.39,364.82c-0.53628-7.2677-1.7767-14.482-5.0286-21.276-9.4786-19.803-33.963-29.34-53.026-19.284-15.333,8.0885-22.563,29.331-13.578,45.149,6.873,12.099,23.072,18.235,35.622,10.228,4.4328-2.828,7.6343-7.2793,8.9938-12.286,1.3595-5.0063,0.68452-10.798-2.9392-15.401-2.2364-2.8407-5.4473-4.7654-9.1114-5.408-3.664-0.64263-8.1708,0.40388-10.875,3.9972-1.7829,2.3692-1.91,4.5449-1.4108,7.1127,0.24961,1.2839,0.78116,2.8399,2.3513,3.9972,1.5702,1.1573,4.2926,1.9424,5.5844,0.58783,1.1069-1.1607-0.67477-3.153-0.73029-4.7559-0.0388-0.83158-0.0772-1.7317,0.26004-2.4745,0.89679-1.1463,1.8493-1.342,3.4682-1.0581,1.6548,0.29023,3.6474,1.4542,4.5851,2.6452v0.0588c2.0224,2.5986,2.3717,5.5943,1.5284,8.6999-0.81645,3.0066-2.8568,5.919-5.4668,7.7006l-0.29391,0.23513c-8.5452,5.4516-18.484,0.70317-23.392-7.9366-6.7162-11.823-1.5113-26.282,10.285-32.505,15.078-7.9537,35.744,1.451,40.36,17.085,4.566,15.464,2.8715,30.938,0.27385,37.511l10.609,0.073c2.5579-12.089,1.9287-15.035,1.9287-22.696z" />
    <path d="m158.66,157a70.231,70.231,0,0,0,-14.44,42.81,70.235,70.235,0,1,0,140.47,0,70.231,70.231,0,0,0,-14.28,-42.81h-111.75z" />
   </svg>
  </motion.div>

  {/* Title — staggered letter reveal */}
  <div>
   <motion.div
    className="font-display text-3xl md:text-4xl font-bold tracking-[0.4em] text-[var(--gold-primary)]"
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.4, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
   >
    MSIS
   </motion.div>
   <motion.div
    className="mt-2 font-mono text-[10px] md:text-[11px] tracking-[0.3em] uppercase text-[var(--gold-primary)]/70"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ delay: 0.8, duration: 0.6 }}
   >
    Marine Spill Intelligence System
   </motion.div>
  </div>

  {/* Gradient divider */}
  <motion.div
   className="h-px w-64 bg-gradient-to-r from-transparent via-[var(--gold-primary)]/50 to-transparent"
   initial={{ scaleX: 0 }}
   animate={{ scaleX: 1 }}
   transition={{ delay: 1, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
  />

  {/* Capabilities */}
  <motion.div
   className="font-mono text-[9px] md:text-[10px] tracking-[0.2em] uppercase text-[var(--text-muted)] opacity-70 leading-relaxed"
   initial={{ opacity: 0 }}
   animate={{ opacity: 0.7 }}
   transition={{ delay: 1.2, duration: 0.6 }}
  >
   SATELLITE DETECTION · AIS CORRELATION · SPILL INTELLIGENCE
  </motion.div>

  {/* Progress bar */}
  <motion.div
   className="w-48 h-[2px] overflow-hidden rounded-full bg-white/5"
   initial={{ opacity: 0 }}
   animate={{ opacity: 1 }}
   transition={{ delay: 1.4 }}
  >
   <motion.div
    className="h-full rounded-full"
    style={{ background: 'linear-gradient(90deg, var(--gold-primary), var(--cyan-primary))' }}
    initial={{ width: '0%' }}
    animate={{ width: '100%' }}
    transition={{ delay: 1.5, duration: 5, ease: 'linear' }}
   />
  </motion.div>

  {/* Status text */}
  <motion.div
   className="flex items-center gap-2 font-mono text-[9px] tracking-[0.2em] text-[var(--cyan-primary)]"
   initial={{ opacity: 0 }}
   animate={{ opacity: 1 }}
   transition={{ delay: 1.6, duration: 0.4 }}
  >
   <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--cyan-primary)] animate-msis-pulse" />
   INITIALIZING SENSOR NETWORK
  </motion.div>
 </div>
 </motion.div>
 )}
 </AnimatePresence>

 {/* ── MAP ── */}
 <ErrorBoundary name="Map">
 <MsisMap
 key={mapProjection}
 data={data}
 activeLayers={activeLayers}
 projection={mapProjection}
 mapStyle={mapStyle === 'satellite' ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' : 'dark'}
 onMouseCoords={handleMouseCoords}
 onClickGround={handleGroundClick}
 aoiBox={resolvedAoi}
 mapControlsPosition={isMobile ? 'right' : 'left'}
 onViewStateChange={setMapView}
flyToLocation={flyToLocation}
  satMonitor={satMonitorSnap ? {
  active: true,
  footprint: satMonitorSnap?.footprint ?? null,
  track: satMonitorSnap?.track ?? [],
  sat: satMonitorSnap?.position ? { lat: satMonitorSnap.position.lat, lng: satMonitorSnap.position.lng, name: satMonitorSnap.satellite?.name || '', color: '#00E5FF' } : null,
  } : null}
  spillEvents={spillEvents}
  forecastHighlight={forecastHour != null && spillEvent ? { eventId: spillEvent.id, hour: forecastHour } : null}
  />
 </ErrorBoundary>

 {/* ── MAP VIGNETTE — subtle edge darkening ── */}
 <div
  className="absolute inset-0 z-[100] pointer-events-none"
  style={{ boxShadow: 'inset 0 0 120px 40px rgba(0,0,0,0.35)' }}
 />

 {/* ── RIGHT VERTICAL ARM — TOGGLE PANEL + CURSOR COORDS ── */}
 {!isMobile && (
 <div className="absolute right-0 top-[64px] z-[250] pointer-events-none" style={{ bottom: marineClosed ? 44 : bottomPanel.size }}>
 <motion.div
 initial={{ x: 24, opacity: 0 }}
 animate={{ x: showRight ? 0 : 24, opacity: showRight ? 1 : 0 }}
 transition={{ type: 'spring', damping: 34, stiffness: 380 }}
 className="hud-glass relative flex h-full flex-col pointer-events-auto border-l border-[var(--surface-border)]"
 style={{ width: rightArmWidth.size, pointerEvents: showRight ? 'auto' : 'none', transition: rightArmWidth.isDragging ? 'none' : 'width 0.2s ease-out' }}
 >
{/* ── resize handle: 3-dot grip on left edge ── */}
  <div
  {...rightArmWidth.handleProps}
className="group absolute left-0 top-0 bottom-0 z-[10] flex items-center justify-center bg-transparent hover:bg-[var(--hover-surface)] transition-colors cursor-col-resize"
   style={{ width: 10, touchAction: 'none' }}
   >
   <div className="flex flex-col gap-[3px] px-1">
   <div className="h-[3px] w-[3px] rounded-full bg-[var(--dot)] group-hover:bg-[var(--dot-hover)] transition-colors" />
   <div className="h-[3px] w-[3px] rounded-full bg-[var(--dot)] group-hover:bg-[var(--dot-hover)] transition-colors" />
   <div className="h-[3px] w-[3px] rounded-full bg-[var(--dot)] group-hover:bg-[var(--dot-hover)] transition-colors" />
  </div>
  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-[var(--bg-panel)] px-1.5 py-0.5 font-mono text-[8px] tracking-[0.15em] text-[var(--text-heading)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100" style={{ transform: 'translateY(-50%)' }}>
  DRAG
  </span>
  </div>
 {/* ── TOGGLE BAR ── */}
 <div className="flex shrink-0 items-center gap-1 px-2 py-1.5 border-b border-[var(--surface-border)]">
<button
  onClick={() => setRightArmPanel(v => v === 'spill' ? null : 'spill')}
  title="Spill intelligence panel — select to view (toggles off)"
  aria-pressed={rightArmPanel === 'spill'}
  className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-mono text-[9px] font-bold tracking-[0.15em] transition-all duration-200 ${
   rightArmPanel === 'spill'
    ? 'bg-[rgba(var(--gold-rgb),0.1)] text-[var(--cyan-primary)]'
: 'text-[var(--text-muted)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-secondary)]'
   }`}
  >
  <Droplet className="h-3 w-3" /> SPILLAGE
 </button>
 <button
 onClick={() => setRightArmPanel(v => v === 'satellite' ? null : 'satellite')}
 title="Satellite monitoring panel — select to view (toggles off)"
 aria-pressed={rightArmPanel === 'satellite'}
 className={`relative flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 font-mono text-[9px] font-bold tracking-[0.15em] transition-all duration-200 ${
rightArmPanel === 'satellite'
    ? 'bg-[rgba(var(--gold-rgb),0.1)] text-[var(--cyan-primary)]'
: 'text-[var(--text-muted)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-secondary)]'
   }`}
  >
  <Satellite className="h-3 w-3" /> SATELLITE
 </button>
 </div>

 {/* ── ACTIVE PANEL (fills remaining space) ── */}
 <div className="relative min-h-0 flex-1 overflow-hidden">
 <AnimatePresence mode="wait">
 {rightArmPanel === 'spill' && (
 <motion.div
 key="spill"
 initial={{ opacity: 0, x: 12 }}
 animate={{ opacity: 1, x: 0 }}
 exit={{ opacity: 0, x: 12 }}
 transition={{ duration: 0.2 }}
 className="absolute inset-0"
 >
<SpillPanel
  event={spillEvent}
  onClose={() => setRightArmPanel(null)}
  flyTo={flyTo}
  events={spillEvents}
  selectedIndex={spillIndex}
  onSelectIndex={(i) => { setSpillIndex(i); setForecastHour(null); }}
  forecastHour={forecastHour}
  onSelectForecast={setForecastHour}
  />
 </motion.div>
 )}
 {rightArmPanel === 'satellite' && (
 <motion.div
 key="satellite"
 initial={{ opacity: 0, x: 12 }}
 animate={{ opacity: 1, x: 0 }}
 exit={{ opacity: 0, x: 12 }}
 transition={{ duration: 0.2 }}
 className="absolute inset-0"
 >
 <SatelliteMonitor
 satellites={(data.satellites || []) as any[]}
 flyTo={flyTo}
 onSnapshot={setSatMonitorSnap}
 aoi={monitorAoi}
 />
 </motion.div>
 )}
 {rightArmPanel === null && (
 <motion.div
 key="empty"
 initial={{ opacity: 0 }}
 animate={{ opacity: 1 }}
 exit={{ opacity: 0 }}
 transition={{ duration: 0.15 }}
 className="flex h-full w-full items-center justify-center"
 >
 <div className="font-mono text-[9px] tracking-[0.15em] text-[var(--text-muted)]">
 SELECT A PANEL ABOVE
 </div>
 </motion.div>
 )}
 </AnimatePresence>
 </div>

 </motion.div>

 {/* Collapse handle — positioned OUTSIDE the motion.div so it stays
      visible even when the arm is collapsed, giving the user a way back in. */}
  <button
  onClick={() => setShowRight(v => !v)}
  aria-label={showRight ? 'Hide right panel' : 'Show right panel'}
  title={showRight ? 'Hide right panel' : 'Show right panel'}
  className="pointer-events-auto absolute top-1/2 z-[260] flex h-10 w-[22px] -translate-y-1/2 items-center justify-center rounded-l-md bg-[var(--bg-panel)]/80 text-[var(--text-muted)] shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-lg transition-colors hover:text-[var(--text-primary)] hover:bg-[var(--bg-panel)] focus-visible:ring-1 focus-visible:ring-[var(--surface-border)]"
  style={{ [showRight ? 'left' : 'right']: showRight ? 0 : 0 }}
  >
  {showRight ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
  </button>
 </div>
 )}

 {/* ── BOTTOM FULL-WIDTH PANEL — LIVE MARINE INTELLIGENCE ── */}
 {!isMobile && (
 <motion.div
 initial={{ opacity: 0, y: 20 }}
 animate={{ opacity: 1, y: 0 }}
 transition={{ delay: 3, duration: 0.8 }}
 className="hud-glass absolute bottom-0 left-0 right-0 z-[250] pointer-events-auto border-t border-transparent"
 style={{
  height: marineClosed ? 44 : bottomPanel.size,
  transition: bottomPanel.isDragging ? 'none' : 'height 0.25s cubic-bezier(0.4,0,0.2,1)',
  borderImage: 'linear-gradient(90deg, transparent, var(--surface-border), transparent) 1'
 }}
 >
 {/* ── resize handle: 3-dot grip (hidden when collapsed) ── */}
 {!marineClosed && (
 <div
 {...bottomPanel.handleProps}
 className="group absolute top-0 left-0 right-0 z-[10] flex items-center justify-center bg-transparent hover:bg-[var(--hover-surface)] transition-colors"
 >
 <div className="relative flex gap-[3px] py-1.5">
 <div className="h-[3px] w-[3px] rounded-full bg-[var(--dot)] group-hover:bg-[var(--dot-hover)] transition-colors" />
 <div className="h-[3px] w-[3px] rounded-full bg-[var(--dot)] group-hover:bg-[var(--dot-hover)] transition-colors" />
 <div className="h-[3px] w-[3px] rounded-full bg-[var(--dot)] group-hover:bg-[var(--dot-hover)] transition-colors" />
 <span className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--bg-panel)] px-1.5 py-0.5 font-mono text-[8px] tracking-[0.15em] text-[var(--text-heading)] opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
 DRAG
 </span>
 </div>
 </div>
 )}
 <div className="h-full pt-1">
 <MarineIntel
 center={aoiCenterPt}
 regionLabel={resolvedAoi.label}
 picking={pickAoiMode}
 onSelectPreset={handleSelectOceanRegion}
 onPickAoi={() => setPickAoiMode(v => !v) }
 collapsed={marineClosed}
 onToggle={() => setMarineClosed(v => !v)}
 />
 </div>
 </motion.div>
 )}

 {/* ── SCALE BAR (desktop) — beside the left dock ── */}
 {!isMobile && (
 <motion.div
 initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.2 }}
 className="absolute left-[58px] z-[200] pointer-events-none"
 style={{ bottom: (marineClosed ? 44 : bottomPanel.size) + 8 }}
 >
 <ScaleBar zoom={mapView.zoom} latitude={mapView.latitude} />
 </motion.div>
 )}

 {/* ── TOP BAR — NAVIGATION & BANNER (Design-1) ── */}
 <motion.div
 initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 2.5 }}
  className="hud-glass absolute top-0 inset-x-0 h-16 z-[300] flex items-center justify-between gap-4 px-4 border-b border-transparent"
  style={{ borderImage: 'linear-gradient(90deg, transparent 10%, rgba(128,128,128,0.08) 50%, transparent 90%) 1' }}
 >
 {/* Left — brand + classification */}
 <div className="flex items-center gap-3 min-w-0">
 <svg viewBox="0 0 650 500" className="w-8 h-8 md:w-9 md:h-9 shrink-0 transition-colors duration-500 text-[var(--gold-primary)] drop-shadow-[0_0_8px_rgba(var(--gold-rgb),0.5)]" fill="currentColor">
 <path d="m620.39,364.82c-0.53628-7.2677-1.7767-14.482-5.0286-21.276-9.4786-19.803-33.963-29.34-53.026-19.284-15.333,8.0885-22.563,29.331-13.578,45.149,6.873,12.099,23.072,18.235,35.622,10.228,4.4328-2.828,7.6343-7.2793,8.9938-12.286,1.3595-5.0063,0.68452-10.798-2.9392-15.401-2.2364-2.8407-5.4473-4.7654-9.1114-5.408-3.664-0.64263-8.1708,0.40388-10.875,3.9972-1.7829,2.3692-1.91,4.5449-1.4108,7.1127,0.24961,1.2839,0.78116,2.8399,2.3513,3.9972,1.5702,1.1573,4.2926,1.9424,5.5844,0.58783,1.1069-1.1607-0.67477-3.153-0.73029-4.7559-0.0388-0.83158-0.0772-1.7317,0.26004-2.4745,0.89679-1.1463,1.8493-1.342,3.4682-1.0581,1.6548,0.29023,3.6474,1.4542,4.5851,2.6452v0.0588c2.0224,2.5986,2.3717,5.5943,1.5284,8.6999-0.81645,3.0066-2.8568,5.919-5.4668,7.7006l-0.29391,0.23513c-8.5452,5.4516-18.484,0.70317-23.392-7.9366-6.7162-11.823-1.5113-26.282,10.285-32.505,15.078-7.9537,35.744,1.451,40.36,17.085,4.566,15.464,2.8715,30.938,0.27385,37.511l10.609,0.073c2.5579-12.089,1.9287-15.035,1.9287-22.696z" />
 <path d="m158.66,157a70.231,70.231,0,0,0,-14.44,42.81,70.235,70.235,0,1,0,140.47,0,70.231,70.231,0,0,0,-14.28,-42.81h-111.75z" />
 </svg>
 <div className="flex flex-col items-start gap-0.5 min-w-0">
 <div className="flex items-center gap-2">
 <h1 className="text-base md:text-lg font-bold tracking-[0.4em] text-[var(--gold-primary)] font-mono">MSIS</h1>
 <span className="hidden sm:inline-flex rounded-sm px-1.5 py-0.5 text-[8px] font-mono tracking-[0.18em] text-[var(--gold-primary)]/80">RESTRICTED · OFFICIAL</span>
 </div>
 <span className="text-[9px] font-mono tracking-[0.2em] uppercase text-[var(--gold-primary)]/70 truncate">MARINE SPILL INTELLIGENCE · NTRO / SIH 2026</span>
 </div>
 </div>

  {/* Right — status cluster */}
  <div className="flex items-center gap-4 text-[10px] font-mono tracking-widest text-[var(--text-secondary)] whitespace-nowrap">
 <span className="hidden lg:inline-flex items-center gap-1.5"><ZuluClock /></span>
 <span className="flex items-center gap-1.5" title="Backend connection status">
   STATUS:
   <span className="flex items-center gap-1.5">
    {backendStatus === 'connected' && (
     <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--alert-green)] opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--alert-green)]" />
     </span>
    )}
    <span className={backendStatus === 'connected' ? 'text-[var(--alert-green)]' : 'text-[var(--alert-red)]'}>
     {backendStatus === 'connected' ? 'LIVE' : backendStatus === 'connecting' ? 'CONNECTING' : 'ERROR'}
    </span>
   </span>
   {backendStatus === 'error' && (
    <button
     onClick={retryAll}
     className="rounded px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-wider text-[var(--alert-red)] bg-[var(--alert-red)]/10 transition-colors hover:bg-[var(--alert-red)]/20"
     title={`Retry ${failedEndpoints.length} failed endpoint(s)`}
    >
     RETRY
    </button>
   )}
  </span>
  <span className="hidden lg:inline-flex items-center gap-1" title="Number of active data layers">
  <span className="text-[var(--cyan-primary)] font-bold">{Object.values(activeLayers).filter(Boolean).length}</span>
  <span>LAYERS</span>
  </span>
  <span className="hidden lg:inline-flex items-center gap-1" title="Tracked entities on map">
  <ActiveEntityCount data={data} />
  <span>ENTITIES</span>
  </span>
  <span className="hidden md:inline" title="Smart India Hackathon 2026 — Problem Statement 26143">NTRO · SIH 2026</span>
  <span className="text-[11px] font-bold tracking-[0.2em] text-[var(--text-secondary)]">V.4.2</span>

 {/* Theme Toggle */}
 <button
  onClick={() => setTheme(v => v === 'dark' ? 'light' : 'dark')}
  title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
  aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
  className="flex h-8 w-8 items-center justify-center rounded-md backdrop-blur-sm transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-secondary)] bg-[var(--text-primary)]/5 text-[var(--text-secondary)] hover:bg-[var(--text-primary)]/10 hover:text-[var(--text-heading)]"
 >
{theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
  </button>

  {/* Keyboard shortcuts hint */}
  <button
  onClick={() => setShortcutsOpen(v => !v)}
  title="Keyboard shortcuts (?)"
  aria-label="Show keyboard shortcuts"
  aria-expanded={shortcutsOpen}
  className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--text-primary)]/5 text-[var(--text-secondary)] backdrop-blur-sm transition-colors hover:bg-[var(--text-primary)]/10 hover:text-[var(--text-heading)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-secondary)]"
  >
  <span className="font-mono text-[12px] font-bold">?</span>
  </button>
  </div>
  </motion.div>

 {/* ── CURSOR COORDINATES — floating top-left overlay ── */}
 {!isMobile && (
 <motion.div
  initial={{ opacity: 0, y: -8 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ delay: 3.2, duration: 0.5 }}
   className="pointer-events-auto absolute left-[58px] top-[76px] z-[300] rounded-lg bg-[var(--bg-panel)] px-3 py-2 backdrop-blur-lg border border-[var(--surface-border)] shadow-[0_4px_24px_rgba(0,0,0,0.5),0_0_40px_rgba(var(--gold-rgb),0.04)]"
 >
<button onClick={() => setCoordsOpen(v => !v)} className="mb-1 flex w-full items-center justify-between font-mono text-[9px] tracking-[0.2em] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
    CURSOR COORDINATES
    {coordsOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
   </button>
   {coordsOpen && (
   <div className="flex flex-col gap-1.5">
    <div className="mb-0.5 text-center font-mono text-[7px] tracking-[0.15em] text-[var(--text-muted)]/80">HOVER MAP TO UPDATE</div>
   <div className="flex items-center justify-between gap-3" title="Cursor lat/lng (hover map)">
    <span className="text-[9px] font-mono tracking-widest text-[var(--text-muted)]">LAT/LNG</span>
    <span ref={coordsDisplayRef} className="font-mono text-[10px] font-bold tabular-nums text-[var(--text-primary)]">—</span>
   </div>
   <div className="flex items-center justify-between gap-3" title="Cursor sea-surface temperature">
    <span className="text-[9px] font-mono tracking-widest text-[var(--text-muted)]">SST</span>
    <span ref={hoverSstRef} className="font-mono text-[10px] font-bold tabular-nums text-[var(--text-primary)]">—</span>
   </div>
   <div className="flex items-center justify-between gap-3" title="Cursor wind conditions">
    <span className="text-[9px] font-mono tracking-widest text-[var(--text-muted)]">WIND</span>
    <span ref={hoverWindRef} className="font-mono text-[10px] font-bold tabular-nums text-[var(--text-primary)]">—</span>
   </div>
   <div className="flex items-center justify-between gap-3" title="Cursor sea state">
    <span className="text-[9px] font-mono tracking-widest text-[var(--text-muted)]">SEA</span>
    <span ref={hoverSeaRef} className="font-mono text-[10px] font-bold tabular-nums text-[var(--text-primary)]">—</span>
   </div>
  </div>
  )}
 </motion.div>
 )}

 {/* ── LEFT DOCK — LAYER CONTROL + MAP CONTROL (Design-1, collapsible) ── */}
 {!isMobile && (
 <div className="absolute left-0 top-[64px] z-[280] pointer-events-auto" style={{ bottom: marineClosed ? 44 : bottomPanel.size }}>
 <motion.div
 initial={{ x: -60, opacity: 0 }}
 animate={{ x: showLayers ? 0 : -56, opacity: 1 }}
 transition={{ type: 'spring', damping: 34, stiffness: 380 }}
 className="relative flex h-full w-[48px] flex-col"
 style={{ pointerEvents: showLayers ? 'auto' : 'none' }}
 >
 <div className="relative flex-1 min-h-0">
 <LayerPanel activeLayers={activeLayers} setActiveLayers={setActiveLayers} uploadOpen={showUpload} onUpload={() => { setToolMenuOpen(v => !v); setShowUpload(v => !v); }} onCloseUpload={() => { setShowUpload(false); setToolMenuOpen(false); }} flyTo={flyTo} onUploadAnalyzed={handleUploadAnalyzed} onPipelineReset={handlePipelineReset} />
 </div>
{/* Map control cluster */}
  <div className="theme-fixed-dark hud-glass flex flex-col items-center gap-1.5 pb-3 pt-1">
  <span className="text-[8px] font-mono tracking-[0.2em] text-[var(--text-muted)]">VIEW</span>
  <button onClick={() => setMapProjection('globe')} title="3D Globe" aria-pressed={mapProjection === 'globe'} className={`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-300 ${mapProjection === 'globe' ? 'bg-[var(--text-primary)]/10 text-[var(--text-heading)]' : 'text-[var(--text-muted)] hover:bg-[var(--text-primary)]/5 hover:text-[var(--text-secondary)]'}`}>
   <Globe className="h-4 w-4" />
  </button>
  <button onClick={() => setMapProjection('mercator')} title="2D Map" aria-pressed={mapProjection === 'mercator'} className={`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-300 ${mapProjection === 'mercator' ? 'bg-[var(--text-primary)]/10 text-[var(--text-heading)]' : 'text-[var(--text-muted)] hover:bg-[var(--text-primary)]/5 hover:text-[var(--text-secondary)]'}`}>
   <MapPinned className="h-4 w-4" />
  </button>
  <button onClick={() => setMapStyle('dark')} title="Night basemap" aria-pressed={mapStyle === 'dark'} className={`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-300 ${mapStyle === 'dark' ? 'bg-[var(--text-primary)]/10 text-[var(--text-heading)]' : 'text-[var(--text-muted)] hover:bg-[var(--text-primary)]/5 hover:text-[var(--text-secondary)]'}`}>
   <Moon className="h-4 w-4" />
  </button>
  <button onClick={() => setMapStyle('satellite')} title="Satellite imagery" aria-pressed={mapStyle === 'satellite'} className={`flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-300 ${mapStyle === 'satellite' ? 'bg-[var(--text-primary)]/10 text-[var(--text-heading)]' : 'text-[var(--text-muted)] hover:bg-[var(--text-primary)]/5 hover:text-[var(--text-secondary)]'}`}>
   <Satellite className="h-4 w-4" />
  </button>
 </div>
 </motion.div>

 {/* Collapse handle — sits in the rail's top padding, always visible */}
 <button
 onClick={() => setShowLayers(v => !v)}
 aria-label={showLayers ? 'Hide layer panel' : 'Show layer panel'}
 title={showLayers ? 'Hide layer panel' : 'Show layer panel'}
 className="theme-fixed-dark absolute left-0 top-6 z-[10] flex h-10 w-[22px] items-center justify-center rounded-r-md bg-black/30 text-[var(--text-secondary)] shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-lg transition-colors hover:text-[var(--text-heading)]"
 >
 {showLayers ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
 </button>
 </div>
 )}

 {/* ═══ MOBILE UI ═══ */}
 {isMobile && (
 <>
 {/* Mobile Bottom Navigation */}
 <div className="mobile-nav">
 <div className="glass-panel mobile-nav-inner">
 {[
 { id: 'layers' as const, icon: Layers, label: 'LAYERS' },
 ].map(tab => {
 const active = mobilePanel === tab.id;
 return (
 <button
 key={tab.id}
 onClick={() => setMobilePanel(mobilePanel === tab.id ? null : tab.id)}
 aria-pressed={active}
 className={`mobile-nav-btn ${active ? 'active' : ''}`}
 >
 <tab.icon className="w-4 h-4" />
 <span>{tab.label}</span>
 </button>
 );
 })}
 </div>
 </div>

 {/* Mobile Drawer */}
 <AnimatePresence>
 {mobilePanel && (
 <motion.div
 initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
 transition={{ type: 'spring', damping: 30, stiffness: 300 }}
 className="fixed bottom-[52px] left-0 right-0 z-[400] glass-panel rounded-b-none overflow-y-auto styled-scrollbar"
 style={{ maxHeight: 'min(55vh, calc(100dvh - 100px))', paddingBottom: 'env(safe-area-inset-bottom, 4px)' }}
 >
 <div className="mobile-drawer-handle" />
 <div className="px-3 pb-3">
 <div className="flex items-center justify-between mb-2">
 <span className="hud-text text-[10px] text-[var(--text-primary)]">LAYERS & STATS</span>
 <button onClick={() => setMobilePanel(null)} className="text-[var(--text-muted)] p-1"><X className="w-4 h-4" /></button>
 </div>
 <div className="glass-panel-sm p-2 mb-2">
 <div className="grid grid-cols-3 gap-1 text-center">
 <div><div className="hud-label" style={{ fontSize: '9px' }}>SAT</div><div className="hud-value text-[10px]">{(data.satellites?.length || 0)}</div></div>
 <div><div className="hud-label" style={{ fontSize: '9px' }}>VESSELS</div><div className="hud-value text-[10px]">{(data.maritime_ships?.length || 0)}</div></div>
 <div><div className="hud-label" style={{ fontSize: '9px' }}>SPILL</div><div className="hud-value text-[10px]" style={{ color: 'var(--alert-red)' }}>{marineSpillEvents.length}</div></div>
 </div>
 </div>
 <LayerPanel activeLayers={activeLayers} setActiveLayers={setActiveLayers} isMobile={true} onUploadAnalyzed={handleUploadAnalyzed} onPipelineReset={handlePipelineReset} />
 </div>
 </motion.div>
 )}
 </AnimatePresence>
 </>
 )}



 {/* ── OVERLAYS ── */}
 <div className="vignette absolute inset-0 pointer-events-none z-[2]" />
 <div className="crt-scanlines absolute inset-0 pointer-events-none z-[3] opacity-[0.02]" />
 {[
 { pos: 'top-0 left-0', vAnchor: 'top-0', hAnchor: 'left-0', hGrad: 'bg-gradient-to-r', vGrad: 'bg-gradient-to-b' },
 { pos: 'top-0 right-0', vAnchor: 'top-0', hAnchor: 'right-0', hGrad: 'bg-gradient-to-l', vGrad: 'bg-gradient-to-b' },
 { pos: 'bottom-0 left-0', vAnchor: 'bottom-0', hAnchor: 'left-0', hGrad: 'bg-gradient-to-r', vGrad: 'bg-gradient-to-t' },
 { pos: 'bottom-0 right-0', vAnchor: 'bottom-0', hAnchor: 'right-0', hGrad: 'bg-gradient-to-l', vGrad: 'bg-gradient-to-t' },
 ].map((c, i) => (
 <div key={i} className={`absolute ${c.pos} w-16 h-16 pointer-events-none z-[1]`}>
 <div className={`absolute ${c.vAnchor} ${c.hAnchor} w-full h-[1px] ${c.hGrad} from-[var(--gold-primary)]/30 to-transparent`} />
 <div className={`absolute ${c.vAnchor} ${c.hAnchor} w-[1px] h-full ${c.vGrad} from-[var(--gold-primary)]/30 to-transparent`} />
 </div>
 ))}

{/* Keyboard Shortcuts Overlay */}
  <KeyboardShortcuts open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

 </main>
 );
}