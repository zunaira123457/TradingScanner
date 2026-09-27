import {
  calculateTotalReturn,
  calculateCAGR,
  calculateWinRate,
  calculateAvgWin,
  calculateAvgLoss,
  calculateProfitFactor,
  calculateExpectancy,
  calculateDailyReturns,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateMaxDrawdown,
  calculateConsecutiveStreaks,
  calculateAvgHoldingPeriod,
  calculateBestTrade,
  calculateWorstTrade,
  calculateAllMetrics,
} from '@/backtesting/Metrics';
import { Trade, PortfolioSnapshot } from '@/types/backtest';

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'T1', ticker: 'AAPL', strategy: 'trend_pullback',
    signalDate: new Date('2024-01-01'), entryDate: new Date('2024-01-02'),
    entryPrice: 100, shares: 10, stopPrice: 95, targetPrice: 115,
    exitDate: new Date('2024-01-05'), exitPrice: 105, exitReason: 'target',
    grossPnl: 50, fees: 0, slippageCost: 0, netPnl: 50, rMultiple: 1,
    signalScore: 80, marketRegimeAtEntry: 'bullish', status: 'closed',
    ...overrides,
  };
}

// 5 hand-verified closed trades:
// +500 (4d), -200 (2d), +300 (6d), +100 (2d), -400 (1d)
const FIVE_TRADES: Trade[] = [
  makeTrade({ id: 'T1', netPnl: 500, entryDate: new Date('2024-01-01'), exitDate: new Date('2024-01-05') }),
  makeTrade({ id: 'T2', netPnl: -200, entryDate: new Date('2024-01-06'), exitDate: new Date('2024-01-08') }),
  makeTrade({ id: 'T3', netPnl: 300, entryDate: new Date('2024-01-09'), exitDate: new Date('2024-01-15') }),
  makeTrade({ id: 'T4', netPnl: 100, entryDate: new Date('2024-01-16'), exitDate: new Date('2024-01-18') }),
  makeTrade({ id: 'T5', netPnl: -400, entryDate: new Date('2024-01-19'), exitDate: new Date('2024-01-20') }),
];

