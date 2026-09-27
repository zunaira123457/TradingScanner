import { SignalExplanation, RankedSignal } from '@/types/scoring';

/**
 * Ranks signals by score, descending. Rank is a plain 1-based position — no
 * ties handling beyond stable sort order (equal scores keep their relative
 * input order).
 */
export function rankSignals(explanations: SignalExplanation[]): RankedSignal[] {
  const sorted = [...explanations].sort((a, b) => b.score - a.score);

  return sorted.map((e, i) => ({
    rank: i + 1,
    ticker: e.ticker,
    score: e.score,
    classification: e.classification,
    strategy: e.strategy,
    entry: e.entry,
    stop: e.stop,
    target: e.target,
    riskRewardRatio: e.riskRewardRatio,
  }));
}
