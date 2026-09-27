import { validateAIAnalysisResult, MalformedAIOutputError } from '@/ai/validateAIAnalysisResult';
import { AIAnalysisContext } from '@/types/ai';

function makeContext(overrides: Partial<AIAnalysisContext> = {}): AIAnalysisContext {
  return {
    ticker: 'AAPL',
    strategy: 'momentum_continuation',
    asOfDate: new Date('2024-05-01'),
    setupDetected: true,
    entry: 100,
    stop: 95,
    target: 112.5,
    riskRewardRatio: 2.5,
    classification: 'BUY',
    quantitativeScore: {
      trend: 15,
      momentum: 10,
      volume: 10,
      relativeStrength: 10,
      chartSetup: 15,
      marketRegime: 4,
      riskReward: 8,
      total: 84,
    },
    strategyEvidence: ['ADX above threshold'],
    strategyWarnings: [],
    deterministicReasons: ['Trends aligned'],
    deterministicRisks: [],
    invalidation: 'Price closes below $95.00',
    indicators: {
      close: 100,
      rsi14: 68,
      adx14: 31,
      plusDI14: 28,
      minusDI14: 15,
      macdHistogram: 0.5,
      atr14: 2.1,
      relativeVolume: 1.3,
      historicalVolatility20: 0.3,
      sma50: 95,
      sma200: 88,
    },
    trendStructure: 'uptrend',
    dailyTrend: 'bullish',
    weeklyTrend: 'bullish',
    mtfAligned: true,
    marketRegime: { label: 'bullish', compositeScore: 0.6, isHighVolatility: false },
    relativeStrength: { vsBenchmark: 0.1, vsSector: 0.05, outperformingBoth: true, periodDays: 63 },
    historicalContext: { baseline: null, regimeStats: null, tickerStats: null },
    ...overrides,
  };
}

function validRawResponse(): Record<string, unknown> {
  return {
    summary: 'The setup qualified based on ADX and RSI.',
    signalStatus: 'BUY',
    whyItQualified: ['ADX14 is 31, above the strategy minimum'],
    supportingEvidence: ['RSI14 is 68'],
    conflictingEvidence: [],
    regimeContext: { regime: 'bullish', note: 'Regime is bullish.' },
    historicalContext: {
      note: 'Exploratory/in-sample only.',
      baselineSummary: null,
      regimeSummary: null,
      tickerSummary: null,
    },
    riskFlags: [],
    limitations: ['Score is not a validated probability.'],
    quantitativeScore: { total: 999, classification: 'AVOID', note: 'model-supplied note, should be discarded' },
    aiConfidence: null,
  };
}

describe('validateAIAnalysisResult', () => {
  it('accepts a well-formed response and passes through the narrative fields', () => {
    const context = makeContext();
    const result = validateAIAnalysisResult(validRawResponse(), context);

    expect(result.summary).toBe('The setup qualified based on ADX and RSI.');
    expect(result.whyItQualified).toEqual(['ADX14 is 31, above the strategy minimum']);
  });

  it('always overwrites aiConfidence to null, even if the model returns a number', () => {
    const context = makeContext();
    const raw = { ...validRawResponse(), aiConfidence: 0.87 };

    const result = validateAIAnalysisResult(raw, context);

    expect(result.aiConfidence).toBeNull();
  });

  it('always re-derives quantitativeScore from context, never trusting the model echo', () => {
    const context = makeContext();
    // The model tries to report a different score/classification than the
    // deterministic engine actually computed.
    const raw = {
      ...validRawResponse(),
      quantitativeScore: { total: 12, classification: 'AVOID', note: 'fabricated' },
    };

    const result = validateAIAnalysisResult(raw, context);

    expect(result.quantitativeScore.total).toBe(context.quantitativeScore.total);
    expect(result.quantitativeScore.classification).toBe(context.classification);
    expect(result.quantitativeScore.note).not.toBe('fabricated');
  });

  it('never describes the quantitative score as a probability', () => {
    const context = makeContext();
    const result = validateAIAnalysisResult(validRawResponse(), context);

    expect(result.quantitativeScore.note.toLowerCase()).toContain('not a validated probability');
  });

  it('always re-derives regimeContext.regime from context, never from the model', () => {
    const context = makeContext({ marketRegime: { label: 'strong_bullish', compositeScore: 0.9, isHighVolatility: false } });
    const raw = { ...validRawResponse(), regimeContext: { regime: 'bearish', note: 'model claim' } };

    const result = validateAIAnalysisResult(raw, context);

    expect(result.regimeContext.regime).toBe('strong_bullish');
  });

  it.each([
    ['missing summary', { ...validRawResponse(), summary: undefined }],
    ['non-string summary', { ...validRawResponse(), summary: 42 }],
    ['non-array whyItQualified', { ...validRawResponse(), whyItQualified: 'not an array' }],
    ['array with non-string elements', { ...validRawResponse(), riskFlags: ['ok', 5] }],
    ['missing regimeContext', (() => { const r = validRawResponse(); delete (r as any).regimeContext; return r; })()],
    ['missing historicalContext.note', { ...validRawResponse(), historicalContext: { baselineSummary: null } }],
    ['response is a string, not an object', 'just some prose'],
    ['response is null', null],
  ])('rejects malformed output: %s', (_label, raw) => {
    const context = makeContext();
    expect(() => validateAIAnalysisResult(raw, context)).toThrow(MalformedAIOutputError);
  });
});
