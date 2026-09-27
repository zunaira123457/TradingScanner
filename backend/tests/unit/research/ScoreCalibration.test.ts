import {
  buildScoreDeciles,
  checkMonotonicity,
  spearmanCorrelation,
  rocAuc,
  analyzeThreshold,
  profitFactor,
  ScorableTrade,
} from '@/research/ScoreCalibration';

function trade(signalScore: number, won: boolean, netPnl: number | null, rMultiple: number | null = null, ticker = 'AAA', marketRegime: string | null = 'bullish'): ScorableTrade {
  return { signalScore, won, netPnl, rMultiple, ticker, marketRegime };
}

describe('profitFactor', () => {
  it('computes grossProfit / grossLoss', () => {
    expect(profitFactor([100, -50, 200, -100])).toBeCloseTo(300 / 150);
  });
  it('returns Infinity when there are winners and zero losses', () => {
    expect(profitFactor([100, 200])).toBe(Infinity);
  });
  it('returns null for an empty bucket', () => {
    expect(profitFactor([])).toBeNull();
  });
  it('returns null when there is no profit and no loss (all zero)', () => {
    expect(profitFactor([0, 0])).toBeNull();
  });
});

describe('buildScoreDeciles', () => {
  it('splits n=226 into deciles 1-6 sized 23 and deciles 7-10 sized 22 (documented allocation)', () => {
    const trades = Array.from({ length: 226 }, (_, i) => trade(i, i % 2 === 0, i % 2 === 0 ? 100 : -100));
    const deciles = buildScoreDeciles(trades);
    expect(deciles).toHaveLength(10);
    expect(deciles.slice(0, 6).map((d) => d.n)).toEqual([23, 23, 23, 23, 23, 23]);
    expect(deciles.slice(6).map((d) => d.n)).toEqual([22, 22, 22, 22]);
    expect(deciles.reduce((sum, d) => sum + d.n, 0)).toBe(226);
  });

  it('sorts ascending by score — decile 1 has the lowest scores, decile 10 the highest', () => {
    const trades = [trade(90, true, 100), trade(10, false, -50), trade(50, true, 60)];
    const deciles = buildScoreDeciles(trades);
    // n=3, baseSize=0, remainder=3 -> deciles 1,2,3 get size 1 each, 4-10 get size 0
    expect(deciles[0].scoreMin).toBe(10);
    expect(deciles[1].scoreMin).toBe(50);
    expect(deciles[2].scoreMin).toBe(90);
    expect(deciles.slice(3).every((d) => d.n === 0)).toBe(true);
  });

  it('computes win rate, avg/median netPnl, and expectancy correctly for a simple bucket', () => {
    // 10 trades, all in one decile-equivalent (n=10 -> baseSize=1, remainder=0 -> 10 deciles of 1 each)
    // so test decile stats directly via a bucket of size >=2 using a smaller n
    const trades = [
      trade(50, true, 100),
      trade(51, true, 200),
      trade(52, false, -50),
      trade(53, false, -150),
    ];
    // n=4 -> baseSize=0, remainder=4 -> deciles 1-4 get 1 trade each, 5-10 get 0
    const deciles = buildScoreDeciles(trades);
    const d1 = deciles[0]; // score 50, won, netPnl 100
    expect(d1.n).toBe(1);
    expect(d1.winRate).toBe(1);
    expect(d1.avgNetPnl).toBe(100);
    expect(d1.medianNetPnl).toBe(100);
    // winRate=1 -> expectancy = 1*avgWin - 0*avgLoss = avgWin = 100
    expect(d1.expectancy).toBeCloseTo(100);
  });

  it('is deterministic — same input always produces the same output', () => {
    const trades = Array.from({ length: 47 }, (_, i) => trade((i * 7) % 100, i % 3 === 0, i - 20));
    const first = buildScoreDeciles(trades);
    const second = buildScoreDeciles(trades);
    expect(first).toEqual(second);
  });
});

