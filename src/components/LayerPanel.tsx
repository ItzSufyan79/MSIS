'use client';

import { memo, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Ship, Satellite, Droplet, FileUp } from 'lucide-react';
import UploadAnalyze from '@/components/UploadAnalyze';
import type { UploadedImage, UploadResult } from '@/lib/spill-upload';

interface LayerPanelProps {
 activeLayers: Record<string, boolean>;
 setActiveLayers: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
 /** Upload & Analyze — toggles the uploader; the panel renders beside the
  *  left-rail UPLOAD tile (not the top bar), so this state also drives it. */
 uploadOpen?: boolean;
 onUpload?: () => void;
 onCloseUpload?: () => void;
 flyTo?: (coords: [number, number], zoom: number) => void;
 /** Passed down to UploadAnalyze: place placed slicks on the map / tear them
  *  down on RESET. */
 onUploadAnalyzed?: (result: UploadResult, image: UploadedImage) => void;
 onPipelineReset?: () => void;
 isMobile?: boolean;
}

interface LayerDef {
 key: string;
 label: string;
 /** Key of the layer this one modifies. Renders indented beneath it, and reads
 * as inert while that parent is off — it has nothing to act on. */
 parent?: string;
}

interface LayerGroupDef {
 label: string;
 fullLabel: string;
 icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
 layers: LayerDef[];
}

const LAYER_GROUPS: LayerGroupDef[] = [
 {
 label: 'MAR',
 fullLabel: 'MARITIME / AIS',
 icon: Ship,
 layers: [
 { key: 'maritime', label: 'Vessels · Ports · Chokepoints' },
 ],
 },
 {
 label: 'SPILL',
 fullLabel: 'MARINE SPILL',
 icon: Droplet,
 layers: [
 { key: 'oil_spill', label: 'Oil Spill Profile' },
 ],
 },
 {
 label: 'SAT',
 fullLabel: 'SATELLITE CONSTELLATIONS',
 icon: Satellite,
 layers: [
 { key: 'satellites', label: 'All Satellites' },
 { key: 'sat_comms', label: 'Comms / Starlink' },
 { key: 'sat_military', label: 'Military / SAR / EO' },
 { key: 'sat_navigation', label: 'GNSS / Navigation' },
 { key: 'sat_earth', label: 'Earth Observation' },
 { key: 'sat_science', label: 'Stations / Science' },
 ],
 },
];

/* ── Minimal Toggle Switch ── */
/**
 * Presentational only. The row around it is the button, and a button inside a
 * button is invalid HTML — the browser reparents it, which breaks hydration and
 * silently drops the click handler on the inner control.
 */
function ToggleSwitch({ active }: { active: boolean }) {
 return (
 <span
 role="presentation"
 className="relative flex-shrink-0 block"
 style={{ width: 28, height: 14 }}
 >
 <div
 className="absolute inset-0 rounded-full transition-all duration-300"
 style={{
  background: active ? 'rgba(var(--gold-rgb),0.25)' : 'transparent',
  border: 'none',
  boxShadow: active ? '0 0 8px rgba(var(--gold-rgb),0.1)' : 'none',
 }}
 />
 <motion.div
 className="absolute top-[2px] rounded-full"
 style={{
 width: 10,
 height: 10,
 background: active ? 'rgba(var(--gold-rgb),0.85)' : 'rgba(var(--gold-rgb),0.2)',
 boxShadow: active ? '0 0 6px rgba(var(--gold-rgb),0.4)' : 'none',
 }}
 animate={{ left: active ? 16 : 2 }}
 transition={{ type: 'spring', stiffness: 500, damping: 30 }}
 />
 </span>
 );
}

function SubLayerStem() {
 return (
 <span
 aria-hidden
 className="pointer-events-none absolute left-[6px] top-0 h-1/2 w-[8px] rounded-bl-[3px] border-b border-l border-[var(--surface-border)]"
 />
 );
}

