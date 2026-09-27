import { Candle } from '@/types';
import { TimeframeTrend, MultiTimeframeResult } from '@/types/analysis';
import { sma } from '@/indicators/MovingAverages';

/**
 * Groups daily candles into weekly candles (Monday-anchored weeks).
 * Only aggregates the data given — if `dailyCandles` is a point-in-time
 * slice up to day T, the resulting weekly series (including a partial
 * current week) is itself a valid point-in-time series with no look-ahead.
 */
export function aggregateToWeekly(dailyCandles: Candle[]): Candle[] {
  const groups = new Map<string, Candle[]>();

  for (const candle of dailyCandles) {
    const key = getWeekStartKey(candle.timestamp);
    const group = groups.get(key);
    if (group) {
      group.push(candle);
    } else {
      groups.set(key, [candle]);
    }
  }

  const weekly: Candle[] = [];
  for (const [key, dayCandles] of groups) {
    weekly.push({
      timestamp: new Date(key),
      open: dayCandles[0].open,
      high: Math.max(...dayCandles.map((c) => c.high)),
      low: Math.min(...dayCandles.map((c) => c.low)),
      close: dayCandles[dayCandles.length - 1].close,
      volume: dayCandles.reduce((sum, c) => sum + c.volume, 0),
    });
  }

  return weekly;
}

function getWeekStartKey(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

/**
 * Trend classification shared by multi-timeframe analysis and market regime
 * detection: bullish requires close > SMA50 > SMA200 (or just close > SMA50
 * when there isn't yet enough history for SMA200); bearish is the mirror;
 * anything else is neutral.
 */
export function determineTrend(
  closes: number[],
  sma50: (number | null)[],
  sma200: (number | null)[]
): TimeframeTrend {
  const n = closes.length;
  if (n === 0) return 'neutral';

  const lastClose = closes[n - 1];
  const lastSma50 = sma50[n - 1];
  const lastSma200 = sma200[n - 1];

  if (lastSma50 === null) return 'neutral';

  if (lastSma200 !== null) {
    if (lastClose > lastSma50 && lastSma50 > lastSma200) return 'bullish';
    if (lastClose < lastSma50 && lastSma50 < lastSma200) return 'bearish';
    return 'neutral';
  }

  if (lastClose > lastSma50) return 'bullish';
  if (lastClose < lastSma50) return 'bearish';
  return 'neutral';
}

/**
 * Combines two independent trend readings into an alignment score:
 *   both agree (bullish/bullish or bearish/bearish) -> 1.0, aligned
 *   either is neutral                                -> 0.5, not aligned
 *   directly conflicting (bullish vs bearish)         -> 0.0, not aligned
 */
export function computeAlignment(
  dailyTrend: TimeframeTrend,
  weeklyTrend: TimeframeTrend
): { aligned: boolean; alignmentScore: number } {
  if (dailyTrend === weeklyTrend && dailyTrend !== 'neutral') {
    return { aligned: true, alignmentScore: 1.0 };
  }
  if (dailyTrend === 'neutral' || weeklyTrend === 'neutral') {
    return { aligned: false, alignmentScore: 0.5 };
  }
  return { aligned: false, alignmentScore: 0.0 };
}

/**
 * Full multi-timeframe read: daily trend from the given daily candles,
 * weekly trend from candles aggregated up from the same daily series, and
 * how strongly the two agree.
 */
export function analyzeMultiTimeframe(dailyCandles: Candle[]): MultiTimeframeResult {
  const weeklyCandles = aggregateToWeekly(dailyCandles);

  const dailyCloses = dailyCandles.map((c) => c.close);
  const weeklyCloses = weeklyCandles.map((c) => c.close);

  const dailyTrend = determineTrend(dailyCloses, sma(dailyCloses, 50), sma(dailyCloses, 200));
  const weeklyTrend = determineTrend(weeklyCloses, sma(weeklyCloses, 50), sma(weeklyCloses, 200));

  const { aligned, alignmentScore } = computeAlignment(dailyTrend, weeklyTrend);

  return { weeklyTrend, dailyTrend, aligned, alignmentScore };
}
