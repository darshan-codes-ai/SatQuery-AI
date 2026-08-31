"use client";

import { useState } from "react";
import Link from "next/link";
import SatelliteMap from "@/components/SatelliteMap";
import TopNav from "@/components/TopNav";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Layers,
  MapPin,
  Satellite,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
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

type ChangeResults = {
  before: { ndvi: number; ndwi: number; ndbi: number };
  after: { ndvi: number; ndwi: number; ndbi: number };
  change: { ndvi: number; ndwi: number; ndbi: number };
  deltas?: { ndvi: number; ndwi: number; ndbi: number };
  beforeDate: string;
  afterDate: string;
  beforeAcquisitionDate?: string | null;
  afterAcquisitionDate?: string | null;
  beforeCloudCoverage?: number;
  afterCloudCoverage?: number;
  summary?: string;
  note?: string;
};

export default function ChangeDetectionPage() {
  const [selectedCoordinates, setSelectedCoordinates] = useState<Coordinates>({
    lat: 17.385,
    lng: 78.4867,
  });

  const [selection, setSelection] = useState<SelectionGeometry>({
    type: "Point",
    coordinates: [78.4867, 17.385],
  });

  const [beforeDate, setBeforeDate] = useState("2024-08-31");
  const [afterDate, setAfterDate] = useState("2026-08-31");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<ChangeResults | null>(null);
  const [heatmapIndex, setHeatmapIndex] = useState<"ndvi" | "ndwi" | "ndbi">("ndvi");
  const [changeHeatmapUrl, setChangeHeatmapUrl] = useState<string | null>(null);
  const [changeHeatmapBounds, setChangeHeatmapBounds] = useState<
    [[number, number], [number, number], [number, number], [number, number]] | null
  >(null);
  const [isHeatmapLoading, setIsHeatmapLoading] = useState(false);
  const [heatmapError, setHeatmapError] = useState("");

  const runChangeAnalysis = async () => {
    setError("");
    setResults(null);
    setHeatmapError("");
    setChangeHeatmapUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
    setChangeHeatmapBounds(null);

    if (beforeDate >= afterDate) {
      setError("The Before date must be earlier than the After date.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/change", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          coordinates: selectedCoordinates,
          selection,
          beforeDate,
          afterDate,
        }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.success) {
        throw new Error(
          data?.error || "Change analysis could not be completed."
        );
      }

      setResults(data as ChangeResults);
    } catch (err) {
      console.error("SatQuery change detection error:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Change analysis could not be completed."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const getHeatmapBounds = () => {
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

  const showChangeHeatmap = async () => {
    if (!results || isHeatmapLoading) return;

    setIsHeatmapLoading(true);
    setHeatmapError("");

    try {
      const geometry = encodeURIComponent(JSON.stringify(selection));
      const beforeObservation = results.beforeAcquisitionDate
        ? `&beforeObservationDate=${encodeURIComponent(results.beforeAcquisitionDate)}`
        : "";
      const afterObservation = results.afterAcquisitionDate
        ? `&afterObservationDate=${encodeURIComponent(results.afterAcquisitionDate)}`
        : "";

      const response = await fetch(
        `/api/change-evidence?index=${heatmapIndex}&geometry=${geometry}&beforeDate=${encodeURIComponent(beforeDate)}&afterDate=${encodeURIComponent(afterDate)}${beforeObservation}${afterObservation}`,
        { cache: "no-store" }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.error || "Change heatmap could not be generated."
        );
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      setChangeHeatmapUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return objectUrl;
      });
      setChangeHeatmapBounds(getHeatmapBounds());
    } catch (err) {
      console.error("SatQuery change heatmap error:", err);
      setHeatmapError(
        err instanceof Error
          ? err.message
          : "Change heatmap could not be generated."
      );
    } finally {
      setIsHeatmapLoading(false);
    }
  };

  const clearHeatmap = () => {
    setHeatmapError("");
    setChangeHeatmapBounds(null);
    setChangeHeatmapUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  };

  const metrics = results
    ? [
        ["NDVI", results.before.ndvi, results.after.ndvi, results.deltas?.ndvi ?? (results.after.ndvi - results.before.ndvi)],
        ["NDWI", results.before.ndwi, results.after.ndwi, results.deltas?.ndwi ?? (results.after.ndwi - results.before.ndwi)],
        ["NDBI", results.before.ndbi, results.after.ndbi, results.deltas?.ndbi ?? (results.after.ndbi - results.before.ndbi)],
      ]
    : [];

  return (
    <main className="min-h-screen bg-[#040812] text-white">
      <header className="h-16 border-b border-white/10 bg-[#060b16]/95 backdrop-blur-xl">
        <div className="h-full px-5 flex items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3 shrink-0">
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
          </Link>

          <TopNav />

          <div className="hidden md:flex items-center gap-2 text-[10px] text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            CHANGE WORKSPACE
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr_390px] min-h-[calc(100vh-64px)]">
        <section className="min-w-0 border-r border-white/10">
          <div className="h-14 border-b border-white/10 px-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link href="/analyze" className="p-2 rounded-lg hover:bg-white/5" title="Back to Analyze">
                <ArrowLeft size={16} className="text-gray-400" />
              </Link>
              <div>
                <div className="text-xs font-semibold">Temporal Change Workspace</div>
                <div className="text-[10px] text-gray-600">Compare the same area across two dates</div>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              <MapPin size={13} className="text-cyan-400" />
              {selectedCoordinates.lat.toFixed(4)}, {selectedCoordinates.lng.toFixed(4)}
            </div>
          </div>

          <div className="relative h-[520px] lg:h-[calc(100vh-390px)] min-h-[500px] bg-[#07111c] overflow-hidden">
            <SatelliteMap
              onCoordinatesChange={setSelectedCoordinates}
              onSelectionChange={(next) => {
                setSelection(next);
                clearHeatmap();
              }}
              changeHeatmapUrl={changeHeatmapUrl}
              changeHeatmapBounds={changeHeatmapBounds}
            />
          </div>

          <div className="border-t border-white/10 p-5">
            <div className="grid md:grid-cols-3 gap-3">
              <InfoCard
                title="Before"
                value={beforeDate}
                subtitle="Target observation date"
                icon={<CalendarDays size={16} />}
              />
              <InfoCard
                title="After"
                value={afterDate}
                subtitle="Target observation date"
                icon={<CalendarDays size={16} />}
              />
              <InfoCard
                title="Selection"
                value={selection.type}
                subtitle="Geometry being compared"
                icon={<Layers size={16} />}
              />
            </div>
          </div>
        </section>

        <aside className="bg-[#060b15] flex flex-col">
          <div className="h-14 border-b border-white/10 px-5 flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-400/10 flex items-center justify-center">
              <CalendarDays size={17} className="text-amber-300" />
            </div>
            <div>
              <div className="text-sm font-semibold">Change Detection</div>
              <div className="text-[10px] text-amber-300/80">BEFORE → AFTER</div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="rounded-2xl border border-amber-400/20 bg-amber-400/[0.03] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Sparkles size={15} className="text-amber-300" />
                Select dates
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                SatQuery will search for the closest usable Sentinel-2 observation near each target date.
              </p>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <DateField label="Before" value={beforeDate} onChange={setBeforeDate} max={afterDate} />
                <DateField label="After" value={afterDate} onChange={setAfterDate} min={beforeDate} />
              </div>

              <button
                type="button"
                onClick={runChangeAnalysis}
                disabled={isLoading}
                className="mt-4 w-full rounded-xl bg-amber-300 text-black py-3 text-xs font-semibold hover:bg-amber-200 disabled:opacity-50 transition"
              >
                {isLoading ? "Comparing Sentinel-2 scenes..." : "Analyze Change"}
              </button>

              {!results && !error && (
                <div className="mt-3 flex items-start gap-2 text-[10px] leading-relaxed text-gray-600">
                  <Search size={13} className="mt-0.5 shrink-0" />
                  Draw a Point, Rectangle, or Polygon on the map first for the most meaningful comparison.
                </div>
              )}

              {error && (
                <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[0.04] p-3 text-[10px] leading-relaxed text-red-300">
                  {error}
                </div>
              )}
            </div>

            {results && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold">Comparison Results</div>
                    <div className="text-[10px] text-gray-600 mt-1">Index-level change for the selected area</div>
                  </div>
                  <CheckCircle2 size={16} className="text-emerald-400" />
                </div>

                <div className="mt-4 space-y-2">
                  {metrics.map(([label, before, after, delta]) => (
                    <div key={String(label)} className="rounded-xl border border-white/5 bg-black/20 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{label}</span>
                        <span className={`flex items-center gap-1 text-[10px] font-semibold ${Number(delta) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {Number(delta) >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                          {Number(delta) > 0 ? "+" : ""}{Number(delta).toFixed(2)}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-3 mt-3">
                        <div>
                          <div className="text-[9px] text-gray-600 uppercase tracking-wider">Before</div>
                          <div className="mt-1 text-lg font-bold">{Number(before).toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-gray-600 uppercase tracking-wider">After</div>
                          <div className="mt-1 text-lg font-bold">{Number(after).toFixed(2)}</div>
                        </div>
                        <div>
                          <div className="text-[9px] text-gray-600 uppercase tracking-wider">Δ Index</div>
                          <div className={`mt-1 text-lg font-bold ${Number(delta) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {Number(delta) > 0 ? "+" : ""}{Number(delta).toFixed(2)}
                          </div>
                        </div>
                      </div>

                      <div className="mt-2 text-[9px] text-gray-600">
                        {Number(delta) > 0 ? "Index signal increased" : Number(delta) < 0 ? "Index signal decreased" : "No material index change"}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 rounded-xl border border-amber-400/10 bg-amber-400/[0.03] p-3 text-[10px] leading-relaxed text-gray-400">
                  {results.summary || "Change analysis completed."}
                </div>

                <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-[9px] leading-relaxed text-gray-600">
                  <div>Before acquisition: {results.beforeAcquisitionDate ?? "N/A"}</div>
                  <div>After acquisition: {results.afterAcquisitionDate ?? "N/A"}</div>
                  <div className="mt-1">Before cloud cover: {results.beforeCloudCoverage ?? "N/A"}%</div>
                  <div>After cloud cover: {results.afterCloudCoverage ?? "N/A"}%</div>
                </div>

                <p className="mt-3 text-[9px] leading-relaxed text-gray-600">
                  Change is shown as an index-point delta (After − Before). Relative percentages are intentionally not emphasized because they become unstable when the baseline index is close to zero.
                </p>

                {results.note && (
                  <p className="mt-3 text-[9px] leading-relaxed text-gray-700">{results.note}</p>
                )}
              </div>
            )}

            {results && (
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Layers size={15} className="text-cyan-400" />
                      <span className="text-xs font-semibold">CHANGE HEATMAP</span>
                    </div>
                    <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
                      Compare the selected index pixel-by-pixel between the two satellite observations.
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {([
                    ["ndvi", "NDVI"],
                    ["ndwi", "NDWI"],
                    ["ndbi", "NDBI"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => {
                        setHeatmapIndex(value);
                        clearHeatmap();
                      }}
                      className={`rounded-lg border px-3 py-2 text-[10px] transition ${
                        heatmapIndex === value
                          ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"
                          : "border-white/10 bg-white/[0.02] text-gray-500 hover:bg-white/5"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={showChangeHeatmap}
                  disabled={isHeatmapLoading}
                  className="mt-3 w-full rounded-lg border border-cyan-400/20 bg-cyan-400/[0.04] py-2.5 text-xs text-gray-300 transition hover:bg-cyan-400/[0.09] disabled:opacity-50"
                >
                  {isHeatmapLoading
                    ? `Generating ${heatmapIndex.toUpperCase()} heatmap...`
                    : changeHeatmapUrl
                      ? `Refresh ${heatmapIndex.toUpperCase()} Heatmap`
                      : `Show ${heatmapIndex.toUpperCase()} Change Heatmap`}
                </button>

                {changeHeatmapUrl && (
                  <button
                    type="button"
                    onClick={clearHeatmap}
                    className="mt-2 w-full rounded-lg border border-white/10 bg-white/[0.02] py-2 text-[10px] text-gray-500 hover:text-gray-300 hover:bg-white/5 transition"
                  >
                    Hide Change Heatmap
                  </button>
                )}

                {heatmapError && (
                  <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[0.04] p-3 text-[10px] leading-relaxed text-red-300">
                    {heatmapError}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-4 text-[9px] text-gray-500">
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-red-500" />Decrease</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-gray-300" />Stable</span>
                  <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-green-400" />Increase</span>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

function DateField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-[9px] uppercase tracking-widest text-gray-500">
        {label}
      </label>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-xs text-white outline-none focus:border-amber-300/30"
      />
    </div>
  );
}

function InfoCard({
  title,
  value,
  subtitle,
  icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-cyan-400">
        {icon}
        <span className="text-[10px] text-gray-500">{title}</span>
      </div>
      <div className="mt-2 text-sm font-semibold truncate">{value}</div>
      <div className="mt-1 text-[9px] text-gray-600">{subtitle}</div>
    </div>
  );
}
