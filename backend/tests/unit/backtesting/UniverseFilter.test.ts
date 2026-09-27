import { excludeTickersFromUniverse } from '@/backtesting/UniverseFilter';
import { BacktestUniverse } from '@/types/backtest';
import { Candle } from '@/types';

function makeCandles(): Candle[] {
  return [{ timestamp: new Date(), open: 100, high: 101, low: 99, close: 100, volume: 1000000 }];
}

describe('excludeTickersFromUniverse', () => {
  it('should remove only the specified tickers from the tradeable universe', () => {
    const universe: BacktestUniverse = {
      tickers: new Map([
        ['A', makeCandles()],
        ['B', makeCandles()],
        ['C', makeCandles()],
      ]),
    };
    const filtered = excludeTickersFromUniverse(universe, ['B']);
    expect(filtered.tickers.has('A')).toBe(true);
    expect(filtered.tickers.has('B')).toBe(false);
    expect(filtered.tickers.has('C')).toBe(true);
  });

  it('should be case-insensitive', () => {
    const universe: BacktestUniverse = { tickers: new Map([['AAPL', makeCandles()]]) };
    const filtered = excludeTickersFromUniverse(universe, ['aapl']);
    expect(filtered.tickers.has('AAPL')).toBe(false);
  });

  it('should leave benchmark and index data untouched', () => {
    const benchmarkCandles = makeCandles();
    const indexCandles = new Map([['SPY', makeCandles()]]);
    const universe: BacktestUniverse = {
      tickers: new Map([['A', makeCandles()]]),
      benchmarkCandles,
      indexCandles,
    };
    const filtered = excludeTickersFromUniverse(universe, ['A']);
    expect(filtered.benchmarkCandles).toBe(benchmarkCandles);
    expect(filtered.indexCandles).toBe(indexCandles);
  });

  it('should not mutate the original universe', () => {
    const universe: BacktestUniverse = {
      tickers: new Map([
        ['A', makeCandles()],
        ['B', makeCandles()],
      ]),
    };
    excludeTickersFromUniverse(universe, ['A']);
    expect(universe.tickers.has('A')).toBe(true);
  });

  it('should return an unchanged universe when excluding a ticker not present', () => {
    const universe: BacktestUniverse = { tickers: new Map([['A', makeCandles()]]) };
    const filtered = excludeTickersFromUniverse(universe, ['ZZZZ']);
    expect(filtered.tickers.size).toBe(1);
  });
});
