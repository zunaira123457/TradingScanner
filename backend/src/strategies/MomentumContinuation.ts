import { Strategy, StrategyContext, StrategyResult, latestSnapshot, todayCandle } from '@/types/strategy';
import { calculateRiskReward, targetFromRewardMultiple, atrStop } from './RiskReward';

export interface MomentumContinuationConfig {
  minAdx: number; // minimum ADX14 to count as a "strong" trend, default 25
  minRsi: number; // minimum RSI14 for sustained bullish momentum, default 55
  maxRsi: number; // above this, momentum is considered too extended to chase, default 85
  minRelativeVolume: number; // minimum relative volume, default 1.0
  maxDistanceFromHighPct: number; // max distance below the recent high to still count as "near highs", default 0.08
  recentHighLookback: number; // bars used to find the recent high, default 20
  atrStopMultiple: number; // stop distance in ATRs, default 2.0
  rewardMultiple: number; // target = entry + rewardMultiple * risk, default 2.5
}

export const DEFAULT_MOMENTUM_CONTINUATION_CONFIG: MomentumContinuationConfig = {
  minAdx: 25,
  minRsi: 55,
  maxRsi: 85,
  minRelativeVolume: 1.0,
  maxDistanceFromHighPct: 0.08,
  recentHighLookback: 20,
  atrStopMultiple: 2.0,
  rewardMultiple: 2.5,
};

/**
 * Momentum Continuation: a stock already in a confirmed uptrend (via the
 * shared PriceStructure module) with a strong, positively-directed trend
 * (ADX14 above threshold with +DI14 > -DI14), sustained bullish momentum
 * (RSI in a defined healthy-to-strong band, MACD histogram positive),
 * volume support, strong relative strength (via the shared SectorStrength
 * module, when benchmark data is available), and price still close to its
 * recent high — i.e. NOT a deep pullback (that's the Trend Pullback
 * strategy's job; this one is unashamedly a "buy strength" strategy).
 *
 * This is a rule set, not a claim of profitability — it has not been
 * backtested. Historical performance validation is Phase 4's job.
 */
export class MomentumContinuationStrategy implements Strategy {
  readonly name = 'momentum_continuation';
  readonly description =
    'Confirmed uptrend with a strong, positively-directed ADX reading, sustained RSI/MACD momentum, volume support, and price near its recent high.';

  private config: MomentumContinuationConfig;

  constructor(config: Partial<MomentumContinuationConfig> = {}) {
    this.config = { ...DEFAULT_MOMENTUM_CONTINUATION_CONFIG, ...config };
  }

