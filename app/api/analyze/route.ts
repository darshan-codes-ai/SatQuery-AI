import { NextResponse } from "next/server";
import { detectAnalysisType } from "@/lib/remote-sensing/query-parser";

type Coordinates = { lat: number; lng: number };
type SelectionGeometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] };
type TokenResponse = { access_token?: string };
type Stats = { min?: number | string; max?: number | string; mean?: number | string | null; stDev?: number | string; sampleCount?: number | string; noDataCount?: number | string };
type OutputStats = { bands?: { B0?: { stats?: Stats } } };
type StatisticsRow = { interval?: { from?: string; to?: string }; outputs?: { ndvi?: OutputStats; ndwi?: OutputStats; ndbi?: OutputStats } };
type StatisticsResponse = { data?: StatisticsRow[]; status?: string; geometryPixelCount?: number | string };
type CatalogFeature = { id?: string; properties?: { datetime?: string; "eo:cloud_cover"?: number | string } };
type CatalogResponse = { features?: CatalogFeature[] };

const SENTINEL_AUTH_URL = "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";
const SENTINEL_CATALOG_URL = "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search";
const SENTINEL_STATISTICS_URL = "https://services.sentinel-hub.com/api/v1/statistics";

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
  return fallback;
}

function validCoordinatePair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number" && Number.isFinite(value[0]) && Number.isFinite(value[1]) && value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

function normalizeSelection(value: unknown): SelectionGeometry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (input.type === "Point" && validCoordinatePair(input.coordinates)) return { type: "Point", coordinates: input.coordinates };
  if (input.type === "Polygon" && Array.isArray(input.coordinates)) {
    const firstRing = Array.isArray(input.coordinates[0]) ? input.coordinates[0] : [];
    const ring = firstRing.filter(validCoordinatePair);
    if (ring.length < 3) return undefined;
    const first = ring[0], last = ring[ring.length - 1];
    return { type: "Polygon", coordinates: [first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]] };
  }
  return undefined;
}

function pointToPolygon(coordinates: [number, number], size = 0.0025): [number, number][] {
  const [lng, lat] = coordinates;
  return [[lng - size, lat - size], [lng + size, lat - size], [lng + size, lat + size], [lng - size, lat + size], [lng - size, lat - size]];
}

function getAnalysisGeometry(coordinates: Coordinates, selection?: SelectionGeometry) {
  if (selection?.type === "Polygon") return { type: "Polygon" as const, coordinates: selection.coordinates };
  const point: [number, number] = selection?.type === "Point" ? selection.coordinates : [coordinates.lng, coordinates.lat];
  return { type: "Polygon" as const, coordinates: [pointToPolygon(point)] };
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Sentinel Hub credentials are missing. Check .env.local.");
  const response = await fetch(SENTINEL_AUTH_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }), cache: "no-store" });
  if (!response.ok) throw new Error(`Sentinel Hub authentication failed (${response.status}).`);
  const data = (await response.json()) as TokenResponse;
  if (!data.access_token) throw new Error("Sentinel Hub did not return an access token.");
  return data.access_token;
}

