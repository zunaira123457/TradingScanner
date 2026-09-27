import { buildStrategyContext } from '@/strategies/StrategyContext';
import { makeUptrendCandles } from './fixtures';
import { Candle } from '@/types';

describe('buildStrategyContext', () => {
  it('should wire snapshots, structure, and multi-timeframe from the given candles', () => {
    const candles = makeUptrendCandles(260);
    const context = buildStrategyContext('TEST', candles);

    expect(context.ticker).toBe('TEST');
    expect(context.candles.length).toBe(260);
    expect(context.snapshots.length).toBe(260);
    expect(context.structure.trend).toBe('uptrend');
    expect(context.multiTimeframe.dailyTrend).toBe('bullish');
    expect(context.marketRegime).toBeNull(); // no index data supplied
    expect(context.relativeStrength).toBeNull(); // no benchmark data supplied
  });

  it('asOfIndex should slice candles BEFORE any computation happens (core no-look-ahead guarantee)', () => {
    const fullCandles = makeUptrendCandles(300);

    // Context built by slicing internally via asOfIndex...
    const viaAsOfIndex = buildStrategyContext('TEST', fullCandles, { asOfIndex: 199 });

    // ...must be byte-for-byte identical to a context built from an
    // independently truncated 200-candle array. If any Phase 2 module were
    // accidentally given the full 300-candle array, these would diverge.
    const truncated = fullCandles.slice(0, 200);
    const viaPreSliced = buildStrategyContext('TEST', truncated);

    expect(viaAsOfIndex).toEqual(viaPreSliced);
    expect(viaAsOfIndex.candles.length).toBe(200);
  });

  it('should never let a later asOfIndex change an earlier snapshot (spot check across multiple as-of dates)', () => {
    const fullCandles = makeUptrendCandles(300);

    const contextAt150 = buildStrategyContext('TEST', fullCandles, { asOfIndex: 150 });
    const contextAt250 = buildStrategyContext('TEST', fullCandles, { asOfIndex: 250 });

    // Snapshot index 100 (well within both truncated ranges) must be identical
    // regardless of how much future data exists beyond the as-of date.
    expect(contextAt250.snapshots[100]).toEqual(contextAt150.snapshots[100]);
  });

  it('should compute market regime only when index candles are supplied, and relative strength only when benchmark candles are supplied', () => {
    const candles = makeUptrendCandles(260);
    const indexCandles = new Map<string, Candle[]>([['SPY', makeUptrendCandles(260, { dailyDrift: 0.1 })]]);
    const benchmark = makeUptrendCandles(260, { dailyDrift: 0.1 });

    const withAux = buildStrategyContext('TEST', candles, {
      marketIndexCandles: indexCandles,
      benchmarkCandles: benchmark,
    });

    expect(withAux.marketRegime).not.toBeNull();
    expect(withAux.relativeStrength).not.toBeNull();
  });
});
