/**
 * Technical indicators for chart overlays. Pure functions over close prices;
 * each returns an array aligned 1:1 with the input, with `null` until the
 * indicator has enough history (no back-filling, no look-ahead).
 *
 * Definitions follow the standard textbook forms (Wilder smoothing for RSI,
 * SMA-seeded EMA, population standard deviation for Bollinger Bands).
 */

export type Series = (number | null)[];

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** EMA seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** EMA over a series that begins with nulls (used for the MACD signal line). */
function emaOfSeries(values: Series, period: number): Series {
  const firstIdx = values.findIndex((v) => v !== null);
  const out: Series = new Array(values.length).fill(null);
  if (firstIdx === -1) return out;
  const tail = ema(values.slice(firstIdx) as number[], period);
  tail.forEach((v, i) => (out[firstIdx + i] = v));
  return out;
}

/** Wilder's RSI. */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  const toRsi = () => (avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : 100 - 100 / (1 + avgGain / avgLoss));
  out[period] = toRsi();
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = toRsi();
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(values: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const f = ema(values, fast);
  const s = ema(values, slow);
  const line: Series = values.map((_, i) => (f[i] !== null && s[i] !== null ? (f[i] as number) - (s[i] as number) : null));
  const signal = emaOfSeries(line, signalPeriod);
  const histogram: Series = line.map((m, i) => (m !== null && signal[i] !== null ? m - (signal[i] as number) : null));
  return { macd: line, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

export function bollinger(values: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const m = middle[i] as number;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (values[j] - m) ** 2;
    const sd = Math.sqrt(variance / period);
    upper[i] = m + mult * sd;
    lower[i] = m - mult * sd;
  }
  return { upper, middle, lower };
}
