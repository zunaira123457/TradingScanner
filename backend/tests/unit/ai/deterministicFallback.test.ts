import { buildDeterministicFallback } from '@/ai/deterministicFallback';
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
    strategyWarnings: ['RSI is extended'],
    deterministicReasons: ['Trends aligned'],
    deterministicRisks: ['Underperforming benchmark'],
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
    historicalContext: {
      baseline: {
        strategy: 'momentum_continuation',
        trades: 226,
        profitFactor: 1.14,
        sharpe: 0.38,
        cagr: 3.71,
        expectancyPerTrade: 120.7,
        totalReturnPct: 27.33,
        medianStockPnlNegative: true,
        pctStocksProfitable: 40,
        concentrationNote: 'Concentrated in a few winners.',
        datasetDescription: '81-stock universe, in-sample/exploratory.',
      },
      regimeStats: {
        label: 'momentum_continuation / bullish',
        trades: 82,
        winRatePct: 30.5,
        profitFactor: null,
        note: null,
        sampleSizeSufficient: true,
      },
      tickerStats: {
        label: 'momentum_continuation / AAPL',
        trades: 2,
        winRatePct: 50,
        profitFactor: null,
        note: null,
        sampleSizeSufficient: false,
      },
    },
    ...overrides,
  };
}

describe('buildDeterministicFallback', () => {
  it('always sets aiConfidence to null', () => {
    const result = buildDeterministicFallback(makeContext());
    expect(result.aiConfidence).toBeNull();
  });

  it('uses the real deterministic score/classification, not an invented one', () => {
    const context = makeContext();
    const result = buildDeterministicFallback(context);

    expect(result.quantitativeScore.total).toBe(context.quantitativeScore.total);
    expect(result.quantitativeScore.classification).toBe(context.classification);
    expect(result.quantitativeScore.note.toLowerCase()).toContain('not a validated probability');
  });

  it('labels historical statistics as exploratory/in-sample, not validated', () => {
    const result = buildDeterministicFallback(makeContext());
    expect(result.historicalContext.note.toLowerCase()).toContain('exploratory');
    expect(result.historicalContext.baselineSummary).toContain('Concentrated in a few winners.');
  });

  it('marks a small ticker sample as insufficient rather than drawing a conclusion from it', () => {
    const result = buildDeterministicFallback(makeContext());
    expect(result.historicalContext.tickerSummary).toMatch(/insufficient sample/i);
    expect(result.historicalContext.tickerSummary).toContain('2 historical trade');
  });

  it('reports null historical context sections explicitly rather than omitting them', () => {
    const result = buildDeterministicFallback(
      makeContext({ historicalContext: { baseline: null, regimeStats: null, tickerStats: null } })
    );
    expect(result.historicalContext.baselineSummary).toBeNull();
    expect(result.historicalContext.regimeSummary).toBeNull();
    expect(result.historicalContext.tickerSummary).toBeNull();
    expect(result.limitations.some((l) => l.toLowerCase().includes('no historical strategy statistics'))).toBe(true);
  });

  it('surfaces deterministic risks as conflicting evidence / risk flags, without duplicating strategyWarnings already folded into deterministicRisks', () => {
    // In production, SignalExplainer.explainSignal builds deterministicRisks
    // starting from a copy of strategyResult.warnings, so deterministicRisks
    // is already a superset of strategyWarnings — re-appending
    // strategyWarnings here would duplicate entries (the bug this test
    // guards against).
    const context = makeContext();
    const result = buildDeterministicFallback(context);

    expect(result.riskFlags).toEqual(context.deterministicRisks);
    expect(result.conflictingEvidence).toEqual(context.deterministicRisks);
  });

  it('does not duplicate a warning that appears in both strategyWarnings and deterministicRisks', () => {
    const context = makeContext({
      strategyWarnings: ['RSI is extended'],
      deterministicRisks: ['RSI is extended', 'Underperforming benchmark'],
    });
    const result = buildDeterministicFallback(context);

    expect(result.conflictingEvidence.filter((e) => e === 'RSI is extended')).toHaveLength(1);
  });

  it('states that the AI is unavailable in the summary and limitations', () => {
    const result = buildDeterministicFallback(makeContext());
    expect(result.summary.toLowerCase()).toContain('ai analysis is unavailable');
    expect(result.limitations.some((l) => l.toLowerCase().includes('ai analysis is unavailable'))).toBe(true);
  });
});
