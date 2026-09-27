import {
  calculateScore,
  validateWeights,
  classifySignal,
  DEFAULT_SCORING_WEIGHTS,
  DEFAULT_CLASSIFICATION_THRESHOLDS,
} from '@/scoring/ScoringEngine';
import { ScoringWeights } from '@/types/scoring';
import { StrategyContext, StrategyResult } from '@/types/strategy';
import { IndicatorSnapshot } from '@/types/indicators';

function makeSnapshot(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    date: new Date(),
    close: 100,
    sma20: 98,
    sma50: 95,
    sma100: 90,
    sma200: 85,
    ema9: 99,
    ema21: 97,
    ema50: 95,
    ema200: 85,
    rsi14: 55,
    macd: 1,
    macdSignal: 0.5,
    macdHistogram: 0.5,
    stochK: 60,
    stochD: 55,
    roc12: 5,
    adx14: 20,
    plusDI14: 25,
    minusDI14: 15,
    atr14: 2,
    bbUpper: 105,
    bbMiddle: 100,
    bbLower: 95,
    bbWidth: 0.1,
    historicalVolatility20: 0.25,
    volumeSma20: 1000000,
    relativeVolume: 1.0,
    obv: 500000,
    avgDollarVolume30: 100000000,
    ...overrides,
  };
}

function makeContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  return {
    ticker: 'TEST',
    candles: [{ timestamp: new Date(), open: 99, high: 101, low: 98, close: 100, volume: 1000000 }],
    snapshots: [makeSnapshot()],
    structure: {
      trend: 'uptrend',
      lastSwingHigh: null,
      lastSwingLow: null,
      higherHigh: true,
      higherLow: true,
      lowerHigh: false,
      lowerLow: false,
    },
    multiTimeframe: { weeklyTrend: 'bullish', dailyTrend: 'bullish', aligned: true, alignmentScore: 1.0 },
    marketRegime: null,
    relativeStrength: null,
    ...overrides,
  };
}

function makeStrategyResult(overrides: Partial<StrategyResult> = {}): StrategyResult {
  return {
    strategy: 'test_strategy',
    ticker: 'TEST',
    date: new Date(),
    setupDetected: true,
    confidence: 0.8,
    entry: 100,
    stop: 95,
    target: 115,
    riskPerShare: 5,
    rewardPerShare: 15,
    riskRewardRatio: 3.0,
    evidence: [],
    warnings: [],
    supportingPatterns: [],
    ...overrides,
  };
}

/** Isolates one scoring category by setting its weight to 1.0 and all others to 0. */
function isolateWeight(key: keyof ScoringWeights): ScoringWeights {
  const weights: ScoringWeights = {
    trend: 0,
    momentum: 0,
    volume: 0,
    relativeStrength: 0,
    chartSetup: 0,
    marketRegime: 0,
    riskReward: 0,
  };
  weights[key] = 1.0;
  return weights;
}

