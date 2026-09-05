"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Coordinates = { lat: number; lng: number };
type SelectionGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] };
type SelectionMode = "point" | "rectangle" | "polygon";
type Index = "rgb" | "ndvi" | "ndwi" | "ndbi";
type BaseMapMode = "satellite" | "street";
type EvidenceBounds = [[number, number], [number, number], [number, number], [number, number]];
type SearchResult = { display_name: string; lat: string; lon: string };

type SatelliteMapProps = {
  onCoordinatesChange?: (coordinates: Coordinates) => void;
  onSelectionChange?: (selection: SelectionGeometry) => void;
  evidenceUrl?: string | null;
  evidenceBounds?: EvidenceBounds | null;
  evidenceIndex?: Exclude<Index, "rgb">;
  changeHeatmapUrl?: string | null;
  changeHeatmapBounds?: EvidenceBounds | null;
};

type MapHelpers = maplibregl.Map & {
  __satqueryFinishPolygon?: () => void;
  __satqueryClearSelection?: () => void;
  __satqueryGoToLocation?: (lng: number, lat: number) => void;
};

const SELECTION_SOURCE = "satquery-selection";
const SELECTION_FILL = "satquery-selection-fill";
const SELECTION_LINE = "satquery-selection-line";
const SELECTION_POINTS = "satquery-selection-points";
const SPECTRAL_SOURCE = "satquery-spectral-layer";
const SPECTRAL_LAYER = "satquery-spectral-layer-raster";
const BASEMAP_LAYER = "satquery-base-map";
const LABELS_LAYER = "satquery-english-labels";

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-cyan-400" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>;
}

function makePointBounds(lng: number, lat: number): EvidenceBounds {
  const size = 0.0025;
  return [[lng - size, lat + size], [lng + size, lat + size], [lng + size, lat - size], [lng - size, lat - size]];
}

function boundsFromSelection(selection: SelectionGeometry | null): EvidenceBounds | null {
  if (!selection) return null;
  if (selection.type === "Point") return makePointBounds(selection.coordinates[0], selection.coordinates[1]);
  const ring = selection.coordinates[0] ?? [];
  if (ring.length < 3) return null;
  const lngs = ring.map(([lng]) => lng);
  const lats = ring.map(([, lat]) => lat);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs), minLat = Math.min(...lats), maxLat = Math.max(...lats);
  return [[minLng, maxLat], [maxLng, maxLat], [maxLng, minLat], [minLng, minLat]];
}

