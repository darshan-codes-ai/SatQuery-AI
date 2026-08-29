import { NextResponse } from "next/server";

import { detectAnalysisType } from "@/lib/remote-sensing/query-parser";

type Coordinates = {
  lat: number;
  lng: number;
};

type TokenResponse = {
  access_token: string;
  expires_in: number;
};

type IndexStats = {
  min?: number;
  max?: number;
  mean?: number;
  stDev?: number;
  sampleCount?: number;
  noDataCount?: number;
};

type StatisticsResponse = {
  data?: Array<{
    interval: {
      from: string;
      to: string;
    };

    outputs?: {
      ndvi?: {
        bands?: {
          B0?: {
            stats?: IndexStats;
          };
        };
      };

      ndwi?: {
        bands?: {
          B0?: {
            stats?: IndexStats;
          };
        };
      };

      ndbi?: {
        bands?: {
          B0?: {
            stats?: IndexStats;
          };
        };
      };
    };
  }>;

  status?: string;
};

// =========================================================
// CREATE ANALYSIS AREA
// =========================================================

function createBBox(
  lat: number,
  lng: number,
  size = 0.01
) {
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

async function getAccessToken() {
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

  body.append(
    "grant_type",
    "client_credentials"
  );

  body.append(
    "client_id",
    clientId
  );

  body.append(
    "client_secret",
    clientSecret
  );

  const response = await fetch(
    "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token",
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

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      "Sentinel Hub authentication error:",
      errorText
    );

    throw new Error(
      "Sentinel Hub authentication failed."
    );
  }

  const data =
    (await response.json()) as TokenResponse;

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
// Sentinel-2 L2A bands:
//
// B03 = Green
// B04 = Red
// B08 = NIR
// B11 = SWIR
// SCL = Scene Classification
// dataMask = valid-data mask
//
// NDVI = (NIR - Red) / (NIR + Red)
// NDWI = (Green - NIR) / (Green + NIR)
// NDBI = (SWIR - NIR) / (SWIR + NIR)
//

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
        bands: 1
      }
    ]
  };
}

