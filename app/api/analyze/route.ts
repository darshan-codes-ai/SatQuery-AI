import { NextResponse } from "next/server";

import { detectAnalysisType } from "@/lib/remote-sensing/query-parser";

type Coordinates = {
  lat: number;
  lng: number;
};

type TokenResponse = {
  access_token?: string;
};

type Stats = {
  min?: number;
  max?: number;
  mean?: number;
  stDev?: number;
  sampleCount?: number;
  noDataCount?: number;
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
  geometryPixelCount?: number;
};

type CatalogFeature = {
  id?: string;

  properties?: {
    datetime?: string;
    "eo:cloud_cover"?: number;
  };
};

type CatalogResponse = {
  features?: CatalogFeature[];
  type?: string;
  numberMatched?: number;
};

// =========================================================
// SENTINEL HUB ENDPOINTS
// =========================================================

const SENTINEL_AUTH_URL =
  "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";

const SENTINEL_CATALOG_URL =
  "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search";

const SENTINEL_STATISTICS_URL =
  "https://services.sentinel-hub.com/api/v1/statistics";

// =========================================================
// CREATE BOUNDING BOX
// =========================================================

function createBBox(
  lat: number,
  lng: number,
  size = 0.05
): [number, number, number, number] {
  return [
    lng - size,
    lat - size,
    lng + size,
    lat + size,
  ];
}

// =========================================================
// GET SENTINEL HUB ACCESS TOKEN
// =========================================================

async function getAccessToken(): Promise<string> {
  const clientId =
    process.env.SENTINEL_HUB_CLIENT_ID;

  const clientSecret =
    process.env.SENTINEL_HUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "Sentinel Hub credentials are missing. Check .env.local."
    );
  }

  const body = new URLSearchParams();

  body.set(
    "grant_type",
    "client_credentials"
  );

  body.set(
    "client_id",
    clientId
  );

  body.set(
    "client_secret",
    clientSecret
  );

  const response = await fetch(
    SENTINEL_AUTH_URL,
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      body,

      cache: "no-store",
    }
  );

  const text =
    await response.text();

  if (!response.ok) {
    console.error(
      "Sentinel Hub authentication failed:",
      response.status,
      text
    );

    throw new Error(
      `Sentinel Hub authentication failed (${response.status}).`
    );
  }

  let data: TokenResponse;

  try {
    data =
      JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(
      "Invalid authentication response from Sentinel Hub."
    );
  }

  if (!data.access_token) {
    throw new Error(
      "Sentinel Hub did not return an access token."
    );
  }

  return data.access_token;
}

// =========================================================
// FIND LATEST SENTINEL-2 SCENE
// =========================================================

async function findLatestSentinelScene(
  accessToken: string,
  coordinates: Coordinates
): Promise<CatalogFeature | null> {
  const bbox =
    createBBox(
      coordinates.lat,
      coordinates.lng
    );

  const to =
    new Date();

  const from =
    new Date(
      to.getTime() -
        365 *
          24 *
          60 *
          60 *
          1000
    );

  const requestBody = {
    bbox,

    datetime:
      `${from.toISOString()}/${to.toISOString()}`,

    collections: [
      "sentinel-2-l2a",
    ],

    limit: 20,

    fields: {
      include: [
        "id",
        "properties.datetime",
        "properties.eo:cloud_cover",
      ],
    },
  };

  console.log(
    "Catalog request:",
    JSON.stringify(
      requestBody,
      null,
      2
    )
  );

  const response =
    await fetch(
      SENTINEL_CATALOG_URL,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json",

          Accept:
            "application/geo+json",
        },

        body:
          JSON.stringify(
            requestBody
          ),

        cache: "no-store",
      }
    );

  const text =
    await response.text();

  if (!response.ok) {
    console.error(
      "Catalog API error:",
      response.status,
      text
    );

    throw new Error(
      `Sentinel Hub Catalog API error (${response.status}): ${text}`
    );
  }

  let data: CatalogResponse;

  try {
    data =
      JSON.parse(
        text
      ) as CatalogResponse;
  } catch {
    throw new Error(
      "Sentinel Hub returned invalid Catalog JSON."
    );
  }

  console.log(
    "Catalog feature count:",
    data.features?.length ?? 0
  );

  if (
    !data.features ||
    data.features.length === 0
  ) {
    return null;
  }

  // Sort by acquisition date, newest first.
  const sorted =
    [...data.features].sort(
      (a, b) => {
        const dateA =
          new Date(
            a.properties?.datetime ?? 0
          ).getTime();

        const dateB =
          new Date(
            b.properties?.datetime ?? 0
          ).getTime();

        return dateB - dateA;
      }
    );

  console.log(
    "Latest Sentinel-2 scene:",
    {
      id: sorted[0]?.id,
      datetime:
        sorted[0]?.properties?.datetime,
      cloudCover:
        sorted[0]?.properties?.[
          "eo:cloud_cover"
        ],
    }
  );

  return sorted[0];
}

