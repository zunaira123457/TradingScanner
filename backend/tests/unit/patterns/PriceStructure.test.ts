import {
  findSwingHighs,
  findSwingLows,
  classifyStructure,
  findResistance,
  findSupport,
  detectBreakout,
  detectBreakdown,
  detectConsolidation,
  detectGap,
  detectPullback,
  detectTrendContinuation,
} from '@/patterns/PriceStructure';
import { Candle } from '@/types';

let dayCounter = 0;
function makeCandle(high: number, low: number, close: number, open?: number): Candle {
  dayCounter++;
  return {
    timestamp: new Date(2024, 0, dayCounter),
    open: open ?? close,
    high,
    low,
    close,
    volume: 1000000,
  };
}

beforeEach(() => {
  dayCounter = 0;
});

describe('PriceStructure', () => {
  describe('findSwingHighs / findSwingLows', () => {
    it('should detect a single obvious swing high with lookback=2', () => {
      // index 2 (price 20) is strictly higher than 2 bars on each side
      const candles = [
        makeCandle(10, 8, 9),
        makeCandle(15, 12, 14),
        makeCandle(20, 18, 19), // swing high at index 2
        makeCandle(14, 11, 12),
        makeCandle(10, 8, 9),
      ];
      const swings = findSwingHighs(candles, 2);
      expect(swings.length).toBe(1);
      expect(swings[0].index).toBe(2);
      expect(swings[0].price).toBe(20);
    });

    it('should detect a single obvious swing low with lookback=2', () => {
      const candles = [
        makeCandle(20, 15, 18),
        makeCandle(15, 10, 12),
        makeCandle(10, 5, 8), // swing low at index 2
        makeCandle(15, 10, 12),
        makeCandle(20, 15, 18),
      ];
      const swings = findSwingLows(candles, 2);
      expect(swings.length).toBe(1);
      expect(swings[0].index).toBe(2);
      expect(swings[0].price).toBe(5);
    });

    it('should not confirm swings within `lookback` bars of the end of the array (no look-ahead)', () => {
      // A potential swing high at the very last index can never be confirmed
      // because there aren't enough future bars in this slice.
      const candles = [
        makeCandle(10, 8, 9),
        makeCandle(15, 12, 14),
        makeCandle(30, 28, 29), // would-be swing high, but at the edge
      ];
      const swings = findSwingHighs(candles, 2);
      expect(swings.length).toBe(0);
    });
  });

  describe('classifyStructure', () => {
    it('should classify uptrend when both swing highs and lows are rising', () => {
      const swingHighs = [
        { index: 0, date: new Date(), price: 100 },
        { index: 2, date: new Date(), price: 110 },
      ];
      const swingLows = [
        { index: 1, date: new Date(), price: 95 },
        { index: 3, date: new Date(), price: 102 },
      ];
      const result = classifyStructure(swingHighs, swingLows);
      expect(result.trend).toBe('uptrend');
      expect(result.higherHigh).toBe(true);
      expect(result.higherLow).toBe(true);
    });

    it('should classify downtrend when both swing highs and lows are falling', () => {
      const swingHighs = [
        { index: 0, date: new Date(), price: 110 },
        { index: 2, date: new Date(), price: 100 },
      ];
      const swingLows = [
        { index: 1, date: new Date(), price: 102 },
        { index: 3, date: new Date(), price: 95 },
      ];
      const result = classifyStructure(swingHighs, swingLows);
      expect(result.trend).toBe('downtrend');
      expect(result.lowerHigh).toBe(true);
      expect(result.lowerLow).toBe(true);
    });

    it('should classify sideways when signals are mixed', () => {
      const swingHighs = [
        { index: 0, date: new Date(), price: 100 },
        { index: 2, date: new Date(), price: 110 }, // higher high
      ];
      const swingLows = [
        { index: 1, date: new Date(), price: 95 },
        { index: 3, date: new Date(), price: 90 }, // lower low
      ];
      const result = classifyStructure(swingHighs, swingLows);
      expect(result.trend).toBe('sideways');
    });

    it('should return insufficient_data with fewer than 2 swings of either type', () => {
      const result = classifyStructure([{ index: 0, date: new Date(), price: 100 }], []);
      expect(result.trend).toBe('insufficient_data');
    });
  });

  describe('findResistance / findSupport', () => {
    it('should compute resistance as the max high excluding today', () => {
      const candles = [
        makeCandle(10, 8, 9),
        makeCandle(15, 12, 14), // highest high = 15
        makeCandle(12, 10, 11),
        makeCandle(20, 18, 19), // today — excluded from resistance calc
      ];
      const resistance = findResistance(candles, 20);
      expect(resistance).toBe(15);
    });

    it('should compute support as the min low excluding today', () => {
      const candles = [
        makeCandle(20, 15, 18),
        makeCandle(15, 8, 12), // lowest low = 8
        makeCandle(18, 12, 15),
        makeCandle(10, 5, 7), // today — excluded from support calc
      ];
      const support = findSupport(candles, 20);
      expect(support).toBe(8);
    });

    it('should return null with fewer than 2 candles', () => {
      expect(findResistance([makeCandle(10, 8, 9)], 20)).toBeNull();
    });
  });

  describe('detectBreakout', () => {
    it('should detect breakout when price and volume both confirm', () => {
      const candles = [
        makeCandle(15, 12, 14),
        makeCandle(15, 12, 13), // resistance = 15
        makeCandle(17, 15, 16.5), // today closes above resistance
      ];
      const result = detectBreakout(candles, 2.0, { lookbackDays: 20, volumeMultiplier: 1.5 });
      expect(result.detected).toBe(true);
      expect(result.resistance).toBe(15);
      expect(result.volumeConfirmation).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.invalidationPrice).toBeLessThan(15);
    });

    it('should NOT detect breakout when volume does not confirm', () => {
      const candles = [
        makeCandle(15, 12, 14),
        makeCandle(15, 12, 13),
        makeCandle(17, 15, 16.5),
      ];
      const result = detectBreakout(candles, 1.0, { lookbackDays: 20, volumeMultiplier: 1.5 });
      expect(result.detected).toBe(false);
      expect(result.confidence).toBe(0);
    });

    it('should NOT detect breakout when price has not exceeded resistance', () => {
      const candles = [makeCandle(15, 12, 14), makeCandle(15, 12, 13), makeCandle(14, 12, 13)];
      const result = detectBreakout(candles, 3.0, { lookbackDays: 20 });
      expect(result.detected).toBe(false);
    });
  });

  describe('detectBreakdown', () => {
    it('should detect breakdown when price and volume both confirm', () => {
      const candles = [
        makeCandle(15, 10, 13),
        makeCandle(14, 10, 12), // support = 10
        makeCandle(9, 7, 8), // today closes below support
      ];
      const result = detectBreakdown(candles, 2.0, { lookbackDays: 20, volumeMultiplier: 1.5 });
      expect(result.detected).toBe(true);
      expect(result.support).toBe(10);
      expect(result.invalidationPrice).toBeGreaterThan(10);
    });
  });

  describe('detectConsolidation', () => {
    it('should detect consolidation with a tight range', () => {
      const candles = Array.from({ length: 20 }, () => makeCandle(101, 99, 100));
      const result = detectConsolidation(candles, { lookbackDays: 20, maxRangePct: 0.08 });
      expect(result.detected).toBe(true);
      // rangePct = (101-99)/100 = 0.02; confidence = 1 - 0.02/0.08 = 0.75
      expect(result.confidence).toBeCloseTo(0.75, 8);
    });

    it('should NOT detect consolidation with a wide range', () => {
      const candles = [
        ...Array.from({ length: 10 }, () => makeCandle(101, 99, 100)),
        ...Array.from({ length: 10 }, () => makeCandle(150, 70, 110)),
      ];
      const result = detectConsolidation(candles, { lookbackDays: 20, maxRangePct: 0.08 });
      expect(result.detected).toBe(false);
    });
  });

  describe('detectGap', () => {
    it('should detect a gap up above threshold', () => {
      const candles = [makeCandle(10, 9, 10), makeCandle(11, 10.4, 10.5, 10.5)];
      const result = detectGap(candles, { thresholdPct: 0.02 });
      expect(result.type).toBe('gap_up');
      expect(result.gapPct).toBeCloseTo(0.05, 8);
    });

    it('should detect a gap down below threshold', () => {
      const candles = [makeCandle(10, 9, 10), makeCandle(9.6, 9, 9.2, 9.5)];
      const result = detectGap(candles, { thresholdPct: 0.02 });
      expect(result.type).toBe('gap_down');
    });

    it('should report none when the gap is within threshold', () => {
      const candles = [makeCandle(10, 9, 10), makeCandle(10.1, 9.9, 10, 10.05)];
      const result = detectGap(candles, { thresholdPct: 0.02 });
      expect(result.type).toBe('none');
    });
  });

  describe('detectPullback', () => {
    it('should detect a healthy pullback to EMA21 in an uptrend', () => {
      const candles = [makeCandle(105, 95, 100), makeCandle(102, 98, 100.3)];
      const structure = {
        trend: 'uptrend' as const,
        lastSwingHigh: { index: 0, date: new Date(), price: 110 },
        lastSwingLow: { index: 0, date: new Date(), price: 95 },
        higherHigh: true,
        higherLow: true,
        lowerHigh: false,
        lowerLow: false,
      };
      const result = detectPullback(candles, 100, 90, structure, { maxDistancePct: 0.02 });
      expect(result.detected).toBe(true);
      expect(result.pullbackToLevel).toBe('ema21');
    });

    it('should NOT detect a pullback when structure is broken (below last swing low)', () => {
      const candles = [makeCandle(105, 95, 100), makeCandle(96, 90, 92)];
      const structure = {
        trend: 'uptrend' as const,
        lastSwingHigh: { index: 0, date: new Date(), price: 110 },
        lastSwingLow: { index: 0, date: new Date(), price: 95 },
        higherHigh: true,
        higherLow: true,
        lowerHigh: false,
        lowerLow: false,
      };
      const result = detectPullback(candles, 92, 90, structure, { maxDistancePct: 0.05 });
      expect(result.detected).toBe(false);
    });

    it('should NOT detect a pullback when trend is not an uptrend', () => {
      const candles = [makeCandle(105, 95, 100)];
      const structure = {
        trend: 'downtrend' as const,
        lastSwingHigh: null,
        lastSwingLow: null,
        higherHigh: false,
        higherLow: false,
        lowerHigh: true,
        lowerLow: true,
      };
      const result = detectPullback(candles, 100, 100, structure);
      expect(result.detected).toBe(false);
      expect(result.trendIntact).toBe(false);
    });
  });

  describe('detectTrendContinuation', () => {
    it('should return true when uptrend and price above last swing low', () => {
      const candles = [makeCandle(105, 95, 102)];
      const structure = {
        trend: 'uptrend' as const,
        lastSwingHigh: null,
        lastSwingLow: { index: 0, date: new Date(), price: 95 },
        higherHigh: true,
        higherLow: true,
        lowerHigh: false,
        lowerLow: false,
      };
      expect(detectTrendContinuation(structure, candles)).toBe(true);
    });

    it('should return false when uptrend but price broke below last swing low', () => {
      const candles = [makeCandle(95, 85, 90)];
      const structure = {
        trend: 'uptrend' as const,
        lastSwingHigh: null,
        lastSwingLow: { index: 0, date: new Date(), price: 95 },
        higherHigh: true,
        higherLow: true,
        lowerHigh: false,
        lowerLow: false,
      };
      expect(detectTrendContinuation(structure, candles)).toBe(false);
    });
  });
});