function evaluatePixel(sample) {

  // Sentinel-2 Scene Classification classes
  // excluded:
  // 3  = cloud shadow
  // 8  = medium probability cloud
  // 9  = high probability cloud
  // 10 = cirrus
  // 11 = snow/ice

  const invalid =
    sample.dataMask === 0 ||
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
// GET REAL SENTINEL-2 STATISTICS
// =========================================================

async function getSatelliteStatistics(
  coordinates: Coordinates
) {
  const accessToken =
    await getAccessToken();

  const bbox = createBBox(
    coordinates.lat,
    coordinates.lng
  );

  // Use the last 90 days to increase the
  // chance of finding suitable imagery.
  const today = new Date();

  const fromDate =
    new Date(today);

  fromDate.setDate(
    today.getDate() - 90
  );

  const requestBody = {
    input: {
      bounds: {
        bbox,

        properties: {
          crs:
            "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
        },
      },

      data: [
        {
          type: "sentinel-2-l2a",

          dataFilter: {
            maxCloudCoverage: 20,

            mosaickingOrder:
              "leastCC",
          },
        },
      ],
    },

    aggregation: {
      timeRange: {
        from:
          fromDate.toISOString(),

        to:
          today.toISOString(),
      },

      aggregationInterval: {
        of: "P1D",
      },

      // B11 is a 20m band, therefore we use
      // 20m processing resolution for all indices.
      resx: 20,
      resy: 20,

      evalscript:
        EVALSCRIPT,
    },
  };

  const response =
    await fetch(
      "https://services.sentinel-hub.com/api/v1/statistics",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${accessToken}`,

          "Content-Type":
            "application/json",

          Accept:
            "application/json",
        },

        body:
          JSON.stringify(
            requestBody
          ),

        cache: "no-store",
      }
    );

  if (!response.ok) {
    const errorText =
      await response.text();

    console.error(
      "Sentinel Hub Statistics API error:",
      errorText
    );

    throw new Error(
      "Sentinel-2 statistics request failed."
    );
  }

  return (
    (await response.json()) as StatisticsResponse
  );
}

// =========================================================
// FIND MOST RECENT VALID OBSERVATION
// =========================================================

function getLatestObservation(
  statistics: StatisticsResponse
) {
  if (
    !statistics.data ||
    statistics.data.length === 0
  ) {
    throw new Error(
      "No Sentinel-2 imagery was found for this location in the selected time range."
    );
  }

  // The API normally returns data in
  // chronological order, but sorting here
  // guarantees that we use the latest record.
  const sortedData =
    [...statistics.data].sort(
      (a, b) =>
        new Date(
          b.interval.from
        ).getTime() -
        new Date(
          a.interval.from
        ).getTime()
    );

  for (const row of sortedData) {
    const ndviStats =
      row.outputs?.ndvi
        ?.bands?.B0?.stats;

    const ndwiStats =
      row.outputs?.ndwi
        ?.bands?.B0?.stats;

    const ndbiStats =
      row.outputs?.ndbi
        ?.bands?.B0?.stats;

    if (
      ndviStats?.mean !== undefined &&
      ndwiStats?.mean !== undefined &&
      ndbiStats?.mean !== undefined
    ) {
      return {
        row,

        ndvi: ndviStats.mean,

        ndwi: ndwiStats.mean,

        ndbi: ndbiStats.mean,

        ndviStats,

        ndwiStats,

        ndbiStats,
      };
    }
  }

  throw new Error(
    "No valid Sentinel-2 observation was returned."
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
      body.coordinates as
        | Coordinates
        | undefined;

    // -----------------------------------------------------
    // VALIDATE QUERY
    // -----------------------------------------------------

    if (
      !query ||
      typeof query !== "string"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "A valid query is required.",
        },
        { status: 400 }
      );
    }

    // -----------------------------------------------------
    // VALIDATE COORDINATES
    // -----------------------------------------------------

    if (
      !coordinates ||
      typeof coordinates.lat !== "number" ||
      typeof coordinates.lng !== "number"
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Valid map coordinates are required.",
        },
        { status: 400 }
      );
    }

    // Validate latitude
    if (
      coordinates.lat < -90 ||
      coordinates.lat > 90
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Latitude must be between -90 and 90.",
        },
        { status: 400 }
      );
    }

    // Validate longitude
    if (
      coordinates.lng < -180 ||
      coordinates.lng > 180
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Longitude must be between -180 and 180.",
        },
        { status: 400 }
      );
    }

    // -----------------------------------------------------
    // IDENTIFY ANALYSIS TYPE
    // -----------------------------------------------------

    const analysisType =
      detectAnalysisType(query);

    // -----------------------------------------------------
    // REQUEST REAL SENTINEL-2 DATA
    // -----------------------------------------------------

    const statistics =
      await getSatelliteStatistics(
        coordinates
      );

    const observation =
      getLatestObservation(
        statistics
      );

    // -----------------------------------------------------
    // EXTRACT VALUES
    // -----------------------------------------------------

    const ndvi =
      observation.ndvi;

    const ndwi =
      observation.ndwi;

    const ndbi =
      observation.ndbi;

    // -----------------------------------------------------
    // ESTIMATE DATA COVERAGE
    // -----------------------------------------------------

    const sampleCount =
      observation.ndviStats
        ?.sampleCount ?? 0;

    const noDataCount =
      observation.ndviStats
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
    // CONFIDENCE
    // -----------------------------------------------------
    //
    // This is a data-quality indicator rather
    // than an AI confidence score.
    //

    const confidence =
      Math.max(
        0,
        Math.min(
          1,
          coverage / 100
        )
      );

    // -----------------------------------------------------
    // CREATE RESPONSE
    // -----------------------------------------------------

    let responseText =
      "";

    let primaryValue =
      0;

    switch (analysisType) {
      case "ndvi":
        primaryValue =
          ndvi;

        responseText =
          `The selected region has a mean Sentinel-2 NDVI of ${ndvi.toFixed(
            2
          )}. ` +
          `This value describes the vegetation signal across the analyzed area.`;

        break;

      case "ndwi":
        primaryValue =
          ndwi;

        responseText =
          `The selected region has a mean Sentinel-2 NDWI of ${ndwi.toFixed(
            2
          )}. ` +
          `NDWI is useful for identifying surface-water signals.`;

        break;

      case "ndbi":
        primaryValue =
          ndbi;

        responseText =
          `The selected region has a mean Sentinel-2 NDBI of ${ndbi.toFixed(
            2
          )}. ` +
          `NDBI can help identify relatively built-up surfaces.`;

        break;

      case "change":
        responseText =
          `This request is a temporal-change analysis. ` +
          `A proper change analysis requires comparable imagery from at least two dates.`;

        break;

      default:
        responseText =
          `The selected Sentinel-2 region has been analyzed. ` +
          `Mean NDVI is ${ndvi.toFixed(
            2
          )}, mean NDWI is ${ndwi.toFixed(
            2
          )}, and mean NDBI is ${ndbi.toFixed(
            2
          )}.`;

        primaryValue =
          ndvi;
    }

    // -----------------------------------------------------
    // RETURN RESULT
    // -----------------------------------------------------

    return NextResponse.json({
      success: true,

      query,

      coordinates: {
        lat: coordinates.lat,
        lng: coordinates.lng,
      },

      analysis: {
        type: analysisType,

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
            ),
        },

        primaryValue:
          Number(
            primaryValue.toFixed(3)
          ),

        coverage:
          Number(
            coverage.toFixed(1)
          ),
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

        processingResolution:
          "20m",

        acquisitionDate:
          observation.row.interval.from,

        timeRange: {
          from:
            fromDateForResponse(
              90
            ),
          to:
            new Date().toISOString(),
        },

        processing:
          "Sentinel Hub Statistical API",

        source:
          "Sentinel-2 L2A",
      },
    });
  } catch (error) {
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
        error: message,
      },
      { status: 500 }
    );
  }
}

// =========================================================
// RESPONSE TIME RANGE HELPER
// =========================================================

function fromDateForResponse(
  days: number
) {
  const date =
    new Date();

  date.setDate(
    date.getDate() - days
  );

  return date.toISOString();
}