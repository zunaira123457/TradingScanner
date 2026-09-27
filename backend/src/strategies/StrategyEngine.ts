import { Strategy, StrategyContext, StrategyResult } from '@/types/strategy';

/**
 * A pluggable registry of strategies. Strategies are added/removed here
 * without touching any other part of the system — scoring, ranking, and
 * signal explanation all operate on StrategyResult[] regardless of which
 * strategies produced them.
 */
export class StrategyEngine {
  private strategies: Strategy[] = [];

  register(strategy: Strategy): void {
    if (this.strategies.some((s) => s.name === strategy.name)) {
      throw new Error(`A strategy named "${strategy.name}" is already registered`);
    }
    this.strategies.push(strategy);
  }

  unregister(name: string): void {
    this.strategies = this.strategies.filter((s) => s.name !== name);
  }

  getStrategy(name: string): Strategy | undefined {
    return this.strategies.find((s) => s.name === name);
  }

  listStrategies(): Strategy[] {
    return [...this.strategies];
  }

  evaluateAll(context: StrategyContext): StrategyResult[] {
    return this.strategies.map((s) => s.evaluate(context));
  }

  /** Evaluate one named strategy; throws if it isn't registered. */
  evaluateOne(name: string, context: StrategyContext): StrategyResult {
    const strategy = this.getStrategy(name);
    if (!strategy) {
      throw new Error(`No strategy named "${name}" is registered`);
    }
    return strategy.evaluate(context);
  }
}
