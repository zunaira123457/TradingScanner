import { Candle } from '@/types';
import { sma } from './MovingAverages';

/**
 * Simple moving average of daily volume.
 */
export function volumeSma(volumes: number[], period = 20): (number | null)[] {
  return sma(volumes, period);
}

/**
 * Relative volume: today's volume divided by the average volume of the
 * preceding `period` days (today is excluded from its own baseline).
 */
export function relativeVolume(volumes: number[], period = 20): (number | null)[] {
  const n = volumes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  for (let i = period; i < n; i++) {
    let sum = 0;
    for (let j = i - period; j < i; j++) sum += volumes[j];
    const avg = sum / period;
    result[i] = avg === 0 ? null : volumes[i] / avg;
  }

  return result;
}

/**
 * On-Balance Volume. Cumulative; starts at 0 since there is no prior close
 * to compare the first candle against.
 */
export function obv(candles: Candle[]): number[] {
  const n = candles.length;
  const result: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i++) {
    if (candles[i].close > candles[i - 1].close) {
      result[i] = result[i - 1] + candles[i].volume;
    } else if (candles[i].close < candles[i - 1].close) {
      result[i] = result[i - 1] - candles[i].volume;
    } else {
      result[i] = result[i - 1];
    }
  }

  return result;
}

/**
 * Average dollar volume (close * volume) over `period` days.
 */
export function avgDollarVolume(candles: Candle[], period = 30): (number | null)[] {
  const dollarVolumes = candles.map((c) => c.close * c.volume);
  return sma(dollarVolumes, period);
}

/**
 * A volume spike is defined as relative volume at or above `threshold`.
 */
export function isVolumeSpike(relVol: number | null, threshold = 2.0): boolean {
  return relVol !== null && relVol >= threshold;
}
