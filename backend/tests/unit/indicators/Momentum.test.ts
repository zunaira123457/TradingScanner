import { rsi, macd, stochastic, roc, adx } from '@/indicators/Momentum';
import { Candle } from '@/types';

const c = (h: number, l: number, close: number, open?: number, volume = 1000): Candle => ({
  timestamp: new Date(),
  open: open ?? close,
  high: h,
  low: l,
  close,
  volume,
});

describe('Momentum', () => {
  describe('rsi', () => {
    it('should return 100 for a strictly increasing series (no losses)', () => {
      const closes = Array.from({ length: 15 }, (_, i) => 100 + i);
      const result = rsi(closes, 14);
      expect(result[14]).toBeCloseTo(100, 10);
    });

    it('should return 0 for a strictly decreasing series (no gains)', () => {
      const closes = Array.from({ length: 15 }, (_, i) => 100 - i);
      const result = rsi(closes, 14);
      expect(result[14]).toBeCloseTo(0, 10);
    });

    it('should return 50 for a perfectly alternating series (equal gains/losses)', () => {
      // 15 closes alternating 10,11,10,11,... -> 7 gains of 1, 7 losses of 1
      const closes = Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 10 : 11));
      const result = rsi(closes, 14);
      expect(result[14]).toBeCloseTo(50, 10);
    });

    it('should be null before the warm-up period', () => {
      const closes = Array.from({ length: 10 }, (_, i) => 100 + i);
      const result = rsi(closes, 14);
      expect(result.every((v) => v === null)).toBe(true);
    });
  });

  describe('macd', () => {
    it('should compute macd/signal/histogram correctly on a linear ramp', () => {
      // closes = 1..10, fast=2, slow=3, signal=2
      // Hand-derived: ema2 = [.,1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5,9.5]
      //               ema3 = [.,.,2,3,4,5,6,7,8,9]
      // macdLine[2..9] = 0.5 constant -> signal (EMA2 of constant 0.5) = 0.5
      // histogram = 0 once signal is defined (from index 3)
      const closes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const { macdLine, signalLine, histogram } = macd(closes, 2, 3, 2);

      expect(macdLine[0]).toBeNull();
      expect(macdLine[1]).toBeNull();
      for (let i = 2; i <= 9; i++) {
        expect(macdLine[i]).toBeCloseTo(0.5, 8);
      }

      expect(signalLine[2]).toBeNull();
      for (let i = 3; i <= 9; i++) {
        expect(signalLine[i]).toBeCloseTo(0.5, 8);
        expect(histogram[i]).toBeCloseTo(0, 8);
      }
    });
  });

  describe('stochastic', () => {
    it('should compute %K and %D correctly', () => {
      const candles = [
        c(10, 8, 9),
        c(12, 9, 11),
        c(13, 10, 12),
        c(11, 9, 10),
        c(14, 11, 13),
      ];
      // kPeriod=3, smoothK=1 (raw), dPeriod=2
      // i=2: window[c0,c1,c2] HH=13 LL=8 range=5 %K=(12-8)/5*100=80
      // i=3: window[c1,c2,c3] HH=13 LL=9 range=4 %K=(10-9)/4*100=25
      // i=4: window[c2,c3,c4] HH=14 LL=9 range=5 %K=(13-9)/5*100=80
      // d[3] = avg(80,25) = 52.5 ; d[4] = avg(25,80) = 52.5
      const { k, d } = stochastic(candles, 3, 2, 1);

      expect(k[2]).toBeCloseTo(80, 8);
      expect(k[3]).toBeCloseTo(25, 8);
      expect(k[4]).toBeCloseTo(80, 8);

      expect(d[2]).toBeNull();
      expect(d[3]).toBeCloseTo(52.5, 8);
      expect(d[4]).toBeCloseTo(52.5, 8);
    });

    it('should handle zero range (high == low) without dividing by zero', () => {
      const candles = [c(10, 10, 10), c(10, 10, 10), c(10, 10, 10)];
      const { k } = stochastic(candles, 3, 2, 1);
      expect(k[2]).toBe(50);
      expect(Number.isFinite(k[2])).toBe(true);
    });
  });

  describe('roc', () => {
    it('should compute rate of change correctly', () => {
      const closes = [100, 105, 110, 90, 95];
      const result = roc(closes, 2);

      expect(result[0]).toBeNull();
      expect(result[1]).toBeNull();
      expect(result[2]).toBeCloseTo(10, 8); // (110-100)/100*100
      expect(result[3]).toBeCloseTo(-14.285714, 5); // (90-105)/105*100
      expect(result[4]).toBeCloseTo(-13.636364, 5); // (95-110)/110*100
    });
  });

  describe('adx', () => {
    function makeTrendingCandles(n: number, direction: 'up' | 'down'): Candle[] {
      const candles: Candle[] = [];
      let base = 100;
      for (let i = 0; i < n; i++) {
        const step = direction === 'up' ? i * 0.5 : -i * 0.5;
        const high = base + step + 2;
        const low = base + step - 2;
        const close = base + step;
        candles.push(c(high, low, close));
      }
      return candles;
    }

    it('should return null for all values when insufficient data', () => {
      const candles = makeTrendingCandles(20, 'up'); // needs 2*14+1=29
      const { adx: adxArr } = adx(candles, 14);
      expect(adxArr.every((v) => v === null)).toBe(true);
    });

    it('should show +DI > -DI in a clear uptrend', () => {
      const candles = makeTrendingCandles(40, 'up');
      const { plusDI, minusDI, adx: adxArr } = adx(candles, 14);

      const lastIdx = candles.length - 1;
      expect(plusDI[lastIdx]).not.toBeNull();
      expect(minusDI[lastIdx]).not.toBeNull();
      expect(plusDI[lastIdx] as number).toBeGreaterThan(minusDI[lastIdx] as number);

      // All non-null ADX values must be within [0, 100]
      adxArr.forEach((v) => {
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      });
    });

    it('should show -DI > +DI in a clear downtrend', () => {
      const candles = makeTrendingCandles(40, 'down');
      const { plusDI, minusDI } = adx(candles, 14);

      const lastIdx = candles.length - 1;
      expect(minusDI[lastIdx] as number).toBeGreaterThan(plusDI[lastIdx] as number);
    });
  });
});
