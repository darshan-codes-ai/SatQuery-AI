import { NextResponse } from "next/server";

const AUTH_URL =
  "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";

const STATISTICS_URL =
  "https://services.sentinel-hub.com/api/v1/statistics";

type Geometry =
  | {
      type: "Point";
      coordinates: [number, number];
    }
  | {
      type: "Polygon";
      coordinates: [number, number][][];
    };

function isPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function normalizeGeometry(input: unknown): Geometry | null {
  if (!input || typeof input !== "object") return null;

  const value = input as Record<string, unknown>;

  if (value.type === "Point" && isPair(value.coordinates)) {
    return {
      type: "Point",
      coordinates: value.coordinates,
    };
  }

  if (value.type === "Polygon" && Array.isArray(value.coordinates)) {
    const rings = value.coordinates as unknown[];
    if (!Array.isArray(rings[0])) return null;

    const rawRing = rings[0] as unknown[];
    const ring = rawRing.filter(isPair);
    if (ring.length < 3) return null;

    const first = ring[0];
    const last = ring[ring.length - 1];
    const closed = first[0] === last[0] && first[1] === last[1];

    return {
      type: "Polygon",
      coordinates: [closed ? ring : [...ring, first]],
    };
  }

  return null;
}

function bboxFromGeometry(geometry: Geometry) {
  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    const size = 0.0025;
    return [lng - size, lat - size, lng + size, lat + size];
  }

  const points = geometry.coordinates[0];
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);

  return [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];
}

function toNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function polygonAreaKm2(ring: [number, number][]) {
  if (ring.length < 4) return 0;

  const radiusKm = 6371.0088;
  let area = 0;

  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];

    const lon1 = (lng1 * Math.PI) / 180;
    const lon2 = (lng2 * Math.PI) / 180;
    const lat1Rad = (lat1 * Math.PI) / 180;
    const lat2Rad = (lat2 * Math.PI) / 180;

    area += (lon2 - lon1) * (2 + Math.sin(lat1Rad) + Math.sin(lat2Rad));
  }

  return Math.abs((area * radiusKm * radiusKm) / 2);
}

function geometryAreaKm2(geometry: Geometry) {
  if (geometry.type === "Polygon") {
    return polygonAreaKm2(geometry.coordinates[0]);
  }

  // Same default point analysis footprint used elsewhere in SatQuery.
  const [lng, lat] = geometry.coordinates;
  const latHeightKm = 2 * 0.0025 * 111.32;
  const lngWidthKm =
    2 *
    0.0025 *
    111.32 *
    Math.cos((lat * Math.PI) / 180);

  return Math.abs(latHeightKm * lngWidthKm);
}

async function getAccessToken() {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Sentinel Hub credentials are missing.");
  }

  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Sentinel Hub authentication failed (${response.status}).`);
  }

  const data = JSON.parse(text) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Sentinel Hub did not return an access token.");
  }

  return data.access_token;
}

const EVALSCRIPT = `
//VERSION=3

function setup() {
  return {
    input: [{
      bands: ["B03", "B04", "B08", "B11", "SCL", "dataMask"]
    }],
    output: [
      { id: "vegetation", bands: 1, sampleType: "FLOAT32" },
      { id: "water", bands: 1, sampleType: "FLOAT32" },
      { id: "builtup", bands: 1, sampleType: "FLOAT32" },
      { id: "other", bands: 1, sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1, sampleType: "UINT8" }
    ]
  };
}

