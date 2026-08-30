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
      lat: 20,
      lng: 0,
    });

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) {
      return;
    }

    const map = new maplibregl.Map({
      container: mapContainer.current,

      // Reliable global 2D basemap
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

            attribution:
              "© OpenStreetMap contributors",
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

      // Start with the whole Earth visible
      center: [0, 20],

      zoom: 1.5,

      minZoom: 1,

      maxZoom: 19,

      projection: "mercator",

      renderWorldCopies: true,
    });

    mapRef.current = map;

    // =====================================================
    // NAVIGATION CONTROLS
    // =====================================================

    map.addControl(
      new maplibregl.NavigationControl(),
      "top-right"
    );

    map.addControl(
      new maplibregl.FullscreenControl(),
      "top-right"
    );

    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: {
          enableHighAccuracy: true,
        },

        trackUserLocation: false,

        showUserHeading: false,
      }),
      "top-right"
    );

    // =====================================================
    // MAP LOAD
    // =====================================================

    map.on("load", () => {
      // Start globally.
      map.fitBounds(
        [
          [-179, -60],
          [179, 80],
        ],
        {
          padding: 20,
          duration: 0,
        }
      );
    });

    // =====================================================
    // MAP CLICK
    // =====================================================

    map.on("click", (event) => {
      const { lng, lat } = event.lngLat;

      const newCoordinates: Coordinates = {
        lat,
        lng,
      };

      setCoordinates(newCoordinates);

      onCoordinatesChange?.(
        newCoordinates
      );

      // Remove previous marker
      if (markerRef.current) {
        markerRef.current.remove();
      }

      // Create selected-location marker
      const markerElement =
        document.createElement("div");

      markerElement.style.width = "18px";
      markerElement.style.height = "18px";
      markerElement.style.border =
        "2px solid #22d3ee";
      markerElement.style.borderRadius =
        "50%";
      markerElement.style.background =
        "#06131f";
      markerElement.style.boxShadow =
        "0 0 18px rgba(34,211,238,0.9)";
      markerElement.style.cursor =
        "pointer";

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
      {/* MAP */}

      <div
        ref={mapContainer}
        className="absolute inset-0 w-full h-full"
      />

      {/* MAP STATUS */}

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
          Global geospatial workspace
        </p>
      </div>

      {/* SATELLITE INFO */}

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
          Earth
        </div>

        <div
          className="
            text-[10px]
            text-gray-400
            mt-1
          "
        >
          Global 2D Map
        </div>
      </div>

      {/* CENTER TARGET */}

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

      {/* SELECTED COORDINATES */}

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

      {/* MAP INSTRUCTION */}

      <div
        className="
          absolute
          bottom-4
          right-4
          z-10
          rounded-lg
          border
          border-white/10
          bg-black/65
          backdrop-blur-md
          px-3
          py-2
          text-[10px]
          text-gray-400
          pointer-events-none
        "
      >
        Click anywhere to select a location
      </div>
    </div>
  );
}