async function findSentinelScenes(accessToken: string, geometry: SelectionGeometry): Promise<CatalogFeature[]> {
  const to = new Date(), from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
  const response = await fetch(SENTINEL_CATALOG_URL, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/geo+json" }, body: JSON.stringify({ intersects: geometry, datetime: `${from.toISOString()}/${to.toISOString()}`, collections: ["sentinel-2-l2a"], limit: 30, fields: { include: ["id", "properties.datetime", "properties.eo:cloud_cover"] } }), cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sentinel Hub Catalog API error (${response.status}): ${text}`);
  const data = JSON.parse(text) as CatalogResponse;
  const features = Array.isArray(data.features) ? data.features : [];
  features.sort((a, b) => { const cloudA = toNumber(a.properties?.["eo:cloud_cover"], 100), cloudB = toNumber(b.properties?.["eo:cloud_cover"], 100); if (cloudA !== cloudB) return cloudA - cloudB; return new Date(b.properties?.datetime ?? 0).getTime() - new Date(a.properties?.datetime ?? 0).getTime(); });
  return features;
}

const EVALSCRIPT = `
//VERSION=3
function setup() {
  return { input: [{ bands: ["B03", "B04", "B08", "B11", "SCL", "dataMask"] }], output: [
    { id: "ndvi", bands: 1, sampleType: "FLOAT32" }, { id: "ndwi", bands: 1, sampleType: "FLOAT32" },
    { id: "ndbi", bands: 1, sampleType: "FLOAT32" }, { id: "dataMask", bands: 1, sampleType: "UINT8" }
  ] };
}
function evaluatePixel(sample) {
  const invalid = sample.dataMask === 0 || sample.SCL === 0 || sample.SCL === 1 || sample.SCL === 3 || sample.SCL === 8 || sample.SCL === 9 || sample.SCL === 10 || sample.SCL === 11;
  if (invalid) return { ndvi: [0], ndwi: [0], ndbi: [0], dataMask: [0] };
  const a = sample.B08 + sample.B04, b = sample.B03 + sample.B08, c = sample.B11 + sample.B08;
  return { ndvi: [a !== 0 ? (sample.B08 - sample.B04) / a : 0], ndwi: [b !== 0 ? (sample.B03 - sample.B08) / b : 0], ndbi: [c !== 0 ? (sample.B11 - sample.B08) / c : 0], dataMask: [1] };
}`;

async function getStatisticsForScene(accessToken: string, geometry: SelectionGeometry, scene: CatalogFeature): Promise<StatisticsResponse> {
  const sceneDateString = scene.properties?.datetime;
  if (!sceneDateString) throw new Error("Scene has no acquisition date.");
  const sceneDate = new Date(sceneDateString);
  if (Number.isNaN(sceneDate.getTime())) throw new Error("Scene has an invalid acquisition date.");
  const response = await fetch(SENTINEL_STATISTICS_URL, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ input: { bounds: { geometry, properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } }, data: [{ type: "sentinel-2-l2a", dataFilter: { maxCloudCoverage: 100, mosaickingOrder: "leastCC" } }] }, aggregation: { timeRange: { from: new Date(sceneDate.getTime() - 12 * 60 * 60 * 1000).toISOString(), to: new Date(sceneDate.getTime() + 12 * 60 * 60 * 1000).toISOString() }, aggregationInterval: { of: "P1D" }, width: 128, height: 128, evalscript: EVALSCRIPT }, calculations: { default: {} } }), cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`Statistics API error (${response.status}): ${text}`);
  return JSON.parse(text) as StatisticsResponse;
}

function extractObservation(statistics: StatisticsResponse) {
  if (!Array.isArray(statistics.data)) return null;
  for (const row of statistics.data) {
    const ndviStats = row.outputs?.ndvi?.bands?.B0?.stats, ndwiStats = row.outputs?.ndwi?.bands?.B0?.stats, ndbiStats = row.outputs?.ndbi?.bands?.B0?.stats;
    const ndvi = toNumber(ndviStats?.mean, Number.NaN), ndwi = toNumber(ndwiStats?.mean, Number.NaN), ndbi = toNumber(ndbiStats?.mean, Number.NaN);
    if (Number.isFinite(ndvi) && Number.isFinite(ndwi) && Number.isFinite(ndbi)) return { row, ndvi, ndwi, ndbi, ndviStats, ndwiStats, ndbiStats, statistics };
  }
  return null;
}

async function findUsableObservation(accessToken: string, geometry: SelectionGeometry, scenes: CatalogFeature[]) {
  for (const scene of scenes.slice(0, 12)) {
    try { const statistics = await getStatisticsForScene(accessToken, geometry, scene); const observation = extractObservation(statistics); if (observation) return { ...observation, scene }; }
    catch (error) { console.warn("Scene skipped:", scene.id, error); }
  }
  return null;
}

