export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}
