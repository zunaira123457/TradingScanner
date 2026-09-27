import { Strategy, StrategyContext, StrategyResult, todayCandle } from '@/types/strategy';
import { sma } from '@/indicators/MovingAverages';
import { calculateRiskReward, targetFromRewardMultiple } from '@/strategies/RiskReward';

export interface SmaCrossoverConfig {
  fastPeriod: number;
  slowPeriod: number;
  rewardMultiple: number;
  stopPctBelowEntry: number;
}

export const DEFAULT_SMA_CROSSOVER_CONFIG: SmaCrossoverConfig = {
  fastPeriod: 50,
  slowPeriod: 200,
  rewardMultiple: 2.0,
  stopPctBelowEntry: 0.08,
};

/**
 * A simple "golden cross" benchmark strategy — buy when the fast SMA
 * crosses above the slow SMA — implemented as a proper Strategy (reusing
 * the shared sma() from Phase 2) so it runs through the same Backtester as
 * Trend Pullback / Breakout / Momentum Continuation for a true apples-to-
 * apples comparison, not a separately-computed approximation.
 *
 * This is a deliberately simple baseline, not a claim that it is good —
 * it exists purely as a reference point.
 */
export class SmaCrossoverStrategy implements Strategy {
  readonly name = 'sma_crossover';
  readonly description = `${DEFAULT_SMA_CROSSOVER_CONFIG.fastPeriod}/${DEFAULT_SMA_CROSSOVER_CONFIG.slowPeriod}-day SMA crossover benchmark.`;

  private config: SmaCrossoverConfig;

  constructor(config: Partial<SmaCrossoverConfig> = {}) {
    this.config = { ...DEFAULT_SMA_CROSSOVER_CONFIG, ...config };
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

    const closes = context.candles.map((c) => c.close);
    const n = closes.length;
    if (n < this.config.slowPeriod + 1) {
      return base({ warnings: ['Insufficient history for the slow SMA'] });
    }

    const fast = sma(closes, this.config.fastPeriod);
    const slow = sma(closes, this.config.slowPeriod);

    if (fast[n - 1] === null || slow[n - 1] === null || fast[n - 2] === null || slow[n - 2] === null) {
      return base({ warnings: ['SMA values unavailable'] });
    }

    const crossedUp = (fast[n - 2] as number) <= (slow[n - 2] as number) && (fast[n - 1] as number) > (slow[n - 1] as number);

    if (!crossedUp) {
      return base({ warnings: ['No fast/slow SMA crossover today'] });
    }

    const entry = closes[n - 1];
    const stop = entry * (1 - this.config.stopPctBelowEntry);
    const target = targetFromRewardMultiple(entry, stop, this.config.rewardMultiple);
    const { riskPerShare, rewardPerShare, riskRewardRatio } = calculateRiskReward(entry, stop, target);

    return base({
      setupDetected: true,
      confidence: 1,
      entry,
      stop,
      target,
      riskPerShare,
      rewardPerShare,
      riskRewardRatio,
      evidence: [
        `${this.config.fastPeriod}-day SMA (${(fast[n - 1] as number).toFixed(2)}) crossed above ${this.config.slowPeriod}-day SMA (${(slow[n - 1] as number).toFixed(2)})`,
      ],
      warnings: [],
    });
  }
}