function vegetationInterpretation(ndvi: number): string {
  if (ndvi >= 0.6) return "strong vegetation activity";
  if (ndvi >= 0.35) return "moderate vegetation activity";
  if (ndvi >= 0.15) return "sparse vegetation activity";
  return "low vegetation activity";
}
function waterInterpretation(ndwi: number): string {
  if (ndwi >= 0.3) return "a strong water-related spectral signal";
  if (ndwi >= 0.1) return "a moderate water-related spectral signal";
  if (ndwi >= -0.05) return "a limited water-related spectral signal";
  return "a low water-related spectral signal";
}
function builtUpInterpretation(ndbi: number): string {
  if (ndbi >= 0.3) return "a strong built-up surface signal";
  if (ndbi >= 0.1) return "a moderate built-up surface signal";
  if (ndbi >= -0.05) return "a limited built-up surface signal";
  return "a low built-up surface signal";
}

function confidenceDetails(coverage: number, cloudCoverage: number) {
  const validPixelScore = Math.max(0, Math.min(1, coverage / 100));
  const cloudQualityScore = Math.max(0, Math.min(1, 1 - cloudCoverage / 100));
  const value = Math.max(0, Math.min(1, validPixelScore * 0.7 + cloudQualityScore * 0.3));
  const label = value >= 0.8 ? "High" : value >= 0.55 ? "Moderate" : "Low";
  const explanation = label === "High"
    ? "High confidence: strong valid-pixel coverage and acceptable scene cloud conditions."
    : label === "Moderate"
      ? "Moderate confidence: the result is usable, but missing pixels or cloud conditions reduce certainty."
      : "Low confidence: limited valid coverage or unfavorable cloud conditions mean the result should be treated cautiously.";
  return { value: Number(value.toFixed(2)), label, explanation, components: { validPixelScore: Number(validPixelScore.toFixed(2)), cloudQualityScore: Number(cloudQualityScore.toFixed(2)) } };
}

