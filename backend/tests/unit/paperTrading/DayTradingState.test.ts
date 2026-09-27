import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  currentDayTradingDateKey,
  loadDayTradingState,
  saveDayTradingState,
  recordDayTrade,
  getStalePositions,
  removeOpenPosition,
  DayTradingPosition,
} from '@/paperTrading/DayTradingState';

describe('DayTradingState', () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daytrading-state-test-'));
    filePath = path.join(dir, 'daytrading-state.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const position: DayTradingPosition = {
    ticker: 'AAPL',
    quantity: 10,
    parentOrderId: 1,
    takeProfitOrderId: 2,
    stopLossOrderId: 3,
    openedDate: '2024-01-16',
  };

  it('should return a fresh empty state when no file exists yet', () => {
    const now = new Date('2024-01-17T16:00:00.000Z');
    const state = loadDayTradingState(filePath, now);

    expect(state.date).toBe(currentDayTradingDateKey(now));
    expect(state.tradesExecutedToday).toBe(0);
    expect(state.tickersTradedToday).toEqual([]);
    expect(state.openPositions).toEqual([]);
  });

  it('should round-trip a recorded trade through save/load', () => {
    const now = new Date('2024-01-17T16:00:00.000Z');
    const state = loadDayTradingState(filePath, now);
    const todaysPosition = { ...position, openedDate: currentDayTradingDateKey(now) };
    recordDayTrade(state, todaysPosition);
    saveDayTradingState(filePath, state);

    const reloaded = loadDayTradingState(filePath, now);
    expect(reloaded.tradesExecutedToday).toBe(1);
    expect(reloaded.tickersTradedToday).toEqual(['AAPL']);
    expect(reloaded.openPositions).toEqual([todaysPosition]);
  });

  it('should reset tradesExecutedToday/tickersTradedToday on a date rollover when nothing is left open', () => {
    const yesterday = new Date('2024-01-16T16:00:00.000Z');
    const state = loadDayTradingState(filePath, yesterday);
    const closedPositionTicker = 'MSFT';
    state.tradesExecutedToday = 1;
    state.tickersTradedToday = [closedPositionTicker];
    // openPositions intentionally left empty — that trade already closed normally yesterday.
    saveDayTradingState(filePath, state);

    const today = new Date('2024-01-17T16:00:00.000Z');
    const reloaded = loadDayTradingState(filePath, today);

    expect(reloaded.date).toBe(currentDayTradingDateKey(today));
    expect(reloaded.tradesExecutedToday).toBe(0);
    expect(reloaded.tickersTradedToday).toEqual([]);
    expect(reloaded.openPositions).toEqual([]);
  });

  it('BUG FIX: should carry forward a position never confirmed flattened across a date rollover, not silently drop it', () => {
    const yesterday = new Date('2024-01-16T16:00:00.000Z');
    const state = loadDayTradingState(filePath, yesterday);
    recordDayTrade(state, position); // never "resolved" — simulates a flatten that failed or was never attempted
    saveDayTradingState(filePath, state);

    const today = new Date('2024-01-17T16:00:00.000Z');
    const reloaded = loadDayTradingState(filePath, today);

    expect(reloaded.date).toBe(currentDayTradingDateKey(today));
    // Today's own trade budget/history resets...
    expect(reloaded.tradesExecutedToday).toBe(0);
    // ...but the stuck position, and a guard against re-entering the same
    // ticker while it's unresolved, both carry forward.
    expect(reloaded.openPositions).toEqual([position]);
    expect(reloaded.tickersTradedToday).toEqual(['AAPL']);
  });

  it('should treat a corrupted file as no prior state rather than throwing', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, '{not valid json');

    const now = new Date('2024-01-17T16:00:00.000Z');
    expect(() => loadDayTradingState(filePath, now)).not.toThrow();
    const state = loadDayTradingState(filePath, now);
    expect(state.tradesExecutedToday).toBe(0);
  });

  describe('getStalePositions', () => {
    it('should return only positions not opened today', () => {
      const state = loadDayTradingState(filePath, new Date('2024-01-17T16:00:00.000Z'));
      const staleOne = { ...position, ticker: 'AAPL', openedDate: '2024-01-16' };
      const freshOne = { ...position, ticker: 'MSFT', openedDate: '2024-01-17' };
      state.openPositions = [staleOne, freshOne];

      expect(getStalePositions(state, '2024-01-17')).toEqual([staleOne]);
    });
  });

  describe('removeOpenPosition', () => {
    it('should remove only the named ticker, leaving trade counts and other positions untouched', () => {
      const state = loadDayTradingState(filePath, new Date('2024-01-17T16:00:00.000Z'));
      const other = { ...position, ticker: 'MSFT' };
      recordDayTrade(state, position);
      recordDayTrade(state, other);

      removeOpenPosition(state, 'AAPL');

      expect(state.openPositions).toEqual([other]);
      expect(state.tradesExecutedToday).toBe(2);
      expect(state.tickersTradedToday).toEqual(['AAPL', 'MSFT']);
    });
  });
});
