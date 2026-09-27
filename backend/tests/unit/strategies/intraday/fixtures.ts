import { Candle } from '@/types';

const MS_PER_MIN = 60 * 1000;

/**
 * 5-minute bars starting at 9:30 ET on a fixed EST (UTC-5, no DST) date, so
 * tests don't have to reason about daylight saving. dateUtc is 'YYYY-MM-DD'.
 */
export function makeIntradaySessionCandles(
  dateUtc: string,
  count: number,
  opts: { startPrice?: number; drift?: number; amplitude?: number; volume?: number } = {}
): Candle[] {
  const { startPrice = 100, drift = 0.02, amplitude = 0.3, volume = 100000 } = opts;
  const sessionStart = new Date(`${dateUtc}T14:30:00.000Z`); // 9:30 ET in EST
  const candles: Candle[] = [];

  for (let i = 0; i < count; i++) {
    const timestamp = new Date(sessionStart.getTime() + i * 5 * MS_PER_MIN);
    const trend = startPrice + i * drift;
    const osc = amplitude * Math.sin(i / 3);
    const close = trend + osc;
    const open = close - 0.05;
    const high = Math.max(open, close) + 0.1;
    const low = Math.min(open, close) - 0.1;
    candles.push({ timestamp, open, high, low, close, volume });
  }

  return candles;
}

function barAt(dateUtc: string, minutesAfterOpen: number, fields: Partial<Candle>): Candle {
  const timestamp = new Date(new Date(`${dateUtc}T14:30:00.000Z`).getTime() + minutesAfterOpen * MS_PER_MIN);
  return {
    timestamp,
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 100000,
    ...fields,
  };
}

/**
 * A calm prior day (for indicator warm-up) plus a tight 3-bar opening range
 * on `todayUtc` followed by a breakout bar closing above the range high,
 * with a volume spike well above the 12-bar relativeVolume baseline.
 */
export function makeOpeningRangeBreakoutCandles(priorDayUtc: string, todayUtc: string): Candle[] {
  const priorDay = makeIntradaySessionCandles(priorDayUtc, 30, { startPrice: 100, drift: 0, amplitude: 0.2, volume: 100000 });

  const openingRange = [
    barAt(todayUtc, 0, { open: 100, high: 100.3, low: 99.8, close: 100.1, volume: 100000 }),
    barAt(todayUtc, 5, { open: 100.1, high: 100.3, low: 99.9, close: 100.0, volume: 100000 }),
    barAt(todayUtc, 10, { open: 100.0, high: 100.2, low: 99.9, close: 100.1, volume: 100000 }),
  ];
  // opening range high = 100.3, low = 99.8

  const breakout = barAt(todayUtc, 15, { open: 100.2, high: 101.2, low: 100.1, close: 101.0, volume: 500000 });

  return [...priorDay, ...openingRange, breakout];
}

/**
 * A prior day plus a rising-VWAP session that pulls back to touch VWAP and
 * turns back up on the final bar — a VwapTrendContinuation setup.
 */
export function makeVwapPullbackCandles(priorDayUtc: string, todayUtc: string): Candle[] {
  const priorDay = makeIntradaySessionCandles(priorDayUtc, 30, { startPrice: 100, drift: 0, amplitude: 0.2, volume: 100000 });

  const rally = [0, 1, 2, 3, 4, 5].map((i) =>
    barAt(todayUtc, i * 5, {
      open: 100 + i * 0.3,
      high: 100.4 + i * 0.3,
      low: 99.9 + i * 0.3,
      close: 100.3 + i * 0.3,
      volume: 150000,
    })
  );
  // rally closes: ~100.3, 100.6, 100.9, 101.2, 101.5, 101.8 — VWAP rises with it

  const pullback = [6, 7, 8, 9, 10].map((i) =>
    barAt(todayUtc, i * 5, {
      open: 101.6 - (i - 6) * 0.15,
      high: 101.7 - (i - 6) * 0.15,
      low: 101.0 - (i - 6) * 0.15,
      close: 101.3 - (i - 6) * 0.15,
      volume: 90000,
    })
  );
  // drifts down toward VWAP over 5 bars, low bars approach the VWAP line

  const turnUp = barAt(todayUtc, 55, { open: 100.8, high: 101.4, low: 100.75, close: 101.35, volume: 140000 });

  return [...priorDay, ...rally, ...pullback, turnUp];
}

/**
 * A prior day plus a strong intraday uptrend (EMA9 > EMA21) that breaks its
 * recent 20-bar high on a relative-volume spike — a MomentumBreakout setup.
 */
export function makeMomentumBreakoutCandles(priorDayUtc: string, todayUtc: string): Candle[] {
  const priorDay = makeIntradaySessionCandles(priorDayUtc, 20, { startPrice: 100, drift: 0, amplitude: 0.15, volume: 100000 });

  // Trending up overall but with enough up/down alternation (via the sine
  // term, a short enough period to produce several full cycles within any
  // 14-bar RSI window) that RSI settles in a healthy-to-strong band instead
  // of pinning near 100 the way a monotonic all-green climb would.
  const uptrend = Array.from({ length: 25 }, (_, i) => {
    const close = 100 + i * 0.05 + 0.6 * Math.sin(i / 1.5);
    const open = close - 0.05;
    const high = Math.max(open, close) + 0.15;
    const low = Math.min(open, close) - 0.15;
    return barAt(todayUtc, i * 5, { open, high, low, close, volume: 100000 });
  });
  const recentHigh = Math.max(...uptrend.map((c) => c.high));

  const breakout = barAt(todayUtc, 25 * 5, {
    open: recentHigh - 0.1,
    high: recentHigh + 1.5,
    low: recentHigh - 0.2,
    close: recentHigh + 1.2,
    volume: 400000,
  });

  return [...priorDay, ...uptrend, breakout];
}
