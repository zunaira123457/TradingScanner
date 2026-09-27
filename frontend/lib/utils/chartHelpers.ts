import type { Candle, Interval, Quote } from '@/lib/types';

export const INTERVAL_SECONDS: Record<Interval, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '1d': 86_400, '1w': 604_800,
};

export const INTERVAL_LABEL: Record<Interval, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '1d': '1D', '1w': '1W',
};

export const isIntraday = (i: Interval) => INTERVAL_SECONDS[i] < 86_400;

/** YYYY-MM-DD of a timestamp in New York time. */
function nyDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Folds a live quote into a candle series so the chart moves between candle
 * refetches. Returns the same array when the tick does not apply.
 *
 *  - Intraday: bars are stepped from the last bar's open time (Twelve Data's
 *    hourly bars start at :30, so wall-clock bucketing would misalign). A new
 *    bar starts at the tick price; its volume is unknown until the next refetch
 *    and is left at 0 rather than guessed.
 *  - Daily: the quote's session open/high/low/close/volume describe today's
 *    bar exactly, so today's bar is replaced (or appended once per day).
 *  - Weekly: only the current bar's high/low/close are updated.
 */
export function applyQuoteToCandles(candles: Candle[], quote: Quote, interval: Interval): Candle[] {
  if (candles.length === 0) return candles;
  const last = candles[candles.length - 1];
  const tickSec = Math.floor(quote.timestamp / 1000);
  const p = quote.price;
  if (tickSec < last.time) return candles;

  if (isIntraday(interval)) {
    const step = INTERVAL_SECONDS[interval];
    const k = Math.floor((tickSec - last.time) / step);
    if (k === 0) {
      if (last.close === p && last.high >= p && last.low <= p) return candles;
      return [...candles.slice(0, -1), { ...last, high: Math.max(last.high, p), low: Math.min(last.low, p), close: p }];
    }
    // Don't bridge overnight/weekend gaps with a synthetic bar far from the series.
    if (k > 24 * 3600 / step) return candles;
    return [...candles, { time: last.time + k * step, open: p, high: p, low: p, close: p, volume: 0 }];
  }

  if (interval === '1d') {
    const today = nyDate(quote.timestamp);
    const lastDay = new Date(last.time * 1000).toISOString().slice(0, 10);
    const bar: Candle = {
      time: Math.floor(Date.parse(`${today}T00:00:00Z`) / 1000),
      open: quote.open ?? (today === lastDay ? last.open : p),
      high: Math.max(quote.high ?? p, p),
      low: Math.min(quote.low ?? p, p),
      close: p,
      volume: quote.volume ?? (today === lastDay ? last.volume : 0),
    };
    if (today === lastDay) return [...candles.slice(0, -1), bar];
    if (today > lastDay) return [...candles, bar];
    return candles;
  }

  // 1w
  if (tickSec - last.time < INTERVAL_SECONDS['1w']) {
    return [...candles.slice(0, -1), { ...last, high: Math.max(last.high, p), low: Math.min(last.low, p), close: p }];
  }
  return candles;
}

/** Rebases a close series to % change from its first value (for comparison charts). */
export function toPercentSeries(candles: Candle[]): { time: number; value: number }[] {
  if (candles.length === 0) return [];
  const base = candles[0].close;
  return candles.map((c) => ({ time: c.time, value: ((c.close - base) / base) * 100 }));
}
