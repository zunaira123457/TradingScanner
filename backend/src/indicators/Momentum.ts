import { Candle } from '@/types';
import { smaNullable } from './MovingAverages';
import { ema } from './MovingAverages';

/**
 * Relative Strength Index using Wilder's smoothing method.
 * result[i] is null until index >= period.
 */
export function rsi(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return result;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change >= 0) gains += change;
    else losses += -change;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  result[period] = calcRsiFromAverages(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = calcRsiFromAverages(avgGain, avgLoss);
  }

  return result;
}

function calcRsiFromAverages(avgGain: number, avgLoss: number): number {
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
}

/**
 * MACD: fast EMA - slow EMA, with an EMA-of-MACD signal line.
 */
export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): MacdResult {
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);

  const macdLine: (number | null)[] = closes.map((_, i) =>
    fastEma[i] !== null && slowEma[i] !== null ? (fastEma[i] as number) - (slowEma[i] as number) : null
  );

  const firstValidIdx = macdLine.findIndex((v) => v !== null);
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  const histogram: (number | null)[] = new Array(closes.length).fill(null);

  if (firstValidIdx !== -1) {
    const macdValues = macdLine.slice(firstValidIdx).map((v) => v as number);
    const signalEma = ema(macdValues, signalPeriod);

    for (let i = 0; i < signalEma.length; i++) {
      const fullIdx = firstValidIdx + i;
      signalLine[fullIdx] = signalEma[i];
      if (signalEma[i] !== null) {
        histogram[fullIdx] = (macdLine[fullIdx] as number) - (signalEma[i] as number);
      }
    }
  }

  return { macdLine, signalLine, histogram };
}

export interface StochasticResult {
  k: (number | null)[];
  d: (number | null)[];
}

/**
 * Stochastic Oscillator. %K is smoothed by `smoothK` before %D (SMA of %K) is taken —
 * this is the common "slow stochastic" convention.
 */
export function stochastic(
  candles: Candle[],
  kPeriod = 14,
  dPeriod = 3,
  smoothK = 3
): StochasticResult {
  const rawK: (number | null)[] = new Array(candles.length).fill(null);

  for (let i = kPeriod - 1; i < candles.length; i++) {
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > highestHigh) highestHigh = candles[j].high;
      if (candles[j].low < lowestLow) lowestLow = candles[j].low;
    }
    const range = highestHigh - lowestLow;
    rawK[i] = range === 0 ? 50 : ((candles[i].close - lowestLow) / range) * 100;
  }

  const k = smoothK > 1 ? smaNullable(rawK, smoothK) : rawK;
  const d = smaNullable(k, dPeriod);

  return { k, d };
}

/**
 * Rate of Change (%) over `period` bars.
 */
export function roc(closes: number[], period = 12): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    const prev = closes[i - period];
    result[i] = prev === 0 ? null : ((closes[i] - prev) / prev) * 100;
  }
  return result;
}

export interface AdxResult {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
}

/**
 * Average Directional Index (Wilder's method).
 * Requires at least 2*period candles before the first ADX value is available:
 * `period` bars to seed the smoothed TR/+DM/-DM, then another `period` DX
 * values to seed the ADX's own Wilder smoothing.
 */
export function adx(candles: Candle[], period = 14): AdxResult {
  const n = candles.length;
  const adxArr: (number | null)[] = new Array(n).fill(null);
  const plusDIArr: (number | null)[] = new Array(n).fill(null);
  const minusDIArr: (number | null)[] = new Array(n).fill(null);

  if (n < period * 2 + 1) {
    return { adx: adxArr, plusDI: plusDIArr, minusDI: minusDIArr };
  }

  const tr: number[] = new Array(n).fill(0);
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    const highDiff = candles[i].high - candles[i - 1].high;
    const lowDiff = candles[i - 1].low - candles[i].low;
    plusDM[i] = highDiff > lowDiff && highDiff > 0 ? highDiff : 0;
    minusDM[i] = lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0;
    tr[i] = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
  }

  let smoothedTR = 0;
  let smoothedPlusDM = 0;
  let smoothedMinusDM = 0;
  for (let i = 1; i <= period; i++) {
    smoothedTR += tr[i];
    smoothedPlusDM += plusDM[i];
    smoothedMinusDM += minusDM[i];
  }

  const dx: (number | null)[] = new Array(n).fill(null);

  const computeDI = (idx: number, sTR: number, sPlusDM: number, sMinusDM: number) => {
    const plusDI = sTR === 0 ? 0 : (sPlusDM / sTR) * 100;
    const minusDI = sTR === 0 ? 0 : (sMinusDM / sTR) * 100;
    plusDIArr[idx] = plusDI;
    minusDIArr[idx] = minusDI;
    const diSum = plusDI + minusDI;
    dx[idx] = diSum === 0 ? 0 : (Math.abs(plusDI - minusDI) / diSum) * 100;
  };

  computeDI(period, smoothedTR, smoothedPlusDM, smoothedMinusDM);

  for (let i = period + 1; i < n; i++) {
    smoothedTR = smoothedTR - smoothedTR / period + tr[i];
    smoothedPlusDM = smoothedPlusDM - smoothedPlusDM / period + plusDM[i];
    smoothedMinusDM = smoothedMinusDM - smoothedMinusDM / period + minusDM[i];
    computeDI(i, smoothedTR, smoothedPlusDM, smoothedMinusDM);
  }

  const firstDxIdx = period;
  const secondPeriodEnd = period * 2 - 1;
  if (secondPeriodEnd >= n) {
    return { adx: adxArr, plusDI: plusDIArr, minusDI: minusDIArr };
  }

  let sumDx = 0;
  for (let i = firstDxIdx; i <= secondPeriodEnd; i++) {
    sumDx += dx[i] as number;
  }
  let smoothedADX = sumDx / period;
  adxArr[secondPeriodEnd] = smoothedADX;

  for (let i = secondPeriodEnd + 1; i < n; i++) {
    smoothedADX = (smoothedADX * (period - 1) + (dx[i] as number)) / period;
    adxArr[i] = smoothedADX;
  }

  return { adx: adxArr, plusDI: plusDIArr, minusDI: minusDIArr };
}
