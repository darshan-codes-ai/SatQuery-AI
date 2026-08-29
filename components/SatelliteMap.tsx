"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

type Coordinates = {
  lat: number;
  lng: number;
};

type SatelliteMapProps = {
  onCoordinatesChange?: (coordinates: Coordinates) => void;
};

export default function SatelliteMap({
  onCoordinatesChange,
}: SatelliteMapProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  const [coordinates, setCoordinates] =
    useState<Coordinates>({
      lat: 21.1938,
      lng: 81.3509,
    });

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) {
      return;
    }

    // =====================================================
    // CREATE MAP
    // =====================================================

    const map = new maplibregl.Map({
      container: mapContainer.current,

      // Normal 2D MapLibre style
      style: "https://demotiles.maplibre.org/style.json",

      // Initial center
      center: [81.3509, 21.1938],

      // Initial zoom
      zoom: 5,

      // Flat map projection
      projection: "mercator",
    });

    mapRef.current = map;

    // =====================================================
    // MAP LOAD
    // =====================================================

    map.on("load", () => {
      // ---------------------------------------------------
      // ADD SATELLITE RASTER SOURCE
      // ---------------------------------------------------

      if (!map.getSource("satellite-imagery")) {
        map.addSource("satellite-imagery", {
          type: "raster",

          tiles: [
            "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg",
          ],

          tileSize: 256,

          minzoom: 0,

          maxzoom: 19,
        });
      }

      // ---------------------------------------------------
      // ADD SATELLITE RASTER LAYER
      // ---------------------------------------------------

      if (!map.getLayer("satellite-imagery-layer")) {
        map.addLayer({
          id: "satellite-imagery-layer",

          type: "raster",

          source: "satellite-imagery",

          paint: {
            "raster-opacity": 1,
          },
        });
      }
    });

    // =====================================================
    // NAVIGATION CONTROL
    // =====================================================

    map.addControl(
      new maplibregl.NavigationControl(),
      "top-right"
    );

    // =====================================================
    // FULLSCREEN CONTROL
    // =====================================================

    map.addControl(
      new maplibregl.FullscreenControl(),
      "top-right"
    );

    // =====================================================
    // GEOLOCATION CONTROL
    // =====================================================

    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },

        trackUserLocation: true,

        showUserHeading: true,
      }),
      "top-right"
    );

    // =====================================================
    // MAP CLICK
    // =====================================================

    map.on("click", (event) => {
      const { lng, lat } = event.lngLat;

      const newCoordinates: Coordinates = {
        lat,
        lng,
      };

      // ---------------------------------------------------
      // UPDATE LOCAL STATE
      // ---------------------------------------------------

      setCoordinates(newCoordinates);

      // ---------------------------------------------------
      // SEND COORDINATES TO PARENT PAGE
      // ---------------------------------------------------

      onCoordinatesChange?.(newCoordinates);

      // ---------------------------------------------------
      // REMOVE PREVIOUS MARKER
      // ---------------------------------------------------

      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }

      // ---------------------------------------------------
      // CREATE CUSTOM MARKER
      // ---------------------------------------------------

      const markerElement =
        document.createElement("div");

      markerElement.className =
        "satquery-marker";

      markerElement.style.width = "18px";
      markerElement.style.height = "18px";
      markerElement.style.border =
        "2px solid #22d3ee";
      markerElement.style.borderRadius =
        "50%";
      markerElement.style.backgroundColor =
        "#06131f";
      markerElement.style.boxShadow =
        "0 0 18px rgba(34,211,238,0.9)";

      // ---------------------------------------------------
      // ADD MARKER
      // ---------------------------------------------------

      markerRef.current =
        new maplibregl.Marker({
          element: markerElement,
        })
          .setLngLat([lng, lat])
          .addTo(map);
    });

    // =====================================================
    // CLEANUP
    // =====================================================

    return () => {
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }

      map.remove();

      mapRef.current = null;
    };
  }, [onCoordinatesChange]);

  return (
    <div className="relative w-full h-full">
      {/* ===================================================
          MAP
      =================================================== */}

      <div
        ref={mapContainer}
        className="
          absolute
          inset-0
          w-full
          h-full
        "
      />

      {/* ===================================================
          MAP ONLINE STATUS
      =================================================== */}

      <div
        className="
          absolute
          top-4
          left-4
          z-10
          rounded-xl
          border
          border-white/10
          bg-black/75
          backdrop-blur-xl
          px-4
          py-3
          pointer-events-none
        "
      >
        <div className="flex items-center gap-2">
          <div
            className="
              w-2
              h-2
              rounded-full
              bg-emerald-400
              animate-pulse
            "
          />

          <span
            className="
              text-xs
              font-semibold
              text-white
            "
          >
            MAP ONLINE
          </span>
        </div>

        <p
          className="
            text-[10px]
            text-gray-400
            mt-1
          "
        >
          Interactive geospatial workspace
        </p>
      </div>

      {/* ===================================================
          SATELLITE INFORMATION
      =================================================== */}

      <div
        className="
          absolute
          top-4
          right-4
          z-10
          rounded-xl
          border
          border-white/10
          bg-black/75
          backdrop-blur-xl
          px-4
          py-3
          pointer-events-none
        "
      >
        <div
          className="
            text-xs
            font-semibold
            text-white
          "
        >
          Sentinel-2
        </div>

        <div
          className="
            text-[10px]
            text-gray-400
            mt-1
          "
        >
          Multispectral • 10m
        </div>
      </div>

      {/* ===================================================
          CENTER TARGET
      =================================================== */}

      <div
        className="
          absolute
          left-1/2
          top-1/2
          -translate-x-1/2
          -translate-y-1/2
          z-10
          pointer-events-none
        "
      >
        <div
          className="
            w-12
            h-12
            rounded-full
            border
            border-cyan-400/70
            flex
            items-center
            justify-center
          "
        >
          <div
            className="
              w-2
              h-2
              rounded-full
              bg-cyan-400
              shadow-[0_0_15px_rgba(34,211,238,0.9)]
            "
          />
        </div>
      </div>

      {/* ===================================================
          SELECTED COORDINATES
      =================================================== */}

      <div
        className="
          absolute
          bottom-4
          left-4
          z-10
          rounded-xl
          border
          border-white/10
          bg-black/75
          backdrop-blur-xl
          px-4
          py-3
          pointer-events-none
        "
      >
        <div
          className="
            text-[9px]
            text-gray-400
            uppercase
            tracking-widest
          "
        >
          Selected Coordinates
        </div>

        <div
          className="
            mt-1
            font-mono
            text-xs
            text-cyan-300
          "
        >
          {coordinates.lat.toFixed(4)}° N
          {" · "}
          {coordinates.lng.toFixed(4)}° E
        </div>
      </div>
    </div>
  );
}