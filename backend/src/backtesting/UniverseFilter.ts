import { BacktestUniverse } from '@/types/backtest';

/**
 * Returns a new BacktestUniverse with the given tickers removed from the
 * tradeable set. Index/benchmark/sector data is left untouched — only the
 * OPPORTUNITY SET (universe.tickers) shrinks, which is what "what if this
 * stock had never been tradeable" actually means: capital that would have
 * gone to an excluded ticker is now either idle or available for a
 * different signal, exactly as it would have been in reality.
 */
export function excludeTickersFromUniverse(universe: BacktestUniverse, tickersToExclude: string[]): BacktestUniverse {
  const excludeSet = new Set(tickersToExclude.map((t) => t.toUpperCase()));
  const filteredTickers = new Map(
    [...universe.tickers].filter(([ticker]) => !excludeSet.has(ticker.toUpperCase()))
  );

  return {
    ...universe,
    tickers: filteredTickers,
  };
}
