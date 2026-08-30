import { NextResponse } from "next/server";

const AUTH_URL =
  "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";

const PROCESS_URL =
  "https://services.sentinel-hub.com/api/v1/process";

type Geometry =
  | {
      type: "Point";
      coordinates: [number, number];
    }
  | {
      type: "Polygon";
      coordinates: [number, number][][];
    };

function isValidCoordinatePair(value: unknown): value is [number, number] {
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

  const geometry = input as Record<string, unknown>;

  if (
    geometry.type === "Point" &&
    isValidCoordinatePair(geometry.coordinates)
  ) {
    return {
      type: "Point",
      coordinates: geometry.coordinates,
    };
  }

  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    const rings = geometry.coordinates as unknown[];

    if (!rings.length || !Array.isArray(rings[0])) return null;

    const ring = rings[0] as unknown[];

    if (ring.length < 4) return null;

    const normalizedRing = ring.filter(isValidCoordinatePair);

    if (normalizedRing.length < 4) return null;

    const first = normalizedRing[0];
    const last = normalizedRing[normalizedRing.length - 1];

    const closed = first[0] === last[0] && first[1] === last[1];

    return {
      type: "Polygon",
      coordinates: [closed ? normalizedRing : [...normalizedRing, first]],
    };
  }

  return null;
}

function bboxFromGeometry(geometry: Geometry) {
  if (geometry.type === "Point") {
    const [lng, lat] = geometry.coordinates;
    const size = 0.0025;

    return [
      lng - size,
      lat - size,
      lng + size,
      lat + size,
    ];
  }

  const points = geometry.coordinates[0];

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  for (const [lng, lat] of points) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLng, minLat, maxLng, maxLat];
}

async function getAccessToken() {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Sentinel Hub credentials are missing.");
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Sentinel Hub authentication failed (${response.status}).`
    );
  }

  const data = JSON.parse(text) as {
    access_token?: string;
  };

  if (!data.access_token) {
    throw new Error("Sentinel Hub did not return an access token.");
  }

  return data.access_token;
}

// NDVI visualization:
// < 0.00 red
// 0.00-0.20 orange
// 0.20-0.40 yellow
// 0.40-0.60 light green
// > 0.60 dark green
const NDVI_EVALSCRIPT = `
//VERSION=3

function setup() {
  return {
    input: [{
      bands: ["B04", "B08", "SCL", "dataMask"]
    }],
    output: {
      bands: 4,
      sampleType: "UINT8"
    }
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
    return [0, 0, 0, 0];
  }

  const denominator = sample.B08 + sample.B04;

  if (denominator === 0) {
    return [0, 0, 0, 0];
  }

  const ndvi = (sample.B08 - sample.B04) / denominator;

  if (ndvi < 0.0) {
    return [220, 38, 38, 190];
  }

  if (ndvi < 0.2) {
    return [249, 115, 22, 190];
  }

  if (ndvi < 0.4) {
    return [250, 204, 21, 185];
  }

  if (ndvi < 0.6) {
    return [74, 222, 128, 190];
  }

  return [5, 150, 105, 200];
}
`;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const index = url.searchParams.get("index") ?? "ndvi";
    const geometryRaw = url.searchParams.get("geometry");

    if (index !== "ndvi") {
      return NextResponse.json(
        {
          success: false,
          error: "Only NDVI evidence is enabled in this version.",
        },
        { status: 400 }
      );
    }

    if (!geometryRaw) {
      return NextResponse.json(
        {
          success: false,
          error: "A selection geometry is required.",
        },
        { status: 400 }
      );
    }

    let parsedGeometry: unknown;

    try {
      parsedGeometry = JSON.parse(geometryRaw);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid geometry JSON.",
        },
        { status: 400 }
      );
    }

    const geometry = normalizeGeometry(parsedGeometry);

    if (!geometry) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid point or polygon geometry.",
        },
        { status: 400 }
      );
    }

    const accessToken = await getAccessToken();

    const bbox = bboxFromGeometry(geometry);

    // Use a one-year window and let leastCC choose a suitable
    // acquisition. The image is an evidence visualization,
    // not the source of the numeric statistics.
    const to = new Date();
    const from = new Date(
      to.getTime() -
        365 *
          24 *
          60 *
          60 *
          1000
    );

    const requestBody = {
      input: {
        bounds: {
          bbox,
          properties: {
            crs:
              "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
          },
          ...(geometry.type === "Polygon"
            ? { geometry }
            : {}),
        },
        data: [
          {
            type: "sentinel-2-l2a",
            dataFilter: {
              timeRange: {
                from: from.toISOString(),
                to: to.toISOString(),
              },
              maxCloudCoverage: 80,
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
      evalscript: NDVI_EVALSCRIPT,
    };

    const response = await fetch(PROCESS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "image/png",
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        "Sentinel Hub evidence error:",
        response.status,
        errorText
      );

      return NextResponse.json(
        {
          success: false,
          error: `Satellite evidence request failed (${response.status}).`,
        },
        { status: response.status }
      );
    }

    const image = await response.arrayBuffer();

    return new Response(image, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-SatQuery-Evidence": "NDVI",
      },
    });
  } catch (error) {
    console.error(
      "SatQuery evidence error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not generate NDVI evidence.",
      },
      { status: 500 }
    );
  }
}
