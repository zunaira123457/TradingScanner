import { explainSignal } from '@/scoring/SignalExplainer';
import { StrategyContext, StrategyResult } from '@/types/strategy';
import { ScoreBreakdown } from '@/types/scoring';
import { IndicatorSnapshot } from '@/types/indicators';

function makeSnapshot(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    date: new Date(), close: 100, sma20: 98, sma50: 95, sma100: 90, sma200: 85,
    ema9: 99, ema21: 97, ema50: 95, ema200: 85, rsi14: 55, macd: 1, macdSignal: 0.5,
    macdHistogram: 0.5, stochK: 60, stochD: 55, roc12: 5, adx14: 20, plusDI14: 25,
    minusDI14: 15, atr14: 2, bbUpper: 105, bbMiddle: 100, bbLower: 95, bbWidth: 0.1,
    historicalVolatility20: 0.25, volumeSma20: 1000000, relativeVolume: 1.0, obv: 500000,
    avgDollarVolume30: 100000000,
    ...overrides,
  };
}

function makeContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    ticker: 'AAPL',
    candles: [{ timestamp: new Date('2024-06-01'), open: 99, high: 101, low: 98, close: 100, volume: 1000000 }],
    snapshots: [makeSnapshot()],
    structure: { trend: 'uptrend', lastSwingHigh: null, lastSwingLow: null, higherHigh: true, higherLow: true, lowerHigh: false, lowerLow: false },
    multiTimeframe: { weeklyTrend: 'bullish', dailyTrend: 'bullish', aligned: true, alignmentScore: 1.0 },
    marketRegime: null,
    relativeStrength: null,
    ...overrides,
  };
}

function makeStrategyResult(overrides: Partial<StrategyResult> = {}): StrategyResult {
  return {
    strategy: 'trend_pullback', ticker: 'AAPL', date: new Date('2024-06-01'), setupDetected: true,
    confidence: 0.8, entry: 100, stop: 95, target: 115, riskPerShare: 5, rewardPerShare: 15,
    riskRewardRatio: 3.0, evidence: ['Price above 50 SMA'], warnings: [], supportingPatterns: [],
    ...overrides,
  };
}

const scoreBreakdown: ScoreBreakdown = {
  trend: 18, momentum: 12, volume: 10, relativeStrength: 8, chartSetup: 16, marketRegime: 4, riskReward: 9, total: 77,
};

describe('explainSignal', () => {
  it('should carry through strategy evidence/warnings and score/entry/stop/target', () => {
    const context = makeContext();
    const explanation = explainSignal(context, makeStrategyResult(), scoreBreakdown, 'BUY');

    expect(explanation.ticker).toBe('AAPL');
    expect(explanation.classification).toBe('BUY');
    expect(explanation.score).toBe(77);
    expect(explanation.entry).toBe(100);
    expect(explanation.stop).toBe(95);
    expect(explanation.target).toBe(115);
    expect(explanation.reasons).toContain('Price above 50 SMA');
    expect(explanation.invalidation).toBe('Price closes below $95.00');
  });

  it('should add an aligned-timeframe reason when multiTimeframe.aligned is true', () => {
    const context = makeContext({
      multiTimeframe: { weeklyTrend: 'bullish', dailyTrend: 'bullish', aligned: true, alignmentScore: 1.0 },
    });
    const explanation = explainSignal(context, makeStrategyResult(), scoreBreakdown, 'BUY');
    expect(explanation.reasons.some((r) => r.includes('aligned'))).toBe(true);
  });

  it('should add a conflicting-timeframe risk when trends directly conflict', () => {
    const context = makeContext({
      multiTimeframe: { weeklyTrend: 'bullish', dailyTrend: 'bearish', aligned: false, alignmentScore: 0.0 },
    });
    const explanation = explainSignal(context, makeStrategyResult(), scoreBreakdown, 'WATCH');
    expect(explanation.risks.some((r) => r.includes('conflict'))).toBe(true);
  });

  it('should add a bearish-regime risk and a bullish-regime reason appropriately', () => {
    const bearishContext = makeContext({
      marketRegime: { label: 'strong_bearish', compositeScore: -0.8, isHighVolatility: false, indexScores: [] },
    });
    const bearishExplanation = explainSignal(bearishContext, makeStrategyResult(), scoreBreakdown, 'WATCH');
    expect(bearishExplanation.risks.some((r) => r.includes('counter-regime'))).toBe(true);

    const bullishContext = makeContext({
      marketRegime: { label: 'strong_bullish', compositeScore: 0.8, isHighVolatility: false, indexScores: [] },
    });
    const bullishExplanation = explainSignal(bullishContext, makeStrategyResult(), scoreBreakdown, 'BUY');
    expect(bullishExplanation.reasons.some((r) => r.includes('strong bullish'))).toBe(true);
  });

  it('should flag high volatility regime as a risk', () => {
    const context = makeContext({
      marketRegime: { label: 'high_volatility', compositeScore: 0.1, isHighVolatility: true, indexScores: [] },
    });
    const explanation = explainSignal(context, makeStrategyResult(), scoreBreakdown, 'WATCH');
    expect(explanation.risks.some((r) => r.includes('elevated volatility'))).toBe(true);
  });

  it('should flag underperformance vs benchmark as a risk and outperformance as a reason', () => {
    const underperforming = makeContext({
      relativeStrength: { periodDays: 63, stockReturn: -0.05, sectorReturn: 0.02, benchmarkReturn: 0.03, vsSector: -0.07, vsBenchmark: -0.08, sectorVsBenchmark: -0.01, outperformingBoth: false, scoreAdjustment: -0.1 },
    });
    const underExplanation = explainSignal(underperforming, makeStrategyResult(), scoreBreakdown, 'WATCH');
    expect(underExplanation.risks.some((r) => r.includes('Underperforming'))).toBe(true);

    const outperforming = makeContext({
      relativeStrength: { periodDays: 63, stockReturn: 0.2, sectorReturn: 0.1, benchmarkReturn: 0.05, vsSector: 0.1, vsBenchmark: 0.15, sectorVsBenchmark: 0.05, outperformingBoth: true, scoreAdjustment: 0.15 },
    });
    const outExplanation = explainSignal(outperforming, makeStrategyResult(), scoreBreakdown, 'BUY');
    expect(outExplanation.reasons.some((r) => r.includes('Outperforming both'))).toBe(true);
  });

  it('should flag extended RSI and elevated historical volatility as risks', () => {
    const context = makeContext({ snapshots: [makeSnapshot({ rsi14: 82, historicalVolatility20: 0.75 })] });
    const explanation = explainSignal(context, makeStrategyResult(), scoreBreakdown, 'WATCH');
    expect(explanation.risks.some((r) => r.includes('RSI'))).toBe(true);
    expect(explanation.risks.some((r) => r.includes('volatility'))).toBe(true);
  });

  it('should report "no valid stop" invalidation text when stop is null', () => {
    const context = makeContext();
    const explanation = explainSignal(
      context,
      makeStrategyResult({ setupDetected: false, entry: null, stop: null, target: null, riskRewardRatio: null }),
      scoreBreakdown,
      'AVOID'
    );
    expect(explanation.invalidation).toContain('No valid stop level');
  });
});
