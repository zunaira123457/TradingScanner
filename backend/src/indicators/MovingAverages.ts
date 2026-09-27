/**
 * Simple Moving Average.
 * result[i] is null until index >= period - 1 (insufficient warm-up data).
 */
export function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }

  return result;
}

/**
 * SMA variant for arrays that may already contain nulls (e.g. smoothing an
 * indicator that itself has a warm-up period). A window is only computed
 * when every value inside it is non-null.
 */
export function smaNullable(values: (number | null)[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);

  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    let valid = true;
    for (let j = i - period + 1; j <= i; j++) {
      if (values[j] === null) {
        valid = false;
        break;
      }
      sum += values[j] as number;
    }
    if (valid) {
      result[i] = sum / period;
    }
  }

  return result;
}

/**
 * Exponential Moving Average, seeded with the SMA of the first `period` values.
 * result[i] is null until index >= period - 1.
 */
export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < period) return result;

  const k = 2 / (period + 1);

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prevEma = sum / period;
  result[period - 1] = prevEma;

  for (let i = period; i < values.length; i++) {
    prevEma = values[i] * k + prevEma * (1 - k);
    result[i] = prevEma;
  }

  return result;
}
