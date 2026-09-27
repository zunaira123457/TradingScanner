import {
  isValidDateKey,
  parseDateKey,
  findIndexForDate,
  resolveLockedStartIndex,
  LockedDateNotFoundError,
} from '@/paperTrading/DateIndexLookup';
import { dateKey } from '@/backtesting/USMarketCalendar';
import { Candle } from '@/types';

function c(dayOffset: number, close = 100): Candle {
  return { timestamp: new Date(2026, 0, 1 + dayOffset), open: close, high: close, low: close, close, volume: 1_000_000 };
}

describe('isValidDateKey', () => {
  it('accepts a well-formed YYYY-MM-DD string', () => {
    expect(isValidDateKey('2026-08-20')).toBe(true);
  });
  it('rejects malformed strings', () => {
    expect(isValidDateKey('2026-8-20')).toBe(false);
    expect(isValidDateKey('08/20/2026')).toBe(false);
    expect(isValidDateKey('not-a-date')).toBe(false);
    expect(isValidDateKey('')).toBe(false);
  });
});

describe('parseDateKey', () => {
  it('round-trips through dateKey() — the exact property this exists to guarantee', () => {
    const key = '2026-08-20';
    const parsed = parseDateKey(key);
    expect(dateKey(parsed)).toBe(key);
  });

  it('does NOT behave like new Date(key) (which parses as UTC and can shift a day under local-time getters)', () => {
    const key = '2026-01-15';
    const parsed = parseDateKey(key);
    // Regardless of the machine's timezone, parseDateKey must construct a
    // LOCAL date whose own local-time getters read back the same key.
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(0);
    expect(parsed.getDate()).toBe(15);
  });

  it('throws on a malformed key rather than silently producing an invalid date', () => {
    expect(() => parseDateKey('2026/08/20')).toThrow();
  });
});

describe('findIndexForDate', () => {
  const candles = [c(0), c(1), c(2), c(3), c(4)];

  it('finds the exact matching index', () => {
    expect(findIndexForDate(candles, candles[2].timestamp)).toBe(2);
  });

  it('returns -1 when the date is not present', () => {
    expect(findIndexForDate(candles, new Date(2030, 0, 1))).toBe(-1);
  });
});

describe('resolveLockedStartIndex', () => {
  const candles = [c(0), c(1), c(2), c(3), c(4)];

  it('resolves a locked date that exists in the series', () => {
    const key = dateKey(candles[3].timestamp);
    expect(resolveLockedStartIndex(candles, key)).toBe(3);
  });

  it('resolves the first index correctly (start-of-series edge case)', () => {
    const key = dateKey(candles[0].timestamp);
    expect(resolveLockedStartIndex(candles, key)).toBe(0);
  });

  it('resolves the last index correctly (end-of-series edge case)', () => {
    const key = dateKey(candles[candles.length - 1].timestamp);
    expect(resolveLockedStartIndex(candles, key)).toBe(candles.length - 1);
  });

  it('throws LockedDateNotFoundError (never silently falls back) when the locked date is absent', () => {
    expect(() => resolveLockedStartIndex(candles, '2030-01-01')).toThrow(LockedDateNotFoundError);
  });

  it('throws LockedDateNotFoundError on an empty series', () => {
    expect(() => resolveLockedStartIndex([], '2026-01-01')).toThrow(LockedDateNotFoundError);
  });
});
