import { describe, expect, it } from 'vitest';
import { applyQuoteToCandles } from '@/lib/utils/chartHelpers';
import type { Candle, Quote } from '@/lib/types';

const q = (price: number, tsSec: number, extra: Partial<Quote> = {}): Quote => ({
  symbol: 'AAPL', price, change: null, changePercent: null, open: null, high: null, low: null, prevClose: null,
  volume: null, bid: null, ask: null, timestamp: tsSec * 1000, fetchedAt: 0, source: 'finnhub', ...extra,
});
const bar = (time: number, c: number): Candle => ({ time, open: c, high: c, low: c, close: c, volume: 10 });

describe('applyQuoteToCandles', () => {
  const t0 = 1_790_000_000 - (1_790_000_000 % 300);

  it('updates the current intraday bar in place', () => {
    const out = applyQuoteToCandles([bar(t0, 100)], q(101, t0 + 30), '5m');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ open: 100, high: 101, low: 100, close: 101, volume: 10 });
  });

  it('starts a new bar aligned to the series step', () => {
    const out = applyQuoteToCandles([bar(t0, 100)], q(99, t0 + 610), '5m');
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ time: t0 + 600, open: 99, close: 99, volume: 0 });
  });

  it('ignores ticks older than the last bar and returns the same array', () => {
    const series = [bar(t0, 100)];
    expect(applyQuoteToCandles(series, q(50, t0 - 1), '5m')).toBe(series);
  });

  it('does not bridge multi-day gaps on intraday charts', () => {
    const series = [bar(t0, 100)];
    expect(applyQuoteToCandles(series, q(50, t0 + 3 * 86_400), '5m')).toBe(series);
  });

  it('replaces today’s daily bar using the session OHLC from the quote', () => {
    const day = Date.parse('2026-09-25T00:00:00Z') / 1000;
    const tick = Date.parse('2026-09-25T18:00:00Z') / 1000; // 2pm ET
    const out = applyQuoteToCandles([bar(day, 100)], q(105, tick, { open: 101, high: 106, low: 99, volume: 5e6 }), '1d');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ time: day, open: 101, high: 106, low: 99, close: 105, volume: 5e6 });
  });

  it('appends a new daily bar on the next session', () => {
    const day = Date.parse('2026-09-24T00:00:00Z') / 1000;
    const tick = Date.parse('2026-09-25T15:00:00Z') / 1000;
    const out = applyQuoteToCandles([bar(day, 100)], q(102, tick, { open: 100.5, high: 103, low: 100 }), '1d');
    expect(out).toHaveLength(2);
    expect(out[1].time).toBe(Date.parse('2026-09-25T00:00:00Z') / 1000);
  });
});
