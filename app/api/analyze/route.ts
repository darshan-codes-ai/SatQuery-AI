import { NextResponse } from "next/server";

import { detectAnalysisType } from "@/lib/remote-sensing/query-parser";

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

type TokenResponse = {
  access_token?: string;
};

type Stats = {
  min?: number | string;
  max?: number | string;
  mean?: number | string | null;
  stDev?: number | string;
  sampleCount?: number | string;
  noDataCount?: number | string;
};

type OutputStats = {
  bands?: {
    B0?: {
      stats?: Stats;
    };
  };
};

type StatisticsRow = {
  interval?: {
    from?: string;
    to?: string;
  };
  outputs?: {
    ndvi?: OutputStats;
    ndwi?: OutputStats;
    ndbi?: OutputStats;
  };
};

type StatisticsResponse = {
  data?: StatisticsRow[];
  status?: string;
  geometryPixelCount?: number | string;
};

type CatalogFeature = {
  id?: string;
  properties?: {
    datetime?: string;
    "eo:cloud_cover"?: number | string;
  };
};

type CatalogResponse = {
  features?: CatalogFeature[];
};

const SENTINEL_AUTH_URL =
  "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";

const SENTINEL_CATALOG_URL =
  "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search";

const SENTINEL_STATISTICS_URL =
  "https://services.sentinel-hub.com/api/v1/statistics";

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
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

function getAnalysisGeometry(
  coordinates: Coordinates,
  selection?: SelectionGeometry
) {
  if (selection?.type === "Polygon") {
    return {
      type: "Polygon" as const,
      coordinates: selection.coordinates,
    };
  }

  const point: [number, number] =
    selection?.type === "Point"
      ? selection.coordinates
      : [coordinates.lng, coordinates.lat];

  return {
    type: "Polygon" as const,
    coordinates: [pointToPolygon(point)],
  };
}

