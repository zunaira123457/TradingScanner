import { Candle } from '@/types';

/**
 * A smoothly oscillating uptrend: overall upward drift with a sine-wave
 * oscillation large enough (relative to the drift) to produce genuine
 * higher-highs/higher-lows swing structure, not just a monotonic ramp
 * (which would have no interior swing points at all).
 */
export function makeUptrendCandles(
  days: number,
  opts: { startPrice?: number; dailyDrift?: number; amplitude?: number; period?: number } = {}
): Candle[] {
  const { startPrice = 50, dailyDrift = 0.15, amplitude = 5, period = 20 } = opts;
  const candles: Candle[] = [];

  for (let i = 0; i < days; i++) {
    const trend = startPrice + i * dailyDrift;
    const oscillation = amplitude * Math.sin((2 * Math.PI * i) / period);
    const close = trend + oscillation;
    const open = close - 0.1;
    const high = close + 0.6;
    const low = close - 0.6;
    candles.push({
      timestamp: new Date(2020, 0, 1 + i),
      open,
      high,
      low,
      close,
      volume: 1000000 + (i % 10) * 20000,
    });
  }

  return candles;
}

export function makeDowntrendCandles(
  days: number,
  opts: { startPrice?: number; dailyDrift?: number; amplitude?: number; period?: number } = {}
): Candle[] {
  const { startPrice = 200, dailyDrift = 0.15, amplitude = 5, period = 20 } = opts;
  return makeUptrendCandles(days, { startPrice, dailyDrift: -dailyDrift, amplitude, period }).map((c) => ({
    ...c,
  }));
}

/**
 * Appends a tight consolidation followed by a volume-confirmed breakout bar.
 */
export function appendConsolidationAndBreakout(
  base: Candle[],
  consolidationDays: number,
  breakoutPct: number
): Candle[] {
  const last = base[base.length - 1];
  const mid = last.close;
  const result = [...base];

  for (let i = 1; i <= consolidationDays; i++) {
    const date = new Date(last.timestamp);
    date.setDate(date.getDate() + i);
    const wiggle = Math.sin(i) * mid * 0.01;
    result.push({
      timestamp: date,
      open: mid + wiggle,
      high: mid + Math.abs(wiggle) + mid * 0.015,
      low: mid - Math.abs(wiggle) - mid * 0.015,
      close: mid + wiggle,
      volume: 600000,
    });
  }

  const breakoutDate = new Date(last.timestamp);
  breakoutDate.setDate(breakoutDate.getDate() + consolidationDays + 1);
  const breakoutClose = mid * (1 + breakoutPct);
  result.push({
    timestamp: breakoutDate,
    open: mid * 1.005,
    high: breakoutClose + mid * 0.01,
    low: mid,
    close: breakoutClose,
    volume: 2500000, // strong volume confirmation
  });

  return result;
}
