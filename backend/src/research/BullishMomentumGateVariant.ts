import { Strategy, StrategyContext, StrategyResult, todayCandle } from '@/types/strategy';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { roc } from '@/indicators/Momentum';
import { dateKey } from '@/backtesting/USMarketCalendar';
import { Candle } from '@/types';

/**
 * Experiment 5 (MOMENTUM_DIAGNOSTICS_REPORT.md Section 8) — a RESEARCH-ONLY
 * strategy variant, structured identically to Experiment 4's
 * NeutralQualityFilterVariant. Does NOT modify MomentumContinuationStrategy;
 * wraps the real, unmodified strategy and adds one additional filter that
 * only ever activates when marketRegime === 'bullish'. Never registered
 * with StrategyEngine, never reachable from generateSignals.ts,
 * analyzeSignalWithAI.ts, or the AI layer.
 *
 * PRE-REGISTRATION (fixed BEFORE this variant was run against any holdout
 * data — see runExperiment5BullishMomentumGate.ts):
 *
 *   Hypothesis: requiring the broad market's (SPY's) own 12-day rate of
 *   change to be positive before taking a `bullish`-regime signal filters
 *   out some of the currently near-breakeven `bullish`-regime trades.
 *   Motivated by (not fit to) the original diagnostics' finding that
 *   `bullish` vs `strong_bullish` differ almost entirely in broad-market
 *   12-day ROC (Cohen's d = +0.624), while the strategy's own filters
 *   (ADX, multi-timeframe alignment) are statistically identical between
 *   the two regimes (d≈0) — i.e. the strategy currently has no explicit
 *   broad-market-momentum awareness beyond the coarse regime label.
 *
 *   Gate: SPY's OWN 12-day ROC (the same `roc(closes, 12)` function used
 *   for every stock's own roc12 indicator, applied here to the benchmark
 *   series) must be > 0% — the simplest, least-tuned round-number
 *   threshold available ("the broad market must have been net positive
 *   over the last ~2.5 weeks"), not fit to any dataset's exact mean.
 *
 *   Validation requirement: per Section 6, evaluated ONLY on data that did
 *   NOT generate the hypothesis — see runExperiment5BullishMomentumGate.ts
 *   for the two already-independent holdouts used (same as Experiment 4).
 *
 * No-look-ahead: buildSpyRoc12ByDate() computes roc(closes, 12) once over
 * the full benchmark series — safe because roc()'s own formula only ever
 * references index i and i-12 (strictly backward-looking), exactly the
 * same principle that makes IndicatorEngine.calculateAll(candles) safe to
 * precompute once and index into per day (see StrategyContext.ts).
 *
 * Design guarantee: identical in kind to Experiment 4's variant — can only
 * ever turn a bullish-regime setupDetected=true into false, never the
 * reverse, and never touches non-bullish-regime results directly (though
 * the shared portfolio capital pool can still produce substitution effects
 * on other regimes' trade counts, as documented and observed in
 * Experiments 2-4).
 */
export interface BullishMomentumGateConfig {
  minSpyRoc12Pct: number; // default 0
}

export const DEFAULT_BULLISH_MOMENTUM_GATE_CONFIG: BullishMomentumGateConfig = {
  minSpyRoc12Pct: 0,
};

/** Builds a dateKey -> SPY 12-day ROC(%) lookup from the benchmark series. */
export function buildSpyRoc12ByDate(benchmarkCandles: Candle[]): Map<string, number> {
  const closes = benchmarkCandles.map((c) => c.close);
  const rocValues = roc(closes, 12);
  const map = new Map<string, number>();
  for (let i = 0; i < benchmarkCandles.length; i++) {
    const v = rocValues[i];
    if (v !== null) map.set(dateKey(benchmarkCandles[i].timestamp), v);
  }
  return map;
}

export class BullishMomentumGateVariant implements Strategy {
  readonly name = 'momentum_continuation_bullish_momentum_gate_variant';
  readonly description =
    'RESEARCH VARIANT ONLY (Experiment 5) — momentum_continuation with an additional broad-market (SPY) 12-day ROC gate applied only in the bullish regime. Not a production strategy.';

  private base: MomentumContinuationStrategy;
  private spyRoc12ByDate: Map<string, number>;
  private filterConfig: BullishMomentumGateConfig;

  constructor(
    spyRoc12ByDate: Map<string, number>,
    base: MomentumContinuationStrategy = new MomentumContinuationStrategy(),
    filterConfig: BullishMomentumGateConfig = DEFAULT_BULLISH_MOMENTUM_GATE_CONFIG
  ) {
    this.spyRoc12ByDate = spyRoc12ByDate;
    this.base = base;
    this.filterConfig = filterConfig;
  }

  evaluate(context: StrategyContext): StrategyResult {
    const baseResult = this.base.evaluate(context);

    if (!baseResult.setupDetected) return baseResult;
    if (context.marketRegime?.label !== 'bullish') return baseResult;

    const today = todayCandle(context);
    const spyRoc12 = this.spyRoc12ByDate.get(dateKey(today.timestamp));
    const gateOk = spyRoc12 !== undefined && spyRoc12 > this.filterConfig.minSpyRoc12Pct;

    if (gateOk) return baseResult;

    return {
      ...baseResult,
      setupDetected: false,
      confidence: 0,
      entry: null,
      stop: null,
      target: null,
      riskPerShare: null,
      rewardPerShare: null,
      riskRewardRatio: null,
      evidence: [],
      warnings: [
        ...baseResult.warnings,
        `Filtered out by Experiment 5 bullish-regime market-momentum gate (SPY 12-day ROC=${spyRoc12 ?? 'unavailable'}%, required > ${this.filterConfig.minSpyRoc12Pct}%)`,
      ],
      supportingPatterns: baseResult.supportingPatterns,
    };
  }
}
