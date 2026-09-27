import { Strategy, StrategyContext, StrategyResult, latestSnapshot } from '@/types/strategy';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';

/**
 * Experiment 4 (MOMENTUM_DIAGNOSTICS_REPORT.md Section 8) — a RESEARCH-ONLY
 * strategy variant. This file does NOT modify MomentumContinuationStrategy;
 * it wraps the real, unmodified strategy and adds one additional filter
 * that only ever activates when marketRegime === 'neutral'. It is never
 * registered with StrategyEngine, never used by generateSignals.ts or
 * analyzeSignalWithAI.ts, and never touches the AI layer — it exists solely
 * to be run through Backtester/WalkForward/SensitivityAnalysis for this one
 * diagnostic experiment.
 *
 * PRE-REGISTRATION (fixed BEFORE this variant was run against any holdout
 * data — see runExperiment4NeutralQualityFilter.ts):
 *
 *   Hypothesis: within `neutral` market regime specifically, restricting
 *   momentum_continuation entries to trades where RSI14 < 68 AND
 *   relativeStrength.vsBenchmark > 0.10 improves that regime's results,
 *   motivated by (not fit to) the original diagnostics' neutral-regime
 *   findings (RSI Cohen's d = -0.833, vsBenchmark Cohen's d = +0.779 —
 *   winners were LESS overbought and MORE outperforming than losers).
 *
 *   Thresholds: RSI14 < 68, vsBenchmark > 0.10 — chosen as round numbers
 *   for robustness (per MOMENTUM_DIAGNOSTICS_REPORT.md Section 8's own
 *   illustrative example), NOT fit to the exact means of any dataset. These
 *   values are never adjusted based on how the variant performs.
 *
 *   Validation requirement: per Section 6's discipline, this MUST be
 *   evaluated on data that did NOT generate the hypothesis — i.e. NOT the
 *   original 81-stock, 2020-2026 dataset the RSI/vsBenchmark finding came
 *   from. See runExperiment4NeutralQualityFilter.ts for the two
 *   already-independent holdouts used (Experiment 2's second universe,
 *   Experiment 3's 2015-2019 period).
 *
 * Design guarantee: this variant can only ever turn a neutral-regime
 * setupDetected=true result INTO setupDetected=false. It never turns a
 * false into a true, and it never touches non-neutral-regime results at
 * all (they pass through byte-identical to the base strategy). This makes
 * "does not create new signals, does not affect other regimes' individual
 * trade decisions" an architectural property, not just an empirical hope —
 * though because the Backtester allocates a shared, limited capital/position
 * pool across the whole run, removing some neutral-regime trades CAN still
 * change which OTHER trades get capital (the same substitution effect
 * documented in UniverseFilter.ts) — that portfolio-level interaction is
 * exactly why this is validated empirically too, not asserted from the
 * architecture alone.
 */
export interface NeutralQualityFilterConfig {
  maxRsiInNeutral: number; // default 68
  minVsBenchmarkInNeutral: number; // default 0.10
}

export const DEFAULT_NEUTRAL_QUALITY_FILTER_CONFIG: NeutralQualityFilterConfig = {
  maxRsiInNeutral: 68,
  minVsBenchmarkInNeutral: 0.1,
};

export class NeutralQualityFilterVariant implements Strategy {
  readonly name = 'momentum_continuation_neutral_quality_variant';
  readonly description =
    'RESEARCH VARIANT ONLY (Experiment 4) — momentum_continuation with an additional RSI/relative-strength quality filter applied only in the neutral regime. Not a production strategy.';

  private base: MomentumContinuationStrategy;
  private filterConfig: NeutralQualityFilterConfig;

  constructor(
    base: MomentumContinuationStrategy = new MomentumContinuationStrategy(),
    filterConfig: NeutralQualityFilterConfig = DEFAULT_NEUTRAL_QUALITY_FILTER_CONFIG
  ) {
    this.base = base;
    this.filterConfig = filterConfig;
  }

  evaluate(context: StrategyContext): StrategyResult {
    const baseResult = this.base.evaluate(context);

    if (!baseResult.setupDetected) return baseResult;
    if (context.marketRegime?.label !== 'neutral') return baseResult;

    const snap = latestSnapshot(context);
    const rsiOk = snap.rsi14 !== null && snap.rsi14 < this.filterConfig.maxRsiInNeutral;
    const relStrengthOk =
      context.relativeStrength !== null && context.relativeStrength.vsBenchmark > this.filterConfig.minVsBenchmarkInNeutral;

    if (rsiOk && relStrengthOk) return baseResult;

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
        `Filtered out by Experiment 4 neutral-regime quality filter (RSI14=${snap.rsi14 ?? 'null'} < ${this.filterConfig.maxRsiInNeutral}? ${rsiOk}; vsBenchmark=${context.relativeStrength?.vsBenchmark ?? 'null'} > ${this.filterConfig.minVsBenchmarkInNeutral}? ${relStrengthOk})`,
      ],
      supportingPatterns: baseResult.supportingPatterns,
    };
  }
}
