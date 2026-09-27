import { Backtester } from './Backtester';
import { BacktestConfig, BacktestResult, BacktestUniverse } from '@/types/backtest';
import { Strategy } from '@/types/strategy';
import { mean, stdDev, coefficientOfVariation } from './Stats';

export interface WalkForwardWindow {
  index: number;
  testStart: number;
  testEnd: number;
}

export interface WalkForwardConfig {
  windowDays: number; // size of each out-of-sample test window
  stepDays: number; // how far to roll forward between windows
  minHistoryDays: number; // history required before the first window can start (e.g. 252 for SMA200 warm-up)
}

export function generateWalkForwardWindows(totalDays: number, config: WalkForwardConfig): WalkForwardWindow[] {
  const windows: WalkForwardWindow[] = [];
  let testStart = config.minHistoryDays;
  let index = 0;

  while (testStart + config.windowDays - 1 < totalDays) {
    const testEnd = testStart + config.windowDays - 1;
    windows.push({ index, testStart, testEnd });
    testStart += config.stepDays;
    index++;
  }

  return windows;
}

export interface WalkForwardWindowResult {
  window: WalkForwardWindow;
  result: BacktestResult;
}

export interface WalkForwardConsistency {
  winRateMean: number;
  winRateStdDev: number;
  winRateCV: number;
  profitFactorMean: number;
  profitFactorStdDev: number;
  profitFactorCV: number;
  /** Heuristic flag: winRateCV < 0.5 AND profitFactorCV < 0.75. Documented,
   * not a claim of statistical significance — with few windows this is a
   * coarse signal, not a rigorous test. */
  isConsistent: boolean;
}

export interface WalkForwardResult {
  windows: WalkForwardWindowResult[];
  consistency: WalkForwardConsistency;
}

/**
 * Runs the SAME fixed-rule strategy independently across sequential,
 * non-overlapping (by default) out-of-sample windows and reports whether
 * performance is consistent window-to-window.
 *
 * IMPORTANT: because the Phase 3 strategies have fixed, hand-coded
 * thresholds rather than parameters fit to data, this is walk-forward
 * VALIDATION, not walk-forward OPTIMIZATION — there is no training step
 * that tunes anything against a training window. What this measures is
 * simply: does a strategy that was never fit to any particular period
 * perform similarly across different out-of-sample periods, or does it
 * only "work" in one specific stretch of history (a sign of a spurious or
 * regime-dependent edge rather than a robust one)?
 */
export function runWalkForward(
  backtester: Backtester,
  strategy: Strategy,
  universe: BacktestUniverse,
  config: BacktestConfig,
  wfConfig: WalkForwardConfig
): WalkForwardResult {
  const firstSeries = universe.tickers.values().next().value;
  const totalDays = firstSeries ? firstSeries.length : 0;

  const windows = generateWalkForwardWindows(totalDays, wfConfig);
  const windowResults: WalkForwardWindowResult[] = windows.map((window) => ({
    window,
    result: backtester.run(strategy, universe, config, window.testStart, window.testEnd),
  }));

  const winRates = windowResults.map((w) => w.result.metrics.winRate);
  const profitFactors = windowResults
    .map((w) => w.result.metrics.profitFactor)
    .filter((v) => Number.isFinite(v));

  const winRateMean = mean(winRates);
  const winRateStdDev = stdDev(winRates);
  const winRateCV = coefficientOfVariation(winRates);
  const profitFactorMean = mean(profitFactors);
  const profitFactorStdDev = stdDev(profitFactors);
  const profitFactorCV = coefficientOfVariation(profitFactors);

  const isConsistent = winRateCV < 0.5 && profitFactorCV < 0.75;

  return {
    windows: windowResults,
    consistency: {
      winRateMean,
      winRateStdDev,
      winRateCV,
      profitFactorMean,
      profitFactorStdDev,
      profitFactorCV,
      isConsistent,
    },
  };
}
