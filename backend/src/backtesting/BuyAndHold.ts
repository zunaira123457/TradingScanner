import { Candle } from '@/types';
import { BacktestConfig, BacktestResult, PortfolioSnapshot } from '@/types/backtest';
import { Portfolio } from './Portfolio';
import { calculateAllMetrics } from './Metrics';

/**
 * Buy-and-hold benchmark: invest (nearly) all starting capital at
 * `startIndex`'s open and hold to `endIndex`'s close. Not run through the
 * full event-driven Backtester (there is nothing event-driven about it —
 * one entry, one forced exit), but reuses the same Portfolio/Metrics
 * machinery so results are directly comparable to strategy backtests.
 *
 * Note: rMultiple on the resulting trade is not a meaningful figure for
 * buy-and-hold (there is no real stop-loss); it is left in the ledger only
 * for structural consistency with the Trade type.
 */
export function buyAndHoldBenchmark(
  candles: Candle[],
  config: BacktestConfig,
  startIndex: number,
  endIndex: number
): BacktestResult {
  const portfolio = new Portfolio(config.startingCapital);
  const entryCandle = candles[startIndex];
  const finalCandle = candles[endIndex];

  const intendedEntry = entryCandle.open;
  const slippedEntry = intendedEntry * (1 + config.slippageBps / 10000);
  const affordableShares = config.fractionalShares
    ? config.startingCapital / slippedEntry
    : Math.floor(config.startingCapital / slippedEntry);

  if (affordableShares <= 0) {
    const emptyMetrics = calculateAllMetrics([], [], config.startingCapital, entryCandle.timestamp, finalCandle.timestamp);
    return {
      strategyName: 'buy_and_hold',
      startDate: entryCandle.timestamp,
      endDate: finalCandle.timestamp,
      trades: [],
      equityCurve: [],
      metrics: emptyMetrics,
      config,
    };
  }

  portfolio.openPosition({
    ticker: '__BENCHMARK__',
    strategy: 'buy_and_hold',
    signalDate: entryCandle.timestamp,
    entryDate: entryCandle.timestamp,
    intendedEntryPrice: intendedEntry,
    shares: affordableShares,
    stopPrice: 0,
    targetPrice: Infinity,
    signalScore: 100,
    marketRegimeAtEntry: null,
    slippageBps: config.slippageBps,
    commissionBps: config.commissionBps,
  });

  const equityCurve: PortfolioSnapshot[] = [];
  for (let t = startIndex; t <= endIndex; t++) {
    const price = candles[t].close;
    const latestPrices = new Map([['__BENCHMARK__', price]]);
    equityCurve.push({
      date: candles[t].timestamp,
      cash: portfolio.cash,
      equity: portfolio.getEquity(latestPrices),
      openPositionsCount: 1,
      exposurePct: portfolio.getExposurePct(latestPrices),
    });
  }

  const trade = portfolio.closePosition(
    '__BENCHMARK__',
    finalCandle.close,
    finalCandle.timestamp,
    'end_of_data',
    config.slippageBps,
    config.commissionBps
  );

  const metrics = calculateAllMetrics([trade], equityCurve, config.startingCapital, entryCandle.timestamp, finalCandle.timestamp);

  return {
    strategyName: 'buy_and_hold',
    startDate: entryCandle.timestamp,
    endDate: finalCandle.timestamp,
    trades: [trade],
    equityCurve,
    metrics,
    config,
  };
}
