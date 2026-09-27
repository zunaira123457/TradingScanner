import {
  IntradayStrategy,
  IntradayContext,
  latestIntradaySnapshot,
  todayIntradayCandle,
} from '@/types/intraday';
import { StrategyResult } from '@/types/strategy';
import { calculateRiskReward, targetFromRewardMultiple, atrStop } from '../RiskReward';

export interface MomentumBreakoutConfig {
  recentHighLookbackBars: number; // bars used to find the short-term high being broken, default 20 (~100 min of 5-min bars)
  minRelativeVolume: number; // minimum relative volume spike, default 2.0
  minRsi: number; // minimum RSI14 for strong momentum, default 55
  maxRsi: number; // above this, momentum is considered too extended to chase, default 85
  atrStopMultiple: number; // stop distance in ATRs, default 1.0
  rewardMultiple: number; // target = entry + rewardMultiple * risk, default 2.0
}

export const DEFAULT_MOMENTUM_BREAKOUT_CONFIG: MomentumBreakoutConfig = {
  recentHighLookbackBars: 20,
  minRelativeVolume: 2.0,
  minRsi: 55,
  maxRsi: 85,
  atrStopMultiple: 1.0,
  rewardMultiple: 2.0,
};

/**
 * Momentum Breakout: the intraday analog of the daily MomentumContinuation
 * strategy. A short-term EMA9-over-EMA21 uptrend, RSI in a healthy-to-strong
 * band, a relative-volume spike, and a break of the recent (lookback-bar)
 * high — "buy strength with volume confirmation," not a pullback entry.
 *
 * This is a rule set, not a claim of profitability — it has not been
 * backtested.
 */
export class MomentumBreakoutStrategy implements IntradayStrategy {
  readonly name = 'momentum_breakout';
  readonly description =
    'Short-term uptrend (EMA9 > EMA21) breaks its recent high on a relative-volume spike with RSI in a healthy-to-strong band.';

  private config: MomentumBreakoutConfig;

  constructor(config: Partial<MomentumBreakoutConfig> = {}) {
    this.config = { ...DEFAULT_MOMENTUM_BREAKOUT_CONFIG, ...config };
  }

  evaluate(context: IntradayContext): StrategyResult {
    const base = (overrides: Partial<StrategyResult> = {}): StrategyResult => ({
      strategy: this.name,
      ticker: context.ticker,
      date: context.candles.length > 0 ? todayIntradayCandle(context).timestamp : new Date(0),
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

    if (context.candles.length <= this.config.recentHighLookbackBars || context.snapshots.length === 0) {
      return base({ warnings: ['Insufficient candle history'] });
    }

    const snap = latestIntradaySnapshot(context);
    const today = todayIntradayCandle(context);

    if (snap.ema9 === null || snap.ema21 === null || snap.rsi14 === null) {
      return base({ warnings: ['Insufficient history for EMA/RSI'] });
    }

    const trendUp = snap.ema9 > snap.ema21;
    const rsiInBand = snap.rsi14 >= this.config.minRsi && snap.rsi14 <= this.config.maxRsi;
    const volumeOk = snap.relativeVolume !== null && snap.relativeVolume >= this.config.minRelativeVolume;

    const priorBars = context.candles.slice(-this.config.recentHighLookbackBars - 1, -1);
    const recentHigh = Math.max(...priorBars.map((c) => c.high));
    const brokeOut = today.close > recentHigh;

    const setupDetected = trendUp && rsiInBand && volumeOk && brokeOut;

    if (!setupDetected) {
      const warnings: string[] = [];
      if (!trendUp) warnings.push(`EMA9 (${snap.ema9.toFixed(2)}) is not above EMA21 (${snap.ema21.toFixed(2)})`);
      if (!rsiInBand) warnings.push(`RSI (${snap.rsi14.toFixed(1)}) outside the ${this.config.minRsi}-${this.config.maxRsi} momentum band`);
      if (!volumeOk) warnings.push(`Relative volume (${snap.relativeVolume?.toFixed(2) ?? 'n/a'}x) below the ${this.config.minRelativeVolume}x spike threshold`);
      if (!brokeOut) warnings.push(`Price ($${today.close.toFixed(2)}) has not broken the ${this.config.recentHighLookbackBars}-bar high ($${recentHigh.toFixed(2)})`);
      return base({ warnings });
    }

    const entry = today.close;
    const stop = snap.atr14 !== null ? atrStop(entry, snap.atr14, this.config.atrStopMultiple) : entry * 0.99;

    if (stop >= entry) {
      return base({ warnings: ['Computed stop was not below entry — unable to construct a valid risk/reward setup'] });
    }

    const target = targetFromRewardMultiple(entry, stop, this.config.rewardMultiple);
    const { riskPerShare, rewardPerShare, riskRewardRatio } = calculateRiskReward(entry, stop, target);

    const evidence: string[] = [
      `EMA9 (${snap.ema9.toFixed(2)}) above EMA21 (${snap.ema21.toFixed(2)}) — short-term uptrend`,
      `RSI at ${snap.rsi14.toFixed(1)} shows strong momentum`,
      `Relative volume ${(snap.relativeVolume as number).toFixed(2)}x confirms the breakout`,
      `Broke the ${this.config.recentHighLookbackBars}-bar high of $${recentHigh.toFixed(2)}`,
    ];

    const warnings: string[] = [];
    if (snap.rsi14 > 78) {
      warnings.push(`RSI at ${snap.rsi14.toFixed(1)} is extended — elevated risk of an immediate pullback`);
    }

    return base({
      setupDetected: true,
      confidence: Math.min(1, 0.5 * Math.min(1, (snap.relativeVolume as number) / (this.config.minRelativeVolume * 1.5)) + 0.5 * Math.min(1, snap.rsi14 / 100)),
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
