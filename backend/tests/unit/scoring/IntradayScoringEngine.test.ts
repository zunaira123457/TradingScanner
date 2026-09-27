import { calculateIntradayScore, IntradayMarketContext } from '@/scoring/IntradayScoringEngine';
import { IntradayContext, IntradaySnapshot } from '@/types/intraday';
import { StrategyResult } from '@/types/strategy';
import { Candle } from '@/types';

function makeSnapshot(overrides: Partial<IntradaySnapshot> = {}): IntradaySnapshot {
  return {
    date: new Date('2024-01-17T15:00:00.000Z'),
    close: 101,
    ema9: 101,
    ema21: 100,
    rsi14: 60,
    atr14: 1,
    vwap: 100,
    relativeVolume: 2.0,
    ...overrides,
  };
}

function makeContext(snapshot: IntradaySnapshot, ticker = 'TEST'): IntradayContext {
  const candle: Candle = {
    timestamp: snapshot.date,
    open: snapshot.close - 0.5,
    high: snapshot.close + 0.5,
    low: snapshot.close - 1,
    close: snapshot.close,
    volume: 100000,
  };
  return { ticker, candles: [candle], snapshots: [snapshot], openingRangeHigh: null, openingRangeLow: null };
}

function makeStrategyResult(overrides: Partial<StrategyResult> = {}): StrategyResult {
  return {
    strategy: 'test_strategy',
    ticker: 'TEST',
    date: new Date('2024-01-17T15:00:00.000Z'),
    setupDetected: true,
    confidence: 0.8,
    entry: 101,
    stop: 99,
    target: 105,
    riskPerShare: 2,
    rewardPerShare: 4,
    riskRewardRatio: 2,
    evidence: [],
    warnings: [],
    supportingPatterns: [],
    ...overrides,
  };
}

describe('IntradayScoringEngine', () => {
  it('should score 0 across every category when no setup was detected', () => {
    const context = makeContext(makeSnapshot());
    const result = makeStrategyResult({ setupDetected: false });
    const market: IntradayMarketContext = { spy: null };

    const breakdown = calculateIntradayScore(context, market, result);

    expect(breakdown.total).toBe(0);
    expect(breakdown.trend).toBe(0);
    expect(breakdown.chartSetup).toBe(0);
  });

  it('should score higher for a strong bullish setup (above VWAP, EMA aligned, volume spike) than a weak one', () => {
    const market: IntradayMarketContext = { spy: null };

    const strongContext = makeContext(
      makeSnapshot({ close: 105, ema9: 104, ema21: 101, rsi14: 65, relativeVolume: 3.0 })
    );
    const weakContext = makeContext(
      makeSnapshot({ close: 99, ema9: 99, ema21: 100, rsi14: 45, relativeVolume: 0.8 })
    );
    const result = makeStrategyResult();

    const strongScore = calculateIntradayScore(strongContext, market, result).total;
    const weakScore = calculateIntradayScore(weakContext, market, result).total;

    expect(strongScore).toBeGreaterThan(weakScore);
  });

  it('should use a neutral 0.5 read for relativeStrength/marketRegime when SPY data is unavailable', () => {
    const context = makeContext(makeSnapshot());
    const result = makeStrategyResult();

    const withoutSpy = calculateIntradayScore(context, { spy: null }, result);

    // trend(0.2)+momentum(0.15)+volume(0.15)+chartSetup(0.2)+riskReward(0.1) explicit,
    // relativeStrength(0.15) and marketRegime(0.05) both default to 0.5 * weight * 100.
    expect(withoutSpy.relativeStrength).toBeCloseTo(0.5 * 0.15 * 100, 5);
    expect(withoutSpy.marketRegime).toBeCloseTo(0.5 * 0.05 * 100, 5);
  });

  it('should reward outperforming SPY intraday with a higher relativeStrength component', () => {
    const spyCandle: Candle = {
      timestamp: new Date('2024-01-17T15:00:00.000Z'),
      open: 400,
      high: 400.5,
      low: 399.5,
      close: 400,
      volume: 1000000,
    };
    const spyFlatOpen: Candle = { ...spyCandle, timestamp: new Date('2024-01-17T14:30:00.000Z') };
    const spySnap = makeSnapshot({ date: spyCandle.timestamp, close: 400, vwap: 400 });
    const spyContext: IntradayContext = {
      ticker: 'SPY',
      candles: [spyFlatOpen, spyCandle],
      snapshots: [spySnap, spySnap],
      openingRangeHigh: null,
      openingRangeLow: null,
    };

    // Ticker's session open (first bar) vs latest close is up sharply, while SPY was flat.
    const tickerOpen: Candle = {
      timestamp: new Date('2024-01-17T14:30:00.000Z'),
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 100000,
    };
    const tickerLatest: Candle = {
      timestamp: new Date('2024-01-17T15:00:00.000Z'),
      open: 104,
      high: 105,
      low: 103.5,
      close: 105,
      volume: 100000,
    };
    const context: IntradayContext = {
      ticker: 'TEST',
      candles: [tickerOpen, tickerLatest],
      snapshots: [makeSnapshot(), makeSnapshot({ close: 105 })],
      openingRangeHigh: null,
      openingRangeLow: null,
    };

    const result = makeStrategyResult();
    const breakdown = calculateIntradayScore(context, { spy: spyContext }, result);

    // Ticker up ~5% while SPY flat — well above the neutral 0.5 baseline.
    expect(breakdown.relativeStrength).toBeGreaterThan(0.5 * 0.15 * 100);
  });
});
