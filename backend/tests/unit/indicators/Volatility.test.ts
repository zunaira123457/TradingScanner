import { atr, bollingerBands, historicalVolatility } from '@/indicators/Volatility';
import { Candle } from '@/types';

const c = (h: number, l: number, close: number): Candle => ({
  timestamp: new Date(),
  open: close,
  high: h,
  low: l,
  close,
  volume: 1000,
});

describe('Volatility', () => {
  describe('atr', () => {
    it('should compute Wilder ATR correctly (hand-verified)', () => {
      // TR0 = 10-8 = 2
      // TR1 = max(11-9, |11-9|, |9-9|) = 2
      // TR2 = max(12-10, |12-10|, |10-10|) = 2
      // TR3 = max(9-7, |9-11|, |7-11|) = max(2,2,4) = 4
      // TR4 = max(10-8, |10-8|, |8-8|) = 2
      // period=3: seed = (TR0+TR1+TR2)/3 = 2 at index 2
      // i=3: (2*2+4)/3 = 8/3 = 2.6667
      // i=4: (2.6667*2+2)/3 = 7.3333/3 = 2.4444
      const candles = [c(10, 8, 9), c(11, 9, 10), c(12, 10, 11), c(9, 7, 8), c(10, 8, 9)];
      const result = atr(candles, 3);

      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeCloseTo(2, 8);
      expect(result[3]).toBeCloseTo(8 / 3, 8);
      expect(result[4]).toBeCloseTo(2.44444444, 6);
    });

    it('should return all nulls when insufficient data', () => {
      const candles = [c(10, 8, 9), c(11, 9, 10)];
      const result = atr(candles, 14);
      expect(result.every((v) => v === null)).toBe(true);
    });
  });

  describe('bollingerBands', () => {
    it('should match an independent naive recomputation', () => {
      const closes = [10, 12, 14, 12, 10, 15, 20, 18, 16, 14];
      const period = 3;
      const mult = 2;

      const { upper, middle, lower, width } = bollingerBands(closes, period, mult);

      for (let i = period - 1; i < closes.length; i++) {
        const window = closes.slice(i - period + 1, i + 1);
        const mean = window.reduce((a, b) => a + b, 0) / period;
        const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
        const stdDev = Math.sqrt(variance);

        expect(middle[i]).toBeCloseTo(mean, 8);
        expect(upper[i]).toBeCloseTo(mean + mult * stdDev, 8);
        expect(lower[i]).toBeCloseTo(mean - mult * stdDev, 8);
        expect(width[i]).toBeCloseTo((mean + mult * stdDev - (mean - mult * stdDev)) / mean, 8);
      }

      expect(upper[0]).toBeNull();
      expect(upper[period - 2]).toBeNull();
    });

    it('should produce wider bands during higher volatility', () => {
      const flat = [10, 10, 10, 10, 10];
      const volatile = [10, 15, 5, 15, 5];

      const flatResult = bollingerBands(flat, 5, 2);
      const volatileResult = bollingerBands(volatile, 5, 2);

      const flatWidth = (flatResult.upper[4] as number) - (flatResult.lower[4] as number);
      const volatileWidth = (volatileResult.upper[4] as number) - (volatileResult.lower[4] as number);

      expect(volatileWidth).toBeGreaterThan(flatWidth);
    });
  });

  describe('historicalVolatility', () => {
    it('should match an independent naive recomputation', () => {
      const closes = [100, 102, 101, 105, 103, 108, 107, 110, 112, 109, 115];
      const period = 5;

      const result = historicalVolatility(closes, period, 252);

      const logReturns: number[] = [];
      for (let i = 1; i < closes.length; i++) {
        logReturns.push(Math.log(closes[i] / closes[i - 1]));
      }

      for (let i = period; i < closes.length; i++) {
        // logReturns index j corresponds to closes index j+1
        const windowStart = i - period; // logReturns index for closes[i-period+1]
        const window = logReturns.slice(windowStart, windowStart + period);
        const mean = window.reduce((a, b) => a + b, 0) / period;
        const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / (period - 1);
        const expected = Math.sqrt(variance) * Math.sqrt(252);

        expect(result[i]).toBeCloseTo(expected, 8);
      }
    });

    it('should return higher volatility for choppier price action', () => {
      const smooth = [100, 101, 102, 103, 104, 105, 106];
      const choppy = [100, 110, 95, 115, 90, 120, 85];

      const smoothVol = historicalVolatility(smooth, 6, 252);
      const choppyVol = historicalVolatility(choppy, 6, 252);

      expect(choppyVol[6] as number).toBeGreaterThan(smoothVol[6] as number);
    });
  });
});
