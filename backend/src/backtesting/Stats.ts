export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Coefficient of variation: stdDev / |mean|. 0 when mean is 0 (avoids divide-by-zero noise). */
export function coefficientOfVariation(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return stdDev(values) / Math.abs(m);
}