  evaluate(context: StrategyContext): StrategyResult {
    const base = (overrides: Partial<StrategyResult> = {}): StrategyResult => ({
      strategy: this.name,
      ticker: context.ticker,
      date: context.candles.length > 0 ? todayCandle(context).timestamp : new Date(0),
      setupDetected: false,
      confidence: 0,
      entry: null,
      stop: null,
      target: null,
      riskPerShare: null,
      rewardPerShare: null,
      riskRewardRatio: null,
      evidence: [],
      warnings: [],
      supportingPatterns: [],
      ...overrides,
    });

    if (context.candles.length < this.config.recentHighLookback || context.snapshots.length === 0) {
      return base({ warnings: ['Insufficient candle history'] });
    }

    const snap = latestSnapshot(context);
    const today = todayCandle(context);

    if (snap.adx14 === null || snap.plusDI14 === null || snap.minusDI14 === null) {
      return base({ warnings: ['Insufficient history for ADX (need 29+ trading days)'] });
    }

    const isUptrend = context.structure.trend === 'uptrend';
    const strongDirectionalTrend = snap.adx14 >= this.config.minAdx && snap.plusDI14 > snap.minusDI14;
    const rsiInBand =
      snap.rsi14 !== null && snap.rsi14 >= this.config.minRsi && snap.rsi14 <= this.config.maxRsi;
    const macdPositive = snap.macdHistogram !== null && snap.macdHistogram > 0;
    const volumeOk = snap.relativeVolume === null || snap.relativeVolume >= this.config.minRelativeVolume;

    const highWindow = context.candles.slice(-this.config.recentHighLookback);
    const recentHigh = Math.max(...highWindow.map((c) => c.high));
    const distanceFromHighPct = recentHigh === 0 ? 1 : (recentHigh - today.close) / recentHigh;
    const nearHighs = distanceFromHighPct <= this.config.maxDistanceFromHighPct;

    const relativeStrengthOk =
      context.relativeStrength === null ? true : context.relativeStrength.outperformingBoth;

    const setupDetected =
      isUptrend &&
      strongDirectionalTrend &&
      rsiInBand &&
      macdPositive &&
      volumeOk &&
      nearHighs &&
      relativeStrengthOk;

    if (!setupDetected) {
      const warnings: string[] = [];
      if (!isUptrend) warnings.push(`Structure trend is "${context.structure.trend}", not a confirmed uptrend`);
      if (!strongDirectionalTrend) {
        warnings.push(
          `ADX14 (${snap.adx14.toFixed(1)}) / +DI-DI (${snap.plusDI14.toFixed(1)}/${snap.minusDI14.toFixed(1)}) does not meet the strong-uptrend threshold`
        );
      }
      if (!rsiInBand) warnings.push(`RSI (${snap.rsi14?.toFixed(1) ?? 'n/a'}) outside the ${this.config.minRsi}-${this.config.maxRsi} momentum band`);
      if (!macdPositive) warnings.push('MACD histogram is not positive');
      if (!volumeOk) warnings.push(`Relative volume (${snap.relativeVolume?.toFixed(2)}x) below ${this.config.minRelativeVolume}x`);
      if (!nearHighs) warnings.push(`Price is ${(distanceFromHighPct * 100).toFixed(1)}% below its ${this.config.recentHighLookback}-day high — too extended from highs for continuation`);
      if (!relativeStrengthOk) warnings.push('Not outperforming both sector and benchmark');
      return base({ warnings });
    }

    const entry = today.close;
    const atr = snap.atr14;
    const stop = atr !== null ? atrStop(entry, atr, this.config.atrStopMultiple) : entry * 0.95;

    if (stop >= entry) {
      return base({ warnings: ['Computed stop was not below entry — unable to construct a valid risk/reward setup'] });
    }

    const target = targetFromRewardMultiple(entry, stop, this.config.rewardMultiple);
    const { riskPerShare, rewardPerShare, riskRewardRatio } = calculateRiskReward(entry, stop, target);

    const evidence: string[] = [
      `Confirmed uptrend structure (higher highs and higher lows)`,
      `ADX14 at ${snap.adx14.toFixed(1)} with +DI (${snap.plusDI14.toFixed(1)}) above -DI (${snap.minusDI14.toFixed(1)}) — strong bullish trend`,
      `RSI at ${(snap.rsi14 as number).toFixed(1)} shows sustained bullish momentum`,
      `MACD histogram positive (${(snap.macdHistogram as number).toFixed(3)})`,
      `Price within ${(distanceFromHighPct * 100).toFixed(1)}% of its ${this.config.recentHighLookback}-day high`,
    ];
    if (context.relativeStrength) {
      evidence.push(
        `Outperforming both sector and benchmark over ${context.relativeStrength.periodDays} trading days`
      );
    }

    const warnings: string[] = [
      'No fresh pullback entry — buying strength carries higher mean-reversion risk than a pullback entry',
    ];
    if (snap.rsi14 !== null && snap.rsi14 > 75) {
      warnings.push(`RSI at ${snap.rsi14.toFixed(1)} is extended — elevated risk of a short-term pullback`);
    }

    return base({
      setupDetected: true,
      confidence: Math.min(1, 0.5 * (relativeStrengthOk ? 1 : 0.3) + 0.5 * Math.min(1, snap.adx14 / 40)),
      entry,
      stop,
      target,
      riskPerShare,
      rewardPerShare,
      riskRewardRatio,
      evidence,
      warnings,
      supportingPatterns: [],
    });
  }
}
