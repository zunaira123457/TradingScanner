import { bucketTradesBy, analyzeByYear, analyzeByRegime, analyzeBySector, analyzeStockConcentration } from '@/backtesting/TradeAnalytics';
import { Trade } from '@/types/backtest';

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'T1', ticker: 'AAPL', strategy: 'trend_pullback',
    signalDate: new Date('2023-01-01'), entryDate: new Date('2023-01-02'),
    entryPrice: 100, shares: 10, stopPrice: 95, targetPrice: 115,
    exitDate: new Date('2023-01-05'), exitPrice: 105, exitReason: 'target',
    grossPnl: 50, fees: 0, slippageCost: 0, netPnl: 50, rMultiple: 1,
    signalScore: 80, marketRegimeAtEntry: 'bullish', status: 'closed',
    ...overrides,
  };
}

describe('TradeAnalytics', () => {
  describe('bucketTradesBy', () => {
    it('should group closed trades by the given key and exclude open trades', () => {
      const trades = [
        makeTrade({ id: '1', ticker: 'AAPL' }),
        makeTrade({ id: '2', ticker: 'MSFT' }),
        makeTrade({ id: '3', ticker: 'AAPL' }),
        makeTrade({ id: '4', ticker: 'AAPL', status: 'open', netPnl: null, exitDate: null }),
      ];
      const buckets = bucketTradesBy(trades, (t) => t.ticker);
      expect(buckets.get('AAPL')!.length).toBe(2);
      expect(buckets.get('MSFT')!.length).toBe(1);
    });

    it('should exclude trades where keyFn returns null', () => {
      const trades = [makeTrade({ id: '1' }), makeTrade({ id: '2', marketRegimeAtEntry: null })];
      const buckets = bucketTradesBy(trades, (t) => t.marketRegimeAtEntry);
      const total = [...buckets.values()].reduce((s, ts) => s + ts.length, 0);
      expect(total).toBe(1);
    });
  });

  describe('analyzeByYear', () => {
    it('should bucket by the EXIT date year and sort chronologically', () => {
      const trades = [
        makeTrade({ id: '1', exitDate: new Date('2024-03-01'), netPnl: 100 }),
        makeTrade({ id: '2', exitDate: new Date('2022-06-01'), netPnl: -50 }),
        makeTrade({ id: '3', exitDate: new Date('2024-09-01'), netPnl: 200 }),
      ];
      const result = analyzeByYear(trades);
      expect(result.map((r) => r.label)).toEqual(['2022', '2024']);
      expect(result[1].trades).toBe(2);
      expect(result[1].netPnl).toBeCloseTo(300, 8);
    });
  });

  describe('analyzeByRegime', () => {
    it('should bucket by marketRegimeAtEntry', () => {
      const trades = [
        makeTrade({ id: '1', marketRegimeAtEntry: 'bullish', netPnl: 100 }),
        makeTrade({ id: '2', marketRegimeAtEntry: 'bearish', netPnl: -80 }),
        makeTrade({ id: '3', marketRegimeAtEntry: 'bullish', netPnl: 50 }),
      ];
      const result = analyzeByRegime(trades);
      const bullish = result.find((r) => r.label === 'bullish')!;
      expect(bullish.trades).toBe(2);
      expect(bullish.netPnl).toBeCloseTo(150, 8);
    });
  });

  describe('analyzeBySector', () => {
    it('should bucket by sector via the external map and exclude unmapped tickers', () => {
      const trades = [
        makeTrade({ id: '1', ticker: 'AAPL', netPnl: 100 }),
        makeTrade({ id: '2', ticker: 'JPM', netPnl: 50 }),
        makeTrade({ id: '3', ticker: 'UNKNOWN', netPnl: 999 }),
      ];
      const sectorMap = new Map([['AAPL', 'Technology'], ['JPM', 'Financials']]);
      const result = analyzeBySector(trades, sectorMap);

      const totalTrades = result.reduce((s, r) => s + r.trades, 0);
      expect(totalTrades).toBe(2); // UNKNOWN excluded
      expect(result.find((r) => r.label === 'Technology')!.trades).toBe(1);
    });
  });

  describe('summarizeBucket metrics (via analyzeByYear, hand-verified)', () => {
    it('should compute winRate/profitFactor/expectancy correctly for a mixed bucket', () => {
      const trades = [
        makeTrade({ id: '1', exitDate: new Date(2023, 0, 1), netPnl: 300 }),
        makeTrade({ id: '2', exitDate: new Date(2023, 1, 1), netPnl: -100 }),
        makeTrade({ id: '3', exitDate: new Date(2023, 2, 1), netPnl: 200 }),
      ];
      const [bucket2023] = analyzeByYear(trades);
      expect(bucket2023.trades).toBe(3);
      expect(bucket2023.winRate).toBeCloseTo(2 / 3, 8);
      expect(bucket2023.profitFactor).toBeCloseTo(500 / 100, 8);
      expect(bucket2023.expectancy).toBeCloseTo(400 / 3, 8);
      expect(bucket2023.avgReturn).toBeCloseTo(400 / 3, 8);
    });
  });

  describe('analyzeStockConcentration', () => {
    it('should rank stocks by netPnl descending and compute top5PctOfTotalPnl (hand-verified)', () => {
      const trades = [
        makeTrade({ id: '1', ticker: 'A', netPnl: 500 }),
        makeTrade({ id: '2', ticker: 'B', netPnl: 300 }),
        makeTrade({ id: '3', ticker: 'C', netPnl: 100 }),
        makeTrade({ id: '4', ticker: 'D', netPnl: -50 }),
        makeTrade({ id: '5', ticker: 'E', netPnl: 50 }),
        makeTrade({ id: '6', ticker: 'F', netPnl: 25 }),
      ];
      // totalPnl = 500+300+100-50+50+25 = 925
      // top5 (A,B,C,E,F by netPnl desc: 500,300,100,50,25) sum = 975
      const report = analyzeStockConcentration(trades);

      expect(report.uniqueStocks).toBe(6);
      expect(report.contributions[0].ticker).toBe('A');
      expect(report.contributions[0].netPnl).toBe(500);
      expect(report.top5PctOfTotalPnl).toBeCloseTo((975 / 925) * 100, 4);
      expect(report.stocksWithPositiveExpectancy).toBe(5);
      expect(report.stocksWithNegativeExpectancy).toBe(1);
    });

    it('should compute median contribution correctly (even count)', () => {
      const trades = [
        makeTrade({ id: '1', ticker: 'A', netPnl: 100 }),
        makeTrade({ id: '2', ticker: 'B', netPnl: 200 }),
        makeTrade({ id: '3', ticker: 'C', netPnl: 300 }),
        makeTrade({ id: '4', ticker: 'D', netPnl: 400 }),
      ];
      const report = analyzeStockConcentration(trades);
      // sorted ascending: 100,200,300,400 -> median = (200+300)/2 = 250
      expect(report.medianContribution).toBeCloseTo(250, 8);
    });

    it('should return an empty report for no trades', () => {
      const report = analyzeStockConcentration([]);
      expect(report.uniqueStocks).toBe(0);
      expect(report.top5PctOfTotalPnl).toBe(0);
      expect(report.medianContribution).toBe(0);
    });
  });
});
