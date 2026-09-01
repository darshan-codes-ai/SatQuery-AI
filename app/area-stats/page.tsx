"use client";

import { useState } from "react";
import SatelliteMap from "@/components/SatelliteMap";
import TopNav from "@/components/TopNav";
import {
  BarChart3,
  CheckCircle2,
  Droplets,
  Leaf,
  Loader2,
  MapPinned,
  Ruler,
  Building2,
  Satellite,
} from "lucide-react";

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

type AreaStats = {
  success: boolean;
  area?: {
    km2: number;
    hectares: number;
  };
  coverage?: {
    validDataPercent: number;
    sampleCount: number;
    noDataCount: number;
    geometryPixelCount: number;
  };
  estimatedBreakdown?: {
    vegetationPercent: number;
    waterPercent: number;
    builtupPercent: number;
    otherPercent: number;
    vegetationHa: number;
    waterHa: number;
    builtupHa: number;
    otherHa: number;
  };
  acquisitionDate?: string | null;
  cloudCoverage?: number;
  note?: string;
  error?: string;
};

export default function AreaStatsPage() {
  const [selection, setSelection] = useState<SelectionGeometry | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinates>({
    lat: 20,
    lng: 0,
  });
  const [stats, setStats] = useState<AreaStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const calculateStatistics = async () => {
    if (!selection) {
      setError("Select a point or draw an area on the map first.");
      return;
    }

    setLoading(true);
    setError("");
    setStats(null);

    try {
      const params = new URLSearchParams({
        geometry: JSON.stringify(selection),
      });

      const response = await fetch(`/api/area-stats?${params.toString()}`, {
        cache: "no-store",
      });

      const data = (await response.json()) as AreaStats;

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Area statistics could not be calculated.");
      }

      setStats(data);
    } catch (err) {
      console.error("SatQuery area statistics error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Area statistics could not be calculated."
      );
    } finally {
      setLoading(false);
    }
  };

  const breakdown = stats?.estimatedBreakdown;

  return (
    <main className="min-h-screen bg-[#040812] text-white">
      <header className="relative z-50 h-16 border-b border-white/10 bg-[#060b16]/95 backdrop-blur-xl">
        <div className="h-full px-5 flex items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-400/10 border border-cyan-400/20 flex items-center justify-center">
              <Satellite size={20} className="text-cyan-400" />
            </div>
            <div>
              <div className="font-bold tracking-wide">
                SATQUERY <span className="text-cyan-400">AI</span>
              </div>
              <div className="text-[9px] text-gray-500 tracking-[0.2em]">
                EARTH OBSERVATION
              </div>
            </div>
          </a>

          <TopNav />

          <div className="hidden md:flex items-center gap-2 text-xs text-gray-500">
            <MapPinned size={14} className="text-cyan-400" />
            AREA STATISTICS
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_390px] min-h-[calc(100vh-64px)]">
        <section className="min-w-0 border-r border-white/10">
          <div className="h-14 border-b border-white/10 flex items-center justify-between px-5">
            <div>
              <div className="text-sm font-semibold">Area Statistics</div>
              <div className="text-[10px] text-gray-500">
                Select an area to estimate land-signal composition
              </div>
            </div>

            <div className="text-[10px] text-gray-600 font-mono">
              {coordinates.lat.toFixed(4)}, {coordinates.lng.toFixed(4)}
            </div>
          </div>

          <div className="relative h-[calc(100vh-120px)] min-h-[560px] bg-[#07111c]">
            <SatelliteMap
              onCoordinatesChange={setCoordinates}
              onSelectionChange={setSelection}
            />
          </div>
        </section>

        <aside className="bg-[#060b15] flex flex-col">
          <div className="border-b border-white/10 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-cyan-400/10 flex items-center justify-center">
                <BarChart3 size={18} className="text-cyan-400" />
              </div>
              <div>
                <div className="font-semibold text-sm">Selected Area Analysis</div>
                <div className="text-[10px] text-gray-500">Sentinel-2 statistics</div>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-2">
                Selection
              </div>
              <div className="text-sm text-gray-300">
                {selection?.type === "Polygon"
                  ? "Polygon / drawn area"
                  : selection?.type === "Point"
                    ? "Point analysis footprint"
                    : "No area selected"}
              </div>
              <div className="text-[10px] text-gray-600 mt-2">
                {selection
                  ? "Ready to calculate"
                  : "Use Point, Rectangle or Polygon on the map"}
              </div>
            </div>

            <button
              type="button"
              onClick={calculateStatistics}
              disabled={!selection || loading}
              className="w-full rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-black transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Calculating Sentinel-2 statistics...
                </span>
              ) : (
                "Calculate Area Statistics"
              )}
            </button>

            {error && (
              <div className="rounded-xl border border-red-400/20 bg-red-400/[0.04] p-3 text-xs text-red-300">
                {error}
              </div>
            )}

            {stats?.area && (
              <div className="grid grid-cols-2 gap-3">
                <StatCard
                  icon={<Ruler size={16} />}
                  label="Area"
                  value={`${stats.area.km2.toFixed(3)} km²`}
                />
                <StatCard
                  icon={<Ruler size={16} />}
                  label="Hectares"
                  value={`${stats.area.hectares.toFixed(2)} ha`}
                />
              </div>
            )}

            {breakdown && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-xs font-semibold">Land-signal breakdown</span>
                  <CheckCircle2 size={15} className="text-emerald-400" />
                </div>

                <BreakdownRow
                  icon={<Leaf size={15} />}
                  label="Vegetation"
                  percent={breakdown.vegetationPercent}
                  hectares={breakdown.vegetationHa}
                  barClass="bg-emerald-400"
                />
                <BreakdownRow
                  icon={<Droplets size={15} />}
                  label="Water"
                  percent={breakdown.waterPercent}
                  hectares={breakdown.waterHa}
                  barClass="bg-cyan-400"
                />
                <BreakdownRow
                  icon={<Building2 size={15} />}
                  label="Built-up"
                  percent={breakdown.builtupPercent}
                  hectares={breakdown.builtupHa}
                  barClass="bg-orange-400"
                />
                <BreakdownRow
                  icon={<BarChart3 size={15} />}
                  label="Other"
                  percent={breakdown.otherPercent}
                  hectares={breakdown.otherHa}
                  barClass="bg-gray-400"
                />
              </div>
            )}

            {stats?.coverage && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="text-xs font-semibold mb-3">Data quality</div>
                <div className="flex justify-between text-[10px] text-gray-500 mb-2">
                  <span>Valid satellite pixels</span>
                  <span>{stats.coverage.validDataPercent.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-cyan-400"
                    style={{ width: `${Math.min(100, Math.max(0, stats.coverage.validDataPercent))}%` }}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] text-gray-500">
                  <div>Samples: <span className="text-gray-300">{stats.coverage.sampleCount}</span></div>
                  <div>No data: <span className="text-gray-300">{stats.coverage.noDataCount}</span></div>
                </div>
              </div>
            )}

            {stats && (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-[10px] text-gray-500 space-y-2">
                <div>
                  Acquisition: <span className="text-gray-300">{stats.acquisitionDate ? new Date(stats.acquisitionDate).toLocaleString() : "Unknown"}</span>
                </div>
                <div>
                  Cloud coverage: <span className="text-gray-300">{(stats.cloudCoverage ?? 0).toFixed(1)}%</span>
                </div>
                {stats.note && <div className="pt-2 leading-relaxed">{stats.note}</div>}
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-cyan-400">{icon}<span className="text-[10px] text-gray-500">{label}</span></div>
      <div className="text-lg font-bold mt-2">{value}</div>
    </div>
  );
}

function BreakdownRow({
  icon,
  label,
  percent,
  hectares,
  barClass,
}: {
  icon: React.ReactNode;
  label: string;
  percent: number;
  hectares: number;
  barClass: string;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="flex items-center justify-between text-xs mb-2">
        <div className="flex items-center gap-2 text-gray-300">{icon}{label}</div>
        <div className="text-gray-500">{percent.toFixed(1)}%</div>
      </div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
      </div>
      <div className="text-[9px] text-gray-600 mt-1">{hectares.toFixed(2)} ha</div>
    </div>
  );
}