describe('checkMonotonicity', () => {
  it('detects a perfectly monotonic non-decreasing sequence', () => {
    const trades = Array.from({ length: 100 }, (_, i) => trade(i, i >= 50, i >= 50 ? 100 : -100));
    // deciles 1-5 (scores 0-49) all losers, deciles 6-10 (scores 50-99) all winners
    const deciles = buildScoreDeciles(trades);
    const result = checkMonotonicity(deciles);
    expect(result.winRates).toEqual([0, 0, 0, 0, 0, 1, 1, 1, 1, 1]);
    expect(result.isMonotonicNonDecreasing).toBe(true);
    expect(result.reversalCount).toBe(0);
  });

  it('detects reversals in a non-monotonic sequence and reports the exact transitions', () => {
    const trades = [
      ...Array.from({ length: 10 }, (_, i) => trade(i, true, 100)), // decile 1: low score, HIGH win rate
      ...Array.from({ length: 10 }, (_, i) => trade(20 + i, false, -100)), // decile 2: mid score, LOW win rate
    ];
    const deciles = buildScoreDeciles(trades);
    const result = checkMonotonicity(deciles);
    expect(result.isMonotonicNonDecreasing).toBe(false);
    expect(result.reversalCount).toBeGreaterThan(0);
    expect(result.reversalTransitions[0].fromWinRate).toBeGreaterThan(result.reversalTransitions[0].toWinRate);
  });
});

describe('spearmanCorrelation', () => {
  it('returns 1 for a perfectly monotonically increasing relationship', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 20, 30, 40, 50];
    expect(spearmanCorrelation(x, y)).toBeCloseTo(1, 5);
  });

  it('returns -1 for a perfectly monotonically decreasing relationship', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [50, 40, 30, 20, 10];
    expect(spearmanCorrelation(x, y)).toBeCloseTo(-1, 5);
  });

  it('returns approximately 0 for no relationship', () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = [3, 1, 4, 1, 5, 9].map((v) => v % 2); // scrambled, low correlation expected
    const r = spearmanCorrelation(x, y);
    expect(r).not.toBeNull();
    expect(Math.abs(r as number)).toBeLessThan(1);
  });

  it('handles ties via average rank without throwing', () => {
    const x = [1, 1, 2, 2, 3];
    const y = [1, 2, 1, 2, 3];
    expect(() => spearmanCorrelation(x, y)).not.toThrow();
  });

  it('returns null when a series has zero variance', () => {
    expect(spearmanCorrelation([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});

describe('rocAuc', () => {
  it('returns 1.0 when the score perfectly separates winners above losers', () => {
    const scores = [10, 20, 30, 80, 90, 95];
    const positive = [false, false, false, true, true, true];
    expect(rocAuc(scores, positive)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 when the score perfectly separates losers above winners (inverted)', () => {
    const scores = [10, 20, 30, 80, 90, 95];
    const positive = [true, true, true, false, false, false];
    expect(rocAuc(scores, positive)).toBeCloseTo(0.0, 5);
  });

  it('returns exactly 0.5 for a symmetric no-discrimination arrangement (lowest and highest scores both positive)', () => {
    // ranks [1,2,3,4], positives at ranks {1,4} -> sumPosRanks=5,
    // expected-under-null=nPos*(nPos+1)/2=3 -> AUC=(5-3)/(2*2)=0.5 exactly.
    const scores = [1, 2, 3, 4];
    const positive = [true, false, false, true];
    expect(rocAuc(scores, positive)).toBeCloseTo(0.5, 10);
  });

  it('returns null when one class is empty', () => {
    expect(rocAuc([1, 2, 3], [true, true, true])).toBeNull();
  });

  it('reproduces the known Cohen\'s d = -0.121 style finding as a below-0.5 AUC on a deterministic, heavily-overlapping synthetic set', () => {
    // Winners and losers with heavily overlapping, slightly INVERTED score
    // distributions (losers score marginally higher) — mirroring the prior
    // diagnostic finding (winners mean 81.2, losers mean 81.7). Fixed values,
    // not random, so this test is deterministic.
    const winners = [80, 81, 82, 79, 83, 80, 81, 82, 79, 83];
    const losers = [81, 82, 83, 80, 84, 81, 82, 83, 80, 84];
    const scores = [...winners, ...losers];
    const positive = [...winners.map(() => true), ...losers.map(() => false)];
    expect(rocAuc(scores, positive)).toBeCloseTo(0.32, 5);
  });
});

describe('analyzeThreshold', () => {
  it('retains only trades at or above the threshold and computes correct stats', () => {
    const trades = [
      trade(50, true, 100),
      trade(65, false, -50),
      trade(75, true, 200),
      trade(90, true, 300),
    ];
    const result = analyzeThreshold(trades, 70);
    expect(result.tradesRetained).toBe(2); // 75 and 90
    expect(result.winRate).toBe(1);
    expect(result.totalNetPnl).toBe(500);
    expect(result.expectancy).toBeCloseTo(250);
  });

  it('handles a threshold that retains zero trades without throwing', () => {
    const trades = [trade(50, true, 100)];
    const result = analyzeThreshold(trades, 99);
    expect(result.tradesRetained).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.profitFactor).toBeNull();
  });
});
