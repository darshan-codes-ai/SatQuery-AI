import { NextResponse } from "next/server";

type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] };
type Index = "ndvi" | "ndwi" | "ndbi";
type CatalogFeature = { id?: string; properties?: { datetime?: string; "eo:cloud_cover"?: number | string } };
type CatalogResponse = { features?: CatalogFeature[] };

const AUTH_URL = "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";
const CATALOG_URL = "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search";
const PROCESS_URL = "https://services.sentinel-hub.com/api/v1/process";

function number(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function coordPair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    typeof value[0] === "number" && typeof value[1] === "number" &&
    Number.isFinite(value[0]) && Number.isFinite(value[1]) &&
    value[0] >= -180 && value[0] <= 180 && value[1] >= -90 && value[1] <= 90;
}

function normalizeGeometry(input: unknown): Geometry | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  if (value.type === "Point" && coordPair(value.coordinates)) return { type: "Point", coordinates: value.coordinates };
  if (value.type === "Polygon" && Array.isArray(value.coordinates) && Array.isArray(value.coordinates[0])) {
    const ring = (value.coordinates[0] as unknown[]).filter(coordPair);
    if (ring.length < 3) return null;
    const first = ring[0], last = ring[ring.length - 1];
    return { type: "Polygon", coordinates: [first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first]] };
  }
  return null;
}

function processingGeometry(geometry: Geometry): Geometry {
  if (geometry.type === "Polygon") return geometry;
  const [lng, lat] = geometry.coordinates;
  const size = 0.0025;
  return { type: "Polygon", coordinates: [[[lng - size, lat - size], [lng + size, lat - size], [lng + size, lat + size], [lng - size, lat + size], [lng - size, lat - size]]] };
}

function bbox(geometry: Geometry): [number, number, number, number] {
  const polygon = processingGeometry(geometry).coordinates[0];
  const lngs = polygon.map(([lng]) => lng), lats = polygon.map(([, lat]) => lat);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

async function getToken() {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Sentinel Hub credentials are missing.");
  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sentinel Hub authentication failed (${response.status}).`);
  const data = JSON.parse(text) as { access_token?: string };
  if (!data.access_token) throw new Error("Sentinel Hub did not return an access token.");
  return data.access_token;
}

function sceneWindow(dateString: string, hours: number) {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${dateString}`);
  return {
    from: new Date(date.getTime() - hours * 3600000),
    to: new Date(date.getTime() + hours * 3600000),
    target: date,
  };
}

