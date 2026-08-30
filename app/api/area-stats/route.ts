import { NextResponse } from "next/server";

const AUTH_URL =
  "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token";

const CATALOG_URL =
  "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search";

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

type StatisticsResponse = {
  data?: Array<{
    interval?: {
      from?: string;
      to?: string;
    };

    outputs?: {
      vegetation?: OutputStats;
      water?: OutputStats;
      builtup?: OutputStats;
      other?: OutputStats;
    };
  }>;

  geometryPixelCount?: number | string;
};

type OutputStats = {
  bands?: {
    B0?: {
      stats?: {
        mean?: number | string;
        sampleCount?: number | string;
        noDataCount?: number | string;
      };
    };
  };
};

// =========================================================
// HELPERS
// =========================================================

function isCoordinatePair(
  value: unknown
): value is [number, number] {
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

function normalizeGeometry(
  input: unknown
): Geometry | null {
  if (
    !input ||
    typeof input !== "object"
  ) {
    return null;
  }

  const value =
    input as Record<string, unknown>;

  // -------------------------------------------------------
  // POINT
  // -------------------------------------------------------

  if (
    value.type === "Point" &&
    isCoordinatePair(value.coordinates)
  ) {
    return {
      type: "Point",

      coordinates:
        value.coordinates,
    };
  }

  // -------------------------------------------------------
  // POLYGON
  // -------------------------------------------------------

  if (
    value.type === "Polygon" &&
    Array.isArray(
      value.coordinates
    )
  ) {
    const rings =
      value.coordinates as unknown[];

    if (
      !Array.isArray(
        rings[0]
      )
    ) {
      return null;
    }

    const rawRing =
      rings[0] as unknown[];

    const ring =
      rawRing.filter(
        isCoordinatePair
      );

    if (
      ring.length < 3
    ) {
      return null;
    }

    const first =
      ring[0];

    const last =
      ring[ring.length - 1];

    const closed =
      first[0] === last[0] &&
      first[1] === last[1];

    return {
      type: "Polygon",

      coordinates: [
        closed
          ? ring
          : [
              ...ring,
              first,
            ],
      ],
    };
  }

  return null;
}

// =========================================================
// BBOX
// =========================================================

function bboxFromGeometry(
  geometry: Geometry
): [number, number, number, number] {

  // A point gets the same small analysis footprint
  // used by the rest of SatQuery.
  if (
    geometry.type === "Point"
  ) {
    const [
      lng,
      lat,
    ] =
      geometry.coordinates;

    const size =
      0.0025;

    return [
      lng - size,
      lat - size,
      lng + size,
      lat + size,
    ];
  }

  const points =
    geometry.coordinates[0];

  let minLng =
    Infinity;

  let minLat =
    Infinity;

  let maxLng =
    -Infinity;

  let maxLat =
    -Infinity;

  for (
    const [lng, lat]
      of points
  ) {
    minLng =
      Math.min(
        minLng,
        lng
      );

    minLat =
      Math.min(
        minLat,
        lat
      );

    maxLng =
      Math.max(
        maxLng,
        lng
      );

    maxLat =
      Math.max(
        maxLat,
        lat
      );
  }

  return [
    minLng,
    minLat,
    maxLng,
    maxLat,
  ];
}

// =========================================================
// NUMBER
// =========================================================

function toNumber(
  value: unknown,
  fallback = 0
): number {
  if (
    typeof value ===
    "number"
  ) {
    return Number.isFinite(
      value
    )
      ? value
      : fallback;
  }

  if (
    typeof value ===
    "string"
  ) {
    const parsed =
      Number(value);

    return Number.isFinite(
      parsed
    )
      ? parsed
      : fallback;
  }

  return fallback;
}

// =========================================================
// AREA CALCULATION
// =========================================================

function polygonAreaKm2(
  ring: [number, number][]
): number {

  if (
    ring.length < 4
  ) {
    return 0;
  }

  const radiusKm =
    6371.0088;

  let area = 0;

  for (
    let i = 0;
    i <
      ring.length - 1;
    i++
  ) {

    const [
      lng1,
      lat1,
    ] =
      ring[i];

    const [
      lng2,
      lat2,
    ] =
      ring[i + 1];

    const lon1 =
      (lng1 * Math.PI) /
      180;

    const lon2 =
      (lng2 * Math.PI) /
      180;

    const lat1Rad =
      (lat1 * Math.PI) /
      180;

    const lat2Rad =
      (lat2 * Math.PI) /
      180;

    area +=
      (lon2 - lon1) *
      (
        2 +
        Math.sin(
          lat1Rad
        ) +
        Math.sin(
          lat2Rad
        )
      );
  }

  return Math.abs(
    (
      area *
      radiusKm *
      radiusKm
    ) / 2
  );
}

function geometryAreaKm2(
  geometry: Geometry
): number {

  if (
    geometry.type ===
    "Polygon"
  ) {
    return polygonAreaKm2(
      geometry.coordinates[0]
    );
  }

  const [
    lng,
    lat,
  ] =
    geometry.coordinates;

  const size =
    0.0025;

  const latHeightKm =
    2 *
    size *
    111.32;

  const lngWidthKm =
    2 *
    size *
    111.32 *
    Math.cos(
      (lat * Math.PI) /
        180
    );

  return Math.abs(
    latHeightKm *
      lngWidthKm
  );
}

// =========================================================
// AUTH
// =========================================================

async function getAccessToken() {

  const clientId =
    process.env
      .SENTINEL_HUB_CLIENT_ID;

  const clientSecret =
    process.env
      .SENTINEL_HUB_CLIENT_SECRET;

  if (
    !clientId ||
    !clientSecret
  ) {
    throw new Error(
      "Sentinel Hub credentials are missing."
    );
  }

  const response =
    await fetch(
      AUTH_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },

        body:
          new URLSearchParams({
            grant_type:
              "client_credentials",

            client_id:
              clientId,

            client_secret:
              clientSecret,
          }),

        cache:
          "no-store",
      }
    );

  const text =
    await response.text();

  if (
    !response.ok
  ) {
    throw new Error(
      `Sentinel Hub authentication failed (${response.status}).`
    );
  }

  const data =
    JSON.parse(text) as {
      access_token?: string;
    };

  if (
    !data.access_token
  ) {
    throw new Error(
      "Sentinel Hub did not return an access token."
    );
  }

  return data.access_token;
}

