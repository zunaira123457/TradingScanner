import { SmaCrossoverStrategy } from '@/backtesting/SmaCrossoverStrategy';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { Candle } from '@/types';

function c(close: number, dayOffset: number): Candle {
  return { timestamp: new Date(2020, 0, 1 + dayOffset), open: close - 0.1, high: close + 0.5, low: close - 0.5, close, volume: 1000000 };
}

/** Flat for `flatDays`, then a steady rally for `rallyDays` — guarantees a
 * fast/slow SMA crossover exists somewhere in the rally. */
function makeFlatThenRally(flatDays: number, rallyDays: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < flatDays; i++) candles.push(c(100, i));
  for (let i = 0; i < rallyDays; i++) candles.push(c(100 + i * 1.5, flatDays + i));
  return candles;
}

describe('SmaCrossoverStrategy', () => {
  const strategy = new SmaCrossoverStrategy();

  it('should NOT detect a setup before enough history exists for the slow SMA', () => {
    const candles = makeFlatThenRally(50, 10);
    const context = buildStrategyContext('TEST', candles);
    const result = strategy.evaluate(context);
    expect(result.setupDetected).toBe(false);
    expect(result.warnings.some((w) => w.includes('Insufficient'))).toBe(true);
  });

  it('should detect a crossover setup once the fast SMA rises above the slow SMA during a rally', () => {
    const fullCandles = makeFlatThenRally(220, 80);

    let detectedAt = -1;
    for (let t = 199; t < fullCandles.length; t++) {
      const context = buildStrategyContext('TEST', fullCandles, { asOfIndex: t });
      const result = strategy.evaluate(context);
      if (result.setupDetected) {
        detectedAt = t;
        expect(result.entry).not.toBeNull();
        expect(result.stop as number).toBeLessThan(result.entry as number);
        expect(result.target as number).toBeGreaterThan(result.entry as number);
        expect(result.riskRewardRatio).not.toBeNull();
        expect(result.evidence.some((e) => e.includes('crossed above'))).toBe(true);
        break;
      }
    }

    expect(detectedAt).toBeGreaterThan(-1);
  });

  it('should NOT detect a setup on a flat series with no crossover', () => {
    const candles = makeFlatThenRally(250, 0);
    const context = buildStrategyContext('TEST', candles);
    const result = strategy.evaluate(context);
    expect(result.setupDetected).toBe(false);
  });

  it('should never use information beyond the as-of date (no look-ahead)', () => {
    const fullCandles = makeFlatThenRally(220, 80);
    const asOfIndex = 250;

    const contextPointInTime = buildStrategyContext('TEST', fullCandles, { asOfIndex });
    const resultPointInTime = strategy.evaluate(contextPointInTime);

    const truncated = fullCandles.slice(0, asOfIndex + 1);
    const contextFromTruncated = buildStrategyContext('TEST', truncated);
    const resultFromTruncated = strategy.evaluate(contextFromTruncated);

    expect(resultPointInTime).toEqual(resultFromTruncated);
  });
});
