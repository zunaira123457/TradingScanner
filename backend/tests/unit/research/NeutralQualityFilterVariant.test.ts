import { NeutralQualityFilterVariant, DEFAULT_NEUTRAL_QUALITY_FILTER_CONFIG } from '@/research/NeutralQualityFilterVariant';
import { Strategy, StrategyContext, StrategyResult } from '@/types/strategy';
import { IndicatorSnapshot } from '@/types/indicators';
import { Candle } from '@/types';

function makeSnapshot(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    date: new Date('2021-01-01'),
    close: 100,
    sma20: null, sma50: null, sma100: null, sma200: null,
    ema9: null, ema21: null, ema50: null, ema200: null,
    rsi14: 60, macd: null, macdSignal: null, macdHistogram: null,
    stochK: null, stochD: null, roc12: null,
    adx14: null, plusDI14: null, minusDI14: null,
    atr14: null, bbUpper: null, bbMiddle: null, bbLower: null, bbWidth: null,
    historicalVolatility20: null,
    volumeSma20: null, relativeVolume: null, obv: null, avgDollarVolume30: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  const candle: Candle = { timestamp: new Date('2021-01-01'), open: 100, high: 101, low: 99, close: 100, volume: 1_000_000 };
  return {
    ticker: 'TEST',
    candles: [candle],
    snapshots: [makeSnapshot()],
    structure: { trend: 'uptrend', lastSwingHigh: null, lastSwingLow: null, higherHigh: false, higherLow: false, lowerHigh: false, lowerLow: false },
    multiTimeframe: { weeklyTrend: 'bullish', dailyTrend: 'bullish', aligned: true, alignmentScore: 1 },
    marketRegime: null,
    relativeStrength: null,
    ...overrides,
  };
}

function detectedResult(): StrategyResult {
  return {
    strategy: 'momentum_continuation',
    ticker: 'TEST',
    date: new Date('2021-01-01'),
    setupDetected: true,
    confidence: 0.8,
    entry: 100,
    stop: 95,
    target: 110,
    riskPerShare: 5,
    rewardPerShare: 10,
    riskRewardRatio: 2,
    evidence: ['base evidence'],
    warnings: ['base warning'],
    supportingPatterns: [],
  };
}

function notDetectedResult(): StrategyResult {
  return { ...detectedResult(), setupDetected: false, confidence: 0, entry: null, stop: null, target: null, riskPerShare: null, rewardPerShare: null, riskRewardRatio: null, evidence: [], warnings: ['no setup'] };
}

function stubBase(result: StrategyResult): Strategy {
  return { name: 'momentum_continuation', description: 'stub', evaluate: () => result };
}

