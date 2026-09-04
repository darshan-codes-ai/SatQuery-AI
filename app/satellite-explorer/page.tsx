"use client";

import { useState } from "react";
import Link from "next/link";
import SatelliteMap from "@/components/SatelliteMap";
import TopNav from "@/components/TopNav";
import {
  Activity,
  BarChart3,
  CalendarDays,
  Eye,
  Layers,
  MapPin,
  Satellite,
  Sparkles,
  Waves,
  X,
} from "lucide-react";

type Coordinates = {
  lat: number;
  lng: number;
};

type SelectionGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] };

type Index = "ndvi" | "ndwi" | "ndbi";

type IndexMeta = {
  label: string;
  title: string;
  description: string;
};

const indexMeta: Record<Index, IndexMeta> = {
  ndvi: {
    label: "NDVI",
    title: "Vegetation",
    description: "Vegetation / greenness signal derived from NIR and Red reflectance.",
  },
  ndwi: {
    label: "NDWI",
    title: "Water",
    description: "Water-related spectral signal derived from Green and NIR reflectance.",
  },
  ndbi: {
    label: "NDBI",
    title: "Built-up",
    description: "Built-up / urban surface signal derived from SWIR and NIR reflectance.",
  },
};

export default function SatelliteExplorerPage() {
  const [selection, setSelection] = useState<SelectionGeometry | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates>({ lat: 20, lng: 0 });
  const [activeIndex, setActiveIndex] = useState<Index>("ndvi");
  const [evidenceUrl, setEvidenceUrl] = useState<string | null>(null);
  const [evidenceBounds, setEvidenceBounds] = useState<
    [[number, number], [number, number], [number, number], [number, number]] | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const getBounds = () => {
    if (!selection) return null;

    if (selection.type === "Point") {
      const [lng, lat] = selection.coordinates;
      const size = 0.0025;
      return [
        [lng - size, lat + size],
        [lng + size, lat + size],
        [lng + size, lat - size],
        [lng - size, lat - size],
      ] as [[number, number], [number, number], [number, number], [number, number]];
    }

    const ring = selection.coordinates[0] ?? [];
    if (ring.length < 3) return null;

    const lngs = ring.map(([lng]) => lng);
    const lats = ring.map(([, lat]) => lat);

    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    return [
      [minLng, maxLat],
      [maxLng, maxLat],
      [maxLng, minLat],
      [minLng, minLat],
    ] as [[number, number], [number, number], [number, number], [number, number]];
  };

  const showLayer = async () => {
    if (!selection || loading) return;

    const bounds = getBounds();
    if (!bounds) {
      setError("Please select a valid point or area first.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        index: activeIndex,
        geometry: JSON.stringify(selection),
      });

      const response = await fetch(`/api/evidence?${params.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Satellite layer could not be generated.");
      }

      const blob = await response.blob();
      const nextUrl = URL.createObjectURL(blob);

      setEvidenceUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return nextUrl;
      });
      setEvidenceBounds(bounds);
    } catch (err) {
      console.error("SatQuery explorer error:", err);
      setError(err instanceof Error ? err.message : "Satellite layer could not be generated.");
    } finally {
      setLoading(false);
    }
  };

  const clearLayer = () => {
    setError("");
    setEvidenceBounds(null);
    setEvidenceUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  };

  const selectIndex = (index: Index) => {
    setActiveIndex(index);
    clearLayer();
  };

  return (
    <main className="min-h-screen bg-[#040812] text-white">
      <header className="h-16 border-b border-white/10 bg-[#060b16]/95 backdrop-blur-xl">
        <div className="h-full px-5 flex items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-lg bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center">
              <Satellite size={20} className="text-cyan-400" />
            </div>
            <div>
              <div className="font-bold tracking-wide">SATQUERY <span className="text-cyan-400">AI</span></div>
              <div className="text-[9px] text-gray-500 tracking-[0.2em]">EARTH OBSERVATION</div>
            </div>
          </Link>
          <TopNav />
          <div className="hidden md:flex items-center gap-2 text-[10px] text-cyan-300">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            SATELLITE EXPLORER
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_360px] min-h-[calc(100vh-64px)]">
        <section className="min-w-0 border-r border-white/10">
          <div className="h-14 border-b border-white/10 px-5 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">Satellite Explorer</div>
              <div className="text-[10px] text-gray-600">Explore spectral evidence directly on the map</div>
            </div>
            <div className="text-[10px] font-mono text-gray-600">{coordinates.lat.toFixed(4)}, {coordinates.lng.toFixed(4)}</div>
          </div>

          <div className="relative h-[calc(100vh-120px)] min-h-[560px] bg-[#07111c] overflow-hidden">
            <SatelliteMap
              onCoordinatesChange={setCoordinates}
              onSelectionChange={(next) => {
                setSelection(next);
                clearLayer();
              }}
              evidenceUrl={evidenceUrl}
              evidenceBounds={evidenceBounds}
              evidenceIndex={activeIndex}
            />
          </div>
        </section>

        <aside className="bg-[#060b15] flex flex-col">
          <div className="h-14 border-b border-white/10 px-5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-400/10 flex items-center justify-center">
              <Layers size={17} className="text-cyan-400" />
            </div>
            <div>
              <div className="text-sm font-semibold">Spectral Layers</div>
              <div className="text-[10px] text-gray-600">Sentinel-2 evidence</div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Sparkles size={15} className="text-cyan-400" />
                Choose an index
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4">
                {([
                  ["ndvi", Activity],
                  ["ndwi", Waves],
                  ["ndbi", BarChart3],
                ] as const).map(([index, Icon]) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => selectIndex(index)}
                    className={`rounded-xl border py-3 transition ${
                      activeIndex === index
                        ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
                        : "border-white/10 bg-white/[0.02] text-gray-500 hover:bg-white/5"
                    }`}
                  >
                    <Icon size={16} className="mx-auto" />
                    <div className="text-[10px] mt-1 font-semibold">{index.toUpperCase()}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
                  <Eye size={17} className="text-gray-400" />
                </div>
                <div>
                  <div className="text-xs font-semibold">{indexMeta[activeIndex].title} evidence</div>
                  <div className="text-[10px] text-gray-600 mt-1">{indexMeta[activeIndex].description}</div>
                </div>
              </div>

              <button
                type="button"
                onClick={showLayer}
                disabled={!selection || loading}
                className="w-full mt-4 rounded-xl bg-cyan-400 text-black py-3 text-xs font-semibold hover:bg-cyan-300 disabled:opacity-40 transition"
              >
                {loading ? "Generating satellite layer..." : evidenceUrl ? "Refresh Layer" : `Show ${activeIndex.toUpperCase()} Layer`}
              </button>

              {evidenceUrl && (
                <button type="button" onClick={clearLayer} className="w-full mt-2 rounded-xl border border-white/10 py-2.5 text-[10px] text-gray-500 hover:bg-white/5 transition">
                  <span className="inline-flex items-center gap-2"><X size={13} /> Hide Layer</span>
                </button>
              )}

              {error && (
                <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[0.04] p-3 text-[10px] leading-relaxed text-red-300">
                  {error}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <MapPin size={14} className="text-cyan-400" />
                <span className="text-xs font-semibold">Current selection</span>
              </div>
              <div className="text-[10px] text-gray-500">
                {selection ? selection.type : "No selection"}
              </div>
              <div className="mt-2 font-mono text-[10px] text-gray-600">
                {coordinates.lat.toFixed(6)}, {coordinates.lng.toFixed(6)}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <CalendarDays size={14} className="text-cyan-400" />
                <span className="text-xs font-semibold">Data source</span>
              </div>
              <div className="text-xs text-gray-300">Sentinel-2 L2A</div>
              <div className="text-[10px] text-gray-600 mt-1">Processed through Sentinel Hub</div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
