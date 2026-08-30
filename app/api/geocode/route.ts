import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json(
      {
        success: false,
        error: "A location query is required.",
      },
      { status: 400 }
    );
  }

  if (query.length > 120) {
    return NextResponse.json(
      {
        success: false,
        error: "Location query is too long.",
      },
      { status: 400 }
    );
  }

  try {
    const url = new URL(
      "https://nominatim.openstreetmap.org/search"
    );

    url.searchParams.set("q", query);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "5");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "en");

    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "SatQuery-AI/1.0 (Earth observation application)",
      },
      next: {
        revalidate: 600,
      },
    });

    const text = await response.text();

    if (!response.ok) {
      console.error(
        "Nominatim geocoding failed:",
        response.status,
        text
      );

      return NextResponse.json(
        {
          success: false,
          error:
            "Location search service is unavailable right now.",
        },
        { status: 502 }
      );
    }

    let results: unknown;

    try {
      results = JSON.parse(text);
    } catch {
      return NextResponse.json(
        {
          success: false,
          error:
            "Location search returned invalid data.",
        },
        { status: 502 }
      );
    }

    const normalized = Array.isArray(results)
      ? results.map((item) => {
          const result =
            item as Record<string, unknown>;

          return {
            display_name:
              typeof result.display_name === "string"
                ? result.display_name
                : "Unknown location",

            lat:
              typeof result.lat === "string"
                ? result.lat
                : String(result.lat ?? ""),

            lon:
              typeof result.lon === "string"
                ? result.lon
                : String(result.lon ?? ""),
          };
        })
      : [];

    return NextResponse.json({
      success: true,
      results: normalized,
    });
  } catch (error) {
    console.error(
      "SatQuery geocoding error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Could not search for that location.",
      },
      { status: 500 }
    );
  }
}