import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase/server";

type Coordinates = { lat: number; lng: number };
type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] };

type CatalogFeature = { id?: string; properties?: { datetime?: string; "eo:cloud_cover"?: number | string } };
type CatalogResponse = { features?: CatalogFeature[] };
type Stats = { mean?: number | string | null; sampleCount?: number | string; noDataCount?: number | string };
type OutputStats = { bands?: { B0?: { stats?: Stats } } };
type StatisticsRow = { interval?: { from?: string; to?: string }; outputs?: { ndvi?: OutputStats; ndwi?: OutputStats; ndbi?: OutputStats } };
type StatisticsResponse = { data?: StatisticsRow[]; geometryPixelCount?: number | string };

const AUTH_URL = "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";
const CATALOG_URL = "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search";
const STATISTICS_URL = "https://services.sentinel-hub.com/api/v1/statistics";

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
  return fallback;
}

function isCoordPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number" && Number.isFinite(value[0]) && Number.isFinite(value[1]) && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

function normalizeGeometry(input: unknown): Geometry | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (value.type === "Point" && isCoordPair(value.coordinates)) return { type: "Point", coordinates: value.coordinates };
  if (value.type === "Polygon" && Array.isArray(value.coordinates)) {
    const rings = value.coordinates as unknown[];
    if (!Array.isArray(rings[0])) return null;
    const ring = (rings[0] as unknown[]).filter(isCoordPair);
    if (ring.length < 3) return null;
    const first = ring[0], last = ring[ring.length - 1];
    const closed = first[0] === last[0] && first[1] === last[1];
    return { type: "Polygon", coordinates: [closed ? ring : [...ring, first]] };
  }
  return null;
}

function processingGeometry(geometry: Geometry): Geometry {
  if (geometry.type === "Polygon") return geometry;
  const [lng, lat] = geometry.coordinates;
  const size = 0.0025;
  return { type: "Polygon", coordinates: [[[lng - size, lat - size], [lng + size, lat - size], [lng + size, lat + size], [lng - size, lat + size], [lng - size, lat - size]]] };
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Sentinel Hub credentials are missing.");
  const response = await fetch(AUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }), cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sentinel Hub authentication failed (${response.status}).`);
  const data = JSON.parse(text) as { access_token?: string };
  if (!data.access_token) throw new Error("Sentinel Hub did not return an access token.");
  return data.access_token;
}

function dayWindow(dateString: string, days = 30) {
  const target = new Date(`${dateString}T12:00:00Z`);
  if (Number.isNaN(target.getTime())) throw new Error(`Invalid date: ${dateString}`);
  return { from: new Date(target.getTime() - days * 86400000), to: new Date(target.getTime() + days * 86400000), target };
}

async function findCandidateScenes(accessToken: string, geometry: Geometry, targetDate: string): Promise<CatalogFeature[]> {
  const { from, to, target } = dayWindow(targetDate);
  const response = await fetch(CATALOG_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/geo+json" },
    body: JSON.stringify({ intersects: geometry, datetime: `${from.toISOString()}/${to.toISOString()}`, collections: ["sentinel-2-l2a"], limit: 50, fields: { include: ["id", "properties.datetime", "properties.eo:cloud_cover"] } }),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sentinel Hub Catalog API error (${response.status}): ${text}`);
  const data = JSON.parse(text) as CatalogResponse;
  const features = Array.isArray(data.features) ? data.features : [];
  features.sort((a, b) => {
    const cloudA = toNumber(a.properties?.["eo:cloud_cover"], 100), cloudB = toNumber(b.properties?.["eo:cloud_cover"], 100);
    const dateA = new Date(a.properties?.datetime ?? 0).getTime(), dateB = new Date(b.properties?.datetime ?? 0).getTime();
    return Math.abs(dateA - target.getTime()) / 86400000 * 0.5 + cloudA - (Math.abs(dateB - target.getTime()) / 86400000 * 0.5 + cloudB);
  });
  return features;
}

const EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B03", "B04", "B08", "B11", "SCL", "dataMask"] }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndwi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndbi", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1, sampleType: "UINT8" }
    ]
  };
}
function evaluatePixel(sample) {
  const invalid = sample.dataMask === 0 || sample.SCL === 0 || sample.SCL === 1 || sample.SCL === 3 || sample.SCL === 8 || sample.SCL === 9 || sample.SCL === 10 || sample.SCL === 11;
  if (invalid) return { ndvi: [0], ndwi: [0], ndbi: [0], dataMask: [0] };
  const ndviDen = sample.B08 + sample.B04;
  const ndwiDen = sample.B03 + sample.B08;
  const ndbiDen = sample.B11 + sample.B08;
  return {
    ndvi: [ndviDen !== 0 ? (sample.B08 - sample.B04) / ndviDen : 0],
    ndwi: [ndwiDen !== 0 ? (sample.B03 - sample.B08) / ndwiDen : 0],
    ndbi: [ndbiDen !== 0 ? (sample.B11 - sample.B08) / ndbiDen : 0],
    dataMask: [1]
  };
}
`;

async function getStatsForScene(accessToken: string, geometry: Geometry, scene: CatalogFeature): Promise<StatisticsResponse> {
  const dateString = scene.properties?.datetime;
  if (!dateString) throw new Error("Scene has no acquisition date.");
  const sceneDate = new Date(dateString);
  if (Number.isNaN(sceneDate.getTime())) throw new Error("Invalid scene acquisition date.");
  const from = new Date(sceneDate.getTime() - 12 * 60 * 60 * 1000), to = new Date(sceneDate.getTime() + 12 * 60 * 60 * 1000);
  const body = {
    input: {
      bounds: { geometry, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
      data: [{ type: "sentinel-2-l2a", dataFilter: { timeRange: { from: from.toISOString(), to: to.toISOString() }, maxCloudCoverage: 100, mosaickingOrder: "leastCC" } }],
    },
    aggregation: { timeRange: { from: from.toISOString(), to: to.toISOString() }, aggregationInterval: { of: "P1D" }, width: 128, height: 128, evalscript: EVALSCRIPT },
    calculations: { default: {} },
  };
  const response = await fetch(STATISTICS_URL, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`Statistics API error (${response.status}): ${text}`);
  return JSON.parse(text) as StatisticsResponse;
}

function extractObservation(statistics: StatisticsResponse) {
  if (!Array.isArray(statistics.data)) return null;
  for (const row of statistics.data) {
    const ndviStats = row.outputs?.ndvi?.bands?.B0?.stats, ndwiStats = row.outputs?.ndwi?.bands?.B0?.stats, ndbiStats = row.outputs?.ndbi?.bands?.B0?.stats;
    const ndvi = toNumber(ndviStats?.mean, Number.NaN), ndwi = toNumber(ndwiStats?.mean, Number.NaN), ndbi = toNumber(ndbiStats?.mean, Number.NaN);
    if (Number.isFinite(ndvi) && Number.isFinite(ndwi) && Number.isFinite(ndbi)) return { ndvi, ndwi, ndbi, sampleCount: toNumber(ndviStats?.sampleCount, 0), noDataCount: toNumber(ndviStats?.noDataCount, 0), geometryPixelCount: toNumber(statistics.geometryPixelCount, 0) };
  }
  return null;
}

async function analyzeDate(accessToken: string, geometry: Geometry, targetDate: string) {
  const { target } = dayWindow(targetDate);
  const scenes = await findCandidateScenes(accessToken, geometry, targetDate);
  if (!scenes.length) throw new Error(`No Sentinel-2 scene was found near ${targetDate}.`);
  let lastError = "No valid statistics were returned.";
  for (const scene of scenes.slice(0, 12)) {
    try {
      console.log("Trying change-analysis scene", { targetDate, sceneId: scene.id, acquisitionDate: scene.properties?.datetime, cloudCoverage: scene.properties?.["eo:cloud_cover"] });
      const observation = extractObservation(await getStatsForScene(accessToken, geometry, scene));
      if (!observation || observation.geometryPixelCount <= 0) { lastError = `scene ${scene.id ?? "unknown"} returned no usable pixels`; continue; }
      return { ...observation, targetDate, targetTimestamp: target.toISOString(), acquisitionDate: scene.properties?.datetime ?? null, cloudCoverage: toNumber(scene.properties?.["eo:cloud_cover"], 0), sceneId: scene.id ?? null };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "scene statistics request failed";
      console.warn("Skipping change-analysis scene", scene.id, lastError);
    }
  }
  throw new Error(`Sentinel-2 scenes near ${targetDate} were found, but none returned valid statistics. Last issue: ${lastError}`);
}

function percentageChange(before: number, after: number): number { return ((after - before) / Math.max(Math.abs(before), 0.05)) * 100; }
function safeRounded(value: number, digits = 3) { return Number(value.toFixed(digits)); }

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const coordinates = body.coordinates as Coordinates | undefined;
    const beforeDate = body.beforeDate;
    const afterDate = body.afterDate;
    const rawSelection = normalizeGeometry(body.selection);

    if (!coordinates || typeof coordinates.lat !== "number" || typeof coordinates.lng !== "number") return NextResponse.json({ success: false, error: "Valid map coordinates are required." }, { status: 400 });
    if (!Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng) || coordinates.lat < -90 || coordinates.lat > 90 || coordinates.lng < -180 || coordinates.lng > 180) return NextResponse.json({ success: false, error: "Invalid latitude or longitude." }, { status: 400 });
    if (typeof beforeDate !== "string" || typeof afterDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(beforeDate) || !/^\d{4}-\d{2}-\d{2}$/.test(afterDate)) return NextResponse.json({ success: false, error: "Valid Before and After dates are required." }, { status: 400 });
    if (beforeDate >= afterDate) return NextResponse.json({ success: false, error: "Before date must be earlier than After date." }, { status: 400 });
    if (!rawSelection) return NextResponse.json({ success: false, error: "A valid point or polygon selection is required." }, { status: 400 });

    const geometry = processingGeometry(rawSelection);
    const accessToken = await getAccessToken();
    const [before, after] = await Promise.all([analyzeDate(accessToken, geometry, beforeDate), analyzeDate(accessToken, geometry, afterDate)]);

    const change = { ndvi: percentageChange(before.ndvi, after.ndvi), ndwi: percentageChange(before.ndwi, after.ndwi), ndbi: percentageChange(before.ndbi, after.ndbi) };
    const ndviDelta = after.ndvi - before.ndvi, ndwiDelta = after.ndwi - before.ndwi, ndbiDelta = after.ndbi - before.ndbi;
    const findings: string[] = [];
    if (ndviDelta < -0.05) findings.push("vegetation signal decreased"); else if (ndviDelta > 0.05) findings.push("vegetation signal increased");
    if (ndwiDelta > 0.05) findings.push("water signal increased"); else if (ndwiDelta < -0.05) findings.push("water signal decreased");
    if (ndbiDelta > 0.05) findings.push("built-up signal increased"); else if (ndbiDelta < -0.05) findings.push("built-up signal decreased");
    const summary = findings.length ? `Between ${beforeDate} and ${afterDate}, the selected area shows that ${findings.join(", ")}. These are spectral-index changes and should be interpreted with the imagery and acquisition conditions.` : `Between ${beforeDate} and ${afterDate}, no large change was detected in the selected area's NDVI, NDWI, or NDBI signals.`;
    const note = "Target dates may resolve to nearby Sentinel-2 acquisition dates. Change values are spectral-index differences and should be interpreted together with the satellite evidence and cloud conditions.";

    const payload = {
      success: true,
      before: { ndvi: safeRounded(before.ndvi), ndwi: safeRounded(before.ndwi), ndbi: safeRounded(before.ndbi) },
      after: { ndvi: safeRounded(after.ndvi), ndwi: safeRounded(after.ndwi), ndbi: safeRounded(after.ndbi) },
      change: { ndvi: safeRounded(change.ndvi, 1), ndwi: safeRounded(change.ndwi, 1), ndbi: safeRounded(change.ndbi, 1) },
      deltas: { ndvi: safeRounded(ndviDelta), ndwi: safeRounded(ndwiDelta), ndbi: safeRounded(ndbiDelta) },
      beforeDate, afterDate,
      beforeAcquisitionDate: before.acquisitionDate,
      afterAcquisitionDate: after.acquisitionDate,
      beforeCloudCoverage: safeRounded(before.cloudCoverage, 1),
      afterCloudCoverage: safeRounded(after.cloudCoverage, 1),
      beforeSceneId: before.sceneId,
      afterSceneId: after.sceneId,
      summary,
      note,
    };

    // Persistence is intentionally non-blocking: a database issue must never
    // make an otherwise successful satellite comparison fail.
    try {
      const supabase = getSupabaseServer();
      if (supabase) {
        const { error: saveError } = await supabase.from("change_detection_history").insert({
          latitude: coordinates.lat,
          longitude: coordinates.lng,
          geometry: rawSelection,
          before_target_date: beforeDate,
          after_target_date: afterDate,
          before_acquisition_date: before.acquisitionDate,
          after_acquisition_date: after.acquisitionDate,
          before_scene_id: before.sceneId,
          after_scene_id: after.sceneId,
          before_ndvi: before.ndvi,
          after_ndvi: after.ndvi,
          before_ndwi: before.ndwi,
          after_ndwi: after.ndwi,
          before_ndbi: before.ndbi,
          after_ndbi: after.ndbi,
          ndvi_delta: ndviDelta,
          ndwi_delta: ndwiDelta,
          ndbi_delta: ndbiDelta,
          ndvi_change_percent: change.ndvi,
          ndwi_change_percent: change.ndwi,
          ndbi_change_percent: change.ndbi,
          before_cloud_coverage: before.cloudCoverage,
          after_cloud_coverage: after.cloudCoverage,
          summary,
          note,
        });
        if (saveError) console.warn("SatQuery change history save failed:", saveError.message);
      }
    } catch (saveError) {
      console.warn("SatQuery change history persistence failed:", saveError);
    }

    return NextResponse.json(payload);
  } catch (error) {
    console.error("SatQuery change analysis error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Change analysis failed." }, { status: 500 });
  }
}