export default function SatelliteMap({ onCoordinatesChange, onSelectionChange, evidenceUrl, evidenceBounds, evidenceIndex = "ndvi", changeHeatmapUrl, changeHeatmapBounds }: SatelliteMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapLoadedRef = useRef(false);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const modeRef = useRef<SelectionMode>("point");
  const rectangleStartRef = useRef<[number, number] | null>(null);
  const polygonPointsRef = useRef<[number, number][]>([]);
  const onCoordinatesChangeRef = useRef(onCoordinatesChange);
  const onSelectionChangeRef = useRef(onSelectionChange);

  const [selectionMode, setSelectionMode] = useState<SelectionMode>("point");
  const [baseMapMode, setBaseMapMode] = useState<BaseMapMode>("satellite");
  const [coordinates, setCoordinates] = useState<Coordinates>({ lat: 20, lng: 0 });
  const [selection, setSelection] = useState<SelectionGeometry | null>(null);
  const [polygonCount, setPolygonCount] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const layerControlEnabled = evidenceUrl !== undefined;
  const [spectralIndex, setSpectralIndex] = useState<Index>(evidenceIndex);
  const [spectralUrl, setSpectralUrl] = useState<string | null>(null);
  const [spectralBounds, setSpectralBounds] = useState<EvidenceBounds | null>(null);
  const [isSpectralLoading, setIsSpectralLoading] = useState(false);
  const [spectralError, setSpectralError] = useState("");

  useEffect(() => { onCoordinatesChangeRef.current = onCoordinatesChange; }, [onCoordinatesChange]);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);
  useEffect(() => { setSpectralIndex(evidenceIndex); }, [evidenceIndex]);
  useEffect(() => {
    modeRef.current = selectionMode;
    rectangleStartRef.current = null;
    polygonPointsRef.current = [];
    setPolygonCount(0);
    const map = mapRef.current;
    if (!map) return;
    if (selectionMode === "polygon") map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
  }, [selectionMode]);
  useEffect(() => {
    if (evidenceUrl !== null && evidenceUrl !== undefined) {
      setSpectralUrl(previous => { if (previous) URL.revokeObjectURL(previous); return null; });
      setSpectralBounds(null);
    }
  }, [evidenceUrl]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoadedRef.current) return;
    if (map.getLayer(BASEMAP_LAYER)) map.setLayoutProperty(BASEMAP_LAYER, "visibility", baseMapMode === "satellite" ? "visible" : "none");
    if (map.getLayer("osm-base")) map.setLayoutProperty("osm-base", "visibility", baseMapMode === "street" ? "visible" : "none");
    if (map.getLayer(LABELS_LAYER)) map.setLayoutProperty(LABELS_LAYER, "visibility", "visible");
  }, [baseMapMode]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          imagery: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            attribution: "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
          },
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
          englishLabels: {
            type: "raster",
            tiles: ["https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 18,
            attribution: "Esri, Garmin, HERE, © OpenStreetMap contributors, and the GIS user community",
          },
        },
        layers: [
          { id: BASEMAP_LAYER, type: "raster", source: "imagery" },
          { id: "osm-base", type: "raster", source: "osm", layout: { visibility: "none" } },
          { id: LABELS_LAYER, type: "raster", source: "englishLabels", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } },
        ],
      },
      center: [0, 20], zoom: 1.1, minZoom: 0.8, maxZoom: 19, projection: "mercator", renderWorldCopies: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false, showUserHeading: false }), "top-right");

    map.on("load", () => {
      mapLoadedRef.current = true;
      map.addSource(SELECTION_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({ id: SELECTION_FILL, type: "fill", source: SELECTION_SOURCE, paint: { "fill-color": "#22d3ee", "fill-opacity": 0.18 } });
      map.addLayer({ id: SELECTION_LINE, type: "line", source: SELECTION_SOURCE, paint: { "line-color": "#22d3ee", "line-width": 2 } });
      map.addLayer({ id: SELECTION_POINTS, type: "circle", source: SELECTION_SOURCE, filter: ["==", "$type", "Point"], paint: { "circle-radius": 5, "circle-color": "#06131f", "circle-stroke-color": "#22d3ee", "circle-stroke-width": 2 } });
    });

    const emitCoordinates = (lng: number, lat: number) => { const next = { lat, lng }; setCoordinates(next); onCoordinatesChangeRef.current?.(next); };
    const setSelectionData = (geometry: SelectionGeometry) => {
      const source = map.getSource(SELECTION_SOURCE) as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      source.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry }] });
      setSelection(geometry); setHasSelection(true); onSelectionChangeRef.current?.(geometry);
    };
    const clearSelectionVisuals = () => {
      markerRef.current?.remove(); markerRef.current = null;
      const source = map.getSource(SELECTION_SOURCE) as maplibregl.GeoJSONSource | undefined;
      source?.setData({ type: "FeatureCollection", features: [] });
      rectangleStartRef.current = null; polygonPointsRef.current = []; setPolygonCount(0); setSelection(null); setHasSelection(false); setSpectralError(""); setSpectralBounds(null);
      setSpectralUrl(previous => { if (previous) URL.revokeObjectURL(previous); return null; });
    };
    const createPointMarker = (lng: number, lat: number) => {
      markerRef.current?.remove();
      const el = document.createElement("div"); el.style.width = "18px"; el.style.height = "18px"; el.style.border = "2px solid #22d3ee"; el.style.borderRadius = "50%"; el.style.background = "#06131f"; el.style.boxShadow = "0 0 18px rgba(34,211,238,0.9)";
      markerRef.current = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    };
    const updatePolygonPreview = () => {
      const points = polygonPointsRef.current; if (!points.length) return;
      const features: GeoJSON.Feature[] = points.map(point => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: point } }));
      if (points.length >= 2) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } });
      if (points.length >= 3) features.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...points, points[0]]] } });
      const source = map.getSource(SELECTION_SOURCE) as maplibregl.GeoJSONSource | undefined; source?.setData({ type: "FeatureCollection", features });
    };
    map.on("click", event => {
      const { lng, lat } = event.lngLat; const mode = modeRef.current;
      if (mode === "point") { emitCoordinates(lng, lat); createPointMarker(lng, lat); setSelectionData({ type: "Point", coordinates: [lng, lat] }); return; }
      if (mode === "rectangle") {
        const start = rectangleStartRef.current;
        if (!start) { rectangleStartRef.current = [lng, lat]; emitCoordinates(lng, lat); return; }
        const [startLng, startLat] = start;
        const polygon: [number, number][] = [[startLng, startLat], [lng, startLat], [lng, lat], [startLng, lat], [startLng, startLat]];
        emitCoordinates((startLng + lng) / 2, (startLat + lat) / 2); setSelectionData({ type: "Polygon", coordinates: [polygon] }); rectangleStartRef.current = null; return;
      }
      polygonPointsRef.current.push([lng, lat]); setPolygonCount(polygonPointsRef.current.length); updatePolygonPreview(); if (polygonPointsRef.current.length === 1) emitCoordinates(lng, lat);
    });
    const helpers = map as MapHelpers;
    helpers.__satqueryFinishPolygon = () => {
      const points = polygonPointsRef.current; if (points.length < 3) return;
      const ring: [number, number][] = [...points, points[0]]; let sumLng = 0, sumLat = 0;
      for (const [lng, lat] of points) { sumLng += lng; sumLat += lat; }
      emitCoordinates(sumLng / points.length, sumLat / points.length); setSelectionData({ type: "Polygon", coordinates: [ring] }); polygonPointsRef.current = []; setPolygonCount(0);
    };
    helpers.__satqueryClearSelection = () => { clearSelectionVisuals(); onSelectionChangeRef.current?.({ type: "Point", coordinates: [0, 0] }); };
    helpers.__satqueryGoToLocation = (lng, lat) => { map.flyTo({ center: [lng, lat], zoom: 17, duration: 1600, essential: true }); emitCoordinates(lng, lat); createPointMarker(lng, lat); setSelectionData({ type: "Point", coordinates: [lng, lat] }); rectangleStartRef.current = null; polygonPointsRef.current = []; setPolygonCount(0); setSelectionMode("point"); };
    return () => { markerRef.current?.remove(); markerRef.current = null; map.remove(); mapRef.current = null; mapLoadedRef.current = false; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map || !mapLoadedRef.current) return;
    const sourceId = "satquery-evidence", layerId = "satquery-evidence-layer";
    if (!evidenceUrl || !evidenceBounds) { if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getSource(sourceId)) map.removeSource(sourceId); return; }
    const existing = map.getSource(sourceId) as maplibregl.ImageSource | undefined;
    if (existing) { existing.updateImage({ url: evidenceUrl, coordinates: evidenceBounds }); return; }
    map.addSource(sourceId, { type: "image", url: evidenceUrl, coordinates: evidenceBounds });
    map.addLayer({ id: layerId, type: "raster", source: sourceId, paint: { "raster-opacity": 0.7, "raster-resampling": "linear", "raster-fade-duration": 0 } }, map.getLayer(SELECTION_FILL) ? SELECTION_FILL : undefined);
  }, [evidenceUrl, evidenceBounds]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !mapLoadedRef.current) return;
    const sourceId = "satquery-change-heatmap", layerId = "satquery-change-heatmap-layer";
    if (!changeHeatmapUrl || !changeHeatmapBounds) { if (map.getLayer(layerId)) map.removeLayer(layerId); if (map.getSource(sourceId)) map.removeSource(sourceId); return; }
    const existing = map.getSource(sourceId) as maplibregl.ImageSource | undefined;
    if (existing) { existing.updateImage({ url: changeHeatmapUrl, coordinates: changeHeatmapBounds }); return; }
    map.addSource(sourceId, { type: "image", url: changeHeatmapUrl, coordinates: changeHeatmapBounds });
    map.addLayer({ id: layerId, type: "raster", source: sourceId, paint: { "raster-opacity": 0.66, "raster-contrast": 0.12, "raster-saturation": -0.15, "raster-resampling": "linear", "raster-fade-duration": 0 } }, map.getLayer(SELECTION_LINE) ? SELECTION_LINE : undefined);
  }, [changeHeatmapUrl, changeHeatmapBounds]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !mapLoadedRef.current) return;
    if (!spectralUrl || !spectralBounds || evidenceUrl) { if (map.getLayer(SPECTRAL_LAYER)) map.removeLayer(SPECTRAL_LAYER); if (map.getSource(SPECTRAL_SOURCE)) map.removeSource(SPECTRAL_SOURCE); return; }
    const existing = map.getSource(SPECTRAL_SOURCE) as maplibregl.ImageSource | undefined;
    if (existing) { existing.updateImage({ url: spectralUrl, coordinates: spectralBounds }); return; }
    map.addSource(SPECTRAL_SOURCE, { type: "image", url: spectralUrl, coordinates: spectralBounds });
    map.addLayer({ id: SPECTRAL_LAYER, type: "raster", source: SPECTRAL_SOURCE, paint: { "raster-opacity": spectralIndex === "rgb" ? 0.9 : 0.72, "raster-resampling": "linear", "raster-fade-duration": 0 } }, map.getLayer(SELECTION_FILL) ? SELECTION_FILL : undefined);
  }, [spectralUrl, spectralBounds, evidenceUrl, spectralIndex]);

  const handleSearch = async (event?: FormEvent) => {
    event?.preventDefault(); const query = searchQuery.trim(); if (!query || isSearching) return;
    setIsSearching(true); setSearchError(""); setSearchResults([]);
    try {
      const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { cache: "no-store" }); const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || "Location search failed.");
      const results = Array.isArray(data.results) ? data.results as SearchResult[] : [];
      if (!results.length) { setSearchError("No matching place was found."); return; }
      setSearchResults(results); const first = results[0]; const lat = Number(first.lat), lng = Number(first.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("The geocoder returned invalid coordinates.");
      (mapRef.current as MapHelpers | null)?.__satqueryGoToLocation?.(lng, lat);
    } catch (error) { console.error("SatQuery location search error:", error); setSearchError(error instanceof Error ? error.message : "Location search failed."); }
    finally { setIsSearching(false); }
  };

  const chooseSearchResult = (result: SearchResult) => { const lat = Number(result.lat), lng = Number(result.lon); if (!Number.isFinite(lat) || !Number.isFinite(lng)) return; (mapRef.current as MapHelpers | null)?.__satqueryGoToLocation?.(lng, lat); setSearchQuery(result.display_name); setSearchResults([]); setSearchError(""); };
  const showSpectralLayer = async () => {
    if (!layerControlEnabled || !selection || isSpectralLoading) return;
    const bounds = boundsFromSelection(selection); if (!bounds) { setSpectralError("Please make a valid map selection first."); return; }
    setIsSpectralLoading(true); setSpectralError("");
    try {
      const params = new URLSearchParams({ index: spectralIndex, geometry: JSON.stringify(selection) });
      const response = await fetch(`/api/evidence?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) { const data = await response.json().catch(() => null); throw new Error(data?.error || `${spectralIndex.toUpperCase()} layer could not be generated.`); }
      const blob = await response.blob(); const nextUrl = URL.createObjectURL(blob);
      setSpectralUrl(previous => { if (previous) URL.revokeObjectURL(previous); return nextUrl; }); setSpectralBounds(bounds);
    } catch (error) { console.error("SatQuery spectral layer error:", error); setSpectralError(error instanceof Error ? error.message : "Spectral layer could not be generated."); }
    finally { setIsSpectralLoading(false); }
  };
  const hideSpectralLayer = () => { setSpectralError(""); setSpectralBounds(null); setSpectralUrl(previous => { if (previous) URL.revokeObjectURL(previous); return null; }); };
  const finishPolygon = () => (mapRef.current as MapHelpers | null)?.__satqueryFinishPolygon?.();
  const clearSelection = () => (mapRef.current as MapHelpers | null)?.__satqueryClearSelection?.();

  return <div className="relative w-full h-full">
    <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-[min(520px,calc(100%-2rem))]">
      <form onSubmit={handleSearch} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/80 backdrop-blur-xl p-2 shadow-2xl">
        <SearchIcon /><input value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setSearchError(""); }} placeholder="Search any place on Earth..." className="min-w-0 flex-1 bg-transparent px-1 py-2 text-xs text-white outline-none placeholder:text-gray-500" />
        <button type="submit" disabled={!searchQuery.trim() || isSearching} className="rounded-lg bg-cyan-400 px-3 py-2 text-[10px] font-semibold text-black transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">{isSearching ? "Searching..." : "Search"}</button>
      </form>
      {(searchResults.length > 0 || searchError) && <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#07111c]/95 backdrop-blur-xl shadow-2xl">
        {searchError && <div className="px-4 py-3 text-xs text-red-300">{searchError}</div>}
        {searchResults.map((result, index) => <button key={`${result.lat}-${result.lon}-${index}`} type="button" onClick={() => chooseSearchResult(result)} className="block w-full border-b border-white/5 px-4 py-3 text-left text-xs text-gray-300 last:border-b-0 hover:bg-white/5 hover:text-white">{result.display_name}</button>)}
      </div>}
    </div>
    <div className="absolute top-4 left-4 z-10 rounded-xl border border-white/10 bg-black/75 backdrop-blur-xl px-4 py-3 pointer-events-none"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /><span className="text-xs font-semibold text-white">MAP ONLINE</span></div><p className="text-[10px] text-gray-400 mt-1">Realistic satellite basemap + English labels</p></div>
    <div className="absolute top-20 left-4 z-20 rounded-xl border border-white/10 bg-black/80 backdrop-blur-xl p-2 shadow-xl">
      <div className="text-[9px] uppercase tracking-widest text-gray-500 px-2 pb-2">Base map</div>
      <div className="flex gap-1">
        <button type="button" onClick={() => setBaseMapMode("satellite")} className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold ${baseMapMode === "satellite" ? "bg-cyan-400 text-black" : "bg-white/5 text-gray-400 hover:bg-white/10"}`}>Satellite</button>
        <button type="button" onClick={() => setBaseMapMode("street")} className={`rounded-lg px-3 py-1.5 text-[10px] font-semibold ${baseMapMode === "street" ? "bg-cyan-400 text-black" : "bg-white/5 text-gray-400 hover:bg-white/10"}`}>Street</button>
      </div>
    </div>
    <div className="absolute top-4 right-24 z-10 rounded-xl border border-white/10 bg-black/75 backdrop-blur-xl p-2"><div className="text-[9px] uppercase tracking-widest text-gray-500 px-2 pb-2">Select area</div><div className="flex gap-1">{([["point", "Point"], ["rectangle", "Rectangle"], ["polygon", "Polygon"]] as [SelectionMode, string][]).map(([mode, label]) => <button key={mode} type="button" onClick={() => setSelectionMode(mode)} className={`px-2.5 py-1.5 rounded-lg text-[10px] transition ${selectionMode === mode ? "bg-cyan-400 text-black" : "bg-white/5 text-gray-400 hover:bg-white/10"}`}>{label}</button>)}</div></div>
    <div className="absolute top-4 right-4 z-10 rounded-xl border border-white/10 bg-black/75 backdrop-blur-xl px-4 py-3 pointer-events-none"><div className="text-xs font-semibold text-white">Earth</div><div className="text-[10px] text-gray-400 mt-1">Satellite imagery + English reference labels</div></div>
    {layerControlEnabled && <div className="absolute left-4 bottom-20 z-30 w-[250px] rounded-xl border border-white/10 bg-black/85 backdrop-blur-xl p-3 shadow-2xl">
      <div className="flex items-center justify-between mb-2"><div className="text-[9px] uppercase tracking-widest text-gray-500">Satellite Layers</div>{spectralUrl && <div className="text-[8px] text-emerald-300">LIVE</div>}</div>
      <div className="grid grid-cols-4 gap-1.5">
        {(["rgb", "ndvi", "ndwi", "ndbi"] as Index[]).map(index => <button key={index} type="button" onClick={() => { setSpectralIndex(index); setSpectralError(""); }} className={`rounded-lg py-2 text-[10px] font-semibold transition ${spectralIndex === index ? "bg-cyan-400 text-black" : "bg-white/5 text-gray-400 hover:bg-white/10"}`}>{index === "rgb" ? "RGB" : index.toUpperCase()}</button>)}
      </div>
      <div className="mt-2 text-[9px] text-gray-500">RGB = Sentinel-2 true color; base map = high-detail satellite imagery.</div>
      <button type="button" onClick={showSpectralLayer} disabled={!selection || isSpectralLoading || Boolean(evidenceUrl)} className="mt-2 w-full rounded-lg bg-cyan-400 py-2 text-[10px] font-semibold text-black hover:bg-cyan-300 disabled:opacity-40">{isSpectralLoading ? "Generating..." : spectralUrl ? `Refresh ${spectralIndex === "rgb" ? "RGB" : spectralIndex.toUpperCase()}` : `Show ${spectralIndex === "rgb" ? "RGB" : spectralIndex.toUpperCase()}`}</button>
      {spectralUrl && !evidenceUrl && <button type="button" onClick={hideSpectralLayer} className="mt-1.5 w-full rounded-lg border border-white/10 py-1.5 text-[9px] text-gray-500 hover:bg-white/5">Hide layer</button>}
      {spectralError && <div className="mt-2 text-[9px] leading-relaxed text-red-300">{spectralError}</div>}
    </div>}
    <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">{selectionMode === "polygon" && polygonCount >= 3 && <button type="button" onClick={finishPolygon} className="rounded-lg border border-cyan-400/30 bg-black/80 px-3 py-2 text-[10px] text-cyan-300 hover:bg-cyan-400/10">Finish Polygon ({polygonCount})</button>}{hasSelection && <button type="button" onClick={clearSelection} className="rounded-lg border border-white/10 bg-black/80 px-3 py-2 text-[10px] text-gray-400 hover:bg-white/5">Clear</button>}</div>
    <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none"><div className="w-12 h-12 rounded-full border border-cyan-400/70 flex items-center justify-center"><div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.9)]" /></div></div>
    {changeHeatmapUrl && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 rounded-xl border border-amber-300/20 bg-black/85 backdrop-blur-xl px-4 py-3 shadow-xl"><div className="text-[9px] uppercase tracking-widest text-gray-400 mb-2">Change Heatmap</div><div className="flex items-center gap-4 text-[9px] text-gray-400"><div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" />Decrease</div><div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-gray-300" />Little / no change</div><div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-400" />Increase</div></div></div>}
    {evidenceUrl && <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 rounded-xl border border-white/10 bg-black/80 backdrop-blur-xl px-4 py-3 shadow-xl"><div className="text-[9px] uppercase tracking-widest text-gray-400 mb-2">{evidenceIndex.toUpperCase()} Evidence</div><div className="text-[9px] text-gray-400">Visual spectral evidence overlay</div></div>}
    <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-white/10 bg-black/75 backdrop-blur-xl px-4 py-3 pointer-events-none"><div className="text-[9px] text-gray-400 uppercase tracking-widest">Selected Coordinates</div><div className="mt-1 font-mono text-xs text-cyan-300">{coordinates.lat.toFixed(4)}° N · {coordinates.lng.toFixed(4)}° E</div></div>
    <div className="absolute left-1/2 bottom-4 -translate-x-1/2 z-10 rounded-lg border border-white/10 bg-black/65 backdrop-blur-md px-3 py-2 text-[10px] text-gray-400 pointer-events-none">{selectionMode === "point" && "Click a location"}{selectionMode === "rectangle" && "Click two opposite corners"}{selectionMode === "polygon" && "Click points, then finish polygon"}</div>
  </div>;
}