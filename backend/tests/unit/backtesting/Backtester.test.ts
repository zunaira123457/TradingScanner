import { Backtester } from '@/backtesting/Backtester';
import { BacktestConfig, BacktestUniverse } from '@/types/backtest';
import { Strategy, StrategyContext, StrategyResult } from '@/types/strategy';
import { Candle } from '@/types';

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    startingCapital: 10000,
    maxRiskPerTradePct: 0.01,
    maxPositions: 5,
    maxPortfolioExposurePct: 0.8,
    slippageBps: 0,
    commissionBps: 0,
    fractionalShares: false,
    ...overrides,
  };
}

/** TEST-ONLY strategy: always signals BUY using today's close, with a fixed % risk/reward. */
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
        confidence: 1,
        entry,
        stop,
        target,
        riskPerShare: entry - stop,
        rewardPerShare: target - entry,
        riskRewardRatio: (target - entry) / (entry - stop),
        evidence: ['Always buy (test strategy)'],
        warnings: [],
        supportingPatterns: [],
      };
    },
  };
}

function c(open: number, high: number, low: number, close: number, dayOffset: number): Candle {
  return { timestamp: new Date(2020, 0, 1 + dayOffset), open, high, low, close, volume: 1000000 };
}

function makeFlatCandles(days: number, price = 100): Candle[] {
  return Array.from({ length: days }, (_, i) => c(price, price + 0.5, price - 0.5, price, i));
}