// =========================================================
// CATALOG SEARCH
// =========================================================

async function findSentinelScenes(
  accessToken: string,
  geometry: Geometry,
  requestedDate?: string | null
): Promise<CatalogFeature[]> {

  const bbox =
    bboxFromGeometry(
      geometry
    );

  let from: Date;
  let to: Date;

  // -------------------------------------------------------
  // If analysis already gave us an acquisition date,
  // search around that exact date.
  // -------------------------------------------------------

  if (
    requestedDate
  ) {

    const sceneDate =
      new Date(
        requestedDate
      );

    if (
      !Number.isNaN(
        sceneDate.getTime()
      )
    ) {

      from =
        new Date(
          sceneDate.getTime() -
            24 *
              60 *
              60 *
              1000
        );

      to =
        new Date(
          sceneDate.getTime() +
            24 *
              60 *
              60 *
              1000
        );

    } else {

      to =
        new Date();

      from =
        new Date(
          to.getTime() -
            365 *
              24 *
              60 *
              60 *
              1000
        );
    }

  } else {

    to =
      new Date();

    from =
      new Date(
        to.getTime() -
          365 *
            24 *
            60 *
            60 *
            1000
      );
  }

  const body = {

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
    "Area Catalog request:",
    JSON.stringify(
      body,
      null,
      2
    )
  );

  const response =
    await fetch(
      CATALOG_URL,
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
            body
          ),

        cache:
          "no-store",

      }
    );

  const text =
    await response.text();

  if (
    !response.ok
  ) {

    throw new Error(
      `Sentinel Hub Catalog API error (${response.status}): ${text}`
    );

  }

  const data =
    JSON.parse(
      text
    ) as CatalogResponse;

  const features =
    Array.isArray(
      data.features
    )
      ? data.features
      : [];

  // Prefer low-cloud scenes,
  // then newest date.
  features.sort(
    (
      a,
      b
    ) => {

      const cloudA =
        toNumber(
          a.properties
            ?.["eo:cloud_cover"],
          100
        );

      const cloudB =
        toNumber(
          b.properties
            ?.["eo:cloud_cover"],
          100
        );

      if (
        cloudA !==
        cloudB
      ) {
        return (
          cloudA -
          cloudB
        );
      }

      const dateA =
        new Date(
          a.properties
            ?.datetime ??
            0
        ).getTime();

      const dateB =
        new Date(
          b.properties
            ?.datetime ??
            0
        ).getTime();

      return (
        dateB -
        dateA
      );
    }
  );

  console.log(
    "Area scenes found:",
    features.length
  );

  return features;
}

