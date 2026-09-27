import {
  aggregateToWeekly,
  determineTrend,
  computeAlignment,
  analyzeMultiTimeframe,
} from '@/analysis/MultiTimeframe';
import { Candle } from '@/types';

function c(date: Date, open: number, high: number, low: number, close: number, volume = 1000): Candle {
  return { timestamp: date, open, high, low, close, volume };
}

describe('MultiTimeframe', () => {
  describe('aggregateToWeekly', () => {
    it('should group daily candles into Monday-anchored weeks with correct OHLCV', () => {
      // Mon 1/1/2024 .. Fri 1/5/2024 = one full week
      const candles = [
        c(new Date(2024, 0, 1), 100, 105, 98, 102, 1000), // Mon
        c(new Date(2024, 0, 2), 102, 108, 101, 106, 1200), // Tue
        c(new Date(2024, 0, 3), 106, 110, 104, 108, 1100), // Wed
        c(new Date(2024, 0, 4), 108, 109, 103, 105, 900), // Thu
        c(new Date(2024, 0, 5), 105, 112, 104, 111, 1300), // Fri
        // next week
        c(new Date(2024, 0, 8), 111, 115, 109, 113, 1000), // Mon
      ];

      const weekly = aggregateToWeekly(candles);

      expect(weekly.length).toBe(2);
      // Week 1: open=first day's open, close=last day's close, high=max, low=min, volume=sum
      expect(weekly[0].open).toBe(100);
      expect(weekly[0].close).toBe(111);
      expect(weekly[0].high).toBe(112);
      expect(weekly[0].low).toBe(98);
      expect(weekly[0].volume).toBe(1000 + 1200 + 1100 + 900 + 1300);

      // Week 2: partial (just Monday)
      expect(weekly[1].open).toBe(111);
      expect(weekly[1].close).toBe(113);
    });
  });

  describe('determineTrend', () => {
    it('should be bullish when close > sma50 > sma200', () => {
      const result = determineTrend([110], [100], [90]);
      expect(result).toBe('bullish');
    });

    it('should be bearish when close < sma50 < sma200', () => {
      const result = determineTrend([80], [90], [100]);
      expect(result).toBe('bearish');
    });

    it('should be neutral when signals conflict', () => {
      const result = determineTrend([95], [100], [90]); // close < sma50 but sma50 > sma200
      expect(result).toBe('neutral');
    });

    it('should fall back to close-vs-sma50 when sma200 is unavailable', () => {
      expect(determineTrend([110], [100], [null])).toBe('bullish');
      expect(determineTrend([90], [100], [null])).toBe('bearish');
    });

    it('should be neutral when sma50 itself is unavailable', () => {
      expect(determineTrend([110], [null], [null])).toBe('neutral');
    });
  });

  describe('computeAlignment', () => {
    it('should score full alignment when both trends agree and are directional', () => {
      expect(computeAlignment('bullish', 'bullish')).toEqual({ aligned: true, alignmentScore: 1.0 });
      expect(computeAlignment('bearish', 'bearish')).toEqual({ aligned: true, alignmentScore: 1.0 });
    });

    it('should score partial when either trend is neutral', () => {
      expect(computeAlignment('bullish', 'neutral')).toEqual({ aligned: false, alignmentScore: 0.5 });
      expect(computeAlignment('neutral', 'bearish')).toEqual({ aligned: false, alignmentScore: 0.5 });
    });

    it('should score zero when trends directly conflict', () => {
      expect(computeAlignment('bullish', 'bearish')).toEqual({ aligned: false, alignmentScore: 0.0 });
    });
  });

  describe('analyzeMultiTimeframe', () => {
    it('should report bullish alignment on a sustained uptrend', () => {
      // 300 trading days of a steady uptrend -> both daily and weekly should be bullish
      const candles: Candle[] = [];
      let price = 100;
      const start = new Date(2020, 0, 1);
      for (let i = 0; i < 300; i++) {
        price += 0.5;
        const date = new Date(start);
        date.setDate(date.getDate() + Math.floor((i / 5) * 7) + (i % 5)); // skip weekends roughly
        candles.push(c(date, price - 0.2, price + 1, price - 1, price, 1000000));
      }

      const result = analyzeMultiTimeframe(candles);
      expect(result.dailyTrend).toBe('bullish');
      expect(result.weeklyTrend).toBe('bullish');
      expect(result.aligned).toBe(true);
      expect(result.alignmentScore).toBe(1.0);
    });

    it('should report bearish alignment on a sustained downtrend', () => {
      const candles: Candle[] = [];
      let price = 300;
      const start = new Date(2020, 0, 1);
      for (let i = 0; i < 300; i++) {
        price -= 0.5;
        const date = new Date(start);
        date.setDate(date.getDate() + Math.floor((i / 5) * 7) + (i % 5));
        candles.push(c(date, price + 0.2, price + 1, price - 1, price, 1000000));
      }

      const result = analyzeMultiTimeframe(candles);
      expect(result.dailyTrend).toBe('bearish');
      expect(result.weeklyTrend).toBe('bearish');
      expect(result.aligned).toBe(true);
    });
  });
});
