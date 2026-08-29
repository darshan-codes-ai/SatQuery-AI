export function normalizedDifference(
  a: number,
  b: number
): number {
  const denominator = a + b;

  if (denominator === 0) {
    return 0;
  }

  return (a - b) / denominator;
}

export function calculateNDVI(
  nir: number,
  red: number
): number {
  return normalizedDifference(nir, red);
}

export function calculateNDWI(
  green: number,
  nir: number
): number {
  return normalizedDifference(green, nir);
}

export function calculateNDBI(
  swir: number,
  nir: number
): number {
  return normalizedDifference(swir, nir);
}

export function classifyNDVI(ndvi: number): string {
  if (ndvi < 0) {
    return "Water or non-vegetated surface";
  }

  if (ndvi < 0.2) {
    return "Bare soil or sparse vegetation";
  }

  if (ndvi < 0.4) {
    return "Moderate vegetation";
  }

  if (ndvi < 0.6) {
    return "Healthy vegetation";
  }

  return "Very healthy dense vegetation";
}