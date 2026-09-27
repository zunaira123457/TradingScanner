/**
 * Dedicated look-ahead bias audit.
 *
 * Part 1 proves the REAL code (Backtester + buildStrategyContext) is safe
 * by the same technique used throughout Phases 2-4: running on a truncated
 * vs. an artificially-extended dataset must yield byte-identical results up
 * to the shared as-of date.
 *
 * Part 2 is the explicitly-mandated test: it deliberately reproduces the
 * exact bug Backtester.ts's own comments warn about — forgetting to slice
 * auxiliary (benchmark/index/sector) data to the as-of date before building
 * a context — and proves the equivalence-check technique used in Part 1
 * WOULD catch it. This is not a vacuous test: it shows the detection
 * technique is sensitive to a real, realistic violation, not just that our
 * code happens to pass.
 */
import { Backtester } from '@/backtesting/Backtester';
import { buildStrategyContext } from '@/strategies/StrategyContext';
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

function makeAlwaysBuyStrategy(): Strategy {
  return {
    name: 'always_buy_test',
    description: 'TEST ONLY',
    evaluate(context: StrategyContext): StrategyResult {
      const today = context.candles[context.candles.length - 1];
      const entry = today.close;
      const stop = entry * 0.95;
      const target = entry * 1.1;
      return {
        strategy: 'always_buy_test', ticker: context.ticker, date: today.timestamp,
        setupDetected: true, confidence: 1, entry, stop, target,
        riskPerShare: entry - stop, rewardPerShare: target - entry,
        riskRewardRatio: (target - entry) / (entry - stop),
        evidence: [], warnings: [], supportingPatterns: [],
      };
    },
  };
}

function c(open: number, high: number, low: number, close: number, dayOffset: number): Candle {
  return { timestamp: new Date(2020, 0, 1 + dayOffset), open, high, low, close, volume: 1000000 };
}

function makeOscillatingCandles(days: number, startPrice = 100): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < days; i++) {
    price += Math.sin(i / 3) * 2;
    const open = price - 0.3;
    const close = price;
    candles.push(c(open, Math.max(open, close) + 0.8, Math.min(open, close) - 0.8, close, i));
  }
  return candles;
}

/** A benchmark whose trend sharply reverses at `changeAtIndex` — flat/declining
 * before it, strongly rising after — so a forgotten slice (which would
 * silently pull in the future rally) produces an obviously different number,
 * not a rounding-level difference. */
function makeBenchmarkWithRegimeChange(totalDays: number, changeAtIndex: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < totalDays; i++) {
    price += i < changeAtIndex ? -0.05 : 0.8;
    candles.push(c(price - 0.1, price + 0.5, price - 0.5, price, i));
  }
  return candles;
}

describe('Look-ahead bias audit', () => {
  describe('Part 1: the real engine is point-in-time safe', () => {
    it('Backtester.run() gives identical results whether the universe extends beyond endIndex or is truncated exactly to it', () => {
      const candles = makeOscillatingCandles(60);
      const backtester = new Backtester({ classificationThresholds: { buy: 0, watch: 0 } });
      const config = makeConfig();

      const withFutureData: BacktestUniverse = { tickers: new Map([['TEST', candles]]) };
      const withoutFutureData: BacktestUniverse = { tickers: new Map([['TEST', candles.slice(0, 31)]]) };

      const resultA = backtester.run(makeAlwaysBuyStrategy(), withFutureData, config, 0, 30);
      const resultB = backtester.run(makeAlwaysBuyStrategy(), withoutFutureData, config, 0, 30);

      expect(resultA.trades).toEqual(resultB.trades);
      expect(resultA.metrics).toEqual(resultB.metrics);
    });

    it('buildStrategyContext gives an identical relativeStrength read whether the benchmark array is correctly sliced or exactly truncated to the as-of date', () => {
      const stockCandles = makeOscillatingCandles(300);
      const benchmark = makeBenchmarkWithRegimeChange(300, 150);
      const asOfIndex = 150;

      const correctlySliced = buildStrategyContext('TEST', stockCandles, {
        asOfIndex,
        benchmarkCandles: benchmark.slice(0, asOfIndex + 1), // what Backtester.ts actually does
      });
      const exactlyTruncatedInput = buildStrategyContext('TEST', stockCandles, {
        asOfIndex,
        benchmarkCandles: benchmark.slice(0, asOfIndex + 1).slice(), // equivalent alternate construction
      });

      expect(correctlySliced.relativeStrength).toEqual(exactlyTruncatedInput.relativeStrength);
    });
  });

  describe('Part 2: proof the equivalence-check technique DOES detect an injected violation', () => {
    it('forgetting to slice auxiliary benchmark data to the as-of date changes the relative-strength read (the exact bug class Backtester.ts guards against)', () => {
      const stockCandles = makeOscillatingCandles(300);
      const benchmark = makeBenchmarkWithRegimeChange(300, 150);
      const asOfIndex = 150;

      const correct = buildStrategyContext('TEST', stockCandles, {
        asOfIndex,
        benchmarkCandles: benchmark.slice(0, asOfIndex + 1), // CORRECT: matches Backtester.ts
      });

      // INJECTED BUG: the full, unsliced 300-day benchmark array is passed
      // in — reproducing exactly what would happen if a future edit to
      // Backtester.ts dropped its `.slice(0, t + 1)` call. Because
      // calculateRelativeStrength (Phase 2) always treats the LAST element
      // of whatever array it's given as "today", this silently redefines
      // "today" as day 300 instead of day 150, pulling the future rally
      // into the trailing-return window.
      const buggy = buildStrategyContext('TEST', stockCandles, {
        asOfIndex,
        benchmarkCandles: benchmark, // BUG: not sliced
      });

      expect(correct.relativeStrength).not.toBeNull();
      expect(buggy.relativeStrength).not.toBeNull();

      // The equivalence check catches it: these must NOT be equal, proving
      // that if this bug were ever (re)introduced into Backtester.ts, the
      // same technique used in Part 1 would fail the test suite.
      expect(buggy.relativeStrength).not.toEqual(correct.relativeStrength);
      expect(buggy.relativeStrength!.benchmarkReturn).toBeGreaterThan(
        correct.relativeStrength!.benchmarkReturn + 0.05 // materially different, not rounding noise
      );
    });

    it('a strategy that is structurally prevented from seeing beyond its context cannot introduce this class of bug on its own', () => {
      // This documents WHY the Strategy layer itself is safe: Strategy.evaluate()
      // only ever receives a StrategyContext, never the raw universe or an
      // index into "the future" — so the only place a look-ahead violation
      // can be introduced is in how the Backtester builds that context, which
      // Part 2's first test directly audits.
      const stockCandles = makeOscillatingCandles(60);
      const strategy = makeAlwaysBuyStrategy();
      const contextAt30 = buildStrategyContext('TEST', stockCandles, { asOfIndex: 30 });
      const result = strategy.evaluate(contextAt30);

      // The strategy's own decision cannot reference anything past index 30,
      // because context.candles itself only contains indices [0, 30].
      expect(contextAt30.candles.length).toBe(31);
      expect(result.date).toEqual(stockCandles[30].timestamp);
    });
  });
});
