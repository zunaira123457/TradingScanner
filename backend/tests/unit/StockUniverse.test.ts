import { StockUniverse } from '@/data/StockUniverse';
import { Candle, StockInfo } from '@/types';

describe('StockUniverse', () => {
  let universe: StockUniverse;

  beforeEach(() => {
    universe = new StockUniverse({
      minPrice: 1.0,
      minAvgVolume: 100000,
      minAvgDollarVolume: 1000000,
      minHistoryDays: 252,
      excludeETFs: true,
      excludeInverseLeveraged: true,
      requireUSListed: true,
    });
  });

  const createCandle = (
    timestamp: Date,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number
  ): Candle => ({
    timestamp,
    open,
    high,
    low,
    close,
    volume,
  });

  const createGoodCandles = (count: number = 252): Candle[] => {
    return Array.from({ length: count }, (_, i) =>
      createCandle(new Date(2024, 0, 1 + i), 100, 105, 95, 102, 1000000)
    );
  };

  const createStockInfo = (name: string = 'Test Corp'): StockInfo => ({
    ticker: 'TEST',
    name,
    sector: 'Technology',
    industry: 'Software',
    price: 50,
  });

  describe('evaluateStock', () => {
    it('should include stock that meets all criteria', () => {
      const candles = createGoodCandles();
      const info = createStockInfo();

      const result = universe.evaluateStock('TEST', candles, info, 1000000);

      expect(result.includesInUniverse).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should exclude stock with insufficient history', () => {
      const candles = createGoodCandles(50);
      const info = createStockInfo();

      const result = universe.evaluateStock('TEST', candles, info, 1000000);

      expect(result.includesInUniverse).toBe(false);
      expect(result.reason).toContain('Insufficient history');
    });

    it('should exclude stock with price too low', () => {
      const candles = createGoodCandles();
      const info = createStockInfo();
      info.price = 0.5; // below MIN_PRICE

      const result = universe.evaluateStock('TEST', candles, info, 1000000);

      expect(result.includesInUniverse).toBe(false);
      expect(result.reason).toContain('Price too low');
    });

    it('should exclude stock with volume too low', () => {
      const candles = createGoodCandles();
      const info = createStockInfo();

      const result = universe.evaluateStock('TEST', candles, info, 50000); // below MIN_AVG_VOLUME

      expect(result.includesInUniverse).toBe(false);
      expect(result.reason).toContain('Volume too low');
    });

    it('should exclude stock with dollar volume too low', () => {
      const candles = createGoodCandles();
      const info = createStockInfo();
      info.price = 1; // $1 * 100k volume = $100k < $1M min

      const result = universe.evaluateStock('TEST', candles, info, 100000);

      expect(result.includesInUniverse).toBe(false);
      expect(result.reason).toContain('Dollar volume too low');
    });

    it('should calculate quality score', () => {
      const candles = createGoodCandles();
      const info = createStockInfo();

      const result = universe.evaluateStock('TEST', candles, info, 1000000);

      expect(result.dataQualityScore).toBeGreaterThan(0);
      expect(result.dataQualityScore).toBeLessThanOrEqual(1);
    });

    it('should calculate average volume correctly', () => {
      const candles = createGoodCandles();
      const info = createStockInfo();

      // All candles have 1M volume, so avg should be 1M
      const result = universe.evaluateStock('TEST', candles, info);

      expect(result.avgVolume30d).toBeGreaterThan(900000);
      expect(result.avgVolume30d).toBeLessThan(1100000);
    });

    it('should calculate dollar volume correctly', () => {
      const candles = createGoodCandles();
      const info = createStockInfo();
      info.price = 50;

      const result = universe.evaluateStock('TEST', candles, info, 1000000);

      expect(result.avgDollarVolume30d).toBeGreaterThan(40000000);
      expect(result.avgDollarVolume30d).toBeLessThan(60000000);
    });
  });

  describe('filterStocks', () => {
    it('should separate included and excluded stocks', () => {
      const stocks = [
        {
          ticker: 'STOCK1',
          name: 'Stock One',
          avgVolume30d: 1000000,
          avgDollarVolume30d: 50000000,
          currentPrice: 50,
          dataQualityScore: 0.9,
          includesInUniverse: true,
        },
        {
          ticker: 'STOCK2',
          name: 'Stock Two',
          avgVolume30d: 50000,
          avgDollarVolume30d: 2500000,
          currentPrice: 50,
          dataQualityScore: 0.5,
          includesInUniverse: false,
          reason: 'Volume too low',
        },
        {
          ticker: 'STOCK3',
          name: 'Stock Three',
          avgVolume30d: 1500000,
          avgDollarVolume30d: 75000000,
          currentPrice: 50,
          dataQualityScore: 0.85,
          includesInUniverse: true,
        },
      ];

      const result = universe.filterStocks(stocks);

      expect(result.included.length).toBe(2);
      expect(result.excluded.length).toBe(1);
      expect(result.included.map((s) => s.ticker)).toContain('STOCK1');
      expect(result.included.map((s) => s.ticker)).toContain('STOCK3');
      expect(result.excluded.map((s) => s.ticker)).toContain('STOCK2');
    });
  });

  describe('custom filters', () => {
    it('should use custom filter thresholds', () => {
      const customUniverse = new StockUniverse({
        minPrice: 10.0,
        minAvgVolume: 500000,
        minAvgDollarVolume: 5000000,
        minHistoryDays: 100,
      });

      const candles = createGoodCandles(150);
      const info = createStockInfo();
      info.price = 5; // below custom MIN_PRICE

      const result = customUniverse.evaluateStock('TEST', candles, info, 500000);

      expect(result.includesInUniverse).toBe(false);
      expect(result.reason).toContain('Price too low');
    });
  });
});
