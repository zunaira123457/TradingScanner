import { vwap, tradingDayKey } from '@/indicators/VWAP';
import { Candle } from '@/types';

function bar(timestamp: Date, high: number, low: number, close: number, volume: number): Candle {
  return { timestamp, open: close, high, low, close, volume };
}

describe('VWAP', () => {
  describe('tradingDayKey', () => {
    it('should group timestamps by their NYSE (America/New_York) calendar day', () => {
      // 2024-01-17 14:30 UTC = 09:30 ET (EST, UTC-5) on 2024-01-17
      const morning = new Date('2024-01-17T14:30:00.000Z');
      // 2024-01-18 03:00 UTC = 22:00 ET on 2024-01-17 (still the same trading day)
      const lateNightSameEtDay = new Date('2024-01-18T03:00:00.000Z');
      // 2024-01-18 14:30 UTC = 09:30 ET on 2024-01-18 (a new trading day)
      const nextMorning = new Date('2024-01-18T14:30:00.000Z');

      expect(tradingDayKey(morning)).toBe(tradingDayKey(lateNightSameEtDay));
      expect(tradingDayKey(morning)).not.toBe(tradingDayKey(nextMorning));
    });
  });

  describe('vwap', () => {
    it('should match a hand-computed cumulative typical-price-weighted average within one session', () => {
      const day = '2024-01-17';
      const candles = [
        bar(new Date(`${day}T14:30:00.000Z`), 102, 98, 100, 1000), // typical = 100
        bar(new Date(`${day}T14:35:00.000Z`), 104, 100, 102, 2000), // typical = 102
        bar(new Date(`${day}T14:40:00.000Z`), 106, 102, 104, 1000), // typical = 104
      ];

      const result = vwap(candles);

      // bar0: 100*1000 / 1000 = 100
      expect(result[0]).toBeCloseTo(100, 8);
      // bar1: (100*1000 + 102*2000) / 3000 = 304000/3000 = 101.3333
      expect(result[1]).toBeCloseTo(101.33333333, 6);
      // bar2: (100*1000 + 102*2000 + 104*1000) / 4000 = 408000/4000 = 102
      expect(result[2]).toBeCloseTo(102, 8);
    });

    it('should reset the cumulative average at a new trading day', () => {
      const day1 = [
        bar(new Date('2024-01-16T14:30:00.000Z'), 202, 198, 200, 1000),
        bar(new Date('2024-01-16T14:35:00.000Z'), 302, 298, 300, 1000), // pulls day1's VWAP well above 200
      ];
      const day2 = [bar(new Date('2024-01-17T14:30:00.000Z'), 102, 98, 100, 1000)];

      const result = vwap([...day1, ...day2]);

      // The first bar of day 2 should reflect ONLY day 2's own volume, not
      // carry any of day 1's much-higher cumulative average forward.
      expect(result[2]).toBeCloseTo(100, 8);
    });

    it('should return null for a zero-volume bar with no accumulated volume yet', () => {
      const candles = [bar(new Date('2024-01-17T14:30:00.000Z'), 101, 99, 100, 0)];
      const result = vwap(candles);
      expect(result[0]).toBeNull();
    });
  });
});
