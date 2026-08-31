import { NextResponse } from "next/server";

type Geometry =
  | { type: "Point"; coordinates: [number, number] }
  | { type: "Polygon"; coordinates: [number, number][][] };

type CatalogFeature = {
  id?: string;
  properties?: {
    datetime?: string;
    "eo:cloud_cover"?: number | string;
  };
};

type CatalogResponse = { features?: CatalogFeature[] };

const AUTH_URL =
  "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";
const CATALOG_URL =
  "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search";
const PROCESS_URL =
  "https://services.sentinel-hub.com/api/v1/process";

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function isCoordPair(value: unknown): value is [number, number] {
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

  if (value.type === "Point" && isCoordPair(value.coordinates)) {
    return { type: "Point", coordinates: value.coordinates };
  }

  if (value.type === "Polygon" && Array.isArray(value.coordinates)) {
    const rings = value.coordinates as unknown[];
    if (!Array.isArray(rings[0])) return null;

    const ring = (rings[0] as unknown[]).filter(isCoordPair);
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

function pointToPolygon(
  coordinates: [number, number],
  size = 0.0025
): [number, number][] {
  const [lng, lat] = coordinates;
  return [
    [lng - size, lat - size],
    [lng + size, lat - size],
    [lng + size, lat + size],
    [lng - size, lat + size],
    [lng - size, lat - size],
  ];
}

function processGeometry(geometry: Geometry) {
  if (geometry.type === "Polygon") return geometry;
  return {
    type: "Polygon" as const,
    coordinates: [pointToPolygon(geometry.coordinates)],
  };
}

function bboxFromGeometry(geometry: Geometry): [number, number, number, number] {
  const polygon = processGeometry(geometry);
  const ring = polygon.coordinates[0];

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of ring) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLng, minLat, maxLng, maxLat];
}

async function getAccessToken(): Promise<string> {
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
    throw new Error(
      `Sentinel Hub authentication failed (${response.status}).`
    );
  }

  const data = JSON.parse(text) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Sentinel Hub did not return an access token.");
  }

  return data.access_token;
}

function exactDayWindow(dateString: string) {
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid acquisition date: ${dateString}`);
  }

  const from = new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
      0,
      0,
      0
    )
  );

  const to = new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
      23,
      59,
      59
    )
  );

  return { from, to };
}

async function findScene(
  accessToken: string,
  geometry: Geometry,
  dateString: string
): Promise<CatalogFeature | null> {
  const parsed = new Date(dateString);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid scene date: ${dateString}`);
  }

  // Keep a small fallback window around the actual acquisition date.
  const from = new Date(parsed.getTime() - 36 * 60 * 60 * 1000);
  const to = new Date(parsed.getTime() + 36 * 60 * 60 * 1000);

  const response = await fetch(CATALOG_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/geo+json",
    },
    body: JSON.stringify({
      intersects: geometry,
      datetime: `${from.toISOString()}/${to.toISOString()}`,
      collections: ["sentinel-2-l2a"],
      limit: 20,
      fields: {
        include: [
          "id",
          "properties.datetime",
          "properties.eo:cloud_cover",
        ],
      },
    }),
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Sentinel Hub Catalog API error (${response.status}): ${text}`
    );
  }

  const data = JSON.parse(text) as CatalogResponse;
  const features = Array.isArray(data.features) ? data.features : [];

  features.sort((a, b) => {
    const cloudA = toNumber(a.properties?.["eo:cloud_cover"], 100);
    const cloudB = toNumber(b.properties?.["eo:cloud_cover"], 100);
    const dateA = new Date(a.properties?.datetime ?? 0).getTime();
    const dateB = new Date(b.properties?.datetime ?? 0).getTime();
    const target = parsed.getTime();

    const scoreA = Math.abs(dateA - target) / 86400000 + cloudA * 0.03;
    const scoreB = Math.abs(dateB - target) / 86400000 + cloudB * 0.03;

    return scoreA - scoreB;
  });

  return features[0] ?? null;
}

const EVALSCRIPT = `
//VERSION=3

function setup() {
  return {
    input: [
      {
        datasource: "before",
        bands: ["B03", "B04", "B08", "B11", "SCL", "dataMask"]
      },
      {
        datasource: "after",
        bands: ["B03", "B04", "B08", "B11", "SCL", "dataMask"]
      }
    ],
    output: {
      bands: 4,
      sampleType: "AUTO"
    }
  };
}

function valid(sample) {
  return sample &&
    sample.dataMask > 0 &&
    sample.SCL !== 0 &&
    sample.SCL !== 1 &&
    sample.SCL !== 3 &&
    sample.SCL !== 8 &&
    sample.SCL !== 9 &&
    sample.SCL !== 10 &&
    sample.SCL !== 11;
}

function safeIndex(type, sample) {
  if (!valid(sample)) return NaN;

  let a;
  let b;

  if (type === "ndwi") {
    a = sample.B03;
    b = sample.B08;
  } else if (type === "ndbi") {
    a = sample.B11;
    b = sample.B08;
  } else {
    a = sample.B08;
    b = sample.B04;
  }

  const denominator = a + b;
  if (denominator === 0) return NaN;
  return (a - b) / denominator;
}

