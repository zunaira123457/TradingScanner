import { buyAndHoldBenchmark } from '@/backtesting/BuyAndHold';
import { BacktestConfig } from '@/types/backtest';
import { Candle } from '@/types';

function c(open: number, close: number, dayOffset: number): Candle {
  return { timestamp: new Date(2020, 0, 1 + dayOffset), open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000000 };
}

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    startingCapital: 10000, maxRiskPerTradePct: 0.01, maxPositions: 5,
    maxPortfolioExposurePct: 0.8, slippageBps: 0, commissionBps: 0, fractionalShares: false,
    ...overrides,
  };
}

describe('buyAndHoldBenchmark', () => {
  it('should buy at the start open and mark to market at the end close (hand-verified)', () => {
    const candles = [c(100, 100, 0), c(105, 105, 1), c(120, 120, 2)];
    const result = buyAndHoldBenchmark(candles, makeConfig(), 0, 2);

    // shares = floor(10000/100) = 100
    expect(result.trades.length).toBe(1);
    expect(result.trades[0].shares).toBe(100);
    expect(result.trades[0].entryPrice).toBeCloseTo(100, 8);
    expect(result.trades[0].exitPrice).toBeCloseTo(120, 8);
    // netPnl = (120-100)*100 = 2000
    expect(result.trades[0].netPnl).toBeCloseTo(2000, 8);
    expect(result.metrics.totalReturn).toBeCloseTo(2000 / 10000, 6);
  });

  it('should apply slippage and commission to reduce the fill/return', () => {
    const candles = [c(100, 100, 0), c(105, 105, 1), c(120, 120, 2)];
    const zeroCost = buyAndHoldBenchmark(candles, makeConfig(), 0, 2);
    const withCosts = buyAndHoldBenchmark(candles, makeConfig({ slippageBps: 50, commissionBps: 10 }), 0, 2);

    expect((withCosts.trades[0].netPnl as number)).toBeLessThan(zeroCost.trades[0].netPnl as number);
  });

  it('should produce an equity curve covering the full date range', () => {
    const candles = [c(100, 100, 0), c(105, 105, 1), c(120, 120, 2)];
    const result = buyAndHoldBenchmark(candles, makeConfig(), 0, 2);
    expect(result.equityCurve.length).toBe(3);
    expect(result.equityCurve[2].equity).toBeCloseTo(12000, 8);
  });

  it('should support fractional shares when configured', () => {
    const candles = [c(3, 3, 0), c(5, 5, 1)];
    const result = buyAndHoldBenchmark(candles, makeConfig({ startingCapital: 100, fractionalShares: true }), 0, 1);
    expect(result.trades[0].shares).toBeCloseTo(100 / 3, 4);
  });
});