async function findScene(token: string, geometry: Geometry, requestedDate: string, observationDate?: string | null) {
  const { from, to, target } = sceneWindow(observationDate || requestedDate, observationDate ? 12 : 36);
  const response = await fetch(CATALOG_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/geo+json" },
    body: JSON.stringify({
      intersects: geometry,
      datetime: `${from.toISOString()}/${to.toISOString()}`,
      collections: ["sentinel-2-l2a"],
      limit: 25,
      fields: { include: ["id", "properties.datetime", "properties.eo:cloud_cover"] },
    }),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Sentinel Hub Catalog API error (${response.status}): ${text}`);
  const data = JSON.parse(text) as CatalogResponse;
  const features = Array.isArray(data.features) ? data.features : [];
  features.sort((a, b) => {
    const dateA = new Date(a.properties?.datetime ?? 0).getTime(), dateB = new Date(b.properties?.datetime ?? 0).getTime();
    const cloudA = number(a.properties?.["eo:cloud_cover"], 100), cloudB = number(b.properties?.["eo:cloud_cover"], 100);
    return (Math.abs(dateA - target.getTime()) / 86400000 + cloudA * 0.03) - (Math.abs(dateB - target.getTime()) / 86400000 + cloudB * 0.03);
  });
  return features[0] ?? null;
}

const EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: [
      { datasource: "before", bands: ["B03", "B04", "B08", "B11", "SCL", "dataMask"] },
      { datasource: "after", bands: ["B03", "B04", "B08", "B11", "SCL", "dataMask"] }
    ],
    output: { bands: 4, sampleType: "UINT8" }
  };
}
function valid(s) {
  return s && s.dataMask > 0 && s.SCL !== 0 && s.SCL !== 1 && s.SCL !== 3 && s.SCL !== 8 && s.SCL !== 9 && s.SCL !== 10 && s.SCL !== 11;
}
function indexValue(type, s) {
  if (!valid(s)) return NaN;
  let a, b;
  if (type === "ndwi") { a = s.B03; b = s.B08; }
  else if (type === "ndbi") { a = s.B11; b = s.B08; }
  else { a = s.B08; b = s.B04; }
  const d = a + b;
  return d === 0 ? NaN : (a - b) / d;
}
function evaluatePixel(samples) {
  const before = samples.before && samples.before.length ? samples.before[0] : null;
  const after = samples.after && samples.after.length ? samples.after[0] : null;
  const a = indexValue("__INDEX__", before), b = indexValue("__INDEX__", after);
  if (!isFinite(a) || !isFinite(b)) return [0,0,0,0];
  const delta = b - a, magnitude = Math.abs(delta);

  // Ignore weak fluctuations. Keep a softer band for moderate change
  // and strong opacity for clearly pronounced change.
  const weak = __WEAK__;
  const strong = __STRONG__;
  if (magnitude < weak) return [0,0,0,0];

  const strength = Math.max(0, Math.min(1, (magnitude - weak) / (strong - weak)));
  const alpha = Math.round(135 + 105 * strength);
  return delta < 0 ? [235, 45, 55, alpha] : [25, 200, 82, alpha];
}
`;

const THRESHOLDS: Record<Index, { weak: number; strong: number }> = {
  ndvi: { weak: 0.06, strong: 0.18 },
  ndwi: { weak: 0.07, strong: 0.20 },
  ndbi: { weak: 0.06, strong: 0.18 },
};

async function renderHeatmap(token: string, geometry: Geometry, beforeDate: string, afterDate: string, index: Index, beforeObservationDate?: string | null, afterObservationDate?: string | null) {
  const [beforeScene, afterScene] = await Promise.all([
    findScene(token, geometry, beforeDate, beforeObservationDate),
    findScene(token, geometry, afterDate, afterObservationDate),
  ]);
  if (!beforeScene) throw new Error(`No Sentinel-2 scene was found for ${beforeDate}.`);
  if (!afterScene) throw new Error(`No Sentinel-2 scene was found for ${afterDate}.`);
  const beforeAcquisition = beforeScene.properties?.datetime, afterAcquisition = afterScene.properties?.datetime;
  if (!beforeAcquisition || !afterAcquisition) throw new Error("Selected Sentinel-2 scenes are missing acquisition dates.");

  const evalscript = EVALSCRIPT
    .replace(/__INDEX__/g, index)
    .replace(/__WEAK__/g, String(THRESHOLDS[index].weak))
    .replace(/__STRONG__/g, String(THRESHOLDS[index].strong));

  const beforeWindow = sceneWindow(beforeAcquisition, 12), afterWindow = sceneWindow(afterAcquisition, 12);
  const body = {
    input: {
      bounds: { bbox: bbox(geometry), geometry: processingGeometry(geometry), properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" } },
      data: [
        { id: "before", type: "sentinel-2-l2a", dataFilter: { timeRange: { from: beforeWindow.from.toISOString(), to: beforeWindow.to.toISOString() }, mosaickingOrder: "leastCC" } },
        { id: "after", type: "sentinel-2-l2a", dataFilter: { timeRange: { from: afterWindow.from.toISOString(), to: afterWindow.to.toISOString() }, mosaickingOrder: "leastCC" } },
      ],
    },
    output: { width: 768, height: 768, responses: [{ identifier: "default", format: { type: "image/png" } }] },
    evalscript,
  };

  const response = await fetch(PROCESS_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "image/png" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const image = await response.arrayBuffer();
  if (!response.ok) throw new Error(`Sentinel Hub Process API error (${response.status}): ${new TextDecoder().decode(image).slice(0, 800)}`);
  return { image, beforeScene, afterScene };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const geometryRaw = url.searchParams.get("geometry");
    const beforeDate = url.searchParams.get("beforeDate");
    const afterDate = url.searchParams.get("afterDate");
    const index = url.searchParams.get("index") as Index | null;
    const beforeObservationDate = url.searchParams.get("beforeObservationDate");
    const afterObservationDate = url.searchParams.get("afterObservationDate");

    if (!geometryRaw || !beforeDate || !afterDate) return NextResponse.json({ success: false, error: "Geometry, beforeDate and afterDate are required." }, { status: 400 });
    if (index !== "ndvi" && index !== "ndwi" && index !== "ndbi") return NextResponse.json({ success: false, error: "index must be ndvi, ndwi or ndbi." }, { status: 400 });

    let parsed: unknown;
    try { parsed = JSON.parse(geometryRaw); } catch { return NextResponse.json({ success: false, error: "Invalid geometry JSON." }, { status: 400 }); }
    const geometry = normalizeGeometry(parsed);
    if (!geometry) return NextResponse.json({ success: false, error: "A valid point or polygon geometry is required." }, { status: 400 });

    const token = await getToken();
    const result = await renderHeatmap(token, geometry, beforeDate, afterDate, index, beforeObservationDate, afterObservationDate);

    return new NextResponse(result.image, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-SatQuery-Before-Scene": result.beforeScene.id ?? "",
        "X-SatQuery-After-Scene": result.afterScene.id ?? "",
        "X-SatQuery-Before-Acquisition": result.beforeScene.properties?.datetime ?? "",
        "X-SatQuery-After-Acquisition": result.afterScene.properties?.datetime ?? "",
        "X-SatQuery-Change-Threshold": String(THRESHOLDS[index].weak),
      },
    });
  } catch (error) {
    console.error("SatQuery change heatmap error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Change heatmap could not be generated." }, { status: 500 });
  }
}
