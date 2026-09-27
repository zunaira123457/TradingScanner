import { Backtester } from './Backtester';
import { BacktestConfig, BacktestMetrics, BacktestUniverse } from '@/types/backtest';
import { Strategy } from '@/types/strategy';
import { coefficientOfVariation } from './Stats';

export interface SensitivityPoint {
  paramValue: number;
  metrics: BacktestMetrics;
}

export interface SensitivityResult {
  parameterName: string;
  points: SensitivityPoint[];
  totalReturnCV: number;
  profitFactorCV: number;
  /** True if performance flips from profitable to unprofitable (or vice
   * versa) somewhere across the tested parameter range. */
  signFlips: boolean;
  /**
   * Heuristic flag: !signFlips AND totalReturnCV < 0.75. This does NOT
   * pick or recommend a "best" parameter value — it only flags whether
   * results are reasonably stable across nearby values, versus fragile
   * (suspicious of overfitting to one specific number).
   */
  isRobust: boolean;
}

/**
 * Runs the same strategy across a sweep of one parameter's values and
 * reports how much the results vary. Never selects or recommends a "best"
 * value — that would itself be a form of in-sample optimization, which is
 * exactly what this analysis exists to guard against.
 */
export function runParameterSensitivity(
  backtester: Backtester,
  strategyFactory: (paramValue: number) => Strategy,
  universe: BacktestUniverse,
  config: BacktestConfig,
  startIndex: number,
  endIndex: number,
  parameterName: string,
  parameterValues: number[]
): SensitivityResult {
  const points: SensitivityPoint[] = parameterValues.map((paramValue) => ({
    paramValue,
    metrics: backtester.run(strategyFactory(paramValue), universe, config, startIndex, endIndex).metrics,
  }));

  const totalReturns = points.map((p) => p.metrics.totalReturn);
  const profitFactors = points.map((p) => p.metrics.profitFactor).filter((v) => Number.isFinite(v));

  const totalReturnCV = coefficientOfVariation(totalReturns);
  const profitFactorCV = coefficientOfVariation(profitFactors);
  const signFlips = totalReturns.some((r) => r > 0) && totalReturns.some((r) => r < 0);

  const isRobust = !signFlips && totalReturnCV < 0.75;

  return { parameterName, points, totalReturnCV, profitFactorCV, signFlips, isRobust };
}
