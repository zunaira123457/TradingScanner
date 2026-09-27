import {
  IntradayStrategy,
  IntradayContext,
  latestIntradaySnapshot,
  todayIntradayCandle,
} from '@/types/intraday';
import { StrategyResult } from '@/types/strategy';
import { calculateRiskReward, targetFromRewardMultiple, atrStop } from '../RiskReward';

export interface VwapTrendContinuationConfig {
  vwapSlopeLookbackBars: number; // bars back to compare VWAP against for a "rising" read, default 6 (30 min of 5-min bars)
  pullbackLookbackBars: number; // bars searched (excluding the current bar) for a recent touch of VWAP, default 5
  maxPullbackDistancePct: number; // how close a low must get to VWAP to count as a "touch", default 0.003 (0.3%)
  minRsi: number; // RSI must be turning up from at least this level, default 40
  maxRsi: number; // above this the bounce is considered too extended to chase, default 72
  atrStopMultiple: number; // fallback/tightening stop distance in ATRs, default 1.0
  rewardMultiple: number; // target = entry + rewardMultiple * risk, default 2.0
}

export const DEFAULT_VWAP_TREND_CONTINUATION_CONFIG: VwapTrendContinuationConfig = {
  vwapSlopeLookbackBars: 6,
  pullbackLookbackBars: 5,
  maxPullbackDistancePct: 0.003,
  minRsi: 40,
  maxRsi: 72,
  atrStopMultiple: 1.0,
  rewardMultiple: 2.0,
};

/**
 * VWAP Trend Continuation: price is above a rising session VWAP (an
 * intraday uptrend by the day-trading community's most common reference
 * line), pulled back to touch VWAP within the last few bars, and is now
 * turning back up (RSI rising off a still-healthy level, current bar
 * closing green) — a continuation entry on the pullback rather than a chase
 * of an already-extended move.
 *
 * This is a rule set, not a claim of profitability — it has not been
 * backtested.
 */
export class VwapTrendContinuationStrategy implements IntradayStrategy {
  readonly name = 'vwap_trend_continuation';
  readonly description =
    'Price above a rising VWAP pulls back to touch it, then turns back up on rising RSI.';

  private config: VwapTrendContinuationConfig;

  constructor(config: Partial<VwapTrendContinuationConfig> = {}) {
    this.config = { ...DEFAULT_VWAP_TREND_CONTINUATION_CONFIG, ...config };
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

    const minBars = this.config.vwapSlopeLookbackBars + this.config.pullbackLookbackBars + 1;
    if (context.candles.length < minBars || context.snapshots.length === 0) {
      return base({ warnings: ['Insufficient candle history'] });
    }

    const snap = latestIntradaySnapshot(context);
    const today = todayIntradayCandle(context);
    const n = context.snapshots.length;

    if (snap.vwap === null || snap.rsi14 === null) {
      return base({ warnings: ['VWAP or RSI not yet available'] });
    }

    const priceAboveVwap = today.close > snap.vwap;

    const slopeSnap = context.snapshots[n - 1 - this.config.vwapSlopeLookbackBars];
    const vwapRising = slopeSnap.vwap !== null && snap.vwap > slopeSnap.vwap;

    const pullbackWindow = context.candles.slice(n - 1 - this.config.pullbackLookbackBars, n - 1);
    const pullbackVwaps = context.snapshots.slice(n - 1 - this.config.pullbackLookbackBars, n - 1);
    const touches = pullbackWindow
      .map((c, i) => ({ low: c.low, vwap: pullbackVwaps[i].vwap }))
      .filter((t) => t.vwap !== null && (t.vwap - t.low) / t.vwap <= this.config.maxPullbackDistancePct && t.low <= t.vwap);
    const touchedVwapRecently = touches.length > 0;

    const prevSnap = context.snapshots[n - 2];
    const rsiTurningUp =
      prevSnap.rsi14 !== null &&
      snap.rsi14 > prevSnap.rsi14 &&
      snap.rsi14 >= this.config.minRsi &&
      snap.rsi14 <= this.config.maxRsi;

    const bullishBar = today.close > today.open;

    const setupDetected = priceAboveVwap && vwapRising && touchedVwapRecently && rsiTurningUp && bullishBar;

    if (!setupDetected) {
      const warnings: string[] = [];
      if (!priceAboveVwap) warnings.push(`Price ($${today.close.toFixed(2)}) is not above VWAP ($${snap.vwap.toFixed(2)})`);
      if (!vwapRising) warnings.push('VWAP is not rising over the lookback window');
      if (!touchedVwapRecently) warnings.push(`No recent touch of VWAP within ${(this.config.maxPullbackDistancePct * 100).toFixed(1)}%`);
      if (!rsiTurningUp) warnings.push(`RSI (${snap.rsi14.toFixed(1)}) is not turning up within the ${this.config.minRsi}-${this.config.maxRsi} band`);
      if (!bullishBar) warnings.push('Current bar has not closed green');
      return base({ warnings });
    }

    const entry = today.close;
    const pullbackLow = Math.min(...touches.map((t) => t.low));
    const atrBasedStop = snap.atr14 !== null ? atrStop(entry, snap.atr14, this.config.atrStopMultiple) : null;
    const stop = atrBasedStop !== null && atrBasedStop > pullbackLow ? atrBasedStop : pullbackLow;

    if (stop >= entry) {
      return base({ warnings: ['Computed stop was not below entry — unable to construct a valid risk/reward setup'] });
    }

    const target = targetFromRewardMultiple(entry, stop, this.config.rewardMultiple);
    const { riskPerShare, rewardPerShare, riskRewardRatio } = calculateRiskReward(entry, stop, target);

    const evidence: string[] = [
      `Price ($${entry.toFixed(2)}) above a rising VWAP ($${snap.vwap.toFixed(2)})`,
      `Touched VWAP within the last ${this.config.pullbackLookbackBars} bars and turned back up`,
      `RSI rising to ${snap.rsi14.toFixed(1)} from ${(prevSnap.rsi14 as number).toFixed(1)}`,
    ];

    const warnings: string[] = [];
    if (snap.rsi14 > 65) {
      warnings.push(`RSI at ${snap.rsi14.toFixed(1)} is nearing the extended threshold`);
    }

    return base({
      setupDetected: true,
      confidence: Math.min(1, 0.5 + 0.5 * ((snap.rsi14 - this.config.minRsi) / (this.config.maxRsi - this.config.minRsi))),
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
