'use client';
import { buildGeometry, closeRing, drawReducer, initialDrawState, measure, type DrawAction, type DrawMode, type DrawProgress, type DrawResult, type DrawState } from '@/lib/draw';

import { useEffect, useRef, useState, useCallback, memo } from 'react';
import maplibregl from 'maplibre-gl';
import { createSatelliteLayer, parseColor, type SatPoint } from '@/lib/satellite-layer';
import { MAP_DEFAULTS, MAP_PALETTE_KEYS, readMapPalette, satColorFor, type MapPalette } from '@/lib/map-palette';
import { STYLE_EVENT } from '@/lib/style-tokens';
import SatelliteCard, { type SatelliteDetail } from '@/components/SatelliteCard';
import MapControls from '@/components/MapControls';
import { marineSpillEvents, marineSpillSource, type SpillEvent } from '@/lib/marine-spill';

/** The catalogue fields the satellite layer and its popup actually read. */
interface SatelliteRow {
  name: string;
  lat: number;
  lng: number;
  alt: number;
  color?: string;
  mission?: string;
  category?: string;
  noradId?: string;
}
import 'maplibre-gl/dist/maplibre-gl.css';

interface MsisMapProps {
  data: any;
  activeLayers: Record<string, boolean>;
  onMouseCoords?: (coords: { lat: number; lng: number }) => void;
  onRightClick?: (coords: { lat: number; lng: number }) => void;
  /** Clicked on the ground — nothing the app draws claimed the point. Used by
   *  the MSIS custom-AOI picker. */
  onClickGround?: (coords: { lat: number; lng: number }) => void;
  /** AOI box to overlay — the region satellite coverage is measured against. */
  aoiBox?: { west: number; east: number; south: number; north: number } | null;
  /** Where the zoom/compass pad lands: right is the legacy spot, left clears
   *  the docked MSIS right column. */
  mapControlsPosition?: 'right' | 'left';
  onViewStateChange?: (vs: { zoom: number; latitude: number }) => void;
  flyToLocation?: { lat: number; lng: number; zoom?: number; ts: number } | null;
  projection?: 'mercator' | 'globe';
  mapStyle?: string;
  demoMode?: boolean;
  theme?: 'core' | 'ghost';
  drawnPolygons?: Array<{ id: string; name: string; geojson: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.LineString>; color: string }>;
  arcgisLayers?: Array<{ id: string; title: string; geojson: any; color?: string; opacity?: number }>;
  /** Active draw mode, or null when not drawing. */
  drawMode?: DrawMode | null;
  onDrawProgress?: (p: DrawProgress | null) => void;
  onDrawCancel?: () => void;
  /**
   * Undo / finish / cancel driven from a button rather than the keyboard.
   * Carries a seq so pressing the same button twice still registers.
   */
  drawCommand?: { action: DrawAction["type"]; seq: number } | null;
  onDrawComplete?: (result: DrawResult) => void;
  onMapCenter?: (coords: { lat: number; lng: number; bounds?: { west: number; south: number; east: number; north: number } }) => void;
  /** Active turn-by-turn route drawn as a line with origin/destination pins. */
  route?: {
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    from: { lat: number; lng: number };
    to: { lat: number; lng: number };
    /** Unselected alternatives, drawn dimmed behind the active line. */
    alternates?: Array<{ type: 'LineString'; coordinates: [number, number][] }>;
    /** Highlighted portion for the step the operator has selected. */
    activeSegment?: [number, number][] | null;
  } | null;
  /** Live position from the browser — drawn as a pulsing dot with accuracy ring. */
  userLocation?: { lat: number; lng: number; accuracy?: number; heading?: number | null } | null;
  /** Keep the camera centred on userLocation as it moves. */
  followUser?: boolean;
  /** Fired when the operator pans/zooms/rotates while follow mode is on. */
  onFollowInterrupt?: () => void;
  /** Live navigation: tighter zoom and the map turned to face travel direction. */
  navigating?: boolean;
  /** MSIS satellite monitor overlay — footprint + pending ground track + marker. */
  satMonitor?: {
    active: boolean;
    footprint: GeoJSON.Feature<GeoJSON.Polygon> | null;
    track: GeoJSON.Feature<GeoJSON.LineString>[];
    sat: { lat: number; lng: number; name: string; color: string } | null;
  } | null;
  /**
   * Spill events to render — defaults to the archive, but the page can hand
   * over archive + uploaded pipeline events so they all live on the map.
   */
  spillEvents?: SpillEvent[];
  /** Selected forecast horizon from the spill panel; emphasized on the map. */
  forecastHighlight?: { eventId: string; hour: number } | null;
}

function computeSolarTerminator(): [number, number][] {
  const now = new Date();
  const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
  const declination = -23.44 * Math.cos((2 * Math.PI / 365) * (dayOfYear + 10));
  const decRad = declination * Math.PI / 180;
  const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
  const subsolarLng = (12 - utcHours) * 15;
  const points: [number, number][] = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    const lngRad = (lng - subsolarLng) * Math.PI / 180;
    const lat = Math.atan(-Math.cos(lngRad) / Math.tan(decRad)) * 180 / Math.PI;
    points.push([lng, lat]);
  }
  const darkSide = declination >= 0 ? -90 : 90;
  points.push([180, darkSide]);
  points.push([-180, darkSide]);
  points.push(points[0]);
  return points;
}

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

/**
 * Layers that own their click handling. Ground clicks — the MSIS AOI picker —
 * must defer to these, exactly like the satellite GPU pick does, so a camera,
 * aircraft or vessel under the cursor is never treated as empty ground.
 */
const CLICKABLE_LAYER_IDS = ['maritime-dots','choke-dots','ship-dots',
  'msis-vessel','msis-satmon-point','msis-forecast-point'];

