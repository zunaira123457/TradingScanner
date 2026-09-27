import { Candle } from '@/types';
import { Strategy, StrategyContext, StrategyResult } from '@/types/strategy';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { calculateScore, classifySignal } from '@/scoring/ScoringEngine';
import { explainSignal } from '@/scoring/SignalExplainer';
import { SignalExplanation } from '@/types/scoring';

export function c(open: number, high: number, low: number, close: number, dayOffset: number): Candle {
  return { timestamp: new Date(2020, 0, 1 + dayOffset), open, high, low, close, volume: 1_000_000 };
}

/** Same style helper used throughout the existing test suite (see LookAheadAudit.test.ts). */
export function makeOscillatingCandles(days: number, startPrice = 100): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < days; i++) {
    price += Math.sin(i / 3) * 2;
    const open = price - 0.3;
    const close = price;
    candles.push(c(open, Math.max(open, close) + 0.8, Math.min(open, close) - 0.8, close, i));
  }
  return candles;
}

export function makeAlwaysBuyStrategy(): Strategy {
  return {
    name: 'always_buy_test',
    description: 'TEST ONLY',
    evaluate(context: StrategyContext): StrategyResult {
      const today = context.candles[context.candles.length - 1];
      const entry = today.close;
      const stop = entry * 0.95;
      const target = entry * 1.1;
      return {
        strategy: 'always_buy_test',
        ticker: context.ticker,
        date: today.timestamp,
        setupDetected: true,
        confidence: 0.8,
        entry,
        stop,
        target,
        riskPerShare: entry - stop,
        rewardPerShare: target - entry,
        riskRewardRatio: (target - entry) / (entry - stop),
        evidence: ['Test strategy always fires'],
        warnings: ['Test strategy — not a real signal'],
        supportingPatterns: [],
      };
    },
  };
}

/** Builds the full deterministic pipeline output (context/result/explanation) at one asOfIndex. */
export function buildPipelineAt(
  candles: Candle[],
  asOfIndex: number
): { context: StrategyContext; result: StrategyResult; explanation: SignalExplanation } {
  const context = buildStrategyContext('TEST', candles, { asOfIndex });
  const strategy = makeAlwaysBuyStrategy();
  const result = strategy.evaluate(context);
  const scoreBreakdown = calculateScore(context, result);
  const classification = classifySignal(scoreBreakdown.total, result.setupDetected);
  const explanation = explainSignal(context, result, scoreBreakdown, classification);
  return { context, result, explanation };
}
