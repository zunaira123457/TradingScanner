import { StrategyEngine } from '@/strategies/StrategyEngine';
import { TrendPullbackStrategy } from '@/strategies/TrendPullback';
import { BreakoutStrategy } from '@/strategies/Breakout';
import { MomentumContinuationStrategy } from '@/strategies/MomentumContinuation';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { makeUptrendCandles } from './fixtures';

describe('StrategyEngine', () => {
  it('should register and list strategies', () => {
    const engine = new StrategyEngine();
    engine.register(new TrendPullbackStrategy());
    engine.register(new BreakoutStrategy());
    engine.register(new MomentumContinuationStrategy());

    const names = engine.listStrategies().map((s) => s.name);
    expect(names).toEqual(['trend_pullback', 'breakout', 'momentum_continuation']);
  });

  it('should throw when registering a duplicate strategy name', () => {
    const engine = new StrategyEngine();
    engine.register(new TrendPullbackStrategy());
    expect(() => engine.register(new TrendPullbackStrategy())).toThrow(/already registered/);
  });

  it('should unregister a strategy by name', () => {
    const engine = new StrategyEngine();
    engine.register(new TrendPullbackStrategy());
    engine.unregister('trend_pullback');
    expect(engine.listStrategies()).toHaveLength(0);
  });

  it('should evaluate all registered strategies against a context', () => {
    const engine = new StrategyEngine();
    engine.register(new TrendPullbackStrategy());
    engine.register(new BreakoutStrategy());
    engine.register(new MomentumContinuationStrategy());

    const candles = makeUptrendCandles(260);
    const context = buildStrategyContext('TEST', candles);
    const results = engine.evaluateAll(context);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.strategy)).toEqual(['trend_pullback', 'breakout', 'momentum_continuation']);
    results.forEach((r) => expect(r.ticker).toBe('TEST'));
  });

  it('should evaluate a single named strategy', () => {
    const engine = new StrategyEngine();
    engine.register(new TrendPullbackStrategy());

    const candles = makeUptrendCandles(260);
    const context = buildStrategyContext('TEST', candles);
    const result = engine.evaluateOne('trend_pullback', context);

    expect(result.strategy).toBe('trend_pullback');
  });

  it('should throw when evaluating an unregistered strategy name', () => {
    const engine = new StrategyEngine();
    const candles = makeUptrendCandles(260);
    const context = buildStrategyContext('TEST', candles);
    expect(() => engine.evaluateOne('nonexistent', context)).toThrow(/No strategy named/);
  });
});
