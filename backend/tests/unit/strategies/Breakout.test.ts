import { BreakoutStrategy } from '@/strategies/Breakout';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { makeUptrendCandles, appendConsolidationAndBreakout } from './fixtures';
import { Candle } from '@/types';

describe('BreakoutStrategy', () => {
  const strategy = new BreakoutStrategy();

  it('should detect a volume-confirmed breakout from a tight consolidation', () => {
    const base = makeUptrendCandles(60, { dailyDrift: 0.1, amplitude: 2 });
    const withBreakout = appendConsolidationAndBreakout(base, 16, 0.06);
    const context = buildStrategyContext('TEST', withBreakout);

    const result = strategy.evaluate(context);

    if (!result.setupDetected) {
      throw new Error(`Expected setup to be detected. Warnings: ${result.warnings.join('; ')}`);
    }

    expect(result.entry).not.toBeNull();
    expect(result.stop).not.toBeNull();
    expect(result.stop as number).toBeLessThan(result.entry as number);
    expect(result.target as number).toBeGreaterThan(result.entry as number);
    expect(result.riskRewardRatio).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.evidence.some((e) => e.includes('resistance'))).toBe(true);
  });

  it('should NOT detect a breakout without volume confirmation', () => {
    const base = makeUptrendCandles(60, { dailyDrift: 0.1, amplitude: 2 });
    const withBreakout = appendConsolidationAndBreakout(base, 16, 0.06);
    // Zero out the volume on the final (breakout) candle
    const weakVolume: Candle[] = [
      ...withBreakout.slice(0, -1),
      { ...withBreakout[withBreakout.length - 1], volume: 500000 },
    ];

    const context = buildStrategyContext('TEST', weakVolume);
    const result = strategy.evaluate(context);

    expect(result.setupDetected).toBe(false);
  });

  it('should NOT detect a breakout with no prior consolidation', () => {
    const wideRangeThenJump = makeUptrendCandles(60, { dailyDrift: 0.3, amplitude: 15 });
    const context = buildStrategyContext('TEST', wideRangeThenJump);
    const result = strategy.evaluate(context);
    expect(result.setupDetected).toBe(false);
  });

  it('should return a graceful empty result for insufficient candle history', () => {
    const tiny = makeUptrendCandles(1);
    const context = buildStrategyContext('TEST', tiny);
    const result = strategy.evaluate(context);
    expect(result.setupDetected).toBe(false);
    expect(result.entry).toBeNull();
  });

  it('should never use information beyond the as-of date (no look-ahead)', () => {
    const base = makeUptrendCandles(60, { dailyDrift: 0.1, amplitude: 2 });
    const withBreakoutAndMore = appendConsolidationAndBreakout(base, 16, 0.06);
    // append a few more days after the breakout to simulate "future" data
    const last = withBreakoutAndMore[withBreakoutAndMore.length - 1];
    const future: Candle[] = Array.from({ length: 5 }, (_, i) => {
      const d = new Date(last.timestamp);
      d.setDate(d.getDate() + i + 1);
      return { timestamp: d, open: last.close, high: last.close * 1.02, low: last.close * 0.98, close: last.close * 1.01, volume: 900000 };
    });
    const fullSeries = [...withBreakoutAndMore, ...future];

    const asOfIndex = withBreakoutAndMore.length - 1;
    const contextPointInTime = buildStrategyContext('TEST', fullSeries, { asOfIndex });
    const resultPointInTime = strategy.evaluate(contextPointInTime);

    const truncated = fullSeries.slice(0, asOfIndex + 1);
    const contextFromTruncated = buildStrategyContext('TEST', truncated);
    const resultFromTruncated = strategy.evaluate(contextFromTruncated);

    expect(resultPointInTime).toEqual(resultFromTruncated);
  });
});