function evaluatePixel(sample) {
  const invalid =
    sample.dataMask === 0 ||
    sample.SCL === 0 ||
    sample.SCL === 1 ||
    sample.SCL === 3 ||
    sample.SCL === 8 ||
    sample.SCL === 9 ||
    sample.SCL === 10 ||
    sample.SCL === 11;

  if (invalid) {
    return {
      vegetation: [0],
      water: [0],
      builtup: [0],
      other: [0],
      dataMask: [0]
    };
  }

  const ndviDen = sample.B08 + sample.B04;
  const ndwiDen = sample.B03 + sample.B08;
  const ndbiDen = sample.B11 + sample.B08;

  const ndvi = ndviDen !== 0 ? (sample.B08 - sample.B04) / ndviDen : 0;
  const ndwi = ndwiDen !== 0 ? (sample.B03 - sample.B08) / ndwiDen : 0;
  const ndbi = ndbiDen !== 0 ? (sample.B11 - sample.B08) / ndbiDen : 0;

  // Heuristic, mutually-exclusive overview classes.
  const isWater = ndwi > 0.20;
  const isVegetation = !isWater && ndvi > 0.40;
  const isBuiltup = !isWater && !isVegetation && ndbi > 0.15;

  return {
    vegetation: [isVegetation ? 1 : 0],
    water: [isWater ? 1 : 0],
    builtup: [isBuiltup ? 1 : 0],
    other: [!isWater && !isVegetation && !isBuiltup ? 1 : 0],
    dataMask: [1]
  };
}
`;

function getMean(statsResponse: any, id: string) {
  return toNumber(
    statsResponse.data?.[0]?.outputs?.[id]?.bands?.B0?.stats?.mean,
    0
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const geometryRaw = url.searchParams.get("geometry");
    const date = url.searchParams.get("date");

    if (!geometryRaw) {
      return NextResponse.json(
        { success: false, error: "Selection geometry is required." },
        { status: 400 }
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(geometryRaw);
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid geometry JSON." },
        { status: 400 }
      );
    }

    const geometry = normalizeGeometry(parsed);

    if (!geometry) {
      return NextResponse.json(
        { success: false, error: "Invalid point or polygon geometry." },
        { status: 400 }
      );
    }

    const accessToken = await getAccessToken();
    const bbox = bboxFromGeometry(geometry);

    let to = new Date();
    let from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

    if (date) {
      const d = new Date(date);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { success: false, error: "Invalid acquisition date." },
          { status: 400 }
        );
      }

      from = new Date(d.getTime() - 12 * 60 * 60 * 1000);
      to = new Date(d.getTime() + 12 * 60 * 60 * 1000);
    }

    const body = {
      input: {
        bounds: {
          bbox,
          properties: {
            crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
          },
          ...(geometry.type === "Polygon" ? { geometry } : {}),
        },
        data: [
          {
            type: "sentinel-2-l2a",
            dataFilter: {
              timeRange: {
                from: from.toISOString(),
                to: to.toISOString(),
              },
              maxCloudCoverage: 100,
              mosaickingOrder: "leastCC",
            },
          },
        ],
      },
      aggregation: {
        timeRange: {
          from: from.toISOString(),
          to: to.toISOString(),
        },
        aggregationInterval: { of: "P30D" },
        width: 128,
        height: 128,
        evalscript: EVALSCRIPT,
      },
      calculations: { default: {} },
    };

    const response = await fetch(STATISTICS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    const text = await response.text();

    if (!response.ok) {
      console.error("Area statistics API error:", response.status, text);
      throw new Error(
        `Sentinel Hub area statistics failed (${response.status}): ${text}`
      );
    }

    const statistics = JSON.parse(text);

    if (!Array.isArray(statistics.data) || statistics.data.length === 0) {
      throw new Error("No usable satellite statistics were returned for this area.");
    }

    // Use the first returned interval. If a P30D request returns multiple
    // intervals, the most recent valid interval is preferred.
    const interval = [...statistics.data]
      .reverse()
      .find((item: any) => item.outputs?.vegetation?.bands?.B0?.stats);

    if (!interval) {
      throw new Error("No valid classified satellite pixels were returned.");
    }

    const sampleCount = toNumber(
      interval.outputs?.vegetation?.bands?.B0?.stats?.sampleCount,
      0
    );

    const noDataCount = toNumber(
      interval.outputs?.vegetation?.bands?.B0?.stats?.noDataCount,
      0
    );

    const total = sampleCount + noDataCount;
    const validDataPercent = total > 0 ? (sampleCount / total) * 100 : 0;

    const vegetationPercent = getMean(
      { data: [interval] },
      "vegetation"
    ) * 100;

    const waterPercent =
      getMean({ data: [interval] }, "water") * 100;

    const builtupPercent =
      getMean({ data: [interval] }, "builtup") * 100;

    const otherPercent =
      getMean({ data: [interval] }, "other") * 100;

    const areaKm2 = geometryAreaKm2(geometry);
    const areaHa = areaKm2 * 100;

    return NextResponse.json({
      success: true,
      area: {
        km2: Number(areaKm2.toFixed(3)),
        hectares: Number(areaHa.toFixed(2)),
      },
      coverage: {
        validDataPercent: Number(validDataPercent.toFixed(1)),
        geometryPixelCount: toNumber(statistics.geometryPixelCount, 0),
        sampleCount,
        noDataCount,
      },
      estimatedBreakdown: {
        vegetationPercent: Number(vegetationPercent.toFixed(1)),
        waterPercent: Number(waterPercent.toFixed(1)),
        builtupPercent: Number(builtupPercent.toFixed(1)),
        otherPercent: Number(otherPercent.toFixed(1)),
        vegetationHa: Number((areaHa * vegetationPercent / 100).toFixed(2)),
        waterHa: Number((areaHa * waterPercent / 100).toFixed(2)),
        builtupHa: Number((areaHa * builtupPercent / 100).toFixed(2)),
        otherHa: Number((areaHa * otherPercent / 100).toFixed(2)),
      },
      acquisitionDate:
        interval.interval?.from ?? date ?? null,
      note:
        "The land-signal breakdown is an index-based estimate, not a definitive land-cover classification.",
    });
  } catch (error) {
    console.error("SatQuery area statistics error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not calculate area statistics.",
      },
      { status: 500 }
    );
  }
}