describe('ScoringEngine', () => {
  describe('validateWeights', () => {
    it('should accept the default weights (they sum to 1.0)', () => {
      expect(() => validateWeights(DEFAULT_SCORING_WEIGHTS)).not.toThrow();
    });

    it('should reject weights that do not sum to 1.0', () => {
      const bad: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS, trend: 0.5 };
      expect(() => validateWeights(bad)).toThrow(/sum to 1.0/);
    });

    it('should reject a negative weight even when the sum is still 1.0', () => {
      // trend -0.3 offset by chartSetup +0.3 keeps the sum at 1.0, isolating
      // the negative-value check from the sum-to-1.0 check.
      const bad: ScoringWeights = { ...DEFAULT_SCORING_WEIGHTS, trend: -0.1, chartSetup: 0.5 };
      expect(() => validateWeights(bad)).toThrow(/non-negative/);
    });
  });

  describe('trend component', () => {
    it('should score 1.0 for full alignment + uptrend structure', () => {
      const context = makeContext({
        multiTimeframe: { weeklyTrend: 'bullish', dailyTrend: 'bullish', aligned: true, alignmentScore: 1.0 },
        structure: { trend: 'uptrend', lastSwingHigh: null, lastSwingLow: null, higherHigh: true, higherLow: true, lowerHigh: false, lowerLow: false },
      });
      const result = calculateScore(context, makeStrategyResult(), isolateWeight('trend'));
      expect(result.total).toBeCloseTo(100, 6);
    });

    it('should score 0.0 for full conflict + downtrend structure', () => {
      const context = makeContext({
        multiTimeframe: { weeklyTrend: 'bullish', dailyTrend: 'bearish', aligned: false, alignmentScore: 0.0 },
        structure: { trend: 'downtrend', lastSwingHigh: null, lastSwingLow: null, higherHigh: false, higherLow: false, lowerHigh: true, lowerLow: true },
      });
      const result = calculateScore(context, makeStrategyResult(), isolateWeight('trend'));
      expect(result.total).toBeCloseTo(0, 6);
    });

    it('should score 0.5 for neutral alignment + sideways structure', () => {
      const context = makeContext({
        multiTimeframe: { weeklyTrend: 'bullish', dailyTrend: 'neutral', aligned: false, alignmentScore: 0.5 },
        structure: { trend: 'sideways', lastSwingHigh: null, lastSwingLow: null, higherHigh: false, higherLow: false, lowerHigh: false, lowerLow: false },
      });
      const result = calculateScore(context, makeStrategyResult(), isolateWeight('trend'));
      expect(result.total).toBeCloseTo(50, 6);
    });
  });

  describe('momentum component', () => {
    it('should score high for RSI=70, positive MACD, strong bullish ADX', () => {
      const context = makeContext({
        snapshots: [makeSnapshot({ rsi14: 70, macdHistogram: 1, adx14: 40, plusDI14: 30, minusDI14: 10 })],
      });
      // rsiScore=(70-30)/40=1.0, macdScore=1, adxScore=min(1,40/40)*1=1
      // momentum = 0.4*1+0.3*1+0.3*1 = 1.0
      const result = calculateScore(context, makeStrategyResult(), isolateWeight('momentum'));
      expect(result.total).toBeCloseTo(100, 6);
    });

    it('should score 0 for RSI<=30, negative MACD, bearish-directed ADX', () => {
      const context = makeContext({
        snapshots: [makeSnapshot({ rsi14: 30, macdHistogram: -1, adx14: 40, plusDI14: 10, minusDI14: 30 })],
      });
      // rsiScore=0, macdScore=0, adxScore = min(1,40/40)*(10>30?1:0)=0
      const result = calculateScore(context, makeStrategyResult(), isolateWeight('momentum'));
      expect(result.total).toBeCloseTo(0, 6);
    });

    it('should default each null sub-component to 0.5', () => {
      const context = makeContext({
        snapshots: [makeSnapshot({ rsi14: null, macdHistogram: null, adx14: null, plusDI14: null, minusDI14: null })],
      });
      // momentum = 0.4*0.5 + 0.3*0.5 + 0.3*0.5 = 0.5
      const result = calculateScore(context, makeStrategyResult(), isolateWeight('momentum'));
      expect(result.total).toBeCloseTo(50, 6);
    });
  });

  describe('volume component', () => {
    it('should score 1.0 at 2x relative volume and cap there', () => {
      const context = makeContext({ snapshots: [makeSnapshot({ relativeVolume: 2.0 })] });
      expect(calculateScore(context, makeStrategyResult(), isolateWeight('volume')).total).toBeCloseTo(100, 6);

      const contextOver = makeContext({ snapshots: [makeSnapshot({ relativeVolume: 5.0 })] });
      expect(calculateScore(contextOver, makeStrategyResult(), isolateWeight('volume')).total).toBeCloseTo(100, 6);
    });

    it('should score linearly below 2x, e.g. 1.0x -> 50', () => {
      const context = makeContext({ snapshots: [makeSnapshot({ relativeVolume: 1.0 })] });
      expect(calculateScore(context, makeStrategyResult(), isolateWeight('volume')).total).toBeCloseTo(50, 6);
    });

    it('should default to 0.5 when relative volume is null', () => {
      const context = makeContext({ snapshots: [makeSnapshot({ relativeVolume: null })] });
      expect(calculateScore(context, makeStrategyResult(), isolateWeight('volume')).total).toBeCloseTo(50, 6);
    });
  });

  describe('relativeStrength component', () => {
    it('should score 1.0 at the maximum scoreAdjustment (+0.15)', () => {
      const context = makeContext({
        relativeStrength: { periodDays: 63, stockReturn: 0.2, sectorReturn: 0.1, benchmarkReturn: 0.05, vsSector: 0.1, vsBenchmark: 0.15, sectorVsBenchmark: 0.05, outperformingBoth: true, scoreAdjustment: 0.15 },
      });
      expect(calculateScore(context, makeStrategyResult(), isolateWeight('relativeStrength')).total).toBeCloseTo(100, 6);
    });

    it('should score 0.0 at the minimum scoreAdjustment (-0.10)', () => {
      const context = makeContext({
        relativeStrength: { periodDays: 63, stockReturn: -0.1, sectorReturn: 0.02, benchmarkReturn: 0.03, vsSector: -0.12, vsBenchmark: -0.13, sectorVsBenchmark: -0.01, outperformingBoth: false, scoreAdjustment: -0.1 },
      });
      expect(calculateScore(context, makeStrategyResult(), isolateWeight('relativeStrength')).total).toBeCloseTo(0, 6);
    });

    it('should default to 0.5 when relative strength data is unavailable', () => {
      const context = makeContext({ relativeStrength: null });
      expect(calculateScore(context, makeStrategyResult(), isolateWeight('relativeStrength')).total).toBeCloseTo(50, 6);
    });
  });

  describe('chartSetup component', () => {
    it('should equal the strategy result confidence directly', () => {
      const context = makeContext();
      const result = calculateScore(context, makeStrategyResult({ confidence: 0.73 }), isolateWeight('chartSetup'));
      expect(result.total).toBeCloseTo(73, 6);
    });
  });

  describe('marketRegime component', () => {
    it('should map each regime label to its fixed score', () => {
      const cases: Array<[string, number]> = [
        ['strong_bullish', 100],
        ['bullish', 75],
        ['neutral', 50],
        ['bearish', 25],
        ['strong_bearish', 0],
        ['high_volatility', 30],
      ];
      for (const [label, expected] of cases) {
        const context = makeContext({
          marketRegime: { label: label as any, compositeScore: 0, isHighVolatility: label === 'high_volatility', indexScores: [] },
        });
        const result = calculateScore(context, makeStrategyResult(), isolateWeight('marketRegime'));
        expect(result.total).toBeCloseTo(expected, 6);
      }
    });

    it('should default to 0.5 (50) when market regime is unavailable', () => {
      const context = makeContext({ marketRegime: null });
      expect(calculateScore(context, makeStrategyResult(), isolateWeight('marketRegime')).total).toBeCloseTo(50, 6);
    });
  });

  describe('riskReward component', () => {
    it('should score 1.0 at a 3:1 ratio and cap there', () => {
      const context = makeContext();
      expect(
        calculateScore(context, makeStrategyResult({ riskRewardRatio: 3.0 }), isolateWeight('riskReward')).total
      ).toBeCloseTo(100, 6);
      expect(
        calculateScore(context, makeStrategyResult({ riskRewardRatio: 10.0 }), isolateWeight('riskReward')).total
      ).toBeCloseTo(100, 6);
    });

    it('should score 0 for a null or non-positive ratio', () => {
      const context = makeContext();
      expect(
        calculateScore(context, makeStrategyResult({ riskRewardRatio: null }), isolateWeight('riskReward')).total
      ).toBeCloseTo(0, 6);
      expect(
        calculateScore(context, makeStrategyResult({ riskRewardRatio: -1 }), isolateWeight('riskReward')).total
      ).toBeCloseTo(0, 6);
    });
  });

  describe('calculateScore (full default weights)', () => {
    it('should sum all weighted components to the total', () => {
      const context = makeContext();
      const result = calculateScore(context, makeStrategyResult(), DEFAULT_SCORING_WEIGHTS);
      const sum =
        result.trend + result.momentum + result.volume + result.relativeStrength + result.chartSetup + result.marketRegime + result.riskReward;
      expect(result.total).toBeCloseTo(sum, 8);
      expect(result.total).toBeGreaterThanOrEqual(0);
      expect(result.total).toBeLessThanOrEqual(100);
    });
  });

  describe('classifySignal', () => {
    it('should return AVOID when no setup was detected, regardless of score', () => {
      expect(classifySignal(95, false)).toBe('AVOID');
    });

    it('should return BUY at or above the buy threshold with a detected setup', () => {
      expect(classifySignal(DEFAULT_CLASSIFICATION_THRESHOLDS.buy, true)).toBe('BUY');
      expect(classifySignal(90, true)).toBe('BUY');
    });

    it('should return WATCH between the watch and buy thresholds', () => {
      expect(classifySignal(DEFAULT_CLASSIFICATION_THRESHOLDS.watch, true)).toBe('WATCH');
      expect(classifySignal(60, true)).toBe('WATCH');
    });

    it('should return AVOID below the watch threshold even with a detected setup', () => {
      expect(classifySignal(49, true)).toBe('AVOID');
    });
  });
});
