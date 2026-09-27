import { Candle } from '@/types';
import { IndicatorSnapshot } from '@/types/indicators';
import { StructureAnalysis } from '@/types/patterns';
import { ChartPatternResult } from '@/types/chartPatterns';
import { MultiTimeframeResult, MarketRegimeResult, RelativeStrengthResult } from '@/types/analysis';

/**
 * Everything a strategy needs to evaluate a setup, built ONCE per (ticker,
 * as-of-date) from the shared Phase 2 modules. Nothing in here is
 * recomputed by individual strategies — they only read from it.
 *
 * NO LOOK-AHEAD CONTRACT: `candles` (and every derived field) must reflect
 * only information available at or before `candles[candles.length-1]`
 * ("today"). See StrategyContext.ts's buildStrategyContext for how this is
 * enforced for the stock's own data; auxiliary data (market index candles,
 * sector candles, benchmark candles) must be pre-sliced by the caller to
 * the same as-of date — this module cannot verify that alignment for you.
 */
export interface StrategyContext {
  ticker: string;
  candles: Candle[];
  snapshots: IndicatorSnapshot[]; // IndicatorEngine.calculateAll(candles), same length/order as candles
  structure: StructureAnalysis;
  multiTimeframe: MultiTimeframeResult;
  marketRegime: MarketRegimeResult | null; // null when no index data was supplied
  relativeStrength: RelativeStrengthResult | null; // null when no benchmark data was supplied
}

/**
 * Convenience accessor — the latest (i.e. "today's") indicator snapshot.
 */
export function latestSnapshot(context: StrategyContext): IndicatorSnapshot {
  return context.snapshots[context.snapshots.length - 1];
}

export function todayCandle(context: StrategyContext): Candle {
  return context.candles[context.candles.length - 1];
}

/**
 * The result of running one strategy against one StrategyContext.
 *
 * `confidence` is the strategy's own deterministic 0-1 read on how strong
 * THIS setup is (derived from the Phase 2 pattern confidences it used) —
 * it feeds the "Chart Setup" scoring category. It is NOT a probability of
 * profit and must never be described as one; no historical win-rate data
 * exists yet (that arrives in Phase 4's backtesting/historical-setup work).
 */
export interface StrategyResult {
  strategy: string;
  ticker: string;
  date: Date;
  setupDetected: boolean;
  confidence: number; // 0-1, 0 when setupDetected is false
  entry: number | null;
  stop: number | null;
  target: number | null;
  riskPerShare: number | null;
  rewardPerShare: number | null;
  riskRewardRatio: number | null;
  evidence: string[]; // positive, evidence-backed reasons
  warnings: string[]; // caution flags, still evidence-backed
  supportingPatterns: ChartPatternResult[]; // the Phase 2 pattern results this strategy relied on
}

export interface Strategy {
  readonly name: string;
  readonly description: string;
  evaluate(context: StrategyContext): StrategyResult;
}
