/**
 * Uniform structured output for every named chart pattern. `details` carries
 * pattern-specific numeric evidence (e.g. resistance level, retracement %)
 * so every claim in a signal explanation can be traced back to a real number.
 */
export interface ChartPatternResult {
  pattern: string;
  detected: boolean;
  confidence: number; // 0-1, deterministic — never model-invented
  invalidationPrice: number | null;
  details: Record<string, number | string | boolean | null>;
}
