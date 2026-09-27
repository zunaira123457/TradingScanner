import { wilsonScoreInterval, classifyEvidence } from '@/backtesting/StatisticalEvidence';

describe('StatisticalEvidence', () => {
  describe('wilsonScoreInterval', () => {
    it('should match a hand-verified calculation for 8/10 successes (95% CI)', () => {
      // p=0.8, z=1.96: center≈0.99208, margin≈0.313624, denom≈1.38416
      // lower≈0.4901, upper≈0.9433
      const result = wilsonScoreInterval(8, 10);
      expect(result.lower).toBeCloseTo(0.4901, 3);
      expect(result.upper).toBeCloseTo(0.9433, 3);
    });

    it('should produce a wider interval for a smaller sample at the same win rate', () => {
      const small = wilsonScoreInterval(4, 5); // 80% of 5
      const large = wilsonScoreInterval(80, 100); // 80% of 100
      expect(small.upper - small.lower).toBeGreaterThan(large.upper - large.lower);
    });

    it('should keep bounds within [0,1]', () => {
      const result = wilsonScoreInterval(10, 10); // 100% win rate
      expect(result.lower).toBeGreaterThanOrEqual(0);
      expect(result.upper).toBeLessThanOrEqual(1);
    });

    it('should return [0,0] for n=0 without throwing', () => {
      const result = wilsonScoreInterval(0, 0);
      expect(result.lower).toBe(0);
      expect(result.upper).toBe(0);
    });

    it('should document its independence assumption in the methodology string', () => {
      const result = wilsonScoreInterval(5, 10);
      expect(result.methodology.toLowerCase()).toContain('independent');
    });
  });

  describe('classifyEvidence', () => {
    it('should classify INSUFFICIENT_SAMPLE below the 20-trade floor', () => {
      const result = classifyEvidence({
        numTrades: 10, uniqueStocks: 8, yearsCovered: 5, regimesCovered: 4,
        outOfSampleConsistent: true, parameterRobust: true,
      });
      expect(result.level).toBe('INSUFFICIENT_SAMPLE');
    });

    it('should classify INSUFFICIENT_SAMPLE below the 5-unique-stock floor even with many trades', () => {
      const result = classifyEvidence({
        numTrades: 100, uniqueStocks: 2, yearsCovered: 5, regimesCovered: 4,
        outOfSampleConsistent: true, parameterRobust: true,
      });
      expect(result.level).toBe('INSUFFICIENT_SAMPLE');
    });

    it('should classify WEAK_EVIDENCE when only the floors are barely cleared', () => {
      const result = classifyEvidence({
        numTrades: 25, uniqueStocks: 6, yearsCovered: 1, regimesCovered: 1,
        outOfSampleConsistent: false, parameterRobust: false,
      });
      expect(result.level).toBe('WEAK_EVIDENCE');
    });

    it('should classify STRONGER_EVIDENCE when every criterion is met', () => {
      const result = classifyEvidence({
        numTrades: 100, uniqueStocks: 20, yearsCovered: 5, regimesCovered: 4,
        outOfSampleConsistent: true, parameterRobust: true,
      });
      expect(result.level).toBe('STRONGER_EVIDENCE');
    });

    it('should classify PROMISING for a middling score', () => {
      const result = classifyEvidence({
        numTrades: 60, uniqueStocks: 20, yearsCovered: 5, regimesCovered: 1,
        outOfSampleConsistent: null, parameterRobust: null,
      });
      expect(result.level).toBe('PROMISING');
    });

    it('should never claim statistical significance in its reasons text', () => {
      const result = classifyEvidence({
        numTrades: 100, uniqueStocks: 20, yearsCovered: 5, regimesCovered: 4,
        outOfSampleConsistent: true, parameterRobust: true,
      });
      const allText = result.reasons.join(' ').toLowerCase();
      expect(allText).not.toContain('statistically significant');
      expect(allText).not.toContain('p-value');
    });

    it('should surface inconsistent walk-forward results as an explicit concern, not silently', () => {
      const result = classifyEvidence({
        numTrades: 100, uniqueStocks: 20, yearsCovered: 5, regimesCovered: 4,
        outOfSampleConsistent: false, parameterRobust: true,
      });
      expect(result.reasons.some((r) => r.includes('INCONSISTENT'))).toBe(true);
    });
  });
});
