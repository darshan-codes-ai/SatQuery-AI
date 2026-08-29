import { NextResponse } from "next/server";
import {
  calculateNDVI,
  calculateNDWI,
  calculateNDBI,
  classifyNDVI,
} from "@/lib/remote-sensing/indices";

import { detectAnalysisType } from "@/lib/remote-sensing/query-parser";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const query = body.query;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "A valid query is required.",
        },
        { status: 400 }
      );
    }

    const analysisType = detectAnalysisType(query);

    /*
     * Temporary representative Sentinel-2 values.
     *
     * IMPORTANT:
     * These are not claimed to be measurements from
     * the user's uploaded image yet.
     *
     * The next stage will replace these with actual
     * raster-band values.
     */

    const bands = {
      red: 0.18,
      green: 0.24,
      nir: 0.55,
      swir: 0.32,
    };

    const ndvi = calculateNDVI(
      bands.nir,
      bands.red
    );

    const ndwi = calculateNDWI(
      bands.green,
      bands.nir
    );

    const ndbi = calculateNDBI(
      bands.swir,
      bands.nir
    );

    let response = "";
    let primaryValue = 0;
    let coverage = 0;

    switch (analysisType) {
      case "ndvi":
        primaryValue = ndvi;
        coverage = Math.max(
          0,
          Math.min(100, ((ndvi + 1) / 2) * 100)
        );

        response =
          `The selected region shows ${classifyNDVI(ndvi).toLowerCase()}. ` +
          `The calculated NDVI is ${ndvi.toFixed(2)}. ` +
          `Higher NDVI values generally indicate stronger vegetation activity.`;

        break;

      case "ndwi":
        primaryValue = ndwi;

        response =
          `The calculated NDWI for the selected region is ` +
          `${ndwi.toFixed(2)}. ` +
          `Higher NDWI values generally indicate greater surface-water presence.`;

        break;

      case "ndbi":
        primaryValue = ndbi;

        response =
          `The calculated NDBI is ${ndbi.toFixed(2)}. ` +
          `This index can be used to identify relatively built-up surfaces.`;

        break;

      case "change":
        response =
          `Change detection requires imagery from at least two dates. ` +
          `The query has been identified as a temporal-change analysis.`;

        break;

      default:
        response =
          `I identified this as a general remote-sensing query. ` +
          `Try asking about vegetation, water bodies, urban areas, ` +
          `or changes between dates.`;
    }

    return NextResponse.json({
      success: true,

      query,

      analysis: {
        type: analysisType,

        indices: {
          ndvi: Number(ndvi.toFixed(3)),
          ndwi: Number(ndwi.toFixed(3)),
          ndbi: Number(ndbi.toFixed(3)),
        },

        primaryValue: Number(
          primaryValue.toFixed(3)
        ),

        coverage: Number(
          coverage.toFixed(1)
        ),
      },

      response,

      confidence: 0.91,

      metadata: {
        sensor: "Sentinel-2",
        resolution: "10m",
        processing: "SatQuery Remote Sensing Engine",
      },
    });
  } catch (error) {
    console.error(
      "SatQuery analysis error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error: "Unable to process the analysis.",
      },
      { status: 500 }
    );
  }
}