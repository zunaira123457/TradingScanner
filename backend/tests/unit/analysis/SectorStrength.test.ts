import { calculateRelativeStrength } from '@/analysis/SectorStrength';
import { Candle } from '@/types';

function makeCandlesWithReturn(days: number, startPrice: number, totalReturn: number): Candle[] {
  const candles: Candle[] = [];
  const endPrice = startPrice * (1 + totalReturn);
  const dailyGrowth = Math.pow(endPrice / startPrice, 1 / days);
  let price = startPrice;
  for (let i = 0; i <= days; i++) {
    candles.push({
      timestamp: new Date(2024, 0, 1 + i),
      open: price,
      high: price * 1.01,
      low: price * 0.99,
      close: price,
      volume: 1000000,
    });
    price *= dailyGrowth;
  }
  return candles;
}

describe('SectorStrength', () => {
  describe('calculateRelativeStrength', () => {
    it('should give the maximum bonus when outperforming both sector and benchmark', () => {
      const stock = makeCandlesWithReturn(63, 100, 0.2); // +20%
      const sector = makeCandlesWithReturn(63, 100, 0.1); // +10%
      const benchmark = makeCandlesWithReturn(63, 100, 0.05); // +5%

      const result = calculateRelativeStrength(stock, benchmark, sector, 63);

      expect(result.stockReturn).toBeCloseTo(0.2, 4);
      expect(result.outperformingBoth).toBe(true);
      expect(result.scoreAdjustment).toBe(0.15);
      expect(result.vsBenchmark).toBeGreaterThan(0);
      expect(result.vsSector).toBeGreaterThan(0);
    });

    it('should give a smaller bonus when outperforming benchmark but not sector', () => {
      const stock = makeCandlesWithReturn(63, 100, 0.08); // +8%
      const sector = makeCandlesWithReturn(63, 100, 0.15); // +15% (stock lags sector)
      const benchmark = makeCandlesWithReturn(63, 100, 0.05); // +5%

      const result = calculateRelativeStrength(stock, benchmark, sector, 63);

      expect(result.outperformingBoth).toBe(false);
      expect(result.scoreAdjustment).toBe(0.05);
    });

    it('should give a penalty when underperforming both', () => {
      const stock = makeCandlesWithReturn(63, 100, -0.05); // -5%
      const sector = makeCandlesWithReturn(63, 100, 0.02); // +2%
      const benchmark = makeCandlesWithReturn(63, 100, 0.03); // +3%

      const result = calculateRelativeStrength(stock, benchmark, sector, 63);

      expect(result.outperformingBoth).toBe(false);
      expect(result.scoreAdjustment).toBe(-0.1);
    });

    it('should handle a null sector gracefully (benchmark-only comparison)', () => {
      const stock = makeCandlesWithReturn(63, 100, 0.1);
      const benchmark = makeCandlesWithReturn(63, 100, 0.03);

      const result = calculateRelativeStrength(stock, benchmark, null, 63);

      expect(result.sectorReturn).toBeNull();
      expect(result.vsSector).toBeNull();
      expect(result.scoreAdjustment).toBe(0.05); // outperforms benchmark, no sector data
    });

    it('should return 0 for a return series with insufficient history', () => {
      const shortStock = makeCandlesWithReturn(10, 100, 0.1); // only 11 candles, need 64
      const benchmark = makeCandlesWithReturn(63, 100, 0.03);

      const result = calculateRelativeStrength(shortStock, benchmark, null, 63);
      expect(result.stockReturn).toBe(0);
    });
  });
});
