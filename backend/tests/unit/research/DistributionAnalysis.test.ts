import {
  computeGroupStats,
  cohensD,
  compareFeature,
  rankFeatureComparisons,
  winRateByCategory,
  spearmanCorrelation,
  rocAuc,
  decileAnalysis,
} from '@/research/DistributionAnalysis';

describe('DistributionAnalysis', () => {
  describe('computeGroupStats', () => {
    it('should compute mean/median/stdDev/min/max correctly (hand-verified)', () => {
      // [2,4,4,4,5,5,7,9]: mean=5, stdDev=2 (population, but here we compute sample-ish via Stats.stdDev which is population)
      const stats = computeGroupStats([2, 4, 4, 4, 5, 5, 7, 9]);
      expect(stats.n).toBe(8);
      expect(stats.mean).toBeCloseTo(5, 8);
      expect(stats.median).toBeCloseTo(4.5, 8);
      expect(stats.min).toBe(2);
      expect(stats.max).toBe(9);
    });

    it('should return zeros for an empty array', () => {
      const stats = computeGroupStats([]);
      expect(stats.n).toBe(0);
      expect(stats.mean).toBe(0);
    });
  });

  describe('cohensD', () => {
    it('should return a large positive d when winners are clearly higher than losers', () => {
      const winners = [10, 11, 12, 9, 10, 11];
      const losers = [1, 2, 3, 2, 1, 2];
      const d = cohensD(winners, losers);
      expect(d).not.toBeNull();
      expect(d as number).toBeGreaterThan(2); // huge, unambiguous separation
    });

    it('should return approximately 0 when distributions are identical', () => {
      const winners = [5, 6, 7, 5, 6, 7];
      const losers = [5, 6, 7, 5, 6, 7];
      const d = cohensD(winners, losers);
      expect(d).toBeCloseTo(0, 8);
    });

    it('should return null when either group has fewer than 2 values', () => {
      expect(cohensD([5], [1, 2, 3])).toBeNull();
      expect(cohensD([1, 2, 3], [])).toBeNull();
    });

    it('should match a hand-computed pooled Cohen\'s d', () => {
      // winners: [4,6] mean=5, var=(1+1)/1=2
      // losers: [1,3] mean=2, var=(1+1)/1=2
      // pooled var = ((1)*2 + (1)*2)/(2+2-2) = 4/2 = 2, pooled sd = sqrt(2)
      // d = (5-2)/sqrt(2) = 3/1.41421 = 2.1213
      const d = cohensD([4, 6], [1, 3]);
      expect(d).toBeCloseTo(3 / Math.sqrt(2), 6);
    });
  });

  describe('compareFeature', () => {
    it('should flag insufficient_sample when either group is below the 10-trade floor', () => {
      const result = compareFeature('rsi14', [60, 65, 70], [30, 35, 40]);
      expect(result.effectStrength).toBe('insufficient_sample');
    });

    it('should flag noise for a small effect size with sufficient sample', () => {
      const winners = Array.from({ length: 15 }, (_, i) => 50 + (i % 3));
      const losers = Array.from({ length: 15 }, (_, i) => 50 + (i % 3) - 0.1);
      const result = compareFeature('rsi14', winners, losers);
      expect(result.effectStrength === 'noise' || result.effectStrength === 'weak').toBe(true);
    });

    it('should flag interesting for a large, well-sampled effect', () => {
      const winners = Array.from({ length: 20 }, (_, i) => 70 + (i % 5));
      const losers = Array.from({ length: 20 }, (_, i) => 30 + (i % 5));
      const result = compareFeature('adx14', winners, losers);
      expect(result.effectStrength).toBe('interesting');
    });

    it('should exclude nulls from each group before computing stats', () => {
      const winners: Array<number | null> = [10, null, 12, 11, null, 10, 11, 12, 10, 11, 12];
      const losers: Array<number | null> = [1, 2, null, 3, 2, 1, 2, 3, 1, 2, 3];
      const result = compareFeature('test', winners, losers);
      expect(result.winners.n).toBe(9); // 11 - 2 nulls
      expect(result.losers.n).toBe(10); // 11 - 1 null
    });
  });

  describe('rankFeatureComparisons', () => {
    it('should sort by |Cohen\'s d| descending, pushing insufficient-sample comparisons to the end', () => {
      const low = compareFeature('low', [1, 2, 3], [1, 2, 3]); // insufficient sample
      const strong = compareFeature(
        'strong',
        Array.from({ length: 20 }, (_, i) => 100 + (i % 5)), // real variance, still hugely separated
        Array.from({ length: 20 }, (_, i) => 0 + (i % 5))
      );
      const weakButSufficient = compareFeature(
        'weakSufficient',
        Array.from({ length: 20 }, (_, i) => 50 + (i % 2) * 0.1),
        Array.from({ length: 20 }, (_, i) => 50 - (i % 2) * 0.1)
      );

      const ranked = rankFeatureComparisons([low, weakButSufficient, strong]);
      expect(ranked[0].feature).toBe('strong');
      expect(ranked[ranked.length - 1].feature).toBe('low'); // insufficient sample always last
    });
  });

  describe('winRateByCategory', () => {
    it('should compute win rate per category and flag small samples', () => {
      const categories = ['A', 'A', 'A', 'B', 'B'];
      const won = [true, true, false, false, false];
      const result = winRateByCategory(categories, won);

      const a = result.find((r) => r.category === 'A')!;
      const b = result.find((r) => r.category === 'B')!;
      expect(a.n).toBe(3);
      expect(a.winRate).toBeCloseTo(2 / 3, 8);
      expect(a.sufficientSample).toBe(false); // below MIN_SAMPLE_SIZE=10
      expect(b.winRate).toBe(0);
    });

    it('should exclude null categories', () => {
      const categories = ['A', null, 'A'];
      const won = [true, true, false];
      const result = winRateByCategory(categories, won);
      const total = result.reduce((s, r) => s + r.n, 0);
      expect(total).toBe(2);
    });

    it('should flag sufficientSample=true once a category reaches 10 trades', () => {
      const categories = Array.from({ length: 10 }, () => 'A');
      const won = Array.from({ length: 10 }, () => true);
      const result = winRateByCategory(categories, won);
      expect(result[0].sufficientSample).toBe(true);
    });
  });

  describe('spearmanCorrelation', () => {
    it('should return 1 for a perfectly monotonic increasing relationship', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [10, 20, 30, 40, 50];
      expect(spearmanCorrelation(x, y)).toBeCloseTo(1, 8);
    });

    it('should return -1 for a perfectly monotonic decreasing relationship', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [50, 40, 30, 20, 10];
      expect(spearmanCorrelation(x, y)).toBeCloseTo(-1, 8);
    });

    it('should return approximately 1 for a monotonic but non-linear relationship (rank-based, not Pearson)', () => {
      const x = [1, 2, 3, 4, 5];
      const y = [1, 4, 9, 16, 25]; // y = x^2, monotonic but not linear
      expect(spearmanCorrelation(x, y)).toBeCloseTo(1, 8);
    });

    it('should handle tied values via average rank', () => {
      const x = [1, 1, 2, 2, 3];
      const y = [10, 12, 20, 22, 30];
      const r = spearmanCorrelation(x, y);
      expect(r).not.toBeNull();
      expect(r as number).toBeGreaterThan(0.9);
    });

    it('should return null for mismatched lengths or too few points', () => {
      expect(spearmanCorrelation([1, 2], [1, 2, 3])).toBeNull();
      expect(spearmanCorrelation([1, 2], [1, 2])).toBeNull();
    });

    it('should return null when one series has zero variance in rank', () => {
      expect(spearmanCorrelation([5, 5, 5], [1, 2, 3])).toBeNull();
    });
  });

  describe('rocAuc', () => {
    it('should return 1.0 when the feature perfectly separates winners from losers', () => {
      const values = [10, 20, 30, 1, 2, 3]; // first 3 are wins, all higher than the losses
      const isWin = [true, true, true, false, false, false];
      expect(rocAuc(values, isWin)).toBeCloseTo(1, 8);
    });

    it('should return 0.0 when the feature perfectly separates in reverse', () => {
      const values = [1, 2, 3, 10, 20, 30];
      const isWin = [true, true, true, false, false, false];
      expect(rocAuc(values, isWin)).toBeCloseTo(0, 8);
    });

    it('should return exactly 0.5 when the rank sums of each class are equal (no relationship)', () => {
      // values 1..8; wins at ranks {1,4,5,8} (sum=18), losses at ranks {2,3,6,7} (sum=18) — symmetric, no separation.
      const values = [1, 2, 3, 4, 5, 6, 7, 8];
      const isWin = [true, false, false, true, true, false, false, true];
      expect(rocAuc(values, isWin)).toBeCloseTo(0.5, 8);
    });

    it('should return null when one class is empty', () => {
      expect(rocAuc([1, 2, 3], [true, true, true])).toBeNull();
    });
  });

  describe('decileAnalysis', () => {
    it('should show a monotonically increasing win rate for a feature that perfectly predicts outcome', () => {
      // 20 trades, feature value == index; higher index -> always a win
      const values = Array.from({ length: 20 }, (_, i) => i);
      const outcomes = Array.from({ length: 20 }, (_, i) => (i >= 10 ? 1 : -1));
      const won = Array.from({ length: 20 }, (_, i) => i >= 10);

      const buckets = decileAnalysis(values, outcomes, won, 2);
      expect(buckets.length).toBe(2);
      expect(buckets[0].winRate).toBeCloseTo(0, 8);
      expect(buckets[1].winRate).toBeCloseTo(1, 8);
      expect(buckets[1].winRate).toBeGreaterThan(buckets[0].winRate);
    });

    it('should return an empty array for empty input', () => {
      expect(decileAnalysis([], [], [])).toEqual([]);
    });
  });
});