// =========================================================
// CLASSIFICATION EVALSCRIPT
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
        id: "vegetation",
        bands: 1,
        sampleType: "FLOAT32"
      },

      {
        id: "water",
        bands: 1,
        sampleType: "FLOAT32"
      },

      {
        id: "builtup",
        bands: 1,
        sampleType: "FLOAT32"
      },

      {
        id: "other",
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

      vegetation: [0],
      water: [0],
      builtup: [0],
      other: [0],
      dataMask: [0]

    };

  }

  const ndviDen =
    sample.B08 +
    sample.B04;

  const ndwiDen =
    sample.B03 +
    sample.B08;

  const ndbiDen =
    sample.B11 +
    sample.B08;

  const ndvi =
    ndviDen !== 0
      ? (
          sample.B08 -
          sample.B04
        ) /
        ndviDen
      : 0;

  const ndwi =
    ndwiDen !== 0
      ? (
          sample.B03 -
          sample.B08
        ) /
        ndwiDen
      : 0;

  const ndbi =
    ndbiDen !== 0
      ? (
          sample.B11 -
          sample.B08
        ) /
        ndbiDen
      : 0;

  // -----------------------------------------------------
  // Heuristic classes
  //
  // Water first
  // Vegetation second
  // Built-up third
  // Everything else = other
  // -----------------------------------------------------

  const isWater =
    ndwi > 0.20;

  const isVegetation =
    !isWater &&
    ndvi > 0.40;

  const isBuiltup =
    !isWater &&
    !isVegetation &&
    ndbi > 0.15;

  return {

    vegetation: [
      isVegetation
        ? 1
        : 0
    ],

    water: [
      isWater
        ? 1
        : 0
    ],

    builtup: [
      isBuiltup
        ? 1
        : 0
    ],

    other: [
      !isWater &&
      !isVegetation &&
      !isBuiltup
        ? 1
        : 0
    ],

    dataMask: [1]

  };

}
`;

// =========================================================
// REQUEST STATS FOR ONE SCENE
// =========================================================

async function getStatsForScene(
  accessToken: string,
  geometry: Geometry,
  scene: CatalogFeature
): Promise<StatisticsResponse> {

  const sceneDateString =
    scene.properties
      ?.datetime;

  if (
    !sceneDateString
  ) {
    throw new Error(
      "Scene has no acquisition date."
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
      "Scene acquisition date is invalid."
    );
  }

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

  const bbox =
    bboxFromGeometry(
      geometry
    );

  const body = {

    input: {

      bounds: {

        bbox,

        properties: {

          crs:
            "http://www.opengis.net/def/crs/OGC/1.3/CRS84",

        },

        ...(geometry.type ===
        "Polygon"
          ? {
              geometry,
            }
          : {}),

      },

      data: [

        {

          type:
            "sentinel-2-l2a",

          dataFilter: {

            maxCloudCoverage:
              100,

            mosaickingOrder:
              "leastCC",

          },

        },

      ],

    },

    aggregation: {

      timeRange: {

        from:
          from.toISOString(),

        to:
          to.toISOString(),

      },

      aggregationInterval: {

        of: "P1D",

      },

      width: 128,

      height: 128,

      evalscript:
        EVALSCRIPT,

    },

    calculations: {

      default: {},

    },

  };

  const response =
    await fetch(
      STATISTICS_URL,
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
            body
          ),

        cache:
          "no-store",

      }
    );

  const text =
    await response.text();

  if (
    !response.ok
  ) {

    throw new Error(
      `Statistics API error (${response.status}): ${text}`
    );

  }

  return JSON.parse(
    text
  ) as StatisticsResponse;
}

// =========================================================
// EXTRACT VALID RESULT
// =========================================================

function extractValidResult(
  statistics: StatisticsResponse
) {

  if (
    !Array.isArray(
      statistics.data
    )
  ) {
    return null;
  }

  for (
    const interval
      of statistics.data
  ) {

    const vegetation =
      interval.outputs
        ?.vegetation
        ?.bands
        ?.B0
        ?.stats;

    const water =
      interval.outputs
        ?.water
        ?.bands
        ?.B0
        ?.stats;

    const builtup =
      interval.outputs
        ?.builtup
        ?.bands
        ?.B0
        ?.stats;

    const other =
      interval.outputs
        ?.other
        ?.bands
        ?.B0
        ?.stats;

    const vegetationMean =
      toNumber(
        vegetation?.mean,
        Number.NaN
      );

    const waterMean =
      toNumber(
        water?.mean,
        Number.NaN
      );

    const builtupMean =
      toNumber(
        builtup?.mean,
        Number.NaN
      );

    const otherMean =
      toNumber(
        other?.mean,
        Number.NaN
      );

    if (

      Number.isFinite(
        vegetationMean
      ) &&

      Number.isFinite(
        waterMean
      ) &&

      Number.isFinite(
        builtupMean
      ) &&

      Number.isFinite(
        otherMean
      )

    ) {

      const sampleCount =
        toNumber(
          vegetation
            ?.sampleCount,
          0
        );

      const noDataCount =
        toNumber(
          vegetation
            ?.noDataCount,
          0
        );

      const total =
        sampleCount +
        noDataCount;

      const validDataPercent =
        total > 0

          ? (
              sampleCount /
              total
            ) *
            100

          : 0;

      return {

        interval,

        vegetationPercent:
          vegetationMean *
          100,

        waterPercent:
          waterMean *
          100,

        builtupPercent:
          builtupMean *
          100,

        otherPercent:
          otherMean *
          100,

        sampleCount,

        noDataCount,

        validDataPercent,

      };

    }

  }

  return null;
}

// =========================================================
// MAIN GET
// =========================================================

export async function GET(
  request: Request
) {

  try {

    const url =
      new URL(
        request.url
      );

    const geometryRaw =
      url.searchParams.get(
        "geometry"
      );

    const requestedDate =
      url.searchParams.get(
        "date"
      );

    // -----------------------------------------------------
    // GEOMETRY REQUIRED
    // -----------------------------------------------------

    if (
      !geometryRaw
    ) {

      return NextResponse.json(
        {

          success: false,

          error:
            "Selection geometry is required.",

        },

        {
          status: 400,
        }
      );

    }

    // -----------------------------------------------------
    // PARSE GEOMETRY
    // -----------------------------------------------------

    let parsed:
      unknown;

    try {

      parsed =
        JSON.parse(
          geometryRaw
        );

    } catch {

      return NextResponse.json(
        {

          success: false,

          error:
            "Invalid geometry JSON.",

        },

        {
          status: 400,
        }
      );

    }

    const geometry =
      normalizeGeometry(
        parsed
      );

    if (
      !geometry
    ) {

      return NextResponse.json(
        {

          success: false,

          error:
            "Invalid point or polygon geometry.",

        },

        {
          status: 400,
        }
      );

    }

    // -----------------------------------------------------
    // AUTH
    // -----------------------------------------------------

    const accessToken =
      await getAccessToken();

    // -----------------------------------------------------
    // FIND SCENES
    // -----------------------------------------------------

    const scenes =
      await findSentinelScenes(
        accessToken,

        geometry,

        requestedDate
      );

    if (
      scenes.length === 0
    ) {

      throw new Error(
        "No Sentinel-2 scenes were found for the selected area."
      );

    }

    // -----------------------------------------------------
    // TRY SCENES UNTIL WE GET VALID STATS
    // -----------------------------------------------------

    let usableResult:
      ReturnType<
        typeof extractValidResult
      > = null;

    let selectedScene:
      CatalogFeature | null =
        null;

    let selectedStatistics:
      StatisticsResponse | null =
        null;

    for (
      let i = 0;

      i <
        Math.min(
          scenes.length,
          10
        );

      i++
    ) {

      const scene =
        scenes[i];

      try {

        console.log(
          `Trying area-statistics scene ${i + 1}:`,
          {
            id:
              scene.id,

            datetime:
              scene.properties
                ?.datetime,

            cloudCoverage:
              scene.properties
                ?.["eo:cloud_cover"],
          }
        );

        const statistics =
          await getStatsForScene(
            accessToken,
            geometry,
            scene
          );

        const result =
          extractValidResult(
            statistics
          );

        if (
          result
        ) {

          usableResult =
            result;

          selectedScene =
            scene;

          selectedStatistics =
            statistics;

          break;

        }

      } catch (
        error
      ) {

        console.warn(
          "Area statistics scene failed:",
          scene.id,
          error
        );

      }

    }

    if (
      !usableResult ||
      !selectedScene ||
      !selectedStatistics
    ) {

      throw new Error(
        "Sentinel-2 scenes were found, but none returned usable area statistics for the selected geometry. Try a slightly larger area or another acquisition."
      );

    }

    // -----------------------------------------------------
    // AREA
    // -----------------------------------------------------

    const areaKm2 =
      geometryAreaKm2(
        geometry
      );

    const areaHa =
      areaKm2 *
      100;

    // -----------------------------------------------------
    // CLASS PERCENTAGES
    // -----------------------------------------------------

    let vegetationPercent =
      Math.max(
        0,
        usableResult
          .vegetationPercent
      );

    let waterPercent =
      Math.max(
        0,
        usableResult
          .waterPercent
      );

    let builtupPercent =
      Math.max(
        0,
        usableResult
          .builtupPercent
      );

    let otherPercent =
      Math.max(
        0,
        usableResult
          .otherPercent
      );

    // -----------------------------------------------------
    // NORMALIZE TOTAL TO 100%
    // -----------------------------------------------------

    const classificationTotal =
      vegetationPercent +
      waterPercent +
      builtupPercent +
      otherPercent;

    if (
      classificationTotal >
        0
    ) {

      vegetationPercent =
        (
          vegetationPercent /
          classificationTotal
        ) *
        100;

      waterPercent =
        (
          waterPercent /
          classificationTotal
        ) *
        100;

      builtupPercent =
        (
          builtupPercent /
          classificationTotal
        ) *
        100;

      otherPercent =
        (
          otherPercent /
          classificationTotal
        ) *
        100;

    }

    // -----------------------------------------------------
    // HECTARES
    // -----------------------------------------------------

    const vegetationHa =
      areaHa *
      vegetationPercent /
      100;

    const waterHa =
      areaHa *
      waterPercent /
      100;

    const builtupHa =
      areaHa *
      builtupPercent /
      100;

    const otherHa =
      areaHa *
      otherPercent /
      100;

    // -----------------------------------------------------
    // RESPONSE
    // -----------------------------------------------------

    return NextResponse.json({

      success: true,

      area: {

        km2:
          Number(
            areaKm2.toFixed(3)
          ),

        hectares:
          Number(
            areaHa.toFixed(2)
          ),

      },

      coverage: {

        validDataPercent:
          Number(
            usableResult
              .validDataPercent
              .toFixed(1)
          ),

        sampleCount:
          usableResult
            .sampleCount,

        noDataCount:
          usableResult
            .noDataCount,

        geometryPixelCount:
          toNumber(
            selectedStatistics
              .geometryPixelCount,
            0
          ),

      },

      estimatedBreakdown: {

        vegetationPercent:
          Number(
            vegetationPercent
              .toFixed(1)
          ),

        waterPercent:
          Number(
            waterPercent
              .toFixed(1)
          ),

        builtupPercent:
          Number(
            builtupPercent
              .toFixed(1)
          ),

        otherPercent:
          Number(
            otherPercent
              .toFixed(1)
          ),

        vegetationHa:
          Number(
            vegetationHa.toFixed(2)
          ),

        waterHa:
          Number(
            waterHa.toFixed(2)
          ),

        builtupHa:
          Number(
            builtupHa.toFixed(2)
          ),

        otherHa:
          Number(
            otherHa.toFixed(2)
          ),

      },

      acquisitionDate:
        selectedScene
          .properties
          ?.datetime ??
        usableResult
          .interval
          ?.from ??
        requestedDate ??
        null,

      cloudCoverage:
        toNumber(
          selectedScene
            .properties
            ?.["eo:cloud_cover"],
          0
        ),

      note:
        "The land-signal breakdown is an index-based estimate, not a definitive land-cover classification.",

    });

  } catch (
    error
  ) {

    console.error(
      "SatQuery area statistics error:",
      error
    );

    return NextResponse.json(
      {

        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Could not calculate area statistics.",

      },

      {
        status: 500,
      }
    );

  }

}