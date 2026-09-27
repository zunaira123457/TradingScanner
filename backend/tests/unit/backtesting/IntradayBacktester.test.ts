import { IntradayBacktester, IntradayBacktestConfig } from '@/backtesting/IntradayBacktester';
import { BacktestConfig } from '@/types/backtest';
import { IntradayStrategy, IntradayContext } from '@/types/intraday';
import { StrategyResult } from '@/types/strategy';
import { Candle } from '@/types';

function bar(minutesAfterOpen: number, open: number, high: number, low: number, close: number): Candle {
  // 2024-01-17 is a Wednesday in January (CST = UTC-6, no DST) — 08:30 CST = 14:30 UTC.
  const timestamp = new Date(new Date('2024-01-17T14:30:00.000Z').getTime() + minutesAfterOpen * 60000);
  return { timestamp, open, high, low, close, volume: 100000 };
}

/** TEST-ONLY strategy: always signals BUY off the latest bar's close, with a fixed % risk/reward. */
function makeAlwaysBuyStrategy(riskPct = 0.02, rewardPct = 0.05): IntradayStrategy {
  return {
    name: 'always_buy_test',
    description: 'TEST ONLY',
    evaluate(context: IntradayContext): StrategyResult {
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

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    startingCapital: 10000,
    maxRiskPerTradePct: 0.01,
    maxPositions: 5,
    maxPortfolioExposurePct: 0.9,
    slippageBps: 0,
    commissionBps: 0,
    fractionalShares: false,
    ...overrides,
  };
}

function makeDayConfig(overrides: Partial<IntradayBacktestConfig> = {}): IntradayBacktestConfig {
  return {
    maxTradesPerDay: 5,
    maxPositionValueUsd: 100000,
    trailingPercent: 5,
    startTimeCst: '08:30',
    endTimeCst: '15:00',
    ...overrides,
  };
}

/** Flat SPY bars matching the given timestamps — content is irrelevant to the always-buy test strategy, only presence matters (buildIntradayContext('SPY', ...) must have data). */
function spyBarsFor(bars: Candle[]): Candle[] {
  return bars.map((b) => ({ ...b, open: 400, high: 401, low: 399, close: 400 }));
}

describe('IntradayBacktester', () => {
  const backtester = new IntradayBacktester({ classificationThresholds: { buy: 0, watch: 0 } }); // always take detected setups

  describe('entry execution timing', () => {
    it('should execute the entry at the NEXT bar open, not the signal bar close, and flatten at day end', () => {
      // Signal bar: entry=100, stop=98 (riskDistance=2), target=105 (rewardDistance=5).
      // Re-anchored to the actual fill price (bar 1's open=110): stop=108, target=115.
      const bars = [
        bar(0, 100, 100.5, 99.5, 100), // signal bar: close=100
        bar(5, 110, 111, 109, 110.5), // execution bar: open=110
        bar(10, 110.5, 111, 108.5, 109), // last bar of day: low (108.5) stays above the re-anchored stop (108) — force-flatten, not a stop-out
      ];
      const universe = new Map([['TEST', bars]]);

      const result = backtester.run(
        [makeAlwaysBuyStrategy(0.02, 0.05)],
        universe,
        spyBarsFor(bars),
        makeConfig(),
        makeDayConfig()
      );

      expect(result.trades.length).toBe(1);
      const trade = result.trades[0];
      expect(trade.entryDate.getTime()).toBe(bars[1].timestamp.getTime());
      expect(trade.entryPrice).toBeCloseTo(110, 8); // bar 1's OPEN, not bar 0's close of 100
      expect(trade.stopPrice).toBeCloseTo(108, 8); // riskDistance (2) re-anchored to the actual fill price
      expect(trade.exitReason).toBe('end_of_data');
      expect(trade.exitPrice).toBeCloseTo(109, 8); // final bar's close
    });
  });

  describe('trailing stop', () => {
    it('should ratchet the stop up as price rises and exit at the ratcheted level, not the original stop', () => {
      const bars = [
        bar(0, 100, 100.5, 99.5, 100), // signal: entry=100 -> initial stop=98, target=105
        bar(5, 100, 101, 99.5, 100.5), // fill bar: open=100 -> highWaterMark starts at 101
        bar(10, 100.2, 104, 99.8, 103.5), // rises to 104 -> trailing stop ratchets to 104*0.95=98.8 (still < target 105)
        bar(15, 100, 100.2, 98.5, 98.6), // pulls back: low=98.5 is ABOVE the original 98 stop but BELOW the ratcheted 98.8
      ];
      const universe = new Map([['TEST', bars]]);

      const result = backtester.run(
        [makeAlwaysBuyStrategy(0.02, 0.05)],
        universe,
        spyBarsFor(bars),
        makeConfig(),
        makeDayConfig({ trailingPercent: 5 })
      );

      expect(result.trades.length).toBe(1);
      const trade = result.trades[0];
      expect(trade.exitReason).toBe('stop');
      // Proves ratcheting: fires on bar 4 (low 98.5) even though price never
      // dropped below the ORIGINAL 98 stop — only below the ratcheted 98.8 one.
      expect(trade.exitPrice).toBeCloseTo(98.8, 8);
      expect(trade.exitDate?.getTime()).toBe(bars[3].timestamp.getTime());
    });
  });

  describe('daily trade cap', () => {
    it('should take only the top-ranked signal(s) up to maxTradesPerDay, even when more tickers qualify', () => {
      const bars = [
        bar(0, 100, 100.5, 99.5, 100),
        bar(5, 100, 101, 99, 100.5),
        bar(10, 100.5, 101, 99, 100),
      ];
      const universe = new Map([
        ['AAA', bars],
        ['BBB', bars.map((b) => ({ ...b }))],
      ]);

      const result = backtester.run(
        [makeAlwaysBuyStrategy(0.02, 0.05)],
        universe,
        spyBarsFor(bars),
        makeConfig(),
        makeDayConfig({ maxTradesPerDay: 1 })
      );

      // Both AAA and BBB signal on the same bar with identical setups —
      // only ONE should ever be traded, on ANY subsequent bar, because the
      // daily cap is reserved at signal time and never resets that day.
      expect(result.trades.length).toBe(1);
    });
  });

  describe('outside the market-hours window', () => {
    it('should not evaluate or trade bars outside startTimeCst/endTimeCst', () => {
      // 07:00 CST = 13:00 UTC — before the 08:30 CST window opens.
      const earlyBar: Candle = { timestamp: new Date('2024-01-17T13:00:00.000Z'), open: 100, high: 100.5, low: 99.5, close: 100, volume: 100000 };
      const universe = new Map([['TEST', [earlyBar]]]);

      const result = backtester.run(
        [makeAlwaysBuyStrategy()],
        universe,
        spyBarsFor([earlyBar]),
        makeConfig(),
        makeDayConfig()
      );

      expect(result.trades.length).toBe(0);
      expect(result.equityCurve.length).toBe(0);
    });
  });

  describe('maxEntryAtrPctOfPrice entry-quality gate', () => {
    // 20 calm warm-up bars (tight range -> small ATR14 relative to price)
    // followed by the signal/fill/flatten bars, so ATR14 is well-defined
    // and small (well under 1% of price) by the time the signal fires.
    function calmWarmupBars(count: number): Candle[] {
      return Array.from({ length: count }, (_, i) => bar(i * 5, 100, 100.05, 99.95, 100));
    }

    it('should be a no-op (identical to baseline) when left undefined', () => {
      const bars = [...calmWarmupBars(20), bar(100, 100, 100.5, 99.5, 100), bar(105, 100, 101, 99, 100.5), bar(110, 100.5, 101, 99, 100)];
      const universe = new Map([['TEST', bars]]);

      const withoutGate = backtester.run([makeAlwaysBuyStrategy(0.02, 0.05)], universe, spyBarsFor(bars), makeConfig(), makeDayConfig());
      const withUndefinedGate = backtester.run(
        [makeAlwaysBuyStrategy(0.02, 0.05)],
        universe,
        spyBarsFor(bars),
        makeConfig(),
        makeDayConfig({ maxEntryAtrPctOfPrice: undefined })
      );

      expect(withUndefinedGate.trades.length).toBe(withoutGate.trades.length);
    });

    it('should reject a signal whose ATR14/close exceeds the threshold', () => {
      const bars = [...calmWarmupBars(20), bar(100, 100, 100.5, 99.5, 100), bar(105, 100, 101, 99, 100.5), bar(110, 100.5, 101, 99, 100)];
      const universe = new Map([['TEST', bars]]);

      // ATR14 here is well under 1% of price (calm warm-up) — a threshold
      // far tighter than that should reject every signal.
      const result = backtester.run(
        [makeAlwaysBuyStrategy(0.02, 0.05)],
        universe,
        spyBarsFor(bars),
        makeConfig(),
        makeDayConfig({ maxEntryAtrPctOfPrice: 0.0001 })
      );

      expect(result.trades.length).toBe(0);
    });

    it('should allow a signal whose ATR14/close is under the threshold', () => {
      const bars = [...calmWarmupBars(20), bar(100, 100, 100.5, 99.5, 100), bar(105, 100, 101, 99, 100.5), bar(110, 100.5, 101, 99, 100)];
      const universe = new Map([['TEST', bars]]);

      const result = backtester.run(
        [makeAlwaysBuyStrategy(0.02, 0.05)],
        universe,
        spyBarsFor(bars),
        makeConfig(),
        makeDayConfig({ maxEntryAtrPctOfPrice: 0.05 }) // 5% — generous, calm bars should pass
      );

      expect(result.trades.length).toBe(1);
    });
  });
});
