import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const lat = Number(searchParams.get("lat"));
    const lng = Number(searchParams.get("lng"));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        {
          success: false,
          error: "Valid lat and lng are required.",
        },
        { status: 400 }
      );
    }

    const clientId =
      process.env.SENTINEL_HUB_CLIENT_ID;

    const clientSecret =
      process.env.SENTINEL_HUB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Sentinel Hub credentials are missing.",
        },
        { status: 500 }
      );
    }

    // -----------------------------------------------
    // 1. GET SENTINEL HUB TOKEN
    // -----------------------------------------------

    const tokenResponse = await fetch(
      "https://services.sentinel-hub.com/auth/realms/main/protocol/openid-connect/token",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded",
        },

        body: new URLSearchParams({
          grant_type:
            "client_credentials",

          client_id:
            clientId,

          client_secret:
            clientSecret,
        }),

        cache: "no-store",
      }
    );

    const tokenText =
      await tokenResponse.text();

    if (!tokenResponse.ok) {
      return NextResponse.json(
        {
          success: false,

          error:
            `Authentication failed (${tokenResponse.status})`,

          details:
            tokenText,
        },

        { status: 500 }
      );
    }

    const tokenData =
      JSON.parse(tokenText);

    if (!tokenData.access_token) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No access token returned.",
        },
        { status: 500 }
      );
    }

    // -----------------------------------------------
    // 2. CREATE SEARCH AREA
    // -----------------------------------------------

    const size = 0.05;

    const bbox = [
      lng - size,
      lat - size,
      lng + size,
      lat + size,
    ];

    // -----------------------------------------------
    // 3. SEARCH SENTINEL-2 CATALOG
    // -----------------------------------------------

    const catalogResponse =
      await fetch(
        "https://services.sentinel-hub.com/api/v1/catalog/1.0.0/search",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${tokenData.access_token}`,

            "Content-Type":
              "application/json",

            Accept:
              "application/geo+json",
          },

          body: JSON.stringify({
            bbox,

            datetime:
              "2024-01-01T00:00:00Z/2026-08-29T23:59:59Z",

            collections: [
              "sentinel-2-l2a",
            ],

            limit: 10,
          }),

          cache: "no-store",
        }
      );

    const catalogText =
      await catalogResponse.text();

    if (!catalogResponse.ok) {
      return NextResponse.json(
        {
          success: false,

          error:
            `Catalog API failed (${catalogResponse.status})`,

          details:
            catalogText,
        },

        {
          status:
            catalogResponse.status,
        }
      );
    }

    const catalogData =
      JSON.parse(catalogText);

    // -----------------------------------------------
    // 4. RETURN RESULTS
    // -----------------------------------------------

    return NextResponse.json({
      success: true,

      coordinates: {
        lat,
        lng,
      },

      featureCount:
        Array.isArray(
          catalogData.features
        )
          ? catalogData.features.length
          : 0,

      features:
        catalogData.features ?? [],
    });

  } catch (error) {
    console.error(
      "Sentinel catalog error:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Catalog test failed.",
      },

      {
        status: 500,
      }
    );
  }
}