import { Candle } from '@/types';
import { StrategyResult } from '@/types/strategy';

/**
 * A single point-in-time intraday indicator snapshot. Unlike
 * IndicatorSnapshot (daily bars, 20-200 period lookbacks), periods here are
 * tuned for 5-minute bars — see IntradayIndicatorEngine.
 * snapshot[i] must only be derived from candles[0..i] — never future data.
 */
export interface IntradaySnapshot {
  date: Date;
  close: number;
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  atr14: number | null;
  vwap: number | null;
  relativeVolume: number | null; // vs a rolling same-bar-count baseline, not a 20-day one
}

/**
 * Everything an intraday strategy needs to evaluate a setup, built once per
 * (ticker, today) from that day's intraday candles.
 */
export interface IntradayContext {
  ticker: string;
  candles: Candle[];
  snapshots: IntradaySnapshot[]; // IntradayIndicatorEngine.calculateAll(candles), same length/order as candles
  openingRangeHigh: number | null; // high of the first openingRangeBars bars of today's session, null if today hasn't started yet
  openingRangeLow: number | null;
}

/**
 * The intraday counterpart to Strategy (src/types/strategy.ts) — evaluates
 * against an IntradayContext instead of a daily StrategyContext, but
 * produces the same StrategyResult shape so scoring/order execution don't
 * need to know which kind of strategy produced a result.
 */
export interface IntradayStrategy {
  readonly name: string;
  readonly description: string;
  evaluate(context: IntradayContext): StrategyResult;
}

export function latestIntradaySnapshot(context: IntradayContext): IntradaySnapshot {
  return context.snapshots[context.snapshots.length - 1];
}

export function todayIntradayCandle(context: IntradayContext): Candle {
  return context.candles[context.candles.length - 1];
}
