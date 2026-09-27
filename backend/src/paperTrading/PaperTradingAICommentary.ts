import { Candle } from '@/types';
import { Trade, BacktestUniverse } from '@/types/backtest';
import { Strategy } from '@/types/strategy';
import { buildStrategyContext } from '@/strategies/StrategyContext';
import { calculateScore, classifySignal } from '@/scoring/ScoringEngine';
import { explainSignal } from '@/scoring/SignalExplainer';
import { SignalAnalysisService } from '@/ai/SignalAnalysisService';
import { findIndexForDate } from './DateIndexLookup';
import { AICommentarySummary, summarizeAIOutcome } from './PaperTradeRecord';
import logger from '@/utils/logger';

function sliceIndexMapTo(map: Map<string, Candle[]> | undefined, t: number): Map<string, Candle[]> | undefined {
  if (!map) return undefined;
  const sliced = new Map<string, Candle[]>();
  for (const [k, v] of map) sliced.set(k, v.slice(0, t + 1));
  return sliced;
}

/**
 * Reconstructs the exact point-in-time StrategyContext/StrategyResult/
 * SignalExplanation for a newly-opened paper trade's signal date (the same
 * pipeline TradeFeatureExtractor.ts and analyzeSignalWithAI.ts already use),
 * then asks the Phase 5 AI layer for a plain-language explanation. Read-only
 * and purely additive — never influences which trades are taken (that's
 * already decided by the deterministic Backtester.run() call before this is
 * even invoked). Any failure (missing index, provider error, timeout) is
 * logged and returns null; it never blocks or alters the trade record
 * itself, matching SignalAnalysisService's own fallback contract.
 */
export async function getAICommentaryForNewTrade(
  trade: Trade,
  strategy: Strategy,
  universe: BacktestUniverse,
  service: SignalAnalysisService
): Promise<AICommentarySummary | null> {
  const candles = universe.tickers.get(trade.ticker);
  if (!candles) {
    logger.warn(`No candle series found for ${trade.ticker} — skipping AI commentary`);
    return null;
  }

  const signalIndex = findIndexForDate(candles, trade.signalDate);
  if (signalIndex === -1) {
    logger.warn(
      `Could not locate the signal-date index for ${trade.ticker} on ${trade.signalDate.toISOString().slice(0, 10)} — skipping AI commentary`
    );
    return null;
  }

  try {
    const context = buildStrategyContext(trade.ticker, candles, {
      asOfIndex: signalIndex,
      marketIndexCandles: sliceIndexMapTo(universe.indexCandles, signalIndex),
      benchmarkCandles: universe.benchmarkCandles?.slice(0, signalIndex + 1),
    });
    const result = strategy.evaluate(context);
    if (!result.setupDetected) {
      logger.warn(`Re-evaluating ${trade.ticker}'s signal date no longer detects a setup — skipping AI commentary`);
      return null;
    }

    const scoreBreakdown = calculateScore(context, result);
    const classification = classifySignal(scoreBreakdown.total, result.setupDetected);
    const explanation = explainSignal(context, result, scoreBreakdown, classification);

    const outcome = await service.analyze(context, result, explanation);
    return summarizeAIOutcome(outcome);
  } catch (error) {
    logger.warn(`AI commentary failed for ${trade.ticker}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}