async function getAccessToken(): Promise<string> {
  const clientId = process.env.SENTINEL_HUB_CLIENT_ID;
  const clientSecret = process.env.SENTINEL_HUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Sentinel Hub credentials are missing. Check .env.local."
    );
  }

  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("client_id", clientId);
  body.set("client_secret", clientSecret);

  const response = await fetch(SENTINEL_AUTH_URL, {
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

  const data = JSON.parse(text) as TokenResponse;

  if (!data.access_token) {
    throw new Error("Sentinel Hub did not return an access token.");
  }

  return data.access_token;
}

async function findSentinelScenes(
  accessToken: string,
  geometry: SelectionGeometry
): Promise<CatalogFeature[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);

  const response = await fetch(SENTINEL_CATALOG_URL, {
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
  const features = Array.isArray(data.features)
    ? data.features
    : [];

  features.sort((a, b) => {
    const cloudA = toNumber(a.properties?.["eo:cloud_cover"], 100);
    const cloudB = toNumber(b.properties?.["eo:cloud_cover"], 100);

    if (cloudA !== cloudB) return cloudA - cloudB;

    return (
      new Date(b.properties?.datetime ?? 0).getTime() -
      new Date(a.properties?.datetime ?? 0).getTime()
    );
  });

  return features;
}

const EVALSCRIPT = `
//VERSION=3

function setup() {
  return {
    input: [{
      bands: [
        "B03",
        "B04",
        "B08",
        "B11",
        "SCL",
        "dataMask"
      ]
    }],
    output: [
      { id: "ndvi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndwi", bands: 1, sampleType: "FLOAT32" },
      { id: "ndbi", bands: 1, sampleType: "FLOAT32" },
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
      ndvi: [0],
      ndwi: [0],
      ndbi: [0],
      dataMask: [0]
    };
  }

  const ndviDenominator = sample.B08 + sample.B04;
  const ndwiDenominator = sample.B03 + sample.B08;
  const ndbiDenominator = sample.B11 + sample.B08;

  const ndvi = ndviDenominator !== 0
    ? (sample.B08 - sample.B04) / ndviDenominator
    : 0;

  const ndwi = ndwiDenominator !== 0
    ? (sample.B03 - sample.B08) / ndwiDenominator
    : 0;

  const ndbi = ndbiDenominator !== 0
    ? (sample.B11 - sample.B08) / ndbiDenominator
    : 0;

  return {
    ndvi: [ndvi],
    ndwi: [ndwi],
    ndbi: [ndbi],
    dataMask: [1]
  };
}
`;

async function getStatisticsForScene(
  accessToken: string,
  geometry: SelectionGeometry,
  scene: CatalogFeature
): Promise<StatisticsResponse> {
  const sceneDateString = scene.properties?.datetime;

  if (!sceneDateString) {
    throw new Error("Scene has no acquisition date.");
  }

  const sceneDate = new Date(sceneDateString);

  if (Number.isNaN(sceneDate.getTime())) {
    throw new Error("Scene has an invalid acquisition date.");
  }

  const from = new Date(sceneDate.getTime() - 12 * 60 * 60 * 1000);
  const to = new Date(sceneDate.getTime() + 12 * 60 * 60 * 1000);

  const requestBody = {
    input: {
      bounds: {
        geometry,
        properties: {
          crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
        },
      },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: {
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
      aggregationInterval: {
        of: "P1D",
      },
      width: 128,
      height: 128,
      evalscript: EVALSCRIPT,
    },
    calculations: {
      default: {},
    },
  };

  const response = await fetch(SENTINEL_STATISTICS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(requestBody),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Statistics API error (${response.status}): ${text}`
    );
  }

  return JSON.parse(text) as StatisticsResponse;
}

function extractObservation(statistics: StatisticsResponse) {
  if (!Array.isArray(statistics.data)) return null;

  for (const row of statistics.data) {
    const ndviStats = row.outputs?.ndvi?.bands?.B0?.stats;
    const ndwiStats = row.outputs?.ndwi?.bands?.B0?.stats;
    const ndbiStats = row.outputs?.ndbi?.bands?.B0?.stats;

    const ndvi = toNumber(ndviStats?.mean, Number.NaN);
    const ndwi = toNumber(ndwiStats?.mean, Number.NaN);
    const ndbi = toNumber(ndbiStats?.mean, Number.NaN);

    if (
      Number.isFinite(ndvi) &&
      Number.isFinite(ndwi) &&
      Number.isFinite(ndbi)
    ) {
      return {
        row,
        ndvi,
        ndwi,
        ndbi,
        ndviStats,
      };
    }
  }

  return null;
}

async function findUsableObservation(
  accessToken: string,
  geometry: SelectionGeometry,
  scenes: CatalogFeature[]
) {
  for (const scene of scenes.slice(0, 10)) {
    try {
      const statistics = await getStatisticsForScene(
        accessToken,
        geometry,
        scene
      );

      const observation = extractObservation(statistics);

      if (observation) {
        return {
          ...observation,
          scene,
          statistics,
        };
      }
    } catch (error) {
      console.warn("Scene skipped:", scene.id, error);
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const query = body.query;
    const coordinates = body.coordinates as Coordinates | undefined;
    const selection = body.selection as SelectionGeometry | undefined;

    if (typeof query !== "string" || !query.trim()) {
      return NextResponse.json(
        { success: false, error: "A valid query is required." },
        { status: 400 }
      );
    }

    if (
      !coordinates ||
      typeof coordinates.lat !== "number" ||
      typeof coordinates.lng !== "number"
    ) {
      return NextResponse.json(
        { success: false, error: "Valid map coordinates are required." },
        { status: 400 }
      );
    }

    if (
      coordinates.lat < -90 ||
      coordinates.lat > 90 ||
      coordinates.lng < -180 ||
      coordinates.lng > 180
    ) {
      return NextResponse.json(
        { success: false, error: "Invalid latitude or longitude." },
        { status: 400 }
      );
    }

    let geometry = getAnalysisGeometry(
      coordinates,
      selection
    );

    const analysisType = detectAnalysisType(query);
    const accessToken = await getAccessToken();

    // Catalog accepts GeoJSON Point or Polygon through `intersects`.
    const scenes = await findSentinelScenes(
      accessToken,
      geometry
    );

    if (scenes.length === 0) {
      throw new Error(
        "No Sentinel-2 scene was found for the selected area during the last year. Try selecting a different area."
      );
    }

    const result = await findUsableObservation(
      accessToken,
      geometry,
      scenes
    );

    if (!result) {
      throw new Error(
        "Sentinel-2 scenes were found, but none returned valid NDVI, NDWI and NDBI statistics for the selected area. Try a nearby area or a larger selection."
      );
    }

    const ndvi = toNumber(result.ndvi);
    const ndwi = toNumber(result.ndwi);
    const ndbi = toNumber(result.ndbi);

    const sampleCount = toNumber(
      result.ndviStats?.sampleCount
    );

    const noDataCount = toNumber(
      result.ndviStats?.noDataCount
    );

    const geometryPixelCount = toNumber(
      result.statistics.geometryPixelCount
    );

    const validPixels = Math.max(
      0,
      sampleCount - noDataCount
    );

    const coverage =
      geometryPixelCount > 0
        ? Math.min(
            100,
            (validPixels / geometryPixelCount) * 100
          )
        : 0;

    const confidence = Math.max(
      0,
      Math.min(1, coverage / 100)
    );

    let primaryValue = ndvi;
    let responseText = "";

    switch (analysisType) {
      case "ndvi":
        primaryValue = ndvi;
        responseText =
          `The selected area has a mean Sentinel-2 NDVI of ${ndvi.toFixed(2)}. ` +
          `Higher NDVI values generally indicate stronger vegetation activity.`;
        break;

      case "ndwi":
        primaryValue = ndwi;
        responseText =
          `The selected area has a mean Sentinel-2 NDWI of ${ndwi.toFixed(2)}. ` +
          `Higher NDWI values generally indicate stronger surface-water signals.`;
        break;

      case "ndbi":
        primaryValue = ndbi;
        responseText =
          `The selected area has a mean Sentinel-2 NDBI of ${ndbi.toFixed(2)}. ` +
          `Higher NDBI values can indicate relatively built-up surfaces.`;
        break;

      case "change":
        primaryValue = ndvi;
        responseText =
          `This is a temporal-change query. Reliable change detection requires comparable observations from multiple dates.`;
        break;

      default:
        primaryValue = ndvi;
        responseText =
          `The selected Sentinel-2 area was analyzed successfully. ` +
          `Mean NDVI is ${ndvi.toFixed(2)}, mean NDWI is ${ndwi.toFixed(2)}, and mean NDBI is ${ndbi.toFixed(2)}.`;
        break;
    }

    return NextResponse.json({
      success: true,
      query: query.trim(),
      coordinates,
      geometry,
      analysis: {
        type: analysisType,
        indices: {
          ndvi: Number(ndvi.toFixed(3)),
          ndwi: Number(ndwi.toFixed(3)),
          ndbi: Number(ndbi.toFixed(3)),
        },
        primaryValue: Number(primaryValue.toFixed(3)),
        coverage: Number(coverage.toFixed(1)),
      },
      response: responseText,
      confidence: Number(confidence.toFixed(2)),
      metadata: {
        sensor: "Sentinel-2 L2A",
        acquisitionDate:
          result.scene.properties?.datetime ?? null,
        cloudCoverage: toNumber(
          result.scene.properties?.["eo:cloud_cover"],
          0
        ),
        processingResolution: "20m",
        processing: "Sentinel Hub Catalog + Statistical API",
        dataQuality: {
          sampleCount,
          noDataCount,
          geometryPixelCount,
          validPixels,
        },
      },
    });
  } catch (error) {
    console.error("SatQuery analysis error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Satellite analysis failed.",
      },
      { status: 500 }
    );
  }
}
