import {
  BullishMomentumGateVariant,
  buildSpyRoc12ByDate,
  DEFAULT_BULLISH_MOMENTUM_GATE_CONFIG,
} from '@/research/BullishMomentumGateVariant';
import { dateKey } from '@/backtesting/USMarketCalendar';
import { Strategy, StrategyContext, StrategyResult } from '@/types/strategy';
import { IndicatorSnapshot } from '@/types/indicators';
import { Candle } from '@/types';

// Local-time constructor throughout, matching production convention
// (see c() below and every strategy/candle fixture elsewhere in this repo)
// — new Date('2021-01-20') parses as UTC, which dateKey()'s local-time
// getters can read back as a DIFFERENT calendar day depending on the
// machine's timezone. This was caught by a real test failure; see
// PROJECT_STATE.md Section 11 for the same class of bug found previously
// in CalendarAlignment.ts.
const TEST_DATE = new Date(2021, 0, 20);

function c(close: number, dayOffset: number): Candle {
  return { timestamp: new Date(2021, 0, 1 + dayOffset), open: close, high: close, low: close, close, volume: 1_000_000 };
}

function makeSnapshot(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    date: TEST_DATE, close: 100,
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
  const candle: Candle = { timestamp: TEST_DATE, open: 100, high: 101, low: 99, close: 100, volume: 1_000_000 };
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
    strategy: 'momentum_continuation', ticker: 'TEST', date: TEST_DATE,
    setupDetected: true, confidence: 0.8, entry: 100, stop: 95, target: 110,
    riskPerShare: 5, rewardPerShare: 10, riskRewardRatio: 2,
    evidence: ['base evidence'], warnings: ['base warning'], supportingPatterns: [],
  };
}

function notDetectedResult(): StrategyResult {
  return { ...detectedResult(), setupDetected: false, confidence: 0, entry: null, stop: null, target: null, riskPerShare: null, rewardPerShare: null, riskRewardRatio: null, evidence: [], warnings: ['no setup'] };
}

function stubBase(result: StrategyResult): Strategy {
  return { name: 'momentum_continuation', description: 'stub', evaluate: () => result };
}

describe('buildSpyRoc12ByDate', () => {
  it('computes a positive 12-day ROC for a rising benchmark series and keys it by date', () => {
    // 20 flat days at 100, then a rise to 110 by day 19 (index 19): roc at day19 = (close[19]-close[7])/close[7]
    const candles = Array.from({ length: 20 }, (_, i) => c(100 + i, i));
    const map = buildSpyRoc12ByDate(candles);
    const last = candles[candles.length - 1];
    const key = last.timestamp.toISOString().slice(0, 10);
    expect(map.has(key)).toBe(true);
    expect(map.get(key)).toBeGreaterThan(0);
  });

  it('does not include a date before 12 days of history exist', () => {
    const candles = Array.from({ length: 5 }, (_, i) => c(100, i));
    const map = buildSpyRoc12ByDate(candles);
    expect(map.size).toBe(0);
  });
});

describe('BullishMomentumGateVariant (Experiment 5 research variant)', () => {
  const spyRoc12ByDate = new Map<string, number>();
  const testDateKey = dateKey(TEST_DATE);

  beforeEach(() => spyRoc12ByDate.clear());

  it('passes through a non-detected base result unchanged, regardless of regime', () => {
    spyRoc12ByDate.set(testDateKey, 5);
    const variant = new BullishMomentumGateVariant(spyRoc12ByDate, stubBase(notDetectedResult()) as any);
    const context = makeContext({ marketRegime: { label: 'bullish', compositeScore: 0.3, isHighVolatility: false, indexScores: [] } });

    expect(variant.evaluate(context)).toEqual(notDetectedResult());
  });

  it('passes through a detected base result UNCHANGED when regime is not bullish', () => {
    const variant = new BullishMomentumGateVariant(spyRoc12ByDate, stubBase(detectedResult()) as any);
    const context = makeContext({ marketRegime: { label: 'strong_bullish', compositeScore: 0.8, isHighVolatility: false, indexScores: [] } });

    expect(variant.evaluate(context)).toEqual(detectedResult());
  });

  it('passes through a detected base result UNCHANGED when regime is null', () => {
    const variant = new BullishMomentumGateVariant(spyRoc12ByDate, stubBase(detectedResult()) as any);
    const context = makeContext({ marketRegime: null });

    expect(variant.evaluate(context)).toEqual(detectedResult());
  });

  it('passes through UNCHANGED in bullish regime when SPY 12-day ROC is positive', () => {
    spyRoc12ByDate.set(testDateKey, 2.5);
    const variant = new BullishMomentumGateVariant(spyRoc12ByDate, stubBase(detectedResult()) as any);
    const context = makeContext({ marketRegime: { label: 'bullish', compositeScore: 0.3, isHighVolatility: false, indexScores: [] } });

    expect(variant.evaluate(context)).toEqual(detectedResult());
  });

  it('filters OUT a bullish-regime setup when SPY 12-day ROC is negative', () => {
    spyRoc12ByDate.set(testDateKey, -1.2);
    const variant = new BullishMomentumGateVariant(spyRoc12ByDate, stubBase(detectedResult()) as any);
    const context = makeContext({ marketRegime: { label: 'bullish', compositeScore: 0.3, isHighVolatility: false, indexScores: [] } });

    const result = variant.evaluate(context);

    expect(result.setupDetected).toBe(false);
    expect(result.entry).toBeNull();
    expect(result.warnings.some((w) => w.includes('Filtered out by Experiment 5'))).toBe(true);
  });

  it('filters OUT a bullish-regime setup when SPY 12-day ROC is exactly 0 (strict > required)', () => {
    spyRoc12ByDate.set(testDateKey, 0);
    const variant = new BullishMomentumGateVariant(spyRoc12ByDate, stubBase(detectedResult()) as any);
    const context = makeContext({ marketRegime: { label: 'bullish', compositeScore: 0.3, isHighVolatility: false, indexScores: [] } });

    expect(variant.evaluate(context).setupDetected).toBe(false);
  });

  it('filters OUT when SPY ROC for that date is unavailable (insufficient history)', () => {
    const variant = new BullishMomentumGateVariant(spyRoc12ByDate, stubBase(detectedResult()) as any); // map left empty
    const context = makeContext({ marketRegime: { label: 'bullish', compositeScore: 0.3, isHighVolatility: false, indexScores: [] } });

    expect(variant.evaluate(context).setupDetected).toBe(false);
  });

  it('never rescues a setup the base strategy itself rejected', () => {
    spyRoc12ByDate.set(testDateKey, 10);
    const variant = new BullishMomentumGateVariant(spyRoc12ByDate, stubBase(notDetectedResult()) as any);
    const context = makeContext({ marketRegime: { label: 'bullish', compositeScore: 0.3, isHighVolatility: false, indexScores: [] } });

    expect(variant.evaluate(context).setupDetected).toBe(false);
  });

  it('uses the pre-registered default threshold (SPY 12-day ROC > 0%)', () => {
    expect(DEFAULT_BULLISH_MOMENTUM_GATE_CONFIG.minSpyRoc12Pct).toBe(0);
  });
});
