import { alignSeriesByDate } from '@/backtesting/CalendarAlignment';
import { isLikelyTradingDay } from '@/backtesting/USMarketCalendar';
import { Candle } from '@/types';

function c(date: Date, close: number): Candle {
  return { timestamp: date, open: close, high: close + 1, low: close - 1, close, volume: 1000000 };
}

function makeDailySeries(startDay: number, count: number, skipDays: number[] = []): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    if (skipDays.includes(i)) continue;
    candles.push(c(new Date(2024, 0, startDay + i), 100 + i));
  }
  return candles;
}

describe('alignSeriesByDate', () => {
  it('should return unchanged, identically-ordered series when all dates already match', () => {
    const a = makeDailySeries(1, 10);
    const b = makeDailySeries(1, 10);
    const { aligned, report } = alignSeriesByDate(new Map([['A', a], ['B', b]]));

    expect(report.commonDates).toBe(10);
    expect(aligned.get('A')!.length).toBe(10);
    expect(aligned.get('B')!.length).toBe(10);
    expect(report.droppedByLabel.get('A')).toBe(0);
    expect(report.droppedByLabel.get('B')).toBe(0);
  });

  it('should compute the correct intersection when one series is MISALIGNED (missing dates in the middle)', () => {
    // B is missing day index 4 (a genuine gap in the middle of the series) —
    // exactly the misaligned-calendar scenario the old index-based
    // Backtester assumption would have silently mishandled.
    const a = makeDailySeries(1, 10);
    const b = makeDailySeries(1, 10, [4]);

    const { aligned, report } = alignSeriesByDate(new Map([['A', a], ['B', b]]));

    expect(report.commonDates).toBe(9);
    expect(aligned.get('A')!.length).toBe(9);
    expect(aligned.get('B')!.length).toBe(9);
    expect(report.droppedByLabel.get('A')).toBe(1); // A had the date B was missing
    expect(report.droppedByLabel.get('B')).toBe(0);

    // Critically: index t in A and index t in B must now refer to the SAME
    // real calendar date, not merely the same array position as before.
    for (let t = 0; t < aligned.get('A')!.length; t++) {
      expect(aligned.get('A')![t].timestamp.getTime()).toBe(aligned.get('B')![t].timestamp.getTime());
    }
  });

  it('should compute the correct intersection when series start on different dates', () => {
    const a = makeDailySeries(1, 10); // Jan 1-10
    const b = makeDailySeries(5, 10); // Jan 5-14
    const { aligned, report } = alignSeriesByDate(new Map([['A', a], ['B', b]]));

    // Overlap: Jan 5-10 = 6 days
    expect(report.commonDates).toBe(6);
    expect(aligned.get('A')![0].timestamp.getDate()).toBe(5);
    expect(aligned.get('B')![0].timestamp.getDate()).toBe(5);
  });

  it('should detect an unexpected gap: a real trading day present in one series but missing from another', () => {
    const start = 8; // Jan 8, 2024 is a Monday — a clean Mon-Fri window, no weekends/holidays inside it
    const full = makeDailySeries(start, 5); // complete Mon-Fri
    const gappy = makeDailySeries(start, 5, [2]); // missing Wednesday

    const { report } = alignSeriesByDate(new Map([['FULL', full], ['GAPPY', gappy]]));
    expect(report.unexpectedGaps.some((g) => g.label === 'GAPPY')).toBe(true);
    expect(report.unexpectedGaps.some((g) => g.label === 'FULL')).toBe(false);
  });

  it('should return empty results for an empty input map', () => {
    const { aligned, report } = alignSeriesByDate(new Map());
    expect(aligned.size).toBe(0);
    expect(report.commonDates).toBe(0);
  });

  it('should handle three or more series with different gaps simultaneously', () => {
    const a = makeDailySeries(1, 10);
    const b = makeDailySeries(1, 10, [3]);
    const cSeries = makeDailySeries(1, 10, [7]);

    const { aligned, report } = alignSeriesByDate(new Map([['A', a], ['B', b], ['C', cSeries]]));
    expect(report.commonDates).toBe(8); // 10 - 2 distinct missing days
    expect(aligned.get('A')!.length).toBe(8);
    expect(aligned.get('B')!.length).toBe(8);
    expect(aligned.get('C')!.length).toBe(8);
  });

  it('should report ZERO unexpected gaps for a realistic multi-year, fully-populated trading-day series (regression: dateKey/parseLocalDateKey timezone consistency)', () => {
    // Generate every real US trading day (per USMarketCalendar) across ~2
    // years for two identical series — this is exactly the shape of real
    // downloaded market data, and previously over-reported thousands of
    // false "unexpected gaps" due to a UTC-vs-local date-parsing mismatch
    // between dateKey() (local) and `new Date(dateKeyString)` (UTC) inside
    // the gap-detection loop.
    const tradingDays: Date[] = [];
    const d = new Date(2023, 0, 1);
    const end = new Date(2024, 11, 31);
    while (d.getTime() <= end.getTime()) {
      if (isLikelyTradingDay(d)) tradingDays.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }

    const seriesA = tradingDays.map((date) => c(date, 100));
    const seriesB = tradingDays.map((date) => c(date, 200));

    const { report } = alignSeriesByDate(new Map([['A', seriesA], ['B', seriesB]]));

    expect(report.commonDates).toBe(tradingDays.length);
    expect(report.unexpectedGaps).toEqual([]);
  });
});