function MsisMap({ data, activeLayers, onMouseCoords, onRightClick, onClickGround, aoiBox = null, mapControlsPosition = 'right', onViewStateChange, flyToLocation, projection = 'globe', mapStyle = 'dark', demoMode = false, theme = 'core', drawnPolygons = [], arcgisLayers = [], drawMode = null, onDrawComplete, onDrawProgress, onDrawCancel, drawCommand = null, onMapCenter, route = null, userLocation = null, followUser = false, onFollowInterrupt, navigating = false, satMonitor = null, spillEvents = marineSpillEvents, forecastHighlight = null }: MsisMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  /**
   * What the map's own layers draw with, mirrored out of the `--map-*` custom
   * properties. Held in state rather than read at each use so a change re-runs
   * the recolour effects; held in a ref as well for the click handlers, which
   * are registered once on load and would otherwise close over the first value.
   */
  const [palette, setPalette] = useState<MapPalette>(MAP_DEFAULTS);
  const paletteRef = useRef(palette);
  useEffect(() => { paletteRef.current = palette; }, [palette]);
  const prevStyleRef = useRef(mapStyle);
  const prevDrawnPolygonsRef = useRef<string[]>([]);
  const prevArcgisLayersRef = useRef<string[]>([]);
  const satLayerRef = useRef<ReturnType<typeof createSatelliteLayer> | null>(null);
  // pick() returns an index into the array last handed to setPoints, so the
  // matching catalogue rows are kept in the same order to resolve it.
  const satRowsRef = useRef<SatelliteRow[]>([]);
  /** Index of the selected satellite in the array last handed to setPoints. */
  const satPickedRef = useRef<number | null>(null);
  /** The selection's NORAD id. The index moves whenever the catalogue is
   *  re-polled and re-filtered; the id does not, so it is what identifies the
   *  selection across a refresh and what discards a late orbit reply. */
  const satSelectedIdRef = useRef<string | null>(null);
  /** When the catalogue positions were propagated for, so an orbit can be drawn
   *  around the marker rather than around the moment it was clicked. */
  const satEpochRef = useRef<number | null>(null);
  const [selectedSat, setSelectedSat] = useState<SatelliteDetail | null>(null);

  /** Drops the selection: the ring, the orbit track and the readout together.
   *  Leaving any one of them behind is what made a closed popup look like a
   *  still-selected satellite. */
  const clearSat = useCallback(() => {
    if (satPickedRef.current === null && satSelectedIdRef.current === null) return;
    satPickedRef.current = null;
    satSelectedIdRef.current = null;
    satLayerRef.current?.setSelected(null);
    satLayerRef.current?.setOrbit(null);
    setSelectedSat(null);
  }, []);
  const drawingCoordsRef = useRef<number[][]>([]);

  // Create aircraft icon on canvas (for WebGL symbol layer)

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // ── DEMO MODE SPINNING ──
    let spinReq: number | undefined = undefined;
    let isSpinning = false;
    
    const startSpinning = () => {
      if (!map) return;
      isSpinning = true;
      let lastTime = performance.now();
      
      const frame = (time: number) => {
        if (!isSpinning) return;
        
        // Only spin if the user is not actively dragging or zooming the map
        if (!map.isMoving() && !map.isZooming()) {
          const dt = time - lastTime;
          const center = map.getCenter();
          // Adjust spin speed: 0.5 degrees per second
          center.lng += (0.5 * dt) / 1000;
          map.setCenter(center);
        }
        
        lastTime = time;
        spinReq = requestAnimationFrame(frame);
      };
      
      spinReq = requestAnimationFrame(frame);
    };

    if (demoMode) {
      startSpinning();
    } else {
      isSpinning = false;
      if (spinReq) cancelAnimationFrame(spinReq);
    }

    return () => {
      isSpinning = false;
      if (spinReq) cancelAnimationFrame(spinReq);
      if (typeof window !== 'undefined' && (window as any)._globeSpinTimer) {
        clearInterval((window as any)._globeSpinTimer);
      }
    };
  }, [mapReady, demoMode]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    
    // Select basemap style
    const styleUrl = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

    const container = containerRef.current;
    const baseOptions = {
      container,
      style: styleUrl,
      center: [25.48, 42.70] as [number, number], zoom: 6.5, minZoom: 1.5, maxZoom: 18,
      attributionControl: false as const,
      maxPitch: 85,
    };

    // MapLibre asks for a high-performance WebGL2 context and throws outright if it
    // cannot get one. Some machines refuse that exact request while still granting a
    // plainer context — a blocklisted discrete GPU, a driver Chrome only trusts for
    // WebGL1 — so walk down to weaker requests before giving up.
    const attributeFallbacks: maplibregl.MapOptions['canvasContextAttributes'][] = [
      undefined,
      { powerPreference: 'low-power', failIfMajorPerformanceCaveat: false },
      { contextType: 'webgl', powerPreference: 'low-power', failIfMajorPerformanceCaveat: false },
    ];

    let map: maplibregl.Map | undefined;
    for (const canvasContextAttributes of attributeFallbacks) {
      try {
        map = new maplibregl.Map(
          canvasContextAttributes ? { ...baseOptions, canvasContextAttributes } : baseOptions
        );
        break;
      } catch (e) {
        // A failed constructor leaves its canvas behind; the next attempt needs a clean container.
        container.innerHTML = '';
        if (canvasContextAttributes === attributeFallbacks[attributeFallbacks.length - 1]) throw e;
        console.warn('[MSIS] WebGL context rejected, retrying with weaker attributes:', e instanceof Error ? e.message : e);
      }
    }
    if (!map) return;

    map.on('load', () => {
      mapRef.current = map;
      
      // Theme colors
      const isGhost = theme === 'ghost';
      /* The first paint reads the same `--map-*` properties the recolour
         effects below push in later. Deriving them from `theme` here as well
         is what let the two drift: the effect's ghost palette was four
         distinct violets, this block's was one, and whichever ran last won. */
      const bootStyle = getComputedStyle(document.body);
      const boot = readMapPalette(name => bootStyle.getPropertyValue(name));

      const sources = ['satellites','day-night','maritime','maritime-choke','maritime-ships','marine-spill', 'msis-forecast-hl', 'msis-satmon', 'msis-aoi'];
      sources.forEach(s => map.addSource(s, { type: 'geojson', data: EMPTY_FC }));

      // Day/Night
      map.addLayer({ id: 'day-night-fill', type: 'fill', source: 'day-night', paint: { 'fill-color': isGhost ? '#0D0030' : '#000022', 'fill-opacity': 0.35 }});

      // Satellites.
      // Every satellite is drawn once, by the custom 3D layer below, at its
      // altitude. These two circle layers are kept defined — the source feeds
      // the 3D layer and other code refers to them — but hidden: drawing the
      // same satellite both flat on the ground and again up at altitude is
      // what made the map read as half 2D and half 3D.
      // Hit-testing is handled by the 3D layer's own GPU pick pass, since
      // queryRenderedFeatures cannot see into a custom WebGL layer.
      map.addLayer({ id: 'sat-glow', type: 'circle', source: 'satellites', layout: { visibility: 'none' }, paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,3, 5,6], 'circle-color': ['get','color'], 'circle-opacity': 0.3, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'sat-dots', type: 'circle', source: 'satellites', layout: { visibility: 'none' }, paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,1.5, 5,3], 'circle-color': ['get','color'], 'circle-opacity': 1.0,
      }});
      // The spacecraft themselves, lifted to their orbit.
      if (!map.getLayer('sat-3d')) {
        satLayerRef.current = createSatelliteLayer('sat-3d');
        map.addLayer(satLayerRef.current as any);
      }

      // Maritime — ports & naval bases — ocean teal
      map.addLayer({ id: 'maritime-glow', type: 'circle', source: 'maritime', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,6, 5,12, 10,20],
        'circle-color': ['match', ['get','type'], 'naval','#D32F2F', 'energy','#E65100', '#26C6DA'],
        'circle-opacity': 0.08, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'maritime-dots', type: 'circle', source: 'maritime', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,3, 5,5, 10,9],
        'circle-color': ['match', ['get','type'], 'naval','#D32F2F', 'energy','#E65100', '#26C6DA'],
        'circle-opacity': 0.8,
        'circle-stroke-width': 1.5, 'circle-stroke-color': ['match', ['get','type'], 'naval','#D32F2F', 'energy','#E65100', '#26C6DA'], 'circle-stroke-opacity': 0.35,
      }});
      map.addLayer({ id: 'maritime-label', type: 'symbol', source: 'maritime', minzoom: 4, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.8], 'text-max-width': 12, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#26C6DA', 'text-halo-color': '#000', 'text-halo-width': 1, 'text-opacity': 0.7 }});

      // Maritime chokepoints — amber threat spectrum
      map.addLayer({ id: 'choke-glow', type: 'circle', source: 'maritime-choke', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,10, 5,18, 10,28],
        'circle-color': '#E65100', 'circle-opacity': 0.1, 'circle-blur': 1,
      }});
      map.addLayer({ id: 'choke-dots', type: 'circle', source: 'maritime-choke', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,4, 5,7, 10,12],
        'circle-color': ['match', ['get','risk'], 'CRITICAL','#D32F2F', 'HIGH','#E65100', 'ELEVATED','#F9A825', '#26A69A'],
        'circle-opacity': 0.85,
        'circle-stroke-width': 1.5, 'circle-stroke-color': '#E65100', 'circle-stroke-opacity': 0.4,
      }});
      map.addLayer({ id: 'choke-label', type: 'symbol', source: 'maritime-choke', minzoom: 3, layout: {
        'text-field': ['get','name'], 'text-size': 10, 'text-font': ['Open Sans Bold'],
        'text-offset': [0, 2], 'text-max-width': 14, 'text-allow-overlap': false,
      }, paint: { 'text-color': '#E65100', 'text-halo-color': '#000', 'text-halo-width': 1, 'text-opacity': 0.9 }});

      // ══ MARINE SPILL — MSIS oil spill intelligence layer ══
      // Spill polygon
      map.addLayer({ id: 'msis-spill-fill', type: 'fill', source: 'marine-spill', filter: ['==', ['get', 'kind'], 'spill'], paint: {
        'fill-color': '#FF5722', 'fill-opacity': 0.35,
      }});
      map.addLayer({ id: 'msis-spill-line', type: 'line', source: 'marine-spill', filter: ['==', ['get', 'kind'], 'spill'], paint: {
        'line-color': '#FF5722', 'line-width': 2, 'line-dasharray': [3, 2],
      }});
      // Drift trajectory (hinterval/hindcast path)
      map.addLayer({ id: 'msis-drift', type: 'line', source: 'marine-spill', filter: ['==', ['get', 'kind'], 'drift'], paint: {
        'line-color': '#29B6F6', 'line-width': 2.5, 'line-dasharray': [4, 3], 'line-opacity': 0.9,
      }});
      // Origin uncertainty zone (dashed red circle)
      map.addLayer({ id: 'msis-origin', type: 'circle', source: 'marine-spill', filter: ['==', ['get', 'kind'], 'origin'], paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 5, 15, 8, 40, 11, 90, 14, 200],
        'circle-color': '#F44336', 'circle-opacity': 0.12,
        'circle-stroke-color': '#F44336', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.8,
      }});
      // Vessels of interest (priority-coded)
      map.addLayer({ id: 'msis-vessel', type: 'circle', source: 'marine-spill', filter: ['==', ['get', 'kind'], 'vessel'], paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 5, 6, 9, 9, 12, 12],
        'circle-color': ['match', ['get', 'priority'], 1, '#F44336', 2, '#FFB300', '#26C6DA'],
        'circle-opacity': 0.95,
        'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-opacity': 0.7,
      }});
      // Predicted drift path — solid gold, ahead of the blue hindcast.
      map.addLayer({ id: 'msis-forecast-line', type: 'line', source: 'marine-spill', filter: ['==', ['get', 'kind'], 'forecast'], paint: {
        'line-color': '#FFC107', 'line-width': 2.5, 'line-opacity': 0.95,
      }});
      // +6/+12/+24 horizon markers.
      map.addLayer({ id: 'msis-forecast-point', type: 'circle', source: 'marine-spill', filter: ['==', ['get', 'kind'], 'forecast-point'], paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 5, 7, 9, 10, 12, 13],
        'circle-color': '#FFC107', 'circle-opacity': 0.95,
        'circle-stroke-width': 2, 'circle-stroke-color': '#000000', 'circle-stroke-opacity': 0.7,
      }});
      map.addLayer({ id: 'msis-forecast-label', type: 'symbol', source: 'marine-spill', filter: ['==', ['get', 'kind'], 'forecast-point'], layout: {
        'text-field': ['concat', 'T+', ['to-string', ['get', 'hour']], 'H'],
        'text-size': 9, 'text-font': ['Open Sans Bold'], 'text-offset': [0, 1.8], 'text-allow-overlap': true,
      }, paint: { 'text-color': '#FFC107', 'text-halo-color': '#000000', 'text-halo-width': 1.5 }});
      // Selected horizon (driven by the spill-panel timeline), drawn from its
      // own source so setting it never fights the live event data.
      map.addLayer({ id: 'msis-forecast-selected', type: 'circle', source: 'msis-forecast-hl', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 5, 12, 9, 18, 12, 24],
        'circle-color': 'transparent', 'circle-opacity': 1,
        'circle-stroke-color': '#FFC107', 'circle-stroke-width': 3, 'circle-stroke-opacity': 0.95,
      }});

      // ══ SATELLITE MONITOR — MSIS live coverage overlay ══
      map.addLayer({ id: 'msis-satmon-footprint-fill', type: 'fill', source: 'msis-satmon', filter: ['==', '$type', 'Polygon'], paint: {
        'fill-color': '#00E5FF', 'fill-opacity': 0.1,
      }});
      map.addLayer({ id: 'msis-satmon-footprint-line', type: 'line', source: 'msis-satmon', filter: ['==', '$type', 'Polygon'], paint: {
        'line-color': '#00E5FF', 'line-width': 1, 'line-dasharray': [4, 3], 'line-opacity': 0.7,
      }});
      map.addLayer({ id: 'msis-satmon-track', type: 'line', source: 'msis-satmon', filter: ['==', '$type', 'LineString'], paint: {
        'line-color': '#D4AF37', 'line-width': 1.5, 'line-opacity': 0.8,
      }});
      map.addLayer({ id: 'msis-satmon-point', type: 'circle', source: 'msis-satmon', filter: ['==', '$type', 'Point'], paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 2, 5, 6, 7, 10, 9],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.95,
        'circle-stroke-width': 2, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-opacity': 0.9,
      }});

      // ══ MSIS CUSTOM AOI — the region satellite coverage & marine stats track ══
      map.addLayer({ id: 'msis-aoi-fill', type: 'fill', source: 'msis-aoi', filter: ['==', '$type', 'Polygon'], paint: {
        'fill-color': '#D4AF37', 'fill-opacity': 0.06,
      }});
      map.addLayer({ id: 'msis-aoi-line', type: 'line', source: 'msis-aoi', filter: ['==', '$type', 'Polygon'], paint: {
        'line-color': '#D4AF37', 'line-width': 1.5, 'line-dasharray': [5, 3], 'line-opacity': 0.9,
      }});
      map.addLayer({ id: 'msis-aoi-crossh', type: 'line', source: 'msis-aoi', filter: ['==', '$type', 'LineString'], paint: {
        'line-color': '#D4AF37', 'line-width': 1, 'line-opacity': 0.5,
      }});
      map.addLayer({ id: 'msis-aoi-center', type: 'circle', source: 'msis-aoi', filter: ['==', '$type', 'Point'], paint: {
        'circle-radius': 4, 'circle-color': '#D4AF37', 'circle-opacity': 1,
        'circle-stroke-width': 2, 'circle-stroke-color': '#000', 'circle-stroke-opacity': 0.7,
      }});

      // Maritime Ships (moving entities) — ocean teal family
      map.addLayer({ id: 'ship-dots', type: 'circle', source: 'maritime-ships', paint: {
        'circle-radius': ['interpolate',['linear'],['zoom'], 1,2, 5,4, 10,6],
        'circle-color': ['match', ['get','type'], 'military','#D32F2F', 'tanker','#E65100', 'cargo','#26C6DA', '#B0BEC5'],
        'circle-opacity': 0.75,
      }});
      map.addLayer({ id: 'ship-label', type: 'symbol', source: 'maritime-ships', minzoom: 5, layout: {
        'text-field': ['get','name'], 'text-size': 9, 'text-font': ['Open Sans Regular'],
        'text-offset': [0, 1.2], 'text-allow-overlap': false,
      }, paint: { 'text-color': ['match', ['get','type'], 'military','#D32F2F', 'tanker','#E65100', 'cargo','#26C6DA', '#B0BEC5'], 'text-halo-color': '#000', 'text-halo-width': 1 }});


      setMapReady(true);
      // Dev-only handle. The map is otherwise unreachable from the console,
      // which makes interaction bugs guesswork rather than diagnosis.
      if (process.env.NODE_ENV === 'development') (window as any).__msisMap = map;
    });

    // Events
    let lastMove = 0;
    map.on('mousemove', e => {
      const now = Date.now();
      if (now - lastMove > 100) {
        lastMove = now;
        onMouseCoords?.({ lat: e.lngLat.lat, lng: e.lngLat.lng });
      }
    });
    map.on('contextmenu', e => { e.preventDefault(); onRightClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }); });
    map.on('moveend', () => { const c = map.getCenter(); onViewStateChange?.({ zoom: map.getZoom(), latitude: c.lat }); });

    // ── POPUP HELPER ──
    const popup = (coords: any, html: string) => {
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, maxWidth: '420px', offset: 14 }).setLngLat(coords).setHTML(html).addTo(map);
    };
    const pStyle = `background:rgba(12,14,26,0.95);backdrop-filter:blur(16px);border-radius:10px;padding:16px;font-family:'JetBrains Mono',monospace;`;
    const linkStyle = `display:inline-block;margin-top:8px;padding:5px 12px;font-size:10px;letter-spacing:0.12em;text-decoration:none;border-radius:5px;font-family:'JetBrains Mono',monospace;`;

    // ── XSS PROTECTION HELPERS ──
    const htmlEsc = (s: any): string => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const idSafe = (s: any): string => String(s ?? '').replace(/[^a-zA-Z0-9_\.\-]/g, '');
    const urlSafe = (s: any): string => { const u = String(s ?? ''); return /^https?:\/\//i.test(u) ? u : '#'; };

    // ── Satellites (SatNOGS powered) ──
    // Layers with their own click handlers. The satellite pick defers to
    // these, and to nothing else — the basemap is not a click target.
    const CLICKABLE_LAYERS = new Set(CLICKABLE_LAYER_IDS);

    // Satellites are picked on the GPU: the pick pass runs the same vertex
    // shader as the visible one, so the target is always exactly where the
    // marker was drawn — including its altitude. A ground-projected hit test
    // would put the target under the satellite instead of on it.
    map.on('click', e => {
      const layer = satLayerRef.current;
      if (!layer) return;
      // Defer to any layer that has its own click handler, so a camera or an
      // aircraft under the cursor is not stolen by a satellite behind it.
      // Only those layers count: querying every feature matches the basemap
      // land and water fills at essentially any point on the globe, which
      // made this bail out every single time.
      const hits = map.queryRenderedFeatures(e.point);
      if (hits.some(f => f.layer?.id && CLICKABLE_LAYERS.has(f.layer.id))) return;
      const idx = layer.pick(e.point.x, e.point.y);
      const p = idx == null ? null : satRowsRef.current[idx];
      // Clicking past every satellite is how a selection is dismissed, so an
      // empty click has to clear the ring and the track rather than leave them
      // lit over nothing.
      if (idx == null || !p) { clearSat(); return; }

      // The readout is a panel, not a MapLibre popup: a popup can only anchor
      // to a ground coordinate, and these markers are drawn at altitude. Any
      // other layer's popup is still welcome to the screen, but not on top of
      // this selection.
      popupRef.current?.remove();
      layer.setOrbit(null);
      satPickedRef.current = idx;
      satSelectedIdRef.current = p.noradId ?? null;
      layer.setSelected(idx);
      setSelectedSat({ ...p, periodMinutes: null, track: p.noradId ? 'loading' : 'unavailable' });

      // Draw the selected satellite's orbit. Fetched per click rather than
      // bundled with the catalogue: that payload is already megabytes, and an
      // operator looks at one orbit at a time.
      if (p.noradId) {
        const wanted = p.noradId;
        // A slower reply for a satellite the operator has already moved on
        // from must not draw over the one they are looking at now.
        const stale = () => satSelectedIdRef.current !== wanted;
        const mark = (track: SatelliteDetail['track'], periodMinutes: number | null = null) =>
          setSelectedSat(prev => (prev && prev.noradId === wanted ? { ...prev, track, periodMinutes } : prev));
        const at = satEpochRef.current;
        fetch(`/api/satellites/orbit?id=${encodeURIComponent(wanted)}${at ? `&t=${at}` : ''}`)
          .then(r => (r.ok ? r.json() : null))
          .then(d => {
            if (stale()) return;
            if (!d?.segments?.length) { mark('unavailable'); return; }
            layer.setOrbit(
              d.segments.map((seg: number[][]) => seg.map(([lng, lat, altKm]) => ({ lng, lat, altKm }))),
              parseColor(satColorFor(p.category, p.color, paletteRef.current)),
            );
            mark('ready', typeof d.periodMinutes === 'number' ? d.periodMinutes : null);
          })
          // No track is fine; the satellite still shows — but the readout says so
          // rather than sitting on 'plotting' forever.
          .catch(() => { if (!stale()) mark('unavailable'); });
      }
    });

    // The cursor should say a satellite is clickable, like every other layer.
    // Throttled to one test per frame: mousemove fires far faster than the
    // screen updates, and each pick is a full offscreen re-render of the
    // whole catalogue — measured at 1-2 ms with ~19,000 satellites.
    let hoverQueued = false;
    map.on('mousemove', e => {
      const layer = satLayerRef.current;
      if (!layer || hoverQueued) return;
      hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        const canvas = map.getCanvas();
        // Never fight another layer that has already claimed the cursor.
        if (canvas.style.cursor && canvas.style.cursor !== 'pointer') return;
        const over = layer.pick(e.point.x, e.point.y) != null;
        if (over) canvas.style.cursor = 'pointer';
        else if (canvas.style.cursor === 'pointer') canvas.style.cursor = '';
      });
    });

    // ── Generic hover for clickables ──
    ['maritime-dots','choke-dots','ship-dots','msis-vessel','msis-satmon-point','msis-forecast-point','msis-aoi-fill','msis-aoi-line'].forEach(layer => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    });

    // ── MSIS Marine Spill: predicted drift horizon click ──
    map.on('click', 'msis-forecast-point', (e: any) => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      const coords = (e.features[0].geometry as any).coordinates;
      const opp = e.features[0].properties?.eventName ? ` — ${htmlEsc(p.eventName)}` : '';
      popup(coords, `<div style="${pStyle}border:1px solid rgba(255,193,7,0.45);">
        <div style="color:#FFC107;font-size:12px;font-weight:700;letter-spacing:0.1em;margin-bottom:4px;">⏳ PREDICTED POSITION — T+${p.hour}H${opp}</div>
        <div style="font-size:9px;color:#E8E6E0;margin-bottom:6px;">Drift forecast horizon for ${htmlEsc(p.eventId || 'this event')}.</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;background:rgba(0,0,0,0.35);padding:6px;border-radius:4px;">
          <div><span style="color:#5C5A54;">LAT</span><br/><span style="color:#FFC107;">${coords[1].toFixed(4)}°</span></div>
          <div><span style="color:#5C5A54;">LNG</span><br/><span style="color:#FFC107;">${coords[0].toFixed(4)}°</span></div>
        </div>
        <div style="font-size:8px;color:#5C5A54;margin-top:6px;">Use the PREDICT timeline in the spill panel to scrub horizons.</div>
      </div>`);
    });

    // ── MSIS Marine Spill: vessel of interest click ──
    map.on('click', 'msis-vessel', (e: any) => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      const coords = (e.features[0].geometry as any).coordinates;
      const pr = Number(p.priority) || 4;
      const col = pr === 1 ? '#F44336' : pr === 2 ? '#FFB300' : '#26C6DA';
      const scoreCol = Number(p.compositeScore) > 75 ? '#F44336' : Number(p.compositeScore) > 50 ? '#FFB300' : '#3FB950';
      popup(coords, `<div style="${pStyle}border:1px solid ${col}55;">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${col};display:inline-block;"></span>
          <span style="color:${col};font-size:12px;font-weight:700;text-transform:uppercase;">PRIORITY #${pr}</span>
        </div>
        <div style="color:#E8E6E0;font-size:12px;font-weight:bold;margin-bottom:2px;">🚢 ${htmlEsc(p.name)}</div>
        <div style="font-size:9px;color:#aaa;margin-bottom:8px;">${htmlEsc(p.type)} · MMSI ${htmlEsc(String(p.mmsi || '—'))}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;background:rgba(0,0,0,0.35);padding:8px;border-radius:4px;border:1px solid rgba(255,255,255,0.04);margin-bottom:8px;">
          <div><span style="color:#5C5A54;">COURSE</span><br/><span style="color:#00E5FF;">${p.course}°</span></div>
          <div><span style="color:#5C5A54;">SPEED</span><br/><span style="color:#00E5FF;">${p.speedKnots} kn</span></div>
          <div><span style="color:#5C5A54;">COMPOSITE</span><br/><span style="color:${scoreCol};font-weight:bold;">${p.compositeScore}</span></div>
          <div><span style="color:#5C5A54;">PROXIMITY</span><br/><span style="color:#E8E6E0;">${Math.round(Number(p.proximityScore)*100)}%</span></div>
        </div>
        <div style="font-size:8px;color:#5C5A54;letter-spacing:0.05em;">${htmlEsc(p.reason || '')}</div>
      </div>`);
    });

    // ── Maritime Ships ──
    map.on('click', 'ship-dots', e => {
      if (!e.features?.length) return;
      const p = e.features[0].properties as any;
      const coords = (e.features[0].geometry as any).coordinates;
      const color = p.type === 'military' ? '#FF1744' : p.type === 'tanker' ? '#FF9500' : '#00E5FF';
      const icon = p.type === 'military' ? '⚔️' : p.type === 'tanker' ? '🛢️' : '🚢';
      
      popup(coords, `<div style="${pStyle}border:1px solid ${color}60;box-shadow:inset 0 0 12px ${color}15;">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${color}40;padding-bottom:6px;margin-bottom:8px;">
          <div style="color:${color};font-size:12px;font-weight:700;letter-spacing:0.1em;">${icon} [ ${(p.type||'VESSEL').toUpperCase()} ]</div>
          <div style="color:#5C5A54;font-size:9px;">FLAG: ${p.flag||'UNK'}</div>
        </div>
        <div style="color:#E8E6E0;font-size:11px;font-weight:bold;margin-bottom:10px;">${p.name || 'UNIDENTIFIED VESSEL'}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:9px;margin-bottom:8px;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;">
          <div><span style="color:#5C5A54;">SPEED</span><br/><span style="color:${color};font-family:monospace;">${Number(p.speed).toFixed(1)} kn</span></div>
          <div><span style="color:#5C5A54;">HEADING</span><br/><span style="color:${color};font-family:monospace;">${Number(p.heading).toFixed(0)}°</span></div>
          <div><span style="color:#5C5A54;">LATITUDE</span><br/><span style="color:#E8E6E0;font-family:monospace;">${coords[1].toFixed(4)}°</span></div>
          <div><span style="color:#5C5A54;">LONGITUDE</span><br/><span style="color:#E8E6E0;font-family:monospace;">${coords[0].toFixed(4)}°</span></div>
        </div>
        <div><span style="color:#5C5A54;font-size:9px;">DESTINATION: </span><span style="color:#E8E6E0;font-size:9px;">${p.destination || 'UNKNOWN'}</span></div>
        <a href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:${p.mmsi}" target="_blank" style="${linkStyle}flex:1;text-align:center;color:${color};border:1px solid ${color}40;background:${color}15;display:inline-block;width:100%;box-sizing:border-box;margin-top:4px;">[ OPEN SOURCE ↗ ]</a>
      </div>`);
    });

    // ── Maritime Ports & Naval Bases ──
    map.on('click', 'maritime-dots', e => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      const coords = (e.features![0].geometry as any).coordinates;
      const typeColor = p.type === 'naval' ? '#FF3D3D' : p.type === 'energy' ? '#FF9500' : '#00BCD4';
      const typeLabel = p.type === 'naval' ? 'NAVAL BASE' : p.type === 'energy' ? 'ENERGY PORT' : 'CONTAINER PORT';
      
      const congestionHtml = p.congestion ? `
        <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.1);">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
            <div><span style="color:#5C5A54;font-size:9px;">CONGESTION</span><br/><span style="color:${p.congestion === 'SEVERE' ? '#FF1744' : p.congestion === 'CONGESTED' ? '#FF9500' : '#00E676'};font-weight:bold;font-size:10px;">${p.congestion}</span></div>
            <div><span style="color:#5C5A54;font-size:9px;">EST. DWELL TIME</span><br/><span style="color:#E8E6E0;font-weight:bold;font-size:10px;">${p.dwell_time || 'Unknown'}</span></div>
          </div>
        </div>` : '';

      popup(coords, `<div style="${pStyle}border:1px solid ${typeColor}40;">
        <div style="color:${typeColor};font-weight:bold;font-size:11px;margin-bottom:4px;">${p.name}</div>
        <div style="color:#999;font-size:9px;margin-bottom:6px;">${typeLabel} — ${p.country}</div>
        ${p.volume ? `<div style="font-size:9px;color:#aaa;">Volume: <span style="color:${typeColor};font-weight:bold;">${p.volume}</span></div>` : ''}
        ${p.fleet ? `<div style="font-size:9px;color:#aaa;">Fleet: <span style="color:${typeColor};font-weight:bold;">${p.fleet}</span></div>` : ''}
        ${p.rank ? `<div style="font-size:9px;color:#aaa;">Global Rank: <span style="color:${typeColor};font-weight:bold;">#${p.rank}</span></div>` : ''}
        ${congestionHtml}
      </div>`);
    });

    // ── Maritime Chokepoints ──
    map.on('click', 'choke-dots', e => {
      const p = e.features?.[0]?.properties;
      if (!p) return;
      const coords = (e.features![0].geometry as any).coordinates;
      const riskCol = p.risk === 'CRITICAL' ? '#FF1744' : p.risk === 'HIGH' ? '#FF9500' : p.risk === 'ELEVATED' ? '#FFD700' : '#00E676';
      popup(coords, `<div style="${pStyle}border:1px solid ${riskCol}40;">
        <div style="color:#FF9500;font-weight:bold;font-size:11px;margin-bottom:4px;">${p.name}</div>
        <div style="font-size:9px;color:#aaa;">Traffic: <span style="color:#fff;">${p.traffic}</span></div>
        <div style="font-size:9px;color:#aaa;">Risk: <span style="color:${riskCol};font-weight:bold;">${p.risk}</span></div>
      </div>`);
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Day/Night
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const update = () => {
      const src = map.getSource('day-night') as any;
      if (!src) return;
      if (!activeLayers.day_night) { src.setData(EMPTY_FC); return; }
      src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [computeSolarTerminator()] }, properties: {} }] });
    };
    update();
    const iv = setInterval(update, 300000); // 5 min (was 1 min — shadow barely moves)
    return () => clearInterval(iv);
  }, [mapReady, activeLayers.day_night]);

  // Helper to set GeoJSON
  const setGeo = useCallback((source: string, features: any[]) => {
    const src = mapRef.current?.getSource(source) as any;
    if (src) src.setData({ type: 'FeatureCollection', features });
  }, []);

  const setVis = useCallback((ids: string[], visible: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    ids.forEach(id => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'); });
  }, []);

  /**
   * Pull the palette out of the document whenever it can have changed.
   *
   * Two triggers, and they need different timing. The Style Studio writes the
   * properties and then dispatches, so reading straight away is correct. A
   * theme switch flips a class on <body> from an effect in the page component
   * — a parent, so it runs *after* this one — and reading now would return the
   * outgoing theme. The extra frame covers that case.
   */
  useEffect(() => {
    const read = () => {
      const cs = getComputedStyle(document.body);
      const next = readMapPalette(name => cs.getPropertyValue(name));
      setPalette(prev => (MAP_PALETTE_KEYS.every(k => prev[k] === next[k]) ? prev : next));
    };
    read();
    const raf = requestAnimationFrame(read);
    window.addEventListener(STYLE_EVENT, read);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener(STYLE_EVENT, read);
    };
  }, [theme]);

  // ── DECOUPLED LAYER RENDERERS (Performance Optimized) ──

  const toSatPoints = useCallback((rows: SatelliteRow[]): SatPoint[] => rows.map((s) => ({
    lng: s.lng,
    lat: s.lat,
    altKm: s.alt,
    color: parseColor(satColorFor(s.category, s.color, palette)),
    // Stations are the ones an operator is usually looking for, so they get
    // to be findable in a field of several hundred identical dots.
    size: s.category === 'science' || /ISS|TIANGONG/i.test(s.name || '') ? 2.2 : 1,
  })), [palette]);

  /**
   * Re-points the selection at the same satellite after a refresh.
   *
   * pick() returns an index into the last setPoints() array, and every poll
   * rebuilds that array — a filtered one changes length as well as order. Left
   * as a bare index the highlight ring quietly slides onto whichever satellite
   * now sits at that slot, taking the readout with it.
   */
  const resyncSatSelection = useCallback((rows: SatelliteRow[]) => {
    const id = satSelectedIdRef.current;
    if (!id) return;
    const i = rows.findIndex(r => r.noradId === id);
    // Filtered out, or gone from the catalogue: there is nothing to point at.
    if (i < 0) { clearSat(); return; }
    satPickedRef.current = i;
    satLayerRef.current?.setSelected(i);
    // The satellite has moved since it was clicked; the readout should say where
    // it is now, not where it was.
    setSelectedSat(prev => (prev ? { ...prev, lat: rows[i].lat, lng: rows[i].lng, alt: rows[i].alt } : prev));
  }, [clearSat]);

  useEffect(() => {
    if (!mapReady) return;
    const sats = data.satellites || [];
    const al = activeLayers as any;
    const at = Date.parse(data.satellites_at ?? '');
    satEpochRef.current = Number.isFinite(at) ? at : null;
    
    // If 'All Satellites' is on, show everything
    if (al.satellites) {
      setGeo('satellites', sats.map((s: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: { name: s.name, color: satColorFor(s.category, s.color, palette), mission: s.mission, alt: s.alt, noradId: s.noradId, category: s.category } })));
      satRowsRef.current = sats;
      satLayerRef.current?.setPoints(toSatPoints(sats));
      resyncSatSelection(sats);
      return;
    }
    
    // Otherwise filter by enabled sub-layers
    const enabledCategories: string[] = [];
    if (al.sat_comms) enabledCategories.push('comms');
    if (al.sat_military) enabledCategories.push('military');
    if (al.sat_navigation) enabledCategories.push('navigation');
    if (al.sat_earth) enabledCategories.push('earth_obs');
    if (al.sat_science) enabledCategories.push('science');
    
    if (enabledCategories.length === 0) {
      setGeo('satellites', []);
      satRowsRef.current = [];
      satLayerRef.current?.setPoints([]);
      clearSat();
      return;
    }
    
    const filtered = sats.filter((s: any) => enabledCategories.includes(s.category));
    setGeo('satellites', filtered.map((s: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: { name: s.name, color: satColorFor(s.category, s.color, palette), mission: s.mission, alt: s.alt, noradId: s.noradId, category: s.category } })));
    satRowsRef.current = filtered;
    satLayerRef.current?.setPoints(toSatPoints(filtered));
    resyncSatSelection(filtered);
  }, [mapReady, data.satellites, activeLayers.satellites, (activeLayers as any).sat_comms, (activeLayers as any).sat_military, (activeLayers as any).sat_navigation, (activeLayers as any).sat_earth, (activeLayers as any).sat_science, data.satellites_at, setGeo, toSatPoints, resyncSatSelection, clearSat]);

  useEffect(() => {
    if (!mapReady) return;
    setGeo('maritime', activeLayers.maritime && data.maritime_ports ? data.maritime_ports.map((p: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { name: p.name, country: p.country, type: p.type, volume: p.volume, fleet: p.fleet, rank: p.rank } })) : []);
    setGeo('maritime-choke', activeLayers.maritime && data.maritime_chokepoints ? data.maritime_chokepoints.map((c: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lng, c.lat] }, properties: { name: c.name, traffic: c.traffic, risk: c.risk } })) : []);
    setGeo('maritime-ships', activeLayers.maritime && data.maritime_ships ? data.maritime_ships.map((s: any) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: { name: s.name || s.mmsi?.toString(), type: s.type || 'cargo', speed: s.speed, heading: s.heading, destination: s.destination, flag: s.flag } })) : []);
  }, [mapReady, data.maritime_ports, data.maritime_chokepoints, data.maritime_ships, activeLayers.maritime, setGeo]);

  // MSIS Marine Spill — feed every spill event (archive + upload pipeline)
  useEffect(() => {
    if (!mapReady) return;
    if (!activeLayers.oil_spill) {
      setGeo('marine-spill', []);
      setGeo('msis-forecast-hl', []);
      return;
    }
    setGeo('marine-spill', spillEvents.flatMap(e => (marineSpillSource(e).features as any[])));
  }, [mapReady, activeLayers.oil_spill, spillEvents, setGeo]);

  // MSIS Marine Spill — forecast-horizon emphasis driven by the spill panel.
  useEffect(() => {
    if (!mapReady || !activeLayers.oil_spill || !forecastHighlight) {
      setGeo('msis-forecast-hl', []);
      return;
    }
    const { eventId, hour } = forecastHighlight;
    const features: any[] = [];
    for (const e of spillEvents) {
      if (e.id !== eventId) continue;
      for (let i = 0; i < e.forecastHours.length; i++) {
        if (e.forecastHours[i] === hour && e.forecastPositions[i]) {
          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: e.forecastPositions[i] },
            properties: { kind: 'forecast-point', eventId, hour },
          });
        }
      }
    }
    setGeo('msis-forecast-hl', features);
  }, [mapReady, activeLayers.oil_spill, spillEvents, forecastHighlight, setGeo]);

  // MSIS Satellite Monitor — footprint + pending ground track + sub-sat point
  useEffect(() => {
    if (!mapReady) return;
    const m = satMonitor;
    if (!m || !m.active) {
      setGeo('msis-satmon', []);
      setVis(['msis-satmon-footprint-fill', 'msis-satmon-footprint-line', 'msis-satmon-track', 'msis-satmon-point'], false);
      return;
    }
    const features: any[] = [];
    if (m.footprint) features.push(m.footprint);
    if (m.track) features.push(...m.track);
    if (m.sat) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [m.sat.lng, m.sat.lat] },
        properties: { name: m.sat.name, color: m.sat.color },
      });
    }
    setGeo('msis-satmon', features);
    setVis(['msis-satmon-footprint-fill', 'msis-satmon-footprint-line', 'msis-satmon-track', 'msis-satmon-point'], true);
  }, [mapReady, satMonitor, setGeo, setVis]);

  // MSIS Custom AOI — box + centre crosshair + centre marker.
  useEffect(() => {
    if (!mapReady) return;
    if (!aoiBox) {
      setGeo('msis-aoi', []);
      setVis(['msis-aoi-fill', 'msis-aoi-line', 'msis-aoi-crossh', 'msis-aoi-center'], false);
      return;
    }
    const { west, east, south, north } = aoiBox;
    const cLat = (south + north) / 2;
    const cLng = (west + east) / 2;
    // Crosshair sized to a tenth of the box, so the centre stays visible.
    const h = (north - south) / 10 || 0.1;
    const w = (east - west) / 10 || 0.1;
    setGeo('msis-aoi', [
      {
        type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
        properties: { kind: 'aoi' },
      },
      {
        type: 'Feature', geometry: { type: 'LineString', coordinates: [[cLng - w, cLat], [cLng + w, cLat]] },
        properties: { kind: 'crossh' },
      },
      {
        type: 'Feature', geometry: { type: 'LineString', coordinates: [[cLng, cLat - h], [cLng, cLat + h]] },
        properties: { kind: 'crossh' },
      },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [cLng, cLat] }, properties: { kind: 'center' } },
    ]);
    setVis(['msis-aoi-fill', 'msis-aoi-line', 'msis-aoi-crossh', 'msis-aoi-center'], true);
  }, [mapReady, aoiBox, setGeo, setVis]);

  // Visibility
  useEffect(() => {
    if (!mapReady) return;
    const anySat = activeLayers.satellites || (activeLayers as any).sat_comms || (activeLayers as any).sat_military || (activeLayers as any).sat_navigation || (activeLayers as any).sat_earth || (activeLayers as any).sat_science;
    // The circle layers stay hidden whatever the toggles say — the 3D layer
    // is the single representation, and showing both drew every satellite
    // twice, once flat on the ground and once at altitude.
    setVis(['sat-glow','sat-dots'], false);
    // Clearing the 3D layer is what actually turns satellites off.
    if (!anySat) { satRowsRef.current = []; satLayerRef.current?.setPoints([]); }
    setVis(['day-night-fill'], activeLayers.day_night);
    setVis(['maritime-glow','maritime-dots','maritime-label'], activeLayers.maritime);
    setVis(['choke-glow','choke-dots','choke-label'], activeLayers.maritime);
    setVis(['ship-dots','ship-label'], activeLayers.maritime);
    setVis(['msis-spill-fill','msis-spill-line','msis-drift','msis-origin','msis-vessel'], (activeLayers as any).oil_spill);
  }, [mapReady, activeLayers, setVis]);

  // Fly-to
  useEffect(() => {
    if (!mapReady || !mapRef.current || !flyToLocation) return;
    mapRef.current.flyTo({ center: [flyToLocation.lng, flyToLocation.lat], zoom: flyToLocation.zoom || 8, duration: 2000 });
  }, [mapReady, flyToLocation]);

  // Dynamic projection switching (lightweight — no terrain DEM)
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    try {
      (map as any).setProjection({ type: projection });
      if (projection === 'globe') {
        map.easeTo({ pitch: 20, duration: 1200 });
        try {
          (map as any).setSky({
            'sky-color': '#04040A',
            'sky-horizon-blend': 0.5,
            'horizon-color': '#0a0a1a',
            'horizon-fog-blend': 0.3,
            'fog-color': '#04040A',
            'fog-ground-blend': 0.9,
          });
        } catch (e) { console.warn('[MSIS] Suppressed error:', e instanceof Error ? e.message : e); }
      } else {
        map.easeTo({ pitch: 0, duration: 800 });
      }
    } catch (e) {
      console.warn('Projection switch failed:', e);
    }
  }, [mapReady, projection]);

  // 3D Terrain & Buildings layer
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const enabled = activeLayers.terrain_3d;

    try {
      if (enabled) {
        // ── 3D BUILDINGS SOURCE (OpenFreeMap CDN — no API key, globally cached) ──
        if (!map.getSource('msis-buildings')) {
          map.addSource('msis-buildings', {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet',
          });
        }

        // ── 3D BUILDING EXTRUSION LAYER ──
        if (!map.getLayer('msis-3d-buildings')) {
          map.addLayer({
            id: 'msis-3d-buildings',
            source: 'msis-buildings',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 14.5,
            paint: {
              'fill-extrusion-color': [
                'interpolate', ['linear'], ['get', 'render_height'],
                0, '#1a1a2e',
                20, '#16213e',
                50, '#0f3460',
                120, '#533483',
                300, '#e94560',
              ],
              'fill-extrusion-height': [
                'interpolate', ['linear'], ['zoom'],
                14.5, 0,
                15.5, ['get', 'render_height']
              ],
              'fill-extrusion-base': [
                'interpolate', ['linear'], ['zoom'],
                14.5, 0,
                15.5, ['get', 'render_min_height']
              ],
              'fill-extrusion-opacity': [
                'interpolate', ['linear'], ['zoom'],
                14.5, 0,
                15, 0.7,
              ],
            },
          });
        }

        // Pitch the camera to reveal the 3D skyline
        if (map.getPitch() < 40) {
          map.easeTo({ pitch: 50, duration: 1200 });
        }

      } else {
        // ── DISABLE 3D ──
        if (map.getLayer('msis-3d-buildings')) map.removeLayer('msis-3d-buildings');
      }
    } catch (e) {
      console.warn('[MSIS] 3D terrain toggle error:', e);
    }
  }, [mapReady, activeLayers.terrain_3d]);

  // Satellite / Dark style switching
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    if (mapStyle === prevStyleRef.current) return;
    prevStyleRef.current = mapStyle;
    const map = mapRef.current;

    try {
      if (mapStyle !== 'dark') {
        // Add satellite raster tiles
        if (!map.getSource('satellite-tiles')) {
          map.addSource('satellite-tiles', {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 18,
          });
          map.addLayer({ id: 'satellite-layer', type: 'raster', source: 'satellite-tiles', paint: { 'raster-opacity': 0.85 } }, 'day-night-fill');
        } else {
          map.setLayoutProperty('satellite-layer', 'visibility', 'visible');
        }
      } else {
        if (map.getLayer('satellite-layer')) {
          map.setLayoutProperty('satellite-layer', 'visibility', 'none');
        }
      }
    } catch (e) {
      console.warn('Style switch failed:', e);
    }
  }, [mapReady, mapStyle]);

  // ── DRAWN POLYGONS ──
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const currentPolygons = drawnPolygons || [];
    const currentIds = currentPolygons.map(p => p.id);
    
    prevDrawnPolygonsRef.current.forEach(id => {
      if (!currentIds.includes(id)) {
        if (map.getLayer(`drawn-polygon-label-${id}`)) map.removeLayer(`drawn-polygon-label-${id}`);
        if (map.getLayer(`drawn-polygon-line-${id}`)) map.removeLayer(`drawn-polygon-line-${id}`);
        if (map.getLayer(`drawn-polygon-fill-${id}`)) map.removeLayer(`drawn-polygon-fill-${id}`);
        if (map.getSource(`drawn-polygon-${id}-label`)) map.removeSource(`drawn-polygon-${id}-label`);
        if (map.getSource(`drawn-polygon-${id}`)) map.removeSource(`drawn-polygon-${id}`);
      }
    });
    prevDrawnPolygonsRef.current = currentIds;

    currentPolygons.forEach(poly => {
      const sourceId = `drawn-polygon-${poly.id}`;
      const fillLayerId = `drawn-polygon-fill-${poly.id}`;
      const lineLayerId = `drawn-polygon-line-${poly.id}`;
      const labelLayerId = `drawn-polygon-label-${poly.id}`;

      // Build a centroid point feature for the label. A Polygon nests its ring
      // one level deeper than a LineString, so the label of a path would sit at
      // 0,0 if both were read the same way.
      const geom: any = poly.geojson.geometry;
      const ring: number[][] = geom?.type === 'LineString' ? (geom.coordinates || []) : (geom?.coordinates?.[0] || []);
      const centroid = ring.length > 0 ? [
        ring.reduce((s: number, c: number[]) => s + c[0], 0) / ring.length,
        ring.reduce((s: number, c: number[]) => s + c[1], 0) / ring.length,
      ] : [0, 0];
      const labelFC = { type: 'FeatureCollection' as const, features: [{ type: 'Feature' as const, properties: { name: poly.name }, geometry: { type: 'Point' as const, coordinates: centroid } }] };

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: poly.geojson });
      } else {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(poly.geojson);
      }
      if (!map.getSource(`${sourceId}-label`)) {
        map.addSource(`${sourceId}-label`, { type: 'geojson', data: labelFC as any });
      } else {
        (map.getSource(`${sourceId}-label`) as maplibregl.GeoJSONSource).setData(labelFC as any);
      }

      if (!map.getLayer(fillLayerId)) {
        map.addLayer({ id: fillLayerId, type: 'fill', source: sourceId, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': poly.color, 'fill-opacity': 0.12 } });
      }
      if (!map.getLayer(lineLayerId)) {
        map.addLayer({ id: lineLayerId, type: 'line', source: sourceId, paint: { 'line-color': poly.color, 'line-width': 2.5, 'line-dasharray': [6, 3] } });
      }
      if (!map.getLayer(labelLayerId)) {
        map.addLayer({ id: labelLayerId, type: 'symbol', source: `${sourceId}-label`, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-allow-overlap': true, 'text-ignore-placement': true }, paint: { 'text-color': poly.color, 'text-halo-color': '#000000', 'text-halo-width': 2 } });
      }
    });
  }, [mapReady, drawnPolygons]);

  // ── DIRECTIONS ROUTE ──
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const SRC = 'directions-route';
    const SRC_ALT = 'directions-alternates';
    const SRC_ACTIVE = 'directions-active-step';
    const SRC_ENDS = 'directions-endpoints';
    const IDS = [
      'directions-alt-line', 'directions-line-casing', 'directions-line',
      'directions-active-line', 'directions-endpoint-halo', 'directions-endpoint',
    ];

    const teardown = () => {
      IDS.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
      [SRC, SRC_ALT, SRC_ACTIVE, SRC_ENDS].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
    };

    if (!route?.geometry?.coordinates?.length) { teardown(); return; }

    const fc = (features: GeoJSON.Feature[]) => ({ type: 'FeatureCollection' as const, features });
    const line = (coords: [number, number][]): GeoJSON.Feature => ({
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    });
    const setData = (id: string, data: unknown) => {
      if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: data as never });
      else (map.getSource(id) as maplibregl.GeoJSONSource).setData(data as never);
    };

    setData(SRC, fc([line(route.geometry.coordinates)]));
    setData(SRC_ALT, fc((route.alternates || []).map(a => line(a.coordinates))));
    setData(SRC_ACTIVE, fc(route.activeSegment?.length ? [line(route.activeSegment)] : []));
    setData(SRC_ENDS, fc([
      { type: 'Feature', properties: { kind: 'origin' }, geometry: { type: 'Point', coordinates: [route.from.lng, route.from.lat] } },
      { type: 'Feature', properties: { kind: 'destination' }, geometry: { type: 'Point', coordinates: [route.to.lng, route.to.lat] } },
    ]));

    // Alternatives sit underneath, muted, so the chosen line stays unambiguous.
    if (!map.getLayer('directions-alt-line')) {
      map.addLayer({
        id: 'directions-alt-line', type: 'line', source: SRC_ALT,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#5C6470',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 14, 5],
          'line-opacity': 0.55,
        },
      });
    }
    if (!map.getLayer('directions-line-casing')) {
      map.addLayer({
        id: 'directions-line-casing', type: 'line', source: SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#001014', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 5, 14, 11], 'line-opacity': 0.9 },
      });
    }
    if (!map.getLayer('directions-line')) {
      map.addLayer({
        id: 'directions-line', type: 'line', source: SRC,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#00E5FF',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 14, 6],
          'line-opacity': 0.95,
        },
      });
    }
    if (!map.getLayer('directions-active-line')) {
      map.addLayer({
        id: 'directions-active-line', type: 'line', source: SRC_ACTIVE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#D4AF37',
          'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4, 14, 9],
          'line-opacity': 0.95,
        },
      });
    }
    if (!map.getLayer('directions-endpoint-halo')) {
      map.addLayer({
        id: 'directions-endpoint-halo', type: 'circle', source: SRC_ENDS,
        paint: {
          'circle-radius': 9,
          'circle-color': ['match', ['get', 'kind'], 'origin', '#00FF88', '#FF3B30'],
          'circle-opacity': 0.18,
        },
      });
    }
    if (!map.getLayer('directions-endpoint')) {
      map.addLayer({
        id: 'directions-endpoint', type: 'circle', source: SRC_ENDS,
        paint: {
          'circle-radius': 5,
          'circle-color': ['match', ['get', 'kind'], 'origin', '#00FF88', '#FF3B30'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#001014',
        },
      });
    }
  }, [mapReady, route]);

  // ── ROUTE FRAMING ──
  // Kept apart from drawing so picking a step or an alternative redraws without
  // yanking the camera back out to the whole route.
  const routeFrameKey = route
    ? `${route.from.lat},${route.from.lng},${route.to.lat},${route.to.lng},${route.geometry.coordinates.length}`
    : null;
  useEffect(() => {
    if (!mapReady || !mapRef.current || !route?.geometry?.coordinates?.length) return;
    const coords = route.geometry.coordinates;
    let [west, south, east, north] = [coords[0][0], coords[0][1], coords[0][0], coords[0][1]];
    for (const [lng, lat] of coords) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
    mapRef.current.fitBounds([[west, south], [east, north]], { padding: 90, duration: 900, maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, routeFrameKey]);

  // ── LIVE USER LOCATION ──
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const SRC = 'user-location';
    const SRC_ACC = 'user-location-accuracy';
    const IDS = ['user-accuracy-fill', 'user-accuracy-line', 'user-dot-pulse', 'user-dot', 'user-dot-core'];

    if (!userLocation) {
      IDS.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
      [SRC, SRC_ACC].forEach(id => { if (map.getSource(id)) map.removeSource(id); });
      return;
    }

    const { lat, lng, accuracy } = userLocation;

    // Accuracy is a real-world radius, so it must be a polygon in degrees
    // rather than a fixed pixel circle — it has to shrink as you zoom out.
    const ring: [number, number][] = [];
    const r = Math.min(Math.max(accuracy ?? 0, 0), 5000);
    if (r > 0) {
      const dLat = r / 111320;
      const dLng = r / (111320 * Math.cos((lat * Math.PI) / 180) || 1);
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * 2 * Math.PI;
        ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
      }
    }

    const point = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } }],
    };
    const accFc = {
      type: 'FeatureCollection',
      features: ring.length
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }]
        : [],
    };

    if (!map.getSource(SRC)) map.addSource(SRC, { type: 'geojson', data: point as never });
    else (map.getSource(SRC) as maplibregl.GeoJSONSource).setData(point as never);
    if (!map.getSource(SRC_ACC)) map.addSource(SRC_ACC, { type: 'geojson', data: accFc as never });
    else (map.getSource(SRC_ACC) as maplibregl.GeoJSONSource).setData(accFc as never);

    if (!map.getLayer('user-accuracy-fill')) {
      map.addLayer({ id: 'user-accuracy-fill', type: 'fill', source: SRC_ACC, paint: { 'fill-color': '#4285F4', 'fill-opacity': 0.12 } });
    }
    if (!map.getLayer('user-accuracy-line')) {
      map.addLayer({ id: 'user-accuracy-line', type: 'line', source: SRC_ACC, paint: { 'line-color': '#4285F4', 'line-width': 1, 'line-opacity': 0.35 } });
    }
    if (!map.getLayer('user-dot-pulse')) {
      map.addLayer({ id: 'user-dot-pulse', type: 'circle', source: SRC, paint: { 'circle-radius': 8, 'circle-color': '#4285F4', 'circle-opacity': 0.35 } });
    }
    if (!map.getLayer('user-dot')) {
      map.addLayer({ id: 'user-dot', type: 'circle', source: SRC, paint: { 'circle-radius': 7, 'circle-color': '#FFFFFF' } });
    }
    if (!map.getLayer('user-dot-core')) {
      map.addLayer({ id: 'user-dot-core', type: 'circle', source: SRC, paint: { 'circle-radius': 5, 'circle-color': '#4285F4' } });
    }
  }, [mapReady, userLocation]);

  // Pulse the halo. rAF-driven, so it stops when the tab is backgrounded.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !userLocation) return;
    const map = mapRef.current;
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      if (map.getLayer('user-dot-pulse')) {
        const t = ((now - started) % 2000) / 2000;
        map.setPaintProperty('user-dot-pulse', 'circle-radius', 8 + t * 22);
        map.setPaintProperty('user-dot-pulse', 'circle-opacity', 0.35 * (1 - t));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mapReady, userLocation]);

  // ── FOLLOW MODE ──
  useEffect(() => {
    if (!mapReady || !mapRef.current || !followUser) return;
    const map = mapRef.current;
    // originalEvent is only set when a real input device drove the change, so
    // the easeTo below cannot trip this and cancel its own follow.
    const onGesture = (e: any) => { if (e?.originalEvent) onFollowInterrupt?.(); };
    map.on('dragstart', onGesture);
    map.on('zoomstart', onGesture);
    map.on('rotatestart', onGesture);
    map.on('pitchstart', onGesture);
    return () => {
      map.off('dragstart', onGesture);
      map.off('zoomstart', onGesture);
      map.off('rotatestart', onGesture);
      map.off('pitchstart', onGesture);
    };
  }, [mapReady, followUser, onFollowInterrupt]);

  // Recentering runs on every position fix, so without the handover above the
  // map fights the operator: zoom out to look ahead and the next GPS tick drags
  // the camera back to 16.5. Follow itself is unchanged and resumes on recenter.
  useEffect(() => {
    if (!mapReady || !mapRef.current || !followUser || !userLocation) return;
    // While navigating, sit close in and rotate the map so travel direction is
    // "up" — reading a turn off a north-locked map at speed does not work.
    mapRef.current.easeTo({
      center: [userLocation.lng, userLocation.lat],
      ...(navigating
        ? {
            zoom: Math.max(mapRef.current.getZoom(), 16.5),
            pitch: 50,
            ...(typeof userLocation.heading === 'number' && !Number.isNaN(userLocation.heading)
              ? { bearing: userLocation.heading }
              : {}),
          }
        : {}),
      duration: 700,
    });
  }, [mapReady, followUser, userLocation, navigating]);

  // Restore a plain north-up view when guidance ends.
  useEffect(() => {
    if (!mapReady || !mapRef.current || navigating) return;
    mapRef.current.easeTo({ pitch: 0, bearing: 0, duration: 600 });
  }, [mapReady, navigating]);

  // ── ARCGIS LAYERS ──
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const currentLayers = arcgisLayers || [];
    const currentIds = currentLayers.map(l => l.id);

    prevArcgisLayersRef.current.forEach(id => {
      if (!currentIds.includes(id)) {
        const sourceId = `arcgis-${id}`;
        if (map.getLayer(`${sourceId}-fill`)) map.removeLayer(`${sourceId}-fill`);
        if (map.getLayer(`${sourceId}-line`)) map.removeLayer(`${sourceId}-line`);
        if (map.getLayer(`${sourceId}-circle`)) map.removeLayer(`${sourceId}-circle`);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      }
    });
    prevArcgisLayersRef.current = currentIds;

    currentLayers.forEach(layer => {
      const sourceId = `arcgis-${layer.id}`;
      const c = layer.color || '#D4AF37';
      const o = layer.opacity ?? 0.8;
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, { type: 'geojson', data: layer.geojson });
        // A fill layer with no geometry filter is applied to LineStrings too,
        // and maplibre fills an open path by closing it — which is what draws
        // the triangular wedges across a pipeline or railway dataset. Fill is
        // only ever meaningful for polygons.
        map.addLayer({ id: `${sourceId}-fill`, type: 'fill', source: sourceId, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': c, 'fill-opacity': o * 0.15, 'fill-outline-color': c } });
        map.addLayer({ id: `${sourceId}-line`, type: 'line', source: sourceId, filter: ['match', ['geometry-type'], ['LineString', 'Polygon'], true, false], paint: { 'line-color': c, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 10, 1.4, 14, 2, 18, 3], 'line-opacity': o } });
        // A fixed radius does not survive a dense dataset: ~1.2k points at
        // city zoom merge into one blob. Scaling with zoom keeps them as
        // discrete stations when you are far out, and readable up close.
        map.addLayer({ id: `${sourceId}-circle`, type: 'circle', source: sourceId, filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': c, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.5, 8, 2.5, 11, 4, 14, 6, 18, 9], 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 14, 1.2], 'circle-stroke-color': '#000', 'circle-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.55, 12, 0.85] } });
      } else {
        (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(layer.geojson);
        // Update paint properties for color/opacity changes
        if (map.getLayer(`${sourceId}-fill`)) {
          map.setPaintProperty(`${sourceId}-fill`, 'fill-color', c);
          map.setPaintProperty(`${sourceId}-fill`, 'fill-opacity', o * 0.15);
          map.setPaintProperty(`${sourceId}-fill`, 'fill-outline-color', c);
        }
        if (map.getLayer(`${sourceId}-line`)) {
          map.setPaintProperty(`${sourceId}-line`, 'line-color', c);
          map.setPaintProperty(`${sourceId}-line`, 'line-opacity', o);
        }
        if (map.getLayer(`${sourceId}-circle`)) {
          map.setPaintProperty(`${sourceId}-circle`, 'circle-color', c);
          map.setPaintProperty(`${sourceId}-circle`, 'circle-opacity', o);
        }
      }
    });
  }, [mapReady, arcgisLayers]);

  const drawCbRef = useRef({ onDrawComplete, onDrawProgress, onDrawCancel });
  /** Set by the drawing effect so on-screen buttons can dispatch into it. */
  const drawApplyRef = useRef<((a: DrawAction) => void) | null>(null);
  drawCbRef.current = { onDrawComplete, onDrawProgress, onDrawCancel };

  // ── DRAWING MODE ──
  // A four-mode state machine over one set of map handlers.
  //
  // Every mode collects points; what differs is how many are needed and what
  // geometry they produce. Rectangle and circle are two-click shapes, so the
  // cursor stands in for their second point until it is committed — which is
  // what makes the preview and the final shape come from the same code path
  // instead of two that can disagree.
  //
  // Escape cancels, Backspace removes the last vertex, Enter or a double click
  // finishes. Drawing without an undo is the difference between a tool and a
  // demo: a misplaced vertex twenty clicks in should not cost the whole shape.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const SRC = 'draw-temp-source';
    const IDS = ['draw-fill-temp', 'draw-line-temp', 'draw-points-temp'];

    const teardown = () => {
      IDS.forEach(id => { if (map.getLayer(id)) map.removeLayer(id); });
      if (map.getSource(SRC)) map.removeSource(SRC);
      drawingCoordsRef.current = [];
      map.getCanvas().style.cursor = '';
      map.doubleClickZoom.enable();
    };

    if (!drawMode) {
      teardown();
      drawCbRef.current.onDrawProgress?.(null);
      return;
    }

    map.doubleClickZoom.disable();
    map.getCanvas().style.cursor = 'crosshair';
    drawingCoordsRef.current = [];

    if (!map.getSource(SRC)) {
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'draw-fill-temp', type: 'fill', source: SRC,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#00E5FF', 'fill-opacity': 0.12 },
      });
      map.addLayer({
        id: 'draw-line-temp', type: 'line', source: SRC,
        filter: ['match', ['geometry-type'], ['LineString', 'Polygon'], true, false],
        paint: { 'line-color': '#00E5FF', 'line-width': 2, 'line-dasharray': [3, 2] },
      });
      map.addLayer({
        id: 'draw-points-temp', type: 'circle', source: SRC,
        filter: ['==', ['geometry-type'], 'MultiPoint'],
        paint: { 'circle-color': '#00E5FF', 'circle-radius': 4, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#04040A' },
      });
    }

    // Declared before paint(), which closes over it. Leaving it below would
    // work only while no call happens in between — a temporal-dead-zone crash
    // waiting for someone to add one.
    let state: DrawState = initialDrawState(drawMode);

    /** Redraw the preview from committed points plus an optional cursor point. */
    const paint = (cursor?: [number, number]) => {
      const committed = state.points;
      const pts = cursor ? [...committed, cursor] : committed;
      const src = map.getSource(SRC) as maplibregl.GeoJSONSource;
      if (!src) return;

      drawCbRef.current.onDrawProgress?.(pts.length ? measure(drawMode, pts) : null);

      if (pts.length === 0) {
        src.setData({ type: 'FeatureCollection', features: [] });
        return;
      }

      const features: any[] = [
        { type: 'Feature', properties: {}, geometry: { type: 'MultiPoint', coordinates: committed } },
      ];

      const geom = buildGeometry(drawMode, pts);
      if (drawMode === 'line') {
        if (pts.length > 1) {
          features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geom } });
        }
      } else if (geom.length >= 3) {
        // Show the enclosed area as it will be, not just its outline.
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [closeRing(geom)] } });
      } else if (geom.length === 2) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geom } });
      }

      src.setData({ type: 'FeatureCollection', features });
    };

    // The interaction lives in drawReducer, which is unit tested. This is the
    // adapter: map events in, reducer out, preview repainted.
    const apply = (action: DrawAction) => {
      const t = drawReducer(state, action);
      state = t.state;
      drawingCoordsRef.current = state.points;
      if (t.result) drawCbRef.current.onDrawComplete?.(t.result);
      if (t.cancelled) drawCbRef.current.onDrawCancel?.();
      paint();
    };

    let dblGuard = false;

    const onClick = (e: any) => {
      if (dblGuard) return;
      apply({ type: 'click', at: [e.lngLat.lng, e.lngLat.lat] });
    };

    const onMove = (e: any) => {
      if (state.points.length === 0) return;
      paint([e.lngLat.lng, e.lngLat.lat]);
    };

    const onDblClick = (e: any) => {
      e.preventDefault();
      dblGuard = true;
      setTimeout(() => { dblGuard = false; }, 300);
      apply({ type: 'dblclick' });
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { ev.preventDefault(); apply({ type: 'cancel' }); }
      else if (ev.key === 'Backspace' || ev.key === 'Delete') { ev.preventDefault(); apply({ type: 'undo' }); }
      else if (ev.key === 'Enter') { ev.preventDefault(); apply({ type: 'finish' }); }
    };
    drawApplyRef.current = apply;

    map.on('click', onClick);
    map.on('mousemove', onMove);
    map.on('dblclick', onDblClick);
    window.addEventListener('keydown', onKey);

    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMove);
      map.off('dblclick', onDblClick);
      window.removeEventListener('keydown', onKey);
      drawApplyRef.current = null;
      teardown();
    };
  }, [mapReady, drawMode]);

  // Buttons dispatch into the same reducer the map events use, so a shape
  // finished by clicking "Finish" is identical to one finished by Enter.
  const lastCmdSeq = useRef(-1);
  useEffect(() => {
    if (!drawCommand || drawCommand.seq === lastCmdSeq.current) return;
    lastCmdSeq.current = drawCommand.seq;
    drawApplyRef.current?.({ type: drawCommand.action } as DrawAction);
  }, [drawCommand]);

  // ── MAP CENTER REPORTING ──
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;

    const reportCenter = () => {
      const c = map.getCenter();
      const b = map.getBounds();
      onMapCenter?.({
        lat: c.lat,
        lng: c.lng,
        bounds: b ? { west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() } : undefined,
      });
    };

    // Fire immediately so panels get initial coordinates
    reportCenter();

    map.on('moveend', reportCenter);
    return () => { map.off('moveend', reportCenter); };
  }, [mapReady, onMapCenter]);

  // ── GROUND CLICKS (MSIS custom-AOI picker) ──
  // Fires only for clicks nothing the app paints claimed, so picking an AOI by
  // clicking a vessel or a satellite marker is never mistaken for a bare spot.
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const map = mapRef.current;
    const onGround = (e: maplibregl.MapMouseEvent) => {
      if (drawMode) return;
      if (!onClickGround) return;
      const hits = map.queryRenderedFeatures(e.point);
      const overClickable = hits.some((f: any) => f?.layer?.id && CLICKABLE_LAYER_IDS.includes(f.layer.id));
      if (overClickable) return;
      onClickGround({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    };
    map.on('click', onGround);
    return () => { map.off('click', onGround); };
  }, [mapReady, onClickGround, drawMode]);

  // Escape clears the selection, the way it cancels a draw — an overlay that
  // can only be dismissed by hitting a 14px target is one that stays open.
  useEffect(() => {
    if (!selectedSat) return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') clearSat(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedSat, clearSat]);

  return (
    <>
      <div ref={containerRef} className="absolute inset-0 w-full h-full" />
      {selectedSat && <SatelliteCard sat={selectedSat} onClose={clearSat} />}
      {mapReady && <MapControls mapRef={mapRef} onInteract={onFollowInterrupt} side={mapControlsPosition} />}
    </>
  );
}

export default memo(MsisMap);