function createInterpretation(ndvi: number, ndwi: number, ndbi: number, coverage: number, cloudCoverage: number) {
  const vegetation = vegetationInterpretation(ndvi), water = waterInterpretation(ndwi), builtUp = builtUpInterpretation(ndbi), confidence = confidenceDetails(coverage, cloudCoverage);
  let overall: string;
  if (ndbi >= 0.25 && ndvi < 0.35) overall = "The selected area appears predominantly built-up, with limited to moderate vegetation activity.";
  else if (ndvi >= 0.55 && ndbi < 0.1) overall = "The selected area appears predominantly vegetated, with relatively limited built-up surface signal.";
  else if (ndwi >= 0.25) overall = "The selected area has a notable water-related spectral signal, with surrounding surface characteristics varying by location.";
  else overall = "The selected area shows a mixed spectral profile across vegetation, water and built-up surfaces.";
  return {
    vegetation, water, builtUp, overall, confidenceLabel: confidence.label, confidenceText: confidence.explanation,
    text: `SatQuery AI Interpretation:\n\n• Vegetation: The area shows ${vegetation}.\n• Water: The area shows ${water}.\n• Built-up: The area shows ${builtUp}.\n\nOverall assessment: ${overall}\n\nData quality: ${confidence.explanation}`,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json(), query = body.query, coordinates = body.coordinates as Coordinates | undefined, selection = normalizeSelection(body.selection);
    if (typeof query !== "string" || !query.trim()) return NextResponse.json({ success: false, error: "A valid query is required." }, { status: 400 });
    if (!coordinates || typeof coordinates.lat !== "number" || typeof coordinates.lng !== "number" || !Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng)) return NextResponse.json({ success: false, error: "Valid map coordinates are required." }, { status: 400 });
    if (coordinates.lat < -90 || coordinates.lat > 90 || coordinates.lng < -180 || coordinates.lng > 180) return NextResponse.json({ success: false, error: "Invalid latitude or longitude." }, { status: 400 });

    const geometry = getAnalysisGeometry(coordinates, selection), analysisType = detectAnalysisType(query), accessToken = await getAccessToken(), scenes = await findSentinelScenes(accessToken, geometry);
    if (!scenes.length) throw new Error("No Sentinel-2 scene was found for the selected area during the last year. Try selecting a different area.");
    const result = await findUsableObservation(accessToken, geometry, scenes);
    if (!result) throw new Error("Sentinel-2 scenes were found, but none returned valid NDVI, NDWI and NDBI statistics for the selected area. Try a nearby area or a larger selection.");

    const ndvi = toNumber(result.ndvi), ndwi = toNumber(result.ndwi), ndbi = toNumber(result.ndbi);
    const sampleCount = toNumber(result.ndviStats?.sampleCount), noDataCount = toNumber(result.ndviStats?.noDataCount), geometryPixelCount = toNumber(result.statistics.geometryPixelCount);
    const validPixels = Math.max(0, sampleCount - noDataCount);
    const coverage = geometryPixelCount > 0 ? Math.min(100, (validPixels / geometryPixelCount) * 100) : 0;
    const cloudCoverage = Math.max(0, Math.min(100, toNumber(result.scene.properties?.["eo:cloud_cover"], 0)));
    const confidence = confidenceDetails(coverage, cloudCoverage);
    const interpretation = createInterpretation(ndvi, ndwi, ndbi, coverage, cloudCoverage);

    let primaryValue = ndvi, baseResponse = "";
    switch (analysisType) {
      case "ndvi": primaryValue = ndvi; baseResponse = `The selected area has a mean Sentinel-2 NDVI of ${ndvi.toFixed(2)}. Higher NDVI values generally indicate stronger vegetation activity.`; break;
      case "ndwi": primaryValue = ndwi; baseResponse = `The selected area has a mean Sentinel-2 NDWI of ${ndwi.toFixed(2)}. Higher NDWI values generally indicate stronger surface-water signals.`; break;
      case "ndbi": primaryValue = ndbi; baseResponse = `The selected area has a mean Sentinel-2 NDBI of ${ndbi.toFixed(2)}. Higher NDBI values can indicate relatively built-up surfaces.`; break;
      case "change": baseResponse = `This is a temporal-change query. Reliable change detection requires comparable observations from multiple dates.`; break;
      default: baseResponse = `The selected Sentinel-2 area was analyzed successfully. Mean NDVI is ${ndvi.toFixed(2)}, mean NDWI is ${ndwi.toFixed(2)}, and mean NDBI is ${ndbi.toFixed(2)}.`;
    }

    return NextResponse.json({
      success: true, query: query.trim(), coordinates, geometry,
      analysis: { type: analysisType, indices: { ndvi: Number(ndvi.toFixed(3)), ndwi: Number(ndwi.toFixed(3)), ndbi: Number(ndbi.toFixed(3)) }, primaryValue: Number(primaryValue.toFixed(3)), coverage: Number(coverage.toFixed(1)) },
      response: `${baseResponse}\n\n${interpretation.text}`,
      interpretation,
      confidence: confidence.value,
      metadata: {
        sensor: "Sentinel-2 L2A", acquisitionDate: result.scene.properties?.datetime ?? null, cloudCoverage,
        processingResolution: "20m", processing: "Sentinel Hub Catalog + Statistical API",
        dataQuality: { sampleCount, noDataCount, geometryPixelCount, validPixels, validPixelCoveragePercent: Number(coverage.toFixed(1)), confidenceLabel: confidence.label, confidenceComponents: confidence.components },
      },
    });
  } catch (error) {
    console.error("SatQuery analysis error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Satellite analysis failed." }, { status: 500 });
  }
}
