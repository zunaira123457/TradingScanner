import { Candle } from '@/types';

/**
 * KNOWN LIMITATION: the Backtester walks the universe by shared array
 * INDEX (candles[t] for every ticker refers to "the same trading day t"),
 * which requires every series passed into one backtest run to share an
 * identical trading calendar. This holds for virtually all U.S. equities
 * and ETFs over the same historical window, but is not verified against an
 * authoritative exchange calendar — a genuinely different data source with
 * a hole (e.g. a real trading halt) would violate it. This function is the
 * one guardrail: it throws loudly rather than silently misaligning dates,
 * which would otherwise cause one ticker's day-N data to be evaluated
 * against another ticker's day-M date — a real look-ahead/look-behind risk
 * if left uncaught.
 */
export function validateAlignedCalendars(seriesByLabel: Map<string, Candle[]>): void {
  const entries = [...seriesByLabel.entries()];
  if (entries.length < 2) return;

  const [firstLabel, firstCandles] = entries[0];

  for (let i = 1; i < entries.length; i++) {
    const [label, candles] = entries[i];

    if (candles.length !== firstCandles.length) {
      throw new Error(
        `Trading calendar misalignment: "${label}" has ${candles.length} candles but "${firstLabel}" has ${firstCandles.length}. ` +
          `The backtester requires all series in one run to share an identical trading calendar.`
      );
    }

    // Spot-check a sample of indices rather than every single one (cheap,
    // catches misalignment without O(n) full-date comparison on every run).
    const sampleIndices = sampleIndicesFor(candles.length);
    for (const idx of sampleIndices) {
      const a = firstCandles[idx].timestamp;
      const b = candles[idx].timestamp;
      if (!sameDay(a, b)) {
        throw new Error(
          `Trading calendar misalignment: "${label}" and "${firstLabel}" disagree at index ${idx} ` +
            `(${b.toISOString().slice(0, 10)} vs ${a.toISOString().slice(0, 10)}). ` +
            `The backtester requires all series in one run to share an identical trading calendar.`
        );
      }
    }
  }
}

function sameDay(a: Date, b: Date): boolean {
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

function sampleIndicesFor(length: number): number[] {
  if (length === 0) return [];
  const step = Math.max(1, Math.floor(length / 20)); // ~20 sample points
  const indices: number[] = [];
  for (let i = 0; i < length; i += step) indices.push(i);
  if (indices[indices.length - 1] !== length - 1) indices.push(length - 1);
  return indices;
}
