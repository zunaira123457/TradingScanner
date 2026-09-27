import {
  IntradayStrategy,
  IntradayContext,
  latestIntradaySnapshot,
  todayIntradayCandle,
} from '@/types/intraday';
import { StrategyResult } from '@/types/strategy';
import { calculateRiskReward, targetFromRewardMultiple, atrStop } from '../RiskReward';

export interface OpeningRangeBreakoutConfig {
  minRelativeVolume: number; // minimum relative volume on the breakout bar, default 1.5
  atrStopMultiple: number; // fallback/tightening stop distance in ATRs, default 1.0
  rewardMultiple: number; // target = entry + rewardMultiple * risk, default 2.0
}

export const DEFAULT_OPENING_RANGE_BREAKOUT_CONFIG: OpeningRangeBreakoutConfig = {
  minRelativeVolume: 1.5,
  atrStopMultiple: 1.0,
  rewardMultiple: 2.0,
};

/**
 * Opening Range Breakout: once today's opening range (the first few 5-min
 * bars of the session — see buildIntradayContext) is established, a close
 * above its high on above-average volume is a breakout entry. Stop is the
 * opening range low, tightened to an ATR-based stop when that's closer to
 * entry (day trading wants the tighter of the two, not the wider one).
 *
 * This is a rule set, not a claim of profitability — it has not been
 * backtested.
 */
export class OpeningRangeBreakoutStrategy implements IntradayStrategy {
  readonly name = 'opening_range_breakout';
  readonly description =
    'Price closes above today\'s opening-range high on above-average relative volume.';

  private config: OpeningRangeBreakoutConfig;

  constructor(config: Partial<OpeningRangeBreakoutConfig> = {}) {
    this.config = { ...DEFAULT_OPENING_RANGE_BREAKOUT_CONFIG, ...config };
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

    if (context.candles.length === 0 || context.snapshots.length === 0) {
      return base({ warnings: ['Insufficient candle history'] });
    }

    if (context.openingRangeHigh === null || context.openingRangeLow === null) {
      return base({ warnings: ["Today's opening range is not yet established"] });
    }

    const snap = latestIntradaySnapshot(context);
    const today = todayIntradayCandle(context);

    const brokeOut = today.close > context.openingRangeHigh;
    const volumeOk = snap.relativeVolume !== null && snap.relativeVolume >= this.config.minRelativeVolume;

    const setupDetected = brokeOut && volumeOk;

    if (!setupDetected) {
      const warnings: string[] = [];
      if (!brokeOut) {
        warnings.push(`Price ($${today.close.toFixed(2)}) has not closed above the opening-range high ($${context.openingRangeHigh.toFixed(2)})`);
      }
      if (!volumeOk) {
        warnings.push(`Relative volume (${snap.relativeVolume?.toFixed(2) ?? 'n/a'}x) below the ${this.config.minRelativeVolume}x confirmation threshold`);
      }
      return base({ warnings });
    }

    const entry = today.close;
    const atrBasedStop = snap.atr14 !== null ? atrStop(entry, snap.atr14, this.config.atrStopMultiple) : null;
    // Prefer the tighter (higher, closer to entry) of the two candidate stops.
    const stop =
      atrBasedStop !== null && atrBasedStop > context.openingRangeLow
        ? atrBasedStop
        : context.openingRangeLow;

    if (stop >= entry) {
      return base({ warnings: ['Computed stop was not below entry — unable to construct a valid risk/reward setup'] });
    }

    const target = targetFromRewardMultiple(entry, stop, this.config.rewardMultiple);
    const { riskPerShare, rewardPerShare, riskRewardRatio } = calculateRiskReward(entry, stop, target);

    const evidence: string[] = [
      `Closed at $${entry.toFixed(2)}, above the opening-range high of $${context.openingRangeHigh.toFixed(2)}`,
      `Relative volume ${(snap.relativeVolume as number).toFixed(2)}x confirms the breakout`,
    ];

    const warnings: string[] = [];
    if (snap.rsi14 !== null && snap.rsi14 > 80) {
      warnings.push(`RSI at ${snap.rsi14.toFixed(1)} is extended for an intraday breakout — elevated risk of an immediate pullback`);
    }

    return base({
      setupDetected: true,
      confidence: Math.min(1, 0.5 + 0.5 * Math.min(1, (snap.relativeVolume as number) / (this.config.minRelativeVolume * 2))),
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
