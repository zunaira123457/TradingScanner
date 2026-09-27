import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { makeUptrendCandles, makeDowntrendCandles } from './fixtures';
import { Candle } from '@/types';

describe('MomentumContinuationStrategy', () => {
  const strategy = new MomentumContinuationStrategy();

  it('should detect a setup on a strong, steady uptrend ending near its recent high', () => {
    // period=20 puts a sine peak at i ≡ 5 (mod 20); 246 days -> last index 245, 245 mod 20 = 5 -> a peak.
    const candles = makeUptrendCandles(246, { dailyDrift: 0.4, amplitude: 6, period: 20 });
    const context = buildStrategyContext('TEST', candles);

    const result = strategy.evaluate(context);

    if (!result.setupDetected) {
      throw new Error(`Expected setup to be detected. Warnings: ${result.warnings.join('; ')}`);
    }

    expect(result.entry).not.toBeNull();
    expect(result.stop as number).toBeLessThan(result.entry as number);
    expect(result.target as number).toBeGreaterThan(result.entry as number);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.evidence.some((e) => e.includes('ADX'))).toBe(true);
  });

  it('should NOT detect a setup in a downtrend', () => {
    const candles = makeDowntrendCandles(246, { startPrice: 300, dailyDrift: 0.4, amplitude: 6, period: 20 });
    const context = buildStrategyContext('TEST', candles);
    const result = strategy.evaluate(context);

    expect(result.setupDetected).toBe(false);
  });

  it('should NOT detect a setup when price has pulled back well off its recent high', () => {
    const candles = makeUptrendCandles(246, { dailyDrift: 0.4, amplitude: 6, period: 20 });
    const last = candles[candles.length - 1];
    const dipDate = new Date(last.timestamp);
    dipDate.setDate(dipDate.getDate() + 1);
    const dip: Candle = {
      timestamp: dipDate,
      open: last.close,
      high: last.close,
      low: last.close * 0.85,
      close: last.close * 0.85, // 15% below yesterday's close, well outside the 8% "near highs" band
      volume: 1000000,
    };
    const context = buildStrategyContext('TEST', [...candles, dip]);
    const result = strategy.evaluate(context);

    expect(result.setupDetected).toBe(false);
    expect(result.warnings.some((w) => w.includes('below its'))).toBe(true);
  });

  it('should NOT detect a setup when relative strength data shows underperformance', () => {
    const candles = makeUptrendCandles(246, { dailyDrift: 0.4, amplitude: 6, period: 20 });
    const strongerBenchmark = makeUptrendCandles(246, { dailyDrift: 0.8, amplitude: 6, period: 20 });
    const context = buildStrategyContext('TEST', candles, { benchmarkCandles: strongerBenchmark });

    const result = strategy.evaluate(context);
    expect(result.setupDetected).toBe(false);
  });

  it('should return a graceful empty result for insufficient candle history', () => {
    const tiny = makeUptrendCandles(10);
    const context = buildStrategyContext('TEST', tiny);
    const result = strategy.evaluate(context);
    expect(result.setupDetected).toBe(false);
    expect(result.entry).toBeNull();
  });

  it('should never use information beyond the as-of date (no look-ahead)', () => {
    const fullCandles = makeUptrendCandles(300, { dailyDrift: 0.4, amplitude: 6, period: 20 });

    const asOfIndex = 245; // known peak per the period=20 math above
    const contextPointInTime = buildStrategyContext('TEST', fullCandles, { asOfIndex });
    const resultPointInTime = strategy.evaluate(contextPointInTime);

    const truncated = fullCandles.slice(0, asOfIndex + 1);
    const contextFromTruncated = buildStrategyContext('TEST', truncated);
    const resultFromTruncated = strategy.evaluate(contextFromTruncated);

    expect(resultPointInTime).toEqual(resultFromTruncated);
  });
});
