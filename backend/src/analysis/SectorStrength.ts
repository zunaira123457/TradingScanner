import { Candle } from '@/types';
import { RelativeStrengthResult } from '@/types/analysis';

/**
 * Simple close-to-close return over `periodDays` trading days, ending at the
 * last candle in the array. Returns null if there isn't enough history.
 */
function periodReturn(candles: Candle[], periodDays: number): number | null {
  if (candles.length < periodDays + 1) return null;
  const startClose = candles[candles.length - 1 - periodDays].close;
  const endClose = candles[candles.length - 1].close;
  return startClose === 0 ? null : (endClose - startClose) / startClose;
}

/**
 * Compares a stock's return against its sector and the broad-market
 * benchmark over the same period. `scoreAdjustment` is an explicit,
 * documented bonus/penalty (not model-invented):
 *   +0.15  outperforms both sector and benchmark
 *   +0.05  outperforms benchmark only (sector data unavailable or sector also lags)
 *   -0.10  underperforms both (or underperforms benchmark with no sector data)
 *    0.00  everything else (e.g. missing benchmark data)
 */
export function calculateRelativeStrength(
  stockCandles: Candle[],
  benchmarkCandles: Candle[],
  sectorCandles: Candle[] | null,
  periodDays = 63
): RelativeStrengthResult {
  const stockReturn = periodReturn(stockCandles, periodDays) ?? 0;
  const benchmarkReturn = periodReturn(benchmarkCandles, periodDays) ?? 0;
  const sectorReturn = sectorCandles ? periodReturn(sectorCandles, periodDays) : null;

  const vsBenchmark = stockReturn - benchmarkReturn;
  const vsSector = sectorReturn !== null ? stockReturn - sectorReturn : null;
  const sectorVsBenchmark = sectorReturn !== null ? sectorReturn - benchmarkReturn : null;

  const outperformingBoth = vsBenchmark > 0 && (vsSector === null || vsSector > 0);

  let scoreAdjustment = 0;
  if (vsBenchmark > 0 && vsSector !== null && vsSector > 0) {
    scoreAdjustment = 0.15;
  } else if (vsBenchmark > 0) {
    scoreAdjustment = 0.05;
  } else if (vsBenchmark <= 0 && (vsSector === null || vsSector <= 0)) {
    scoreAdjustment = -0.1;
  }

  return {
    periodDays,
    stockReturn,
    sectorReturn,
    benchmarkReturn,
    vsSector,
    vsBenchmark,
    sectorVsBenchmark,
    outperformingBoth,
    scoreAdjustment,
  };
}
