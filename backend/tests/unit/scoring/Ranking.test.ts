import { rankSignals } from '@/scoring/Ranking';
import { SignalExplanation } from '@/types/scoring';

function makeExplanation(ticker: string, score: number): SignalExplanation {
  return {
    ticker,
    date: new Date(),
    strategy: 'trend_pullback',
    classification: score >= 75 ? 'BUY' : score >= 50 ? 'WATCH' : 'AVOID',
    score,
    scoreBreakdown: { trend: 0, momentum: 0, volume: 0, relativeStrength: 0, chartSetup: 0, marketRegime: 0, riskReward: 0, total: score },
    entry: 100,
    stop: 95,
    target: 110,
    riskRewardRatio: 2.0,
    reasons: [],
    risks: [],
    invalidation: 'Price closes below $95.00',
  };
}

describe('rankSignals', () => {
  it('should sort by score descending and assign 1-based ranks', () => {
    const explanations = [makeExplanation('A', 60), makeExplanation('B', 90), makeExplanation('C', 75)];
    const ranked = rankSignals(explanations);

    expect(ranked.map((r) => r.ticker)).toEqual(['B', 'C', 'A']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked[0].score).toBe(90);
  });

  it('should preserve relative order for equal scores (stable sort)', () => {
    const explanations = [makeExplanation('A', 80), makeExplanation('B', 80)];
    const ranked = rankSignals(explanations);
    expect(ranked.map((r) => r.ticker)).toEqual(['A', 'B']);
  });

  it('should not mutate the input array', () => {
    const explanations = [makeExplanation('A', 60), makeExplanation('B', 90)];
    rankSignals(explanations);
    expect(explanations[0].ticker).toBe('A');
  });

  it('should return an empty array for empty input', () => {
    expect(rankSignals([])).toEqual([]);
  });

  it('should carry through classification, strategy, and risk/reward fields', () => {
    const ranked = rankSignals([makeExplanation('A', 85)]);
    expect(ranked[0].classification).toBe('BUY');
    expect(ranked[0].strategy).toBe('trend_pullback');
    expect(ranked[0].entry).toBe(100);
    expect(ranked[0].riskRewardRatio).toBe(2.0);
  });
});