describe('Backtester', () => {
  const backtester = new Backtester({ classificationThresholds: { buy: 0, watch: 0 } }); // always take detected setups

  describe('entry execution timing', () => {
    it('should execute the entry at the NEXT day open, not the signal day close', () => {
      const candles = [
        c(100, 100.5, 99.5, 100, 0), // signal day: close=100
        c(110, 115, 105, 112, 1), // execution day: open=110
        c(112, 114, 111, 113, 2),
      ];
      const universe: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };

      const result = backtester.run(makeAlwaysBuyStrategy(0.05, 0.1), universe, makeConfig(), 0, 2);

      expect(result.trades.length).toBeGreaterThan(0);
      const firstTrade = result.trades.find((t) => t.entryDate.getTime() === candles[1].timestamp.getTime());
      expect(firstTrade).toBeDefined();
      expect(firstTrade!.entryPrice).toBeCloseTo(110, 8); // day 1's OPEN, not day 0's close of 100
    });
  });

  describe('stop-loss and take-profit execution (hand-verified end-to-end)', () => {
    it('should exit at the stop price and record correct P&L/R-multiple', () => {
      const candles = [
        c(100, 100.5, 99.5, 100, 0), // signal: entry=100, stop=95, target=110 (riskDist=5, rewardDist=10)
        c(110, 111, 109, 110, 1), // execution: fill=110 -> stop=105, target=120
        c(112, 113, 90, 91, 2), // stop hit: low=90 <= 105
      ];
      const universe: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };

      const result = backtester.run(makeAlwaysBuyStrategy(0.05, 0.1), universe, makeConfig(), 0, 2);

      const trade = result.trades.find((t) => t.exitReason === 'stop');
      expect(trade).toBeDefined();
      expect(trade!.entryPrice).toBeCloseTo(110, 8);
      expect(trade!.stopPrice).toBeCloseTo(105, 8);
      expect(trade!.exitPrice).toBeCloseTo(105, 8);
      expect(trade!.shares).toBe(20); // riskDollars=100 (1% of 10000), riskPerShare=5 -> 20 shares
      expect(trade!.netPnl).toBeCloseTo((105 - 110) * 20, 8); // -100
      expect(trade!.rMultiple).toBeCloseTo(-1.0, 8);
    });

    it('should exit at the target price and record correct P&L/R-multiple', () => {
      const candles = [
        c(100, 100.5, 99.5, 100, 0),
        c(110, 111, 109, 110, 1), // fill=110 -> stop=105, target=120
        c(112, 125, 108, 120, 2), // target hit: high=125 >= 120, low=108 > 105 (target only)
      ];
      const universe: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };

      const result = backtester.run(makeAlwaysBuyStrategy(0.05, 0.1), universe, makeConfig(), 0, 2);

      const trade = result.trades.find((t) => t.exitReason === 'target');
      expect(trade).toBeDefined();
      expect(trade!.exitPrice).toBeCloseTo(120, 8);
      expect(trade!.shares).toBe(20);
      expect(trade!.netPnl).toBeCloseTo((120 - 110) * 20, 8); // +200
      expect(trade!.rMultiple).toBeCloseTo(2.0, 8);
    });
  });

  describe('slippage and commissions', () => {
    it('should reduce net P&L relative to a zero-cost run', () => {
      const candles = [
        c(100, 100.5, 99.5, 100, 0),
        c(110, 111, 109, 110, 1),
        c(112, 125, 108, 120, 2),
      ];
      const universe: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };

      const zeroCost = backtester.run(makeAlwaysBuyStrategy(0.05, 0.1), universe, makeConfig(), 0, 2);
      const withCosts = backtester.run(
        makeAlwaysBuyStrategy(0.05, 0.1),
        universe,
        makeConfig({ slippageBps: 50, commissionBps: 10 }),
        0,
        2
      );

      const zeroCostTrade = zeroCost.trades.find((t) => t.exitReason === 'target')!;
      const withCostsTrade = withCosts.trades.find((t) => t.exitReason === 'target')!;

      expect(withCostsTrade.netPnl as number).toBeLessThan(zeroCostTrade.netPnl as number);
      expect(withCostsTrade.fees).toBeGreaterThan(0);
      expect(withCostsTrade.slippageCost).toBeGreaterThan(0);
    });
  });

  describe('position sizing', () => {
    it('should scale share count with maxRiskPerTradePct', () => {
      const candles = [c(100, 100.5, 99.5, 100, 0), c(110, 111, 109, 110, 1), c(112, 113, 111, 112, 2)];
      const universe: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };

      const at1pct = backtester.run(makeAlwaysBuyStrategy(0.05, 0.1), universe, makeConfig({ maxRiskPerTradePct: 0.01 }), 0, 2);
      const at2pct = backtester.run(makeAlwaysBuyStrategy(0.05, 0.1), universe, makeConfig({ maxRiskPerTradePct: 0.02 }), 0, 2);

      const shares1 = at1pct.trades[0].shares;
      const shares2 = at2pct.trades[0].shares;
      expect(shares2).toBeCloseTo(shares1 * 2, 0);
    });
  });

  describe('multiple simultaneous positions', () => {
    it('should open positions in multiple tickers concurrently', () => {
      const candlesA = makeFlatCandles(10, 100);
      const candlesB = makeFlatCandles(10, 200);
      const universe: BacktestUniverse = {
        tickers: new Map([
          ['A', candlesA],
          ['B', candlesB],
        ]),
      };

      const result = backtester.run(makeAlwaysBuyStrategy(0.2, 0.4), universe, makeConfig({ maxPositions: 5 }), 0, 9);

      const tickersTraded = new Set(result.trades.map((t) => t.ticker));
      expect(tickersTraded.has('A')).toBe(true);
      expect(tickersTraded.has('B')).toBe(true);
    });

    it('should respect maxPositions and refuse a second entry when the cap is reached', () => {
      // Flat data with wide stop/target so neither ticker's position ever
      // closes within the test window -> A holds the only slot the whole time.
      const candlesA = makeFlatCandles(10, 100);
      const candlesB = makeFlatCandles(10, 200);
      const universe: BacktestUniverse = {
        tickers: new Map([
          ['A', candlesA],
          ['B', candlesB],
        ]),
      };

      const result = backtester.run(makeAlwaysBuyStrategy(0.9, 0.9), universe, makeConfig({ maxPositions: 1 }), 0, 9);

      const bTrades = result.trades.filter((t) => t.ticker === 'B');
      expect(bTrades.length).toBe(0);
    });
  });

  describe('sector exposure limit (end-to-end through the full engine)', () => {
    it('should refuse a same-sector entry once maxSectorExposurePct would be exceeded', () => {
      // riskPct=0.5 -> stop = 50% below entry -> riskPerShare = $50.
      // maxRiskPerTradePct=0.1 on $10,000 equity -> riskDollars=$1000 ->
      // 20 shares -> ~$2,000 (20% of equity) per position. Two such
      // positions (40%) exceed the 30% sector cap, so a third same-sector
      // entry must be blocked.
      const candlesA = makeFlatCandles(10, 100);
      const candlesB = makeFlatCandles(10, 100);
      const candlesC = makeFlatCandles(10, 100);
      const universe: BacktestUniverse = {
        tickers: new Map([
          ['A', candlesA],
          ['B', candlesB],
          ['C', candlesC],
        ]),
      };
      const sectorMap = new Map([
        ['A', 'Technology'],
        ['B', 'Technology'],
        ['C', 'Technology'],
      ]);

      const result = backtester.run(
        makeAlwaysBuyStrategy(0.5, 0.9),
        universe,
        makeConfig({
          maxRiskPerTradePct: 0.1,
          maxPositions: 5,
          maxPortfolioExposurePct: 1.0,
          sectorMap,
          maxSectorExposurePct: 0.3,
        }),
        0,
        9
      );

      const tickersTraded = new Set(result.trades.map((t) => t.ticker));
      expect(tickersTraded.size).toBeLessThan(3);
    });

    it('should allow entries across DIFFERENT sectors even when one sector is already at its cap', () => {
      const candlesA = makeFlatCandles(10, 100);
      const candlesB = makeFlatCandles(10, 100);
      const universe: BacktestUniverse = {
        tickers: new Map([
          ['A', candlesA],
          ['B', candlesB],
        ]),
      };
      const sectorMap = new Map([
        ['A', 'Technology'],
        ['B', 'Energy'],
      ]);

      const result = backtester.run(
        makeAlwaysBuyStrategy(0.5, 0.9),
        universe,
        makeConfig({
          maxRiskPerTradePct: 0.1,
          maxPositions: 5,
          maxPortfolioExposurePct: 1.0,
          sectorMap,
          maxSectorExposurePct: 0.3,
        }),
        0,
        9
      );

      const tickersTraded = new Set(result.trades.map((t) => t.ticker));
      expect(tickersTraded.has('A')).toBe(true);
      expect(tickersTraded.has('B')).toBe(true);
    });
  });

  describe('cash constraint', () => {
    it('should refuse to open a position that would exceed available cash', () => {
      const candles = [c(100, 100.5, 99.5, 100, 0), c(110, 111, 109, 110, 1), c(112, 113, 111, 112, 2)];
      const universe: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };

      // 50% risk per trade against $1000 capital and $110 entry -> way more
      // shares than $1000 can actually buy.
      const result = backtester.run(
        makeAlwaysBuyStrategy(0.05, 0.1),
        universe,
        makeConfig({ startingCapital: 1000, maxRiskPerTradePct: 0.5 }),
        0,
        2
      );

      expect(result.trades.length).toBe(0);
    });
  });

  describe('end-of-data forced close', () => {
    it('should force-close any still-open position at the final candle, tagged end_of_data', () => {
      const candles = makeFlatCandles(10, 100); // flat -> never hits a 5%/10% stop or target
      const universe: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };

      const result = backtester.run(makeAlwaysBuyStrategy(0.05, 0.1), universe, makeConfig(), 0, 9);

      const openEnded = result.trades.find((t) => t.exitReason === 'end_of_data');
      expect(openEnded).toBeDefined();
      expect(openEnded!.exitPrice).toBeCloseTo(candles[9].close, 8);
      expect(openEnded!.status).toBe('closed');
    });
  });

  describe('point-in-time equivalence (no look-ahead through the full engine)', () => {
    it('should produce identical trades/metrics whether the universe array extends beyond endIndex or is truncated exactly to it', () => {
      // Deterministic pseudo-random walk so there's real variance to detect a leak.
      const candles: Candle[] = [];
      let price = 100;
      for (let i = 0; i < 60; i++) {
        price += Math.sin(i / 3) * 2;
        const open = price - 0.3;
        const close = price;
        candles.push(c(open, Math.max(open, close) + 0.8, Math.min(open, close) - 0.8, close, i));
      }
      const universeFull: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };
      const universeTruncated: BacktestUniverse = { tickers: new Map([['TEST', candles.slice(0, 31)]]) };

      const config = makeConfig();
      const resultFull = backtester.run(makeAlwaysBuyStrategy(0.05, 0.1), universeFull, config, 0, 30);
      const resultTruncated = backtester.run(makeAlwaysBuyStrategy(0.05, 0.1), universeTruncated, config, 0, 30);

      expect(resultFull.trades).toEqual(resultTruncated.trades);
      expect(resultFull.equityCurve).toEqual(resultTruncated.equityCurve);
      expect(resultFull.metrics).toEqual(resultTruncated.metrics);
    });
  });

  describe('trade ledger completeness', () => {
    it('should populate every required trade-ledger field', () => {
      const candles = [
        c(100, 100.5, 99.5, 100, 0),
        c(110, 111, 109, 110, 1),
        c(112, 125, 108, 120, 2),
      ];
      const universe: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };
      const result = backtester.run(makeAlwaysBuyStrategy(0.05, 0.1), universe, makeConfig(), 0, 2);

      const trade = result.trades[0];
      expect(trade.id).toBeTruthy();
      expect(trade.ticker).toBe('TEST');
      expect(trade.strategy).toBe('always_buy_test');
      expect(trade.signalDate).toBeInstanceOf(Date);
      expect(trade.entryDate).toBeInstanceOf(Date);
      expect(typeof trade.entryPrice).toBe('number');
      expect(typeof trade.shares).toBe('number');
      expect(typeof trade.stopPrice).toBe('number');
      expect(typeof trade.targetPrice).toBe('number');
      expect(trade.exitDate).toBeInstanceOf(Date);
      expect(typeof trade.exitPrice).toBe('number');
      expect(trade.exitReason).not.toBeNull();
      expect(typeof trade.grossPnl).toBe('number');
      expect(typeof trade.fees).toBe('number');
      expect(typeof trade.slippageCost).toBe('number');
      expect(typeof trade.netPnl).toBe('number');
      expect(typeof trade.rMultiple).toBe('number');
      expect(typeof trade.signalScore).toBe('number');
      expect(trade.status).toBe('closed');
    });
  });
});
