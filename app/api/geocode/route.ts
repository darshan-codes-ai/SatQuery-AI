import { NextResponse } from "next/server";

type NormalizedResult = {
  display_name: string;
  lat: string;
  lon: string;
};

type RawNominatimResult = { display_name?: unknown; lat?: unknown; lon?: unknown };
type PhotonFeature = {
  geometry?: { coordinates?: unknown };
  properties?: { name?: unknown; city?: unknown; district?: unknown; state?: unknown; country?: unknown; street?: unknown; postcode?: unknown };
};
type GooglePlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
};
type GooglePlacesResponse = { places?: GooglePlace[] };

const USER_AGENT = "SatQuery-AI/1.0 (Earth observation application)";
const RESULT_LIMIT = 8;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validCoordinates(lat: string, lon: string): boolean {
  const latitude = Number(lat);
  const longitude = Number(lon);
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

function dedupe(results: NormalizedResult[]): NormalizedResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const key = `${Number(result.lat).toFixed(6)},${Number(result.lon).toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function queryVariants(query: string): string[] {
  const variants = [query];
  const lower = query.toLowerCase();
  if (!/\b(india|nepal|bangladesh|pakistan|bhutan|sri lanka)\b/i.test(query)) variants.push(`${query}, India`);
  if (/\bwarangal\b|\bhanamkonda\b/i.test(lower)) variants.push(`${query}, Warangal, Telangana, India`);
  if (/bhadrakali/i.test(query)) variants.push(query.replace(/bhadrakali/gi, "Badrakali"));
  return [...new Set(variants)];
}

async function searchNominatim(query: string): Promise<NormalizedResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("accept-language", "en");

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!response.ok) return [];

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) return [];

  return data
    .map((item) => {
      const result = item as RawNominatimResult;
      const lat = text(result.lat);
      const lon = text(result.lon);
      const displayName = text(result.display_name);
      if (!displayName || !validCoordinates(lat, lon)) return null;
      return { display_name: displayName, lat, lon } satisfies NormalizedResult;
    })
    .filter((item): item is NormalizedResult => item !== null);
}

async function searchPhoton(query: string): Promise<NormalizedResult[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(RESULT_LIMIT));
  url.searchParams.set("lang", "en");

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!response.ok) return [];

  const data = (await response.json()) as { features?: PhotonFeature[] };
  if (!Array.isArray(data.features)) return [];

  return data.features
    .map((feature) => {
      const coordinates = feature.geometry?.coordinates;
      const properties = feature.properties ?? {};
      if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
      const lon = String(coordinates[0] ?? "");
      const lat = String(coordinates[1] ?? "");
      if (!validCoordinates(lat, lon)) return null;
      const displayName = [
        text(properties.name), text(properties.street), text(properties.city),
        text(properties.district), text(properties.state), text(properties.country),
        text(properties.postcode),
      ].filter(Boolean).join(", ");
      return { display_name: displayName || query, lat, lon } satisfies NormalizedResult;
    })
    .filter((item): item is NormalizedResult => item !== null);
}

async function searchGoogle(query: string, apiKey: string): Promise<NormalizedResult[]> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({ textQuery: query, languageCode: "en", regionCode: "IN", pageSize: RESULT_LIMIT }),
    cache: "no-store",
  });
  if (!response.ok) {
    console.warn("Google Places unavailable:", response.status);
    return [];
  }

  const data = (await response.json()) as GooglePlacesResponse;
  return (data.places ?? [])
    .map((place) => {
      const lat = place.location?.latitude;
      const lon = place.location?.longitude;
      if (typeof lat !== "number" || typeof lon !== "number" || !Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
      const name = place.displayName?.text?.trim() ?? "";
      const address = place.formattedAddress?.trim() ?? "";
      return { display_name: [name, address].filter(Boolean).join(", ") || "Unknown place", lat: String(lat), lon: String(lon) } satisfies NormalizedResult;
    })
    .filter((item): item is NormalizedResult => item !== null);
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ success: false, error: "A location query is required." }, { status: 400 });
  if (query.length > 120) return NextResponse.json({ success: false, error: "Location query is too long." }, { status: 400 });

  try {
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    if (googleKey) {
      const googleResults = dedupe(await searchGoogle(query, googleKey)).slice(0, RESULT_LIMIT);
      if (googleResults.length) return NextResponse.json({ success: true, results: googleResults, provider: "google" });
    }

    const photonResults = dedupe(await searchPhoton(query)).slice(0, RESULT_LIMIT);
    if (photonResults.length) return NextResponse.json({ success: true, results: photonResults, provider: "photon" });

    const nominatimResults: NormalizedResult[] = [];
    for (const variant of queryVariants(query)) {
      nominatimResults.push(...(await searchNominatim(variant)));
      if (nominatimResults.length >= RESULT_LIMIT) break;
    }
    const results = dedupe(nominatimResults).slice(0, RESULT_LIMIT);
    return NextResponse.json({
      success: true,
      results,
      provider: "nominatim",
      ...(results.length ? {} : { error: "No matching place was found. Try adding the district or state." }),
    });
  } catch (error) {
    console.error("SatQuery geocoding error:", error);
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Could not search for that location." }, { status: 502 });
  }
}
