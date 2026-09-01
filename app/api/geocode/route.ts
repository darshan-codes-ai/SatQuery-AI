import { NextResponse } from "next/server";

type PlaceResult = {
  display_name: string;
  lat: string;
  lon: string;
};

type GooglePlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  id?: string;
  googleMapsUri?: string;
};

type GooglePlacesResponse = {
  places?: GooglePlace[];
};

function normalizePlaces(places: GooglePlace[]): PlaceResult[] {
  return places
    .map((place) => {
      const lat = place.location?.latitude;
      const lon = place.location?.longitude;

      if (
        typeof lat !== "number" ||
        typeof lon !== "number" ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        return null;
      }

      const name = place.displayName?.text?.trim();
      const address = place.formattedAddress?.trim();

      return {
        display_name: [name, address].filter(Boolean).join(", ") || "Unknown place",
        lat: String(lat),
        lon: String(lon),
      } satisfies PlaceResult;
    })
    .filter((item): item is PlaceResult => item !== null);
}

async function searchGoogle(query: string, apiKey: string): Promise<PlaceResult[]> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.location,places.id,places.googleMapsUri",
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "en",
      regionCode: "IN",
      pageSize: 8,
    }),
    cache: "no-store",
  });

  const text = await response.text();

  if (!response.ok) {
    console.error("Google Places error:", response.status, text);
    throw new Error(
      response.status === 403
        ? "Google Places API access is not enabled or the API key is invalid."
        : `Google Places search failed (${response.status}).`
    );
  }

  const data = JSON.parse(text) as GooglePlacesResponse;
  return normalizePlaces(Array.isArray(data.places) ? data.places : []);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json(
      { success: false, error: "A location query is required." },
      { status: 400 }
    );
  }

  if (query.length > 120) {
    return NextResponse.json(
      { success: false, error: "Location query is too long." },
      { status: 400 }
    );
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      {
        success: false,
        error: "GOOGLE_MAPS_API_KEY is missing. Add it to .env.local and restart Next.js.",
      },
      { status: 500 }
    );
  }

  try {
    // Google Places Text Search (New) is used only for place discovery.
    // MapLibre remains the visual map, and Sentinel Hub remains the satellite
    // analysis provider.
    const results = await searchGoogle(query, apiKey);

    if (!results.length) {
      return NextResponse.json({
        success: true,
        results: [],
        error: "No matching place was found. Try the landmark name with its city.",
      });
    }

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error("SatQuery Google geocoding error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not search for that location.",
      },
      { status: 502 }
    );
  }
}
