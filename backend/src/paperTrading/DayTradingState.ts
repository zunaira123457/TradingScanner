import * as fs from 'fs';
import * as path from 'path';
import logger from '@/utils/logger';

const CST_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date key (YYYY-MM-DD) in America/Chicago — the day-trading operating day. */
export function currentDayTradingDateKey(now: Date = new Date()): string {
  return CST_DATE_FORMATTER.format(now); // en-CA formats as YYYY-MM-DD
}

export interface DayTradingPosition {
  ticker: string;
  quantity: number;
  parentOrderId: number;
  takeProfitOrderId: number;
  stopLossOrderId: number;
  /** currentDayTradingDateKey() at the moment this position was opened — how a rollover tells a stuck prior-day position apart from today's. */
  openedDate: string;
}

export interface DayTradingStateData {
  date: string; // YYYY-MM-DD, see currentDayTradingDateKey
  tradesExecutedToday: number;
  tickersTradedToday: string[];
  openPositions: DayTradingPosition[];
}

function freshState(date: string): DayTradingStateData {
  return { date, tradesExecutedToday: 0, tickersTradedToday: [], openPositions: [] };
}

/**
 * Loads day-trading state from disk. A missing or corrupted file is treated
 * as "no state yet" (this is a disposable operating cache, unlike
 * PaperTradingState's locked-forever config) rather than a hard error.
 *
 * On a date rollover, `tradesExecutedToday` resets (today's trade budget is
 * unrelated to yesterday's) but `openPositions` is CARRIED FORWARD, not
 * wiped — a position only leaves this list once the daemon has actually
 * confirmed it flattened (see flattenPositions in runIBKRDayTrading.ts). If
 * it were reset here, a position that failed to flatten (a crash, a TWS
 * hiccup, a process restarted the next morning) would silently disappear
 * from every check this system does, while still being open for real in the
 * account — the daemon would neither retry flattening it nor avoid opening
 * a second position in the same ticker. Every ticker with a still-open
 * carried-over position is seeded into today's tickersTradedToday so the
 * daemon won't add a fresh, unrelated position in that same ticker while
 * the stuck one is unresolved.
 */
export function loadDayTradingState(filePath: string, now: Date = new Date()): DayTradingStateData {
  const today = currentDayTradingDateKey(now);

  if (!fs.existsSync(filePath)) {
    return freshState(today);
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DayTradingStateData;
    const openPositions = raw.openPositions ?? [];

    if (raw.date !== today) {
      if (openPositions.length > 0) {
        logger.warn(
          `${openPositions.length} day-trading position(s) from ${raw.date} were never confirmed flattened — carrying them forward into ${today} for retry: ${openPositions.map((p) => p.ticker).join(', ')}`
        );
      }
      return {
        date: today,
        tradesExecutedToday: 0,
        tickersTradedToday: openPositions.map((p) => p.ticker),
        openPositions,
      };
    }

    return {
      date: raw.date,
      tradesExecutedToday: raw.tradesExecutedToday ?? 0,
      tickersTradedToday: raw.tickersTradedToday ?? [],
      openPositions,
    };
  } catch (error) {
    logger.warn(
      `Could not read/parse ${filePath} (${error instanceof Error ? error.message : error}) — starting a fresh day-trading state.`
    );
    return freshState(today);
  }
}

export function saveDayTradingState(filePath: string, state: DayTradingStateData): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

export function recordDayTrade(state: DayTradingStateData, position: DayTradingPosition): void {
  state.tradesExecutedToday += 1;
  state.tickersTradedToday.push(position.ticker);
  state.openPositions.push(position);
}

/** Positions opened on a day other than `today` — carried-over, unresolved, need flattening regardless of the trading-hours window. */
export function getStalePositions(state: DayTradingStateData, today: string): DayTradingPosition[] {
  return state.openPositions.filter((p) => p.openedDate !== today);
}

/** Removes one resolved (successfully flattened, or confirmed never filled) position from state.openPositions by ticker. */
export function removeOpenPosition(state: DayTradingStateData, ticker: string): void {
  state.openPositions = state.openPositions.filter((p) => p.ticker !== ticker);
}
