import { StrategyContext, StrategyResult, latestSnapshot, todayCandle } from '@/types/strategy';
import { SignalExplanation } from '@/types/scoring';
import { AIAnalysisContext } from '@/types/ai';
import { HistoricalStrategyStats } from '@/research/HistoricalStrategyStats';

/**
 * Builds the strict, point-in-time-safe DTO the AI layer is allowed to see.
 *
 * NO-LOOK-AHEAD CONTRACT: this function only reads
 *   - the LATEST snapshot/candle of `context` (i.e. "today" as `context`
 *     itself already defines it — this function does not know and cannot
 *     access anything past `context.candles[context.candles.length - 1]`),
 *   - `strategyResult` and `explanation`, both already computed as of that
 *     same "today", and
 *   - `historicalStats`, which is itself always a snapshot of a CLOSED,
 *     already-completed backtest dataset (never a live/future-looking
 *     source) and is labeled exploratory/in-sample throughout.
 *
 * It deliberately does NOT copy `context.candles` or `context.snapshots`
 * (the full historical arrays) into the output — only today's scalar
 * indicator values. This is what makes it structurally impossible for this
 * DTO to smuggle in "the complete historical dataset" the way passing a raw
 * StrategyContext around could (see PROJECT_STATE.md Section 0.7 and
 * MOMENTUM_DIAGNOSTICS_REPORT.md Section 7's "no look-ahead" requirement).
 *
 * See tests/unit/ai/AIAnalysisContext.test.ts for the equivalence test
 * proving this: building the context from a candle array truncated exactly
 * to asOfIndex vs. one extended arbitrarily into the future must produce a
 * byte-identical AIAnalysisContext.
 */
export function buildAIAnalysisContext(
  context: StrategyContext,
  strategyResult: StrategyResult,
  explanation: SignalExplanation,
  historicalStats: HistoricalStrategyStats
): AIAnalysisContext {
  const snap = latestSnapshot(context);
  const today = todayCandle(context);

  return {
    ticker: context.ticker,
    strategy: strategyResult.strategy,
    asOfDate: today.timestamp,

    setupDetected: strategyResult.setupDetected,
    entry: strategyResult.entry,
    stop: strategyResult.stop,
    target: strategyResult.target,
    riskRewardRatio: strategyResult.riskRewardRatio,

    classification: explanation.classification,
    quantitativeScore: explanation.scoreBreakdown,

    strategyEvidence: [...strategyResult.evidence],
    strategyWarnings: [...strategyResult.warnings],
    deterministicReasons: [...explanation.reasons],
    deterministicRisks: [...explanation.risks],
    invalidation: explanation.invalidation,

    indicators: {
      close: today.close,
      rsi14: snap.rsi14,
      adx14: snap.adx14,
      plusDI14: snap.plusDI14,
      minusDI14: snap.minusDI14,
      macdHistogram: snap.macdHistogram,
      atr14: snap.atr14,
      relativeVolume: snap.relativeVolume,
      historicalVolatility20: snap.historicalVolatility20,
      sma50: snap.sma50,
      sma200: snap.sma200,
    },

    trendStructure: context.structure.trend,
    dailyTrend: context.multiTimeframe.dailyTrend,
    weeklyTrend: context.multiTimeframe.weeklyTrend,
    mtfAligned: context.multiTimeframe.aligned,

    marketRegime: context.marketRegime
      ? {
          label: context.marketRegime.label,
          compositeScore: context.marketRegime.compositeScore,
          isHighVolatility: context.marketRegime.isHighVolatility,
        }
      : null,

    relativeStrength: context.relativeStrength
      ? {
          vsBenchmark: context.relativeStrength.vsBenchmark,
          vsSector: context.relativeStrength.vsSector,
          outperformingBoth: context.relativeStrength.outperformingBoth,
          periodDays: context.relativeStrength.periodDays,
        }
      : null,

    historicalContext: {
      baseline: historicalStats.getBaseline(strategyResult.strategy),
      regimeStats: context.marketRegime
        ? historicalStats.getRegimeStats(strategyResult.strategy, context.marketRegime.label)
        : null,
      tickerStats: historicalStats.getTickerStats(strategyResult.strategy, context.ticker),
    },
  };
}
