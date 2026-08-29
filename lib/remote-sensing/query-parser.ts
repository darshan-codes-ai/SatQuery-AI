export type AnalysisType =
  | "ndvi"
  | "ndwi"
  | "ndbi"
  | "change"
  | "general";

export function detectAnalysisType(
  query: string
): AnalysisType {
  const text = query.toLowerCase();

  if (
    text.includes("vegetation") ||
    text.includes("ndvi") ||
    text.includes("plant") ||
    text.includes("crop") ||
    text.includes("green")
  ) {
    return "ndvi";
  }

  if (
    text.includes("water") ||
    text.includes("lake") ||
    text.includes("river") ||
    text.includes("ndwi")
  ) {
    return "ndwi";
  }

  if (
    text.includes("urban") ||
    text.includes("building") ||
    text.includes("built") ||
    text.includes("city") ||
    text.includes("ndbi")
  ) {
    return "ndbi";
  }

  if (
    text.includes("change") ||
    text.includes("changed") ||
    text.includes("growth") ||
    text.includes("before") ||
    text.includes("after")
  ) {
    return "change";
  }

  return "general";
}