import { Candle } from '@/types';

const tradingDayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The NYSE trading-day key (YYYY-MM-DD in America/New_York) for a candle's timestamp. */
export function tradingDayKey(timestamp: Date): string {
  const parts = tradingDayFormatter.formatToParts(timestamp);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Session-anchored Volume Weighted Average Price: cumulative
 * (typicalPrice * volume) / cumulative volume, resetting at the first bar
 * of each NYSE trading day (a session boundary, not a fixed lookback
 * window — unlike every other indicator in this codebase).
 */
export function vwap(candles: Candle[]): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);

  let cumulativePV = 0;
  let cumulativeVolume = 0;
  let currentDay: string | null = null;

  for (let i = 0; i < candles.length; i++) {
    const day = tradingDayKey(candles[i].timestamp);
    if (day !== currentDay) {
      currentDay = day;
      cumulativePV = 0;
      cumulativeVolume = 0;
    }

    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumulativePV += typicalPrice * candles[i].volume;
    cumulativeVolume += candles[i].volume;

    result[i] = cumulativeVolume === 0 ? null : cumulativePV / cumulativeVolume;
  }

  return result;
}
