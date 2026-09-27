import { diffTrades, tradeKey, summarizeAIOutcome } from '@/paperTrading/PaperTradeRecord';
import { Trade } from '@/types/backtest';
import { AIAnalysisOutcome } from '@/types/ai';

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'T1',
    ticker: 'AAPL',
    strategy: 'momentum_continuation',
    signalDate: new Date(2026, 7, 19),
    entryDate: new Date(2026, 7, 20),
    entryPrice: 100,
    shares: 10,
    stopPrice: 95,
    targetPrice: 110,
    exitDate: null,
    exitPrice: null,
    exitReason: null,
    grossPnl: null,
    fees: 1,
    slippageCost: 0.5,
    netPnl: null,
    rMultiple: null,
    signalScore: 84,
    marketRegimeAtEntry: 'bullish',
    status: 'open',
    ...overrides,
  };
}

function openPosition(overrides: Partial<Trade> = {}): Trade {
  return makeTrade({
    exitDate: new Date(2026, 7, 21),
    exitPrice: 102,
    exitReason: 'end_of_data',
    grossPnl: 20,
    netPnl: 18.5,
    status: 'closed',
    ...overrides,
  });
}

function realClose(overrides: Partial<Trade> = {}): Trade {
  return makeTrade({
    exitDate: new Date(2026, 7, 22),
    exitPrice: 110,
    exitReason: 'target',
    grossPnl: 100,
    netPnl: 98,
    rMultiple: 2.0,
    status: 'closed',
    ...overrides,
  });
}

describe('tradeKey', () => {
  it('is stable across trades with the same ticker/entryDate/signalDate', () => {
    const a = makeTrade({ id: 'T1' });
    const b = makeTrade({ id: 'T99' }); // different id, same identity
    expect(tradeKey(a)).toBe(tradeKey(b));
  });

  it('differs when ticker, entryDate, or signalDate differ', () => {
    const base = makeTrade();
    expect(tradeKey(base)).not.toBe(tradeKey(makeTrade({ ticker: 'MSFT' })));
    expect(tradeKey(base)).not.toBe(tradeKey(makeTrade({ entryDate: new Date(2026, 7, 21) })));
    expect(tradeKey(base)).not.toBe(tradeKey(makeTrade({ signalDate: new Date(2026, 7, 18) })));
  });
});

describe('diffTrades', () => {
  it('on the very first run (previousTrades = null), classifies every trade as newlyOpened', () => {
    const current = [openPosition({ ticker: 'AAPL' }), realClose({ ticker: 'MSFT' })];
    const diff = diffTrades(null, current);

    expect(diff.newlyOpened.map((t) => t.ticker).sort()).toEqual(['AAPL', 'MSFT']);
    expect(diff.stillOpen.map((t) => t.ticker)).toEqual(['AAPL']);
    expect(diff.newlyClosed.map((t) => t.ticker)).toEqual(['MSFT']);
  });

  it('a position open before and STILL open now (advancing end_of_data) is neither newlyOpened nor newlyClosed — only stillOpen', () => {
    const yesterday = [openPosition({ ticker: 'AAPL', exitDate: new Date(2026, 7, 20) })];
    const today = [openPosition({ ticker: 'AAPL', exitDate: new Date(2026, 7, 21), netPnl: 25 })];

    const diff = diffTrades(yesterday, today);

    expect(diff.newlyOpened).toHaveLength(0);
    expect(diff.newlyClosed).toHaveLength(0);
    expect(diff.stillOpen.map((t) => t.ticker)).toEqual(['AAPL']);
  });

  it('a position open before that is now genuinely closed (stop/target) is newlyClosed, not stillOpen', () => {
    const yesterday = [openPosition({ ticker: 'AAPL' })];
    const today = [realClose({ ticker: 'AAPL', exitReason: 'stop', netPnl: -50 })];

    const diff = diffTrades(yesterday, today);

    expect(diff.newlyOpened).toHaveLength(0);
    expect(diff.stillOpen).toHaveLength(0);
    expect(diff.newlyClosed.map((t) => t.ticker)).toEqual(['AAPL']);
  });

  it('a trade already reported as closed in a prior run and unchanged now appears in none of the three lists', () => {
    const yesterday = [realClose({ ticker: 'AAPL' })];
    const today = [realClose({ ticker: 'AAPL' })]; // identical, still closed, already reported

    const diff = diffTrades(yesterday, today);

    expect(diff.newlyOpened).toHaveLength(0);
    expect(diff.newlyClosed).toHaveLength(0);
    expect(diff.stillOpen).toHaveLength(0);
  });

  it('a brand-new position that both opened AND closed within the gap since the last run is reported as BOTH newlyOpened and newlyClosed', () => {
    const yesterday: Trade[] = [];
    const today = [realClose({ ticker: 'TSLA' })]; // never seen before, already closed

    const diff = diffTrades(yesterday, today);

    expect(diff.newlyOpened.map((t) => t.ticker)).toEqual(['TSLA']);
    expect(diff.newlyClosed.map((t) => t.ticker)).toEqual(['TSLA']);
    expect(diff.stillOpen).toHaveLength(0);
  });

  it('a brand-new position that is still open is reported as BOTH newlyOpened and stillOpen', () => {
    const diff = diffTrades([], [openPosition({ ticker: 'NVDA' })]);

    expect(diff.newlyOpened.map((t) => t.ticker)).toEqual(['NVDA']);
    expect(diff.stillOpen.map((t) => t.ticker)).toEqual(['NVDA']);
    expect(diff.newlyClosed).toHaveLength(0);
  });

  it('handles a mix of multiple trades across all categories correctly in one diff', () => {
    const yesterday = [
      openPosition({ ticker: 'STILL_OPEN' }),
      openPosition({ ticker: 'WILL_CLOSE' }),
      realClose({ ticker: 'ALREADY_CLOSED' }),
    ];
    const today = [
      openPosition({ ticker: 'STILL_OPEN', exitDate: new Date(2026, 7, 22) }),
      realClose({ ticker: 'WILL_CLOSE', exitReason: 'target' }),
      realClose({ ticker: 'ALREADY_CLOSED' }),
      realClose({ ticker: 'BRAND_NEW' }),
    ];

    const diff = diffTrades(yesterday, today);

    expect(diff.stillOpen.map((t) => t.ticker)).toEqual(['STILL_OPEN']);
    expect(diff.newlyClosed.map((t) => t.ticker).sort()).toEqual(['BRAND_NEW', 'WILL_CLOSE']);
    expect(diff.newlyOpened.map((t) => t.ticker)).toEqual(['BRAND_NEW']);
  });
});

describe('summarizeAIOutcome', () => {
  it('projects the fields the report needs, from either an ai or fallback outcome', () => {
    const outcome: AIAnalysisOutcome = {
      status: 'ok',
      source: 'ai',
      result: {
        summary: 'Setup qualified based on strong ADX.',
        signalStatus: 'BUY',
        whyItQualified: [],
        supportingEvidence: [],
        conflictingEvidence: [],
        regimeContext: { regime: 'bullish', note: 'note' },
        historicalContext: { note: 'note', baselineSummary: null, regimeSummary: null, tickerSummary: null },
        riskFlags: [],
        limitations: [],
        quantitativeScore: { total: 84, classification: 'BUY', note: 'note' },
        aiConfidence: null,
      },
    };

    const summary = summarizeAIOutcome(outcome);

    expect(summary).toEqual({
      source: 'ai',
      summary: 'Setup qualified based on strong ADX.',
      signalStatus: 'BUY',
    });
  });
});
