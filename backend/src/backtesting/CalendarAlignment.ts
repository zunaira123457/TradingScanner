import { Candle } from '@/types';
import { dateKey, isLikelyTradingDay } from './USMarketCalendar';

export interface AlignmentReport {
  /** Number of dates present in EVERY series after alignment. */
  commonDates: number;
  /** Per-series count of dates that existed in that series but were dropped
   * because they weren't present in every other series. */
  droppedByLabel: Map<string, number>;
  /** Real NYSE trading days (per USMarketCalendar) within the aligned date
   * range that are missing from an individual series' OWN data — a genuine
   * data hole in that series, as opposed to a date correctly absent because
   * it's a weekend/holiday. */
  unexpectedGaps: Array<{ label: string; date: string }>;
}

/**
 * Joins multiple candle series by ACTUAL CALENDAR DATE (not raw array
 * index) and returns per-series arrays containing only dates common to
 * every input series, in chronological order. After this, index t in every
 * returned array refers to the same real trading day — a stronger,
 * genuinely date-verified guarantee than TradingCalendar.validateAlignedCalendars'
 * length+spot-check, which merely detects misalignment rather than fixing it.
 *
 * Use this to build a BacktestUniverse from raw (possibly slightly gappy or
 * differently-dated) per-ticker series before handing it to Backtester.run().
 */
export function alignSeriesByDate(
  seriesByLabel: Map<string, Candle[]>
): { aligned: Map<string, Candle[]>; report: AlignmentReport } {
  const labels = [...seriesByLabel.keys()];

  if (labels.length === 0) {
    return { aligned: new Map(), report: { commonDates: 0, droppedByLabel: new Map(), unexpectedGaps: [] } };
  }

  const perLabelMaps = new Map<string, Map<string, Candle>>();
  for (const [label, candles] of seriesByLabel) {
    const m = new Map<string, Candle>();
    for (const c of candles) m.set(dateKey(c.timestamp), c);
    perLabelMaps.set(label, m);
  }

  let commonKeys = new Set(perLabelMaps.get(labels[0])!.keys());
  for (let i = 1; i < labels.length; i++) {
    const thisKeys = new Set(perLabelMaps.get(labels[i])!.keys());
    commonKeys = new Set([...commonKeys].filter((k) => thisKeys.has(k)));
  }

  const sortedCommonKeys = [...commonKeys].sort();

  const aligned = new Map<string, Candle[]>();
  const droppedByLabel = new Map<string, number>();
  for (const [label, m] of perLabelMaps) {
    aligned.set(
      label,
      sortedCommonKeys.map((k) => m.get(k) as Candle)
    );
    droppedByLabel.set(label, m.size - sortedCommonKeys.length);
  }

  const unexpectedGaps: Array<{ label: string; date: string }> = [];
  if (sortedCommonKeys.length > 0) {
    // Parse "YYYY-MM-DD" into a LOCAL-time Date via numeric components —
    // new Date(dateString) parses date-only ISO strings as UTC midnight,
    // which silently shifts by a day (and can shift the computed weekday)
    // in any timezone behind UTC. dateKey()/isLikelyTradingDay() both
    // operate in local time, so this reconstruction must too.
    const parseLocalDateKey = (key: string): Date => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d);
    };
    const start = parseLocalDateKey(sortedCommonKeys[0]);
    const end = parseLocalDateKey(sortedCommonKeys[sortedCommonKeys.length - 1]);
    for (const [label, m] of perLabelMaps) {
      const d = new Date(start);
      while (d.getTime() <= end.getTime()) {
        if (isLikelyTradingDay(d)) {
          const k = dateKey(d);
          if (!m.has(k)) unexpectedGaps.push({ label, date: k });
        }
        d.setDate(d.getDate() + 1);
      }
    }
  }

  return { aligned, report: { commonDates: sortedCommonKeys.length, droppedByLabel, unexpectedGaps } };
}