// =========================================================
// EVALSCRIPT
// =========================================================
//
// Sentinel-2 L2A:
//
// B03 = Green
// B04 = Red
// B08 = NIR
// B11 = SWIR
// SCL = scene classification
// dataMask = valid-data mask
//
// =========================================================

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
      {
        id: "ndvi",
        bands: 1,
        sampleType: "FLOAT32"
      },

      {
        id: "ndwi",
        bands: 1,
        sampleType: "FLOAT32"
      },

      {
        id: "ndbi",
        bands: 1,
        sampleType: "FLOAT32"
      },

      {
        id: "dataMask",
        bands: 1,
        sampleType: "UINT8"
      }
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

  const ndviDenominator =
    sample.B08 + sample.B04;

  const ndwiDenominator =
    sample.B03 + sample.B08;

  const ndbiDenominator =
    sample.B11 + sample.B08;

  const ndvi =
    ndviDenominator !== 0
      ? (
          sample.B08 -
          sample.B04
        ) /
        ndviDenominator
      : 0;

  const ndwi =
    ndwiDenominator !== 0
      ? (
          sample.B03 -
          sample.B08
        ) /
        ndwiDenominator
      : 0;

  const ndbi =
    ndbiDenominator !== 0
      ? (
          sample.B11 -
          sample.B08
        ) /
        ndbiDenominator
      : 0;

  return {

    ndvi: [ndvi],

    ndwi: [ndwi],

    ndbi: [ndbi],

    dataMask: [1]

  };
}
`;

// =========================================================
// REQUEST STATISTICS FOR A KNOWN SCENE DATE
// =========================================================

async function getSatelliteStatistics(
  accessToken: string,
  coordinates: Coordinates,
  scene: CatalogFeature
): Promise<StatisticsResponse> {

  const bbox =
    createBBox(
      coordinates.lat,
      coordinates.lng
    );

  const sceneDateString =
    scene.properties?.datetime;

  if (!sceneDateString) {
    throw new Error(
      "The Sentinel-2 scene does not contain an acquisition date."
    );
  }

  const sceneDate =
    new Date(
      sceneDateString
    );

  if (
    Number.isNaN(
      sceneDate.getTime()
    )
  ) {
    throw new Error(
      "Invalid Sentinel-2 acquisition date."
    );
  }

  // Analyze a 24-hour window around the
  // confirmed acquisition.
  const from =
    new Date(
      sceneDate.getTime() -
        12 *
          60 *
          60 *
          1000
    );

  const to =
    new Date(
      sceneDate.getTime() +
        12 *
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
            "http://www.opengis.net/def/crs/OGC/1.3/CRS84"

        }

      },

      data: [

        {

          type:
            "sentinel-2-l2a",

          dataFilter: {

            // We already found the scene
            // through Catalog.

            maxCloudCoverage: 100,

            mosaickingOrder:
              "leastCC"

          }

        }

      ]

    },

    aggregation: {

      timeRange: {

        from:
          from.toISOString(),

        to:
          to.toISOString()

      },

      aggregationInterval: {

        of: "P1D"

      },

      // Width/height are used instead of
      // resx/resy because the bounds are
      // expressed in CRS84 longitude/latitude.

      width: 128,

      height: 128,

      evalscript:
        EVALSCRIPT

    },

    calculations: {

      default: {}

    }

  };

  console.log(
    "Statistics request:",
    JSON.stringify(
      requestBody,
      null,
      2
    )
  );

  const response =
    await fetch(
      SENTINEL_STATISTICS_URL,
      {

        method: "POST",

        headers: {

          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json",

          Accept:
            "application/json"

        },

        body:
          JSON.stringify(
            requestBody
          ),

        cache: "no-store"

      }
    );

  const text =
    await response.text();

  if (!response.ok) {

    console.error(
      "Statistics API error:",
      response.status,
      text
    );

    throw new Error(
      `Sentinel Hub Statistics API error (${response.status}): ${text}`
    );

  }

  let data:
    StatisticsResponse;

  try {

    data =
      JSON.parse(
        text
      ) as StatisticsResponse;

  } catch {

    throw new Error(
      "Sentinel Hub returned invalid Statistics JSON."
    );

  }

  console.log(
    "Statistics response:",
    JSON.stringify(
      data,
      null,
      2
    )
  );

  return data;
}

// =========================================================
// GET MOST RECENT VALID STATISTICS
// =========================================================

function getLatestObservation(
  statistics: StatisticsResponse
) {

  if (
    !statistics.data ||
    statistics.data.length === 0
  ) {

    throw new Error(
      "Sentinel Hub found a scene, but returned no statistics for that acquisition."
    );

  }

  const sorted =
    [...statistics.data].sort(
      (a, b) => {

        const dateA =
          new Date(
            a.interval?.from ?? 0
          ).getTime();

        const dateB =
          new Date(
            b.interval?.from ?? 0
          ).getTime();

        return dateB - dateA;

      }
    );

  for (
    const row of sorted
  ) {

    const ndviStats =
      row.outputs
        ?.ndvi
        ?.bands
        ?.B0
        ?.stats;

    const ndwiStats =
      row.outputs
        ?.ndwi
        ?.bands
        ?.B0
        ?.stats;

    const ndbiStats =
      row.outputs
        ?.ndbi
        ?.bands
        ?.B0
        ?.stats;

    if (

      ndviStats?.mean !==
        undefined &&

      ndwiStats?.mean !==
        undefined &&

      ndbiStats?.mean !==
        undefined

    ) {

      return {

        row,

        ndvi:
          ndviStats.mean,

        ndwi:
          ndwiStats.mean,

        ndbi:
          ndbiStats.mean,

        ndviStats,

        ndwiStats,

        ndbiStats

      };

    }

  }

  throw new Error(
    "The Sentinel-2 scene was found, but valid NDVI/NDWI/NDBI statistics were not returned."
  );
}

// =========================================================
// POST /api/analyze
// =========================================================

export async function POST(
  request: Request
) {

  try {

    const body =
      await request.json();

    const query =
      body.query;

    const coordinates =
      body.coordinates;

    // -----------------------------------------------------
    // QUERY VALIDATION
    // -----------------------------------------------------

    if (

      typeof query !==
        "string" ||

      !query.trim()

    ) {

      return NextResponse.json(
        {

          success: false,

          error:
            "A valid query is required."

        },

        {
          status: 400
        }
      );

    }

    // -----------------------------------------------------
    // COORDINATE VALIDATION
    // -----------------------------------------------------

    if (

      !coordinates ||

      typeof coordinates.lat !==
        "number" ||

      typeof coordinates.lng !==
        "number"

    ) {

      return NextResponse.json(
        {

          success: false,

          error:
            "Valid map coordinates are required."

        },

        {
          status: 400
        }
      );

    }

    if (

      coordinates.lat <
        -90 ||

      coordinates.lat >
        90

    ) {

      return NextResponse.json(
        {

          success: false,

          error:
            "Latitude must be between -90 and 90."

        },

        {
          status: 400
        }
      );

    }

    if (

      coordinates.lng <
        -180 ||

      coordinates.lng >
        180

    ) {

      return NextResponse.json(
        {

          success: false,

          error:
            "Longitude must be between -180 and 180."

        },

        {
          status: 400
        }
      );

    }

    // -----------------------------------------------------
    // DETECT QUERY
    // -----------------------------------------------------

    const analysisType =
      detectAnalysisType(
        query
      );

    // -----------------------------------------------------
    // AUTHENTICATE
    // -----------------------------------------------------

    const accessToken =
      await getAccessToken();

    // -----------------------------------------------------
    // FIND ACTUAL SENTINEL-2 SCENE
    // -----------------------------------------------------

    const scene =
      await findLatestSentinelScene(
        accessToken,
        coordinates
      );

    if (!scene) {

      throw new Error(
        "No Sentinel-2 scene was found for this location during the last year. Try clicking a different land area."
      );

    }

    // -----------------------------------------------------
    // GET STATISTICS
    // -----------------------------------------------------

    const statistics =
      await getSatelliteStatistics(
        accessToken,
        coordinates,
        scene
      );

    // -----------------------------------------------------
    // EXTRACT OBSERVATION
    // -----------------------------------------------------

    const observation =
      getLatestObservation(
        statistics
      );

    // -----------------------------------------------------
    // INDEX VALUES
    // -----------------------------------------------------

    const ndvi =
      observation.ndvi;

    const ndwi =
      observation.ndwi;

    const ndbi =
      observation.ndbi;

    // -----------------------------------------------------
    // COVERAGE
    // -----------------------------------------------------

    const sampleCount =
      observation
        .ndviStats
        ?.sampleCount ?? 0;

    const noDataCount =
      observation
        .ndviStats
        ?.noDataCount ?? 0;

    const totalPixels =
      sampleCount +
      noDataCount;

    const coverage =
      totalPixels > 0

        ? (
            sampleCount /
            totalPixels
          ) *
          100

        : 0;

    // -----------------------------------------------------
    // DATA QUALITY SCORE
    // -----------------------------------------------------

    const confidence =
      Math.max(
        0,
        Math.min(
          1,
          coverage / 100
        )
      );

    // -----------------------------------------------------
    // RESPONSE
    // -----------------------------------------------------

    let primaryValue =
      ndvi;

    let responseText =
      "";

    switch (
      analysisType
    ) {

      case "ndvi":

        primaryValue =
          ndvi;

        responseText =
          `The selected region has a mean Sentinel-2 NDVI of ${ndvi.toFixed(
            2
          )}. ` +
          `Higher NDVI values generally indicate stronger vegetation activity.`;

        break;

      case "ndwi":

        primaryValue =
          ndwi;

        responseText =
          `The selected region has a mean Sentinel-2 NDWI of ${ndwi.toFixed(
            2
          )}. ` +
          `Higher NDWI values generally indicate stronger surface-water signals.`;

        break;

      case "ndbi":

        primaryValue =
          ndbi;

        responseText =
          `The selected region has a mean Sentinel-2 NDBI of ${ndbi.toFixed(
            2
          )}. ` +
          `Higher NDBI values can indicate relatively built-up surfaces.`;

        break;

      case "change":

        primaryValue =
          ndvi;

        responseText =
          `This is a temporal-change query. ` +
          `Reliable change detection requires comparable observations from multiple dates. ` +
          `The current result is based on the latest available Sentinel-2 acquisition.`;

        break;

      default:

        primaryValue =
          ndvi;

        responseText =
          `The selected Sentinel-2 region was analyzed successfully. ` +
          `Mean NDVI is ${ndvi.toFixed(
            2
          )}, mean NDWI is ${ndwi.toFixed(
            2
          )}, and mean NDBI is ${ndbi.toFixed(
            2
          )}.`;

        break;

    }

    // -----------------------------------------------------
    // RETURN RESPONSE
    // -----------------------------------------------------

    return NextResponse.json({

      success: true,

      query:
        query.trim(),

      coordinates: {

        lat:
          coordinates.lat,

        lng:
          coordinates.lng

      },

      analysis: {

        type:
          analysisType,

        indices: {

          ndvi:
            Number(
              ndvi.toFixed(3)
            ),

          ndwi:
            Number(
              ndwi.toFixed(3)
            ),

          ndbi:
            Number(
              ndbi.toFixed(3)
            )

        },

        primaryValue:
          Number(
            primaryValue.toFixed(3)
          ),

        coverage:
          Number(
            coverage.toFixed(1)
          )

      },

      response:
        responseText,

      confidence:
        Number(
          confidence.toFixed(2)
        ),

      metadata: {

        sensor:
          "Sentinel-2 L2A",

        acquisitionDate:
          scene.properties
            ?.datetime ??
          null,

        cloudCoverage:
          scene.properties
            ?.["eo:cloud_cover"] ??
          null,

        processingResolution:
          "20m",

        processing:
          "Sentinel Hub Catalog + Statistical API",

        dataQuality: {

          sampleCount,

          noDataCount,

          geometryPixelCount:
            statistics
              .geometryPixelCount ??
            null

        }

      }

    });

  } catch (
    error
  ) {

    console.error(
      "SatQuery analysis error:",
      error
    );

    const message =
      error instanceof Error
        ? error.message
        : "Satellite analysis failed.";

    return NextResponse.json(
      {

        success: false,

        error:
          message

      },

      {
        status: 500
      }
    );

  }

}