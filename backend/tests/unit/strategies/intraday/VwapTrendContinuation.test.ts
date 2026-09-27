import { VwapTrendContinuationStrategy } from '@/strategies/intraday/VwapTrendContinuation';
import { buildIntradayContext } from '@/strategies/intraday/IntradayStrategyContext';
import { makeVwapPullbackCandles, makeIntradaySessionCandles } from './fixtures';

describe('VwapTrendContinuationStrategy', () => {
  const strategy = new VwapTrendContinuationStrategy();

  it('should detect a pullback-to-VWAP continuation that turns back up', () => {
    const candles = makeVwapPullbackCandles('2024-01-16', '2024-01-17');
    const context = buildIntradayContext('TEST', candles);

    const result = strategy.evaluate(context);

    if (!result.setupDetected) {
      throw new Error(`Expected setup to be detected. Warnings: ${result.warnings.join('; ')}`);
    }
    expect(result.entry).not.toBeNull();
    expect(result.stop as number).toBeLessThan(result.entry as number);
    expect(result.target as number).toBeGreaterThan(result.entry as number);
  });

  it('should NOT detect a setup in a flat, directionless session', () => {
    const flat = makeIntradaySessionCandles('2024-01-16', 60, { startPrice: 100, drift: 0, amplitude: 0.1, volume: 100000 });
    const context = buildIntradayContext('TEST', flat);

    const result = strategy.evaluate(context);
    expect(result.setupDetected).toBe(false);
  });

  it('should return a graceful empty result for insufficient candle history', () => {
    const context = buildIntradayContext('TEST', makeIntradaySessionCandles('2024-01-16', 5));
    const result = strategy.evaluate(context);
    expect(result.setupDetected).toBe(false);
    expect(result.entry).toBeNull();
  });
});
