import { MomentumBreakoutStrategy } from '@/strategies/intraday/MomentumBreakout';
import { buildIntradayContext } from '@/strategies/intraday/IntradayStrategyContext';
import { makeMomentumBreakoutCandles, makeIntradaySessionCandles } from './fixtures';

describe('MomentumBreakoutStrategy', () => {
  const strategy = new MomentumBreakoutStrategy();

  it('should detect a relative-volume-confirmed breakout in an uptrend', () => {
    const candles = makeMomentumBreakoutCandles('2024-01-16', '2024-01-17');
    const context = buildIntradayContext('TEST', candles);

    const result = strategy.evaluate(context);

    if (!result.setupDetected) {
      throw new Error(`Expected setup to be detected. Warnings: ${result.warnings.join('; ')}`);
    }
    expect(result.entry).not.toBeNull();
    expect(result.stop as number).toBeLessThan(result.entry as number);
    expect(result.target as number).toBeGreaterThan(result.entry as number);
  });

  it('should NOT detect a breakout without a relative-volume spike', () => {
    const candles = makeMomentumBreakoutCandles('2024-01-16', '2024-01-17');
    const weakVolume = [...candles.slice(0, -1), { ...candles[candles.length - 1], volume: 100000 }];

    const context = buildIntradayContext('TEST', weakVolume);
    const result = strategy.evaluate(context);

    expect(result.setupDetected).toBe(false);
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