function LayerPanel({ activeLayers, setActiveLayers, uploadOpen, onUpload, onCloseUpload, flyTo, onUploadAnalyzed, onPipelineReset, isMobile }: LayerPanelProps) {
 const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
 const [pinnedGroup, setPinnedGroup] = useState<string | null>(null);
 const [uploadHovered, setUploadHovered] = useState(false);

 useEffect(() => {
 if (!pinnedGroup) return;
 const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinnedGroup(null); };
 window.addEventListener('keydown', onKey);
 return () => window.removeEventListener('keydown', onKey);
 }, [pinnedGroup]);

 const toggle = (key: string) => setActiveLayers(prev => ({ ...prev, [key]: !prev[key] }));

 const toggleGroup = (layers: LayerDef[]) => {
 const anyOn = layers.some(l => activeLayers[l.key]);
 setActiveLayers(prev => {
 const next = { ...prev };
 for (const l of layers) next[l.key] = !anyOn;
 return next;
 });
 };

 /* ── MOBILE ── */
 if (isMobile) {
 return (
 <div className="flex flex-col gap-5 py-2">
 {LAYER_GROUPS.map((group) => (
 <div key={group.label} className="flex flex-col gap-2">
  <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-[var(--text-muted)] pb-1.5">
 {group.fullLabel}
 </div>
 <div className="flex flex-col gap-1">
 {group.layers.map((layer) => {
 const isLayerActive = activeLayers[layer.key];
 const dormant = !!layer.parent && !activeLayers[layer.parent];
 return (
 <button
 key={layer.key}
 onClick={() => toggle(layer.key)}
 aria-pressed={!!isLayerActive}
 className={`relative w-full flex items-center gap-3 py-2 rounded-md text-left hover:bg-[var(--hover-surface)] transition-colors ${layer.parent ? 'pl-[22px] pr-1' : 'px-1'} ${dormant ? 'opacity-40' : ''}`}
 >
 {layer.parent && <SubLayerStem />}
 <ToggleSwitch active={!!isLayerActive} />
 <span className={`text-[11px] font-mono uppercase tracking-wider flex-1 transition-colors ${isLayerActive ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
 {layer.label}
 </span>
 </button>
 );
 })}
 </div>
 </div>
 ))}
 </div>
 );
 }

 /* ── DESKTOP ── */
 return (
 /* The desktop 48px rail and its flyout always sit over the always-dark map
    (the globe stays dark in light mode), so pin the interior tokens to the
    dark palette — `theme-fixed-dark` re-resolves --text-* / --surface-* /
    --gold-rgb to their dark-theme values. */
 <motion.div
 initial={{ x: -60, opacity: 0 }}
 animate={{ x: 0, opacity: 1 }}
 transition={{ type: 'spring', damping: 34, stiffness: 380 }}
className="theme-fixed-dark hud-glass absolute top-0 left-0 h-full w-[48px] flex flex-col items-center pt-24 pb-6 z-50 pointer-events-auto"
  >
  <div className="flex-1 flex flex-col items-center gap-1">
 {LAYER_GROUPS.map((group) => {
 const counted = group.layers.filter(l => !l.parent);
 const groupActive = counted.some(l => activeLayers[l.key]);
 const isHovered = hoveredGroup === group.label;
 const Icon = group.icon;

 const activeCount = counted.filter(l => activeLayers[l.key]).length;
 const isPinned = pinnedGroup === group.label;
 const isOpen = isHovered || isPinned;

 return (
 <div
 key={group.label}
 className="relative flex items-center justify-center"
 onMouseEnter={() => setHoveredGroup(group.label)}
 onMouseLeave={() => setHoveredGroup(null)}
 >
 <button
 onClick={() => setPinnedGroup(isPinned ? null : group.label)}
 aria-expanded={isOpen}
 aria-label={`${group.fullLabel}${activeCount ? ` — ${activeCount} active` : ''}`}
 title={group.fullLabel}
 className="relative w-10 h-10 flex items-center justify-center cursor-pointer rounded-lg transition-all duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
 style={{
 background: isPinned
 ? 'rgba(255,255,255,0.10)'
 : isHovered ? 'rgba(255,255,255,0.05)' : 'transparent',
 }}
 >
 <Icon
 className="transition-all duration-300"
 style={{
 width: 16,
 height: 16,
 color: groupActive
 ? 'rgba(255,255,255,0.75)'
 : isOpen
 ? 'rgba(255,255,255,0.45)'
 : 'rgba(255,255,255,0.22)',
 filter: groupActive ? 'drop-shadow(0 0 4px rgba(255,255,255,0.3))' : 'none',
 }}
 />

 {activeCount > 0 && (
 <span
 className="absolute top-1 right-1 min-w-[13px] h-[13px] px-[3px] rounded-full flex items-center justify-center text-[9px] font-mono tabular-nums leading-none"
 style={{
 background: 'rgba(0,229,255,0.9)',
 color: '#04040A',
 boxShadow: '0 0 6px rgba(0,229,255,0.5)',
 }}
 >
 {activeCount}
 </span>
 )}
 </button>

 {/* Flyout (LEFT side) */}
 <AnimatePresence>
 {isOpen && (
 <motion.div
 initial={{ opacity: 0, x: -8, filter: 'blur(4px)' }}
 animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
 exit={{ opacity: 0, x: -4, filter: 'blur(2px)' }}
 transition={{ duration: 0.18, ease: 'easeOut' }}
 className="absolute left-[52px] top-1/2 -translate-y-1/2 min-w-[220px] rounded-xl p-3 z-[100] pointer-events-auto"
 style={{
 background: 'rgba(0,0,0,0.6)',
backdropFilter: 'blur(14px) saturate(1.4)',
  WebkitBackdropFilter: 'blur(14px) saturate(1.4)',
  border: 'none',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
 }}
 >
 <div className="flex items-center gap-2 mb-2.5 pb-1.5">
 <span className="text-[10px] font-mono tracking-[0.2em] uppercase text-[var(--text-muted)] flex-1">
 {group.fullLabel}
 </span>
 <button
 onClick={(e) => { e.stopPropagation(); toggleGroup(group.layers); }}
 className="px-1.5 py-0.5 rounded text-[10px] font-mono tracking-wider text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--hover-surface)] transition-colors"
 >
 {activeCount > 0 ? 'NONE' : 'ALL'}
 </button>
 {isPinned && (
 <button
 onClick={(e) => { e.stopPropagation(); setPinnedGroup(null); }}
 aria-label="Close"
 className="px-1.5 py-0.5 rounded text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--hover-surface)] transition-colors"
 >
 ✕
 </button>
 )}
 </div>
 <div className="flex flex-col gap-0.5">
 {group.layers.map((layer) => {
 const isLayerActive = activeLayers[layer.key];
 const dormant = !!layer.parent && !activeLayers[layer.parent];

 return (
 <button
 key={layer.key}
 onClick={() => toggle(layer.key)}
aria-pressed={!!isLayerActive}
  title={dormant ? 'Turn the layer above on to use this' : `Toggle ${layer.label}`}
 className={`relative w-full flex items-center gap-3 py-1.5 rounded-md hover:bg-[var(--hover-surface)] transition-colors cursor-pointer text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--surface-border)] ${layer.parent ? 'pl-[22px] pr-1' : 'px-1'} ${dormant ? 'opacity-40' : ''}`}
 >
 {layer.parent && <SubLayerStem />}
 <ToggleSwitch active={!!isLayerActive} />
 <span className={`text-[11px] font-mono uppercase tracking-wider flex-1 transition-colors duration-200 ${isLayerActive ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}`}>
 {layer.label}
 </span>
 </button>
 );
 })}
 </div>
 </motion.div>
 )}
</AnimatePresence>
  </div>
  );
   })}
  </div>
  {/* Upload & Analyze — hover-to-open like layer groups, click to pin. */}
  {onUpload && (
  <div
  className="relative mt-auto"
  onMouseEnter={() => setUploadHovered(true)}
  onMouseLeave={() => setUploadHovered(false)}
  >
  <button
  onClick={onUpload}
  aria-label="Upload & Analyze — Sentinel-1 / GeoTIFF / PNG / JPG"
  aria-expanded={uploadHovered || !!uploadOpen}
  title="Upload & Analyze"
  className="relative w-10 h-10 flex items-center justify-center cursor-pointer rounded-lg transition-all duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-[rgba(var(--sev-gold-rgb),0.6)]"
  style={{ background: uploadOpen ? `rgba(var(--sev-gold-rgb),0.15)` : uploadHovered ? `rgba(var(--sev-gold-rgb),0.08)` : 'transparent' }}
  >
  <FileUp
  className="transition-all duration-300"
  style={{
   width: 16,
   height: 16,
   color: uploadOpen || uploadHovered ? 'var(--sev-gold)' : 'rgba(var(--sev-gold-rgb),0.45)',
   filter: uploadOpen ? `drop-shadow(rgba(var(--sev-gold-rgb),0.3) 0px 0px 4px)` : 'none',
  }}
  />
  <span
  className="absolute top-1 right-1 min-w-[13px] h-[13px] px-[3px] rounded-full flex items-center justify-center text-[9px] font-mono tabular-nums leading-none"
  style={{ background: 'rgba(var(--sev-gold-rgb),0.9)', color: 'rgb(4, 4, 10)', boxShadow: `rgba(var(--sev-gold-rgb),0.5) 0px 0px 6px` }}
  >
  +
  </span>
  </button>

  <AnimatePresence>
  {(uploadHovered || uploadOpen) && onCloseUpload && flyTo && (
  <motion.div
  initial={{ opacity: 0, x: -8, filter: 'blur(4px)' }}
  animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
  exit={{ opacity: 0, x: -4, filter: 'blur(2px)' }}
  transition={{ duration: 0.18, ease: 'easeOut' }}
  className="absolute left-[52px] top-1/2 z-[200] -translate-y-1/2"
  >
  <UploadAnalyze onClose={onCloseUpload} flyTo={flyTo} onAnalyzed={onUploadAnalyzed} onReset={onPipelineReset} />
  </motion.div>
  )}
  </AnimatePresence>
  </div>
  )}
  </motion.div>
  );
 }

export default memo(LayerPanel);