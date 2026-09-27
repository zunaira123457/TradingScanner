import { Strategy, StrategyContext, StrategyResult, latestSnapshot, todayCandle } from '@/types/strategy';
import { detectPullbackToEma21, detectPullbackToSma50 } from '@/patterns/ChartPatterns';
import { calculateRiskReward, targetFromRewardMultiple, atrStop } from './RiskReward';

export interface TrendPullbackConfig {
  rewardMultiple: number; // target = entry + rewardMultiple * risk, default 2.0
  swingLowAtrBuffer: number; // buffer below the last swing low, in ATRs, default 0.5
  fallbackAtrStopMultiple: number; // stop distance in ATRs when no usable swing low exists, default 2.0
  fallbackPercentStop: number; // stop distance as % of entry when ATR is unavailable, default 0.05
  maxRsiForEntry: number; // RSI must be below this to avoid chasing an overbought pullback, default 70
  maxDistancePct: number; // how close price must be to EMA21/SMA50 to count as "at" it, default 0.02
}

export const DEFAULT_TREND_PULLBACK_CONFIG: TrendPullbackConfig = {
  rewardMultiple: 2.0,
  swingLowAtrBuffer: 0.5,
  fallbackAtrStopMultiple: 2.0,
  fallbackPercentStop: 0.05,
  maxRsiForEntry: 70,
  maxDistancePct: 0.02,
};

/**
 * Trend Pullback: a stock in an established uptrend (SMA50 > SMA200, price
 * above SMA50, and swing structure confirming higher-highs/higher-lows via
 * the shared PriceStructure module) has pulled back to a moving-average
 * support level (EMA21 preferred, SMA50 as fallback — both detected via the
 * shared ChartPatterns module) without RSI being overbought.
 *
 * This is a rule set, not a claim of profitability — it has not been
 * backtested. Historical performance validation is Phase 4's job.
 */
export class TrendPullbackStrategy implements Strategy {
  readonly name = 'trend_pullback';
  readonly description =
    'Price above 50 SMA, 50 SMA above 200 SMA, confirmed uptrend structure, and a pullback to EMA21 or SMA50 with RSI not overbought.';

  private config: TrendPullbackConfig;

  constructor(config: Partial<TrendPullbackConfig> = {}) {
    this.config = { ...DEFAULT_TREND_PULLBACK_CONFIG, ...config };
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

    if (context.candles.length === 0 || context.snapshots.length === 0) {
      return base({ warnings: ['No candle data available'] });
    }

    const snap = latestSnapshot(context);
    const today = todayCandle(context);

    if (snap.sma50 === null || snap.sma200 === null) {
      return base({ warnings: ['Insufficient history for SMA50/SMA200 (need 200+ trading days)'] });
    }

    const smaAligned = today.close > snap.sma50 && snap.sma50 > snap.sma200;

    const pullbackEma21 = detectPullbackToEma21(context.candles, snap.ema21, context.structure, {
      maxDistancePct: this.config.maxDistancePct,
    });
    const pullbackSma50 = detectPullbackToSma50(context.candles, snap.sma50, context.structure, {
      maxDistancePct: this.config.maxDistancePct,
    });

    const rsiOk = snap.rsi14 === null || snap.rsi14 < this.config.maxRsiForEntry;

    const pullback = pullbackEma21.detected ? pullbackEma21 : pullbackSma50;
    const pullbackDetected = pullbackEma21.detected || pullbackSma50.detected;

    const setupDetected = smaAligned && pullbackDetected && rsiOk;

    if (!setupDetected) {
      const warnings: string[] = [];
      if (!smaAligned) warnings.push('Moving averages not in bullish alignment (close > SMA50 > SMA200)');
      if (!pullbackDetected) warnings.push('No pullback to EMA21 or SMA50 currently in progress');
      if (!rsiOk) warnings.push(`RSI at ${snap.rsi14?.toFixed(1)} is at or above the overbought threshold (${this.config.maxRsiForEntry})`);
      return base({ warnings, supportingPatterns: [pullbackEma21, pullbackSma50] });
    }

    const entry = today.close;

    let stop: number;
    const lastSwingLow = context.structure.lastSwingLow;
    const hasUsableSwingLow = lastSwingLow !== null && lastSwingLow.price < entry;

    if (snap.atr14 !== null) {
      stop = hasUsableSwingLow
        ? (lastSwingLow as { price: number }).price - this.config.swingLowAtrBuffer * snap.atr14
        : atrStop(entry, snap.atr14, this.config.fallbackAtrStopMultiple);
    } else {
      stop = hasUsableSwingLow
        ? (lastSwingLow as { price: number }).price * (1 - 0.01)
        : entry * (1 - this.config.fallbackPercentStop);
    }

    if (stop >= entry) {
      return base({
        warnings: ['Computed stop was not below entry — unable to construct a valid risk/reward setup'],
        supportingPatterns: [pullbackEma21, pullbackSma50],
      });
    }

    const target = targetFromRewardMultiple(entry, stop, this.config.rewardMultiple);
    const { riskPerShare, rewardPerShare, riskRewardRatio } = calculateRiskReward(entry, stop, target);

    const evidence: string[] = [
      `Price ($${entry.toFixed(2)}) above 50 SMA ($${snap.sma50.toFixed(2)})`,
      `50 SMA ($${snap.sma50.toFixed(2)}) above 200 SMA ($${snap.sma200.toFixed(2)}) — bullish moving-average alignment`,
      `Pullback to ${pullback.pattern === 'pullback_to_ema21' ? 'EMA21' : 'SMA50'} within ${((pullback.details.distancePct as number) * 100).toFixed(2)}%`,
      snap.rsi14 !== null ? `RSI at ${snap.rsi14.toFixed(1)} — not overbought` : 'RSI unavailable',
    ];

    const warnings: string[] = [];
    if (snap.relativeVolume !== null && snap.relativeVolume < 0.7) {
      warnings.push(`Below-average volume on the pullback (${snap.relativeVolume.toFixed(2)}x average)`);
    }
    if (snap.rsi14 !== null && snap.rsi14 > this.config.maxRsiForEntry - 10) {
      warnings.push(`RSI at ${snap.rsi14.toFixed(1)} is approaching the overbought threshold`);
    }

    return base({
      setupDetected: true,
      confidence: pullback.confidence,
      entry,
      stop,
      target,
      riskPerShare,
      rewardPerShare,
      riskRewardRatio,
      evidence,
      warnings,
      supportingPatterns: [pullbackEma21, pullbackSma50],
    });
  }
}
