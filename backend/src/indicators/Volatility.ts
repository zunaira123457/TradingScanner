import { Candle } from '@/types';
import { sma } from './MovingAverages';

/**
 * Average True Range (Wilder's smoothing).
 * result[i] is null until index >= period.
 */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const n = candles.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return result;

  const tr: number[] = new Array(n).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  let prevAtr = sum / period;
  result[period - 1] = prevAtr;

  for (let i = period; i < n; i++) {
    prevAtr = (prevAtr * (period - 1) + tr[i]) / period;
    result[i] = prevAtr;
  }

  return result;
}

export interface BollingerBandsResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  width: (number | null)[];
}

/**
 * Bollinger Bands using population standard deviation (the standard convention).
 * width = (upper - lower) / middle, a normalized measure of band tightness.
 */
export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMultiplier = 2
): BollingerBandsResult {
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  const width: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i] as number;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += Math.pow(closes[j] - mean, 2);
    }
    const stdDev = Math.sqrt(sumSq / period);
    upper[i] = mean + stdDevMultiplier * stdDev;
    lower[i] = mean - stdDevMultiplier * stdDev;
    width[i] = mean === 0 ? null : ((upper[i] as number) - (lower[i] as number)) / mean;
  }

  return { upper, middle, lower, width };
}

/**
 * Historical volatility: annualized standard deviation of daily log returns.
 */
export function historicalVolatility(
  closes: number[],
  period = 20,
  tradingDaysPerYear = 252
): (number | null)[] {
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return result;

  const logReturns: (number | null)[] = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    logReturns[i] = Math.log(closes[i] / closes[i - 1]);
  }

  for (let i = period; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += logReturns[j] as number;
    }
    const mean = sum / period;

    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += Math.pow((logReturns[j] as number) - mean, 2);
    }
    const variance = sumSq / (period - 1);
    const stdDev = Math.sqrt(variance);
    result[i] = stdDev * Math.sqrt(tradingDaysPerYear);
  }

  return result;
}
