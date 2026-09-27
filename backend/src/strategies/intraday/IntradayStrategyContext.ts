import { Candle } from '@/types';
import { IntradayContext, IntradaySnapshot } from '@/types/intraday';
import { IntradayIndicatorEngine } from '@/indicators/IntradayIndicatorEngine';
import { tradingDayKey } from '@/indicators/VWAP';

export interface BuildIntradayContextOptions {
  /**
   * Number of leading bars of today's session that make up the opening
   * range. Default 3 = 15 minutes of 5-minute bars.
   */
  openingRangeBars?: number;
  /**
   * Already-computed snapshots for this exact ticker's candle history (or a
   * longer array this `candles` is a prefix of) — skips recomputation.
   * IndicatorSnapshot[i] only ever depends on candles[0..i] (the whole
   * point of the no-look-ahead contract documented on IntradaySnapshot), so
   * computing it once up front and slicing is exactly equivalent to
   * recomputing from scratch each call — this exists purely to avoid the
   * O(n^2) cost of a backtest rebuilding full indicator history at every
   * single bar. The live daemon doesn't pass this (it has no "full history"
   * to precompute from — each poll cycle fetches fresh).
   */
  precomputedSnapshots?: IntradaySnapshot[];
}

/**
 * Builds an IntradayContext from a candle series that may span more than
 * one trading day (prior-day bars are needed to warm up EMA21/RSI14 before
 * today's session has 21+ bars of its own). The opening range is computed
 * from only the most recent trading day's bars, and stays null until that
 * day has at least `openingRangeBars` bars.
 */
export function buildIntradayContext(
  ticker: string,
  candles: Candle[],
  options: BuildIntradayContextOptions = {}
): IntradayContext {
  const { openingRangeBars = 3 } = options;

  const snapshots = options.precomputedSnapshots
    ? options.precomputedSnapshots.slice(0, candles.length)
    : IntradayIndicatorEngine.calculateAll(candles);

  let openingRangeHigh: number | null = null;
  let openingRangeLow: number | null = null;

  if (candles.length > 0) {
    const todayKey = tradingDayKey(candles[candles.length - 1].timestamp);
    // Scan backward from the tail until the trading day changes, rather
    // than filtering the whole history — today's own bars are always a
    // short run at the end, so this is O(bars in today's session so far),
    // not O(candles.length).
    let startIdx = candles.length - 1;
    while (startIdx > 0 && tradingDayKey(candles[startIdx - 1].timestamp) === todayKey) {
      startIdx -= 1;
    }
    const todaysBars = candles.slice(startIdx);
    const openingBars = todaysBars.slice(0, openingRangeBars);
    if (openingBars.length === openingRangeBars) {
      openingRangeHigh = Math.max(...openingBars.map((c) => c.high));
      openingRangeLow = Math.min(...openingBars.map((c) => c.low));
    }
  }

  return { ticker, candles, snapshots, openingRangeHigh, openingRangeLow };
}
