import { OpeningRangeBreakoutStrategy } from '@/strategies/intraday/OpeningRangeBreakout';
import { buildIntradayContext } from '@/strategies/intraday/IntradayStrategyContext';
import { makeOpeningRangeBreakoutCandles } from './fixtures';

describe('OpeningRangeBreakoutStrategy', () => {
  const strategy = new OpeningRangeBreakoutStrategy();

  it('should detect a volume-confirmed breakout above the opening range', () => {
    const candles = makeOpeningRangeBreakoutCandles('2024-01-16', '2024-01-17');
    const context = buildIntradayContext('TEST', candles);

    const result = strategy.evaluate(context);

    if (!result.setupDetected) {
      throw new Error(`Expected setup to be detected. Warnings: ${result.warnings.join('; ')}`);
    }
    expect(result.entry).not.toBeNull();
    expect(result.stop as number).toBeLessThan(result.entry as number);
    expect(result.target as number).toBeGreaterThan(result.entry as number);
    expect(result.riskRewardRatio).not.toBeNull();
  });

  it('should NOT detect a breakout without volume confirmation', () => {
    const candles = makeOpeningRangeBreakoutCandles('2024-01-16', '2024-01-17');
    const weakVolume = [...candles.slice(0, -1), { ...candles[candles.length - 1], volume: 50000 }];

    const context = buildIntradayContext('TEST', weakVolume);
    const result = strategy.evaluate(context);

    expect(result.setupDetected).toBe(false);
  });

  it('should NOT detect a setup before the opening range is established', () => {
    const candles = makeOpeningRangeBreakoutCandles('2024-01-16', '2024-01-17');
    // Cut off after only 2 bars of today's session (opening range needs 3).
    const beforeRangeComplete = candles.slice(0, candles.length - 2);

    const context = buildIntradayContext('TEST', beforeRangeComplete);
    const result = strategy.evaluate(context);

    expect(result.setupDetected).toBe(false);
    expect(result.warnings.some((w) => w.includes('opening range'))).toBe(true);
  });

  it('should return a graceful empty result for insufficient candle history', () => {
    const context = buildIntradayContext('TEST', []);
    const result = strategy.evaluate(context);
    expect(result.setupDetected).toBe(false);
    expect(result.entry).toBeNull();
  });
});
