import { Candle } from '@/types';
import { dateKey } from '@/backtesting/USMarketCalendar';

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateKey(key: string): boolean {
  return DATE_KEY_PATTERN.test(key);
}

/**
 * Parses a "YYYY-MM-DD" string as a LOCAL date — never `new Date(dateString)`,
 * which parses as UTC and can read back as the PREVIOUS calendar day once run
 * through dateKey()'s local-time getters (the exact bug this project has hit
 * twice already: CalendarAlignment.ts historically, and a test in this
 * session's Experiment 5 work). Always construct dates the way every other
 * candle fixture/date in this codebase does: `new Date(year, month, day)`.
 */
export function parseDateKey(key: string): Date {
  if (!isValidDateKey(key)) {
    throw new Error(`Cannot parse malformed date key (expected "YYYY-MM-DD", got: ${key})`);
  }
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Exact-date-match index lookup, same pattern as TradeFeatureExtractor.ts's
 * private helper — exported here since this is a second consumer. */
export function findIndexForDate(candles: Candle[], date: Date): number {
  const key = dateKey(date);
  return candles.findIndex((c) => dateKey(c.timestamp) === key);
}

export class LockedDateNotFoundError extends Error {
  constructor(lockedDate: string, seriesRange: string) {
    super(
      `Paper trading's locked start date (${lockedDate}) was not found in the freshly-aligned candle series (available range: ${seriesRange}). Refusing to silently fall back to a nearby date — that would shift the paper account's starting baseline without anyone noticing.`
    );
    this.name = 'LockedDateNotFoundError';
  }
}

/**
 * Resolves the locked start date to an index in a freshly-rebuilt aligned
 * series. Never caches the resulting index across runs — the aligned array
 * can differ in size/contents run to run (more days appended, or a ticker
 * excluded by the data-quality audit), so this must be re-resolved every
 * single tick.
 */
export function resolveLockedStartIndex(benchmarkCandles: Candle[], lockedStartDate: string): number {
  if (benchmarkCandles.length === 0) {
    throw new LockedDateNotFoundError(lockedStartDate, '(empty series)');
  }
  const targetDate = parseDateKey(lockedStartDate);
  const index = findIndexForDate(benchmarkCandles, targetDate);
  if (index === -1) {
    const start = dateKey(benchmarkCandles[0].timestamp);
    const end = dateKey(benchmarkCandles[benchmarkCandles.length - 1].timestamp);
    throw new LockedDateNotFoundError(lockedStartDate, `${start} to ${end}`);
  }
  return index;
}
