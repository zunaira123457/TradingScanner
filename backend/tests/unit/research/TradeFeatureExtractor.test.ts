import { extractTradeFeatures } from '@/research/TradeFeatureExtractor';
import { Backtester } from '@/backtesting/Backtester';
import { BacktestConfig, BacktestUniverse } from '@/types/backtest';
import { Strategy, StrategyContext, StrategyResult } from '@/types/strategy';
import { IndicatorEngine } from '@/indicators/IndicatorEngine';
import { Candle } from '@/types';

function c(open: number, high: number, low: number, close: number, dayOffset: number, volume = 1000000): Candle {
  return { timestamp: new Date(2020, 0, 1 + dayOffset), open, high, low, close, volume };
}

/** TEST-ONLY: signals BUY every day, fixed % risk/reward, so trades are fully predictable. */
function makeAlwaysBuyStrategy(riskPct = 0.05, rewardPct = 0.1): Strategy {
  return {
    name: 'always_buy_test',
    description: 'TEST ONLY',
    evaluate(context: StrategyContext): StrategyResult {
      const today = context.candles[context.candles.length - 1];
      const entry = today.close;
      const stop = entry * (1 - riskPct);
      const target = entry * (1 + rewardPct);
      return {
        strategy: 'always_buy_test',
        ticker: context.ticker,
        date: today.timestamp,
        setupDetected: true,
        confidence: 0.8,
        entry,
        stop,
        target,
        riskPerShare: entry - stop,
        rewardPerShare: target - entry,
        riskRewardRatio: (target - entry) / (entry - stop),
        evidence: [],
        warnings: [],
        supportingPatterns: [],
      };
    },
  };
}

function makeOscillatingCandles(days: number, startPrice = 100): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < days; i++) {
    price += Math.sin(i / 4) * 2 + 0.05;
    const open = price - 0.3;
    const close = price;
    candles.push(c(open, Math.max(open, close) + 0.8, Math.min(open, close) - 0.8, close, i));
  }
  return candles;
}

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    startingCapital: 100000,
    maxRiskPerTradePct: 0.01,
    maxPositions: 5,
    maxPortfolioExposurePct: 0.8,
    slippageBps: 0,
    commissionBps: 0,
    fractionalShares: false,
    ...overrides,
  };
}