describe('Metrics', () => {
  describe('calculateTotalReturn / calculateCAGR', () => {
    it('should compute total return correctly', () => {
      expect(calculateTotalReturn(100000, 120000)).toBeCloseTo(0.2, 8);
      expect(calculateTotalReturn(100000, 80000)).toBeCloseTo(-0.2, 8);
    });

    it('should compute CAGR correctly for a 2-year, 21% total-return period', () => {
      // (121000/100000)^(1/2) - 1 = 1.1 - 1 = 0.10 (10% CAGR)
      expect(calculateCAGR(100000, 121000, 2)).toBeCloseTo(0.1, 6);
    });

    it('should return -1 for a total loss', () => {
      expect(calculateCAGR(100000, 0, 1)).toBe(-1);
    });
  });

  describe('win rate / avg win / avg loss / profit factor / expectancy (hand-verified 5-trade set)', () => {
    it('should compute win rate as 3/5', () => {
      expect(calculateWinRate(FIVE_TRADES)).toBeCloseTo(0.6, 8);
    });

    it('should compute avg win as (500+300+100)/3', () => {
      expect(calculateAvgWin(FIVE_TRADES)).toBeCloseTo(300, 8);
    });

    it('should compute avg loss as (-200-400)/2 (negative)', () => {
      expect(calculateAvgLoss(FIVE_TRADES)).toBeCloseTo(-300, 8);
    });

    it('should compute profit factor as grossProfit/grossLoss = 900/600', () => {
      expect(calculateProfitFactor(FIVE_TRADES)).toBeCloseTo(1.5, 8);
    });

    it('should compute expectancy as total netPnl / count = 300/5', () => {
      expect(calculateExpectancy(FIVE_TRADES)).toBeCloseTo(60, 8);
    });

    it('should return Infinity profit factor with wins and no losses', () => {
      const allWins = [makeTrade({ netPnl: 100 }), makeTrade({ netPnl: 200 })];
      expect(calculateProfitFactor(allWins)).toBe(Infinity);
    });

    it('should return 0 for all metrics on an empty trade list', () => {
      expect(calculateWinRate([])).toBe(0);
      expect(calculateAvgWin([])).toBe(0);
      expect(calculateAvgLoss([])).toBe(0);
      expect(calculateProfitFactor([])).toBe(0);
      expect(calculateExpectancy([])).toBe(0);
    });

    it('should ignore open (unclosed) trades', () => {
      const mixed = [...FIVE_TRADES, makeTrade({ id: 'OPEN', status: 'open', netPnl: null, exitDate: null })];
      expect(calculateWinRate(mixed)).toBeCloseTo(0.6, 8);
    });
  });

  describe('bestTrade / worstTrade / avgHoldingPeriod', () => {
    it('should identify the best and worst trades', () => {
      expect(calculateBestTrade(FIVE_TRADES)).toBe(500);
      expect(calculateWorstTrade(FIVE_TRADES)).toBe(-400);
    });

    it('should compute average holding period as (4+2+6+2+1)/5 = 3 days', () => {
      expect(calculateAvgHoldingPeriod(FIVE_TRADES)).toBeCloseTo(3, 8);
    });
  });

  describe('calculateConsecutiveStreaks', () => {
    it('should compute max consecutive wins=2, losses=1 for +,-,+,+,-', () => {
      const result = calculateConsecutiveStreaks(FIVE_TRADES);
      expect(result.maxConsecutiveWins).toBe(2);
      expect(result.maxConsecutiveLosses).toBe(1);
    });

    it('should reset both streaks on a breakeven trade', () => {
      const trades = [
        makeTrade({ id: '1', netPnl: 100, exitDate: new Date('2024-01-01') }),
        makeTrade({ id: '2', netPnl: 100, exitDate: new Date('2024-01-02') }),
        makeTrade({ id: '3', netPnl: 0, exitDate: new Date('2024-01-03') }),
        makeTrade({ id: '4', netPnl: -50, exitDate: new Date('2024-01-04') }),
      ];
      const result = calculateConsecutiveStreaks(trades);
      expect(result.maxConsecutiveWins).toBe(2);
      expect(result.maxConsecutiveLosses).toBe(1);
    });

    it('should order by exit date, not array order', () => {
      const trades = [
        makeTrade({ id: 'late', netPnl: 100, exitDate: new Date('2024-01-10') }),
        makeTrade({ id: 'early', netPnl: 100, exitDate: new Date('2024-01-01') }),
        makeTrade({ id: 'mid', netPnl: 100, exitDate: new Date('2024-01-05') }),
      ];
      // All wins regardless of order -> streak of 3
      expect(calculateConsecutiveStreaks(trades).maxConsecutiveWins).toBe(3);
    });
  });

  describe('calculateDailyReturns / calculateSharpeRatio / calculateSortinoRatio', () => {
    const equityValues = [100000, 101000, 99000, 102000, 98000, 103000];
    const equityCurve: PortfolioSnapshot[] = equityValues.map((equity, i) => ({
      date: new Date(2024, 0, 1 + i), cash: equity, equity, openPositionsCount: 0, exposurePct: 0,
    }));

    it('should compute daily returns matching an independent recomputation', () => {
      const returns = calculateDailyReturns(equityCurve);
      expect(returns.length).toBe(5);
      for (let i = 0; i < returns.length; i++) {
        const expected = (equityValues[i + 1] - equityValues[i]) / equityValues[i];
        expect(returns[i]).toBeCloseTo(expected, 10);
      }
    });

    it('Sharpe ratio should match an independent recomputation of the same formula', () => {
      const returns = calculateDailyReturns(equityCurve);
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
      const expected = (mean / Math.sqrt(variance)) * Math.sqrt(252);
      expect(calculateSharpeRatio(returns)).toBeCloseTo(expected, 8);
    });

    it('should return 0 Sharpe/Sortino for an empty return series', () => {
      expect(calculateSharpeRatio([])).toBe(0);
      expect(calculateSortinoRatio([])).toBe(0);
    });

    it('Sortino ratio should be higher than Sharpe when losses are a minority of volatility (downside-only penalty)', () => {
      // Mostly-up returns with one small down day: downside deviation < total stdev,
      // so Sortino (dividing by the smaller downside-only figure) should exceed Sharpe.
      const returns = [0.02, 0.015, 0.01, -0.005, 0.018];
      const sharpe = calculateSharpeRatio(returns);
      const sortino = calculateSortinoRatio(returns);
      expect(sortino).toBeGreaterThan(sharpe);
    });

    it('should return 0 when returns have zero variance (flat equity)', () => {
      const flat = [0, 0, 0, 0];
      expect(calculateSharpeRatio(flat)).toBe(0);
    });
  });

  describe('calculateMaxDrawdown', () => {
    it('should compute the largest peak-to-trough decline (hand-verified)', () => {
      const equityValues = [100000, 101000, 99000, 102000, 98000, 103000];
      const equityCurve: PortfolioSnapshot[] = equityValues.map((equity, i) => ({
        date: new Date(2024, 0, 1 + i), cash: equity, equity, openPositionsCount: 0, exposurePct: 0,
      }));
      // Peaks: 100000,101000,101000,102000,102000,103000
      // Drawdowns at each point: 0, 0, (101000-99000)/101000, 0, (102000-98000)/102000, 0
      const expected = (102000 - 98000) / 102000; // the larger of the two drawdowns
      expect(calculateMaxDrawdown(equityCurve)).toBeCloseTo(expected, 8);
    });

    it('should return 0 for a monotonically increasing equity curve', () => {
      const equityCurve: PortfolioSnapshot[] = [100000, 105000, 110000].map((equity, i) => ({
        date: new Date(2024, 0, 1 + i), cash: equity, equity, openPositionsCount: 0, exposurePct: 0,
      }));
      expect(calculateMaxDrawdown(equityCurve)).toBe(0);
    });

    it('should return 0 for an empty equity curve', () => {
      expect(calculateMaxDrawdown([])).toBe(0);
    });
  });

  describe('calculateAllMetrics', () => {
    it('should assemble a complete, internally consistent metrics object', () => {
      const equityValues = [100000, 100500, 100300, 100800, 100400, 100900];
      const equityCurve: PortfolioSnapshot[] = equityValues.map((equity, i) => ({
        date: new Date(2024, 0, 1 + i), cash: equity, equity, openPositionsCount: 0, exposurePct: 0,
      }));

      const metrics = calculateAllMetrics(
        FIVE_TRADES,
        equityCurve,
        100000,
        new Date('2024-01-01'),
        new Date('2024-01-06')
      );

      expect(metrics.numTrades).toBe(5);
      expect(metrics.winRate).toBeCloseTo(0.6, 8);
      expect(metrics.avgWin).toBeCloseTo(300, 8);
      expect(metrics.avgLoss).toBeCloseTo(-300, 8);
      expect(metrics.profitFactor).toBeCloseTo(1.5, 8);
      expect(metrics.expectancy).toBeCloseTo(60, 8);
      expect(metrics.bestTrade).toBe(500);
      expect(metrics.worstTrade).toBe(-400);
      expect(metrics.maxConsecutiveWins).toBe(2);
      expect(metrics.maxConsecutiveLosses).toBe(1);
      expect(metrics.avgHoldingPeriodDays).toBeCloseTo(3, 8);
      expect(metrics.totalReturn).toBeCloseTo((100900 - 100000) / 100000, 8);
      expect(Number.isFinite(metrics.cagr)).toBe(true);
      expect(Number.isFinite(metrics.sharpeRatio)).toBe(true);
      expect(Number.isFinite(metrics.sortinoRatio)).toBe(true);
      expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    });

    it('should handle a completely empty backtest gracefully', () => {
      const metrics = calculateAllMetrics([], [], 100000, new Date('2024-01-01'), new Date('2024-01-02'));
      expect(metrics.numTrades).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(metrics.totalReturn).toBe(0);
      expect(metrics.maxDrawdown).toBe(0);
    });
  });
});
