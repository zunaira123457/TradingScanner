import { isWithinDayTradingWindow, isPastDayTradingWindow } from '@/utils/marketHours';

// 2024-01-17 is a Wednesday in January (CST = UTC-6, no DST) — 08:30 CST =
// 14:30 UTC, 15:00 CST = 21:00 UTC. Using a fixed winter date keeps these
// tests independent of daylight saving.
const START = '08:30';
const END = '15:00';

describe('marketHours', () => {
  describe('isWithinDayTradingWindow', () => {
    it('should be true in the middle of the window on a weekday', () => {
      const midday = new Date('2024-01-17T16:00:00.000Z'); // 10:00 CST
      expect(isWithinDayTradingWindow(midday, START, END)).toBe(true);
    });

    it('should be true exactly at the start boundary (inclusive)', () => {
      const atStart = new Date('2024-01-17T14:30:00.000Z'); // 08:30 CST
      expect(isWithinDayTradingWindow(atStart, START, END)).toBe(true);
    });

    it('should be false exactly at the end boundary (exclusive)', () => {
      const atEnd = new Date('2024-01-17T21:00:00.000Z'); // 15:00 CST
      expect(isWithinDayTradingWindow(atEnd, START, END)).toBe(false);
    });

    it('should be false before the window opens', () => {
      const early = new Date('2024-01-17T14:00:00.000Z'); // 08:00 CST
      expect(isWithinDayTradingWindow(early, START, END)).toBe(false);
    });

    it('should be false after the window closes', () => {
      const late = new Date('2024-01-17T22:00:00.000Z'); // 16:00 CST
      expect(isWithinDayTradingWindow(late, START, END)).toBe(false);
    });

    it('should be false on a weekend even during trading hours', () => {
      const saturdayMidday = new Date('2024-01-20T16:00:00.000Z'); // Saturday 10:00 CST
      expect(isWithinDayTradingWindow(saturdayMidday, START, END)).toBe(false);
    });
  });

  describe('isPastDayTradingWindow', () => {
    it('should be true at/after the end boundary on a weekday', () => {
      const atEnd = new Date('2024-01-17T21:00:00.000Z'); // 15:00 CST
      const afterEnd = new Date('2024-01-17T22:00:00.000Z'); // 16:00 CST
      expect(isPastDayTradingWindow(atEnd, END)).toBe(true);
      expect(isPastDayTradingWindow(afterEnd, END)).toBe(true);
    });

    it('should be false before the end boundary', () => {
      const midday = new Date('2024-01-17T16:00:00.000Z'); // 10:00 CST
      expect(isPastDayTradingWindow(midday, END)).toBe(false);
    });

    it('should be false on a weekend even after the nominal end time', () => {
      const saturdayEvening = new Date('2024-01-20T23:00:00.000Z'); // Saturday 17:00 CST
      expect(isPastDayTradingWindow(saturdayEvening, END)).toBe(false);
    });
  });
});