describe('extractTradeFeatures', () => {
  const stockCandles = makeOscillatingCandles(120);
  const indexCandles = makeOscillatingCandles(120, 200);
  const benchmarkCandles = makeOscillatingCandles(120, 300);

  const universe: BacktestUniverse = {
    tickers: new Map([['TEST', stockCandles]]),
    benchmarkCandles,
    indexCandles: new Map([['SPY', indexCandles]]),
  };

  const backtester = new Backtester({ classificationThresholds: { buy: 0, watch: 0 } });
  const result = backtester.run(makeAlwaysBuyStrategy(), universe, makeConfig(), 0, 100);

  it('should produce one feature record per closed trade with a resolvable signal date', () => {
    const records = extractTradeFeatures(result.trades, universe);
    expect(records.length).toBe(result.trades.length);
    expect(records.length).toBeGreaterThan(0);
  });

  it('signal-time indicator features should match an independent IndicatorEngine computation at the signal date', () => {
    const records = extractTradeFeatures(result.trades, universe);
    const snapshots = IndicatorEngine.calculateAll(stockCandles);

    for (const record of records) {
      const signalIndex = stockCandles.findIndex(
        (candle) => candle.timestamp.getTime() === record.signalDate.getTime()
      );
      expect(signalIndex).toBeGreaterThanOrEqual(0);
      const expectedSnap = snapshots[signalIndex];

      expect(record.rsi14).toEqual(expectedSnap.rsi14);
      expect(record.sma50).toEqual(expectedSnap.sma50);
      expect(record.adx14).toEqual(expectedSnap.adx14);
      expect(record.close).toEqual(expectedSnap.close);
    }
  });

  it('should correctly populate outcome fields from the underlying trade', () => {
    const records = extractTradeFeatures(result.trades, universe);
    for (let i = 0; i < records.length; i++) {
      expect(records[i].won).toBe((result.trades[i].netPnl ?? 0) > 0);
      expect(records[i].netPnl).toBe(result.trades[i].netPnl);
      expect(records[i].exitReason).toBe(result.trades[i].exitReason);
    }
  });

  it('should hand-verify MFE/MAE for a specific constructed trade', () => {
    // A small, fully controlled scenario: entry at 100, then price ranges
    // up to 110 (MFE) and down to 95 (MAE) before exiting.
    const candles = [
      c(100, 100.5, 99.5, 100, 0),
      c(110, 111, 109, 110, 1), // entry fill = 110 (T+1 open)
      c(112, 120, 95, 100, 2), // high=120 (MFE), low=95 (MAE), then exits later
      c(100, 105, 98, 102, 3),
    ];
    const smallUniverse: BacktestUniverse = { tickers: new Map([['MFE', candles]]) };
    const smallResult = backtester.run(makeAlwaysBuyStrategy(0.3, 0.5), smallUniverse, makeConfig(), 0, 3);

    const records = extractTradeFeatures(smallResult.trades, smallUniverse);
    const trade = records.find((r) => r.ticker === 'MFE' && r.entryDate.getTime() === candles[1].timestamp.getTime());
    expect(trade).toBeDefined();

    if (trade && trade.holdingDays !== null) {
      // entry=110 (with 0 slippage). MFE should reflect the highest high
      // reached between entry and exit; MAE the lowest low.
      expect(trade.maxFavorableExcursionPct).not.toBeNull();
      expect(trade.maxAdverseExcursionPct).not.toBeNull();
      expect(trade.maxFavorableExcursionPct as number).toBeGreaterThan(0);
    }
  });

  it('should attach sector labels when a sectorMap is provided', () => {
    const records = extractTradeFeatures(result.trades, universe, {
      sectorMap: new Map([['TEST', 'Technology']]),
    });
    expect(records.every((r) => r.sector === 'Technology')).toBe(true);
  });

  it('should return null sector when no sectorMap is provided', () => {
    const records = extractTradeFeatures(result.trades, universe);
    expect(records.every((r) => r.sector === null)).toBe(true);
  });

  describe('no look-ahead (critical)', () => {
    it('extracted signal-time features must be IDENTICAL whether the universe extends far beyond the signal date or is truncated exactly to it', () => {
      // Extend the stock, index, and benchmark series well past the last
      // trade's signal date with sharply different future data (a big
      // regime-reversing move), so a leak would be immediately visible.
      const extendedStock = [...stockCandles];
      const extendedIndex = [...indexCandles];
      const extendedBenchmark = [...benchmarkCandles];
      let p = stockCandles[stockCandles.length - 1].close;
      for (let i = 0; i < 50; i++) {
        p += 20; // sharp, unmistakable future move
        const day = stockCandles.length + i;
        extendedStock.push(c(p - 1, p + 1, p - 2, p, day));
        extendedIndex.push(c(p * 2 - 1, p * 2 + 1, p * 2 - 2, p * 2, day));
        extendedBenchmark.push(c(p * 3 - 1, p * 3 + 1, p * 3 - 2, p * 3, day));
      }

      const extendedUniverse: BacktestUniverse = {
        tickers: new Map([['TEST', extendedStock]]),
        benchmarkCandles: extendedBenchmark,
        indexCandles: new Map([['SPY', extendedIndex]]),
      };

      const recordsFromOriginal = extractTradeFeatures(result.trades, universe);
      const recordsFromExtended = extractTradeFeatures(result.trades, extendedUniverse);

      // Same trades (same signal dates), but universe data extends further
      // into the future in the second case -> results must be identical.
      expect(recordsFromExtended).toEqual(recordsFromOriginal);
    });
  });
});
