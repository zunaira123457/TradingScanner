import { Strategy, StrategyContext, StrategyResult, latestSnapshot, todayCandle } from '@/types/strategy';
import { detectConsolidation } from '@/patterns/PriceStructure';
import { detectBreakoutFromConsolidation } from '@/patterns/ChartPatterns';
import { calculateRiskReward, targetFromRewardMultiple } from './RiskReward';

export interface BreakoutConfig {
  consolidationLookback: number; // bars used to establish the base before today, default 15
  maxRangePct: number; // consolidation tightness threshold, default 0.08
  breakoutLookback: number; // bars used to establish resistance, default 20
  volumeMultiplier: number; // required relative volume for confirmation, default 1.5
  fallbackRewardMultiple: number; // used when a measured-move target can't be computed, default 2.0
}

export const DEFAULT_BREAKOUT_CONFIG: BreakoutConfig = {
  consolidationLookback: 15,
  maxRangePct: 0.08,
  breakoutLookback: 20,
  volumeMultiplier: 1.5,
  fallbackRewardMultiple: 2.0,
};

/**
 * Breakout: a tight consolidation range (detected via the shared
 * PriceStructure/ChartPatterns modules) is broken to the upside on
 * volume at or above `volumeMultiplier`x average.
 *
 * Stop reuses the invalidation price computed by detectBreakoutFromConsolidation
 * (resistance with a buffer) rather than recalculating it. Target uses a
 * "measured move": the height of the consolidation range projected up from
 * the breakout point — a standard, objective technical target, not an
 * arbitrary number. Falls back to a fixed reward multiple only when the
 * range height can't be measured.
 *
 * This is a rule set, not a claim of profitability — it has not been
 * backtested. Historical performance validation is Phase 4's job.
 */
export class BreakoutStrategy implements Strategy {
  readonly name = 'breakout';
  readonly description =
    'A tight prior consolidation breaks above its resistance level with relative volume confirmation.';

  private config: BreakoutConfig;

  constructor(config: Partial<BreakoutConfig> = {}) {
    this.config = { ...DEFAULT_BREAKOUT_CONFIG, ...config };
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

    if (context.candles.length < 2 || context.snapshots.length === 0) {
      return base({ warnings: ['Insufficient candle history'] });
    }

    const snap = latestSnapshot(context);

    const pattern = detectBreakoutFromConsolidation(context.candles, snap.relativeVolume, {
      consolidationLookback: this.config.consolidationLookback,
      maxRangePct: this.config.maxRangePct,
      breakoutLookback: this.config.breakoutLookback,
      volumeMultiplier: this.config.volumeMultiplier,
    });

    if (!pattern.detected) {
      const warnings: string[] = [];
      if (!pattern.details.volumeConfirmation) {
        warnings.push(
          `Relative volume ${snap.relativeVolume !== null ? snap.relativeVolume.toFixed(2) + 'x' : 'unavailable'} below the ${this.config.volumeMultiplier}x confirmation threshold`
        );
      }
      warnings.push('No confirmed breakout from a prior consolidation range');
      return base({ warnings, supportingPatterns: [pattern] });
    }

    const entry = pattern.details.breakoutPrice as number;
    const stop = pattern.invalidationPrice as number;

    // Measured-move target: project the consolidation range height up from the breakout.
    const priorCandles = context.candles.slice(0, context.candles.length - 1);
    const consolidation = detectConsolidation(priorCandles, {
      lookbackDays: this.config.consolidationLookback,
      maxRangePct: this.config.maxRangePct,
    });

    const resistance = pattern.details.resistance as number;
    let target: number;
    let targetMethod: string;
    if (consolidation.rangeLow !== null && resistance - consolidation.rangeLow > 0) {
      target = entry + (resistance - consolidation.rangeLow);
      targetMethod = 'measured move (consolidation range height projected from breakout)';
    } else {
      target = targetFromRewardMultiple(entry, stop, this.config.fallbackRewardMultiple);
      targetMethod = `${this.config.fallbackRewardMultiple}x reward/risk fallback (range height unavailable)`;
    }

    const { riskPerShare, rewardPerShare, riskRewardRatio } = calculateRiskReward(entry, stop, target);

    const evidence: string[] = [
      `Breakout above ${this.config.breakoutLookback}-day resistance at $${resistance.toFixed(2)}`,
      `Relative volume ${(snap.relativeVolume as number).toFixed(2)}x average confirms the breakout`,
      consolidation.rangePct !== null
        ? `Prior consolidation range was ${(consolidation.rangePct * 100).toFixed(1)}% (tight base)`
        : 'Prior consolidation detected',
      `Target set via ${targetMethod}`,
    ];

    const warnings: string[] = [];
    if (snap.historicalVolatility20 !== null && snap.historicalVolatility20 > 0.5) {
      warnings.push(`Elevated historical volatility (${(snap.historicalVolatility20 * 100).toFixed(0)}% annualized) widens realistic price swings around the stop`);
    }
    if (riskRewardRatio !== null && riskRewardRatio < 1.5) {
      warnings.push(`Risk/reward ratio (${riskRewardRatio.toFixed(2)}) is below the commonly-used 1.5 minimum`);
    }

    return base({
      setupDetected: true,
      confidence: pattern.confidence,
      entry,
      stop,
      target,
      riskPerShare,
      rewardPerShare,
      riskRewardRatio,
      evidence,
      warnings,
      supportingPatterns: [pattern],
    });
  }
}