describe('NeutralQualityFilterVariant (Experiment 4 research variant)', () => {
  it('passes through a non-detected base result unchanged, regardless of regime', () => {
    const base = stubBase(notDetectedResult());
    const variant = new NeutralQualityFilterVariant(base as any);
    const context = makeContext({ marketRegime: { label: 'neutral', compositeScore: 0, isHighVolatility: false, indexScores: [] } });

    const result = variant.evaluate(context);

    expect(result.setupDetected).toBe(false);
    expect(result).toEqual(notDetectedResult());
  });

  it('passes through a detected base result UNCHANGED when regime is not neutral', () => {
    const base = stubBase(detectedResult());
    const variant = new NeutralQualityFilterVariant(base as any);
    const context = makeContext({ marketRegime: { label: 'bullish', compositeScore: 0.5, isHighVolatility: false, indexScores: [] } });

    const result = variant.evaluate(context);

    expect(result).toEqual(detectedResult());
  });

  it('passes through a detected base result UNCHANGED when regime is null (no index data)', () => {
    const base = stubBase(detectedResult());
    const variant = new NeutralQualityFilterVariant(base as any);
    const context = makeContext({ marketRegime: null });

    const result = variant.evaluate(context);

    expect(result).toEqual(detectedResult());
  });

  it('passes through UNCHANGED in neutral regime when both quality conditions hold', () => {
    const base = stubBase(detectedResult());
    const variant = new NeutralQualityFilterVariant(base as any);
    const context = makeContext({
      marketRegime: { label: 'neutral', compositeScore: 0, isHighVolatility: false, indexScores: [] },
      snapshots: [makeSnapshot({ rsi14: 60 })], // < 68
      relativeStrength: { periodDays: 63, stockReturn: 0.2, sectorReturn: null, benchmarkReturn: 0.05, vsSector: null, vsBenchmark: 0.15, sectorVsBenchmark: null, outperformingBoth: true, scoreAdjustment: 0.1 }, // > 0.10
    });

    const result = variant.evaluate(context);

    expect(result).toEqual(detectedResult());
  });

  it('filters OUT a neutral-regime setup when RSI14 >= 68 (fails the quality filter)', () => {
    const base = stubBase(detectedResult());
    const variant = new NeutralQualityFilterVariant(base as any);
    const context = makeContext({
      marketRegime: { label: 'neutral', compositeScore: 0, isHighVolatility: false, indexScores: [] },
      snapshots: [makeSnapshot({ rsi14: 70 })], // >= 68, fails
      relativeStrength: { periodDays: 63, stockReturn: 0.2, sectorReturn: null, benchmarkReturn: 0.05, vsSector: null, vsBenchmark: 0.15, sectorVsBenchmark: null, outperformingBoth: true, scoreAdjustment: 0.1 },
    });

    const result = variant.evaluate(context);

    expect(result.setupDetected).toBe(false);
    expect(result.entry).toBeNull();
    expect(result.warnings.some((w) => w.includes('Filtered out by Experiment 4'))).toBe(true);
  });

  it('filters OUT a neutral-regime setup when vsBenchmark <= 0.10 (fails the quality filter)', () => {
    const base = stubBase(detectedResult());
    const variant = new NeutralQualityFilterVariant(base as any);
    const context = makeContext({
      marketRegime: { label: 'neutral', compositeScore: 0, isHighVolatility: false, indexScores: [] },
      snapshots: [makeSnapshot({ rsi14: 60 })],
      relativeStrength: { periodDays: 63, stockReturn: 0.05, sectorReturn: null, benchmarkReturn: 0.05, vsSector: null, vsBenchmark: 0.05, sectorVsBenchmark: null, outperformingBoth: false, scoreAdjustment: -0.02 }, // <= 0.10, fails
    });

    const result = variant.evaluate(context);

    expect(result.setupDetected).toBe(false);
  });

  it('filters OUT a neutral-regime setup when relativeStrength is null (cannot verify the quality condition)', () => {
    const base = stubBase(detectedResult());
    const variant = new NeutralQualityFilterVariant(base as any);
    const context = makeContext({
      marketRegime: { label: 'neutral', compositeScore: 0, isHighVolatility: false, indexScores: [] },
      snapshots: [makeSnapshot({ rsi14: 60 })],
      relativeStrength: null,
    });

    const result = variant.evaluate(context);

    expect(result.setupDetected).toBe(false);
  });

  it('never rescues a setup the base strategy itself rejected, even if RSI/vsBenchmark would pass', () => {
    const base = stubBase(notDetectedResult());
    const variant = new NeutralQualityFilterVariant(base as any);
    const context = makeContext({
      marketRegime: { label: 'neutral', compositeScore: 0, isHighVolatility: false, indexScores: [] },
      snapshots: [makeSnapshot({ rsi14: 40 })],
      relativeStrength: { periodDays: 63, stockReturn: 0.3, sectorReturn: null, benchmarkReturn: 0.05, vsSector: null, vsBenchmark: 0.25, sectorVsBenchmark: null, outperformingBoth: true, scoreAdjustment: 0.15 },
    });

    const result = variant.evaluate(context);

    expect(result.setupDetected).toBe(false);
  });

  it('uses the pre-registered default thresholds (RSI < 68, vsBenchmark > 0.10)', () => {
    expect(DEFAULT_NEUTRAL_QUALITY_FILTER_CONFIG.maxRsiInNeutral).toBe(68);
    expect(DEFAULT_NEUTRAL_QUALITY_FILTER_CONFIG.minVsBenchmarkInNeutral).toBe(0.1);
  });
});
