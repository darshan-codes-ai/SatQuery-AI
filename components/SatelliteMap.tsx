"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Coordinates = {
  lat: number;
  lng: number;
};

type SelectionGeometry =
  | {
      type: "Point";
      coordinates: [number, number];
    }
  | {
      type: "Polygon";
      coordinates: [number, number][][];
    };

type SelectionMode = "point" | "rectangle" | "polygon";

type SatelliteMapProps = {
  onCoordinatesChange?: (coordinates: Coordinates) => void;
  onSelectionChange?: (selection: SelectionGeometry) => void;
  evidenceUrl?: string | null;
  evidenceBounds?: EvidenceBounds | null;
  evidenceIndex?: "ndvi" | "ndwi" | "ndbi";
  changeHeatmapUrl?: string | null;
  changeHeatmapBounds?: EvidenceBounds | null;
};

type SearchResult = {
  display_name: string;
  lat: string;
  lon: string;
};

type EvidenceBounds = [
  [number, number],
  [number, number],
  [number, number],
  [number, number]
];

const SELECTION_SOURCE = "satquery-selection";
const SELECTION_FILL = "satquery-selection-fill";
const SELECTION_LINE = "satquery-selection-line";
const SELECTION_POINTS = "satquery-selection-points";

type MapHelpers = maplibregl.Map & {
  __satqueryFinishPolygon?: () => void;
  __satqueryClearSelection?: () => void;
  __satqueryGoToLocation?: (lng: number, lat: number) => void;
};


function SearchIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-cyan-400"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export default function SatelliteMap({
  onCoordinatesChange,
  onSelectionChange,
  evidenceUrl,
  evidenceBounds,
  evidenceIndex = "ndvi",
  changeHeatmapUrl,
  changeHeatmapBounds,
}: SatelliteMapProps) {
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
  const [coordinates, setCoordinates] = useState<Coordinates>({
    lat: 20,
    lng: 0,
  });
  const [polygonCount, setPolygonCount] = useState(0);
  const [hasSelection, setHasSelection] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");

  useEffect(() => {
    onCoordinatesChangeRef.current = onCoordinatesChange;
  }, [onCoordinatesChange]);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    modeRef.current = selectionMode;

    const map = mapRef.current;
    if (!map) return;

    rectangleStartRef.current = null;
    polygonPointsRef.current = [];
    setPolygonCount(0);

    if (selectionMode === "polygon") {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }
  }, [selectionMode]);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [
              "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            minzoom: 0,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm-base",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [0, 20],
      zoom: 1.1,
      minZoom: 0.8,
      maxZoom: 19,
      projection: "mercator",
      renderWorldCopies: true,
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.FullscreenControl(), "top-right");
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showUserHeading: false,
      }),
      "top-right"
    );

    map.on("load", () => {
      mapLoadedRef.current = true;

      map.addSource(SELECTION_SOURCE, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });

      map.addLayer({
        id: SELECTION_FILL,
        type: "fill",
        source: SELECTION_SOURCE,
        paint: {
          "fill-color": "#22d3ee",
          "fill-opacity": 0.18,
        },
      });

      map.addLayer({
        id: SELECTION_LINE,
        type: "line",
        source: SELECTION_SOURCE,
        paint: {
          "line-color": "#22d3ee",
          "line-width": 2,
        },
      });

      map.addLayer({
        id: SELECTION_POINTS,
        type: "circle",
        source: SELECTION_SOURCE,
        filter: ["==", "$type", "Point"],
        paint: {
          "circle-radius": 5,
          "circle-color": "#06131f",
          "circle-stroke-color": "#22d3ee",
          "circle-stroke-width": 2,
        },
      });
    });

    const emitCoordinates = (lng: number, lat: number) => {
      const next = { lat, lng };
      setCoordinates(next);
      onCoordinatesChangeRef.current?.(next);
    };

    const setSelectionData = (geometry: SelectionGeometry) => {
      const source = map.getSource(SELECTION_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;

      if (!source) return;

      source.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry,
          },
        ],
      });

      setHasSelection(true);
      onSelectionChangeRef.current?.(geometry);
    };

    const clearSelectionVisuals = () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }

      const source = map.getSource(SELECTION_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;

      source?.setData({
        type: "FeatureCollection",
        features: [],
      });

      rectangleStartRef.current = null;
      polygonPointsRef.current = [];
      setPolygonCount(0);
      setHasSelection(false);
    };

    const createPointMarker = (lng: number, lat: number) => {
      if (markerRef.current) {
        markerRef.current.remove();
      }

      const el = document.createElement("div");
      el.style.width = "18px";
      el.style.height = "18px";
      el.style.border = "2px solid #22d3ee";
      el.style.borderRadius = "50%";
      el.style.background = "#06131f";
      el.style.boxShadow = "0 0 18px rgba(34,211,238,0.9)";

      markerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map);
    };

    const updatePolygonPreview = () => {
      const points = polygonPointsRef.current;
      if (!points.length) return;

      const features: GeoJSON.Feature[] = points.map((point) => ({
        type: "Feature",
        properties: {},
        geometry: {
          type: "Point",
          coordinates: point,
        },
      }));

      if (points.length >= 2) {
        features.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: points,
          },
        });
      }

      if (points.length >= 3) {
        const ring = [...points, points[0]];
        features.push({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [ring],
          },
        });
      }

      const source = map.getSource(SELECTION_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined;

      source?.setData({
        type: "FeatureCollection",
        features,
      });
    };

    map.on("click", (event) => {
      const { lng, lat } = event.lngLat;
      const mode = modeRef.current;

      if (mode === "point") {
        emitCoordinates(lng, lat);
        createPointMarker(lng, lat);

        setSelectionData({
          type: "Point",
          coordinates: [lng, lat],
        });
        return;
      }

      if (mode === "rectangle") {
        const start = rectangleStartRef.current;

        if (!start) {
          rectangleStartRef.current = [lng, lat];
          emitCoordinates(lng, lat);
          return;
        }

        const [startLng, startLat] = start;
        const polygon: [number, number][] = [
          [startLng, startLat],
          [lng, startLat],
          [lng, lat],
          [startLng, lat],
          [startLng, startLat],
        ];

        emitCoordinates(
          (startLng + lng) / 2,
          (startLat + lat) / 2
        );

        setSelectionData({
          type: "Polygon",
          coordinates: [polygon],
        });

        rectangleStartRef.current = null;
        return;
      }

      polygonPointsRef.current.push([lng, lat]);
      setPolygonCount(polygonPointsRef.current.length);
      updatePolygonPreview();

      if (polygonPointsRef.current.length === 1) {
        emitCoordinates(lng, lat);
      }
    });

    const helpers = map as MapHelpers;

    helpers.__satqueryFinishPolygon = () => {
      const points = polygonPointsRef.current;
      if (points.length < 3) return;

      const ring: [number, number][] = [
        ...points,
        points[0],
      ];

      let sumLng = 0;
      let sumLat = 0;

      for (const [lng, lat] of points) {
        sumLng += lng;
        sumLat += lat;
      }

      emitCoordinates(
        sumLng / points.length,
        sumLat / points.length
      );

      setSelectionData({
        type: "Polygon",
        coordinates: [ring],
      });

      polygonPointsRef.current = [];
      setPolygonCount(0);
    };

    helpers.__satqueryClearSelection = () => {
      clearSelectionVisuals();
      onSelectionChangeRef.current?.({
        type: "Point",
        coordinates: [0, 0],
      });
    };

    helpers.__satqueryGoToLocation = (lng: number, lat: number) => {
      const next = { lat, lng };

      map.flyTo({
        center: [lng, lat],
        zoom: 12,
        duration: 1400,
        essential: true,
      });

      emitCoordinates(lng, lat);
      createPointMarker(lng, lat);
      setSelectionData({
        type: "Point",
        coordinates: [lng, lat],
      });

      rectangleStartRef.current = null;
      polygonPointsRef.current = [];
      setPolygonCount(0);

      setSelectionMode("point");
    };

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }

      map.remove();
      mapRef.current = null;
      mapLoadedRef.current = false;
    };
  }, []);

  // =====================================================
  // CHANGE HEATMAP OVERLAY
  // =====================================================

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoadedRef.current) return;

    const sourceId = "satquery-change-heatmap";
    const layerId = "satquery-change-heatmap-layer";

    if (!changeHeatmapUrl || !changeHeatmapBounds) {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }

      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }

      return;
    }

    const existingSource = map.getSource(sourceId) as
      | maplibregl.ImageSource
      | undefined;

    if (existingSource) {
      existingSource.updateImage({
        url: changeHeatmapUrl,
        coordinates: changeHeatmapBounds,
      });
    } else {
      map.addSource(sourceId, {
        type: "image",
        url: changeHeatmapUrl,
        coordinates: changeHeatmapBounds,
      });

      // Put the heatmap above the selection fill so the changes remain
      // clearly visible, but keep the selection outline above the heatmap.
      const beforeId = map.getLayer(SELECTION_LINE)
        ? SELECTION_LINE
        : undefined;

      map.addLayer(
        {
          id: layerId,
          type: "raster",
          source: sourceId,
          paint: {
            "raster-opacity": 1,
            "raster-resampling": "nearest",
            "raster-fade-duration": 0,
          },
        },
        beforeId
      );
    }
  }, [changeHeatmapUrl, changeHeatmapBounds]);

  // =====================================================
  // NDVI EVIDENCE OVERLAY
  // =====================================================

  useEffect(() => {
    const map = mapRef.current;

    if (!map || !mapLoadedRef.current) return;

    const sourceId = "satquery-evidence";
    const layerId = "satquery-evidence-layer";

    if (!evidenceUrl || !evidenceBounds) {
      if (map.getLayer(layerId)) {
        map.removeLayer(layerId);
      }

      if (map.getSource(sourceId)) {
        map.removeSource(sourceId);
      }

      return;
    }

    const existingSource = map.getSource(sourceId) as
      | maplibregl.ImageSource
      | undefined;

    if (existingSource) {
      existingSource.updateImage({
        url: evidenceUrl,
        coordinates: evidenceBounds,
      });
    } else {
      map.addSource(sourceId, {
        type: "image",
        url: evidenceUrl,
        coordinates: evidenceBounds,
      });

      const beforeId = map.getLayer(SELECTION_FILL)
        ? SELECTION_FILL
        : undefined;

      map.addLayer(
        {
          id: layerId,
          type: "raster",
          source: sourceId,
          paint: {
            "raster-opacity": 0.72,
            "raster-fade-duration": 0,
          },
        },
        beforeId
      );
    }
  }, [evidenceUrl, evidenceBounds]);

  const handleSearch = async (event?: FormEvent) => {
    event?.preventDefault();

    const query = searchQuery.trim();

    if (!query || isSearching) return;

    setIsSearching(true);
    setSearchError("");
    setSearchResults([]);

    try {
      const response = await fetch(
        `/api/geocode?q=${encodeURIComponent(query)}`,
        { cache: "no-store" }
      );

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "Location search failed."
        );
      }

      const results = Array.isArray(data.results)
        ? (data.results as SearchResult[])
        : [];

      if (!results.length) {
        setSearchError("No matching place was found.");
        return;
      }

      setSearchResults(results);

      const first = results[0];
      const lat = Number(first.lat);
      const lng = Number(first.lon);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("The geocoder returned invalid coordinates.");
      }

      const map = mapRef.current as MapHelpers | null;
      map?.__satqueryGoToLocation?.(lng, lat);
    } catch (error) {
      console.error("SatQuery location search error:", error);
      setSearchError(
        error instanceof Error
          ? error.message
          : "Location search failed."
      );
    } finally {
      setIsSearching(false);
    }
  };

  const chooseSearchResult = (result: SearchResult) => {
    const lat = Number(result.lat);
    const lng = Number(result.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const map = mapRef.current as MapHelpers | null;
    map?.__satqueryGoToLocation?.(lng, lat);

    setSearchQuery(result.display_name);
    setSearchResults([]);
    setSearchError("");
  };

  const finishPolygon = () => {
    const map = mapRef.current as MapHelpers | null;
    map?.__satqueryFinishPolygon?.();
  };

  const clearSelection = () => {
    const map = mapRef.current as MapHelpers | null;
    map?.__satqueryClearSelection?.();
  };

  return (
    <div className="relative w-full h-full">
      <div
        ref={mapContainer}
        className="absolute inset-0 w-full h-full"
      />

      {/* LOCATION SEARCH */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-[min(520px,calc(100%-2rem))]">
        <form
          onSubmit={handleSearch}
          className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/80 backdrop-blur-xl p-2 shadow-2xl"
        >
          <SearchIcon />
          <input
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchError("");
            }}
            placeholder="Search any place on Earth..."
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-xs text-white outline-none placeholder:text-gray-500"
          />
          <button
            type="submit"
            disabled={!searchQuery.trim() || isSearching}
            className="rounded-lg bg-cyan-400 px-3 py-2 text-[10px] font-semibold text-black transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSearching ? "Searching..." : "Search"}
          </button>
        </form>

        {(searchResults.length > 0 || searchError) && (
          <div className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#07111c]/95 backdrop-blur-xl shadow-2xl">
            {searchError && (
              <div className="px-4 py-3 text-xs text-red-300">
                {searchError}
              </div>
            )}

            {searchResults.map((result, index) => (
              <button
                key={`${result.lat}-${result.lon}-${index}`}
                type="button"
                onClick={() => chooseSearchResult(result)}
                className="block w-full border-b border-white/5 px-4 py-3 text-left text-xs text-gray-300 transition last:border-b-0 hover:bg-white/5 hover:text-white"
              >
                {result.display_name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="absolute top-4 left-4 z-10 rounded-xl border border-white/10 bg-black/75 backdrop-blur-xl px-4 py-3 pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-semibold text-white">
            MAP ONLINE
          </span>
        </div>
        <p className="text-[10px] text-gray-400 mt-1">
          Global geospatial workspace
        </p>
      </div>

      <div className="absolute top-4 right-24 z-10 rounded-xl border border-white/10 bg-black/75 backdrop-blur-xl p-2">
        <div className="text-[9px] uppercase tracking-widest text-gray-500 px-2 pb-2">
          Select area
        </div>
        <div className="flex gap-1">
          {(
            [
              ["point", "Point"],
              ["rectangle", "Rectangle"],
              ["polygon", "Polygon"],
            ] as [SelectionMode, string][]
          ).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setSelectionMode(mode)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] transition ${
                selectionMode === mode
                  ? "bg-cyan-400 text-black"
                  : "bg-white/5 text-gray-400 hover:bg-white/10"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="absolute top-4 right-4 z-10 rounded-xl border border-white/10 bg-black/75 backdrop-blur-xl px-4 py-3 pointer-events-none">
        <div className="text-xs font-semibold text-white">Earth</div>
        <div className="text-[10px] text-gray-400 mt-1">
          Global 2D Map
        </div>
      </div>

      <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
        {selectionMode === "polygon" && polygonCount >= 3 && (
          <button
            onClick={finishPolygon}
            className="rounded-lg border border-cyan-400/30 bg-black/80 px-3 py-2 text-[10px] text-cyan-300 hover:bg-cyan-400/10"
          >
            Finish Polygon ({polygonCount})
          </button>
        )}

        {hasSelection && (
          <button
            onClick={clearSelection}
            className="rounded-lg border border-white/10 bg-black/80 px-3 py-2 text-[10px] text-gray-400 hover:bg-white/5"
          >
            Clear
          </button>
        )}
      </div>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
        <div className="w-12 h-12 rounded-full border border-cyan-400/70 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.9)]" />
        </div>
      </div>


      {changeHeatmapUrl && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 rounded-xl border border-amber-300/20 bg-black/85 backdrop-blur-xl px-4 py-3 shadow-xl">
          <div className="text-[9px] uppercase tracking-widest text-gray-400 mb-2">
            Change Heatmap
          </div>
          <div className="flex items-center gap-4 text-[9px] text-gray-400">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-red-500" />
              Decrease
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-gray-300" />
              Little / no change
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-green-400" />
              Increase
            </div>
          </div>
        </div>
      )}

      {evidenceUrl && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 rounded-xl border border-white/10 bg-black/80 backdrop-blur-xl px-4 py-3 shadow-xl">
          <div className="text-[9px] uppercase tracking-widest text-gray-400 mb-2">
            {evidenceIndex.toUpperCase()} Evidence
          </div>
          <div className="flex items-center gap-3 text-[9px] text-gray-400">
            {evidenceIndex === "ndvi" && (
              <>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" />Low</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-400" />Sparse</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-yellow-300" />Moderate</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-400" />Healthy</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-emerald-700" />Dense</div>
              </>
            )}
            {evidenceIndex === "ndwi" && (
              <>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" />Dry</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-400" />Low</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-yellow-300" />Moderate</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-400" />Wet</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-cyan-700" />Water</div>
              </>
            )}
            {evidenceIndex === "ndbi" && (
              <>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-500" />Low</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-300" />Near zero</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-yellow-300" />Moderate</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-orange-400" />Built-up</div>
                <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-800" />Dense</div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="absolute bottom-4 left-4 z-10 rounded-xl border border-white/10 bg-black/75 backdrop-blur-xl px-4 py-3 pointer-events-none">
        <div className="text-[9px] text-gray-400 uppercase tracking-widest">
          Selected Coordinates
        </div>
        <div className="mt-1 font-mono text-xs text-cyan-300">
          {coordinates.lat.toFixed(4)}° N · {coordinates.lng.toFixed(4)}° E
        </div>
      </div>

      <div className="absolute left-1/2 bottom-4 -translate-x-1/2 z-10 rounded-lg border border-white/10 bg-black/65 backdrop-blur-md px-3 py-2 text-[10px] text-gray-400 pointer-events-none">
        {selectionMode === "point" && "Click a location"}
        {selectionMode === "rectangle" && "Click two opposite corners"}
        {selectionMode === "polygon" && "Click points, then finish polygon"}
      </div>
    </div>
  );
}