function evaluatePixel(samples) {
  const before = samples.before && samples.before.length
    ? samples.before[0]
    : null;

  const after = samples.after && samples.after.length
    ? samples.after[0]
    : null;

  const beforeValue = safeIndex("__INDEX__", before);
  const afterValue = safeIndex("__INDEX__", after);

  if (!isFinite(beforeValue) || !isFinite(afterValue)) {
    return [0, 0, 0, 0];
  }

  const delta = afterValue - beforeValue;
  const stableThreshold = 0.03;
  const maxDelta = 0.30;

  if (Math.abs(delta) <= stableThreshold) {
    return [0.82, 0.82, 0.82, 0.30];
  }

  const intensity = Math.min(1, Math.max(0,
    (Math.abs(delta) - stableThreshold) /
    (maxDelta - stableThreshold)
  ));

  const alpha = 0.40 + intensity * 0.50;

  // Increase = green, decrease = red.
  if (delta > 0) {
    return [0.10, 1.0, 0.25, alpha];
  }

  return [1.0, 0.12, 0.12, alpha];
}
`;

async function renderHeatmap(
  accessToken: string,
  geometry: Geometry,
  beforeDate: string,
  afterDate: string,
  index: "ndvi" | "ndwi" | "ndbi"
) {
  const beforeScene = await findScene(
    accessToken,
    geometry,
    beforeDate
  );

  const afterScene = await findScene(
    accessToken,
    geometry,
    afterDate
  );

  if (!beforeScene) {
    throw new Error(`No Sentinel-2 scene was found for ${beforeDate}.`);
  }

  if (!afterScene) {
    throw new Error(`No Sentinel-2 scene was found for ${afterDate}.`);
  }

  const beforeAcquisition = beforeScene.properties?.datetime;
  const afterAcquisition = afterScene.properties?.datetime;

  if (!beforeAcquisition || !afterAcquisition) {
    throw new Error("Selected Sentinel-2 scenes are missing acquisition dates.");
  }

  const beforeWindow = exactDayWindow(beforeAcquisition);
  const afterWindow = exactDayWindow(afterAcquisition);

  const evalscript = EVALSCRIPT.replace(
    '"__INDEX__"',
    `"${index}"`
  );

  const body = {
    input: {
      bounds: {
        bbox: bboxFromGeometry(geometry),
        geometry: processGeometry(geometry),
        properties: {
          crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
        },
      },
      data: [
        {
          id: "before",
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: {
              from: beforeWindow.from.toISOString(),
              to: beforeWindow.to.toISOString(),
            },
            mosaickingOrder: "leastCC",
          },
        },
        {
          id: "after",
          type: "sentinel-2-l2a",
          dataFilter: {
            timeRange: {
              from: afterWindow.from.toISOString(),
              to: afterWindow.to.toISOString(),
            },
            mosaickingOrder: "leastCC",
          },
        },
      ],
    },
    output: {
      width: 512,
      height: 512,
      responses: [
        {
          identifier: "default",
          format: {
            type: "image/png",
          },
        },
      ],
    },
    evalscript,
  };

  const response = await fetch(PROCESS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "image/png",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const arrayBuffer = await response.arrayBuffer();

  if (!response.ok) {
    const message = new TextDecoder().decode(arrayBuffer);
    throw new Error(
      `Sentinel Hub Process API error (${response.status}): ${message}`
    );
  }

  return {
    image: arrayBuffer,
    beforeScene,
    afterScene,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);

    const geometryRaw = url.searchParams.get("geometry");
    const beforeDate = url.searchParams.get("beforeDate");
    const afterDate = url.searchParams.get("afterDate");
    const index = url.searchParams.get("index");

    if (!geometryRaw || !beforeDate || !afterDate) {
      return NextResponse.json(
        {
          success: false,
          error: "Geometry, beforeDate and afterDate are required.",
        },
        { status: 400 }
      );
    }

    if (index !== "ndvi" && index !== "ndwi" && index !== "ndbi") {
      return NextResponse.json(
        {
          success: false,
          error: "index must be ndvi, ndwi or ndbi.",
        },
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
        { success: false, error: "A valid point or polygon geometry is required." },
        { status: 400 }
      );
    }

    const accessToken = await getAccessToken();
    const result = await renderHeatmap(
      accessToken,
      geometry,
      beforeDate,
      afterDate,
      index
    );

    return new NextResponse(result.image, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-SatQuery-Before-Scene": result.beforeScene.id ?? "",
        "X-SatQuery-After-Scene": result.afterScene.id ?? "",
        "X-SatQuery-Before-Acquisition": result.beforeScene.properties?.datetime ?? "",
        "X-SatQuery-After-Acquisition": result.afterScene.properties?.datetime ?? "",
      },
    });
  } catch (error) {
    console.error("SatQuery change heatmap error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Change heatmap could not be generated.",
      },
      { status: 500 }
    );
  }
}
