import { Trade } from '@/types/backtest';
import { AIAnalysisOutcome } from '@/types/ai';

/** A trimmed, storage-friendly projection of an AIAnalysisOutcome — the
 * full result carries more detail than the daily report needs to persist. */
export interface AICommentarySummary {
  source: 'ai' | 'deterministic_fallback';
  summary: string;
  signalStatus: string;
}

export function summarizeAIOutcome(outcome: AIAnalysisOutcome): AICommentarySummary {
  return {
    source: outcome.source,
    summary: outcome.result.summary,
    signalStatus: outcome.result.signalStatus,
  };
}

/** Wraps a real Trade without modifying the Trade type itself. */
export interface PaperTrade {
  trade: Trade;
  aiCommentary: AICommentarySummary | null;
}

/**
 * Stable identity key for diffing trades across runs. Deliberately NOT
 * trade.id alone: Portfolio.ts's idCounter is regenerated deterministically
 * each run and SHOULD match run-to-run for an identical replay, but this
 * compound key is a more defensive, self-documenting choice that doesn't
 * depend on that determinism holding perfectly across code changes.
 */
export function tradeKey(trade: Trade): string {
  return `${trade.ticker}|${trade.entryDate.toISOString()}|${trade.signalDate.toISOString()}`;
}

export interface TradeDiff {
  newlyOpened: Trade[]; // first time this exact trade has ever been seen (may also be closed already, if opened+closed within a gap between runs)
  newlyClosed: Trade[]; // genuinely closed (stop/target) and wasn't reported as closed before
  stillOpen: Trade[]; // exitReason === 'end_of_data' — open as of THIS run's endDate
}

/**
 * Compares this run's full trade list against the previous run's persisted
 * snapshot (or null, on the very first tick / after history.json is
 * deleted). "Still open" is keyed off exitReason === 'end_of_data':
 * Backtester.run() only ever assigns that reason in its one final
 * force-close pass, so within a single run's output it always and only
 * means "open as of that run's endDate" — never a genuine exit.
 */
export function diffTrades(previousTrades: Trade[] | null, currentTrades: Trade[]): TradeDiff {
  const previousByKey = new Map<string, Trade>();
  if (previousTrades) {
    for (const t of previousTrades) previousByKey.set(tradeKey(t), t);
  }

  const newlyOpened: Trade[] = [];
  const newlyClosed: Trade[] = [];
  const stillOpen: Trade[] = [];

  for (const trade of currentTrades) {
    const previous = previousByKey.get(tradeKey(trade));
    const isFirstTimeSeen = previous === undefined;
    const isReallyClosedNow = trade.exitReason !== 'end_of_data';
    const wasSyntheticallyOpenBefore = previous !== undefined && previous.exitReason === 'end_of_data';

    if (isFirstTimeSeen) newlyOpened.push(trade);
    if (isReallyClosedNow && (isFirstTimeSeen || wasSyntheticallyOpenBefore)) newlyClosed.push(trade);
    if (!isReallyClosedNow) stillOpen.push(trade);
  }

  return { newlyOpened, newlyClosed, stillOpen };
}
