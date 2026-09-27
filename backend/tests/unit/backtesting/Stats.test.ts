import { mean, stdDev, coefficientOfVariation } from '@/backtesting/Stats';

describe('Stats', () => {
  // Classic textbook example: population stdDev of [2,4,4,4,5,5,7,9] is exactly 2.
  const values = [2, 4, 4, 4, 5, 5, 7, 9];

  it('should compute mean correctly', () => {
    expect(mean(values)).toBeCloseTo(5, 8);
  });

  it('should compute population standard deviation correctly', () => {
    expect(stdDev(values)).toBeCloseTo(2, 8);
  });

  it('should compute coefficient of variation as stdDev/mean', () => {
    expect(coefficientOfVariation(values)).toBeCloseTo(0.4, 8);
  });

  it('should return 0 for empty arrays', () => {
    expect(mean([])).toBe(0);
    expect(stdDev([])).toBe(0);
    expect(coefficientOfVariation([])).toBe(0);
  });

  it('should return 0 CV when mean is 0 (avoids divide-by-zero)', () => {
    expect(coefficientOfVariation([-2, 2])).toBe(0);
  });
});
