"use client";

import { useEffect, useRef, useState } from "react";
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
};

const SELECTION_SOURCE = "satquery-selection";
const SELECTION_FILL = "satquery-selection-fill";
const SELECTION_LINE = "satquery-selection-line";
const SELECTION_POINTS = "satquery-selection-points";

type MapHelpers = maplibregl.Map & {
  __satqueryFinishPolygon?: () => void;
  __satqueryClearSelection?: () => void;
};

export default function SatelliteMap({
  onCoordinatesChange,
  onSelectionChange,
}: SatelliteMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
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

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }

      map.remove();
      mapRef.current = null;
    };
  }, []);

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
