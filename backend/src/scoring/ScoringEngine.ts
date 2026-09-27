import { StrategyContext, latestSnapshot } from '@/types/strategy';
import { StrategyResult } from '@/types/strategy';
import { ScoringWeights, ScoreBreakdown, SignalClassification, ClassificationThresholds } from '@/types/scoring';
import { clamp01 } from '@/utils/mathUtils';

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  trend: 0.2,
  momentum: 0.15,
  volume: 0.15,
  relativeStrength: 0.15,
  chartSetup: 0.2,
  marketRegime: 0.05,
  riskReward: 0.1,
};

const WEIGHT_SUM_EPSILON = 1e-6;

/**
 * Throws if the weights don't sum to 1.0 (within a small epsilon) — a score
 * built from weights that don't sum to 1 would not be a meaningful 0-100
 * scale, so this is treated as a configuration error rather than silently
 * rescaling.
 */
export function validateWeights(weights: ScoringWeights): void {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > WEIGHT_SUM_EPSILON) {
    throw new Error(`Scoring weights must sum to 1.0, got ${sum}`);
  }
  for (const [key, value] of Object.entries(weights)) {
    if (value < 0) {
      throw new Error(`Scoring weight "${key}" must be non-negative, got ${value}`);
    }
  }
}

/**
 * Trend component (0-1): blends multi-timeframe alignment (weekly+daily
 * agreement, from the shared MultiTimeframe module) with the daily swing
 * structure itself (from the shared PriceStructure module), so a stock
 * gets full credit only when BOTH the moving-average-based trend read and
 * the raw higher-high/higher-low structure agree.
 */
function trendComponent(context: StrategyContext): number {
  const structureScore =
    context.structure.trend === 'uptrend' ? 1 : context.structure.trend === 'sideways' ? 0.5 : 0;
  return clamp01(0.5 * context.multiTimeframe.alignmentScore + 0.5 * structureScore);
}

/**
 * Momentum component (0-1): RSI normalized linearly over [30,70], MACD
 * histogram sign, and ADX trend strength gated by direction (+DI vs -DI).
 * Each sub-formula is documented and fixed — no per-signal tuning.
 */
function momentumComponent(context: StrategyContext): number {
  const snap = latestSnapshot(context);

  const rsiScore = snap.rsi14 === null ? 0.5 : clamp01((snap.rsi14 - 30) / 40);
  const macdScore = snap.macdHistogram === null ? 0.5 : snap.macdHistogram > 0 ? 1 : 0;
  const adxScore =
    snap.adx14 === null || snap.plusDI14 === null || snap.minusDI14 === null
      ? 0.5
      : clamp01(snap.adx14 / 40) * (snap.plusDI14 > snap.minusDI14 ? 1 : 0);

  return clamp01(0.4 * rsiScore + 0.3 * macdScore + 0.3 * adxScore);
}

/**
 * Volume component (0-1): relative volume linearly normalized so 2x average
 * volume maps to a full score.
 */
function volumeComponent(context: StrategyContext): number {
  const snap = latestSnapshot(context);
  return snap.relativeVolume === null ? 0.5 : clamp01(snap.relativeVolume / 2.0);
}

/**
 * Relative strength component (0-1): normalizes SectorStrength's
 * scoreAdjustment (range -0.10..+0.15) onto 0-1.
 */
function relativeStrengthComponent(context: StrategyContext): number {
  if (context.relativeStrength === null) return 0.5;
  return clamp01((context.relativeStrength.scoreAdjustment + 0.1) / 0.25);
}

/**
 * Chart setup component (0-1): the strategy's own deterministic confidence,
 * which is itself derived from the Phase 2 pattern confidences it relied on.
 */
export function chartSetupComponent(strategyResult: StrategyResult): number {
  return clamp01(strategyResult.confidence);
}

/**
 * Market regime component (0-1): fixed mapping from the six MarketRegime
 * labels. High volatility is scored below neutral regardless of trend
 * direction, reflecting elevated execution/risk uncertainty.
 */
function marketRegimeComponent(context: StrategyContext): number {
  if (context.marketRegime === null) return 0.5;
  switch (context.marketRegime.label) {
    case 'strong_bullish':
      return 1.0;
    case 'bullish':
      return 0.75;
    case 'neutral':
      return 0.5;
    case 'bearish':
      return 0.25;
    case 'strong_bearish':
      return 0.0;
    case 'high_volatility':
      return 0.3;
  }
}

/**
 * Risk/reward component (0-1): linearly normalized so a 3:1 ratio maps to
 * a full score. A null or non-positive ratio scores 0.
 */
export function riskRewardComponent(strategyResult: StrategyResult): number {
  if (strategyResult.riskRewardRatio === null || strategyResult.riskRewardRatio <= 0) return 0;
  return clamp01(strategyResult.riskRewardRatio / 3.0);
}

/**
 * Computes the transparent 0-100 score. Every component is a pure function
 * of already-computed, real data (Phase 2 modules + the strategy's own
 * result) — nothing here is inferred or estimated by a model.
 *
 * Important: if setupDetected is false, the score is 0. The strategy's own
 * rules must fire (setupDetected = true) for any score component to matter.
 * This prevents different strategies from appearing to have equal scores when
 * none of them detected a setup.
 */
export function calculateScore(
  context: StrategyContext,
  strategyResult: StrategyResult,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS
): ScoreBreakdown {
  validateWeights(weights);

  // If no setup was detected, the score is 0. The strategy's own rules must
  // fire before any score components are computed.
  if (!strategyResult.setupDetected) {
    return { trend: 0, momentum: 0, volume: 0, relativeStrength: 0, chartSetup: 0, marketRegime: 0, riskReward: 0, total: 0 };
  }

  const trend = trendComponent(context) * weights.trend * 100;
  const momentum = momentumComponent(context) * weights.momentum * 100;
  const volume = volumeComponent(context) * weights.volume * 100;
  const relativeStrength = relativeStrengthComponent(context) * weights.relativeStrength * 100;
  const chartSetup = chartSetupComponent(strategyResult) * weights.chartSetup * 100;
  const marketRegime = marketRegimeComponent(context) * weights.marketRegime * 100;
  const riskReward = riskRewardComponent(strategyResult) * weights.riskReward * 100;

  const total = trend + momentum + volume + relativeStrength + chartSetup + marketRegime + riskReward;

  return { trend, momentum, volume, relativeStrength, chartSetup, marketRegime, riskReward, total };
}

export const DEFAULT_CLASSIFICATION_THRESHOLDS: ClassificationThresholds = {
  buy: 75,
  watch: 50,
};

/**
 * Classification requires BOTH a detected setup AND a sufficient score.
 * A high score with no detected setup is still AVOID — the score alone
 * never manufactures a signal that the strategy's own rules didn't fire.
 */
export function classifySignal(
  score: number,
  setupDetected: boolean,
  thresholds: ClassificationThresholds = DEFAULT_CLASSIFICATION_THRESHOLDS
): SignalClassification {
  if (!setupDetected) return 'AVOID';
  if (score >= thresholds.buy) return 'BUY';
  if (score >= thresholds.watch) return 'WATCH';
  return 'AVOID';
}
