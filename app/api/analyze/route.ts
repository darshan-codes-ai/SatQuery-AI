import { NextResponse } from "next/server";

import { detectAnalysisType } from "@/lib/remote-sensing/query-parser";

type Coordinates = {
  lat: number;
  lng: number;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
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

// =========================================================
// SENTINEL HUB ENDPOINTS
// =========================================================

const SENTINEL_AUTH_URL =
  "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";

const SENTINEL_STATISTICS_URL =
  "https://services.sentinel-hub.com/api/v1/statistics";

// =========================================================
// CREATE SMALL AREA AROUND SELECTED LOCATION
// =========================================================

function createBBox(
  lat: number,
  lng: number,
  size = 0.01
): [number, number, number, number] {
  return [
    lng - size,
    lat - size,
    lng + size,
    lat + size,
  ];
}

// =========================================================
// GET SENTINEL HUB TOKEN
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

  const responseText =
    await response.text();

  if (!response.ok) {
    console.error(
      "Sentinel Hub authentication error:",
      response.status,
      responseText
    );

    throw new Error(
      `Sentinel Hub authentication failed (${response.status}).`
    );
  }

  let data: TokenResponse;

  try {
    data =
      JSON.parse(
        responseText
      ) as TokenResponse;
  } catch {
    throw new Error(
      "Sentinel Hub returned an invalid authentication response."
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
// EVALSCRIPT
// =========================================================
//
// Sentinel-2 L2A:
//
// B03 = Green
// B04 = Red
// B08 = NIR
// B11 = SWIR
// SCL = Scene classification
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

  // Ignore pixels with no data
  // and pixels classified as clouds,
  // cloud shadows, cirrus or snow.

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
      ? (sample.B08 - sample.B04) /
        ndviDenominator
      : 0;

  const ndwi =
    ndwiDenominator !== 0
      ? (sample.B03 - sample.B08) /
        ndwiDenominator
      : 0;

  const ndbi =
    ndbiDenominator !== 0
      ? (sample.B11 - sample.B08) /
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
// GET SATELLITE STATISTICS
// =========================================================

async function getSatelliteStatistics(
  coordinates: Coordinates
): Promise<StatisticsResponse> {

  const accessToken =
    await getAccessToken();

  const bbox =
    createBBox(
      coordinates.lat,
      coordinates.lng
    );

  // Search one full year instead of only 90 days.
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
            "http://www.opengis.net/def/crs/OGC/1.3/CRS84"
        }
      },

      data: [

        {
          type:
            "sentinel-2-l2a",

          dataFilter: {

            // Be less restrictive so
            // cloudy regions do not cause
            // the entire request to return empty.

            maxCloudCoverage: 80,

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

      // Group observations into
      // 30-day periods.
      //
      // This gives us a much better chance
      // of finding usable imagery.

      aggregationInterval: {
        of: "P30D"
      },

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
    "Sentinel Hub request:",
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

  const responseText =
    await response.text();

  if (!response.ok) {

    console.error(
      "Sentinel Hub Statistics API error:",
      response.status,
      responseText
    );

    throw new Error(
      `Sentinel Hub Statistics API error (${response.status}): ${responseText}`
    );
  }

  let data:
    StatisticsResponse;

  try {

    data =
      JSON.parse(
        responseText
      ) as StatisticsResponse;

  } catch {

    throw new Error(
      "Sentinel Hub returned invalid statistics JSON."
    );

  }

  console.log(
    "Sentinel Hub statistics result:",
    JSON.stringify(
      data,
      null,
      2
    )
  );

  return data;
}

// =========================================================
// FIND BEST AVAILABLE OBSERVATION
// =========================================================

function getBestObservation(
  statistics: StatisticsResponse
) {

  if (
    !statistics.data ||
    statistics.data.length === 0
  ) {

    throw new Error(
      "Sentinel Hub returned no Sentinel-2 observations for this location."
    );

  }

  // Sort newest first.

  const sorted =
    [...statistics.data].sort(
      (a, b) => {

        const aTime =
          new Date(
            a.interval?.from ?? 0
          ).getTime();

        const bTime =
          new Date(
            b.interval?.from ?? 0
          ).getTime();

        return bTime - aTime;

      }
    );

  // Find the newest period containing
  // usable NDVI, NDWI and NDBI.

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
    "Sentinel-2 observations were found, but no valid index statistics were available."
  );
}

// =========================================================
// MAIN API
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
    // VALIDATE QUERY
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
    // VALIDATE COORDINATES
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
    // DETECT QUERY TYPE
    // -----------------------------------------------------

    const analysisType =
      detectAnalysisType(
        query
      );

    // -----------------------------------------------------
    // GET REAL SATELLITE DATA
    // -----------------------------------------------------

    const statistics =
      await getSatelliteStatistics(
        coordinates
      );

    const observation =
      getBestObservation(
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
    // DATA QUALITY
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

    let responseText =
      "";

    let primaryValue =
      ndvi;

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

        responseText =
          `This is a temporal-change query. ` +
          `Reliable change detection requires comparable observations from multiple dates.`;

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
    // RETURN RESULT
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

        spatialResolution:
          "20m",

        acquisitionDate:
          observation.row
            .interval
            ?.from ??
          null,

        processing:
          "Sentinel Hub Statistical API",

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