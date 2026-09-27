import {
  detectBreakoutFromConsolidation,
  detectBreakoutWithVolumeConfirmation,
  detectPullbackToEma21,
  detectPullbackToSma50,
  detectMovingAverageReclaim,
  detectMovingAverageRejection,
  detectBullFlag,
  detectBearFlag,
  detectDoubleBottom,
  detectDoubleTop,
  detectHigherLowReversal,
  detectVolatilityContraction,
  detectSupportBounce,
  detectResistanceRejection,
} from '@/patterns/ChartPatterns';
import { Candle } from '@/types';
import { StructureAnalysis } from '@/types/patterns';

let dayCounter = 0;
function c(high: number, low: number, close: number, open?: number, volume = 1000000): Candle {
  dayCounter++;
  return { timestamp: new Date(2024, 0, dayCounter), open: open ?? close, high, low, close, volume };
}
function flat(price: number): Candle {
  return c(price, price, price);
}

beforeEach(() => {
  dayCounter = 0;
});

describe('ChartPatterns', () => {
  describe('detectBreakoutFromConsolidation', () => {
    it('should detect when a tight range is followed by a volume-confirmed breakout', () => {
      const prior = Array.from({ length: 16 }, () => c(101, 99, 100));
      const today = c(107, 100, 106); // breaks above resistance (101) with room to spare
      const candles = [...prior, today];
      const result = detectBreakoutFromConsolidation(candles, 2.0, {
        consolidationLookback: 15,
        maxRangePct: 0.08,
        volumeMultiplier: 1.5,
      });
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it('should NOT detect when there was no prior consolidation', () => {
      const prior = [
        ...Array.from({ length: 8 }, () => c(101, 99, 100)),
        ...Array.from({ length: 8 }, () => c(150, 70, 110)),
      ];
      const today = c(160, 150, 155);
      const candles = [...prior, today];
      const result = detectBreakoutFromConsolidation(candles, 2.0);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectBreakoutWithVolumeConfirmation', () => {
    it('should require a stricter volume threshold than a plain breakout', () => {
      const candles = [c(101, 99, 100), c(101, 99, 100), c(107, 101, 106)];
      const weak = detectBreakoutWithVolumeConfirmation(candles, 1.6); // below default 2.0
      const strong = detectBreakoutWithVolumeConfirmation(candles, 2.5);
      expect(weak.detected).toBe(false);
      expect(strong.detected).toBe(true);
    });
  });

  const uptrendStructure: StructureAnalysis = {
    trend: 'uptrend',
    lastSwingHigh: { index: 0, date: new Date(), price: 110 },
    lastSwingLow: { index: 0, date: new Date(), price: 95 },
    higherHigh: true,
    higherLow: true,
    lowerHigh: false,
    lowerLow: false,
  };

  describe('detectPullbackToEma21 / detectPullbackToSma50', () => {
    it('should attribute the pullback to EMA21 when close is near it (checked first)', () => {
      const candles = [c(105, 95, 100), c(102, 98, 100.3)];
      const result = detectPullbackToEma21(candles, 100, uptrendStructure, { maxDistancePct: 0.02 });
      expect(result.detected).toBe(true);
    });

    it('should attribute the pullback to SMA50 when EMA21 is not close but SMA50 is', () => {
      const candles = [c(105, 95, 100), c(102, 98, 100.3)];
      // sma50=100.3 is where price actually is; ema21 far away so first fn wouldn't detect
      const emaResult = detectPullbackToEma21(candles, 130, uptrendStructure, { maxDistancePct: 0.02 });
      const smaResult = detectPullbackToSma50(candles, 100.3, uptrendStructure, { maxDistancePct: 0.02 });
      expect(emaResult.detected).toBe(false);
      expect(smaResult.detected).toBe(true);
    });
  });

  describe('detectMovingAverageReclaim', () => {
    it('should detect when close moves from below to above the MA', () => {
      const candles = [c(101, 97, 98), c(104, 99, 103)];
      const maValues = [100, 100];
      const result = detectMovingAverageReclaim(candles, maValues);
      expect(result.detected).toBe(true);
      expect(result.invalidationPrice).toBe(100);
    });

    it('should NOT detect when close was already above the MA', () => {
      const candles = [c(105, 101, 103), c(106, 102, 104)];
      const maValues = [100, 100];
      const result = detectMovingAverageReclaim(candles, maValues);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectMovingAverageRejection', () => {
    it('should detect when price tests the MA intraday but closes below it', () => {
      const candles = [c(103, 97, 98, 98)]; // high=103 > ma=100, close=98 < ma
      const maValues = [100];
      const result = detectMovingAverageRejection(candles, maValues);
      expect(result.detected).toBe(true);
      expect(result.invalidationPrice).toBe(103);
    });

    it('should NOT detect when price never traded above the MA', () => {
      const candles = [c(99, 95, 97)];
      const maValues = [100];
      const result = detectMovingAverageRejection(candles, maValues);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectBullFlag', () => {
    it('should detect a strong impulse followed by a tight, low-volume flag', () => {
      const impulse = [
        c(102, 98, 100, undefined, 1000000),
        c(105, 100, 103, undefined, 1000000),
        c(108, 103, 106, undefined, 1000000),
        c(111, 106, 109, undefined, 1000000),
        c(114, 109, 112, undefined, 1000000),
        c(117, 112, 115, undefined, 1000000),
        c(120, 115, 118, undefined, 1000000),
        c(123, 118, 121, undefined, 1000000),
        c(126, 121, 124, undefined, 1000000),
        c(129, 124, 127, undefined, 1000000),
      ];
      const flagCandles = [
        c(126, 123, 124, undefined, 500000),
        c(125, 122, 123.5, undefined, 480000),
        c(124, 121, 122.5, undefined, 450000),
        c(125, 122, 123, undefined, 470000),
        c(124, 121, 122.8, undefined, 430000),
      ];
      const result = detectBullFlag([...impulse, ...flagCandles]);
      expect(result.detected).toBe(true);
      expect(result.invalidationPrice).toBe(121);
    });

    it('should NOT detect when the flag range is too wide', () => {
      const impulse = Array.from({ length: 10 }, (_, i) =>
        c(102 + i * 3, 98 + i * 3, 100 + i * 3, undefined, 1000000)
      );
      const wideFlag = [
        c(126, 90, 110, undefined, 500000),
        c(120, 85, 105, undefined, 480000),
        c(125, 88, 108, undefined, 450000),
        c(122, 92, 106, undefined, 470000),
        c(124, 89, 107, undefined, 430000),
      ];
      const result = detectBullFlag([...impulse, ...wideFlag]);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectBearFlag', () => {
    it('should detect a strong downward impulse followed by a tight, low-volume flag', () => {
      const impulse = [
        c(130, 126, 128, undefined, 1000000),
        c(127, 122, 124, undefined, 1000000),
        c(124, 118, 120, undefined, 1000000),
        c(120, 114, 116, undefined, 1000000),
        c(117, 110, 112, undefined, 1000000),
        c(113, 106, 108, undefined, 1000000),
        c(110, 102, 104, undefined, 1000000),
        c(106, 98, 100, undefined, 1000000),
        c(103, 94, 96, undefined, 1000000),
        c(100, 90, 92, undefined, 1000000),
      ];
      const flagCandles = [
        c(95, 91, 92, undefined, 500000),
        c(94, 90, 91, undefined, 480000),
        c(96, 92, 93, undefined, 460000),
        c(95, 91, 92.5, undefined, 470000),
        c(94, 90, 91.5, undefined, 440000),
      ];
      const result = detectBearFlag([...impulse, ...flagCandles]);
      expect(result.detected).toBe(true);
      expect(result.invalidationPrice).toBe(96);
    });
  });

  describe('detectDoubleBottom', () => {
    it('should detect a confirmed W-shape with neckline break', () => {
      const prices = [
        130, 122, 114, 106, 101, 98, 102, 107, 111, 113, 110, 105, 100, 97.5, 101, 105, 109, 112,
        115, 118,
      ];
      const candles = prices.map((p) => flat(p));
      const result = detectDoubleBottom(candles, {
        lookbackBars: 60,
        swingLookback: 3,
        maxDeviationPct: 0.03,
        minPeakPct: 0.05,
      });
      expect(result.detected).toBe(true);
      expect(result.details.necklineBroken).toBe(true);
    });

    it('should NOT detect when the neckline has not been broken', () => {
      const prices = [
        130, 122, 114, 106, 101, 98, 102, 107, 111, 113, 110, 105, 100, 97.5, 101, 103, 105, 107,
        108, 109,
      ];
      const candles = prices.map((p) => flat(p));
      const result = detectDoubleBottom(candles);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectDoubleTop', () => {
    it('should detect a confirmed M-shape with neckline break', () => {
      const prices = [
        70, 78, 86, 94, 99, 102, 98, 93, 89, 87, 90, 95, 100, 101.5, 98, 94, 90, 87, 84, 81,
      ];
      const candles = prices.map((p) => flat(p));
      const result = detectDoubleTop(candles, {
        lookbackBars: 60,
        swingLookback: 3,
        maxDeviationPct: 0.03,
        minPeakPct: 0.05,
      });
      expect(result.detected).toBe(true);
      expect(result.details.necklineBroken).toBe(true);
    });
  });

  describe('detectHigherLowReversal', () => {
    it('should detect the first higher low after a sequence of lower lows', () => {
      const prices = [
        150, 140, 130, 122, 126, 132, 138, 130, 121, 112, 117, 123, 129, 120, 115, 119, 124, 128,
        132, 136,
      ];
      const candles = prices.map((p) => flat(p));
      const result = detectHigherLowReversal(candles, { lookbackBars: 60, swingLookback: 3 });
      expect(result.detected).toBe(true);
      expect(result.invalidationPrice).toBeCloseTo(112, 8);
    });

    it('should NOT detect when the low sequence keeps falling', () => {
      const prices = [
        150, 140, 130, 122, 126, 132, 138, 130, 121, 112, 117, 123, 129, 118, 105, 109, 114, 118,
        122, 126,
      ];
      const candles = prices.map((p) => flat(p));
      const result = detectHigherLowReversal(candles);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectVolatilityContraction', () => {
    it('should detect when current band width is near the bottom of its recent range', () => {
      const widths: (number | null)[] = [
        null,
        null,
        0.15,
        0.14,
        0.13,
        0.12,
        0.11,
        0.1,
        0.09,
        0.08,
        0.07,
        0.06,
        0.05,
        0.04,
        0.02,
      ];
      const result = detectVolatilityContraction(widths, { lookbackBars: 60, percentileThreshold: 0.25 });
      expect(result.detected).toBe(true);
      expect(result.confidence).toBeCloseTo(1, 8);
    });

    it('should NOT detect when current band width is at the high end of its range', () => {
      const widths: (number | null)[] = [
        null,
        null,
        0.02,
        0.04,
        0.05,
        0.06,
        0.07,
        0.08,
        0.09,
        0.1,
        0.11,
        0.12,
        0.13,
        0.14,
        0.15,
      ];
      const result = detectVolatilityContraction(widths);
      expect(result.detected).toBe(false);
    });
  });

  describe('detectSupportBounce', () => {
    it('should detect a bullish rejection at support', () => {
      const prior = Array.from({ length: 20 }, () => c(105, 95, 100));
      const today = c(99, 95.5, 98, 96); // low near support(95), closes above it, bullish
      const result = detectSupportBounce([...prior, today], { lookbackDays: 20, proximityPct: 0.015 });
      expect(result.detected).toBe(true);
    });

    it('should NOT detect when the candle closes bearish', () => {
      const prior = Array.from({ length: 20 }, () => c(105, 95, 100));
      const today = c(99, 95.5, 96, 98); // close < open (bearish)
      const result = detectSupportBounce([...prior, today], { lookbackDays: 20, proximityPct: 0.015 });
      expect(result.detected).toBe(false);
    });
  });

  describe('detectResistanceRejection', () => {
    it('should detect a bearish rejection at resistance', () => {
      const prior = Array.from({ length: 20 }, () => c(105, 95, 100));
      const today = c(104.5, 101, 102, 104); // high near resistance(105), closes below, bearish
      const result = detectResistanceRejection([...prior, today], { lookbackDays: 20, proximityPct: 0.015 });
      expect(result.detected).toBe(true);
    });

    it('should NOT detect when the candle closes bullish', () => {
      const prior = Array.from({ length: 20 }, () => c(105, 95, 100));
      const today = c(104.5, 101, 104, 102); // close > open (bullish)
      const result = detectResistanceRejection([...prior, today], { lookbackDays: 20, proximityPct: 0.015 });
      expect(result.detected).toBe(false);
    });
  });
});
