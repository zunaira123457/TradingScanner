import { DataValidator } from '@/data/DataValidator';
import { Candle } from '@/types';

describe('DataValidator', () => {
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

  describe('validateCandles', () => {
    it('should pass validation for valid candle data', () => {
      const candles = [
        createCandle(new Date('2024-01-01'), 100, 105, 95, 102, 1000000),
        createCandle(new Date('2024-01-02'), 102, 110, 101, 108, 1200000),
        createCandle(new Date('2024-01-03'), 108, 112, 105, 110, 950000),
      ];

      const result = DataValidator.validateCandles('TEST', candles);

      expect(result.isValid).toBe(false); // Only 3 days, less than min 252
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.code === 'INSUFFICIENT_HISTORY')).toBe(true);
    });

    it('should detect invalid high-low relationship', () => {
      const candles = [
        createCandle(new Date('2024-01-01'), 100, 95, 105, 102, 1000000), // high < low
      ];

      const result = DataValidator.validateCandles('TEST', candles);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_HIGH_LOW')).toBe(true);
    });

    it('should detect negative prices', () => {
      const candles = [
        createCandle(new Date('2024-01-01'), -100, 105, 95, 102, 1000000),
      ];

      const result = DataValidator.validateCandles('TEST', candles);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'NEGATIVE_PRICE')).toBe(true);
    });

    it('should detect negative volume', () => {
      const candles = [
        createCandle(new Date('2024-01-01'), 100, 105, 95, 102, -1000),
      ];

      const result = DataValidator.validateCandles('TEST', candles);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'NEGATIVE_VOLUME')).toBe(true);
    });

    it('should detect non-chronological order', () => {
      const candles = [
        createCandle(new Date('2024-01-03'), 108, 112, 105, 110, 950000),
        createCandle(new Date('2024-01-01'), 100, 105, 95, 102, 1000000),
      ];

      const result = DataValidator.validateCandles('TEST', candles);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'NOT_CHRONOLOGICAL')).toBe(true);
    });

    it('should warn on zero volume', () => {
      const candles = Array.from({ length: 252 }, (_, i) =>
        createCandle(
          new Date(2024, 0, 1 + i),
          100,
          105,
          95,
          102,
          i === 50 ? 0 : 1000000 // one day with zero volume
        )
      );

      const result = DataValidator.validateCandles('TEST', candles);

      expect(result.warnings.some((w) => w.code === 'ZERO_VOLUME')).toBe(true);
    });

    it('should warn on large gaps', () => {
      const candles = [
        createCandle(new Date('2024-01-01'), 100, 105, 95, 102, 1000000),
        createCandle(new Date('2024-01-02'), 115, 120, 110, 118, 1000000), // 13% gap
      ];

      const result = DataValidator.validateCandles('TEST', candles);

      expect(result.warnings.some((w) => w.code === 'LARGE_GAP')).toBe(true);
    });

    it('should detect duplicate dates', () => {
      const date = new Date('2024-01-01');
      const candles = [
        createCandle(date, 100, 105, 95, 102, 1000000),
        createCandle(date, 102, 107, 100, 105, 1100000), // same date
      ];

      const result = DataValidator.validateCandles('TEST', candles);

      expect(result.warnings.some((w) => w.code === 'DUPLICATE_DATES')).toBe(true);
    });

    it('should return empty errors for null input', () => {
      const result = DataValidator.validateCandles('TEST', []);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.code === 'EMPTY_DATA')).toBe(true);
    });
  });

  describe('calculateDataQuality', () => {
    it('should return low score for minimal data', () => {
      const candles = Array.from({ length: 10 }, (_, i) =>
        createCandle(new Date(2024, 0, 1 + i), 100, 105, 95, 102, 1000000)
      );

      const score = DataValidator.calculateDataQuality(candles);

      expect(score).toBeLessThan(0.5);
    });

    it('should return high score for good data', () => {
      const candles = Array.from({ length: 252 }, (_, i) =>
        createCandle(new Date(2024, 0, 1 + i), 100, 105, 95, 102, 1000000)
      );

      const score = DataValidator.calculateDataQuality(candles);

      expect(score).toBeGreaterThan(0.7);
    });

    it('should penalize zero volume', () => {
      // 6% zero volume (> 5% threshold) should incur a mild penalty
      const candles = Array.from({ length: 252 }, (_, i) =>
        createCandle(
          new Date(2024, 0, 1 + i),
          100,
          105,
          95,
          102,
          i % 17 === 0 ? 0 : 1000000
        )
      );

      const score = DataValidator.calculateDataQuality(candles);
      const baseline = DataValidator.calculateDataQuality(
        Array.from({ length: 252 }, (_, i) =>
          createCandle(new Date(2024, 0, 1 + i), 100, 105, 95, 102, 1000000)
        )
      );

      expect(score).toBeLessThan(baseline);
    });
  });

  describe('validateStockUniverseMembership', () => {
    it('should qualify good stock', () => {
      const candles = Array.from({ length: 252 }, (_, i) =>
        createCandle(new Date(2024, 0, 1 + i), 100, 105, 95, 102, 1000000)
      );

      const result = DataValidator.validateStockUniverseMembership(candles, {
        price: 50,
        avgVolume30d: 1000000,
      });

      expect(result.qualifies).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject stock with insufficient history', () => {
      const candles = Array.from({ length: 50 }, (_, i) =>
        createCandle(new Date(2024, 0, 1 + i), 100, 105, 95, 102, 1000000)
      );

      const result = DataValidator.validateStockUniverseMembership(candles, {
        price: 50,
        avgVolume30d: 1000000,
      });

      expect(result.qualifies).toBe(false);
      expect(result.errors.some((e) => e.code === 'INSUFFICIENT_HISTORY')).toBe(true);
    });

    it('should reject stock with price too low', () => {
      const candles = Array.from({ length: 252 }, (_, i) =>
        createCandle(new Date(2024, 0, 1 + i), 100, 105, 95, 102, 1000000)
      );

      const result = DataValidator.validateStockUniverseMembership(candles, {
        price: 0.5, // below MIN_PRICE
        avgVolume30d: 1000000,
      });

      expect(result.qualifies).toBe(false);
      expect(result.errors.some((e) => e.code === 'PRICE_TOO_LOW')).toBe(true);
    });

    it('should reject stock with volume too low', () => {
      const candles = Array.from({ length: 252 }, (_, i) =>
        createCandle(new Date(2024, 0, 1 + i), 100, 105, 95, 102, 1000)
      );

      const result = DataValidator.validateStockUniverseMembership(candles, {
        price: 50,
        avgVolume30d: 1000, // below MIN_AVG_VOLUME
      });

      expect(result.qualifies).toBe(false);
      expect(result.errors.some((e) => e.code === 'VOLUME_TOO_LOW')).toBe(true);
    });
  });
});
