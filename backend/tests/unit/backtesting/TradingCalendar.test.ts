import { validateAlignedCalendars } from '@/backtesting/TradingCalendar';
import { Candle } from '@/types';

function makeCandles(startDay: number, count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(2024, 0, startDay + i),
    open: 100, high: 101, low: 99, close: 100, volume: 1000000,
  }));
}

describe('validateAlignedCalendars', () => {
  it('should not throw for a single series', () => {
    expect(() => validateAlignedCalendars(new Map([['AAPL', makeCandles(1, 10)]]))).not.toThrow();
  });

  it('should not throw when series share the same calendar', () => {
    const map = new Map([
      ['AAPL', makeCandles(1, 100)],
      ['MSFT', makeCandles(1, 100)],
      ['SPY', makeCandles(1, 100)],
    ]);
    expect(() => validateAlignedCalendars(map)).not.toThrow();
  });

  it('should throw when series have different lengths', () => {
    const map = new Map([
      ['AAPL', makeCandles(1, 100)],
      ['MSFT', makeCandles(1, 95)],
    ]);
    expect(() => validateAlignedCalendars(map)).toThrow(/misalignment/);
  });

  it('should throw when series have the same length but different dates', () => {
    const map = new Map([
      ['AAPL', makeCandles(1, 100)],
      ['MSFT', makeCandles(5, 100)], // shifted start date, same length
    ]);
    expect(() => validateAlignedCalendars(map)).toThrow(/misalignment/);
  });
});
