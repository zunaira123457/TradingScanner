import { TrendPullbackStrategy } from '@/strategies/TrendPullback';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { makeUptrendCandles, makeDowntrendCandles } from './fixtures';

describe('TrendPullbackStrategy', () => {
  const strategy = new TrendPullbackStrategy();

  // The default oscillating uptrend fixture (period=20, amplitude=5) naturally
  // passes through genuine "pullback to EMA21" moments on its way from each
  // peak to the next trough — asOfIndex=250 on a 300-bar series is one such
  // moment, verified empirically rather than hand-derived (EMA21 lag makes
  // exact analytic prediction impractical). Using a real oscillation phase
  // instead of a hand-crafted dip avoids accidentally disturbing swing-point
  // confirmation near the series tail.
  const PULLBACK_AS_OF_INDEX = 250;

  it('should detect a setup on a healthy pullback within an established uptrend', () => {
    const fullCandles = makeUptrendCandles(300);
    const context = buildStrategyContext('TEST', fullCandles, { asOfIndex: PULLBACK_AS_OF_INDEX });

    const result = strategy.evaluate(context);

    if (!result.setupDetected) {
      // Surface the actual warnings so a failure is diagnosable rather than opaque.
      throw new Error(`Expected setup to be detected. Warnings: ${result.warnings.join('; ')}`);
    }

    expect(result.entry).not.toBeNull();
    expect(result.stop).not.toBeNull();
    expect(result.target).not.toBeNull();
    expect(result.stop as number).toBeLessThan(result.entry as number);
    expect(result.target as number).toBeGreaterThan(result.entry as number);
    expect(result.riskRewardRatio).not.toBeNull();
    expect(result.riskRewardRatio as number).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('should NOT detect a setup when price has jumped far above the pullback levels', () => {
    const uptrend = makeUptrendCandles(260);
    const last = uptrend[uptrend.length - 1];
    const jumpDate = new Date(last.timestamp);
    jumpDate.setDate(jumpDate.getDate() + 1);
    const jumpedClose = last.close * 1.2; // 20% jump — far from EMA21/SMA50
    const withJump = [
      ...uptrend,
      { timestamp: jumpDate, open: last.close * 1.19, high: jumpedClose * 1.01, low: last.close * 1.18, close: jumpedClose, volume: 1000000 },
    ];

    const context = buildStrategyContext('TEST', withJump);
    const result = strategy.evaluate(context);

    expect(result.setupDetected).toBe(false);
    expect(result.warnings.some((w) => w.includes('pullback'))).toBe(true);
  });

  it('should NOT detect a setup in a downtrend', () => {
    const downtrend = makeDowntrendCandles(260, { startPrice: 300 });
    const context = buildStrategyContext('TEST', downtrend);
    const result = strategy.evaluate(context);

    expect(result.setupDetected).toBe(false);
    expect(result.entry).toBeNull();
  });

  it('should NOT detect a setup with insufficient history', () => {
    const shortSeries = makeUptrendCandles(50);
    const context = buildStrategyContext('TEST', shortSeries);
    const result = strategy.evaluate(context);

    expect(result.setupDetected).toBe(false);
    expect(result.warnings.some((w) => w.toLowerCase().includes('insufficient'))).toBe(true);
  });

  it('should return a graceful empty result for an empty candle array', () => {
    const context = buildStrategyContext('TEST', []);
    const result = strategy.evaluate(context);

    expect(result.setupDetected).toBe(false);
    expect(result.entry).toBeNull();
    expect(() => result).not.toThrow();
  });

  it('should never use information beyond the as-of date (no look-ahead)', () => {
    const fullCandles = makeUptrendCandles(300);

    const contextPointInTime = buildStrategyContext('TEST', fullCandles, {
      asOfIndex: PULLBACK_AS_OF_INDEX,
    });
    const resultPointInTime = strategy.evaluate(contextPointInTime);

    const truncated = fullCandles.slice(0, PULLBACK_AS_OF_INDEX + 1);
    const contextFromTruncated = buildStrategyContext('TEST', truncated);
    const resultFromTruncated = strategy.evaluate(contextFromTruncated);

    expect(resultPointInTime).toEqual(resultFromTruncated);
  });
});
