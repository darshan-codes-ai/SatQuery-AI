import { NextResponse } from "next/server";

type NormalizedResult = {
  display_name: string;
  lat: string;
  lon: string;
};

type RawNominatimResult = {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
};

type PhotonFeature = {
  geometry?: {
    coordinates?: unknown;
  };
  properties?: {
    name?: unknown;
    city?: unknown;
    district?: unknown;
    state?: unknown;
    country?: unknown;
    street?: unknown;
    postcode?: unknown;
    osm_value?: unknown;
    osm_key?: unknown;
  };
};

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isValidCoordinate(lat: string, lon: string): boolean {
  const latitude = Number(lat);
  const longitude = Number(lon);

  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

function dedupe(results: NormalizedResult[]): NormalizedResult[] {
  const seen = new Set<string>();
  const unique: NormalizedResult[] = [];

  for (const result of results) {
    const key = `${Number(result.lat).toFixed(6)},${Number(
      result.lon
    ).toFixed(6)}`;

    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(result);
  }

  return unique;
}

function buildQueryVariants(query: string): string[] {
  const variants = [query];

  if (!/\b(india|telangana)\b/i.test(query)) {
    variants.push(`${query}, India`);
  }

  if (!/\b(telangana)\b/i.test(query)) {
    variants.push(`${query}, Telangana, India`);
  }

  // Useful for local landmarks and temples around Warangal/Hanamkonda.
  if (
    /\bwarangal\b/i.test(query) ||
    /\bhanamkonda\b/i.test(query) ||
    /\btemple\b/i.test(query)
  ) {
    variants.push(`${query}, Warangal, Telangana, India`);
    variants.push(`${query}, Hanamkonda, Warangal, Telangana, India`);
  }

  // Common spelling variation.
  if (/bhadrakali/i.test(query)) {
    const alternate = query.replace(/bhadrakali/gi, "Badrakali");
    variants.push(alternate);
    variants.push(`${alternate}, Warangal, Telangana, India`);
  }

  return [...new Set(variants)];
}

async function searchNominatim(query: string): Promise<NormalizedResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");

  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "8");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("countrycodes", "in");
  url.searchParams.set("accept-language", "en");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "SatQuery-AI/1.0 (Earth observation application)",
    },
    next: {
      revalidate: 600,
    },
  });

  if (!response.ok) return [];

  const text = await response.text();
  const parsed = JSON.parse(text) as unknown;

  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => {
      const result = item as RawNominatimResult;
      const lat = toStringValue(result.lat);
      const lon = toStringValue(result.lon);
      const displayName = toStringValue(result.display_name);

      if (!displayName || !isValidCoordinate(lat, lon)) {
        return null;
      }

      return {
        display_name: displayName,
        lat,
        lon,
      } satisfies NormalizedResult;
    })
    .filter((item): item is NormalizedResult => item !== null);
}

async function searchPhoton(query: string): Promise<NormalizedResult[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "en");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "SatQuery-AI/1.0 (Earth observation application)",
    },
    next: {
      revalidate: 600,
    },
  });

  if (!response.ok) return [];

  const text = await response.text();
  const parsed = JSON.parse(text) as { features?: PhotonFeature[] };

  if (!Array.isArray(parsed.features)) return [];

  return parsed.features
    .map((feature) => {
      const coordinates = feature.geometry?.coordinates;
      const properties = feature.properties ?? {};

      if (!Array.isArray(coordinates) || coordinates.length < 2) {
        return null;
      }

      const lon = String(coordinates[0] ?? "");
      const lat = String(coordinates[1] ?? "");

      if (!isValidCoordinate(lat, lon)) return null;

      const parts = [
        toStringValue(properties.name),
        toStringValue(properties.street),
        toStringValue(properties.city),
        toStringValue(properties.district),
        toStringValue(properties.state),
        toStringValue(properties.country),
        toStringValue(properties.postcode),
      ].filter(Boolean);

      return {
        display_name: parts.join(", ") || query,
        lat,
        lon,
      } satisfies NormalizedResult;
    })
    .filter((item): item is NormalizedResult => item !== null);
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

  const variants = buildQueryVariants(query);
  const results: NormalizedResult[] = [];

  try {
    // Free path: search several contextual variants on Nominatim.
    for (const variant of variants) {
      try {
        const matches = await searchNominatim(variant);
        results.push(...matches);

        if (results.length >= 8) break;
      } catch (error) {
        console.warn("Nominatim variant failed:", variant, error);
      }
    }

    let normalized = dedupe(results).slice(0, 8);

    // Free fallback: Photon is often better for POIs and landmarks.
    if (!normalized.length) {
      const photonResults = await searchPhoton(query);
      normalized = dedupe(photonResults).slice(0, 8);
    }

    if (!normalized.length) {
      return NextResponse.json({
        success: true,
        results: [],
        error: "No matching place was found. Try adding the city or state.",
      });
    }

    return NextResponse.json({
      success: true,
      results: normalized,
    });
  } catch (error) {
    console.error("SatQuery geocoding error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Could not search for that location.",
      },
      { status: 500 }
    );
  }
}
